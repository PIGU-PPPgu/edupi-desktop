import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-workflow-tool-test-"));
process.env.PI_DESKTOP_STATE_DIR = stateDir;
const jiti = createJiti(import.meta.url);
const { createEduPiWorkflowTool } = await jiti.import("./edupi-workflow-tool.ts");
const { makeDynamicWorkflowRun, readDynamicWorkflowRun, writeDynamicWorkflowRun } = await jiti.import("./edupi-dynamic-workflow.ts");
test.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));

const plan = { title: "合成核对", phases: [
  { name: "查阅", agents: [{ name: "资料", task: "核对合成资料" }, { name: "日程", task: "核对合成日程" }] },
  { name: "汇总", agents: [{ name: "审核", task: "汇总结果" }] },
] };
function context(sessionId, confirm) {
  return { hasUI: true, cwd: "/tmp/edupi-workflow-synthetic", model: { provider: "test", id: "synthetic" },
    sessionManager: { getSessionId: () => sessionId, getBranch: () => [{ type: "message", id: "user-entry-1", message: { role: "user", content: "合成核对" } }] },
    ui: { confirm }, thinkingLevel: "off" };
}

test("a declined visible confirmation runs no child and writes no journal", async () => {
  let calls = 0;
  const tool = createEduPiWorkflowTool({ runAgent: async () => { calls++; return { ok: true, summary: "unused" }; } });
  const response = await tool.execute("tool-1", plan, undefined, undefined, context("declined-workflow", async () => false));
  assert.equal(calls, 0);
  assert.equal(response.details.status, "declined");
  assert.equal(readDynamicWorkflowRun("declined-workflow"), null);
});

test("confirmed tool runs named children and leaves a matching durable journal", async () => {
  const called = [];
  const tool = createEduPiWorkflowTool({ runAgent: async (agent, previous) => {
    called.push([agent.name, previous]);
    return { ok: true, summary: `${agent.name}完成` };
  } });
  let preview = "";
  const response = await tool.execute("tool-2", plan, undefined, undefined, context("confirmed-workflow", async (_title, body) => { preview = body; return true; }));
  assert.equal(response.details.status, "done");
  assert.deepEqual(called.map(item => item[0]), ["资料", "日程", "审核"]);
  assert.match(called[2][1], /资料完成/);
  assert.match(preview, /核对合成资料/);
  assert.match(preview, /3 项，最多 3 次模型调用/);
  assert.match(preview, /相关内容会进入所选模型的上下文/);
  const journal = readDynamicWorkflowRun("confirmed-workflow");
  assert.equal(journal.sourceEntryId, "user-entry-1");
  assert.equal(journal.status, "done");
  assert.deepEqual(journal.phases.map(phase => phase.name), ["查阅", "汇总"]);
});

test("resume asks again and reuses the completed child instead of charging twice", async () => {
  const run = makeDynamicWorkflowRun("resumed-workflow", "old-user", plan);
  run.status = "running";
  run.activePhaseIndex = 0;
  run.phases[0].status = "running";
  run.phases[0].visits = 1;
  run.phases[0].agents[0].status = "done";
  run.results[0][0] = { ok: true, summary: "资料旧结果" };
  run.phases[0].agents[1].status = "running";
  run.updatedAt = new Date(Date.now() - 60_000).toISOString();
  writeDynamicWorkflowRun(run);
  const called = [];
  const tool = createEduPiWorkflowTool({ runAgent: async agent => {
    called.push(agent.name);
    return { ok: true, summary: `${agent.name}新结果` };
  } });
  let title = "";
  const response = await tool.execute("tool-resume", { action: "resume" }, undefined, undefined,
    context("resumed-workflow", async value => { title = value; return true; }));
  assert.equal(title, "恢复工作流");
  assert.equal(response.details.status, "done");
  assert.deepEqual(called, ["日程", "审核"]);
  assert.equal(readDynamicWorkflowRun("resumed-workflow").sourceEntryId, "user-entry-1");
});

test("draft agents return an unadopted proposal and never gain write tools", async () => {
  const draftPlan = { title: "合成拟稿", phases: [{ name: "拟稿", agents: [
    { name: "草稿员", task: "写一段合成文字", output: "draft" },
  ] }] };
  const tool = createEduPiWorkflowTool({ runAgent: async agent => ({ ok: true, summary: "合成草稿正文", draft: agent.output === "draft" }) });
  let preview = "";
  const response = await tool.execute("tool-draft", draftPlan, undefined, undefined,
    context("draft-workflow", async (_title, body) => { preview = body; return true; }));
  assert.equal(response.details.status, "done");
  assert.match(preview, /待审草稿/);
  assert.match(response.content[0].text, /待审草稿，未采用/);
  assert.equal(readDynamicWorkflowRun("draft-workflow").results[0][0].draft, true);
});
