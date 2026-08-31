import crypto from "node:crypto";
import { callEduPiCore } from "./edupi-core-process-client";
import {
  validateCommand,
  validateCoreEnvelopeSchema,
  validateReceiptSemantics,
} from "./edupi-bridge-contract";
import { activeBridgeIdentity } from "./edupi-bridge-manifest";
import { readEduPiEducationSnapshot, resolveEduPiBridgeRoots, type EduPiBridgeRoots } from "./edupi-core-snapshot";

export const C1_REVIEW_COMMANDS = ["review_observation", "review_memory_candidate"] as const;
export const C1_REVIEW_DECISIONS = ["accept", "modify", "reject", "hold"] as const;

export type C1ReviewTargetKind = "observation" | "memory_candidate";
export type C1ReviewDecision = typeof C1_REVIEW_DECISIONS[number];

export type C1ReviewInput = {
  /** A complete, already validated Core v1.1 snapshot envelope. */
  snapshot: unknown;
  targetKind: C1ReviewTargetKind;
  targetId: string;
  decision: C1ReviewDecision;
  patch?: Record<string, unknown> | null;
  note?: string | null;
  reviewerId?: string | null;
  reviewer?: string | null;
  issuedAt?: string;
};

export type C1ReviewCommandEnvelope = Record<string, unknown> & {
  contract_version: "1.1";
  producer: "edupi-desktop";
  external_send: false;
  snapshot_id: string;
  idempotency_key: string;
  command: Record<string, unknown> & { command_type: "review_observation" | "review_memory_candidate" };
};

export type C1ReviewErrorCode =
  | "invalid_envelope"
  | "unsupported_command"
  | "stale_snapshot"
  | "stale_revision"
  | "unavailable";

export class C1ReviewError extends Error {
  constructor(public readonly code: C1ReviewErrorCode, message: string) {
    super(message);
    this.name = "C1ReviewError";
  }
}

export type C1ReviewDependencies = {
  /** Explicit capability injection is used by the pure command tests. */
  supportedCommands?: readonly string[];
  /** Dispatch exactly one command envelope to Core. */
  dispatch?: (envelope: C1ReviewCommandEnvelope) => Promise<unknown> | unknown;
  /** Refresh a complete Core snapshot after a successful receipt. */
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
    throw new C1ReviewError("invalid_envelope", `${field} is invalid`);
  }
  return value.trim();
}

function optionalNote(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requiredText(value, "note", 1000);
}

function finiteRevision(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new C1ReviewError("invalid_envelope", `${field} is invalid`);
  }
  return value;
}

function list(value: unknown, field: string, maxItems: number, maxLength = 160): string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new C1ReviewError("invalid_envelope", `${field} is invalid`);
  }
  return value.map((item) => requiredText(item, `${field} item`, maxLength));
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
  targetKind,
  targetId,
  revision,
  decision,
  patch,
  note,
  reviewerId,
}: {
  snapshotId: string;
  stateHash: string;
  targetKind: C1ReviewTargetKind;
  targetId: string;
  revision: number;
  decision: C1ReviewDecision;
  patch: RawRecord | null;
  note: string | null;
  reviewerId: string;
}): string {
  const semantic = canonicalize({
    contract_version: "1.1",
    snapshot: { snapshot_id: snapshotId, state_hash: stateHash },
    target_kind: targetKind,
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
    throw new C1ReviewError("invalid_envelope", "Core education snapshot envelope is invalid");
  }
  const identity = activeBridgeIdentity();
  if (envelope.contract_version !== identity.contract.contract_version
    || envelope.schema_hash !== identity.contract.schema_hash
    || envelope.producer !== "edupi-core"
    || envelope.external_send !== false
    || typeof envelope.snapshot_id !== "string"
    || envelope.snapshot_id !== payload.snapshot_id
    || typeof payload.state_hash !== "string") {
    throw new C1ReviewError("invalid_envelope", "Core education snapshot identity is invalid");
  }
  return { envelope, payload };
}

function targetArrays(payload: RawRecord): { observations: RawRecord[]; candidates: RawRecord[] } {
  if (!Array.isArray(payload.observations) || !Array.isArray(payload.memory_candidates)) {
    throw new C1ReviewError("invalid_envelope", "Core education review targets are unavailable");
  }
  return {
    observations: payload.observations.map((item) => record(item)).filter((item): item is RawRecord => item !== null),
    candidates: payload.memory_candidates.map((item) => record(item)).filter((item): item is RawRecord => item !== null),
  };
}

function provenanceEntries(value: unknown): RawRecord[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => record(item)).filter((item): item is RawRecord => item !== null);
}

