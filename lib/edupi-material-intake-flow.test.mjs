import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const flow = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-material-intake-flow.ts");

const pdfDescriptor = {
  staging_id: "stg_00000000000000000000000000000001",
  staging_path: "/desktop-state/material-staging/stg_00000000000000000000000000000001/material.pdf",
  original_name: "校历和课表.pdf",
  expected_size_bytes: 128,
  source_hash: `sha256:${"a".repeat(64)}`,
  kind: "pdf",
  source_scope: "desktop_staging",
};
const descriptor = { ...pdfDescriptor, kind: "word", original_name: "校历和课表.docx",
  staging_path: pdfDescriptor.staging_path.replace(/\.pdf$/u, ".docx") };

test("new file receipt never runs a Desktop parser or submits arrangements for any format", async () => {
  for (const [kind, extension] of [["calendar", "ics"], ["word", "docx"], ["word", "doc"], ["pdf", "pdf"], ["image", "png"]]) {
    const commands = [];
    const result = await flow.intakeRecognizedMaterial({ descriptor: { ...pdfDescriptor, kind,
      staging_path: pdfDescriptor.staging_path.replace(/\.pdf$/u, `.${extension}`) },
    materialKind: "other", subject: null, classId: null, recognize: true }, {
      recognize: async () => { throw new Error("new file receipt must not run Desktop recognition"); },
      issue: async command => { commands.push(command); return { receipt: { status: "accepted" }, data: {} }; },
    });
    assert.deepEqual(commands.map(command => command.command_type), ["intake_material"]);
    assert.deepEqual(result.recognition, { eventCount: 0, slotCount: 0 });
    assert.deepEqual(result.calendarOccurrences, []); assert.deepEqual(result.cancelledOccurrenceRefs, []);
  }
});

test("a direct legacy source binding cannot silently become a new file receipt", async () => {
  let writes = 0;
  await assert.rejects(flow.intakeRecognizedMaterial({ descriptor, scheduleSourceId: `document-source-${"2".repeat(32)}`,
    materialKind: "other", subject: null, classId: null }, { recognize: async () => ({ events: [], slots: [] }),
    issue: async () => { writes++; return { receipt: { status: "accepted" }, data: {} }; } }),
  error => error.code === "file_schedule_update_unavailable");
  assert.equal(writes, 0);
});

test("receipt-only intake preserves each read-only proposal state without importing schedule facts", async () => {
  const descriptor = pdfDescriptor;
  for (const status of ["proposed", "held", "unavailable"]) {
    const commands = [];
    const materialId = `material-${descriptor.staging_id.slice(4)}`;
    const flags = { read_only: true, automatic_import: false, external_send: false };
    const read = {
      version: 1, root_ref: `sha256:${"b".repeat(64)}`, owner_id: `owner_${"c".repeat(32)}`,
      source: { material_id: materialId, review_target_id: "intake-material-target", staging_id: descriptor.staging_id,
        source_hash: descriptor.source_hash, expected_size_bytes: 128, relative_path: ".edupi/inbox/teacher-materials/source.pdf",
        intake_state: "accepted", metadata_revision: 0, metadata_head_hash: `sha256:${"d".repeat(64)}`,
        metadata: { title: "合成校历", kind: "other", subject: "数学", class_id: "class-7-2" },
        review_target: { status: "accepted", revision: 0, teacher_review_state: "accepted", teacher_review_revision: 0 } },
      options: { default_time_zone: null, window_start: null, window_end: null, max_occurrences: 200 },
      status: status === "proposed" ? "ready" : "unresolved",
      events: status === "proposed" ? [{ event_id: "schedule-event", date: "2026-10-15", end_date: null,
        name: "合成教研", type: "meeting", confidence: "inferred", notes: null, location: null }] : [],
      issues: status === "proposed" ? [] : [{ code: "missing_time_zone", path: "schedule.time_zone", message: "缺少时区" }],
      evidence: [], parse_fingerprint: `sha256:${"e".repeat(64)}`, ...flags,
    };
    const proposal = { status, material_id: materialId, read_result: status === "unavailable" ? null : read,
      reason_code: status === "proposed" ? null : status === "held" ? "material_schedule_unresolved" : "owner_control_disabled", ...flags };
    const receipt = { command_type: "intake_material", status: "accepted", applied_ids: [materialId] };
    const result = await flow.intakeRecognizedMaterial({ descriptor, materialKind: "other", subject: "数学", classId: "class-7-2", recognize: false }, {
      recognize: async () => { throw new Error("receipt-only intake must not run the Desktop parser"); },
      issue: async command => { commands.push(command); return { receipt, data: { snapshot_id: "accepted-file" }, materialScheduleProposal: proposal }; },
    });
    assert.deepEqual(commands.map(command => command.command_type), ["intake_material"]);
    assert.deepEqual(result.receipts, [receipt]);
    assert.deepEqual(result.materialScheduleProposal, proposal);
    assert.deepEqual(result.recognition, { eventCount: 0, slotCount: 0 });
    assert.equal(result.scheduleNeedsReview, false, "proposal status remains separate from legacy schedule-import receipts");
  }
});

