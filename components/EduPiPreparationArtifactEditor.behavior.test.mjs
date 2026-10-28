import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { jsx, jsxs, Fragment } from "react/jsx-runtime";
import { parseHTML } from "linkedom";

const compile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const code = compile(fs.readFileSync(process.env.EDUPI_ARTIFACT_EDITOR_SOURCE || new URL("./EduPiPreparationArtifactEditor.tsx", import.meta.url), "utf8"));
const clientCode = compile(fs.readFileSync(new URL("../lib/edupi-preparation-artifact-client.ts", import.meta.url), "utf8"));
const tick = () => new Promise(resolve => setImmediate(resolve));
const propsOf = element => element[Object.keys(element).find(key => key.startsWith("__reactProps$"))];
const artifact = (more = {}) => ({ artifact_id: "synthetic-a", task_id: "synthetic-task", title: "合成教案", content: "已保存正文", revision: 2, current_revision: 2, relative_path: ".edupi/output/synthetic-v2.md", access: "editable", history: [{ revision: 2, actor: "teacher", updated_at: "2026-10-28T00:00:00Z" }, { revision: 1, actor: "agent", updated_at: "2026-10-27T00:00:00Z" }], ...more });

async function mount({ ready = true, initial = artifact(), strict = false } = {}) {
  const { window } = parseHTML("<html><body><button id='outside'>别处</button><div id='root'></div></body></html>");
  const document = window.document, savedGlobals = {};
  for (const key of ["window", "document", "HTMLElement", "IS_REACT_ACT_ENVIRONMENT"]) savedGlobals[key] = globalThis[key];
  Object.assign(globalThis, { window, document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  let active = document.body;
  const setActive = element => { active = element; };
  const focused = [], scrolled = [], requests = [], saved = [], agent = [];
  Object.defineProperty(document, "activeElement", { configurable: true, get: () => active.isConnected && !active.matches?.(":disabled") ? active : document.body });
  Object.defineProperty(document, "hidden", { configurable: true, writable: true, value: false });
  window.getSelection = () => ({ anchorNode: null, anchorOffset: 0, focusNode: null, focusOffset: 0 });
  window.HTMLElement.prototype.focus = function () { if (!this.isConnected || this.matches(":disabled")) return; setActive(this); focused.push(this); this.dispatchEvent(new window.Event("focusin", { bubbles: true })); };
  window.HTMLElement.prototype.scrollIntoView = function (options) { scrolled.push({ target: this, options }); };
  window.HTMLElement.prototype.attachEvent = () => {};
  window.HTMLElement.prototype.detachEvent = () => {};
  // Linkedom lacks the browser textarea defaultValue reflection used by React on mount.
  Object.defineProperty(window.HTMLTextAreaElement.prototype, "defaultValue", { configurable: true, get() { return this.textContent; }, set(value) { this.textContent = String(value); } });
  const client = {};
  vm.runInNewContext(clientCode, { exports: client, URLSearchParams, Error,
    fetch(url, options = {}) { return new Promise(resolve => requests.push({ url, options, body: options.body ? JSON.parse(options.body) : null, resolve })); },
  });
  const usage = React.createContext(null), exports = {};
  const runtime = { react: React, "react/jsx-runtime": { jsx, jsxs, Fragment }, "@/lib/edupi-preparation-artifact-client": client, "./EduPiUsageObservation": { EduPiArtifactUsageContext: usage } };
  vm.runInNewContext(code, { exports, Error, TextEncoder, AbortController, require(name) { assert.ok(runtime[name], name); return runtime[name]; } });
  const props = { artifactId: "synthetic-a", workspace: "/synthetic/workspace-a", preview: value => jsx("article", { "data-preview-path": value.relative_path, children: value.content }), onSaved: value => saved.push(value), onAgent: prompt => agent.push(prompt) };
  const root = createRoot(document.getElementById("root"));
  const render = () => root.render(strict ? jsx(React.StrictMode, { children: jsx(exports.EduPiPreparationArtifactEditor, { ...props }) }) : jsx(exports.EduPiPreparationArtifactEditor, { ...props }));
  const f = { document, window, props, requests, saved, agent, focused, scrolled,
    get textarea() { return document.querySelector('textarea[aria-label="产物正文"]'); },
    get history() { return document.querySelector('[role="group"][aria-label="产物历史版本"]'); },
    get reads() { return requests.filter(request => !request.body); },
    get writes() { return requests.filter(request => request.body); },
    button(label) { const result = [...document.querySelectorAll("button")].find(button => button.textContent === label); assert.ok(result, `button ${label}`); return result; },
    async click(label) { await act(async () => { const button = f.button(label); assert.equal(button.disabled, false, label); button.focus(); button.click(); await tick(); }); },
    async draft(value) { await act(async () => { propsOf(f.textarea).onChange({ target: { value } }); }); },
    async select(revision) { await act(async () => { const button = f.history.querySelector(`[data-artifact-revision="${revision}"]`); assert.ok(button); assert.equal(button.disabled, false); button.focus(); button.click(); await tick(); }); },
    async reply(request, value = initial, { error, code } = {}) { await act(async () => { request.resolve({ ok: !error, json: async () => error ? { error, code } : { artifact: value } }); await tick(); }); },
    async key(key, composing = false) { await act(async () => { const event = new window.Event("keydown", { bubbles: true, cancelable: true }); Object.assign(event, { key, isComposing: composing }); document.querySelector(".edupi-artifact-editor").dispatchEvent(event); await tick(); }); },
    async update(next) { await act(async () => { Object.assign(props, next); render(); await tick(); }); },
    async outside(body = false) { await act(async () => { document.getElementById("outside").focus(); if (body) document.body.focus(); }); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, savedGlobals); },
  };
  await act(async () => { render(); await tick(); });
  if (ready) await f.reply(f.reads.at(-1), initial);
  focused.length = 0; return f;
}

test("entering edit focuses the actual textarea and Cancel/Escape return to the refreshed edit entry", async () => {
  const f = await mount(); try {
    await f.click("编辑正文"); assert.ok(f.document.activeElement === f.textarea); assert.ok(f.scrolled.at(-1).target === f.textarea);
    await f.draft("取消的教师草稿"); await f.click("取消"); assert.equal(f.textarea, null);
    await f.reply(f.reads.at(-1), artifact({ content: "重新读取的正文" }));
    assert.ok(f.document.activeElement === f.button("编辑正文"));
    await f.click("编辑正文"); assert.equal(f.textarea.value, "重新读取的正文");
    await f.key("Escape", true); assert.ok(f.textarea);
    await f.key("Escape"); await f.reply(f.reads.at(-1));
    assert.equal(f.textarea, null); assert.ok(f.document.activeElement === f.button("编辑正文")); assert.equal(f.writes.length, 0);
  } finally { await f.close(); }
});

test("a pending save locks fields/history/cancel and preserves exact version CAS and teacher content", async () => {
  const f = await mount(); try {
    await f.click("编辑正文"); await f.draft("保留重复正文\n保留重复正文");
    const save = propsOf(f.button("保存草稿")).onClick, changeHistory = propsOf(f.history.querySelector('[data-artifact-revision="1"]')).onClick, changeText = propsOf(f.textarea).onChange;
    await f.click("保存草稿");
    assert.equal(f.textarea.disabled, true); assert.equal([...f.history.querySelectorAll("button")].every(button => button.disabled), true); assert.equal(f.button("取消").disabled, true);
    await act(async () => { save(); changeHistory(); changeText({ target: { value: "不应进入草稿" } }); });
    await f.key("Escape"); assert.ok(f.textarea); assert.equal(f.reads.length, 1); assert.equal(f.writes.length, 1);
    assert.deepEqual(f.writes[0].body, { artifactId: "synthetic-a", expectedRevision: 2, content: "保留重复正文\n保留重复正文\n" });
    await f.reply(f.writes[0], artifact({ revision: 3, current_revision: 3, content: f.writes[0].body.content, relative_path: ".edupi/output/synthetic-v3.md" }));
    assert.equal(f.saved.length, 1); assert.equal(f.saved[0].current_revision, 3); assert.ok(f.document.activeElement === f.button("编辑正文"));
    assert.equal(f.document.querySelector("article").getAttribute("data-preview-path"), ".edupi/output/synthetic-v3.md");
  } finally { await f.close(); }
});

test("history reads lock editing and restoring an older version still submits against current_revision", async () => {
  const f = await mount(); try {
    await f.click("编辑正文"); await f.select(1);
    assert.equal(f.textarea.disabled, true); assert.equal(f.button("保存草稿").disabled, true);
    await f.reply(f.reads.at(-1), artifact({ revision: 1, current_revision: 4, content: "历史正文" }));
    assert.equal(f.textarea.value, "历史正文"); assert.ok(f.document.activeElement === f.history.querySelector('[aria-pressed="true"]'));
    await f.click("恢复此版本"); assert.equal(f.writes[0].body.expectedRevision, 4); assert.equal(f.writes[0].body.content, "历史正文\n");
    await f.reply(f.writes[0], artifact({ revision: 5, current_revision: 5, content: "历史正文\n" }));
    assert.ok(f.document.activeElement === f.button("编辑正文"));
  } finally { await f.close(); }
});

test("ordinary save failure preserves the draft and returns to save while conflicts focus explicit version recovery", async () => {
  for (const code of ["unavailable", "stale_revision", "artifact_read_only"]) {
    const f = await mount(); try {
      await f.click("编辑正文"); await f.draft("失败后保留的教师正文"); await f.click("保存草稿");
      await f.reply(f.writes[0], null, { error: "合成失败", code });
      assert.equal(f.textarea.value, "失败后保留的教师正文"); assert.equal(f.saved.length, 0);
      assert.ok(f.document.activeElement === f.button(code === "unavailable" ? "保存草稿" : "重新读取版本"));
      if (code === "artifact_read_only") { assert.equal(f.textarea.getAttributeNames().some(name => name.toLowerCase() === "readonly"), true); assert.equal(f.agent.length, 0); }
    } finally { await f.close(); }
  }
});

test("save completion and cancel refresh do not steal a newer focus even after it returns to body", async () => {
  for (const phase of ["save", "failure", "cancel"]) {
    const f = await mount(); try {
      await f.click("编辑正文"); await f.draft("合成草稿");
      await f.click(phase === "cancel" ? "取消" : "保存草稿"); await f.outside(true); f.focused.length = 0;
      const request = phase === "cancel" ? f.reads.at(-1) : f.writes[0];
      await f.reply(request, artifact({ content: phase === "cancel" ? "已存正文" : "合成草稿\n" }), phase === "failure" ? { error: "合成失败", code: "unavailable" } : {});
      assert.equal(f.focused.filter(target => target !== f.document.body).length, 0);
    } finally { await f.close(); }
  }
});

test("changing artifact or workspace invalidates late reads and detached old input handlers", async () => {
  for (const next of [{ artifactId: "synthetic-b" }, { workspace: "/synthetic/workspace-b" }]) {
    const f = await mount({ ready: false }); try {
      const old = f.reads[0]; await f.update(next);
      await f.reply(f.reads.at(-1), artifact({ artifact_id: next.artifactId || "synthetic-a", content: "新上下文正文" }));
      await f.reply(old, artifact({ content: "旧上下文迟到正文" }));
      await f.click("编辑正文"); assert.equal(f.textarea.value, "新上下文正文");
      const oldSave = propsOf(f.button("保存草稿")).onClick, oldInput = propsOf(f.textarea).onChange;
      await f.update({ workspace: "/synthetic/workspace-c" });
      await act(async () => { oldInput({ target: { value: "旧输入" } }); oldSave(); }); assert.equal(f.writes.length, 0);
    } finally { await f.close(); }
  }
});

test("late saves from an old workspace cannot call onSaved or unlock a newer pending save", async () => {
  const f = await mount(); try {
    await f.click("编辑正文"); await f.draft("旧目录正文"); await f.click("保存草稿"); const old = f.writes[0];
    await f.update({ workspace: "/synthetic/workspace-b" });
    await f.reply(f.reads.at(-1), artifact({ content: "新目录正文" })); await f.click("编辑正文"); await f.draft("新目录保存"); await f.click("保存草稿");
    f.focused.length = 0; await f.reply(old, artifact({ content: "旧目录正文\n", revision: 3, current_revision: 3 }));
    assert.equal(f.saved.length, 0); assert.equal(f.textarea.value, "新目录保存"); assert.equal(f.textarea.disabled, true);
    assert.equal(f.focused.filter(target => target !== f.document.body).length, 0);
    await f.reply(f.writes[1], artifact({ content: "新目录保存\n", revision: 3, current_revision: 3 }));
    assert.equal(f.saved.length, 1); assert.equal(f.saved[0].content, "新目录保存\n");
  } finally { await f.close(); }
});

test("readonly preview stays readonly and StrictMode read replay leaves edit/save usable", async () => {
  const readonly = await mount({ initial: artifact({ access: "read_only" }) });
  try { assert.equal([...readonly.document.querySelectorAll("button")].some(button => button.textContent === "编辑正文"), false); assert.equal(readonly.writes.length, 0); } finally { await readonly.close(); }
  const f = await mount({ strict: true }); try {
    await f.click("编辑正文"); assert.ok(f.document.activeElement === f.textarea); await f.draft("严格模式正文"); await f.click("保存草稿");
    await f.reply(f.writes[0], artifact({ content: "严格模式正文\n", revision: 3, current_revision: 3 })); assert.equal(f.saved.length, 1);
  } finally { await f.close(); }
});

test("visible version buttons read historical content without writing, then require explicit restore and preserve a failed restore draft", async () => {
  const f = await mount(); try {
    await f.click("编辑正文");
    const group = f.document.querySelector('[role="group"][aria-label="产物历史版本"]');
    assert.ok(group, "versions must be directly visible in the editor");
    assert.equal(group.querySelectorAll("button").length, 2);
    assert.equal(f.document.querySelector('select[aria-label="产物历史版本"]'), null);
    assert.equal(group.querySelector('[data-artifact-revision="2"]').getAttribute("aria-pressed"), "true");
    await f.draft("切换前的未保存正文"); const reads = f.reads.length;
    await f.select(2); assert.equal(f.reads.length, reads); assert.equal(f.textarea.value, "切换前的未保存正文");
    await f.select(1); assert.equal(f.writes.length, 0);
    assert.equal(new URL(f.reads.at(-1).url, "http://synthetic").searchParams.get("revision"), "1");
    await f.reply(f.reads.at(-1), artifact({ revision: 1, current_revision: 4, content: "明确选择的历史正文" }));
    assert.equal(f.textarea.value, "明确选择的历史正文");
    assert.equal(group.querySelector('[data-artifact-revision="1"]').getAttribute("aria-pressed"), "true");
    assert.equal(group.querySelector('[data-artifact-revision="2"]').getAttribute("aria-pressed"), "false");
    assert.equal(f.writes.length, 0, "reading an old body must not restore or save it");
    await f.click("恢复此版本");
    assert.deepEqual(f.writes[0].body, { artifactId: "synthetic-a", expectedRevision: 4, content: "明确选择的历史正文\n" });
    await f.reply(f.writes[0], null, { error: "恢复未确认", code: "unavailable" });
    assert.equal(f.textarea.value, "明确选择的历史正文"); assert.equal(f.saved.length, 0);
    assert.ok(f.document.activeElement === f.button("恢复此版本"));
    await f.click("恢复此版本");
    await f.reply(f.writes[1], artifact({ revision: 5, current_revision: 5, content: "明确选择的历史正文\n", relative_path: ".edupi/output/restored-v5.md" }));
    assert.equal(f.saved.length, 1); assert.equal(f.saved[0].current_revision, 5);
    assert.ok(f.document.activeElement === f.button("编辑正文"));
  } finally { await f.close(); }
});

test("all versions remain directly addressable and readonly history buttons still cannot restore or collaborate", async () => {
  const history = Array.from({ length: 24 }, (_, index) => ({ revision: 24 - index, actor: index % 2 ? "teacher" : "agent", updated_at: "2026-10-28T00:00:00Z" }));
  const f = await mount({ initial: artifact({ access: "read_only", revision: 24, current_revision: 24, history }) }); try {
    assert.equal(f.history.querySelectorAll("button").length, 24);
    assert.equal(f.history.querySelectorAll('[aria-pressed="true"]').length, 1);
    assert.match(f.history.querySelector('[aria-pressed="true"]').textContent, /✓.*24/);
    await f.select(1); assert.equal(f.writes.length, 0);
    await f.reply(f.reads.at(-1), artifact({ access: "read_only", revision: 1, current_revision: 24, history, content: "只读历史正文" }));
    assert.equal(f.history.querySelector('[data-artifact-revision="1"]').getAttribute("aria-pressed"), "true");
    assert.equal(f.document.querySelector("article").textContent, "只读历史正文");
    assert.equal([...f.document.querySelectorAll("button")].some(button => ["编辑正文", "恢复此版本", "保存草稿", "AI 协作"].includes(button.textContent)), false);
    assert.equal(f.writes.length, 0); assert.equal(f.agent.length, 0);
  } finally { await f.close(); }
});