function provenanceKey(value: RawRecord): string {
  return JSON.stringify(canonicalize(value));
}

function dedupeProvenance(entries: RawRecord[]): RawRecord[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = provenanceKey(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 50);
}

function targetEvidence(target: RawRecord, lineage: RawRecord[]): string[] {
  const direct = Array.isArray(target.evidence_ids) ? target.evidence_ids : [];
  const fromLineage = lineage.flatMap((item) => Array.isArray(item.evidence_ids) ? item.evidence_ids : []);
  const evidence = [...direct, ...fromLineage].filter((item): item is string => typeof item === "string" && item.length > 0);
  return [...new Set(evidence)].slice(0, 50);
}

function targetContext(payload: RawRecord, targetKind: C1ReviewTargetKind, targetId: string): {
  target: RawRecord;
  revision: number;
  source: RawRecord;
  provenance: RawRecord[];
  evidenceIds: string[];
} {
  const { observations, candidates } = targetArrays(payload);
  const matches = (targetKind === "observation" ? observations : candidates).filter((item) => item[targetKind === "observation" ? "observation_id" : "candidate_id"] === targetId);
  if (matches.length !== 1) throw new C1ReviewError("invalid_envelope", "Core education review target was not found or is ambiguous");
  const target = matches[0];
  const teacherReview = record(target.teacher_review);
  if (!teacherReview) throw new C1ReviewError("invalid_envelope", "Core education review target has no teacher review state");
  const revision = finiteRevision(teacherReview.revision, "target revision");

  const lineage = targetKind === "memory_candidate"
    ? (Array.isArray(target.based_on_observation_ids) ? target.based_on_observation_ids : [])
      .map((id) => observations.find((observation) => observation.observation_id === id))
      .filter((item): item is RawRecord => item !== undefined)
    : [];
  if (targetKind === "memory_candidate"
    && (!Array.isArray(target.based_on_observation_ids)
      || target.based_on_observation_ids.length === 0
      || lineage.length !== target.based_on_observation_ids.length)) {
    throw new C1ReviewError("invalid_envelope", "Memory candidate observation lineage is unavailable");
  }
  const targetProvenance = provenanceEntries(target.provenance);
  const lineageProvenance = lineage.flatMap((item) => provenanceEntries(item.provenance));
  const evidenceIds = targetEvidence(target, lineage);
  if (evidenceIds.length === 0) throw new C1ReviewError("invalid_envelope", "Core education review target has no evidence");

  if (targetKind === "observation") {
    const sourceProvenance = targetProvenance.find((item) => item.source_kind === "teacher_message");
    if (!sourceProvenance) throw new C1ReviewError("invalid_envelope", "Observation has no teacher_message provenance");
    const sourceId = requiredText(sourceProvenance.source_id, "observation provenance source_id", 160);
    return {
      target,
      revision,
      source: {
        source_id: sourceId,
        source_kind: "teacher_message",
        source_hash: sourceProvenance.source_hash === undefined ? null : sourceProvenance.source_hash,
        evidence_ids: evidenceIds,
      },
      provenance: dedupeProvenance(targetProvenance),
      evidenceIds,
    };
  }

  const candidateId = requiredText(target.candidate_id, "candidate_id", 160);
  const candidateProvenance = targetProvenance.find((item) => item.source_id === candidateId && item.source_kind === "memory_candidate");
  const generatedAt = typeof payload.generated_at === "string" && payload.generated_at ? payload.generated_at : new Date().toISOString();
  const syntheticCandidateProvenance: RawRecord = {
    source_kind: "memory_candidate",
    source_id: candidateId,
    source_path: null,
    source_hash: candidateProvenance?.source_hash === undefined ? null : candidateProvenance.source_hash,
    observed_at: candidateProvenance?.observed_at || generatedAt,
    actor: "core",
    evidence_ids: evidenceIds,
    parent_ids: Array.isArray(target.based_on_observation_ids) ? target.based_on_observation_ids.slice(0, 50) : [],
  };
  return {
    target,
    revision,
    source: {
      source_id: candidateId,
      source_kind: "memory_candidate",
      source_hash: syntheticCandidateProvenance.source_hash,
      evidence_ids: evidenceIds,
    },
    provenance: dedupeProvenance([...lineageProvenance, ...targetProvenance, syntheticCandidateProvenance]),
    evidenceIds,
  };
}

