import fs from "node:fs";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { createFindToolDefinition, createGrepToolDefinition, createLsToolDefinition, createReadToolDefinition, defineTool } from "@earendil-works/pi-coding-agent";

function guard(root: string, input: string): void {
  const absolute = path.resolve(root, input);
  let actual: string;
  try { actual = fs.realpathSync(absolute); }
  catch { throw new Error("子任务只能读取当前工作区内现有的文件"); }
  const relative = path.relative(root, actual);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("子任务只能读取当前工作区");
}

function guardPattern(pattern: string): void {
  if (!pattern || path.isAbsolute(pattern) || pattern.split(/[\\/]/u).includes("..") || pattern.includes("\0")) throw new Error("子任务查找范围无效");
}

/** Host-owned versions of Pi's read tools; absolute paths and symlinks cannot escape cwd. */
export function createWorkflowReadTools(cwd: string) {
  const root = fs.realpathSync(cwd);
  const read = createReadToolDefinition(root, { operations: {
    readFile: async file => { guard(root, file); return readFile(file); },
    access: async file => { guard(root, file); await access(file); },
  } });
  const find = createFindToolDefinition(root);
  const findExecute = find.execute.bind(find);
  find.execute = (id, params, signal, update, ctx) => {
    guard(root, params.path ?? ".");
    guardPattern(params.pattern);
    return findExecute(id, params, signal, update, ctx);
  };
  const grep = createGrepToolDefinition(root, { operations: {
    isDirectory: async file => { guard(root, file); return (await stat(file)).isDirectory(); },
    readFile: async file => { guard(root, file); return readFile(file, "utf8"); },
  } });
  const grepExecute = grep.execute.bind(grep);
  grep.execute = (id, params, signal, update, ctx) => {
    guard(root, params.path ?? ".");
    if (params.glob) guardPattern(params.glob);
    return grepExecute(id, params, signal, update, ctx);
  };
  const ls = createLsToolDefinition(root, { operations: {
    exists: file => { guard(root, file); return fs.existsSync(file); },
    stat: async file => { guard(root, file); return stat(file); },
    readdir: async file => { guard(root, file); return readdir(file); },
  } });
  return [defineTool(read), defineTool(find), defineTool(grep), defineTool(ls)];
}
