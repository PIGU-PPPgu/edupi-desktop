import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { projectWorkflowView } = await createJiti(import.meta.url).import("./edupi-workflow-view.ts");
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
