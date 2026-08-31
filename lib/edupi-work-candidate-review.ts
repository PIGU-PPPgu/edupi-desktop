import crypto from "node:crypto";
import { callEduPiCore } from "./edupi-core-process-client";
import {
  validateCommand,
  validateCoreEnvelopeSchema,
  validateReceiptSemantics,
  validateSnapshotSemantics,
} from "./edupi-bridge-contract";
import { activeBridgeIdentity } from "./edupi-bridge-manifest";
import { readEduPiEducationSnapshot, resolveEduPiBridgeRoots, type EduPiBridgeRoots } from "./edupi-core-snapshot";

export const WORK_CANDIDATE_REVIEW_COMMANDS = ["review_work_candidate"] as const;
export const WORK_CANDIDATE_REVIEW_DECISIONS = ["accept", "modify", "reject", "hold", "snooze", "suppress"] as const;
const WORK_CANDIDATE_STATUSES = ["pending_review", "accepted", "modified", "rejected", "held", "snoozed", "suppressed"] as const;
const WORK_CANDIDATE_NEXT_CYCLE_STATES = [
  "awaiting_teacher", "closed_accepted", "closed_modified", "closed_rejected", "held", "snoozed",
  "suppressed_this_candidate", "suppressed_matching_reason", "suppressed_next_cycle", "reopened_source_changed", "reopened_snooze_expired",
] as const;
const WORK_CANDIDATE_SUPPRESSION_SCOPES = ["this_candidate", "matching_reason", "next_cycle"] as const;
const WORK_REVIEW_STATUS: Record<WorkCandidateReviewDecision, string> = {
  accept: "accepted",
  modify: "modified",
  reject: "rejected",
  hold: "held",
  snooze: "held",
  suppress: "rejected",
};
const WORK_TARGET_STATUS: Record<WorkCandidateReviewDecision, WorkCandidateStatus> = {
  accept: "accepted",
  modify: "modified",
  reject: "rejected",
  hold: "held",
  snooze: "snoozed",
  suppress: "suppressed",
};
const WORK_TASK_STATUS: Record<WorkCandidateStatus, string> = {
  pending_review: "planned",
  accepted: "accepted",
  modified: "modified",
  rejected: "rejected",
  held: "hold",
  snoozed: "hold",
  suppressed: "rejected",
};
const WORK_REVIEW_STATE: Record<WorkCandidateStatus, string> = {
  pending_review: "pending_review",
  accepted: "accepted",
  modified: "modified",
  rejected: "rejected",
  held: "held",
  snoozed: "held",
  suppressed: "rejected",
};

export type WorkCandidateReviewDecision = typeof WORK_CANDIDATE_REVIEW_DECISIONS[number];
export type WorkCandidateStatus = typeof WORK_CANDIDATE_STATUSES[number];
export type WorkCandidateSuppressionScope = typeof WORK_CANDIDATE_SUPPRESSION_SCOPES[number];
export type WorkCandidateReviewPatch = {
  title?: string;
  summary?: string;
  dueAt?: string | null;
  snoozeUntil?: string;
  suppressionScope?: WorkCandidateSuppressionScope;
};
export type WorkCandidateReviewInput = {
  snapshot: unknown;
  targetId: string;
  expectedSnapshotId: string;
  expectedRevision: number;
  decision: WorkCandidateReviewDecision;
  patch?: WorkCandidateReviewPatch | Record<string, unknown> | null;
  note?: string | null;
  reviewerId?: string | null;
  reviewer?: string | null;
  issuedAt?: string;
};
export type WorkCandidateReviewCommandEnvelope = Record<string, unknown> & {
  contract_version: "1.1";
  producer: "edupi-desktop";
  external_send: false;
  snapshot_id: string;
  idempotency_key: string;
  command: Record<string, unknown> & { command_type: "review_work_candidate" };
};
export type WorkCandidateReviewErrorCode = "invalid_envelope" | "unsupported_command" | "stale_snapshot" | "stale_revision" | "unavailable";

export class WorkCandidateReviewError extends Error {
  constructor(public readonly code: WorkCandidateReviewErrorCode, message: string) {
    super(message);
    this.name = "WorkCandidateReviewError";
  }
}

export type WorkCandidateReviewDependencies = {
  supportedCommands?: readonly string[];
  dispatch?: (envelope: WorkCandidateReviewCommandEnvelope) => Promise<unknown> | unknown;
  refreshSnapshot?: () => Promise<unknown> | unknown;
};

type RawRecord = Record<string, unknown>;
type WorkCandidateContext = {
  target: RawRecord;
  targetId: string;
  revision: number;
  title: string;
  summary: string;
  status: WorkCandidateStatus;
  dueAt: string | null;
  snoozeUntil: string | null;
  suppressionScope: WorkCandidateSuppressionScope | null;
  nextCycleState: string;
  teacherReview: RawRecord;
  sourceIds: string[];
  evidenceIds: string[];
  task: RawRecord;
};

function record(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) throw new WorkCandidateReviewError("invalid_envelope", `${field} is invalid`);
  return value.trim();
}

function optionalNote(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requiredText(value, "note", 1000);
}

