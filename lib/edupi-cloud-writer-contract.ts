import { randomUUID } from "node:crypto";
import manifest from "../contracts/edupi-cloud-writer-v1.json" with { type: "json" };

// These identify the deployed Postgres writer and its command envelope.
// Local Core compatibility is pinned separately in edupi-core-compat.json.
export const EDUPI_CLOUD_WRITER_CONTRACT = Object.freeze({
  contract_id: manifest.contract_id,
  contract_version: manifest.contract_version,
  schema_hash: manifest.schema_hash,
  core_commit: manifest.core_commit,
});
export const EDUPI_CLOUD_BRIDGE_CONTRACT = Object.freeze({ ...manifest.bridge_contract });

type RawRecord = Record<string, unknown>;
type CloudTaskSource = {
  source_id: string;
  source_kind: "teacher_message";
  source_hash: string;
  evidence_ids: string[];
};
export type CloudTaskCommand = {
  command_type: "create_task";
  source: CloudTaskSource;
  task: {
    task_id: string;
    title: string;
    due_date: string | null;
    note: string | null;
    preparation_source?: null;
    recurrence?: null;
  };
} | {
  command_type: "move_task_stage";
  source: CloudTaskSource;
  task_id: string;
  expected_revision: number;
  to_stage: "todo" | "progress" | "review" | "done";
  note: string | null;
};
export type CloudTaskEnvelope = {
  contract_version: string;
  message_id: string;
  request_id: string;
  issued_at: string;
  producer: "edupi-desktop";
  schema_hash: string;
  snapshot_id: string;
  idempotency_key: string;
  provenance: Array<{
    source_kind: "teacher_message";
    source_id: string;
    source_path: null;
    source_hash: string;
    observed_at: string;
    actor: "teacher";
    evidence_ids: string[];
    parent_ids: [];
  }>;
  teacher_review: {
    state: "pending_review";
    reviewer_id: null;
    reviewed_at: null;
    note: null;
    revision: number;
  };
  external_send: false;
  command: CloudTaskCommand;
};

export class EduPiCloudWriterContractError extends Error {
  readonly code: "unsupported_contract" | "unsupported_command" | "invalid_envelope";

  constructor(code: EduPiCloudWriterContractError["code"], message: string) {
    super(message);
    this.name = "EduPiCloudWriterContractError";
    this.code = code;
  }
}

function invalid(field: string): never {
  throw new EduPiCloudWriterContractError("invalid_envelope", `云端任务字段无效：${field}`);
}

function record(value: unknown): value is RawRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function shape(value: unknown, required: readonly string[], optional: readonly string[] = []): RawRecord {
  if (!record(value)) invalid("object");
  const allowed = [...required, ...optional];
  if (required.some((key) => !Object.hasOwn(value, key))
    || Reflect.ownKeys(value).some((key) => typeof key !== "string" || !allowed.includes(key)
      || !Object.getOwnPropertyDescriptor(value, key)?.enumerable
      || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"))) {
    invalid("fields");
  }
  return value;
}

// Detect paths even inside a note; ordinary fractions and HTTPS links remain text.
const LOCAL_PATH = /(?:file:|(?<![a-z])[a-z]:[\\/]|\\\\|(?:^|[\s"'`(=:\p{Script=Han}：“‘「])(?:~[\\/]|\.{1,2}[\\/]|\/(?!\/))\S|(?:^|[\s"'`(=])\/\/\S)/iu;

function text(value: unknown, field: string, max: number, multiline = false, empty = false): string {
  if (typeof value !== "string" || (!empty && !value.trim()) || value.length > max
    || (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u).test(value)
    || LOCAL_PATH.test(value)) invalid(field);
  return value;
}

function nullableNote(value: unknown): string | null {
  return value === null ? null : text(value, "note", 1000, true, true);
}

function date(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)
    || Number(value.slice(0, 4)) < 1) invalid("date");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) invalid("date");
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/u.test(value)) invalid("issued_at");
  date(value.slice(0, 10));
  return value;
}

function evidenceIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 50) invalid("evidence_ids");
  const result: string[] = [];
  for (let index = 0; index < value.length; index++) {
    result.push(text(value[index], "evidence_id", 160));
  }
  return result;
}

function source(value: unknown): CloudTaskSource {
  const input = shape(value, ["source_id", "source_kind", "source_hash", "evidence_ids"]);
  if (input.source_kind !== "teacher_message") invalid("source_kind");
  if (typeof input.source_hash !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(input.source_hash)) invalid("source_hash");
  return {
    source_id: text(input.source_id, "source_id", 160),
    source_kind: "teacher_message",
    source_hash: input.source_hash,
    evidence_ids: evidenceIds(input.evidence_ids),
  };
}

