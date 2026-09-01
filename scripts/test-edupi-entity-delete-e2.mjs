#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";

const configuredCoreRoot = process.env.EDUPI_CORE_ROOT;
assert.ok(configuredCoreRoot && path.isAbsolute(configuredCoreRoot), "EDUPI_CORE_ROOT is required");
const coreRoot = fs.realpathSync(configuredCoreRoot);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-entity-delete-e2-"));
const memoryDir = path.join(temp, ".edupi", "memory");
const outputDir = path.join(temp, ".edupi", "output");
const lockDir = path.join(temp, ".edupi", "locks");
for (const directory of [memoryDir, outputDir, lockDir]) fs.mkdirSync(directory, { recursive: true });

const sources = {
  preferences: path.join(memoryDir, "preferences.json"),
  students: path.join(memoryDir, "student_profiles.json"),
  calendar: path.join(memoryDir, "calendar.json"),
  timetable: path.join(memoryDir, "timetable.json"),
  tasks: path.join(outputDir, "rhythm_plan.json"),
  intake: path.join(outputDir, "education_intake_state.json"),
};
fs.writeFileSync(sources.preferences, JSON.stringify({ entries: [{ id: "memory-delete-1", content: "称呼我为吴老师", tags: ["称呼"], count: 1 }] }));
fs.writeFileSync(sources.students, JSON.stringify({ students: { 李四: { name: "李四", traits: ["认真"], parent_notes: [], error_patterns: [], trajectory: [], created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z" } }, updated_at: "2026-09-01T00:00:00.000Z" }));
fs.writeFileSync(sources.calendar, JSON.stringify({ events: [{ id: "calendar-delete-1", date: "2026-09-01", name: "开学", type: "custom", source: "teacher", confidence: "teacher_confirmed" }] }));
fs.writeFileSync(sources.timetable, JSON.stringify({ slots: [{ id: "slot-delete-1", day_of_week: 1, period: 1, subject: "数学", class_name: "703", kind: "class" }] }));
fs.writeFileSync(sources.tasks, JSON.stringify({ tasks: [{ id: "task-delete-1", title: "准备第一课", status: "planned", scope: "teacher_internal", requires_teacher_review: true, external_send: false }] }));
fs.writeFileSync(sources.intake, JSON.stringify({ schema_version: 1, updated_at: "2026-09-01T00:00:00.000Z", calendar_events: [], timetable_slots: [], materials: [], receipts: [], review_history: [], review_targets: [{ projection_kind: "material_intake", target: { target_kind: "material_intake", target_id: "material-target-1", command_type: "intake_material" }, revision: 1, title: "第一课教案", summary: "已接收材料：第一课教案", status: "accepted", source_ids: ["material-source-1"], evidence_ids: ["material-evidence-1"], teacher_review: { state: "accepted", reviewer_id: "teacher", reviewed_at: "2026-09-01T00:00:00.000Z", note: null, revision: 1 }, external_send: false, staging_id: "stg_00000000000000000000000000000001", source_hash: `sha256:${"a".repeat(64)}`, expected_size_bytes: 1, intake_state: "accepted" }], idempotency_records: [] }));
const originalSources = Object.fromEntries(Object.entries(sources).map(([key, file]) => [key, fs.readFileSync(file, "utf8")]));

Object.assign(process.env, {
  EDUPI_CORE_ROOT: coreRoot,
  EDUPI_CORE_ALLOWED_ROOT: path.dirname(coreRoot),
  EDUPI_DATA_ROOT: temp,
  EDUPI_DATA_ALLOWED_ROOT: path.dirname(temp),
  EDUPI_PROJECT_ROOT: temp,
  EDUPI_MEMORY_DIR: memoryDir,
  EDUPI_OUTPUT_DIR: outputDir,
  EDUPI_LOCK_DIR: lockDir,
});

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { DELETE } = await jiti.import("../app/api/edupi/entities/[kind]/[id]/route.ts");
const { GET } = await jiti.import("../app/api/edupi/education/route.ts");

function request(kind, id) {
  return new Request(`http://localhost/api/edupi/entities/${kind}/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ note: null }),
  });
}

function hasTarget(data, kind, id) {
  if (kind === "calendar") return data.calendar.some((item) => item.id === id);
  if (kind === "timetable") return data.timetable.some((item) => String(item.slot_id ?? item.id) === id);
  if (kind === "memory") return data.continuity.memories.some((item) => item.id === id);
  if (kind === "student") return data.students.some((item) => item.name === id);
  if (kind === "material") return data.intakeTargets.some((item) => item.targetId === id);
  return data.tasks.some((item) => item.id === id);
}

try {
  const targets = [
    ["calendar", "calendar-delete-1"],
    ["timetable", "slot-delete-1"],
    ["memory", "memory-delete-1"],
    ["student", "李四"],
    ["task", "task-delete-1"],
    ["material", "material-target-1"],
  ];
  let data = await (await GET()).json();
  for (const [kind, id] of targets) {
    assert.equal(hasTarget(data, kind, id), true, `${kind} fixture should exist before deletion`);
    const response = await DELETE(request(kind, id), { params: Promise.resolve({ kind, id }) });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    data = result.data;
    assert.equal(hasTarget(data, kind, id), false, `${kind} should disappear from the refreshed projection`);
  }
  const retryResponse = await DELETE(request("calendar", "calendar-delete-1"), { params: Promise.resolve({ kind: "calendar", id: "calendar-delete-1" }) });
  const retryResult = await retryResponse.json();
  assert.equal(retryResponse.status, 200, JSON.stringify(retryResult));
  assert.equal(hasTarget(retryResult.data, "calendar", "calendar-delete-1"), false);
  for (const [key, file] of Object.entries(sources)) assert.equal(fs.readFileSync(file, "utf8"), originalSources[key], `${key} source bytes must remain recoverable`);
  const audit = JSON.parse(fs.readFileSync(path.join(outputDir, "entity_delete_state.json"), "utf8"));
  assert.equal(audit.records.length, 6);
  console.log(JSON.stringify({ status: "passed", deleted: audit.records.length, retry_reconciled: true, source_bytes_preserved: true }));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
