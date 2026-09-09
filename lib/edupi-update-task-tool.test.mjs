import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { createEduPiUpdateTaskTool } = await jiti.import("./edupi-update-task-tool.ts");
const { taskBoardContentHash } = await jiti.import("./edupi-task-board-command.ts");
const message = { id: "teacher-latest", type: "message", message: { role: "user", content: "备课已经完成了" } };
const ctx = { cwd: "/tmp/edupi", sessionManager: { getBranch: () => [{ ...message, id: "older" }, message, { id: "assistant", type: "message", message: {role:"assistant",content:"处理中"} }] } };
const task = { id: "task-1", title: "几何备课", boardStage: "progress", boardRevision: 7 };
function setup(tasks = [task], overrides = {}) {
  const commands = [];
  const tool = createEduPiUpdateTaskTool({ projectRoot: ctx.cwd, read: async () => ({tasks}), issue: async command => {
    commands.push(command);
    return { receipt: {status:"modified"}, task: {task_id:command.task_id, board_stage:command.to_stage, board_revision:command.expected_revision + 1}, data:{} };
  }, ...overrides });
  return { commands, run: (params, context = ctx) => tool.execute("call-1", params, undefined, undefined, context) };
}
test("lookup filters current task titles without writes", async () => {
  const {run,commands} = setup([task, {...task,id:"other",title:"开会"}]);
  const result = await run({action:"list",query:"几何"});
  assert.deepEqual(result.details.tasks,[task]);
  assert.equal(commands.length,0);
});
test("completion uses current revision and actual latest user source", async () => {
  const {run,commands} = setup();
  const result = await run({action:"complete",task_id:task.id});
  assert.equal(commands[0].command_type,"move_task_stage");
  assert.equal(commands[0].expected_revision,7);
  assert.equal(commands[0].to_stage,"done");
  assert.equal(commands[0].source.source_id,message.id);
  assert.equal(commands[0].source.source_hash,taskBoardContentHash(message));
  assert.deepEqual(commands[0].source.evidence_ids,[message.id,"call-1"]);
  assert.equal(result.details.updated,true);
  assert.equal(result.details.tasks[0].boardRevision,8);
  assert.match(result.content[0].text,/已完成/);
  assert.doesNotMatch(result.content[0].text,/done|progress/);
});
test("missing and ambiguous targets never write", async () => {
  const {run,commands} = setup([task,{...task,id:"task-2"}]);
  await assert.rejects(run({action:"complete"}),/指定/);
  await assert.rejects(run({action:"complete",task_id:"missing"}),/未找到/);
  await assert.rejects(run({action:"complete",query:"备课"}),/多个任务/);
  assert.equal(commands.length,0);
});
test("Core failure and mismatched readback cannot report success", async () => {
  await assert.rejects(setup([task],{issue:async()=>{throw new Error("Core unavailable");}}).run({action:"complete",task_id:task.id}),/Core unavailable/);
  await assert.rejects(setup([task],{issue:async()=>({task:{task_id:task.id,board_stage:"progress",board_revision:8}})}).run({action:"complete",task_id:task.id}),/不一致/);
});
test("start and reopen transitions use revision; duplicate completion is a read-only no-op", async () => {
  for (const [action,stage] of [["start","progress"],["reopen","progress"]]) {
    const {run,commands} = setup([{...task,boardStage:"done"}]);
    const result = await run({action,task_id:task.id});
    assert.equal(commands[0].to_stage,stage);
    assert.match(result.content[0].text,/进行中/);
    assert.doesNotMatch(result.content[0].text,/done|progress/);
  }
  const {run,commands} = setup([{...task,boardStage:"done"}]);
  assert.equal((await run({action:"complete",task_id:task.id})).details.updated,false);
  assert.equal(commands.length,0);
});
test("cancellation during lookup prevents submitting a status change", async () => {
  const controller = new AbortController();
  let writes = 0;
  const tool = createEduPiUpdateTaskTool({projectRoot:ctx.cwd,read:async()=>{controller.abort();return {tasks:[task]};},issue:async()=>{writes++;throw new Error("unexpected write");}});
  await assert.rejects(tool.execute("call-cancel",{action:"complete",task_id:task.id},controller.signal,undefined,ctx),{name:"AbortError"});
  assert.equal(writes,0);
});
test("no user message binds actual tool call and workspace boundary is enforced", async () => {
  const {run,commands} = setup();
  await run({action:"complete",task_id:task.id},{...ctx,sessionManager:{getBranch:()=>[]}});
  assert.equal(commands[0].source.source_id,"call-1");
  assert.equal(commands[0].source.source_hash,taskBoardContentHash({toolCallId:"call-1"}));
  await assert.rejects(run({action:"complete",task_id:task.id},{...ctx,cwd:"/tmp/other"}),/工作区/);
});