function finiteRevision(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new WorkCandidateReviewError("invalid_envelope", `${field} is invalid`);
  return value;
}

function exactList(actual: unknown, expected: readonly string[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function boundedList(value: unknown, field: string, { allowEmpty = false, maxItems = 50, maxLength = 160 } = {}): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > maxItems) throw new WorkCandidateReviewError("invalid_envelope", `${field} is invalid`);
  const result = value.map((item) => requiredText(item, `${field} item`, maxLength));
  if (new Set(result).size !== result.length) throw new WorkCandidateReviewError("invalid_envelope", `${field} contains duplicates`);
  return result;
}

function exactKeys(value: RawRecord, allowed: readonly string[]): void {
  const actual = Object.keys(value).sort();
  if (actual.some((key) => !allowed.includes(key))) throw new WorkCandidateReviewError("invalid_envelope", "work review input contains unsupported fields");
}

function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function dateOnly(value: unknown, field: string, { nullable = true } = {}): string | null {
  if (value === null || value === undefined) {
    if (nullable) return null;
    throw new WorkCandidateReviewError("invalid_envelope", `${field} is invalid`);
  }
  if (!isDateOnly(value)) throw new WorkCandidateReviewError("invalid_envelope", `${field} is invalid`);
  return value;
}

function snapshotParts(value: unknown): { envelope: RawRecord; payload: RawRecord } {
  const envelope = record(value);
  const payload = record(envelope?.payload);
  if (!envelope || !payload || !validateCoreEnvelopeSchema(envelope)) throw new WorkCandidateReviewError("invalid_envelope", "Core education snapshot envelope is invalid");
  const identity = activeBridgeIdentity();
  if (envelope.contract_version !== identity.contract.contract_version
    || envelope.schema_hash !== identity.contract.schema_hash
    || envelope.producer !== "edupi-core"
    || envelope.external_send !== false
    || typeof envelope.snapshot_id !== "string"
    || envelope.snapshot_id !== payload.snapshot_id
    || typeof payload.state_hash !== "string"
    || !exactList(record(payload.capabilities)?.supported_commands, identity.contract.supported_commands)
    || !exactList(record(payload.capabilities)?.supported_projections, identity.contract.supported_projections)
    || !validateSnapshotSemantics(payload, { supportedCommands: identity.contract.supported_commands, supportedProjections: identity.contract.supported_projections }).ok) {
    throw new WorkCandidateReviewError("invalid_envelope", "Core education snapshot identity or capability is invalid");
  }
  return { envelope, payload };
}

