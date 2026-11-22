import { createHash } from "node:crypto";
import { createEduPiCloudClient, EduPiCloudError, type CloudScope } from "./edupi-cloud-client";
import { entityRestoreRequestId, type EntityDeletionRecord, type EntityDeleteKind } from "./edupi-entity-delete";
import { readCloudEducationWorkspaceBundle } from "./edupi-cloud-education";
import { cachedCloudEntities, cacheCloudEntities } from "./edupi-cloud-entity-cache";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
const KINDS = ["task", "student", "material", "memory", "calendar", "timetable"];

export async function readCloudEntityDeletions(client = createEduPiCloudClient(), selected?: CloudScope) {
  const scope = selected || await client.captureScope();
  let response: RecordValue;
  try {
    response = await client.operation("entities", { action: "list" }, scope);
    cacheCloudEntities(client, scope, response);
  } catch (error) {
    const cached = cachedCloudEntities(client, scope);
    if (!(error instanceof EduPiCloudError) || error.status < 500 || !cached) throw error;
    await client.assertScope(scope);
    response = cached;
  }
  if (response.workspace_id !== scope.workspaceId || !Array.isArray(response.deletions) || !Array.isArray(response.history)) {
    throw new EduPiCloudError("invalid_response", "云端删除记录无效。", 502);
  }
  const deletions = response.deletions.map(raw => {
    const row = record(raw);
    if (!row || !KINDS.includes(String(row.kind)) || typeof row.target_id !== "string"
      || typeof row.target_fingerprint !== "string" || !Number.isInteger(row.revision)
      || typeof row.deleted_at !== "string" || typeof row.actor_id !== "string") {
      throw new EduPiCloudError("invalid_response", "云端删除记录身份无效。", 502);
    }
    const deletion: EntityDeletionRecord = {
      kind: row.kind as EntityDeleteKind, id: row.target_id, label: typeof row.label === "string" ? row.label : null,
      studentId: row.kind === "student" ? row.target_id : null, reviewTargetId: null,
      targetFingerprint: row.target_fingerprint, tombstoneRevision: Number(row.revision),
      deletedAt: row.deleted_at, reviewer: row.actor_id, note: null,
    };
    return { ...deletion, restoreRequestId: entityRestoreRequestId(deletion) };
  });
  return { deletions, history: response.history.map(raw => {
    const row = record(raw)!;
    const target = record(row?.target);
    return {
      historyId: row?.request_id, requestId: row?.request_id, action: row?.action,
      kind: target?.kind, targetId: target?.id, targetLabel: null,
      targetFingerprint: row?.target_fingerprint, tombstoneRevision: row?.tombstone_revision,
      beforeSnapshotId: null, afterSnapshotId: null,
      occurredAt: row?.occurred_at, reviewer: "", note: null,
    };
  }) };
}

export async function mutateCloudEntity(input: {
  kind: EntityDeleteKind; id: string; action: "delete" | "restore";
  note: string | null; restoreRequestId?: string;
}, scope: CloudScope, client = createEduPiCloudClient()) {
  if (!KINDS.includes(input.kind)) throw new EduPiCloudError("unsupported_cloud_operation", "此类对象尚未在云端建立。", 409);
  let fingerprint: string;
  let revision: number | undefined;
  if (input.action === "restore") {
    const deletion = (await readCloudEntityDeletions(client, scope)).deletions
      .find(item => item.kind === input.kind && item.id === input.id);
    if (!deletion || deletion.restoreRequestId !== input.restoreRequestId) {
      throw new EduPiCloudError("stale_tombstone", "删除记录已改变，请重新打开。", 409);
    }
    fingerprint = deletion.targetFingerprint;
    revision = deletion.tombstoneRevision;
  } else {
    const cached = cachedCloudEntities(client, scope);
    const state = Array.isArray(cached?.states) ? cached.states.map(record)
      .find(row => row?.kind === input.kind && row.id === input.id) : null;
    if (typeof state?.fingerprint === "string") fingerprint = state.fingerprint;
    else {
      const response = await client.operation("entities", { action: "read", kind: input.kind, id: input.id }, scope);
      const state = record(response.state);
      if (response.workspace_id !== scope.workspaceId || state?.deleted !== false || typeof state.fingerprint !== "string") {
        throw new EduPiCloudError("target_not_found", "云端对象已不可用。", 404);
      }
      fingerprint = state.fingerprint;
    }
  }
  const requestId = input.action === "restore" ? input.restoreRequestId!
    : `entity-delete-${createHash("sha256").update(JSON.stringify([input.kind, input.id, fingerprint, input.note])).digest("base64url")}`;
  const result = await client.operationWithOutbox("entities", {
    action: input.action, kind: input.kind, id: input.id, request_id: requestId,
    expected_fingerprint: fingerprint, ...(revision === undefined ? {} : { tombstone_revision: revision }),
    note: input.note,
  }, scope);
  if (result.queued) return { queued: true, status: "pending_sync", queueEntry: result.entry };
  const data = (await readCloudEducationWorkspaceBundle(client, scope)).data;
  return {
    target: { kind: input.kind, id: input.id }, deletedAt: result.result.deleted_at ?? null,
    restoredAt: result.result.restored_at ?? null, data,
  };
}
