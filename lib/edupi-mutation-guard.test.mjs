import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { createEduPiMutationGuard } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-mutation-guard.ts");

function setup() {
  let onToolCall;
  let onToolResult;
  createEduPiMutationGuard()({
    on(name, callback) {
      if (name === "tool_call") onToolCall = callback;
      if (name === "tool_result") onToolResult = callback;
    },
  });
  const branch = [{ type: "message", id: "user-1", message: { role: "user", content: "记下几何课准备" } }];
  const context = { sessionManager: { getBranch: () => branch } };
  return { branch, context, onToolCall, onToolResult };
}

test("same mutation tool and arguments run once per teacher message", () => {
  const guard = setup();
  const call = { toolName: "edupi_create_task", input: { title: "几何课准备", due_date: "2026-11-26" } };

  assert.equal(guard.onToolCall(call, guard.context), undefined);
  const duplicate = guard.onToolCall(call, guard.context);
  assert.equal(duplicate.block, true);
  assert.equal(duplicate.terminate, true);
  assert.match(duplicate.reason, /已经执行过/);
});

test("a failed mutation blocks every automatic retry in the same teacher message", () => {
  const guard = setup();
  const first = { toolName: "edupi_create_task", input: { title: "几何课准备" } };

  assert.equal(guard.onToolCall(first, guard.context), undefined);
  guard.onToolResult({ toolName: "edupi_create_task", input: first.input, isError: true }, guard.context);
  const retry = guard.onToolCall({ ...first, input: { title: "几何课准备（补试）" } }, guard.context);
  assert.equal(retry.block, true);
  assert.equal(retry.terminate, true);
  assert.match(retry.reason, /失败/);

  guard.branch.push({ type: "message", id: "user-2", message: { role: "user", content: "重新记下" } });
  assert.equal(guard.onToolCall(first, guard.context), undefined);
});