function workCandidateContext(payload: RawRecord, targetId: string): WorkCandidateContext {
  const targets = Array.isArray(payload.review_targets) ? payload.review_targets : [];
  const matches = targets.filter((value) => {
    const projection = record(value);
    const target = record(projection?.target);
    return projection?.projection_kind === "work_candidate"
      && target?.target_kind === "work_candidate"
      && target.command_type === "review_work_candidate"
      && target.target_id === targetId;
  });
  if (matches.length !== 1) throw new WorkCandidateReviewError("invalid_envelope", "Core work-candidate target was not found or is ambiguous");
  const projection = record(matches[0]);
  const target = record(projection?.target);
  if (!projection || !target) throw new WorkCandidateReviewError("invalid_envelope", "Core work-candidate target is malformed");
  const sourceIds = boundedList(projection.source_ids, "target.source_ids");
  const evidenceIds = boundedList(projection.evidence_ids, "target.evidence_ids");
  if (sourceIds.length !== 1 || sourceIds[0] !== targetId) throw new WorkCandidateReviewError("invalid_envelope", "Core work-candidate source binding is invalid");
  const title = requiredText(projection.title, "target.title", 240);
  const summary = requiredText(projection.summary, "target.summary", 2000);
  const reason = requiredText(projection.reason, "target.reason", 1000);
  void reason;
  const revision = finiteRevision(projection.revision, "target.revision");
  const status = projection.status;
  if (!(WORK_CANDIDATE_STATUSES as readonly unknown[]).includes(status)) throw new WorkCandidateReviewError("invalid_envelope", "target.status is invalid");
  const teacherReview = record(projection.teacher_review);
  if (!teacherReview || teacherReview.revision !== revision) throw new WorkCandidateReviewError("invalid_envelope", "target.teacher_review is invalid");
  const snoozeUntil = dateOnly(projection.snooze_until, "target.snooze_until");
  const suppressionScope = projection.suppression_scope === null ? null : requiredText(projection.suppression_scope, "target.suppression_scope", 40);
  if (suppressionScope !== null && !(WORK_CANDIDATE_SUPPRESSION_SCOPES as readonly string[]).includes(suppressionScope)) throw new WorkCandidateReviewError("invalid_envelope", "target.suppression_scope is invalid");
  if (!WORK_CANDIDATE_NEXT_CYCLE_STATES.includes(String(projection.next_cycle_state) as typeof WORK_CANDIDATE_NEXT_CYCLE_STATES[number])) throw new WorkCandidateReviewError("invalid_envelope", "target.next_cycle_state is invalid");
  if (status === "snoozed" && snoozeUntil === null) throw new WorkCandidateReviewError("invalid_envelope", "snoozed target has no snooze date");
  if (status !== "snoozed" && snoozeUntil !== null) throw new WorkCandidateReviewError("invalid_envelope", "non-snoozed target has a snooze date");
  if (status === "suppressed" && suppressionScope === null) throw new WorkCandidateReviewError("invalid_envelope", "suppressed target has no suppression scope");
  if (status !== "suppressed" && suppressionScope !== null) throw new WorkCandidateReviewError("invalid_envelope", "non-suppressed target has a suppression scope");
  if (projection.external_send !== false) throw new WorkCandidateReviewError("invalid_envelope", "target.external_send is invalid");
  const workspace = record(payload.education_workspace);
  const tasks = Array.isArray(workspace?.tasks) ? workspace.tasks.map((value) => record(value)).filter((value): value is RawRecord => value !== null) : [];
  const joined = tasks.filter((task) => task.task_id === targetId);
  if (joined.length !== 1) throw new WorkCandidateReviewError("invalid_envelope", "Core work-candidate task join is missing or ambiguous");
  const task = joined[0];
  const taskStatus = WORK_TASK_STATUS[status as WorkCandidateStatus];
  const taskDueAt = dateOnly(task.due_date, "task.due_date");
  if (status === "pending_review" && taskDueAt === null) throw new WorkCandidateReviewError("invalid_envelope", "pending work candidate has no due date");
  const systemHeldPending = status === "held"
    && teacherReview.state === "pending_review"
    && taskDueAt === null
    && teacherReview.reviewer_id === null
    && teacherReview.reviewed_at === null
    && teacherReview.note === null;
  if (teacherReview.state !== WORK_REVIEW_STATE[status as WorkCandidateStatus] && !systemHeldPending) throw new WorkCandidateReviewError("invalid_envelope", "target.teacher_review is invalid");
  if (task.title !== title || task.status !== taskStatus || task.revision !== revision
    || task.reviewed_at !== (teacherReview.reviewed_at ?? null)
    || task.reviewer !== (teacherReview.reviewer_id ?? null)
    || task.review_note !== (teacherReview.note ?? null)
    || task.external_send !== false
    || task.requires_teacher_review !== true
    || task.scope !== "teacher_internal") throw new WorkCandidateReviewError("invalid_envelope", "Core work-candidate task join is inconsistent");
  return {
    target: projection,
    targetId,
    revision,
    title,
    summary,
    status: status as WorkCandidateStatus,
    dueAt: taskDueAt,
    snoozeUntil,
    suppressionScope: suppressionScope as WorkCandidateSuppressionScope | null,
    nextCycleState: String(projection.next_cycle_state),
    teacherReview,
    sourceIds,
    evidenceIds,
    task,
  };
}

function activeSourceFromSnapshot(envelope: RawRecord, context: WorkCandidateContext): RawRecord {
  const entries = (Array.isArray(envelope.provenance) ? envelope.provenance : [])
    .map((value) => record(value))
    .filter((value): value is RawRecord => value !== null)
    .filter((value) => value.source_kind === "core_task" && value.source_id === context.targetId);
  if (entries.length !== 1) throw new WorkCandidateReviewError("invalid_envelope", "Active work provenance is missing or ambiguous");
  const source = entries[0];
  const sourceId = requiredText(source.source_id, "source.source_id", 160);
  const sourceHash = source.source_hash === null ? null : requiredText(source.source_hash, "source.source_hash", 160);
  if (sourceHash !== null && !/^sha256:[A-Za-z0-9_-]+$/.test(sourceHash)) throw new WorkCandidateReviewError("invalid_envelope", "source.source_hash is invalid");
  if (source.source_kind !== "core_task" || source.source_path !== null || source.actor !== "core") throw new WorkCandidateReviewError("invalid_envelope", "source identity is invalid");
  const evidenceIds = boundedList(source.evidence_ids, "source.evidence_ids");
  if (!exactList(evidenceIds, context.evidenceIds)) throw new WorkCandidateReviewError("invalid_envelope", "source evidence does not match target");
  const parentIds = boundedList(source.parent_ids, "source.parent_ids", { allowEmpty: true });
  return {
    source_kind: "core_task",
    source_id: sourceId,
    source_path: null,
    source_hash: sourceHash,
    observed_at: requiredText(source.observed_at, "source.observed_at", 64),
    actor: "core",
    evidence_ids: evidenceIds,
    parent_ids: parentIds,
  };
}

