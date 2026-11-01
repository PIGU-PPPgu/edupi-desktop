import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-workflow-test-"));
process.env.PI_DESKTOP_STATE_DIR = stateDir;
const workflow = await createJiti(import.meta.url).import("./edupi-dynamic-workflow.ts");
test.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));

const plan = { title: "资源检查", phases: [
  { name: "查阅", agents: [{ name: "材料", task: "检查合成材料" }, { name: "日程", task: "检查合成日程" }] },
  { name: "汇总", agents: [{ name: "核对", task: "汇总上一阶段" }] },
] };

test("executes real parallel phase work, passes bounded summaries to the next phase, and persists states", async () => {
  const sessionId = "workflow-test-session-1";
  const run = workflow.makeDynamicWorkflowRun(sessionId, "user-entry-1", plan);
  const calls = [];
  const result = await workflow.executeDynamicWorkflow(run, plan, async (agent, previous) => {
    calls.push({ name: agent.name, previous });
    await new Promise(resolve => setTimeout(resolve, 5));
    return { ok: true, summary: `${agent.name}已核对` };
  });
  assert.equal(result.run.status, "done");
  assert.deepEqual(result.run.phases.map(phase => phase.status), ["done", "done"]);
  assert.equal(calls[2].previous.includes("材料已核对"), true);
  assert.equal(calls[2].previous.includes("日程已核对"), true);
  assert.equal(workflow.readDynamicWorkflowRun(sessionId).status, "done");
  const stored = fs.readFileSync(path.join(stateDir, "edupi-dynamic-workflows-v1", fs.readdirSync(path.join(stateDir, "edupi-dynamic-workflows-v1"))[0]), "utf8");
  assert.equal(stored.includes("检查合成材料"), false);
  assert.equal(stored.includes("材料已核对"), false);
});

test("failed agent stops later stages and never marks pending work complete", async () => {
  const run = workflow.makeDynamicWorkflowRun("workflow-test-session-2", "user-entry-2", plan);
  const result = await workflow.executeDynamicWorkflow(run, plan, async agent => ({ ok: agent.name !== "日程", summary: "合成结果" }));
  assert.equal(result.run.status, "failed");
  assert.deepEqual(result.run.phases.map(phase => phase.status), ["failed", "interrupted"]);
  assert.equal(result.results.length, 1);
  assert.equal(result.run.phases[1].agents[0].status, "interrupted");
});

test("rejects oversized or malformed plans and marks stale running journals interrupted", () => {
  assert.throws(() => workflow.validateDynamicWorkflowPlan({ ...plan, phases: Array(7).fill(plan.phases[0]) }));
  assert.throws(() => workflow.validateDynamicWorkflowPlan({ title: "x", phases: [{ name: "a", agents: [{ name: "x", task: "bad\nline" }] }] }));
  const run = workflow.makeDynamicWorkflowRun("workflow-test-session-3", "user-entry-3", plan);
  run.status = "running";
  run.phases[0].status = "running";
  run.phases[0].agents[0].status = "running";
  run.updatedAt = new Date(Date.now() - 60_000).toISOString();
  workflow.writeDynamicWorkflowRun(run);
  const stale = workflow.readDynamicWorkflowRun(run.sessionId);
  assert.equal(stale.status, "interrupted");
  assert.equal(stale.phases[0].agents[0].status, "interrupted");
});

test("private child-session directory can be reused by parallel agents and later runs", () => {
  const first = workflow.workflowChildSessionDir();
  const second = workflow.workflowChildSessionDir();
  assert.equal(first, second);
  assert.equal(fs.statSync(first).isDirectory(), true);
});
