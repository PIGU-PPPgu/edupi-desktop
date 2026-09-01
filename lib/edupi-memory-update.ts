import crypto from "node:crypto";
import { validateCoreEnvelopeSchema, validateReceiptSemantics } from "./edupi-bridge-contract";
import { activeBridgeIdentity } from "./edupi-bridge-manifest";
import { callEduPiCore } from "./edupi-core-process-client";
import { readEduPiEducationSnapshot, type CoreEducationSnapshotPayload, type EduPiBridgeRoots } from "./edupi-core-snapshot";

type RawRecord = Record<string, unknown>;

export type MemoryUpdateInput = {
  memoryId: string;
  expectedRevision: number;
  content: string;
  note?: string | null;
  reviewerId?: string | null;
  issuedAt?: string;
};

export type MemoryUpdateErrorCode = "invalid_envelope" | "unsupported_command" | "stale_snapshot" | "stale_revision" | "target_not_found" | "unavailable";

export class MemoryUpdateError extends Error {
  constructor(public readonly code: MemoryUpdateErrorCode, message: string) {
    super(message);
    this.name = "MemoryUpdateError";
  }
}

type SnapshotResult = { payload: CoreEducationSnapshotPayload; roots: EduPiBridgeRoots };
export type MemoryUpdateDependencies = {
  supportedCommands?: readonly string[];
  readSnapshot?: () => Promise<SnapshotResult>;
  dispatch?: (envelope: RawRecord, roots: EduPiBridgeRoots) => Promise<unknown> | unknown;
  refreshSnapshot?: (roots: EduPiBridgeRoots) => Promise<CoreEducationSnapshotPayload> | CoreEducationSnapshotPayload;
};

function record(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
}