function normalizePatch(value: unknown, decision: WorkCandidateReviewDecision, current: WorkCandidateContext, issuedAt: string): RawRecord | null {
  if (value === undefined || value === null) {
    if (decision === "modify" || decision === "snooze" || decision === "suppress") throw new WorkCandidateReviewError("invalid_envelope", `${decision} requires a patch`);
    return null;
  }
  const patch = record(value);
  if (!patch) throw new WorkCandidateReviewError("invalid_envelope", "patch is invalid");
  const rawKeys = Object.keys(patch);
  const allowed = decision === "modify" ? ["title", "summary", "dueAt"] : decision === "snooze" ? ["snoozeUntil"] : decision === "suppress" ? ["suppressionScope"] : [];
  if (rawKeys.length === 0 || rawKeys.some((key) => !allowed.includes(key))) throw new WorkCandidateReviewError("invalid_envelope", "patch contains unsupported fields");
  const normalized: RawRecord = {};
  if (decision === "modify") {
    if (patch.title !== undefined) normalized.title = requiredText(patch.title, "patch.title", 240);
    if (patch.summary !== undefined) normalized.summary = requiredText(patch.summary, "patch.summary", 2000);
    if (patch.dueAt !== undefined) normalized.due_at = dateOnly(patch.dueAt, "patch.dueAt");
    if (Object.keys(normalized).length === 0) throw new WorkCandidateReviewError("invalid_envelope", "modify requires a nonempty patch");
    const changed = (normalized.title !== undefined && normalized.title !== current.title)
      || (normalized.summary !== undefined && normalized.summary !== current.summary)
      || (normalized.due_at !== undefined && normalized.due_at !== current.dueAt);
    if (!changed) throw new WorkCandidateReviewError("invalid_envelope", "modify patch does not change the candidate");
  } else if (decision === "snooze") {
    const snoozeUntil = dateOnly(patch.snoozeUntil, "patch.snoozeUntil", { nullable: false });
    const issuedDate = issuedAt.slice(0, 10);
    if (!snoozeUntil || !isDateOnly(issuedDate) || snoozeUntil <= issuedDate) throw new WorkCandidateReviewError("invalid_envelope", "snoozeUntil must be after issuedAt");
    normalized.snooze_until = snoozeUntil;
  } else if (decision === "suppress") {
    const scope = requiredText(patch.suppressionScope, "patch.suppressionScope", 40);
    if (!(WORK_CANDIDATE_SUPPRESSION_SCOPES as readonly string[]).includes(scope)) throw new WorkCandidateReviewError("invalid_envelope", "suppressionScope is invalid");
    normalized.suppression_scope = scope;
  } else {
    throw new WorkCandidateReviewError("invalid_envelope", `${decision} does not accept a patch`);
  }
  return normalized;
}

function semanticIdempotencyKey({ snapshotId, stateHash, targetId, revision, decision, patch, note, reviewerId }: {
  snapshotId: string; stateHash: string; targetId: string; revision: number; decision: WorkCandidateReviewDecision; patch: RawRecord | null; note: string | null; reviewerId: string;
}): string {
  const semantic = canonicalize({ contract_version: "1.1", snapshot: { snapshot_id: snapshotId, state_hash: stateHash }, command_type: "review_work_candidate", target_id: targetId, expected_revision: revision, decision, patch, note, reviewer_id: reviewerId });
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(semantic)).digest("base64url")}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  const source = value as RawRecord;
  return Object.fromEntries(Object.keys(source).sort().map((key) => [key, canonicalize(source[key])]));
}

function makeTransportId(prefix: string): string {
  return `desktop-${prefix}-${crypto.randomUUID()}`;
}

export function buildWorkCandidateReviewCommandEnvelope(input: WorkCandidateReviewInput): WorkCandidateReviewCommandEnvelope {
  const rawInput = record(input);
  if (!rawInput) throw new WorkCandidateReviewError("invalid_envelope", "work review input is invalid");
  exactKeys(rawInput, ["snapshot", "targetId", "expectedSnapshotId", "expectedRevision", "decision", "patch", "note", "reviewerId", "reviewer", "issuedAt"]);
  if (!WORK_CANDIDATE_REVIEW_DECISIONS.includes(input.decision)) throw new WorkCandidateReviewError("invalid_envelope", "work review decision is unsupported");
  const { envelope: snapshotEnvelope, payload } = snapshotParts(input.snapshot);
  const targetId = requiredText(input.targetId, "targetId", 160);
  const expectedSnapshotId = requiredText(input.expectedSnapshotId, "expectedSnapshotId", 160);
  if (expectedSnapshotId !== payload.snapshot_id) throw new WorkCandidateReviewError("stale_snapshot", "Core education snapshot is stale");
  const expectedRevision = finiteRevision(input.expectedRevision, "expectedRevision");
  const context = workCandidateContext(payload, targetId);
  if (context.revision !== expectedRevision) throw new WorkCandidateReviewError("stale_revision", "Core work-candidate revision is stale");
  const activeSource = activeSourceFromSnapshot(snapshotEnvelope, context);
  const reviewerA = input.reviewerId === undefined || input.reviewerId === null ? null : requiredText(input.reviewerId, "reviewerId", 160);
  const reviewerB = input.reviewer === undefined || input.reviewer === null ? null : requiredText(input.reviewer, "reviewer", 160);
  if (reviewerA && reviewerB && reviewerA !== reviewerB) throw new WorkCandidateReviewError("invalid_envelope", "reviewerId and reviewer disagree");
  const reviewerId = reviewerA || reviewerB || "teacher";
  const note = optionalNote(input.note);
  if (input.decision === "suppress" && !note) throw new WorkCandidateReviewError("invalid_envelope", "suppress requires a note");
  const issuedAt = requiredText(input.issuedAt === undefined ? new Date().toISOString() : input.issuedAt, "issuedAt", 64);
  const patch = normalizePatch(input.patch, input.decision, context, issuedAt);
  if (["accept", "reject", "hold"].includes(input.decision) && input.patch !== undefined && input.patch !== null) throw new WorkCandidateReviewError("invalid_envelope", `${input.decision} does not accept a patch`);
  const snapshotId = requiredText(payload.snapshot_id, "snapshot_id", 160);
  const stateHash = requiredText(payload.state_hash, "state_hash", 160);
  const idempotencyKey = semanticIdempotencyKey({ snapshotId, stateHash, targetId, revision: expectedRevision, decision: input.decision, patch, note, reviewerId });
  const commandSource = {
    source_id: activeSource.source_id,
    source_kind: "core_task" as const,
    source_hash: activeSource.source_hash,
    evidence_ids: activeSource.evidence_ids,
  };
  const commandEnvelope = {
    contract_version: "1.1" as const,
    message_id: makeTransportId("message"),
    request_id: makeTransportId("request"),
    issued_at: issuedAt,
    producer: "edupi-desktop" as const,
    schema_hash: activeBridgeIdentity().contract.schema_hash,
    snapshot_id: snapshotId,
    idempotency_key: idempotencyKey,
    provenance: [clone(activeSource)],
    teacher_review: { state: "pending_review", reviewer_id: reviewerId, reviewed_at: null, note, revision: expectedRevision },
    external_send: false as const,
    command: {
      command_type: "review_work_candidate" as const,
      candidate_id: targetId,
      expected_revision: expectedRevision,
      decision: input.decision,
      patch,
      source: commandSource,
      note,
    },
  };
  const validation = validateCommand(commandEnvelope.command);
  if (!validation.ok || !validateCoreEnvelopeSchema(commandEnvelope)) throw new WorkCandidateReviewError("invalid_envelope", "work review command envelope is invalid");
  return commandEnvelope as unknown as WorkCandidateReviewCommandEnvelope;
}

