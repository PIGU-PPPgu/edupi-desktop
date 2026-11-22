import { createHash } from "node:crypto";
import { createEduPiCloudClient, EduPiCloudError, type CloudScope } from "./edupi-cloud-client";
import type { ClassroomRequest, ClassroomInput } from "./edupi-classroom-types";
import { computeCloudClassroom, type CloudClassroomRoster, type CloudClassroomReference } from "./edupi-cloud-classroom-compute";
import { classroomCanonical, sameClassroomValue, verifyCloudClassroomWrite } from "./edupi-cloud-classroom-verification";
import { readCloudClassroomForPreparation } from "./edupi-cloud-classroom-cache";

type Row = Record<string, unknown>;
type Client = ReturnType<typeof createEduPiCloudClient>;
const row = (value: unknown): Row | null => value && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(classroomCanonical(value))).digest("hex");
const fail = (code: string, message: string, status = 400): never => { throw new EduPiCloudError(code, message, status); };

export async function cloudClassroomService(
  request: ClassroomRequest, client: Client, scope: CloudScope, signal?: AbortSignal,
  compute = computeCloudClassroom,
): Promise<Row> {
  signal?.throwIfAborted();
  const source: Row = Object.fromEntries(Object.entries(request).filter(([, value]) => value !== undefined));
  const requestId = request.request_id || `classroom-cloud-${digest({
    issuer: scope.issuer, account_id: scope.accountId, workspace_id: scope.workspaceId, source,
  })}`;
  const id = request.id || `cloud-classroom-${digest({ domain: request.domain, requestId }).slice(0, 32)}`;
  // Write verification deliberately keeps this live network-only callback.
  const read = async (operation: string, body: Row = {}) => client.operation(operation, body, scope);
  const prepareRead = (body: Row, allowCached = true) => readCloudClassroomForPreparation(client, scope, body, allowCached);
  const check = (response: Row, action: string) => {
    if (response.ok !== true || response.operation !== "classroom" || response.action !== action
      || response.workspace_id !== scope.workspaceId || response.external_send !== false) {
      fail("invalid_response", "云端班级方案身份无效。", 502);
    }
    return response;
  };
  if (["roster", "list", "read"].includes(request.action)) {
    const body = { ...source, request_id: requestId };
    return check(await (request.action === "list" ? read("classroom", body) : prepareRead(body, false)), request.action);
  }
  if (!Number.isSafeInteger(request.expected_revision ?? 0) || Number(request.expected_revision ?? 0) < 0
    || !/^[A-Za-z0-9_-]{1,120}$/u.test(id) || !/^[A-Za-z0-9_-]{1,160}$/u.test(requestId)) fail("invalid_request", "方案身份或版本无效。");
  const original = { ...source, id, expected_revision: request.expected_revision ?? 0, request_id: requestId };
  if (request.action !== "preview") {
    // Before any read or recomputation, recover the first complete queued body.
    // A different roster, timestamp or engine output cannot change its fingerprint.
    const state = await client.state();
    const matching = (entry: typeof state.outbox[number]) => entry.operation === "classroom" && entry.body.request_id === requestId
      && entry.issuer === scope.issuer && entry.accountId === scope.accountId && entry.workspaceId === scope.workspaceId;
    const existing = state.outbox.find(matching) || state.completed.map(item => item.entry).find(matching);
    if (existing) {
      if (!sameClassroomValue(existing.body.source_request, original)) fail("idempotency_conflict", "相同请求 ID 的内容不同，原方案已保留。", 409);
      return deliver(existing.body);
    }
  }
  const rosterResponse = check(await prepareRead({ domain: request.domain, action: "roster", request_id: `${requestId}-roster` }), "roster");
  const roster = rosterResponse.students as CloudClassroomRoster[];
  if (!Array.isArray(roster) || roster.some(item => !item || typeof item.student_id !== "string"
    || typeof item.name !== "string" || typeof item.class_name !== "string" || !Array.isArray(item.traits)
    || !Number.isSafeInteger(item.revision) || !Number.isSafeInteger(item.profile_revision))) fail("invalid_roster", "云端名单无法核对。", 502);
  let input = request.input;
  if (request.action === "restore" || request.action === "publish") {
    const current = check(await prepareRead({
      domain: request.domain, action: "read", id, request_id: `${requestId}-source`,
      ...(request.action === "restore" ? { revision: request.revision } : {}),
    }), "read");
    const record = row(current.record);
    if (!record || record.id !== id || record.domain !== request.domain
      || request.action === "restore" && record.revision !== request.revision
      || request.action === "publish" && record.revision !== request.expected_revision) {
      fail("stale_revision", "方案已更新，请重新打开。", 409);
    }
    input = record!.input as ClassroomInput;
    if (request.action === "publish" && request.domain !== "duty") fail("invalid_request", "只能发布值日方案。");
  }
  if (!input) return fail("invalid_input", "请提供班级方案输入。");
  const references: CloudClassroomReference[] = [];
  for (const referenceId of ["baseline_id", "exam_id"].map(key => (input as unknown as Row)[key]).filter(value => value !== undefined)) {
    if (typeof referenceId !== "string") fail("invalid_reference", "引用考试身份无效。");
    const response = check(await prepareRead({ domain: "grades", action: "read", id: referenceId, request_id: `${requestId}-reference` }), "read");
    const reference = row(response.record);
    if (!reference || reference.id !== referenceId) fail("invalid_reference", "引用考试无法核对。", 502);
    const provenance = row(reference!.computation);
    if (!provenance || !sameClassroomValue(provenance.input, reference!.input)
      || !sameClassroomValue(provenance.result, reference!.result)) {
      fail("reference_unverified", "引用考试尚未通过真实计算，请先重新保存该考试。", 409);
    }
    references.push({ id: String(reference!.id), domain: String(reference!.domain), revision: Number(reference!.revision),
      input: reference!.input as Row, result: reference!.result as Row });
  }
  const computed = await compute(request.domain, input, roster, references, signal);
  signal?.throwIfAborted();
  if (typeof client.assertScope === "function") await client.assertScope(scope);
  if (request.action === "preview") return {
    ok: true, operation: "classroom", action: "preview", workspace_id: scope.workspaceId, request_id: requestId,
    input: computed.input, result: computed.result, issues: computed.issues, unresolved: computed.unresolved || [], external_send: false,
  };
  if (!computed.result || computed.issues.some(item => row(item)?.severity === "error") || computed.unresolved?.length) {
    fail("needs_review", "请先处理学生身份或方案约束问题；未保存。");
  }
  return deliver({ ...original, source_request: original, computed });

  async function deliver(body: Row) {
    const delivery = await client.operationWithOutbox("classroom", body, scope);
    if (delivery.queued) return { ok: false, operation: "classroom", action: request.action, request_id: requestId,
      queued: true, outbox_id: delivery.entry.id, error: "方案已保留，等待云端同步。", external_send: false };
    await verifyCloudClassroomWrite(body, delivery.result, scope.workspaceId, read);
    return delivery.result;
  }
}