function boundedPatch(value: unknown, targetKind: C1ReviewTargetKind): RawRecord | null {
  if (value === undefined || value === null) return null;
  const patch = record(value);
  if (!patch) throw new C1ReviewError("invalid_envelope", "review patch is invalid");
  const allowed = targetKind === "observation"
    ? new Set(["text", "subject", "class_id"])
    : new Set(["proposed_content", "tags"]);
  if (Object.keys(patch).some((key) => !allowed.has(key))) throw new C1ReviewError("invalid_envelope", "review patch contains an unsupported field");
  const normalized: RawRecord = {};
  if (targetKind === "observation") {
    if (patch.text !== undefined) normalized.text = requiredText(patch.text, "patch.text", 4000);
    if (patch.subject !== undefined) normalized.subject = patch.subject === null ? null : requiredText(patch.subject, "patch.subject", 120);
    if (patch.class_id !== undefined) normalized.class_id = patch.class_id === null ? null : requiredText(patch.class_id, "patch.class_id", 160);
  } else {
    if (patch.proposed_content !== undefined) normalized.proposed_content = requiredText(patch.proposed_content, "patch.proposed_content", 4000);
    if (patch.tags !== undefined) normalized.tags = list(patch.tags, "patch.tags", 50, 240);
  }
  return normalized;
}

function makeTransportId(prefix: string): string {
  return `desktop-${prefix}-${crypto.randomUUID()}`;
}

/**
 * Build a v1.1 command from a validated snapshot.  Source, provenance,
 * evidence, and expected_revision are intentionally read only from the
 * selected target and its observation lineage; no caller-provided override is
 * accepted for those fields.
 */
export function buildC1ReviewCommandEnvelope(input: C1ReviewInput): C1ReviewCommandEnvelope {
  if (input.targetKind !== "observation" && input.targetKind !== "memory_candidate") {
    throw new C1ReviewError("invalid_envelope", "C1 review target kind is unsupported");
  }
  if (!C1_REVIEW_DECISIONS.includes(input.decision)) {
    throw new C1ReviewError("invalid_envelope", "C1 review decision is unsupported");
  }
  const { envelope: snapshotEnvelope, payload } = snapshotParts(input.snapshot);
  const targetId = requiredText(input.targetId, "targetId", 160);
  const reviewerId = requiredText(input.reviewerId ?? input.reviewer, "reviewerId", 160);
  const note = optionalNote(input.note);
  const issuedAt = requiredText(input.issuedAt === undefined ? new Date().toISOString() : input.issuedAt, "issuedAt", 64);
  const context = targetContext(payload, input.targetKind, targetId);
  const patch = boundedPatch(input.patch, input.targetKind);
  const snapshotId = requiredText(payload.snapshot_id, "snapshot_id", 160);
  const stateHash = requiredText(payload.state_hash, "state_hash", 160);
  const commandType: "review_observation" | "review_memory_candidate" = input.targetKind === "observation"
    ? "review_observation"
    : "review_memory_candidate";
  const idempotencyKey = semanticIdempotencyKey({
    snapshotId,
    stateHash,
    targetKind: input.targetKind,
    targetId,
    revision: context.revision,
    decision: input.decision,
    patch,
    note,
    reviewerId,
  });
  const command: RawRecord = input.targetKind === "observation"
    ? {
      command_type: commandType,
      observation_id: targetId,
      expected_revision: context.revision,
      decision: input.decision,
      patch,
      source: context.source,
      note,
    }
    : {
      command_type: commandType,
      candidate_id: targetId,
      expected_revision: context.revision,
      decision: input.decision,
      patch,
      source: context.source,
      note,
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
    provenance: clone(context.provenance),
    teacher_review: {
      state: "pending_review",
      reviewer_id: reviewerId,
      // This is the command's pending-review metadata, not a completed review.
      // Keeping it null also ensures Core's semantic replay fingerprint does
      // not accidentally include the transport issuance timestamp.
      reviewed_at: null,
      note,
      revision: context.revision,
    },
    external_send: false as const,
    command,
  };
  const validation = validateCommand(commandEnvelope.command);
  if (!validation.ok || !validateCoreEnvelopeSchema(commandEnvelope)) {
    throw new C1ReviewError("invalid_envelope", "C1 review command envelope is invalid");
  }
  // Keep the snapshot envelope in the input part of the contract: reading it
  // above is deliberate and prevents callers from supplying source metadata
  // detached from the Core snapshot.  The outer identity is otherwise not
  // copied into the command.
  void snapshotEnvelope;
  return commandEnvelope as unknown as C1ReviewCommandEnvelope;
}

