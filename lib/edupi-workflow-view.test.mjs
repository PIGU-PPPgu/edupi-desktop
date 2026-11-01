import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { projectWorkflowView, projectManagedWorkflow } = await createJiti(import.meta.url).import("./edupi-workflow-view.ts");
const user = text => ({ role: "user", content: text });
const assistant = (...calls) => ({ role: "assistant", content: calls.map(([id, name]) => ({
  type: "toolCall", toolCallId: id, toolName: name, input: { path: "/private/synthetic" },
})) });
const result = (id, isError = false) => ({ role: "toolResult", toolCallId: id, content: [], isError });

test("projects only the current turn's observed tools and keeps command input private", () => {
  const view = projectWorkflowView([
    user("earlier"), assistant(["old", "bash"]), result("old"),
    user("current"), assistant(["read-1", "read"], ["find-1", "find"]), result("read-1"),
  ], true, ["find"]);
  assert.equal(view.phases.length, 1);
  assert.deepEqual(view.phases[0].steps.map(step => step.status), ["done", "running"]);
  assert.equal(view.completed, 1);
  assert.equal(view.total, 2);
  assert.equal(JSON.stringify(view).includes("/private/synthetic"), false);
  assert.equal(view.status, "running");
});

test("distinguishes failed and interrupted results without inventing completed work", () => {
  const failed = projectWorkflowView([user("current"), assistant(["a", "edit"]), result("a", true)], false);
  assert.equal(failed.status, "failed");
  assert.equal(failed.completed, 0);
  const interrupted = projectWorkflowView([user("current"), assistant(["a", "bash"])], false);
  assert.equal(interrupted.status, "interrupted");
  assert.equal(interrupted.phases[0].steps[0].status, "interrupted");
});

test("adds live tools only when history has no active call and bounds the display", () => {
  const live = projectWorkflowView([user("current")], true, ["bash"]);
  assert.equal(live.phases[0].steps[0].name, "运行命令");
  assert.equal(projectWorkflowView([user("current")], true), null);
  const many = [user("current")];
  for (let index = 0; index < 20; index++) {
    many.push(assistant([`tool-${index}`, "read"]), result(`tool-${index}`));
  }
  const bounded = projectWorkflowView(many, false);
  assert.equal(bounded.phases.length, 12);
  assert.equal(bounded.hiddenPhases, 8);
  assert.equal(bounded.completed, 20);
  assert.equal(bounded.status, "done");
});

test("projects named managed phases and participant state without inventing completion", () => {
  const view = projectManagedWorkflow({ title: "备课工作流", status: "running", phases: [
    { id: "p1", name: "查阅学情", status: "done", agents: [{ id: "a1", name: "学情核对", status: "done" }] },
    { id: "p2", name: "形成方案", status: "running", agents: [{ id: "a2", name: "教案", status: "running" }, { id: "a3", name: "材料", status: "pending" }] },
  ] });
  assert.equal(view.title, "备课工作流");
  assert.equal(view.managed, true);
  assert.deepEqual(view.phases.map(phase => phase.name), ["查阅学情", "形成方案"]);
  assert.equal(view.completed, 1);
  assert.equal(view.total, 3);
  assert.equal(view.phases[1].steps[1].status, "pending");
});

test("managed graph labels repeated and skipped branches truthfully", () => {
  const view = projectManagedWorkflow({ title: "合成", status: "done", phases: [
    { id: "p0", name: "复核", visits: 2, status: "done", agents: [{ id: "a0", name: "核对", status: "done" }] },
    { id: "p1", name: "旁路", visits: 0, status: "skipped", agents: [{ id: "a1", name: "未运行", status: "skipped" }] },
  ] });
  assert.equal(view.phases[0].name, "复核 · 第 2 轮");
  assert.equal(view.phases[1].status, "skipped");
  assert.equal(view.completed, 1);
  assert.equal(view.total, 2);
});

test("counts failures after the display limit and keeps the newest tool calls", () => {
  const messages = [user("many calls")];
  for (let index = 0; index < 48; index++) messages.push(assistant([`done-${index}`, "read"]), result(`done-${index}`));
  messages.push(assistant(["failed-49", "write"]), result("failed-49", true));
  const view = projectWorkflowView(messages, false);
  assert.equal(view.status, "failed");
  assert.equal(view.completed, 48);
  assert.equal(view.total, 49);
  assert.equal(view.hiddenSteps, 37);
  assert.equal(view.phases.at(-1).steps[0].id, "failed-49");
  assert.equal(view.phases.at(-1).status, "failed");
});
