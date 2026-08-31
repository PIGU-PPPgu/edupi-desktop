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

export const TEACHER_CONTEXT_REVIEW_COMMANDS = ["review_teacher_context"] as const;
export const TEACHER_CONTEXT_REVIEW_DECISIONS = ["accept", "modify", "reject", "hold"] as const;
const CONTEXT_FIELDS = ["name", "role", "subject", "grade", "class_name"] as const;

export type TeacherContextReviewDecision = typeof TEACHER_CONTEXT_REVIEW_DECISIONS[number];
export type TeacherContextReviewValues = Partial<Record<typeof CONTEXT_FIELDS[number], string>>;
export type TeacherContextReviewInput = {
  /** A complete, already validated Core v1.1 snapshot envelope. */
  snapshot: unknown;
  targetId: string;
  expectedSnapshotId: string;
  expectedRevision: number;
  decision: TeacherContextReviewDecision;
  patch?: TeacherContextReviewValues | Record<string, unknown> | null;
  note?: string | null;
  reviewerId?: string | null;
  reviewer?: string | null;
  issuedAt?: string;
};

export type TeacherContextReviewCommandEnvelope = Record<string, unknown> & {
  contract_version: "1.1";
  producer: "edupi-desktop";
  external_send: false;
  snapshot_id: string;
  idempotency_key: string;
  command: Record<string, unknown> & { command_type: "review_teacher_context" };
};

export type TeacherContextReviewErrorCode =
  | "invalid_envelope"
  | "unsupported_command"
  | "stale_snapshot"
  | "stale_revision"
  | "unavailable";

export class TeacherContextReviewError extends Error {
  constructor(public readonly code: TeacherContextReviewErrorCode, message: string) {
    super(message);
    this.name = "TeacherContextReviewError";
  }
}

export type TeacherContextReviewDependencies = {
  supportedCommands?: readonly string[];
  dispatch?: (envelope: TeacherContextReviewCommandEnvelope) => Promise<unknown> | unknown;
  refreshSnapshot?: () => Promise<unknown> | unknown;
};

type RawRecord = Record<string, unknown>;

function record(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new TeacherContextReviewError("invalid_envelope", `${field} is invalid`);
  }
  return value.trim();
}

function optionalNote(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requiredText(value, "note", 1000);
}

function finiteRevision(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TeacherContextReviewError("invalid_envelope", `${field} is invalid`);
  }
  return value;
}

function boundedList(value: unknown, field: string, maxItems = 50, maxLength = 160): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) {
    throw new TeacherContextReviewError("invalid_envelope", `${field} is invalid`);
  }
  const result = value.map((item) => requiredText(item, `${field} item`, maxLength));
  if (new Set(result).size !== result.length) throw new TeacherContextReviewError("invalid_envelope", `${field} contains duplicates`);
  return result;
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

