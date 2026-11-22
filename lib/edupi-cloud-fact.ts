import { createEduPiCloudClient, EduPiCloudError, type CloudScope } from "./edupi-cloud-client";
import { readCloudEducationWorkspaceBundle } from "./edupi-cloud-education";
import type { DeletedEducationFactPage, FactMutationInput, FactMutationReceipt } from "./edupi-fact-lifecycle-model";
import { factMutationRequestId, normalizeDeletedFact } from "./edupi-fact-lifecycle";

export async function readCloudDeletedFactPage(
  client: ReturnType<typeof createEduPiCloudClient>, scope: CloudScope, offset: number, limit: number,
): Promise<DeletedEducationFactPage> {
  const response = await client.operation("education-facts", { action: "list_deleted", offset, limit }, scope);
  if (response.ok !== true || response.operation !== "education-facts" || response.action !== "list_deleted"
    || response.external_send !== false || response.offset !== offset || response.limit !== limit
    || !Number.isSafeInteger(response.total) || Number(response.total) < 0
    || !Array.isArray(response.facts) || response.facts.length > limit
    || response.next_offset !== null && (response.next_offset !== offset + response.facts.length
      || Number(response.next_offset) <= offset))
    throw new EduPiCloudError("invalid_response", "云端事实删除记录无效。", 502);
  const facts = response.facts.map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new EduPiCloudError("invalid_response", "云端事实删除记录无效。", 502);
    const value = raw as Record<string, unknown>;
    const deletedAt = typeof value.deleted_at === "string" ? new Date(value.deleted_at) : null;
    if (!deletedAt || Number.isNaN(deletedAt.valueOf())) throw new EduPiCloudError("invalid_response", "云端事实删除时间无效。", 502);
    return normalizeDeletedFact({ ...value, deleted_at: deletedAt.toISOString() });
  });
  if (new Set(facts.map(fact => fact.factId)).size !== facts.length || offset + facts.length > Number(response.total))
    throw new EduPiCloudError("invalid_response", "云端事实删除记录重复。", 502);
  return { total: Number(response.total), offset, limit, nextOffset: response.next_offset === null ? null : Number(response.next_offset), facts, externalSend: false };
}

export async function issueCloudFactMutation(factId: string, input: FactMutationInput, selected?: CloudScope) {
  if ((input.action === "review" || input.action === "restore") && input.supersedesFactId) {
    throw new EduPiCloudError("unsupported_cloud_operation", "云端暂不支持替换冲突事实。", 409);
  }
  const requestId = factMutationRequestId(factId, input);
  const body: Record<string, unknown> = {
    action: input.action,
    request_id: requestId,
    fact_id: factId,
    expected_revision: input.expectedRevision,
    reviewer: input.reviewer,
    external_send: false,
  };
  if (input.action === "review") {
    body.decision = input.decision;
    body.note = input.note;
    body.supersedes_fact_id = input.supersedesFactId;
    body.supersedes_fact_revision = input.supersedesFactRevision;
  } else if (input.action === "modify") {
    body.replacement_value = input.replacementValue;
    body.note = input.note;
  } else if (input.action === "restore") {
    body.supersedes_fact_id = input.supersedesFactId;
    body.supersedes_fact_revision = input.supersedesFactRevision;
  }
  const client = createEduPiCloudClient();
  const scope = selected || await client.captureScope();
  const queued = await client.operationWithOutbox("education-facts", body, scope);
  if (queued.queued) {
    return { queued: true as const, outboxId: queued.entry.id, result: null, data: null, deleted: null };
  }
  const wire = queued.result;
  const result: FactMutationReceipt = {
    requestId, action: input.action, factId, resultFactId: String(wire.result_fact_id), revision: Number(wire.revision),
    status: wire.status as FactMutationReceipt["status"], supersededFactId: typeof wire.superseded_fact_id === "string" ? wire.superseded_fact_id : null,
    replayed: wire.replayed === true, externalSend: false,
  };
  const data = (await readCloudEducationWorkspaceBundle(client, scope)).data;
  let deleted = null;
  if (input.action === "delete") {
    let offset = 0;
    do {
      const page = await readCloudDeletedFactPage(client, scope, offset, 100);
      deleted = page.facts.find(fact => fact.factId === factId && fact.revision === result.revision) || null;
      if (deleted || page.nextOffset === null) break;
      offset = page.nextOffset;
    } while (offset < 10_000);
    if (!deleted) throw new EduPiCloudError("invalid_response", "云端事实删除结果待确认。", 502);
  }
  return { queued: false as const, result, data, deleted };
}