function errorFromDispatch(value: unknown): WorkCandidateReviewError | null {
  const response = record(value);
  if (!response) return null;
  const code = response.code || response.reason_code;
  if (code === "invalid_envelope" || code === "invalid_command" || code === "invalid_patch" || code === "invalid_source" || code === "provenance_mismatch") {
    return new WorkCandidateReviewError("invalid_envelope", "Core rejected the work-candidate review envelope");
  }
  if (code === "stale_snapshot") return new WorkCandidateReviewError("stale_snapshot", "Core rejected the stale education snapshot");
  if (code === "stale_revision") return new WorkCandidateReviewError("stale_revision", "Core rejected the stale review revision");
  if (code === "unsupported_command" || code === "unsupported_capabilities") return new WorkCandidateReviewError("unsupported_command", "Core does not support work-candidate review");
  if (response.ok === false || typeof code === "string") return new WorkCandidateReviewError("unavailable", "Core work-candidate command is unavailable");
  return null;
}

function receiptEnvelopeCandidate(value: unknown): { present: boolean; envelope: RawRecord | null } {
  const direct = record(value);
  if (!direct) return { present: false, envelope: null };
  let malformed = false;
  const candidates: RawRecord[] = [];
  for (const key of ["receipt", "receipt_envelope", "envelope"]) {
    if (!Object.hasOwn(direct, key) || direct[key] === null || direct[key] === undefined) continue;
    const candidate = record(direct[key]);
    if (candidate) {
      candidates.push(candidate);
    } else {
      malformed = true;
    }
  }
  if (malformed) return { present: true, envelope: null };
  if (Object.hasOwn(direct, "payload") || Object.hasOwn(direct, "contract_version") || Object.hasOwn(direct, "producer")) candidates.push(direct);
  if (candidates.length === 0) return { present: false, envelope: null };
  const first = candidates[0];
  const firstCanonical = JSON.stringify(canonicalize(first));
  if (candidates.some((candidate) => JSON.stringify(canonicalize(candidate)) !== firstCanonical)) return { present: true, envelope: null };
  return { present: true, envelope: first };
}

function receiptEnvelopeFrom(value: unknown): RawRecord | null {
  return receiptEnvelopeCandidate(value).envelope;
}

