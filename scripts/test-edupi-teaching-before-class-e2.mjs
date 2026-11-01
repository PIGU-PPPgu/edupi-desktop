#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createJiti } from "jiti";

const configuredCoreRoot = process.env.EDUPI_CORE_ROOT;
assert.ok(configuredCoreRoot && path.isAbsolute(configuredCoreRoot), "EDUPI_CORE_ROOT is required");
const coreRoot = fs.realpathSync(configuredCoreRoot);
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-teaching-before-class-e2-")));
const memoryDir = path.join(temp, ".edupi", "memory");
const outputDir = path.join(temp, ".edupi", "output");
const lockDir = path.join(temp, ".edupi", "locks");
const materialDir = path.join(temp, ".edupi", "inbox", "teacher-materials");
for (const directory of [memoryDir, outputDir, lockDir, materialDir]) fs.mkdirSync(directory, { recursive: true });

fs.writeFileSync(path.join(memoryDir, "calendar.json"), JSON.stringify({ events: [{ id: "week-1", name: "第1周 · 开学第一周", type: "teaching", date: "2026-08-31", end_date: "2026-09-06", source: "official_school_calendar", confidence: "confirmed" }] }));
fs.writeFileSync(path.join(memoryDir, "timetable.json"), JSON.stringify({ slots: [
  { id: "teacher_timetable_703_mon_2", day_of_week: 1, period: 2, subject: "数学", class_name: "703", kind: "class" },
  { id: "teacher_timetable_703_tue_1", day_of_week: 2, period: 1, subject: "数学", class_name: "703", kind: "class" },
  { id: "teacher_timetable_703_wed_2", day_of_week: 3, period: 2, subject: "数学", class_name: "703", kind: "class" },
  { id: "teacher_timetable_703_thu_1", day_of_week: 4, period: 1, subject: "数学", class_name: "703", kind: "class" },
  { id: "teacher_timetable_703_fri_1", day_of_week: 5, period: 1, subject: "数学", class_name: "703", kind: "class" },
  { id: "teacher_timetable_703_fri_2", day_of_week: 5, period: 2, subject: "数学", class_name: "703", kind: "class" },
] }));
fs.writeFileSync(path.join(memoryDir, "preferences.json"), JSON.stringify({ entries: [] }));
fs.writeFileSync(path.join(memoryDir, "semester.json"), JSON.stringify({ start_date: null, end_date: null, entries: [] }));
fs.writeFileSync(path.join(memoryDir, "subject_knowledge.json"), JSON.stringify({ 数学: { 一元一次方程: { mastery: 0.5, common_errors: [{ desc: "移项变号错误", students: ["赵六", "张三", "李四"] }], struggling_students: ["赵六", "张三", "李四"], updated_at: "2026-09-01T00:00:00.000Z" } } }));
const materialContent = "隔离七年级数学第一周课件：一元一次方程。";
const materialPath = ".edupi/inbox/teacher-materials/material-1.txt";
fs.writeFileSync(path.join(temp, materialPath), materialContent);
fs.writeFileSync(path.join(outputDir, "material_candidates.json"), JSON.stringify({ entries: [{ id: "material-1", title: "七年级数学第一周课件", subject: "数学", class_id: "703", file_path: materialPath }] }));
fs.writeFileSync(path.join(outputDir, "education_intake_state.json"), JSON.stringify({ schema_version: 1, updated_at: "2026-09-01T00:00:00.000Z",
  calendar_events: [], timetable_slots: [], materials: [{ material_id: "material-1", relative_path: materialPath,
    source_hash: `sha256:${crypto.createHash("sha256").update(materialContent).digest("hex")}`,
    expected_size_bytes: Buffer.byteLength(materialContent), intake_state: "accepted", subject: "数学", class_id: "703" }],
  receipts: [], review_history: [], review_targets: [], idempotency_records: [] }));

Object.assign(process.env, {
  EDUPI_CORE_ROOT: coreRoot,
  EDUPI_CORE_ALLOWED_ROOT: path.dirname(coreRoot),
  EDUPI_DATA_ROOT: temp,
  EDUPI_DATA_ALLOWED_ROOT: path.dirname(temp),
  EDUPI_PROJECT_ROOT: temp,
  EDUPI_MEMORY_DIR: memoryDir,
  EDUPI_OUTPUT_DIR: outputDir,
  EDUPI_LOCK_DIR: lockDir,
  EDUPI_HOME: path.join(temp, ".edupi"),
});

