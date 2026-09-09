import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { createMemoryForgetTool } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-memory-forget-tool.ts");
const memories = [{ id: "one", category: "preferences", content: "练习不附答案", tags: [], state: "active" }, { id: "two", category: "teaching", content: "练习不附答案", tags: [], state: "active" }, { id: "old", category: "preferences", content: "练习不附答案", tags: [], state: "superseded" }];
test("forget targets only active matches in the requested category through managed deletion", async () => {
  const removed = [];
  const tool = createMemoryForgetTool("/test", { read: async () => ({ continuity: { memories } }), remove: async value => { removed.push(value.id); } });
  const result = await tool.execute("call", { category: "preferences", query: "不附答案" }, undefined, undefined, { cwd: "/test" });
  assert.deepEqual(removed, ["one"]);
  assert.equal(result.details.removed, 1);
});
test("forget reports partial deletion rather than claiming all succeeded", async () => {
  let calls = 0;
  const tool = createMemoryForgetTool("/test", { read: async () => ({ continuity: { memories: [...memories, { ...memories[0], id: "next" }] } }), remove: async () => { if (++calls === 2) throw new Error("unavailable"); } });
  await assert.rejects(tool.execute("call", { category: "preferences", query: "不附答案" }, undefined, undefined, { cwd: "/test" }), /已删除 1 条，其余未完成/);
});
