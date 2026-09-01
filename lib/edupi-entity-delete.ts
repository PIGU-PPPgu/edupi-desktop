import { randomUUID } from "node:crypto";
import type { ResolvedEduPiCore, ResolvedEduPiDataRoot } from "./edupi-core-root";

export const ENTITY_DELETE_KINDS = ["calendar", "timetable", "memory", "student", "task"] as const;
export type EntityDeleteKind = typeof ENTITY_DELETE_KINDS[number];

type RawRecord = Record<string, unknown>;

type DeleteSnapshot = {
  envelope: RawRecord;
  payload: RawRecord & { education_workspace: RawRecord };
  roots?: { runtime: ResolvedEduPiCore; dataRoot: ResolvedEduPiDataRoot };
};

type DeleteCoreResponse = {
  ok?: boolean;
  operation?: string;
  request_id?: string;
  code?: string;
  target?: { kind?: string; id?: string };
  external_send?: boolean;
  deleted_at?: string;
  snapshot?: RawRecord & { education_workspace?: RawRecord };
};

export class EntityDeleteError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "EntityDeleteError";
  }
}

function validText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
}

function isDeleteKind(value: unknown): value is EntityDeleteKind {
  return typeof value === "string" && ENTITY_DELETE_KINDS.includes(value as EntityDeleteKind);
}

export function buildEntityDeleteRequest(input: { kind: EntityDeleteKind | string; id: string; snapshotId: string; note: string | null }, requestId: string) {
  if (!isDeleteKind(input.kind) || !validText(input.id, 160) || !validText(input.snapshotId, 160) || !validText(requestId, 160)
    || (input.note !== null && (!validText(input.note, 1000)))) {
    throw new EntityDeleteError("invalid_request", "删除对象无效。");
  }
  return {
    protocol: "edupi-desktop-bridge",
    protocol_version: 1,
    producer: "edupi-desktop",
    operation: "delete",
    request_id: requestId,
    action: "delete",
    target_kind: input.kind,
    target_id: input.id.trim(),
    snapshot_id: input.snapshotId,
    reviewer: "teacher",
    note: input.note,
  } as const;
}

function itemsFor(workspace: RawRecord, kind: EntityDeleteKind): unknown[] {
  if (kind === "calendar") return Array.isArray(workspace.calendar) ? workspace.calendar : [];
  if (kind === "timetable") return Array.isArray(workspace.timetable) ? workspace.timetable : [];
  if (kind === "student") return Array.isArray(workspace.students) ? workspace.students : [];
  if (kind === "task") return Array.isArray(workspace.tasks) ? workspace.tasks : [];
  const continuity = workspace.continuity && typeof workspace.continuity === "object" && !Array.isArray(workspace.continuity) ? workspace.continuity as RawRecord : {};
  return Array.isArray(continuity.memories) ? continuity.memories : [];
}

function itemId(kind: EntityDeleteKind, value: unknown): string | null {
  const item = value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : {};
  const candidate = kind === "calendar" ? item.event_id
    : kind === "timetable" ? item.slot_id
      : kind === "memory" ? item.memory_id
        : kind === "student" ? item.name
          : item.task_id;
  return typeof candidate === "string" ? candidate : null;
}

function hasTarget(workspace: RawRecord, kind: EntityDeleteKind, id: string): boolean {
  return itemsFor(workspace, kind).some((item) => itemId(kind, item) === id);
}

type EntityDeleteDependencies = {
  readSnapshot?: () => Promise<DeleteSnapshot>;
  callCore?: (request: ReturnType<typeof buildEntityDeleteRequest>, snapshot: DeleteSnapshot, signal?: AbortSignal) => Promise<DeleteCoreResponse>;
};

export async function issueEntityDelete(
  input: { kind: EntityDeleteKind; id: string; note: string | null; signal?: AbortSignal },
  dependencies: EntityDeleteDependencies = {},
): Promise<{ target: { kind: EntityDeleteKind; id: string }; deletedAt: string | null; data: RawRecord & { education_workspace: RawRecord } }> {
  if (!isDeleteKind(input.kind) || !validText(input.id, 160)) throw new EntityDeleteError("invalid_request", "删除对象无效。");
  const readSnapshot = dependencies.readSnapshot || (async () => {
    const { readEduPiEducationSnapshot } = await import("./edupi-core-snapshot.ts");
    const snapshot = await readEduPiEducationSnapshot({ signal: input.signal });
    return { ...snapshot, roots: { runtime: snapshot.runtime, dataRoot: snapshot.dataRoot } } as DeleteSnapshot;
  });
  const snapshot = await readSnapshot();
  const snapshotId = typeof snapshot.envelope?.snapshot_id === "string" ? snapshot.envelope.snapshot_id : null;
  if (!snapshotId) throw new EntityDeleteError("invalid_response", "Core 教育快照无效。");
  const requestId = `entity-delete-${randomUUID()}`;
  const request = buildEntityDeleteRequest({ kind: input.kind, id: input.id, snapshotId, note: input.note }, requestId);
  const callCore = dependencies.callCore || (async (nextRequest, currentSnapshot, signal) => {
    const [{ runCoreProcess }, { resolveEduPiBridgeRoots }] = await Promise.all([
      import("./edupi-core-process-client.ts"),
      import("./edupi-core-snapshot.ts"),
    ]);
    const roots = currentSnapshot.roots || resolveEduPiBridgeRoots();
    return await runCoreProcess<DeleteCoreResponse>({
      runtime: roots.runtime,
      dataRoot: roots.dataRoot,
      request: nextRequest,
      timeoutMs: 15_000,
      signal,
    });
  });
  const response = await callCore(request, snapshot, input.signal);
  if (response.ok !== true) {
    const code = response.code || "unavailable";
    throw new EntityDeleteError(code, code === "stale_snapshot" ? "内容已经更新，请刷新后重试。" : code === "target_not_found" ? "对象不存在或已经删除。" : "删除暂不可用。");
  }
  const refreshed = response.snapshot;
  const refreshedWorkspace = refreshed?.education_workspace;
  if (response.operation !== "delete" || response.request_id !== requestId || response.external_send !== false
    || response.target?.kind !== input.kind || response.target?.id !== input.id
    || !refreshed || !refreshedWorkspace || hasTarget(refreshedWorkspace, input.kind, input.id)) {
    throw new EntityDeleteError("invalid_response", "Core 删除结果无效。");
  }
  return { target: { kind: input.kind, id: input.id }, deletedAt: typeof response.deleted_at === "string" ? response.deleted_at : null, data: refreshed as RawRecord & { education_workspace: RawRecord } };
}