function validateReceiptForCommand(value: unknown, commandEnvelope: WorkCandidateReviewCommandEnvelope, beforeStateHash: string, receiptEnvelopeOverride?: RawRecord | null): RawRecord {
  const receiptEnvelope = receiptEnvelopeOverride === undefined ? receiptEnvelopeFrom(value) : receiptEnvelopeOverride;
  if (!receiptEnvelope || !validateCoreEnvelopeSchema(receiptEnvelope)) throw new WorkCandidateReviewError("invalid_envelope", "Core work-candidate receipt is invalid");
  const identity = activeBridgeIdentity();
  if (receiptEnvelope.contract_version !== identity.contract.contract_version
    || receiptEnvelope.schema_hash !== identity.contract.schema_hash
    || receiptEnvelope.producer !== "edupi-core"
    || receiptEnvelope.external_send !== false) throw new WorkCandidateReviewError("invalid_envelope", "Core work-candidate receipt identity is invalid");
  const payload = record(receiptEnvelope.payload);
  if (!payload || !validateReceiptSemantics(payload).ok || payload.receipt_phase !== "mutation") throw new WorkCandidateReviewError("invalid_envelope", "Core work-candidate receipt semantics are invalid");
  if (payload.command_type !== "review_work_candidate") throw new WorkCandidateReviewError("invalid_envelope", "Core receipt command type does not match work review");
  const target = record(payload.target);
  const command = record(commandEnvelope.command);
  if (!command) throw new WorkCandidateReviewError("invalid_envelope", "Core work-candidate receipt request is invalid");
  if (payload.command_id !== commandEnvelope.message_id || payload.request_id !== commandEnvelope.request_id) throw new WorkCandidateReviewError("invalid_envelope", "Core work-candidate receipt identity does not match the request");
  if (receiptEnvelope.message_id !== payload.receipt_id || receiptEnvelope.request_id !== commandEnvelope.request_id) throw new WorkCandidateReviewError("invalid_envelope", "Core work-candidate receipt envelope identity is invalid");
  if (!target || target.target_kind !== "work_candidate" || target.target_id !== command?.candidate_id || target.command_type !== "review_work_candidate") throw new WorkCandidateReviewError("invalid_envelope", "Core work-candidate receipt target does not match the request");
  if (payload.decision !== command?.decision) throw new WorkCandidateReviewError("invalid_envelope", "Core work-candidate receipt decision does not match the request");
  const evidence = boundedList(payload.evidence_ids, "receipt.evidence_ids");
  const commandSource = record(command?.source);
  const commandEvidence = boundedList(commandSource?.evidence_ids, "command.source.evidence_ids");
  if (!exactList(evidence, commandEvidence)) throw new WorkCandidateReviewError("invalid_envelope", "Core work-candidate receipt evidence does not match the request");
  const commandProvenance = Array.isArray(commandEnvelope.provenance) ? commandEnvelope.provenance : [];
  const receiptProvenance = Array.isArray(receiptEnvelope.provenance) ? receiptEnvelope.provenance : [];
  if (commandProvenance.length !== 1 || receiptProvenance.length !== 1 || JSON.stringify(canonicalize(receiptProvenance[0])) !== JSON.stringify(canonicalize(commandProvenance[0]))) throw new WorkCandidateReviewError("invalid_envelope", "Core work-candidate receipt provenance does not match the request");
  const envelopeTeacherReview = record(receiptEnvelope.teacher_review);
  const payloadTeacherReview = record(payload.teacher_review);
  if (!envelopeTeacherReview || !payloadTeacherReview || JSON.stringify(canonicalize(envelopeTeacherReview)) !== JSON.stringify(canonicalize(payloadTeacherReview))) throw new WorkCandidateReviewError("invalid_envelope", "Core work-candidate receipt review envelopes do not match");
  const staleSnapshot = payload.status === "stale_snapshot" || payload.reason_code === "stale_snapshot";
  if (staleSnapshot) {
    if (payload.status !== "stale_snapshot" && payload.status !== "failed") throw new WorkCandidateReviewError("invalid_envelope", "Core stale-snapshot receipt status is invalid");
    throw new WorkCandidateReviewError("stale_snapshot", "Core rejected the stale education snapshot");
  }
  const staleRevision = payload.status === "stale_revision" || payload.reason_code === "stale_revision";
  if (staleRevision) {
    if (payload.status !== "stale_revision" && payload.status !== "failed") throw new WorkCandidateReviewError("invalid_envelope", "Core stale-revision receipt status is invalid");
    throw new WorkCandidateReviewError("stale_revision", "Core rejected the stale review revision");
  }
  if (payload.before_snapshot_id !== commandEnvelope.snapshot_id || payload.before_state_hash !== beforeStateHash) throw new WorkCandidateReviewError("invalid_envelope", "Core work-candidate receipt before binding is invalid");
  if (payload.status === "failed") {
    if (payload.reason_code === "unsupported_command") throw new WorkCandidateReviewError("unsupported_command", "Core does not support work-candidate review");
    throw new WorkCandidateReviewError("unavailable", "Core did not apply the work-candidate review");
  }
  const appliedIds = boundedList(payload.applied_ids, "receipt.applied_ids", { allowEmpty: true });
  const rejectedIds = boundedList(payload.rejected_ids, "receipt.rejected_ids", { allowEmpty: true });
  const decision = command.decision as WorkCandidateReviewDecision;
  const candidateId = String(command.candidate_id);
  const expectedRejectedIds = decision === "reject" || decision === "suppress" ? [candidateId] : [];
  if (!exactList(rejectedIds, expectedRejectedIds)) throw new WorkCandidateReviewError("invalid_envelope", "Core work-candidate receipt rejection does not match the request");
  if (decision === "suppress" && (record(command.patch)?.suppression_scope === "matching_reason")) {
    if (appliedIds.length !== 2 || appliedIds[0] !== candidateId || !/^work_suppression_[a-f0-9]{32}$/.test(appliedIds[1]) || new Set(appliedIds).size !== appliedIds.length) throw new WorkCandidateReviewError("invalid_envelope", "Core matching-reason suppression receipt application is invalid");
  } else if (!exactList(appliedIds, [candidateId])) {
    throw new WorkCandidateReviewError("invalid_envelope", "Core work-candidate receipt application does not match the request");
  }
  if (payload.status !== WORK_REVIEW_STATUS[decision]) throw new WorkCandidateReviewError("invalid_envelope", "Core work-candidate receipt status does not match the decision");
  const teacherReview = record(payload.teacher_review);
  if (!teacherReview
    || teacherReview.revision !== Number(command?.expected_revision) + 1
    || teacherReview.state !== WORK_REVIEW_STATE[WORK_TARGET_STATUS[decision]]
    || teacherReview.reviewer_id !== (commandEnvelope.teacher_review as RawRecord | undefined)?.reviewer_id
    || teacherReview.note !== (command?.note ?? null)
    || teacherReview.reviewed_at !== commandEnvelope.issued_at) throw new WorkCandidateReviewError("invalid_envelope", "Core work-candidate receipt review binding is invalid");
  if (receiptEnvelope.issued_at !== commandEnvelope.issued_at || payload.created_at !== commandEnvelope.issued_at) throw new WorkCandidateReviewError("invalid_envelope", "Core work-candidate receipt time binding is invalid");
  if (payload.reason_code !== null) throw new WorkCandidateReviewError("invalid_envelope", "Core successful work-candidate receipt has a reason code");
  if (JSON.stringify(canonicalize(payload.rollback)) !== JSON.stringify(canonicalize({ available: false, rollback_id: null, expires_at: null })) || payload.preview_token !== null || payload.action_authorization !== null) throw new WorkCandidateReviewError("invalid_envelope", "Core work-candidate receipt contains unsupported action fields");
  if (typeof payload.after_snapshot_id !== "string" || typeof payload.after_state_hash !== "string" || receiptEnvelope.snapshot_id !== payload.after_snapshot_id) throw new WorkCandidateReviewError("invalid_envelope", "Core work-candidate receipt after binding is invalid");
  return payload;
}

