import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const start = source.indexOf("const handleCwdChange = useCallback(");
const end = source.indexOf("\n  const handleSelectSession =", start);
assert.ok(start >= 0 && end > start);
const code = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function runChange({ selectedSession, previousProject = "/old", cwd, projectRoot, restoring = false }) {
  const calls = {};
  const setters = [
    "setActiveCwd", "setFileTabs", "setActiveFileTabId", "setRightPanelOpen",
    "setSelectedSession", "setNewSessionCwd", "setBranchTree", "setBranchActiveLeafId",
    "setSystemPrompt", "setActiveTopPanel",
  ];
  const context = {
    selectedSession,
    activeProjectRootRef: { current: previousProject },
    suppressCwdBumpRef: { current: restoring },
    edupiEducationModule: null,
    router: { replace: (...args) => { calls.route = args; } },
    useCallback: (callback) => callback,
    ...Object.fromEntries(setters.map((key) => [key, (value) => { calls[key] = value; }])),
  };
  vm.createContext(context);
  vm.runInContext(code + "\nthis.change = handleCwdChange;", context);
  context.change(cwd, projectRoot);
  return { calls, context };
}

test("opening another project's session keeps the selected chat and drops stale file tabs", () => {
  const { calls } = runChange({
    selectedSession: { id: "clicked", cwd: "/new/worktree", projectRoot: "/new" },
    cwd: "/new/worktree", projectRoot: "/new",
  });
  assert.equal(calls.setSelectedSession, undefined);
  assert.equal(calls.route, undefined);
  assert.equal(calls.setRightPanelOpen, false);
  assert.equal(calls.setActiveFileTabId, null);
  assert.equal(calls.setFileTabs.length, 0);
});

test("explicit project-picker switch still closes the unrelated chat", () => {
  const { calls } = runChange({
    selectedSession: { id: "old", cwd: "/old" }, cwd: "/new",
  });
  assert.equal(calls.setSelectedSession, null);
  assert.equal(calls.route[0], "/");
});

test("same-project worktree navigation retains file tabs", () => {
  const { calls } = runChange({
    selectedSession: { id: "old", cwd: "/old" }, cwd: "/old-worktree", projectRoot: "/old",
  });
  assert.equal(calls.setSelectedSession, undefined);
  assert.equal(calls.setFileTabs, undefined);
});

test("initial restore updates project identity without clearing the restored session", () => {
  const { calls, context } = runChange({
    selectedSession: { id: "restored", cwd: "/new" }, cwd: "/new", restoring: true,
  });
  assert.equal(context.activeProjectRootRef.current, "/new");
  assert.equal(context.suppressCwdBumpRef.current, false);
  assert.equal(calls.setSelectedSession, undefined);
  assert.equal(calls.setFileTabs, undefined);
});
