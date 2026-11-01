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
const { readDynamicWorkflowRun } = await jiti.import("./edupi-dynamic-workflow.ts");
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
  assert.match(preview, /3 项，每项调用一次模型/);
  assert.match(preview, /相关内容会进入所选模型的上下文/);
  const journal = readDynamicWorkflowRun("confirmed-workflow");
  assert.equal(journal.sourceEntryId, "user-entry-1");
  assert.equal(journal.status, "done");
  assert.deepEqual(journal.phases.map(phase => phase.name), ["查阅", "汇总"]);
});
