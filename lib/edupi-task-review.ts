import crypto from "node:crypto";
import { validateCoreEnvelopeSchema, validateReceiptSemantics } from "./edupi-bridge-contract";
import { activeBridgeIdentity } from "./edupi-bridge-manifest";
import { callEduPiCore } from "./edupi-core-process-client";
import { readEduPiEducationSnapshot, type CoreEducationSnapshotPayload, type EduPiBridgeRoots } from "./edupi-core-snapshot";
import { buildEducationContractFromWorkspace, type TeacherTaskStatus } from "./edupi-education-contract";
import { hasCommittedTaskReview, type TaskReviewRefreshRequirement } from "./edupi-task-refresh";

type RawRecord = Record<string, unknown>;

export const TASK_REVIEW_DECISIONS = ["accept", "modify", "reject", "hold", "rollback"] as const;
export type TaskReviewDecision = typeof TASK_REVIEW_DECISIONS[number];
export type TaskReviewPatch = { title?: string; dueDate?: string | null; deliverables?: string[] };
export type TaskReviewInput = {
  taskId: string;
  expectedRevision?: number;
  decision: TaskReviewDecision;
  patch?: TaskReviewPatch | null;
  note?: string | null;
  reviewerId?: string | null;
  issuedAt?: string;
};
export type TaskReviewErrorCode = "invalid_envelope" | "invalid_recurrence" | "unsupported_command" | "stale_snapshot" | "stale_revision" | "task_missing" | "task_owned_by_work_review" | "unavailable";

export class TaskReviewError extends Error {
  constructor(public readonly code: TaskReviewErrorCode, message: string) {
    super(message);
    this.name = "TaskReviewError";
  }
}

type SnapshotResult = { payload: CoreEducationSnapshotPayload; roots: EduPiBridgeRoots };
export type TaskReviewDependencies = {
  supportedCommands?: readonly string[];
  readSnapshot?: () => Promise<SnapshotResult>;
  dispatch?: (envelope: RawRecord, roots: EduPiBridgeRoots) => Promise<unknown> | unknown;
  refreshSnapshot?: (roots: EduPiBridgeRoots) => Promise<CoreEducationSnapshotPayload> | CoreEducationSnapshotPayload;
};

function record(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
}

function requiredText(value: unknown, field: string, maxLength = 160): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TaskReviewError("invalid_envelope", `${field} 无效。`);
  }
  return value.trim();
}

