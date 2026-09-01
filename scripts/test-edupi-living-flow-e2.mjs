#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";

const configuredCoreRoot = process.env.EDUPI_CORE_ROOT;
assert.ok(configuredCoreRoot && path.isAbsolute(configuredCoreRoot), "EDUPI_CORE_ROOT is required");
const coreRoot = fs.realpathSync(configuredCoreRoot);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-living-flow-e2-"));
const memoryDir = path.join(temp, ".edupi", "memory");
const outputDir = path.join(temp, ".edupi", "output");
const lockDir = path.join(temp, ".edupi", "locks");
for (const directory of [memoryDir, outputDir, lockDir]) fs.mkdirSync(directory, { recursive: true });

const calendarPath = path.join(memoryDir, "calendar.json");
const planPath = path.join(outputDir, "rhythm_plan.json");
fs.writeFileSync(calendarPath, JSON.stringify({ events: [{ id: "event-first-week", date: "2026-08-31", name: "开学第一周", type: "teaching", source: "teacher", confidence: "teacher_confirmed" }] }));
const writePlan = (title) => fs.writeFileSync(planPath, JSON.stringify({ tasks: [{ id: "task-first-week", title, status: "planned", source_event_id: "event-first-week", source_event_name: "开学第一周", source_event_date: "2026-08-31", due_date: "2026-08-31", trigger_date: "2026-08-29", deliverables: ["第一周教学清单"], scope: "teacher_internal", requires_teacher_review: true, external_send: false }] }));
writePlan("准备开学第一课");

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

const { GET } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("../app/api/edupi/education/route.ts");

async function read() {
  const response = await GET();
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  return data;
}

try {
  const first = await read();
  assert.equal(first.workCases.length, 1);
  const workCaseId = first.workCases[0].id;
  assert.equal(first.workCases[0].taskId, "task-first-week");
  assert.equal(first.workCases[0].triggerId, "event-first-week");
  assert.equal(first.workCases[0].currentState, "planned");
  assert.equal(first.workCases[0].externalSend, false);
  assert.deepEqual((await read()).workCases, first.workCases, "restart/replay projection must be stable");

  writePlan("准备开学第一课（教师已调整）");
  const changed = await read();
  assert.equal(changed.workCases.length, 1);
  assert.equal(changed.workCases[0].id, workCaseId, "source changes keep the same work-case identity");
  assert.equal(changed.workCases[0].title, "准备开学第一课（教师已调整）");
  assert.deepEqual(changed.workCases[0].artifactIds, []);
  console.log(JSON.stringify({ status: "passed", work_cases: 1, stable_replay: true, stable_source_change: true, external_send: false }));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