const heartbeatUrl = `${pathToFileURL(path.join(coreRoot, "scripts", "calendar_work_heartbeat.mjs")).href}?teaching_e2=${Date.now()}`;
const { run } = await import(heartbeatUrl);
const outputFor = (candidate) => JSON.stringify({ artifacts: candidate.deliverables.map((title) => ({ title, content: `# ${title}\n\n${candidate.summary}` })) });

const { prepareCoreRuntimeRoot } = await import(path.join(coreRoot, "scripts", "core_runtime_root.mjs"));
const { acquireCoreRuntimeWriterAdmission } = await import(path.join(coreRoot, "scripts", "core_runtime_writer_admission.mjs"));
const { reviewG1Excerpt } = await import(path.join(coreRoot, "scripts", "core_runtime_g1_excerpts.mjs"));
const { loadCalendarWorkExecutionState } = await import(path.join(coreRoot, "scripts", "calendar_work_execution_store.mjs"));
const preparedRoot = prepareCoreRuntimeRoot(temp);
assert.equal(preparedRoot.ok, true, JSON.stringify(preparedRoot));
const admission = await acquireCoreRuntimeWriterAdmission({ root: preparedRoot, kind: "legacy_teaching_before_class_e2", busyTimeoutMs: 250 });

try {
  reviewG1Excerpt({ materialId: "material-1", subject: "数学", classId: "703", expectedRevision: 0,
    content: materialContent, reviewer: "synthetic-teacher", decision: "confirm" });
  await assert.rejects(() => run({ today: "2026-09-02", horizonDays: 2, now: "2026-09-02T12:00:00.000Z", outputDir }), (error) => error?.code === "model_unavailable");
  let modelCalls = 0;
  const firstRun = await run({ today: "2026-09-02", horizonDays: 2, now: "2026-09-02T12:00:00.000Z", outputDir, runModel: async ({ candidate }) => { modelCalls += 1; return outputFor(candidate); } });
  assert.equal(firstRun.due_count, 4);
  assert.equal(firstRun.draft_ready_count, 2);
  assert.equal(firstRun.skipped_count, 2);
  assert.equal(modelCalls, 2);
  assert.equal(firstRun.external_send, false);

  const { GET } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("../app/api/edupi/education/route.ts");
  const read = async () => { const response = await GET(); const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); return data; };
  const first = await read();
  const teachingTasks = first.tasks.filter((task) => task.trigger === "teaching_before_class");
  const teachingCases = first.workCases.filter((workCase) => workCase.kind === "teaching_before_class");
  assert.equal(teachingTasks.length, 6);
  assert.equal(teachingCases.length, 6);
  // This legacy direct heartbeat has no Live G1 source binding. Even with a
  // current accepted material and confirmed excerpt, its output stays hidden.
  // The current positive Desktop/Core path is test-edupi-visible-material-preparation-e2.mjs.
  const legacyExecutions = loadCalendarWorkExecutionState({ outputDir }).executions;
  assert.equal(legacyExecutions.filter(item => item.status === "draft_ready").length, 2);
  assert.equal(legacyExecutions.every(item => !item.source_signature && !item.source_content_signature), true);
  assert.equal(teachingCases.every(item => item.currentState === "planned" && item.artifactIds.length === 0), true);
  assert.equal(teachingTasks.every((task) => String(task.evidence.source_summary || "").includes("一元一次方程")
    && String(task.evidence.source_summary || "").includes("移项变号错误")
    && String(task.evidence.source_summary || "").includes("material-1.txt")), true);
  assert.deepEqual((await read()).workCases, first.workCases, "restart/reload keeps lesson occurrence and flow identities stable");

  const fridayRun = await run({ today: "2026-09-03", horizonDays: 1, now: "2026-09-03T12:00:00.000Z", outputDir, runModel: async ({ candidate }) => { modelCalls += 1; return outputFor(candidate); } });
  assert.equal(fridayRun.execution_results.filter((result) => result.status === "draft_ready" && result.replayed === false).length, 2);
  assert.equal(modelCalls, 4);
  const final = await read();
  assert.equal(final.workCases.filter((workCase) => workCase.kind === "teaching_before_class")
    .every(workCase => workCase.currentState === "planned" && workCase.artifactIds.length === 0), true);
  assert.equal(final.workCases.every((workCase) => workCase.externalSend === false), true);
  console.log(JSON.stringify({ status: "passed", timetable_periods: 6, work_cases: 6, unbound_legacy_drafts_hidden: 4,
    model_unavailable_visible: true, replay_stable: true, external_send: false }));
} finally {
  await admission.release();
  fs.rmSync(temp, { recursive: true, force: true });
}
