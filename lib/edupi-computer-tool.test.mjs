import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { createEduPiComputerUseTool } = await jiti.import("./edupi-computer-tool.ts");

const nativeResult = (content = "ok") => ({
  ok: true,
  result: { content, isError: false, images: [], snapshotId: null, operationId: "computer-1" },
});

function context() {
  return { cwd: "/tmp/edupi", hasUI: true, ui: {} };
}

test("computer-use status can be read without an approval dialog", async () => {
  const tool = createEduPiComputerUseTool({ projectRoot: "/tmp/edupi", requestAction: async () => nativeResult("已关闭") });
  const result = await tool.execute("call-status", { action: "status" }, undefined, undefined, context());
  assert.equal(tool.name, "edupi_computer_use");
  assert.equal(result.details.operationId, "computer-1");
});

test("computer-use screen reads fail closed without a visible native host", async () => {
  const tool = createEduPiComputerUseTool({ projectRoot: "/tmp/edupi", requestAction: async () => nativeResult() });
  await assert.rejects(() => tool.execute("call-observe", { action: "observe" }, undefined, undefined, { ...context(), hasUI: false }), /可见的 EduPi/);
});

test("computer-use remains scoped to the EduPi project root", async () => {
  const tool = createEduPiComputerUseTool({ projectRoot: "/tmp/edupi", requestAction: async () => nativeResult() });
  await assert.rejects(() => tool.execute("call-outside", { action: "status" }, undefined, undefined, { ...context(), cwd: "/tmp/other" }), /仅允许 EduPi 工作区/);
});