test("receipt-only DOCX intake forwards the lesson candidate without preparing or importing", async () => {
  const docx = { ...descriptor, kind: "word", staging_path: descriptor.staging_path.replace(".pdf", ".docx"), original_name: "授课教案.docx" };
  const materialId = `material-${docx.staging_id.slice(4)}`;
  const lesson = { status: "held", material_id: materialId, lesson: null, reason_code: "lesson_date_required",
    read_only: true, automatic_prepare: false, external_send: false };
  const commands = [];
  const result = await flow.intakeRecognizedMaterial({ descriptor: docx, materialKind: "lesson_note",
    subject: "数学", classId: "class-7-2", recognize: false }, {
    recognize: async () => { throw new Error("receipt-only must not run Desktop recognition"); },
    issue: async command => { commands.push(command); return { receipt: { status: "accepted", applied_ids: [materialId] },
      data: { snapshot_id: "accepted-docx" }, materialLessonProposal: lesson }; },
  });
  assert.deepEqual(commands.map(command => command.command_type), ["intake_material"]);
  assert.deepEqual(result.materialLessonProposal, lesson);
  assert.equal(result.materialScheduleProposal, undefined);
  assert.equal(result.scheduleNeedsReview, false);
});

test("cancelled receipt submission does not retry or generate a second command", async () => {
  const commands = [];
  await assert.rejects(flow.intakeRecognizedMaterial({ descriptor, materialKind: "other", subject: null, classId: null }, {
    issue: async command => { commands.push(command); throw new DOMException("cancelled", "AbortError"); },
  }), { name: "AbortError" });
  assert.deepEqual(commands.map(command => command.command_type), ["intake_material"]);
});

test("file replay retains material identity and never upgrades caller-provided facts or authority", async () => {
  const commands = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await flow.intakeRecognizedMaterial({ descriptor, materialKind: "lesson_note", subject: "数学", classId: "class-7-2",
      source: { source_kind: "teacher_message" }, events: [{ confidence: "teacher_confirmed" }], recognize: true }, {
      issue: async command => { commands.push(command); return { receipt: { status: "accepted", reason_code: attempt ? "already_applied" : null }, data: {} }; },
    });
    assert.equal(result.receipts.length, 1);
    assert.equal(result.scheduleNeedsReview, false, "file receipt and arrangement review remain distinct");
    assert.deepEqual(result.recognition, { eventCount: 0, slotCount: 0 });
  }
  assert.deepEqual(commands[0], commands[1]);
  assert.equal(commands[0].source.source_kind, "teacher_file");
  assert.equal(commands[0].source.source_hash, descriptor.source_hash);
  assert.deepEqual(commands.map(command => command.command_type), ["intake_material", "intake_material"]);
});
