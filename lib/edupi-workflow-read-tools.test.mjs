import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const { createWorkflowReadTools } = await createJiti(import.meta.url).import("./edupi-workflow-read-tools.ts");

test("workflow read tools reject traversal and symlink escape before reaching Pi tools", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-workflow-read-"));
  const cwd = path.join(root, "workspace"), outside = path.join(root, "outside.txt");
  fs.mkdirSync(cwd);
  fs.writeFileSync(path.join(cwd, "inside.txt"), "synthetic inside");
  fs.writeFileSync(outside, "synthetic outside");
  fs.symlinkSync(outside, path.join(cwd, "escape.txt"));
  try {
    const tools = Object.fromEntries(createWorkflowReadTools(cwd).map(tool => [tool.name, tool]));
    const inside = await tools.read.execute("read-inside", { path: "inside.txt" }, undefined, undefined, {});
    assert.match(JSON.stringify(inside.content), /synthetic inside/);
    await assert.rejects(() => tools.read.execute("read-outside", { path: outside }, undefined, undefined, {}), /当前工作区/);
    await assert.rejects(() => tools.read.execute("read-symlink", { path: "escape.txt" }, undefined, undefined, {}), /当前工作区/);
    assert.throws(() => tools.find.execute("find-outside", { pattern: "*", path: ".." }, undefined, undefined, {}), /当前工作区/);
    assert.throws(() => tools.find.execute("find-pattern", { pattern: "../*" }, undefined, undefined, {}), /范围无效/);
    assert.throws(() => tools.grep.execute("grep-outside", { pattern: "synthetic", path: outside }, undefined, undefined, {}), /当前工作区/);
    await assert.rejects(() => tools.ls.execute("ls-outside", { path: ".." }, undefined, undefined, {}), /当前工作区/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
