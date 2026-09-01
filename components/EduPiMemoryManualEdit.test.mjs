import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./EduPiMemoryDatabase.tsx", import.meta.url), "utf8");

test("memory rows separate direct manual editing from optional AI collaboration", () => {
  assert.match(source, />手动修改</);
  assert.match(source, />AI 协作</);
  assert.match(source, /edupi-memory-editor/);
  assert.match(source, /<textarea/);
  assert.match(source, /\/api\/edupi\/memories\/\$\{encodeURIComponent\(memory\.id\)\}/);
  assert.match(source, /expectedRevision: editor\.revision/);
  assert.match(source, /revision: memory\.revision/);
  assert.match(source, /onEducation\(result\.data\)/);
  assert.match(source, /onStartAgent/);
  assert.match(source, /aria-disabled=\{!data\.capabilities\.memoryUpdate\.enabled\}/);
  assert.match(source, /aria-describedby=/);
  assert.match(source, /edupi-visually-hidden/);
});

test("manual save stays in the memory database and reports bounded states", () => {
  assert.match(source, /保存中…/);
  assert.match(source, /记忆已保存/);
  assert.match(source, /role=\{message\.tone === "error" \? "alert" : "status"\}/);
  assert.doesNotMatch(source, /onStartAgent\([^)]*draft/);
});