function errorFromDispatch(value: unknown): C1ReviewError | null {
  const response = record(value);
  if (!response) return null;
  const code = response?.code || response?.reason_code;
  if (code === "stale_snapshot") return new C1ReviewError("stale_snapshot", "Core rejected the stale education snapshot");
  if (code === "stale_revision") return new C1ReviewError("stale_revision", "Core rejected the stale review revision");
  if (code === "unsupported_command" || code === "unsupported_capabilities") return new C1ReviewError("unsupported_command", "Core does not support this review command");
  if (response.ok === false || typeof code === "string") return new C1ReviewError("unavailable", "Core education command is unavailable");
  return null;
}

function receiptEnvelopeFrom(value: unknown): RawRecord | null {
  const direct = record(value);
  if (!direct) return null;
  for (const candidate of [direct.receipt, direct.receipt_envelope, direct.envelope, direct]) {
    const envelope = record(candidate);
    if (envelope?.payload && record(envelope.payload)?.receipt_id) return envelope;
  }
  return null;
}

function validateReceiptForCommand(value: unknown, commandEnvelope: C1ReviewCommandEnvelope, supportedCommands: readonly string[]): RawRecord {
  const receiptEnvelope = receiptEnvelopeFrom(value);
  if (!receiptEnvelope || !validateCoreEnvelopeSchema(receiptEnvelope)) {
    throw new C1ReviewError("invalid_envelope", "Core review receipt is invalid");
  }
  const identity = activeBridgeIdentity();
  if (receiptEnvelope.contract_version !== identity.contract.contract_version
    || receiptEnvelope.schema_hash !== identity.contract.schema_hash
    || receiptEnvelope.producer !== "edupi-core"
    || receiptEnvelope.external_send !== false) {
    throw new C1ReviewError("invalid_envelope", "Core review receipt identity is invalid");
  }
  const payload = record(receiptEnvelope.payload);
  if (!payload) throw new C1ReviewError("invalid_envelope", "Core review receipt payload is invalid");
  const semantic = validateReceiptSemantics(payload);
  if (!semantic.ok) throw new C1ReviewError("invalid_envelope", "Core review receipt semantics are invalid");
  const commandType = payload.command_type;
  if (typeof commandType !== "string" || !supportedCommands.includes(commandType)) {
    throw new C1ReviewError("unsupported_command", "Core does not support this review command");
  }
  if (commandType !== commandEnvelope.command.command_type) {
    throw new C1ReviewError("invalid_envelope", "Core review receipt command type does not match the request");
  }
  const isStaleSnapshot = payload.status === "stale_snapshot" || payload.reason_code === "stale_snapshot";
  const isStaleRevision = payload.reason_code === "stale_revision";
  if (isStaleSnapshot) throw new C1ReviewError("stale_snapshot", "Core rejected the stale education snapshot");
  if (isStaleRevision) throw new C1ReviewError("stale_revision", "Core rejected the stale review revision");
  const expectedTargetKind = commandType === "review_observation" ? "observation" : "memory_candidate";
  const expectedTargetId = commandType === "review_observation"
    ? commandEnvelope.command.observation_id
    : commandEnvelope.command.candidate_id;
  const target = record(payload.target);
  if (!target || target.target_kind !== expectedTargetKind || target.target_id !== expectedTargetId || target.command_type !== commandType) {
    throw new C1ReviewError("invalid_envelope", "Core review receipt target does not match the request");
  }
  if (payload.before_snapshot_id !== commandEnvelope.snapshot_id) {
    throw new C1ReviewError("stale_snapshot", "Core review receipt was produced from another snapshot");
  }
  if (payload.status === "failed") {
    if (payload.reason_code === "unsupported_command") throw new C1ReviewError("unsupported_command", "Core does not support this review command");
    throw new C1ReviewError("unavailable", "Core did not apply the review command");
  }
  if (typeof payload.after_snapshot_id !== "string" || receiptEnvelope.snapshot_id !== payload.after_snapshot_id) {
    throw new C1ReviewError("invalid_envelope", "Core review receipt snapshot binding is invalid");
  }
  // Callers consume the bounded receipt payload.  The enclosing envelope was
  // still validated above because it carries the contract/schema identity and
  // the post-mutation snapshot binding.
  return payload;
}

