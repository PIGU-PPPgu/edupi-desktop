import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { createEduPiAppControlTool } = await jiti.import("./edupi-desktop-tool.ts");

test("EduPi app-control tool dispatches an allowlisted semantic action", async () => {
  const actions = [];
  const tool = createEduPiAppControlTool({
    projectRoot: "/tmp/edupi",
    requestAction: async (action) => { actions.push(action); return true; },
  });
  const result = await tool.execute("call-1", { action: "navigate", view: "calendar" }, undefined, undefined, { cwd: "/tmp/edupi" });

  assert.equal(tool.name, "edupi_app_control");
  assert.deepEqual(actions, [{ action: "navigate", view: "calendar" }]);
  assert.deepEqual(result.details.action, { action: "navigate", view: "calendar" });
  assert.match(result.content[0].text, /已打开/);
});

test("EduPi app-control tool fails closed outside the configured EduPi workspace", async () => {
  let called = false;
  const tool = createEduPiAppControlTool({
    projectRoot: "/tmp/edupi",
    requestAction: async () => { called = true; return true; },
  });
  await assert.rejects(() => tool.execute("call-2", { action: "open_settings" }, undefined, undefined, { cwd: "/tmp/other" }), /仅允许 EduPi 工作区/);
  assert.equal(called, false);
});

test("EduPi app-control tool reports a disconnected or timed-out UI as an error", async () => {
  const tool = createEduPiAppControlTool({ projectRoot: "/tmp/edupi", requestAction: async () => false });
  await assert.rejects(() => tool.execute("call-3", { action: "open_context" }, undefined, undefined, { cwd: "/tmp/edupi" }), /未确认/);
});
