#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";

const configuredCoreRoot = process.env.EDUPI_CORE_ROOT;
assert.equal(typeof configuredCoreRoot, "string", "EDUPI_CORE_ROOT is required");
assert.equal(path.isAbsolute(configuredCoreRoot), true, "EDUPI_CORE_ROOT must be absolute");
const coreRoot = fs.realpathSync(configuredCoreRoot);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-task-board-write-e2-"));
const dataRoot = path.join(temp, "teacher-data");
for (const directory of [path.join(dataRoot, ".edupi", "memory"), path.join(dataRoot, ".edupi", "output"), path.join(dataRoot, ".edupi", "locks")]) fs.mkdirSync(directory, { recursive: true });

process.env.EDUPI_CORE_ROOT = coreRoot;
process.env.EDUPI_CORE_ALLOWED_ROOT = path.dirname(coreRoot);
process.env.EDUPI_DATA_ROOT = dataRoot;
process.env.EDUPI_DATA_ALLOWED_ROOT = temp;

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { POST } = await jiti.import("../app/api/edupi/tasks/route.ts");
const { PATCH } = await jiti.import("../app/api/edupi/tasks/[taskId]/route.ts");
const { GET } = await jiti.import("../app/api/edupi/education/route.ts");

function request(url, method, body) {
  return new Request(url, { method, headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: JSON.stringify(body) });
}

try {
  const createdResponse = await POST(request("http://localhost/api/edupi/tasks", "POST", { title: "准备第一次单元检测", dueDate: "2026-09-10", note: "先整理范围" }));
  const created = await createdResponse.json();
  assert.equal(createdResponse.status, 200, JSON.stringify(created));
  const task = created.data.tasks.find((item) => item.title === "准备第一次单元检测");
  assert.ok(task);
  assert.equal(task.boardStage, "todo");
  assert.equal(task.boardRevision, 0);

  let revision = 0;
  for (const stage of ["progress", "review", "done"]) {
    const response = await PATCH(request(`http://localhost/api/edupi/tasks/${encodeURIComponent(task.id)}`, "PATCH", { stage, expectedRevision: revision, note: null }), { params: Promise.resolve({ taskId: task.id }) });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    revision += 1;
    const updated = result.data.tasks.find((item) => item.id === task.id);
    assert.equal(updated.boardStage, stage);
    assert.equal(updated.boardRevision, revision);
  }

  const secondResponse = await POST(request("http://localhost/api/edupi/tasks", "POST", { title: "不可跳过流程的任务", dueDate: null, note: null }));
  const second = await secondResponse.json();
  assert.equal(secondResponse.status, 200, JSON.stringify(second));
  const secondTask = second.data.tasks.find((item) => item.title === "不可跳过流程的任务");
  const invalidResponse = await PATCH(request(`http://localhost/api/edupi/tasks/${encodeURIComponent(secondTask.id)}`, "PATCH", { stage: "done", expectedRevision: 0, note: null }), { params: Promise.resolve({ taskId: secondTask.id }) });
  assert.equal(invalidResponse.status, 409);
  assert.equal((await invalidResponse.json()).code, "invalid_transition");

  const finalResponse = await GET();
  const final = await finalResponse.json();
  assert.equal(finalResponse.status, 200, JSON.stringify(final));
  assert.equal(final.tasks.find((item) => item.id === task.id).boardStage, "done");
  assert.equal(final.tasks.find((item) => item.id === secondTask.id).boardStage, "todo");
  assert.equal(fs.existsSync(path.join(dataRoot, ".edupi", "output", "task_board_state.json")), true);
  console.log(JSON.stringify({ status: "passed", created: 2, moved: ["progress", "review", "done"], invalid_transition_no_write: true, restart_reload: true }, null, 2));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
