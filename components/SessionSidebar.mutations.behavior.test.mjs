import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import React, { act } from "react";
import { create } from "react-test-renderer";
import ts from "typescript";
import { createJiti } from "jiti";
const { mutateSession } = await createJiti(import.meta.url).import("../lib/session-mutation.ts");
const require = createRequire(import.meta.url);
const text = fs.readFileSync(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("sidebar.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const item = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "SessionItem");
const code = ts.transpileModule(`exports.SessionItem = ${item.getText(source)}`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const scope = JSON.stringify(["cloud", "https://synthetic.invalid", "teacher", "workspace", 4]);
const baseSession = { id: "cloud-one", cwd: "cloud:workspace", cloudScope: scope, name: "原标题",
  firstMessage: "", created: "2026-11-23T00:00:00Z", modified: "2026-11-23T00:00:00Z", messageCount: 2 };
const words = node => typeof node === "string" ? node : (node?.children || []).map(words).join("");
async function mount(t, result) {
  const savedFetch = globalThis.fetch, savedAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const writes = [], callbacks = [];
  globalThis.fetch = async (url, options) => {
    writes.push({ url, ...options });
    return typeof result === "function" ? result() : Response.json(result.body, { status: result.status });
  };
  const window = Object.assign(new EventTarget(), { innerWidth: 1200, innerHeight: 800 });
  const document = new EventTarget();
  const exported = {};
  vm.runInNewContext(code, {
    exports: exported, require, ...React, React, window, document, setTimeout, Error,
    useI18n: () => ({ t: key => key }), mutateSession, visibleTeacherMessageText: value => value,
    formatRelativeTime: () => "今天", createPortal: children => children,
    RunningSessionIndicator: () => null, UnreadSessionIndicator: () => null, DisclosureChevron: () => null,
  });
  let session = { ...baseSession }, renderer;
  const render = () => React.createElement(exported.SessionItem, {
    session, isSelected: true, onClick: () => {}, onRenamed: () => callbacks.push("renamed"),
    onDeleted: id => callbacks.push(`deleted:${id}`),
  });
  await act(async () => { renderer = create(render()); });
  t.after(async () => {
    await act(async () => renderer.unmount());
    globalThis.fetch = savedFetch;
    globalThis.IS_REACT_ACT_ENVIRONMENT = savedAct;
  });
  async function menu() {
    await act(async () => renderer.root.findByProps({ "aria-label": "sidebar.moreActions" }).props.onClick({
      stopPropagation() {}, currentTarget: { getBoundingClientRect: () => ({ right: 250, bottom: 100, top: 70 }) },
    }));
    return renderer.root.findAllByProps({ role: "menuitem" });
  }
  return {
    renderer, writes, callbacks,
    async rename() {
      const buttons = await menu();
      await act(async () => buttons[0].props.onClick());
      await act(async () => renderer.root.findByType("input").props.onChange({ target: { value: "新标题" } }));
      await act(async () => renderer.root.findByType("input").props.onBlur());
    },
    async remove() {
      const buttons = await menu();
      await act(async () => buttons[1].props.onClick({ shiftKey: true }));
    },
    async update(next) {
      session = { ...session, ...next };
      await act(async () => renderer.update(render()));
    },
  };
}

for (const action of ["rename", "remove"]) {
  test(`queued sidebar ${action} retains the row and reports pending without its completion callback`, async t => {
    const f = await mount(t, { status: 202, body: { ok: false, queued: true, pendingSync: true } });
    await f[action]();
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].headers.get("x-edupi-cloud-scope"), scope);
    assert.deepEqual(f.callbacks, []);
    assert.equal(f.renderer.root.findByProps({ className: "session-item-title" }).children.join(""), "原标题");
    assert.equal(f.renderer.root.findByProps({ role: "status" }).children.join(""), "待同步");
    if (action === "rename") {
      await f.update({ name: "新标题" });
      assert.equal(f.renderer.root.findAllByProps({ role: "status" }).length, 0);
      assert.match(words(f.renderer.toJSON()), /新标题/);
    }
  });
  test(`failed sidebar ${action} retains the row and displays the actual error`, async t => {
    const f = await mount(t, { status: 409, body: { error: "工作区已改变，请刷新。" } });
    await f[action]();
    assert.deepEqual(f.callbacks, []);
    assert.match(words(f.renderer.toJSON()), /原标题/);
    assert.match(f.renderer.root.findByProps({ role: "alert" }).children.join(""), /工作区已改变/);
  });
  test(`confirmed sidebar ${action} invokes its completion callback exactly once`, async t => {
    const f = await mount(t, { status: 200, body: { ok: true } });
    await f[action]();
    assert.deepEqual(f.callbacks, action === "rename" ? ["renamed"] : ["deleted:cloud-one"]);
  });
}

test("a completed cloud flush refreshes the actual sidebar session list", async t => {
  const body = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "SessionSidebar").body;
  const effect = body.statements.find(node => ts.isExpressionStatement(node)
    && ts.isCallExpression(node.expression) && node.expression.expression.getText(source) === "useEffect"
    && node.getText(source).includes("const onSynced"));
  assert.ok(effect);
  const code = ts.transpileModule(`exports.Watcher = function Watcher() { ${effect.getText(source)} return null; }`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const window = new EventTarget(), calls = [], exported = {};
  const loadSessions = value => calls.push(value);
  vm.runInNewContext(code, { exports: exported, useEffect: React.useEffect, window,
    EDUPI_CLOUD_STATUS_CHANGED: "status", loadSessions });
  const savedAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer;
  await act(async () => { renderer = create(React.createElement(exported.Watcher)); });
  t.after(async () => { await act(async () => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = savedAct; });
  const event = flushed => Object.assign(new Event("status"), { detail: { flushed } });
  await act(async () => window.dispatchEvent(event(0)));
  assert.deepEqual(calls, []);
  await act(async () => window.dispatchEvent(event(1)));
  assert.deepEqual(calls, [false]);
});
