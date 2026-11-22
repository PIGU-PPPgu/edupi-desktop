import { createHash, randomUUID } from "node:crypto";
import type { EducationIntakeCommand } from "./edupi-education-intake.ts";
import { EDUPI_CLOUD_BRIDGE_CONTRACT } from "./edupi-cloud-writer-contract.ts";

type RawRecord = Record<string, unknown>;
const contentHash = (value: unknown) =>
  `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;

function record(value: unknown): RawRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : {};
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`云端教育导入字段无效：${field}`);
  }
  return value.trim();
}

function nullableText(value: unknown, field: string, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`云端教育导入字段无效：${field}`);
  }
  return value.trim() || null;
}

function source(command: EducationIntakeCommand): RawRecord {
  return {
    source_id: text(command.source.source_id, "source_id", 160),
    source_kind: command.source.source_kind,
    source_hash: text(command.source.source_hash, "source_hash", 160),
    evidence_ids: command.source.evidence_ids.map((value) => text(value, "evidence_id", 160)),
  };
}

/**
 * Remove local staging paths before a command can cross the cloud boundary.
 * The cloud writer stores the command envelope in receipts and audit rows, so
 * a local path must never be included even when the local intake command has it.
 */
export function sanitizeCloudIntakeCommand(
  command: EducationIntakeCommand,
  options: { storageObjectKey?: string } = {},
): RawRecord {
  const base = { command_type: command.command_type, source: source(command) };
  if (command.command_type === "import_calendar") {
    return {
      ...base,
      events: command.events.map((event) => ({
        event_id: text(event.event_id, "event_id", 160),
        date: text(event.date, "date", 32),
        end_date: event.end_date === null ? null : text(event.end_date, "end_date", 32),
        name: text(event.name, "name", 240),
        type: text(event.type, "type", 40),
        confidence: text(event.confidence, "confidence", 40),
        notes: nullableText(event.notes, "notes", 1000),
        ...(event.source_occurrence_ref ? { source_occurrence_ref: text(event.source_occurrence_ref, "source_occurrence_ref", 160) } : {}),
        ...(event.time_interval ? {
          time_interval: {
            start: text(event.time_interval.start, "time_interval.start", 32),
            end: text(event.time_interval.end, "time_interval.end", 32),
            time_zone: text(event.time_interval.time_zone, "time_interval.time_zone", 100),
          },
        } : {}),
        ...(event.location !== undefined ? { location: nullableText(event.location, "location", 240) } : {}),
      })),
    };
  }
  if (command.command_type === "import_timetable") {
    return {
      ...base,
      slots: command.slots.map((slot) => ({
        slot_id: text(slot.slot_id, "slot_id", 160),
        day_of_week: slot.day_of_week,
        period: slot.period,
        subject: text(slot.subject, "subject", 120),
        ...(slot.class_id ? { class_id: text(slot.class_id, "class_id", 128) } : {}),
        class_name: nullableText(slot.class_name, "class_name", 120),
        ...(slot.start_time ? { start_time: text(slot.start_time, "start_time", 5) } : {}),
        ...(slot.time_zone ? { time_zone: text(slot.time_zone, "time_zone", 100) } : {}),
        kind: text(slot.kind, "kind", 20),
        notes: nullableText(slot.notes, "notes", 1000),
      })),
    };
  }

  const material = record(command.material);
  const storageObjectKey = options.storageObjectKey
    ? text(options.storageObjectKey, "storage_object_key", 500)
    : null;
  return {
    ...base,
    material: {
      material_id: text(material.material_id, "material_id", 160),
      title: text(material.title, "title", 240),
      kind: text(material.kind, "kind", 40),
      subject: nullableText(material.subject, "subject", 120),
      class_id: nullableText(material.class_id, "class_id", 160),
      source_hash: text(material.source_hash, "source_hash", 160),
      expected_size_bytes: material.expected_size_bytes,
      source_scope: "approved_import",
      ...(storageObjectKey ? {
        storage_bucket: "edupi-materials",
        storage_object_key: storageObjectKey,
        relative_path: `cloud-storage:${storageObjectKey}`,
      } : {}),
    },
  };
}

export function buildCloudIntakeEnvelope(options: {
  snapshotId: string;
  command: EducationIntakeCommand;
  storageObjectKey?: string;
  requestId: string;
  idempotencyKey: string;
  issuedAt?: string;
  messageId?: string;
}): RawRecord {
  const issuedAt = options.issuedAt || new Date().toISOString();
  const command = sanitizeCloudIntakeCommand(options.command, { storageObjectKey: options.storageObjectKey });
  const commandSource = record(command.source);
  return {
    contract_version: EDUPI_CLOUD_BRIDGE_CONTRACT.contract_version,
    message_id: options.messageId || `cloud-intake-message-${randomUUID()}`,
    request_id: text(options.requestId, "request_id", 160),
    issued_at: text(issuedAt, "issued_at", 64),
    producer: "edupi-desktop",
    schema_hash: EDUPI_CLOUD_BRIDGE_CONTRACT.schema_hash,
    snapshot_id: text(options.snapshotId, "snapshot_id", 160),
    idempotency_key: text(options.idempotencyKey, "idempotency_key", 160),
    provenance: [{
      source_kind: commandSource.source_kind,
      source_id: commandSource.source_id,
      source_path: null,
      source_hash: commandSource.source_hash,
      observed_at: issuedAt,
      actor: "teacher",
      evidence_ids: [...commandSource.evidence_ids as string[]],
      parent_ids: [],
    }],
    teacher_review: {
      state: "pending_review",
      reviewer_id: null,
      reviewed_at: null,
      note: null,
      revision: 0,
    },
    external_send: false,
    command,
  };
}

export function cloudMaterialIntakeIdentity(command: EducationIntakeCommand): {
  requestId: string;
  idempotencyKey: string;
} {
  if (command.command_type !== "intake_material") throw new Error("材料接入请求类型无效");
  const idempotencyKey = `sha256:${contentHash(command).slice("sha256:".length)}`;
  return {
    requestId: `cloud-intake-material-${idempotencyKey.slice("sha256:".length)}`,
    idempotencyKey,
  };
}