function exactList(actual: unknown, expected: readonly string[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  const source = value as RawRecord;
  return Object.fromEntries(Object.keys(source).sort().map((key) => [key, canonicalize(source[key])]));
}

function sameRecord(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function dateOnly(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TaskReviewError("invalid_envelope", `${field} 无效。`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new TaskReviewError("invalid_envelope", `${field} 无效。`);
  return value;
}

function taskFromPayload(payload: RawRecord, taskId: string): RawRecord {
  const workspace = record(payload.education_workspace);
  const matches = (Array.isArray(workspace?.tasks) ? workspace.tasks : []).map(record).filter((task): task is RawRecord => task?.task_id === taskId);
  if (matches.length === 0) throw new TaskReviewError("task_missing", "任务不存在。");
  if (matches.length !== 1) throw new TaskReviewError("invalid_envelope", "任务投影重复。");
  const task = matches[0];
  if (task.scope !== "teacher_internal" || task.external_send !== false || task.requires_teacher_review !== true) {
    throw new TaskReviewError("invalid_envelope", "任务不满足教师内部审核边界。");
  }
  return task;
}

function taskStatus(value: unknown): TeacherTaskStatus {
  if (value === "planned" || value === "accepted" || value === "modified" || value === "rejected" || value === "hold") return value;
  throw new TaskReviewError("invalid_envelope", "任务审核状态无效。");
}

function evidenceForTask(task: RawRecord): string[] {
  const evidence = record(task.evidence);
  const values = [evidence?.source_entry_id, task.source_event_id]
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .map((value) => requiredText(value, "evidenceId"));
  const result = [...new Set(values)];
  if (result.length === 0) throw new TaskReviewError("unavailable", "任务缺少可绑定的来源证据。");
  return result;
}

function reviewHistory(task: RawRecord): RawRecord[] {
  if (!Array.isArray(task.review_history)) return [];
  const history = task.review_history.map(record).filter((entry): entry is RawRecord => entry !== null);
  if (history.length !== task.review_history.length) throw new TaskReviewError("invalid_envelope", "任务审核历史无效。");
  return history;
}

function isCapabilityTask(task: RawRecord): boolean {
  return /^capability_task_[a-f0-9]{32}$/.test(String(task.task_id))
    && task.trigger === "capability_package" && record(task.evidence)?.material_kind === "capability_package";
}

function normalizePatch(value: unknown, decision: TaskReviewDecision): RawRecord | null {
  if (decision !== "modify") {
    if (value !== undefined && value !== null) throw new TaskReviewError("invalid_envelope", `${decision} 不接受修改字段。`);
    return null;
  }
  const patch = record(value);
  if (!patch) throw new TaskReviewError("invalid_envelope", "修改后接受必须提供 patch。");
  const keys = Object.keys(patch);
  if (keys.length === 0 || keys.some((key) => !["title", "dueDate", "deliverables"].includes(key))) throw new TaskReviewError("invalid_envelope", "任务修改字段无效。");
  const result: RawRecord = {};
  if (Object.hasOwn(patch, "title")) result.title = requiredText(patch.title, "title", 240);
  if (Object.hasOwn(patch, "dueDate")) result.due_date = dateOnly(patch.dueDate, "dueDate");
  if (Object.hasOwn(patch, "deliverables")) {
    if (!Array.isArray(patch.deliverables) || patch.deliverables.length > 50) throw new TaskReviewError("invalid_envelope", "deliverables 无效。");
    result.deliverables = patch.deliverables.map((item) => requiredText(item, "deliverable", 240));
  }
  return result;
}

function note(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 1000) throw new TaskReviewError("invalid_envelope", "note 无效。");
  return value.trim() || null;
}

function semanticIdempotencyKey(value: unknown): string {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("base64url")}`;
}

export function buildTaskReviewCommandEnvelope(input: TaskReviewInput & { payload: unknown }): RawRecord {
  const payload = record(input.payload);
  if (!payload) throw new TaskReviewError("unavailable", "Core 教育快照不可用。");
  const taskId = requiredText(input.taskId, "taskId");
  if (!TASK_REVIEW_DECISIONS.includes(input.decision)) throw new TaskReviewError("invalid_envelope", "审核决策无效。");
  const snapshotId = requiredText(payload.snapshot_id, "snapshotId");
  const stateHash = requiredText(payload.state_hash, "stateHash");
  if (!/^sha256:[A-Za-z0-9_-]+$/.test(stateHash)) throw new TaskReviewError("unavailable", "Core 教育快照来源哈希不可用。");
  const task = taskFromPayload(payload, taskId);
  if (input.decision === "rollback" && isCapabilityTask(task)) throw new TaskReviewError("invalid_envelope", "当前任务不支持回滚。");
  const revision = task.revision;
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0) throw new TaskReviewError("invalid_envelope", "任务审核版本无效。");
  if (input.expectedRevision !== undefined) {
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) throw new TaskReviewError("invalid_envelope", "expectedRevision 无效。");
    if (input.expectedRevision !== revision) throw new TaskReviewError("stale_revision", "任务已更新，请刷新后重试。");
  }
  const evidenceIds = evidenceForTask(task);
  const history = reviewHistory(task);
  const latestReviewId = history.length ? requiredText(history.at(-1)?.review_id, "rollbackId") : null;
  if (input.decision === "rollback" && !latestReviewId) throw new TaskReviewError("invalid_envelope", "当前任务没有可回滚的审核记录。");
  const patch = normalizePatch(input.patch, input.decision);
  const reviewNote = note(input.note);
  const reviewerId = input.reviewerId === undefined || input.reviewerId === null ? "teacher" : requiredText(input.reviewerId, "reviewerId");
  const issuedAt = input.issuedAt === undefined ? new Date().toISOString() : requiredText(input.issuedAt, "issuedAt", 64);
  const source = { source_id: taskId, source_kind: "core_task", source_hash: stateHash, evidence_ids: evidenceIds };
  const provenance = [{
    source_kind: "core_task",
    source_id: taskId,
    source_path: null,
    source_hash: stateHash,
    observed_at: issuedAt,
    actor: "core",
    evidence_ids: evidenceIds,
    parent_ids: [],
  }];
  const command = {
    command_type: "review_task",
    task_id: taskId,
    expected_revision: revision,
    decision: input.decision,
    patch,
    rollback_id: input.decision === "rollback" ? latestReviewId : null,
    source,
    note: reviewNote,
  };
  const identity = activeBridgeIdentity();
  const semantic = { snapshot_id: snapshotId, state_hash: stateHash, command, reviewer_id: reviewerId };
  const envelope = {
    contract_version: identity.contract.contract_version,
    message_id: `desktop-task-review-message-${crypto.randomUUID()}`,
    request_id: `desktop-task-review-request-${crypto.randomUUID()}`,
    issued_at: issuedAt,
    producer: "edupi-desktop",
    schema_hash: identity.contract.schema_hash,
    snapshot_id: snapshotId,
    idempotency_key: semanticIdempotencyKey(semantic),
    provenance,
    teacher_review: { state: "pending_review", reviewer_id: reviewerId, reviewed_at: null, note: reviewNote, revision },
    external_send: false,
    command,
  };
  if (!validateCoreEnvelopeSchema(envelope)) throw new TaskReviewError("invalid_envelope", "任务审核命令无效。");
  return envelope;
}

async function productionSnapshot(): Promise<SnapshotResult> {
  const snapshot = await readEduPiEducationSnapshot();
  return { payload: snapshot.payload, roots: { runtime: snapshot.runtime, dataRoot: snapshot.dataRoot } };
}

const expectedStatus: Record<TaskReviewDecision, string> = { accept: "accepted", modify: "modified", reject: "rejected", hold: "held", rollback: "modified" };

function receiptForCommand(value: unknown, envelope: RawRecord, supportedCommands: readonly string[], beforeTask: RawRecord): RawRecord {
  const response = record(value);
  const identity = activeBridgeIdentity();
  if (!response || response.ok !== true || response.operation !== "command" || response.request_id !== envelope.request_id
    || !exactList(response.supported_commands, supportedCommands)
    || !exactList(response.supported_projections, identity.contract.supported_projections)) {
    throw new TaskReviewError("unavailable", "Core 任务审核回执不可用。");
  }
  const receiptEnvelope = record(response.receipt);
  const receipt = record(receiptEnvelope?.payload);
  const command = record(envelope.command);
  if (!receiptEnvelope || !receipt || !command || !validateCoreEnvelopeSchema(receiptEnvelope) || !validateReceiptSemantics(receipt).ok
    || receiptEnvelope.producer !== "edupi-core" || receiptEnvelope.schema_hash !== identity.contract.schema_hash
    || receiptEnvelope.external_send !== false || receiptEnvelope.request_id !== envelope.request_id
    || receiptEnvelope.issued_at !== envelope.issued_at || receiptEnvelope.message_id !== receipt.receipt_id
    || receipt.command_id !== envelope.message_id || receipt.request_id !== envelope.request_id
    || receipt.command_type !== "review_task" || receipt.receipt_phase !== "review"
    || !sameRecord(receipt.target, { target_kind: "task", target_id: command.task_id, command_type: "review_task" })
    || receipt.decision !== command.decision || receipt.before_snapshot_id !== envelope.snapshot_id
    || receipt.external_send !== false
    || receipt.created_at !== envelope.issued_at || !sameRecord(receiptEnvelope.provenance, envelope.provenance)
    || !sameRecord(receiptEnvelope.teacher_review, receipt.teacher_review)
    || !exactList(receipt.evidence_ids, Array.isArray(record(command.source)?.evidence_ids) ? record(command.source)?.evidence_ids as string[] : [])) {
    throw new TaskReviewError("invalid_envelope", "Core 任务审核回执绑定无效。");
  }
  const status = String(receipt.status || "");
  if (status === "stale_snapshot" || receipt.reason_code === "stale_snapshot") {
    if (status !== "stale_snapshot" || receipt.reason_code !== "stale_snapshot"
      || !exactList(receipt.applied_ids, []) || !exactList(receipt.rejected_ids, [])
      || receipt.after_snapshot_id !== null || receipt.after_state_hash !== null
      || receiptEnvelope.snapshot_id !== envelope.snapshot_id
      || !sameRecord(receipt.rollback, { available: false, rollback_id: null, expires_at: null })) {
      throw new TaskReviewError("invalid_envelope", "Core 过期快照回执无效。");
    }
    throw new TaskReviewError("stale_snapshot", "任务数据已更新，请刷新后重试。");
  }
  if (receipt.before_state_hash !== record(command.source)?.source_hash) {
    throw new TaskReviewError("invalid_envelope", "Core 任务审核回执来源哈希无效。");
  }
  if (status === "failed") {
    const reason = String(receipt.reason_code || "");
    if (reason === "stale_revision") throw new TaskReviewError("stale_revision", "任务审核版本已更新，请刷新后重试。");
    if (reason === "task_missing") throw new TaskReviewError("task_missing", "任务不存在。");
    if (reason === "task_owned_by_work_review") throw new TaskReviewError("task_owned_by_work_review", "该任务由 Today 待办审核管理。");
    if (reason === "invalid_recurrence") throw new TaskReviewError("invalid_recurrence", "周期任务日期或产物不符合约束，请重新检查。");
    if (reason === "unsupported_command") throw new TaskReviewError("unsupported_command", "Core 尚未启用任务审核。");
    if (["provenance_mismatch", "source_mismatch", "invalid_patch", "invalid_rollback"].includes(reason)) throw new TaskReviewError("invalid_envelope", "Core 拒绝了任务审核绑定。");
    throw new TaskReviewError("unavailable", "Core 未执行任务审核。");
  }
  const decision = command.decision as TaskReviewDecision;
  const taskId = String(command.task_id);
  if (status !== expectedStatus[decision] || receipt.reason_code !== null
    || !exactList(receipt.applied_ids, decision === "reject" ? [] : [taskId])
    || !exactList(receipt.rejected_ids, decision === "reject" ? [taskId] : [])
    || typeof receipt.after_snapshot_id !== "string" || typeof receipt.after_state_hash !== "string"
    || receiptEnvelope.snapshot_id !== receipt.after_snapshot_id) {
    throw new TaskReviewError("invalid_envelope", "Core 任务审核成功回执无效。");
  }
  const review = record(receipt.teacher_review);
  const requestReview = record(envelope.teacher_review);
  const allowedReviewStates = decision === "rollback" ? ["pending_review", "accepted", "modified", "rejected", "held"] : [status === "held" ? "held" : status];
  if (!review || !requestReview || review.revision !== Number(command.expected_revision) + 1
    || review.reviewer_id !== requestReview.reviewer_id || review.reviewed_at !== envelope.issued_at
    || review.note !== command.note || !allowedReviewStates.includes(String(review.state))) {
    throw new TaskReviewError("invalid_envelope", "Core 任务审核状态绑定无效。");
  }
  const rollback = record(receipt.rollback);
  if (!rollback || (isCapabilityTask(beforeTask)
    ? decision === "rollback" || !sameRecord(rollback, { available: false, rollback_id: null, expires_at: null })
    : decision === "rollback"
    ? rollback.available !== false || rollback.rollback_id !== null
    : rollback.available !== true || typeof rollback.rollback_id !== "string" || !rollback.rollback_id)) {
    throw new TaskReviewError("invalid_envelope", "Core 任务审核回滚绑定无效。");
  }
  return receipt;
}

function verifyRefreshedTask(payload: CoreEducationSnapshotPayload, beforeTask: RawRecord, envelope: RawRecord, requirement: TaskReviewRefreshRequirement): RawRecord | null {
  const command = record(envelope.command);
  if (!command) throw new TaskReviewError("invalid_envelope", "任务审核命令不可用。");
  let task: RawRecord;
  try { task = taskFromPayload(payload as unknown as RawRecord, String(command.task_id)); }
  catch (error) {
    if (error instanceof TaskReviewError && error.code === "task_missing") return null;
    throw error;
  }
  if (task.source_event_id !== beforeTask.source_event_id || task.trigger !== beforeTask.trigger
    || record(task.evidence)?.source_entry_id !== record(beforeTask.evidence)?.source_entry_id
    || record(task.evidence)?.material_kind !== record(beforeTask.evidence)?.material_kind) {
    throw new TaskReviewError("invalid_envelope", "Core 刷新后的任务来源不一致。");
  }
  const expectedRevision = Number(command.expected_revision) + 1;
  if (Number.isInteger(task.revision) && Number(task.revision) >= 0 && Number(task.revision) < expectedRevision) return null;
  const workspace = record(payload.education_workspace);
  const contract = buildEducationContractFromWorkspace(workspace ?? {}, { workspacePath: "", snapshotPayload: payload as RawRecord });
  if (!hasCommittedTaskReview(contract, requirement)) throw new TaskReviewError("invalid_envelope", "Core 刷新后的任务审核历史无效。");
  return task;
}

export async function issueTaskReview(input: TaskReviewInput, dependencies: TaskReviewDependencies = {}): Promise<{ receipt: RawRecord; data: CoreEducationSnapshotPayload | null; task: RawRecord | null; refreshPending: boolean; refreshRequirement: TaskReviewRefreshRequirement }> {
  const supportedCommands = dependencies.supportedCommands || activeBridgeIdentity().contract.supported_commands;
  if (!supportedCommands.includes("review_task")) throw new TaskReviewError("unsupported_command", "Core 尚未启用任务审核。");
  const initial = await (dependencies.readSnapshot || productionSnapshot)();
  const payload = initial.payload as unknown as RawRecord;
  const snapshotCommands = record(payload.capabilities)?.supported_commands;
  if (!exactList(snapshotCommands, supportedCommands) || !supportedCommands.includes("review_task")) throw new TaskReviewError("unsupported_command", "Core 快照尚未启用任务审核。");
  const beforeTask = taskFromPayload(payload, requiredText(input.taskId, "taskId"));
  const beforeStatus = taskStatus(beforeTask.status);
  const envelope = buildTaskReviewCommandEnvelope({ ...input, payload });
  const dispatch = dependencies.dispatch || ((nextEnvelope, roots) => callEduPiCore({ operation: "command", requestId: String(nextEnvelope.request_id), runtime: roots.runtime, dataRoot: roots.dataRoot, envelope: nextEnvelope }));
  let rawResponse: unknown;
  try {
    rawResponse = await dispatch(envelope, initial.roots);
  } catch (error) {
    if (error instanceof TaskReviewError) throw error;
    throw new TaskReviewError("unavailable", "Core 任务审核暂不可用。");
  }
  const receipt = receiptForCommand(rawResponse, envelope, supportedCommands, beforeTask);
  const patch = record(record(envelope.command)?.patch);
  const refreshRequirement: TaskReviewRefreshRequirement = {
    before: {
      id: String(beforeTask.task_id),
      trigger: typeof beforeTask.trigger === "string" ? beforeTask.trigger : null,
      sourceEventId: typeof beforeTask.source_event_id === "string" ? beforeTask.source_event_id : null,
      evidence: record(beforeTask.evidence) ?? {},
      reviewHistory: reviewHistory(beforeTask),
      revision: Number(beforeTask.revision),
      status: beforeStatus,
      title: String(beforeTask.title),
      dueDate: typeof beforeTask.due_date === "string" ? beforeTask.due_date : null,
      deliverables: Array.isArray(beforeTask.deliverables) ? beforeTask.deliverables as string[] : [],
      reviewedAt: typeof beforeTask.reviewed_at === "string" ? beforeTask.reviewed_at : null,
      reviewer: typeof beforeTask.reviewer === "string" ? beforeTask.reviewer : null,
      reviewNote: typeof beforeTask.review_note === "string" ? beforeTask.review_note : null,
    },
    decision: input.decision,
    receipt,
    patch: patch ? {
      ...(Object.hasOwn(patch, "title") ? { title: patch.title as string } : {}),
      ...(Object.hasOwn(patch, "due_date") ? { dueDate: patch.due_date as string | null } : {}),
      ...(Object.hasOwn(patch, "deliverables") ? { deliverables: patch.deliverables as string[] } : {}),
    } : null,
  };
  const refresh = dependencies.refreshSnapshot || (async (roots) => (await readEduPiEducationSnapshot({ roots })).payload);
  let data: CoreEducationSnapshotPayload;
  try { data = await refresh(initial.roots); }
  catch { return { receipt, data: null, task: null, refreshPending: true, refreshRequirement }; }
  const task = verifyRefreshedTask(data, beforeTask, envelope, refreshRequirement);
  if (!task) return { receipt, data: null, task: null, refreshPending: true, refreshRequirement };
  return { receipt, data, task, refreshPending: false, refreshRequirement };
}
