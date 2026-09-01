#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createJiti } from "jiti";

const configuredCoreRoot = process.env.EDUPI_CORE_ROOT;
assert.ok(configuredCoreRoot && path.isAbsolute(configuredCoreRoot), "EDUPI_CORE_ROOT is required");
const coreRoot = fs.realpathSync(configuredCoreRoot);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-teaching-before-class-e2-"));
const memoryDir = path.join(temp, ".edupi", "memory");
const outputDir = path.join(temp, ".edupi", "output");
const lockDir = path.join(temp, ".edupi", "locks");
for (const directory of [memoryDir, outputDir, lockDir]) fs.mkdirSync(directory, { recursive: true });

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
fs.writeFileSync(path.join(outputDir, "material_candidates.json"), JSON.stringify({ entries: [{ id: "material-1", title: "七年级数学第一周课件", subject: "数学" }] }));

Object.assign(process.env, {
  EDUPI_CORE_ROOT: coreRoot,
  EDUPI_CORE_ALLOWED_ROOT: path.dirname(coreRoot),
  EDUPI_DATA_ROOT: temp,
  EDUPI_DATA_ALLOWED_ROOT: path.dirname(temp),
  EDUPI_PROJECT_ROOT: temp,
  EDUPI_MEMORY_DIR: memoryDir,
  EDUPI_OUTPUT_DIR: outputDir,
  EDUPI_LOCK_DIR: lockDir,
  EDUPI_HOME: temp,
});

const heartbeatUrl = `${pathToFileURL(path.join(coreRoot, "scripts", "calendar_work_heartbeat.mjs")).href}?teaching_e2=${Date.now()}`;
const { run } = await import(heartbeatUrl);
const outputFor = (candidate) => JSON.stringify({ artifacts: candidate.deliverables.map((title) => ({ title, content: `# ${title}\n\n${candidate.summary}` })) });

try {
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
  assert.equal(teachingCases.filter((workCase) => workCase.currentState === "draft_ready").length, 2);
  assert.equal(teachingCases.filter((workCase) => workCase.currentState === "draft_ready").every((workCase) => workCase.artifactIds.length === 4), true);
  assert.equal(teachingTasks.every((task) => String(task.evidence.source_summary || "").includes("一元一次方程") && String(task.evidence.source_summary || "").includes("移项变号错误") && String(task.evidence.source_summary || "").includes("七年级数学第一周课件")), true);
  assert.deepEqual((await read()).workCases, first.workCases, "restart/reload keeps lesson occurrence and flow identities stable");

  const fridayRun = await run({ today: "2026-09-03", horizonDays: 1, now: "2026-09-03T12:00:00.000Z", outputDir, runModel: async ({ candidate }) => { modelCalls += 1; return outputFor(candidate); } });
  assert.equal(fridayRun.execution_results.filter((result) => result.status === "draft_ready" && result.replayed === false).length, 2);
  assert.equal(modelCalls, 4);
  const final = await read();
  assert.equal(final.workCases.filter((workCase) => workCase.kind === "teaching_before_class" && workCase.currentState === "draft_ready").length, 4);
  assert.equal(final.workCases.every((workCase) => workCase.externalSend === false), true);
  console.log(JSON.stringify({ status: "passed", timetable_periods: 6, work_cases: 6, draft_ready: 4, artifacts_per_ready_case: 4, model_unavailable_visible: true, replay_stable: true, external_send: false }));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
