import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { createEduPiTaskTool } = await createJiti(import.meta.url).import("./edupi-task-tool.ts");
const ctx = { cwd: "/tmp/edupi", sessionManager: { getBranch: () => [{ id: "teacher-message-1", type: "message", message: { role: "user", content: "建立备课任务" } }] } };

test("chat creation writes through the Core command and binds the teacher message", async () => {
  let command;
  const tool = createEduPiTaskTool({ projectRoot: ctx.cwd, issue: async (value) => { command = value; } });
  const result = await tool.execute("call-1", {title:"703班几何体备课", due_date:"2026-09-07"}, undefined, undefined, ctx);
  assert.equal(command.command_type, "create_task");
  assert.equal(command.source.source_id, "teacher-message-1");
  assert.equal(command.task.title, "703班几何体备课");
  assert.equal(result.details.taskId, command.task.task_id);
  assert.equal(result.details.created, true);
});

test("Core failure cannot be reported as a created task", async () => {
  const tool = createEduPiTaskTool({projectRoot:ctx.cwd, issue:async () => {throw new Error("Core unavailable");}});
  await assert.rejects(() => tool.execute("call-2", {title:"备课"}, undefined, undefined, ctx), /Core unavailable/);
});

test("invalid dates never reach Core", async () => {
  let writes = 0;
  const tool = createEduPiTaskTool({projectRoot:ctx.cwd, issue:async () => {writes++;}});
  await assert.rejects(() => tool.execute("call-3", {title:"备课", due_date:"2026-02-30"}, undefined, undefined, ctx), /日期/);
  assert.equal(writes, 0);
});