function refreshedEnvelopeFrom(value: unknown): RawRecord {
  const direct = record(value);
  const envelope = record(direct?.envelope) || direct;
  if (!envelope || !validateCoreEnvelopeSchema(envelope)) throw new WorkCandidateReviewError("unavailable", "Core education snapshot refresh is unavailable");
  const { payload } = snapshotParts(envelope);
  if (envelope.snapshot_id !== payload.snapshot_id) throw new WorkCandidateReviewError("unavailable", "Core education snapshot refresh is unavailable");
  return envelope;
}

function validateRefreshedWorkTarget(envelope: RawRecord, payload: RawRecord, commandEnvelope: WorkCandidateReviewCommandEnvelope, receipt: RawRecord, before: WorkCandidateContext): WorkCandidateContext {
  const command = commandEnvelope.command;
  const decision = command.decision as WorkCandidateReviewDecision;
  const refreshed = workCandidateContext(payload, String(command.candidate_id));
  const expectedNextCycleState = {
    accept: "closed_accepted",
    modify: "closed_modified",
    reject: "closed_rejected",
    hold: "held",
    snooze: "snoozed",
    suppress: `suppressed_${String((record(command.patch) || {}).suppression_scope)}`,
  }[decision];
  if (refreshed.revision !== before.revision + 1 || refreshed.status !== WORK_TARGET_STATUS[decision] || refreshed.teacherReview.revision !== before.revision + 1 || refreshed.teacherReview.state !== WORK_REVIEW_STATE[refreshed.status] || refreshed.nextCycleState !== expectedNextCycleState) throw new WorkCandidateReviewError("invalid_envelope", "Core refreshed work-candidate target is invalid");
  const refreshedSources = (Array.isArray(envelope.provenance) ? envelope.provenance : [])
    .map((value) => record(value))
    .filter((value): value is RawRecord => value !== null)
    .filter((value) => value.source_kind === "core_task" && value.source_id === refreshed.targetId);
  if (["pending_review", "held"].includes(refreshed.status)) {
    const refreshedSource = activeSourceFromSnapshot(envelope, refreshed);
    const commandProvenance = Array.isArray(commandEnvelope.provenance) ? record(commandEnvelope.provenance[0]) : null;
    if (!commandProvenance || JSON.stringify(canonicalize(refreshedSource)) !== JSON.stringify(canonicalize(commandProvenance))) throw new WorkCandidateReviewError("invalid_envelope", "Core refreshed work-candidate provenance binding is invalid");
  } else if (refreshedSources.length > 0) {
    if (refreshedSources.length !== 1) throw new WorkCandidateReviewError("invalid_envelope", "Core refreshed work-candidate provenance is ambiguous");
    const commandProvenance = Array.isArray(commandEnvelope.provenance) ? record(commandEnvelope.provenance[0]) : null;
    if (!commandProvenance || JSON.stringify(canonicalize(refreshedSources[0])) !== JSON.stringify(canonicalize(commandProvenance))) throw new WorkCandidateReviewError("invalid_envelope", "Core refreshed work-candidate provenance binding is invalid");
  }
  if (!exactList(refreshed.sourceIds, before.sourceIds) || !exactList(refreshed.evidenceIds, receipt.evidence_ids as string[])) throw new WorkCandidateReviewError("invalid_envelope", "Core refreshed work-candidate evidence binding is invalid");
  if (JSON.stringify(canonicalize(refreshed.teacherReview)) !== JSON.stringify(canonicalize(receipt.teacher_review))) throw new WorkCandidateReviewError("invalid_envelope", "Core refreshed work-candidate review binding is invalid");
  if (receipt.after_snapshot_id !== payload.snapshot_id || receipt.after_state_hash !== payload.state_hash || envelope.snapshot_id !== payload.snapshot_id) throw new WorkCandidateReviewError("invalid_envelope", "Core refreshed work-candidate snapshot binding is invalid");
  if (decision === "modify") {
    const patch = record(command.patch) || {};
    if (patch.title !== undefined && refreshed.title !== patch.title) throw new WorkCandidateReviewError("invalid_envelope", "Core modified title does not match the request");
    if (patch.summary !== undefined && refreshed.summary !== patch.summary) throw new WorkCandidateReviewError("invalid_envelope", "Core modified summary does not match the request");
    if (Object.hasOwn(patch, "due_at") && refreshed.dueAt !== patch.due_at) throw new WorkCandidateReviewError("invalid_envelope", "Core modified due date does not match the request");
  }
  if (decision === "snooze") {
    const patch = record(command.patch);
    if (refreshed.snoozeUntil !== patch?.snooze_until || refreshed.nextCycleState !== "snoozed") throw new WorkCandidateReviewError("invalid_envelope", "Core snooze result does not match the request");
  }
  if (decision === "suppress") {
    const patch = record(command.patch);
    if (refreshed.suppressionScope !== patch?.suppression_scope || refreshed.nextCycleState !== `suppressed_${patch?.suppression_scope}`) throw new WorkCandidateReviewError("invalid_envelope", "Core suppression result does not match the request");
  }
  return refreshed;
}

