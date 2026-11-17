import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const { createEduPiClassroomTool } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-classroom-tool.ts");

test("classroom tool forwards exact calculation input to the shared service", async () => {
  const calls = [];
  const input = { title: "合成考试", class_name: "测试班", rows: [], subjects: [], date: "2026-11-13" };
  const tool = createEduPiClassroomTool({ projectRoot: "/tmp/edupi-tool-test", service: async request => {
    calls.push(request);
    return { ok: true, operation: "classroom", request_id: "test", external_send: false, issues: [{ code: "missing", severity: "error", message: "请填写成绩" }], result: null };
  } });
  const result = await tool.execute("call-1", { domain: "grades", action: "preview", input }, undefined, undefined, { cwd: "/tmp/edupi-tool-test" });
  assert.deepEqual(calls[0].input, input);
  assert.equal(result.details.result.result, null);
  assert.match(result.content[0].text, /请填写成绩/u);
});

test("classroom tool rejects a different workspace before the service", async () => {
  let calls = 0;
  const tool = createEduPiClassroomTool({ projectRoot: "/tmp/edupi-tool-test", service: async () => { calls++; } });
  await assert.rejects(tool.execute("call", { domain: "duty", action: "list" }, undefined, undefined, { cwd: "/tmp/other" }), /工作区/u);
  assert.equal(calls, 0);
});

test("classroom tool propagates service failure without an invented result", async () => {
  const tool = createEduPiClassroomTool({ projectRoot: "/tmp/edupi-tool-test", service: async () => { throw new Error("stale_revision"); } });
  await assert.rejects(tool.execute("call", { domain: "seating", action: "save", id: "s", expected_revision: 1 }, undefined, undefined, { cwd: "/tmp/edupi-tool-test" }), /stale_revision/u);
});