function taskCommand(value: unknown): CloudTaskCommand {
  if (!record(value) || !Object.hasOwn(value, "command_type")) invalid("command");
  if (value.command_type !== "create_task" && value.command_type !== "move_task_stage") {
    throw new EduPiCloudWriterContractError("unsupported_command", "云端只支持普通任务的创建和阶段更新");
  }
  if (value.command_type === "create_task") {
    const input = shape(value, ["command_type", "source", "task"]);
    const task = shape(input.task, ["task_id", "title", "due_date", "note"], ["preparation_source", "recurrence"]);
    for (const key of ["preparation_source", "recurrence"]) {
      if (Object.hasOwn(task, key) && task[key] !== null) invalid(key);
    }
    return {
      command_type: "create_task",
      source: source(input.source),
      task: {
        task_id: text(task.task_id, "task_id", 160),
        title: text(task.title, "title", 240),
        due_date: task.due_date === null ? null : date(task.due_date),
        note: nullableNote(task.note),
        ...(Object.hasOwn(task, "preparation_source") ? { preparation_source: null } : {}),
        ...(Object.hasOwn(task, "recurrence") ? { recurrence: null } : {}),
      },
    };
  }
  const input = shape(value, ["command_type", "source", "task_id", "expected_revision", "to_stage", "note"]);
  if (typeof input.expected_revision !== "number" || !Number.isInteger(input.expected_revision)
    || input.expected_revision < 0 || input.expected_revision > 2147483646) invalid("expected_revision");
  const stage = input.to_stage;
  if (stage !== "todo" && stage !== "progress" && stage !== "review" && stage !== "done") invalid("to_stage");
  return {
    command_type: "move_task_stage",
    source: source(input.source),
    task_id: text(input.task_id, "task_id", 160),
    expected_revision: input.expected_revision,
    to_stage: stage,
    note: nullableNote(input.note),
  };
}

export function assertCloudWriterContract(value: unknown): asserts value is typeof EDUPI_CLOUD_WRITER_CONTRACT {
  if (!record(value) || Object.entries(EDUPI_CLOUD_WRITER_CONTRACT).some(([key, expected]) => value[key] !== expected)) {
    throw new EduPiCloudWriterContractError("unsupported_contract", "云端 writer identity 不受支持");
  }
}

export function assertCloudTaskEnvelope(value: unknown): asserts value is CloudTaskEnvelope {
  const envelope = shape(value, [
    "contract_version", "message_id", "request_id", "issued_at", "producer", "schema_hash",
    "snapshot_id", "idempotency_key", "provenance", "teacher_review", "external_send", "command",
  ]);
  if (envelope.contract_version !== EDUPI_CLOUD_BRIDGE_CONTRACT.contract_version
    || envelope.schema_hash !== EDUPI_CLOUD_BRIDGE_CONTRACT.schema_hash
    || envelope.producer !== "edupi-desktop" || envelope.external_send !== false) invalid("identity");
  for (const key of ["message_id", "request_id", "snapshot_id", "idempotency_key"]) text(envelope[key], key, 160);
  const issuedAt = timestamp(envelope.issued_at);
  const command = taskCommand(envelope.command);
  if (!Array.isArray(envelope.provenance) || envelope.provenance.length !== 1) invalid("provenance");
  const provenance = shape(envelope.provenance[0], [
    "source_kind", "source_id", "source_path", "source_hash", "observed_at", "actor", "evidence_ids", "parent_ids",
  ]);
  const evidence = evidenceIds(provenance.evidence_ids);
  if (provenance.source_kind !== command.source.source_kind || provenance.source_id !== command.source.source_id
    || provenance.source_hash !== command.source.source_hash || provenance.source_path !== null
    || provenance.observed_at !== issuedAt || provenance.actor !== "teacher"
    || !Array.isArray(provenance.parent_ids) || provenance.parent_ids.length !== 0
    || evidence.length !== command.source.evidence_ids.length
    || evidence.some((id, index) => id !== command.source.evidence_ids[index])) invalid("provenance");
  const review = shape(envelope.teacher_review, ["state", "reviewer_id", "reviewed_at", "note", "revision"]);
  if (review.state !== "pending_review" || review.reviewer_id !== null || review.reviewed_at !== null || review.note !== null
    || review.revision !== (command.command_type === "create_task" ? 0 : command.expected_revision)) invalid("teacher_review");
}

export function buildCloudTaskEnvelope(options: {
  snapshotId: string;
  command: unknown;
  requestId: string;
  idempotencyKey: string;
  issuedAt?: string;
  messageId?: string;
}): CloudTaskEnvelope {
  const input = shape(options, ["snapshotId", "command", "requestId", "idempotencyKey"], ["issuedAt", "messageId"]);
  const command = taskCommand(input.command);
  const issuedAt = input.issuedAt === undefined ? new Date().toISOString() : timestamp(input.issuedAt);
  const envelope: CloudTaskEnvelope = {
    contract_version: EDUPI_CLOUD_BRIDGE_CONTRACT.contract_version,
    message_id: input.messageId === undefined ? `cloud-task-message-${randomUUID()}` : text(input.messageId, "messageId", 160),
    request_id: text(input.requestId, "requestId", 160),
    issued_at: issuedAt,
    producer: "edupi-desktop",
    schema_hash: EDUPI_CLOUD_BRIDGE_CONTRACT.schema_hash,
    snapshot_id: text(input.snapshotId, "snapshotId", 160),
    idempotency_key: text(input.idempotencyKey, "idempotencyKey", 160),
    provenance: [{
      source_kind: command.source.source_kind,
      source_id: command.source.source_id,
      source_path: null,
      source_hash: command.source.source_hash,
      observed_at: issuedAt,
      actor: "teacher",
      evidence_ids: [...command.source.evidence_ids],
      parent_ids: [],
    }],
    teacher_review: {
      state: "pending_review", reviewer_id: null, reviewed_at: null, note: null,
      revision: command.command_type === "create_task" ? 0 : command.expected_revision,
    },
    external_send: false,
    command,
  };
  assertCloudTaskEnvelope(envelope);
  return envelope;
}