function text(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new MemoryUpdateError("invalid_envelope", `${field} 无效。`);
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

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function idempotencyKey(value: unknown): string {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("base64url")}`;
}

function note(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 1000) throw new MemoryUpdateError("invalid_envelope", "note 无效。");
  return value.trim() || null;
}

function memoryFromPayload(payload: RawRecord, memoryId: string): RawRecord {
  const workspace = record(payload.education_workspace);
  const continuity = record(workspace?.continuity);
  const matches = (Array.isArray(continuity?.memories) ? continuity.memories : []).map(record).filter((memory): memory is RawRecord => memory?.memory_id === memoryId);
  if (matches.length === 0) throw new MemoryUpdateError("target_not_found", "记忆不存在或已失效。");
  if (matches.length !== 1) throw new MemoryUpdateError("invalid_envelope", "记忆投影重复。");
  if (matches[0].state !== "active") throw new MemoryUpdateError("target_not_found", "记忆不存在或已失效。");
  return matches[0];
}

export function buildMemoryUpdateCommandEnvelope(input: MemoryUpdateInput & { payload: unknown }): RawRecord {
  const payload = record(input.payload);
  if (!payload) throw new MemoryUpdateError("unavailable", "Core 教育快照不可用。");
  const memoryId = text(input.memoryId, "memoryId", 160);
  const content = text(input.content, "content", 4000);
  const snapshotId = text(payload.snapshot_id, "snapshotId", 160);
  const stateHash = text(payload.state_hash, "stateHash", 160);
  if (!/^sha256:[A-Za-z0-9_-]+$/.test(stateHash)) throw new MemoryUpdateError("unavailable", "Core 教育快照来源哈希不可用。");
  const memory = memoryFromPayload(payload, memoryId);
  const revision = memory.revision;
  if (!Number.isInteger(revision) || Number(revision) < 0) throw new MemoryUpdateError("invalid_envelope", "记忆版本无效。");
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) throw new MemoryUpdateError("invalid_envelope", "expectedRevision 无效。");
  if (input.expectedRevision !== revision) throw new MemoryUpdateError("stale_revision", "记忆已更新，请刷新后重试。");
  if (content === memory.content) throw new MemoryUpdateError("invalid_envelope", "记忆内容没有变化。");
  const reviewerId = input.reviewerId === undefined || input.reviewerId === null ? "teacher" : text(input.reviewerId, "reviewerId", 160);
  const issuedAt = input.issuedAt === undefined ? new Date().toISOString() : text(input.issuedAt, "issuedAt", 64);
  const updateNote = note(input.note);
  const evidenceIds = [memoryId];
  const source = { source_id: memoryId, source_kind: "core_memory", source_hash: stateHash, evidence_ids: evidenceIds };
  const command = { command_type: "update_memory", memory_id: memoryId, expected_revision: revision, decision: "modify", content, source, note: updateNote };
  const identity = activeBridgeIdentity();
  const envelope = {
    contract_version: identity.contract.contract_version,
    message_id: `desktop-memory-update-message-${crypto.randomUUID()}`,
    request_id: `desktop-memory-update-request-${crypto.randomUUID()}`,
    issued_at: issuedAt,
    producer: "edupi-desktop",
    schema_hash: identity.contract.schema_hash,
    snapshot_id: snapshotId,
    idempotency_key: idempotencyKey({ snapshot_id: snapshotId, state_hash: stateHash, command, reviewer_id: reviewerId }),
    provenance: [{ source_kind: "core_memory", source_id: memoryId, source_path: null, source_hash: stateHash, observed_at: issuedAt, actor: "core", evidence_ids: evidenceIds, parent_ids: [] }],
    teacher_review: { state: "modified", reviewer_id: reviewerId, reviewed_at: issuedAt, note: updateNote, revision: revision + 1 },
    external_send: false,
    command,
  };
  if (!validateCoreEnvelopeSchema(envelope)) throw new MemoryUpdateError("invalid_envelope", "记忆修改命令无效。");
  return envelope;
}

function receiptFor(value: unknown, envelope: RawRecord, supportedCommands: readonly string[]): RawRecord {
  const response = record(value);
  const identity = activeBridgeIdentity();
  if (!response || response.ok !== true || response.operation !== "command" || response.request_id !== envelope.request_id
    || !exactList(response.supported_commands, supportedCommands) || !exactList(response.supported_projections, identity.contract.supported_projections)) {
    throw new MemoryUpdateError("unavailable", "Core 记忆修改回执不可用。");
  }
  const receiptEnvelope = record(response.receipt);
  const receipt = record(receiptEnvelope?.payload);
  const command = record(envelope.command);
  if (!receiptEnvelope || !receipt || !command || !validateCoreEnvelopeSchema(receiptEnvelope) || !validateReceiptSemantics(receipt).ok
    || receiptEnvelope.producer !== "edupi-core" || receiptEnvelope.schema_hash !== identity.contract.schema_hash || receiptEnvelope.external_send !== false
    || receipt.command_type !== "update_memory" || receipt.receipt_phase !== "mutation" || receipt.decision !== "modify"
    || !same(receipt.target, { target_kind: "memory", target_id: command.memory_id, command_type: "update_memory" })
    || receipt.before_snapshot_id !== envelope.snapshot_id || receipt.before_state_hash !== record(command.source)?.source_hash
    || receipt.created_at !== envelope.issued_at || !same(receiptEnvelope.provenance, envelope.provenance)) {
    throw new MemoryUpdateError("invalid_envelope", "Core 记忆修改回执绑定无效。");
  }
  const status = String(receipt.status || "");
  if (status === "stale_snapshot" || receipt.reason_code === "stale_snapshot") throw new MemoryUpdateError("stale_snapshot", "记忆数据已更新，请刷新后重试。");
  if (status === "failed") {
    const reason = String(receipt.reason_code || "");
    if (reason === "stale_revision") throw new MemoryUpdateError("stale_revision", "记忆版本已更新，请刷新后重试。");
    if (reason === "target_not_found") throw new MemoryUpdateError("target_not_found", "记忆不存在或已失效。");
    if (reason === "unsupported_command") throw new MemoryUpdateError("unsupported_command", "Core 尚未启用手动修改记忆。");
    if (["provenance_mismatch", "invalid_patch", "idempotency_conflict"].includes(reason)) throw new MemoryUpdateError("invalid_envelope", "Core 拒绝了记忆修改绑定。");
    throw new MemoryUpdateError("unavailable", "Core 未执行记忆修改。");
  }
  const review = record(receipt.teacher_review);
  if (status !== "modified" || receipt.reason_code !== null || !exactList(receipt.applied_ids, [String(command.memory_id)]) || !exactList(receipt.rejected_ids, [])
    || typeof receipt.after_snapshot_id !== "string" || typeof receipt.after_state_hash !== "string" || receiptEnvelope.snapshot_id !== receipt.after_snapshot_id
    || !review || review.state !== "modified" || review.revision !== Number(command.expected_revision) + 1
    || review.reviewer_id !== record(envelope.teacher_review)?.reviewer_id || review.reviewed_at !== envelope.issued_at || review.note !== command.note) {
    throw new MemoryUpdateError("invalid_envelope", "Core 记忆修改成功回执无效。");
  }
  return receipt;
}

export async function issueMemoryUpdate(input: MemoryUpdateInput, dependencies: MemoryUpdateDependencies = {}): Promise<{ receipt: RawRecord; data: CoreEducationSnapshotPayload; memory: RawRecord }> {
  const supportedCommands = dependencies.supportedCommands || activeBridgeIdentity().contract.supported_commands;
  if (!supportedCommands.includes("update_memory")) throw new MemoryUpdateError("unsupported_command", "Core 尚未启用手动修改记忆。");
  const initial = await (dependencies.readSnapshot || (async () => {
    const snapshot = await readEduPiEducationSnapshot();
    return { payload: snapshot.payload, roots: { runtime: snapshot.runtime, dataRoot: snapshot.dataRoot } };
  }))();
  if (!exactList(record(initial.payload.capabilities)?.supported_commands, supportedCommands)) throw new MemoryUpdateError("unsupported_command", "Core 快照尚未启用手动修改记忆。");
  const beforeMemory = memoryFromPayload(initial.payload as unknown as RawRecord, text(input.memoryId, "memoryId", 160));
  const envelope = buildMemoryUpdateCommandEnvelope({ ...input, payload: initial.payload });
  const dispatch = dependencies.dispatch || ((nextEnvelope, roots) => callEduPiCore({ operation: "command", requestId: String(nextEnvelope.request_id), runtime: roots.runtime, dataRoot: roots.dataRoot, envelope: nextEnvelope }));
  let rawResponse: unknown;
  try { rawResponse = await dispatch(envelope, initial.roots); }
  catch (error) {
    if (error instanceof MemoryUpdateError) throw error;
    throw new MemoryUpdateError("unavailable", "Core 记忆修改暂不可用。");
  }
  const receipt = receiptFor(rawResponse, envelope, supportedCommands);
  const data = await (dependencies.refreshSnapshot || (async (roots) => (await readEduPiEducationSnapshot({ roots })).payload))(initial.roots);
  if (data.snapshot_id !== receipt.after_snapshot_id || data.state_hash !== receipt.after_state_hash) throw new MemoryUpdateError("invalid_envelope", "Core 记忆修改快照与回执不一致。");
  const updated = memoryFromPayload(data as unknown as RawRecord, String(record(envelope.command)?.memory_id));
  if (updated.content !== record(envelope.command)?.content || updated.revision !== Number(beforeMemory.revision) + 1) throw new MemoryUpdateError("invalid_envelope", "Core 刷新后的记忆内容无效。");
  return { receipt, data, memory: updated };
}
