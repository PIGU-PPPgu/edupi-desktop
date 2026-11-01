import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
  const root = path.join(stateDir, "edupi-dynamic-workflows-v2");
  const file = path.join(root, fs.readdirSync(root).find(name => name.endsWith(".json")));
  const stored = fs.readFileSync(file, "utf8");
  assert.equal(fs.statSync(file).mode & 0o077, 0);
  assert.equal(stored.includes("检查合成材料"), true);
  assert.equal(stored.includes("材料已核对"), true);
  const publicRun = workflow.publicDynamicWorkflowRun(result.run);
  assert.equal(JSON.stringify(publicRun).includes("检查合成材料"), false);
  assert.equal(JSON.stringify(publicRun).includes("材料已核对"), false);
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
  assert.throws(() => workflow.validateDynamicWorkflowPlan({ title: "x", phases: [{ name: "a", agents: [{ name: "x", task: "x" }], on_failure: 0 }] }));
  assert.throws(() => workflow.validateDynamicWorkflowPlan({ title: "过量", phases: Array(4).fill({ name: "阶段", max_visits: 3,
    agents: Array(4).fill({ name: "代理", task: "合成" }) }) }), /32/);
  const run = workflow.makeDynamicWorkflowRun("workflow-test-session-3", "user-entry-3", plan);
  run.status = "running";
  run.activePhaseIndex = 0;
  run.phases[0].visits = 1;
  run.phases[0].status = "running";
  run.phases[0].agents[0].status = "running";
  run.updatedAt = new Date(Date.now() - 60_000).toISOString();
  workflow.writeDynamicWorkflowRun(run);
  const stale = workflow.readDynamicWorkflowRun(run.sessionId);
  assert.equal(stale.status, "interrupted");
  assert.equal(stale.phases[0].agents[0].status, "interrupted");
});

test("success branch skips an unused phase; failed phase retries with a bounded loop", async () => {
  const branch = { title: "分支", phases: [
    { name: "检查", agents: [{ name: "核对", task: "检查" }], on_success: 2 },
    { name: "跳过", agents: [{ name: "不执行", task: "不用执行" }] },
    { name: "汇总", agents: [{ name: "收束", task: "汇总" }] },
  ] };
  const called = [];
  const first = await workflow.executeDynamicWorkflow(workflow.makeDynamicWorkflowRun("branch-session", "branch-user", branch), branch,
    async agent => { called.push(agent.name); return { ok: true, summary: "合成" }; });
  assert.deepEqual(called, ["核对", "收束"]);
  assert.deepEqual(first.run.phases.map(phase => phase.status), ["done", "skipped", "done"]);
  assert.deepEqual(first.results.map(visit => visit.phaseIndex), [0, 2]);

  const retry = { title: "重试", phases: [
    { name: "检查", agents: [{ name: "核对", task: "检查" }], on_failure: 0, max_visits: 2 },
    { name: "汇总", agents: [{ name: "收束", task: "汇总" }] },
  ] };
  let count = 0;
  const second = await workflow.executeDynamicWorkflow(workflow.makeDynamicWorkflowRun("retry-session", "retry-user", retry), retry,
    async agent => ({ ok: agent.name !== "核对" || ++count === 2, summary: "合成" }));
  assert.equal(second.run.status, "done");
  assert.equal(second.run.phases[0].visits, 2);
  assert.deepEqual(second.results.map(visit => visit.phaseIndex), [0, 0, 1]);
  const exhausted = await workflow.executeDynamicWorkflow(workflow.makeDynamicWorkflowRun("retry-exhausted", "retry-user", retry), retry,
    async () => ({ ok: false, summary: "仍失败" }));
  assert.equal(exhausted.run.status, "failed");
  assert.equal(exhausted.run.phases[0].visits, 2);
  assert.equal(exhausted.results.length, 2);
});

test("restart resumes only unfinished read-only agents from the private journal", async () => {
  const resumedPlan = { title: "续跑", phases: [
    { name: "收集", agents: [{ name: "已收集", task: "收集" }] },
    { name: "复核", agents: [{ name: "已复核", task: "复核甲" }, { name: "待复核", task: "复核乙" }] },
  ] };
  const run = workflow.makeDynamicWorkflowRun("resume-session", "old-user", resumedPlan);
  run.status = "running";
  run.cursor = 1;
  run.activePhaseIndex = 1;
  run.phases[0].status = "done";
  run.phases[0].visits = 1;
  run.phases[0].agents[0].status = "done";
  run.results[0][0] = { ok: true, summary: "旧结果" };
  run.phases[1].status = "running";
  run.phases[1].visits = 1;
  run.phases[1].agents[0].status = "done";
  run.results[1][0] = { ok: true, summary: "已完成结果" };
  run.phases[1].agents[1].status = "running";
  run.lastSummary = "已收集: 旧结果";
  run.updatedAt = new Date(Date.now() - 60_000).toISOString();
  workflow.writeDynamicWorkflowRun(run);
  const interrupted = workflow.readDynamicWorkflowRun(run.sessionId);
  assert.equal(interrupted.status, "interrupted");
  interrupted.sourceEntryId = "resume-user";
  const called = [];
  const result = await workflow.executeDynamicWorkflow(interrupted, resumedPlan, async (agent, previous) => {
    called.push([agent.name, previous]);
    return { ok: true, summary: "新结果" };
  });
  assert.deepEqual(called, [["待复核", "已收集: 旧结果"]]);
  assert.equal(result.run.status, "done");
  assert.equal(result.run.phases[1].visits, 1);
  assert.equal(workflow.readDynamicWorkflowRun(run.sessionId).sourceEntryId, "resume-user");
});

test("a new Node process can resume a stale run without replaying persisted agents", () => {
  const restartPlan = { title: "跨进程", phases: [{ name: "核对", agents: [
    { name: "已完成", task: "合成甲" }, { name: "未完成", task: "合成乙" },
  ] }] };
  const run = workflow.makeDynamicWorkflowRun("cross-process-session", "old-user", restartPlan);
  run.status = "running";
  run.activePhaseIndex = 0;
  run.phases[0].status = "running";
  run.phases[0].visits = 1;
  run.phases[0].agents[0].status = "done";
  run.results[0][0] = { ok: true, summary: "旧结果" };
  run.phases[0].agents[1].status = "running";
  run.updatedAt = new Date(Date.now() - 60_000).toISOString();
  workflow.writeDynamicWorkflowRun(run);
  const script = `
    import { createJiti } from "jiti";
    const wf = await createJiti(import.meta.url).import("./lib/edupi-dynamic-workflow.ts");
    const run = wf.readDynamicWorkflowRun("cross-process-session");
    const called = [];
    const result = await wf.executeDynamicWorkflow(run, run.plan, async agent => {
      called.push(agent.name);
      return { ok: true, summary: "新结果" };
    });
    process.stdout.write(JSON.stringify({ called, status: result.run.status }) + "\\n");
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: path.resolve(new URL("..", import.meta.url).pathname),
    env: { ...process.env, PI_DESKTOP_STATE_DIR: stateDir }, encoding: "utf8", timeout: 15000,
  });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout.trim()), { called: ["未完成"], status: "done" });
});

test("private child-session directory can be reused by parallel agents and later runs", () => {
  const first = workflow.workflowChildSessionDir();
  const second = workflow.workflowChildSessionDir();
  assert.equal(first, second);
  assert.equal(fs.statSync(first).isDirectory(), true);
});
