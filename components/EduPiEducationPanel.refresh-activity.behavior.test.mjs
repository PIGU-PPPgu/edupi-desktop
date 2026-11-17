import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React, { act } from "react";
import { create } from "react-test-renderer";

const text = fs.readFileSync(new URL("./EduPiEducationPanel.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("panel.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const body = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "EduPiEducationPanel").body;
const declaration = name => body.statements.find(node => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(item => ts.isArrayBindingPattern(item.name)
    ? item.name.elements.some(binding => binding.name?.getText(source) === name) : item.name.getText(source) === name)).getText(source);
const effects = body.statements.filter(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
  && node.expression.expression.getText(source) === "useEffect");
const effect = marker => {
  const matches = effects.filter(node => node.getText(source).includes(marker));
  assert.equal(matches.length, 1, marker);
  return matches[0].getText(source);
};
const compiled = ts.transpileModule(`exports.PanelReads = function PanelReads({readOnlyRefreshActive = true, refreshKey = 0}) {
  ${declaration("pageVisible")}
  ${effect('document.addEventListener("visibilitychange"')}
  ${declaration("projectionReadsActive")}
  const workspaceLoadSequenceRef = useRef(0), workspaceMinimumApplySequenceRef = useRef(0), durableTaskIdsRef = useRef(new Set());
  ${declaration("loadWorkspace")}
  ${effect("setLoading(true)")}
  ${effect('window.addEventListener("edupi-preparation-updated"')}
  ${effect('fetch("/api/edupi/kernel"')}
  expose(loadWorkspace);
  return null;
}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const workspace = () => ({ context: { name: "synthetic" }, data: { tasks: [], workspace: "/synthetic" } });

async function mount(t, props = {}) {
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const document = new EventTarget(), window = new EventTarget(), timers = new Map();
  document.visibilityState = "visible";
  const state = { reads: 0, kernelBatch: 0, polls: [], updates: 0, nextWorkspace: [], nextPoll: [], loader: null };
  let nextTimer = 0;
  const exported = {};
  vm.runInNewContext(compiled, { exports: exported, ...React, document, window, AbortController, DOMException,
    setTimeout: (callback, ms) => { timers.set(++nextTimer, { callback, ms }); return nextTimer; },
    clearTimeout: id => timers.delete(id),
    readEduPiWorkspace: async () => { state.reads++; return state.nextWorkspace.shift()?.promise ?? workspace(); },
    readEducationMemoryScopes: async () => null, readEduPiTeachingSkills: async () => ({}),
    readEduPiKernel: async () => { state.kernelBatch++; return { running: 0 }; },
    fetch: async (url, options) => {
      state.polls.push({ url, signal: options.signal });
      return state.nextPoll.shift()?.promise ?? { ok: true, json: async () => ({ running: 0 }) };
    },
    normalizeKernelState: value => value, hasEveryTrackedTask: () => true,
    preserveUnavailableWorkspaceResources: (_old, value) => value,
    setContext: () => { state.updates++; }, setEducation() {}, setMemoryScopes() {}, setTeachingSkills() {},
    setKernelState() {}, setRunningKernelCount() {}, setLoading() {}, setLoadError() {}, setReviewMessage() {},
    setMaterialStagingMessage() {}, scheduleResolutionMatchesTarget: () => false,
    expose: value => { state.loader = value; },
  });
  let renderer;
  await act(async () => { renderer = create(React.createElement(exported.PanelReads, props)); });
  t.after(async () => { await act(async () => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = previous; });
  return { state, document, window, timers,
    async update(next) { props = { ...props, ...next }; await act(async () => renderer.update(React.createElement(exported.PanelReads, props))); },
    async run(callback) { await act(async () => { await callback(); }); },
  };
}

test("an overlaid panel reads nothing, refreshes once on return and does not duplicate the initial kernel request", async t => {
  const f = await mount(t, { readOnlyRefreshActive: false });
  assert.equal(f.state.reads, 0); assert.equal(f.timers.size, 0);
  await f.update({ readOnlyRefreshActive: true });
  assert.equal(f.state.reads, 1); assert.equal(f.state.kernelBatch, 1); assert.equal(f.state.polls.length, 0);
  assert.equal([...f.timers.values()][0].ms, 20_000);
  await f.update({ readOnlyRefreshActive: false, refreshKey: 2 });
  assert.equal(f.state.reads, 1); assert.equal(f.timers.size, 0);
  await f.update({ readOnlyRefreshActive: true });
  assert.equal(f.state.reads, 2);
});

test("page visibility cancels display polling and resumes with one current workspace batch", async t => {
  const f = await mount(t);
  const [id, timer] = [...f.timers.entries()][0];
  await f.run(() => { f.timers.delete(id); return timer.callback(); });
  assert.equal(f.state.polls.length, 1);
  await f.run(() => { f.document.visibilityState = "hidden"; f.document.dispatchEvent(new Event("visibilitychange")); });
  assert.equal(f.state.polls[0].signal.aborted, true); assert.equal(f.timers.size, 0);
  await f.run(() => { f.document.visibilityState = "visible"; f.document.dispatchEvent(new Event("visibilitychange")); });
  assert.equal(f.state.reads, 2); assert.equal(f.state.polls.length, 1);
});

test("reply file refresh does not duplicate the refresh-key batch, while actual source events still refresh", async t => {
  const f = await mount(t);
  await f.run(() => f.window.dispatchEvent(new CustomEvent("edupi-artifacts-updated", { detail: { refreshOnly: true } })));
  assert.equal(f.state.reads, 1);
  await f.update({ refreshKey: 1 });
  assert.equal(f.state.reads, 2);
  await f.run(() => f.window.dispatchEvent(new Event("edupi-artifacts-updated")));
  assert.equal(f.state.reads, 3);
  await f.update({ readOnlyRefreshActive: false });
  await f.run(() => f.window.dispatchEvent(new Event("edupi-education-refresh")));
  assert.equal(f.state.reads, 3);
});

test("a cancelled display read cannot publish late data, and explicit mutation readback still runs behind an overlay", async t => {
  const f = await mount(t), pending = deferred();
  f.state.nextWorkspace.push(pending);
  await f.update({ refreshKey: 1 });
  const updates = f.state.updates;
  await f.update({ readOnlyRefreshActive: false });
  await f.run(() => pending.resolve(workspace()));
  assert.equal(f.state.updates, updates);
  await f.run(() => f.state.loader());
  assert.equal(f.state.reads, 3, "a mutation's explicit readback is not gated by display activity");
  assert.equal(f.state.updates, updates + 1);
});

for (const event of ["edupi-artifacts-updated", "edupi-preparation-updated", "edupi-education-refresh"]) {
  test(`${event} pending display reads are cancelled when the Admin overlay opens`, async t => {
    const f = await mount(t), pending = deferred();
    f.state.nextWorkspace.push(pending);
    await f.run(() => f.window.dispatchEvent(new Event(event)));
    const updates = f.state.updates;
    await f.update({ readOnlyRefreshActive: false });
    await f.run(() => pending.resolve(workspace()));
    assert.equal(f.state.updates, updates);
    await f.update({ readOnlyRefreshActive: true });
    assert.equal(f.state.reads, 3);
  });
}
