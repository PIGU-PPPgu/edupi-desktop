import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { createPrepareTaskTool } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-prepare-task-tool.ts");
const data = {
  tasks: [
    { id: "teaching-task", title: "703 班几何体备课", dueDate: "2026-10-01", sourceEventName: "数学 · 703", deliverables: ["教案"] },
    { id: "manual-task", title: "手工任务", dueDate: null, sourceEventName: null, deliverables: [] },
  ],
  workCases: [{ kind: "teaching_before_class", taskId: "teaching-task" }],
};
const context = { cwd: "/tmp/edupi" };

test("lists only executable preparation work and starts the exact task", async () => {
  const starts = [];
  const tool = createPrepareTaskTool(context.cwd, {
    readEducation: async () => data,
    start: (input) => { starts.push(input); return { state: "running", updatedAt: "now", prepared: 0, error: null, taskId: input.taskId }; },
  });
  const listed = await tool.execute("list", { action: "list", query: "703" }, undefined, undefined, context);
  const rows = JSON.parse(listed.content[0].text);
  assert.deepEqual(rows.map((row) => row.task_id), ["teaching-task"]);
  const natural = await tool.execute("list-natural", { action: "list", query: "2026-10-01 703 班 几何体 备课" }, undefined, undefined, context);
  assert.deepEqual(JSON.parse(natural.content[0].text).map((row) => row.task_id), ["teaching-task"]);
  const started = await tool.execute("prepare", { action: "prepare", task_id: "teaching-task" }, undefined, undefined, context);
  assert.deepEqual(starts, [{ taskId: "teaching-task" }]);
  assert.equal(started.details.taskId, "teaching-task");
  assert.match(started.content[0].text, /现在尚未宣称完成/);
});

test("does not execute a manual or unknown task", async () => {
  let starts = 0;
  const tool = createPrepareTaskTool(context.cwd, { readEducation: async () => data, start: () => { starts += 1; } });
  await assert.rejects(() => tool.execute("prepare", { action: "prepare", task_id: "manual-task" }, undefined, undefined, context), /没有找到/);
  assert.equal(starts, 0);
});
