import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { createMemoryWriteTool } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-memory-write-tool.ts");
const ctx = { cwd: "/test/edupi", sessionManager: { getSessionId: () => "session", getBranch: () => [{ type: "message", id: "message", message: { role: "user", content: [{ type: "text", text: "以后练习都附答案" }] } }] } };
test("memory tool binds the actual teacher message and preserves input semantics", async () => {
  let submitted;
  const tool = createMemoryWriteTool(ctx.cwd, async value => { submitted = value; return { ok: true, id: "memory", count: 1, merged: false, replayed: false }; });
  const result = await tool.execute("call", { category: "preferences", content: "练习附答案", supersedes: "不附答案" }, undefined, undefined, ctx);
  assert.deepEqual(submitted, { source: { session_id: "session", message_id: "message", tool_call_id: "call", text: "以后练习都附答案" }, input: { category: "preferences", content: "练习附答案", tags: [], supersedes: "不附答案" } });
  assert.equal(result.details.id, "memory");
});
test("unavailable persistence never announces memory saved", async () => {
  const tool = createMemoryWriteTool(ctx.cwd, async () => ({ ok: false, code: "writer_admission_unavailable" }));
  await assert.rejects(tool.execute("call", { category: "preferences", content: "练习附答案" }, undefined, undefined, ctx), /未保存/);
  await assert.rejects(tool.execute("call", { category: "preferences", content: "练习附答案" }, undefined, undefined, { ...ctx, cwd: "/other" }), /工作区/);
});
