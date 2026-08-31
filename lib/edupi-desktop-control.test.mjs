import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { validateDesktopCommand } = await jiti.import("./edupi-desktop-control.ts");

test("desktop control accepts only allowlisted EduPi navigation commands", () => {
  assert.deepEqual(validateDesktopCommand({ action: "navigate", view: "calendar" }), { action: "navigate", view: "calendar" });
  assert.deepEqual(validateDesktopCommand({ action: "navigate", view: "teaching" }), { action: "navigate", view: "teaching" });
  assert.deepEqual(validateDesktopCommand({ action: "navigate", view: "homeroom" }), { action: "navigate", view: "homeroom" });
  assert.deepEqual(validateDesktopCommand({ action: "navigate", view: "workspace" }), { action: "navigate", view: "workspace" });
  assert.deepEqual(validateDesktopCommand({ action: "open_task", taskId: "task-a", stage: "evidence" }), { action: "open_task", taskId: "task-a", stage: "evidence" });
  assert.deepEqual(validateDesktopCommand({ action: "open_context" }), { action: "open_context" });
  assert.deepEqual(validateDesktopCommand({ action: "set_inspector", open: true }), { action: "set_inspector", open: true });
  assert.deepEqual(validateDesktopCommand({ action: "show_window" }), { action: "show_window" });
});

test("desktop control rejects arbitrary script, selector, review, and malformed task actions", () => {
  for (const value of [
    { action: "eval", script: "location.reload()" },
    { action: "click", selector: "button" },
    { action: "review", taskId: "task-a", decision: "accept" },
    { action: "open_task", taskId: "" },
    { action: "open_task", taskId: "task-a", stage: "delete" },
    { action: "navigate", view: "models" },
  ]) {
    assert.throws(() => validateDesktopCommand(value), /不支持|无效|不能为空/);
  }
});