function semanticIdempotencyKey({
  snapshotId,
  stateHash,
  targetId,
  revision,
  decision,
  patch,
  note,
  reviewerId,
}: {
  snapshotId: string;
  stateHash: string;
  targetId: string;
  revision: number;
  decision: TeacherContextReviewDecision;
  patch: RawRecord | null;
  note: string | null;
  reviewerId: string;
}): string {
  const semantic = canonicalize({
    contract_version: "1.1",
    snapshot: { snapshot_id: snapshotId, state_hash: stateHash },
    command_type: "review_teacher_context",
    target_id: targetId,
    expected_revision: revision,
    decision,
    patch,
    note,
    reviewer_id: reviewerId,
  });
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(semantic)).digest("base64url")}`;
}

function snapshotParts(value: unknown): { envelope: RawRecord; payload: RawRecord } {
  const envelope = record(value);
  const payload = record(envelope?.payload);
  if (!envelope || !payload || !validateCoreEnvelopeSchema(envelope)) {
    throw new TeacherContextReviewError("invalid_envelope", "Core education snapshot envelope is invalid");
  }
  const identity = activeBridgeIdentity();
  if (envelope.contract_version !== identity.contract.contract_version
    || envelope.schema_hash !== identity.contract.schema_hash
    || envelope.producer !== "edupi-core"
    || envelope.external_send !== false
    || typeof envelope.snapshot_id !== "string"
    || envelope.snapshot_id !== payload.snapshot_id
    || typeof payload.state_hash !== "string"
    || !exactList(payload.capabilities && record(payload.capabilities)?.supported_commands, identity.contract.supported_commands)
    || !exactList(payload.capabilities && record(payload.capabilities)?.supported_projections, identity.contract.supported_projections)
    || !validateSnapshotSemantics(payload, {
      supportedCommands: identity.contract.supported_commands,
      supportedProjections: identity.contract.supported_projections,
    }).ok) {
    throw new TeacherContextReviewError("invalid_envelope", "Core education snapshot identity or capability is invalid");
  }
  return { envelope, payload };
}

function activeContextTarget(payload: RawRecord, targetId: string): { target: RawRecord; revision: number; source: RawRecord } {
  const targets = Array.isArray(payload.review_targets) ? payload.review_targets : [];
  const matches = targets.filter((item) => {
    const projection = record(item);
    const target = record(projection?.target);
    return projection?.projection_kind === "teacher_context"
      && target?.target_kind === "teacher_context"
      && target.command_type === "review_teacher_context"
      && target.target_id === targetId;
  }).map((item) => record(item)).filter((item): item is RawRecord => item !== null);
  if (matches.length !== 1) throw new TeacherContextReviewError("invalid_envelope", "Core teacher-context target was not found or is ambiguous");
  const target = record(matches[0].target);
  const teacherReview = record(matches[0].teacher_review);
  if (!target || !teacherReview) throw new TeacherContextReviewError("invalid_envelope", "Core teacher-context target is malformed");
  const sourceIds = boundedList(matches[0].source_ids, "target.source_ids");
  const evidenceIds = boundedList(matches[0].evidence_ids, "target.evidence_ids");
  if (sourceIds.length !== 1) throw new TeacherContextReviewError("invalid_envelope", "Core teacher-context target must have exactly one active source");
  return {
    target: matches[0],
    revision: finiteRevision(teacherReview.revision, "target revision"),
    source: { source_ids: sourceIds, evidence_ids: evidenceIds },
  };
}

function activeSourceFromSnapshot(envelope: RawRecord, context: { target: RawRecord; source: RawRecord }): RawRecord {
  const sourceIds = context.source.source_ids as string[];
  const evidenceIds = context.source.evidence_ids as string[];
  const entries = (Array.isArray(envelope.provenance) ? envelope.provenance : [])
    .map((item) => record(item))
    .filter((item): item is RawRecord => item !== null)
    .filter((item) => item.source_kind === "teacher_message" && sourceIds.includes(String(item.source_id)));
  if (entries.length !== 1) throw new TeacherContextReviewError("invalid_envelope", "Active teacher-message provenance is missing or ambiguous");
  const source = entries[0];
  const sourceId = requiredText(source.source_id, "source.source_id", 160);
  const sourceHash = requiredText(source.source_hash, "source.source_hash", 160);
  if (!/^sha256:[A-Za-z0-9_-]+$/.test(sourceHash)) throw new TeacherContextReviewError("invalid_envelope", "source.source_hash is invalid");
  const sourceEvidence = boundedList(source.evidence_ids, "source.evidence_ids");
  if (!exactList(sourceEvidence, evidenceIds)) throw new TeacherContextReviewError("invalid_envelope", "Active source evidence does not match target evidence");
  if (!Array.isArray(source.parent_ids) || source.parent_ids.length > 50 || source.parent_ids.some((item) => typeof item !== "string" || !item.trim() || item.length > 160)) {
    throw new TeacherContextReviewError("invalid_envelope", "source.parent_ids is invalid");
  }
  return {
    source_path: source.source_path === null || source.source_path === undefined ? null : requiredText(source.source_path, "source.source_path", 1024),
    source_id: sourceId,
    source_kind: "teacher_message",
    source_hash: sourceHash,
    observed_at: requiredText(source.observed_at, "source.observed_at", 64),
    actor: source.actor === "teacher" ? "teacher" : (() => { throw new TeacherContextReviewError("invalid_envelope", "source.actor is invalid"); })(),
    evidence_ids: evidenceIds,
    parent_ids: source.parent_ids.map((item) => String(item).trim()),
  };
}

function boundedPatch(value: unknown, decision: TeacherContextReviewDecision): RawRecord | null {
  if (value === undefined || value === null) {
    if (decision === "modify") throw new TeacherContextReviewError("invalid_envelope", "modify requires a context patch");
    return null;
  }
  const patch = record(value);
  if (!patch) throw new TeacherContextReviewError("invalid_envelope", "review patch is invalid");
  const normalized: RawRecord = {};
  for (const key of Object.keys(patch)) {
    if (!(CONTEXT_FIELDS as readonly string[]).includes(key)) throw new TeacherContextReviewError("invalid_envelope", "review patch contains an unsupported field");
    normalized[key] = requiredText(patch[key], `patch.${key}`, 120);
  }
  if (decision === "modify" && Object.keys(normalized).length === 0) throw new TeacherContextReviewError("invalid_envelope", "modify requires a context patch");
  return normalized;
}

function makeTransportId(prefix: string): string {
  return `desktop-${prefix}-${crypto.randomUUID()}`;
}

/** Build a v1.1 context-review command using only active target provenance. */
export function buildTeacherContextReviewCommandEnvelope(input: TeacherContextReviewInput): TeacherContextReviewCommandEnvelope {
  if (!TEACHER_CONTEXT_REVIEW_DECISIONS.includes(input.decision)) throw new TeacherContextReviewError("invalid_envelope", "teacher-context review decision is unsupported");
  const { envelope: snapshotEnvelope, payload } = snapshotParts(input.snapshot);
  const targetId = requiredText(input.targetId, "targetId", 160);
  const expectedSnapshotId = requiredText(input.expectedSnapshotId, "expectedSnapshotId", 160);
  if (expectedSnapshotId !== payload.snapshot_id) throw new TeacherContextReviewError("stale_snapshot", "Core education snapshot is stale");
  const expectedRevision = finiteRevision(input.expectedRevision, "expectedRevision");
  const context = activeContextTarget(payload, targetId);
  if (context.revision !== expectedRevision) throw new TeacherContextReviewError("stale_revision", "Core teacher-context revision is stale");
  const activeSource = activeSourceFromSnapshot(snapshotEnvelope, context);
  const reviewerId = requiredText(input.reviewerId ?? input.reviewer ?? "teacher", "reviewerId", 160);
  const note = optionalNote(input.note);
  const issuedAt = requiredText(input.issuedAt === undefined ? new Date().toISOString() : input.issuedAt, "issuedAt", 64);
  const patch = boundedPatch(input.patch, input.decision);
  const snapshotId = requiredText(payload.snapshot_id, "snapshot_id", 160);
  const stateHash = requiredText(payload.state_hash, "state_hash", 160);
  const idempotencyKey = semanticIdempotencyKey({ snapshotId, stateHash, targetId, revision: expectedRevision, decision: input.decision, patch, note, reviewerId });
  const commandSource = {
    source_id: activeSource.source_id,
    source_kind: "teacher_message" as const,
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
    teacher_review: {
      state: "pending_review",
      reviewer_id: reviewerId,
      reviewed_at: null,
      note,
      revision: expectedRevision,
    },
    external_send: false as const,
    command: {
      command_type: "review_teacher_context" as const,
      context_id: targetId,
      expected_revision: expectedRevision,
      decision: input.decision,
      patch,
      source: commandSource,
      note,
    },
  };
  const validation = validateCommand(commandEnvelope.command);
  if (!validation.ok || !validateCoreEnvelopeSchema(commandEnvelope)) throw new TeacherContextReviewError("invalid_envelope", `Teacher-context review command envelope is invalid (${validation.ok ? "schema" : "command"})`);
  void snapshotEnvelope;
  return commandEnvelope as unknown as TeacherContextReviewCommandEnvelope;
}

function errorFromDispatch(value: unknown): TeacherContextReviewError | null {
  const response = record(value);
  if (!response) return null;
  const code = response.code || response.reason_code;
  if (code === "stale_snapshot") return new TeacherContextReviewError("stale_snapshot", "Core rejected the stale education snapshot");
  if (code === "stale_revision") return new TeacherContextReviewError("stale_revision", "Core rejected the stale review revision");
  if (code === "unsupported_command" || code === "unsupported_capabilities") return new TeacherContextReviewError("unsupported_command", "Core does not support teacher-context review");
  if (response.ok === false || typeof code === "string") return new TeacherContextReviewError("unavailable", "Core teacher-context command is unavailable");
  return null;
}

function receiptEnvelopeCandidate(value: unknown): { present: boolean; envelope: RawRecord | null } {
  const direct = record(value);
  if (!direct) return { present: false, envelope: null };
  let malformed = false;
  for (const key of ["receipt", "receipt_envelope", "envelope"]) {
    if (!Object.hasOwn(direct, key)) continue;
    if (direct[key] === null || direct[key] === undefined) continue;
    const envelope = record(direct[key]);
    if (!envelope) {
      malformed = true;
      continue;
    }
    return malformed ? { present: true, envelope: null } : { present: true, envelope };
  }
  if (Object.hasOwn(direct, "payload") || Object.hasOwn(direct, "contract_version") || Object.hasOwn(direct, "producer")) return { present: true, envelope: direct };
  return { present: malformed, envelope: null };
}

function receiptEnvelopeFrom(value: unknown): RawRecord | null {
  return receiptEnvelopeCandidate(value).envelope;
}

function validateReceiptForCommand(value: unknown, commandEnvelope: TeacherContextReviewCommandEnvelope, beforeStateHash: string): RawRecord {
  const receiptEnvelope = receiptEnvelopeFrom(value);
  if (!receiptEnvelope || !validateCoreEnvelopeSchema(receiptEnvelope)) throw new TeacherContextReviewError("invalid_envelope", "Core teacher-context receipt is invalid");
  const identity = activeBridgeIdentity();
  if (receiptEnvelope.contract_version !== identity.contract.contract_version
    || receiptEnvelope.schema_hash !== identity.contract.schema_hash
    || receiptEnvelope.producer !== "edupi-core"
    || receiptEnvelope.external_send !== false) throw new TeacherContextReviewError("invalid_envelope", "Core teacher-context receipt identity is invalid");
  const payload = record(receiptEnvelope.payload);
  if (!payload || !validateReceiptSemantics(payload).ok) throw new TeacherContextReviewError("invalid_envelope", "Core teacher-context receipt semantics are invalid");
  if (payload.command_type !== "review_teacher_context") throw new TeacherContextReviewError("invalid_envelope", "Core receipt command type does not match teacher-context review");
  const target = record(payload.target);
  if (!target || target.target_kind !== "teacher_context" || target.target_id !== commandEnvelope.command.context_id || target.command_type !== "review_teacher_context") throw new TeacherContextReviewError("invalid_envelope", "Core teacher-context receipt target does not match the request");
  if (payload.decision !== commandEnvelope.command.decision) throw new TeacherContextReviewError("invalid_envelope", "Core teacher-context receipt decision does not match the request");
  const evidence = Array.isArray(payload.evidence_ids) ? payload.evidence_ids : [];
  const commandSource = record(commandEnvelope.command.source);
  const requestedEvidence = commandSource && Array.isArray(commandSource.evidence_ids)
    ? commandSource.evidence_ids.filter((id): id is string => typeof id === "string")
    : [];
  if (!requestedEvidence.every((id) => evidence.includes(id))) throw new TeacherContextReviewError("invalid_envelope", "Core teacher-context receipt evidence binding is invalid");
  const staleSnapshot = payload.status === "stale_snapshot" || payload.reason_code === "stale_snapshot";
  if (staleSnapshot) {
    if (payload.status !== "stale_snapshot" && payload.status !== "failed") throw new TeacherContextReviewError("invalid_envelope", "Core teacher-context stale snapshot receipt status is invalid");
    throw new TeacherContextReviewError("stale_snapshot", "Core rejected the stale education snapshot");
  }
  const staleRevision = payload.status === "stale_revision" || payload.reason_code === "stale_revision";
  if (staleRevision) {
    if (payload.status !== "stale_revision" && payload.status !== "failed") throw new TeacherContextReviewError("invalid_envelope", "Core teacher-context stale revision receipt status is invalid");
    throw new TeacherContextReviewError("stale_revision", "Core rejected the stale review revision");
  }
  if (payload.before_snapshot_id !== commandEnvelope.snapshot_id) throw new TeacherContextReviewError("stale_snapshot", "Core teacher-context receipt was produced from another snapshot");
  if (payload.before_state_hash !== beforeStateHash) throw new TeacherContextReviewError("invalid_envelope", "Core teacher-context receipt state binding is invalid");
  if (payload.status === "failed" && payload.reason_code === "unsupported_command") throw new TeacherContextReviewError("unsupported_command", "Core does not support teacher-context review");
  if (payload.status === "failed") throw new TeacherContextReviewError("unavailable", "Core did not apply the teacher-context review");
  const expectedStatus = {
    accept: "accepted",
    modify: "modified",
    reject: "rejected",
    hold: "held",
  }[String(commandEnvelope.command.decision)];
  if (payload.status !== expectedStatus) throw new TeacherContextReviewError("invalid_envelope", "Core teacher-context receipt status does not match the decision");
  if (typeof payload.after_snapshot_id !== "string" || receiptEnvelope.snapshot_id !== payload.after_snapshot_id) throw new TeacherContextReviewError("invalid_envelope", "Core teacher-context receipt snapshot binding is invalid");
  return payload;
}

function refreshedEnvelopeFrom(value: unknown): RawRecord {
  const direct = record(value);
  const envelope = record(direct?.envelope) || direct;
  if (!envelope || !validateCoreEnvelopeSchema(envelope)) throw new TeacherContextReviewError("unavailable", "Core education snapshot refresh is unavailable");
  const payload = record(envelope.payload);
  const identity = activeBridgeIdentity();
  if (!payload || envelope.producer !== "edupi-core" || envelope.external_send !== false
    || envelope.contract_version !== identity.contract.contract_version
    || envelope.schema_hash !== identity.contract.schema_hash
    || envelope.snapshot_id !== payload.snapshot_id
    || !exactList(record(payload.capabilities)?.supported_commands, identity.contract.supported_commands)
    || !exactList(record(payload.capabilities)?.supported_projections, identity.contract.supported_projections)
    || !validateSnapshotSemantics(payload, {
      supportedCommands: identity.contract.supported_commands,
      supportedProjections: identity.contract.supported_projections,
    }).ok) throw new TeacherContextReviewError("unavailable", "Core education snapshot refresh is unavailable");
  return envelope;
}

function productionDependencies(supportedCommands: readonly string[]): Required<Pick<TeacherContextReviewDependencies, "supportedCommands" | "dispatch" | "refreshSnapshot">> {
  let roots: EduPiBridgeRoots;
  try {
    roots = resolveEduPiBridgeRoots();
  } catch {
    throw new TeacherContextReviewError("unavailable", "Core education bridge is unavailable");
  }
  return {
    supportedCommands,
    dispatch: (envelope) => callEduPiCore({ operation: "command", requestId: envelope.request_id as string, runtime: roots.runtime, dataRoot: roots.dataRoot, envelope }),
    refreshSnapshot: async () => (await readEduPiEducationSnapshot({ roots, requestId: `desktop-context-refresh-${Date.now().toString(36)}` })).envelope,
  };
}

/** Issue one teacher-context review, validate its receipt, and refresh Core state. */
export async function issueTeacherContextReview(input: TeacherContextReviewInput, deps: TeacherContextReviewDependencies = {}): Promise<{ receipt: RawRecord; data: RawRecord }> {
  const identity = activeBridgeIdentity();
  const configuredCommands = deps.supportedCommands || identity.contract.supported_commands;
  if (!exactList(configuredCommands, identity.contract.supported_commands) || !configuredCommands.includes("review_teacher_context")) throw new TeacherContextReviewError("unsupported_command", "Teacher-context review is unavailable until the pinned Core capability is enabled");
  const { payload: beforePayload } = snapshotParts(input.snapshot);
  const commandEnvelope = buildTeacherContextReviewCommandEnvelope(input);
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
    throw new TeacherContextReviewError("unavailable", "Core teacher-context command is unavailable");
  }
  if (!receiptEnvelopeCandidate(rawReceipt).present) {
    const dispatchFailure = errorFromDispatch(rawReceipt);
    if (dispatchFailure) throw dispatchFailure;
  }
  const receipt = validateReceiptForCommand(rawReceipt, commandEnvelope, String(beforePayload.state_hash));
  let refreshed: unknown;
  try {
    refreshed = await production.refreshSnapshot();
  } catch {
    throw new TeacherContextReviewError("unavailable", "Core education snapshot refresh is unavailable");
  }
  const refreshedEnvelope = refreshedEnvelopeFrom(refreshed);
  if (receipt.after_snapshot_id !== refreshedEnvelope.snapshot_id
    || receipt.after_state_hash !== record(refreshedEnvelope.payload)?.state_hash) throw new TeacherContextReviewError("invalid_envelope", "Core teacher-context receipt after binding is invalid");
  return { receipt, data: refreshedEnvelope };
}
