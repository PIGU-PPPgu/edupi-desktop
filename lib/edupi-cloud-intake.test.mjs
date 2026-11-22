import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const intake = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-cloud-intake.ts");

const source = {
  source_id: "stg_0123456789abcdef0123456789abcdef",
  source_kind: "teacher_file",
  source_hash: `sha256:${"a".repeat(64)}`,
  evidence_ids: ["stg_0123456789abcdef0123456789abcdef"],
};

test("cloud intake envelopes use the cloud writer identity and remove local material paths", () => {
  const envelope = intake.buildCloudIntakeEnvelope({
    snapshotId: "snapshot-before",
    requestId: "cloud-intake-request",
    idempotencyKey: "cloud-intake-idempotency",
    issuedAt: "2026-11-22T10:00:00.000Z",
    command: {
      command_type: "intake_material",
      source,
      material: {
        material_id: "material-0123456789abcdef0123456789abcdef",
        staging_id: source.source_id,
        staging_path: "/Users/private/material.pdf",
        source_path: null,
        source_hash: source.source_hash,
        expected_size_bytes: 12,
        kind: "other",
        title: "云端材料",
        subject: "数学",
        class_id: "703",
        source_scope: "desktop_staging",
      },
    },
    storageObjectKey: "workspace/material/material-0123456789abcdef0123456789abcdef/material.pdf",
  });

  assert.equal(envelope.schema_hash, "sha256:2749b1208b47bf475bd30d266b5ca1b213aa78c6c8b4dcd53059c524400565c8");
  assert.equal(envelope.command.material.storage_object_key, "workspace/material/material-0123456789abcdef0123456789abcdef/material.pdf");
  assert.equal(envelope.command.material.source_scope, "approved_import");
  assert.equal("staging_path" in envelope.command.material, false);
  assert.equal("source_path" in envelope.command.material, false);
  assert.doesNotMatch(JSON.stringify(envelope), /Users\/private/u);
});

test("cloud intake preserves stable calendar and timetable identities", () => {
  const calendar = intake.buildCloudIntakeEnvelope({
    snapshotId: "snapshot-before",
    requestId: "calendar-request",
    idempotencyKey: "calendar-idempotency",
    issuedAt: "2026-11-22T10:00:00.000Z",
    command: {
      command_type: "import_calendar",
      source: { ...source, source_kind: "teacher_message" },
      events: [{
        event_id: "calendar-event-1",
        date: "2026-11-24",
        end_date: null,
        name: "阶段测验",
        type: "exam",
        confidence: "teacher_confirmed",
        notes: null,
      }],
    },
  });
  const timetable = intake.buildCloudIntakeEnvelope({
    snapshotId: "snapshot-before",
    requestId: "timetable-request",
    idempotencyKey: "timetable-idempotency",
    issuedAt: "2026-11-22T10:00:00.000Z",
    command: {
      command_type: "import_timetable",
      source: { ...source, source_kind: "teacher_message" },
      slots: [{
        slot_id: "slot-1",
        day_of_week: 1,
        period: 1,
        subject: "数学",
        class_name: "703",
        kind: "class",
        notes: null,
      }],
    },
  });

  assert.equal(calendar.command.events[0].event_id, "calendar-event-1");
  assert.equal(timetable.command.slots[0].slot_id, "slot-1");
  assert.equal(calendar.provenance[0].source_path, null);
  assert.equal(timetable.provenance[0].source_path, null);
});