function refreshedEnvelopeFrom(value: unknown, requireIdentityBinding = true): RawRecord {
  const direct = record(value);
  const envelope = record(direct?.envelope) || direct;
  if (!envelope || !validateCoreEnvelopeSchema(envelope)) {
    throw new C1ReviewError("unavailable", "Core education snapshot refresh is unavailable");
  }
  const payload = record(envelope.payload);
  if (!payload || envelope.producer !== "edupi-core" || envelope.external_send !== false
    || (requireIdentityBinding && payload.snapshot_id !== envelope.snapshot_id)) {
    throw new C1ReviewError("unavailable", "Core education snapshot refresh is unavailable");
  }
  return envelope;
}

function productionDependencies(supportedCommands: readonly string[]): Required<Pick<C1ReviewDependencies, "supportedCommands" | "dispatch" | "refreshSnapshot">> {
  let roots: EduPiBridgeRoots;
  try {
    roots = resolveEduPiBridgeRoots();
  } catch {
    throw new C1ReviewError("unavailable", "Core education bridge is unavailable");
  }
  return {
    supportedCommands,
    dispatch: (envelope) => callEduPiCore({
      operation: "command",
      requestId: envelope.request_id as string,
      runtime: roots.runtime,
      dataRoot: roots.dataRoot,
      envelope,
    }),
    refreshSnapshot: async () => (await readEduPiEducationSnapshot({
      roots,
      requestId: `desktop-review-refresh-${Date.now().toString(36)}`,
    })).envelope,
  };
}

/** Issue one C1 command, consume one receipt, then refresh the validated snapshot. */
export async function issueC1Review(input: C1ReviewInput, deps: C1ReviewDependencies = {}): Promise<{ receipt: RawRecord; data: RawRecord }> {
  const targetCommand: "review_observation" | "review_memory_candidate" = input.targetKind === "observation"
    ? "review_observation"
    : input.targetKind === "memory_candidate"
      ? "review_memory_candidate"
      : (() => { throw new C1ReviewError("invalid_envelope", "C1 review target kind is unsupported"); })();
  const configuredCommands = deps.supportedCommands || activeBridgeIdentity().contract.supported_commands;
  if (!configuredCommands.includes(targetCommand)) {
    throw new C1ReviewError("unsupported_command", "C1 review is unavailable until the pinned Core capability is enabled");
  }
  const commandEnvelope = buildC1ReviewCommandEnvelope(input);
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
    throw new C1ReviewError("unavailable", "Core education command is unavailable");
  }
  const dispatchFailure = errorFromDispatch(rawReceipt);
  if (dispatchFailure) throw dispatchFailure;
  const receipt = validateReceiptForCommand(rawReceipt, commandEnvelope, production.supportedCommands);
  let refreshed: unknown;
  try {
    refreshed = await production.refreshSnapshot();
  } catch {
    throw new C1ReviewError("unavailable", "Core education snapshot refresh is unavailable");
  }
  return { receipt, data: refreshedEnvelopeFrom(refreshed, !(deps.dispatch && deps.refreshSnapshot)) };
}