function productionDependencies(supportedCommands: readonly string[]): Required<Pick<WorkCandidateReviewDependencies, "supportedCommands" | "dispatch" | "refreshSnapshot">> {
  let roots: EduPiBridgeRoots;
  try {
    roots = resolveEduPiBridgeRoots();
  } catch {
    throw new WorkCandidateReviewError("unavailable", "Core education bridge is unavailable");
  }
  return {
    supportedCommands,
    dispatch: (envelope) => callEduPiCore({ operation: "command", requestId: envelope.request_id as string, runtime: roots.runtime, dataRoot: roots.dataRoot, envelope }),
    refreshSnapshot: async () => (await readEduPiEducationSnapshot({ roots, requestId: `desktop-work-refresh-${Date.now().toString(36)}` })).envelope,
  };
}

export async function issueWorkCandidateReview(input: WorkCandidateReviewInput, deps: WorkCandidateReviewDependencies = {}): Promise<{ receipt: RawRecord; data: RawRecord }> {
  const identity = activeBridgeIdentity();
  const configuredCommands = deps.supportedCommands || identity.contract.supported_commands;
  if (!exactList(configuredCommands, identity.contract.supported_commands) || !configuredCommands.includes("review_work_candidate")) throw new WorkCandidateReviewError("unsupported_command", "Work-candidate review is unavailable until the pinned Core capability is enabled");
  const { payload: beforePayload } = snapshotParts(input.snapshot);
  const before = workCandidateContext(beforePayload, requiredText(input.targetId, "targetId", 160));
  const commandEnvelope = buildWorkCandidateReviewCommandEnvelope(input);
  const defaults = deps.dispatch && deps.refreshSnapshot ? null : productionDependencies(configuredCommands);
  const production = {
    supportedCommands: configuredCommands,
    dispatch: deps.dispatch || defaults!.dispatch,
    refreshSnapshot: deps.refreshSnapshot || defaults!.refreshSnapshot,
  };
  let rawReceipt: unknown;
  try {
    rawReceipt = await production.dispatch(commandEnvelope);
  } catch (error) {
    const mapped = errorFromDispatch(error);
    if (mapped) throw mapped;
    throw new WorkCandidateReviewError("unavailable", "Core work-candidate command is unavailable");
  }
  const receiptCandidate = receiptEnvelopeCandidate(rawReceipt);
  if (!receiptCandidate.present) {
    const dispatchFailure = errorFromDispatch(rawReceipt);
    if (dispatchFailure) throw dispatchFailure;
  }
  const receipt = validateReceiptForCommand(rawReceipt, commandEnvelope, String(beforePayload.state_hash), receiptCandidate.envelope);
  let refreshed: unknown;
  try {
    refreshed = await production.refreshSnapshot();
  } catch {
    throw new WorkCandidateReviewError("unavailable", "Core education snapshot refresh is unavailable");
  }
  const refreshedEnvelope = refreshedEnvelopeFrom(refreshed);
  const refreshedPayload = record(refreshedEnvelope.payload);
  if (!refreshedPayload) throw new WorkCandidateReviewError("unavailable", "Core education snapshot refresh is unavailable");
  validateRefreshedWorkTarget(refreshedEnvelope, refreshedPayload, commandEnvelope, receipt, before);
  return { receipt, data: refreshedEnvelope };
}
