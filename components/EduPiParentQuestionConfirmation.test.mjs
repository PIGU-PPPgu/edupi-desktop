import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { create } from "react-test-renderer";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const require = createRequire(import.meta.url), exports = {};
const source = await readFile(new URL("./EduPiParentQuestionConfirmation.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const clientExports = {};
const clientSource = await readFile(new URL("../lib/edupi-parent-question-recipient-client.ts", import.meta.url), "utf8");
vm.runInNewContext(ts.transpileModule(clientSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
  { exports: clientExports, require: () => ({}) });
vm.runInNewContext(code, { exports, AbortController, Error, require: name => name === "@/lib/edupi-parent-question-recipient-client" ? clientExports : require(name) });
const { EduPiParentQuestionConfirmation } = exports;
const entry = status => ({ questionFactId: "question", questionRevision: 1, messageGeneration: 1, status,
  candidate: { confirmation_text: "确认向家长甲沟通", source_basis_hash: "hash" } });
const text = node => typeof node === "string" ? node : (node.children || []).map(text).join("");
const button = (root, label) => root.findAllByType("button").find(item => text(item) === label);
const input = root => root.findByType("textarea");
const typeConfirmation = async (root, value = entry("needs_confirmation").candidate.confirmation_text) => {
  await act(async () => input(root).props.onChange({ target: { value } }));
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
};

test("confirms and revokes entries, refreshes only on request, and rereads after conflicts", async () => {
  let entries = [entry("needs_confirmation")], reads = 0, refreshes = 0, conflict = false;
  const actions = [];
  const service = {
    async read() { reads++; return entries; },
    async update(item, action, confirmationText) {
      actions.push([item.status, action, confirmationText]);
      if (conflict) { entries = [entry("stale_confirmed")]; throw new Error("确认依据已变化，请刷新后重试"); }
      entries = [entry(action === "confirm" ? "confirmed" : "needs_confirmation")];
    },
    async refresh() { refreshes++; },
  };
  let renderer;
  await act(async () => { renderer = create(React.createElement(EduPiParentQuestionConfirmation, { query: "", service })); });
  assert.match(text(renderer.root), /确认向家长甲沟通/);
  assert.equal(refreshes, 0);
  assert.equal(input(renderer.root).props.value, "");
  assert.equal(button(renderer.root, "确认收件人").props.disabled, true);
  await act(async () => button(renderer.root, "确认收件人").props.onClick());
  assert.equal(actions.length, 0);
  await typeConfirmation(renderer.root, "错误对象");
  assert.equal(button(renderer.root, "确认收件人").props.disabled, true);
  await typeConfirmation(renderer.root);
  await act(async () => { button(renderer.root, "确认收件人").props.onClick(); });
  assert.deepEqual(actions[0], ["needs_confirmation", "confirm", "确认向家长甲沟通"]);
  assert.ok(button(renderer.root, "撤销确认"));
  assert.equal(renderer.root.findAllByType("textarea").length, 0);
  await act(async () => { button(renderer.root, "撤销确认").props.onClick(); });
  assert.deepEqual(actions[1], ["confirmed", "cancel", undefined]);
  assert.equal(input(renderer.root).props.value, "");
  conflict = true;
  await typeConfirmation(renderer.root);
  await act(async () => { button(renderer.root, "确认收件人").props.onClick(); });
  assert.match(text(renderer.root), /确认依据已变化/);
  assert.ok(button(renderer.root, "撤销确认"));
  conflict = false;
  await act(async () => { button(renderer.root, "撤销确认").props.onClick(); });
  assert.deepEqual(actions[3], ["stale_confirmed", "cancel", undefined]);
  await act(async () => { button(renderer.root, "刷新来源").props.onClick(); });
  assert.equal(refreshes, 1);
  assert.equal(reads, 6);
  await act(async () => renderer.unmount());
});

test("accepts NFKC and whitespace equivalence while sending the human input unchanged", async () => {
  const candidate = entry("needs_confirmation");
  candidate.candidate.confirmation_text = "确认向家长Ａ沟通";
  const actions = [];
  const service = { async read() { return [candidate]; }, async update(...args) { actions.push(args); }, async refresh() {} };
  let renderer;
  await act(async () => { renderer = create(React.createElement(EduPiParentQuestionConfirmation, { query: "", service })); });
  const typed = " 确认向 家长A沟通\n";
  await typeConfirmation(renderer.root, typed);
  assert.equal(button(renderer.root, "确认收件人").props.disabled, false);
  await act(async () => button(renderer.root, "确认收件人").props.onClick());
  assert.equal(actions[0][2], typed);
  assert.equal(input(renderer.root).props.value, "");
  await typeConfirmation(renderer.root, " ".repeat(501) + typed);
  assert.equal(button(renderer.root, "确认收件人").props.disabled, true);
  await act(async () => renderer.unmount());
});

test("clears typed confirmation after refresh, changed candidates, and query changes", async () => {
  let entries = [entry("needs_confirmation")];
  const service = { async read() { return entries; }, async update() {}, async refresh() {} };
  let renderer;
  await act(async () => { renderer = create(React.createElement(EduPiParentQuestionConfirmation, { query: "", service })); });
  await typeConfirmation(renderer.root);
  entries = [{ ...entry("needs_confirmation"), questionRevision: 2 }];
  await act(async () => button(renderer.root, "刷新来源").props.onClick());
  assert.equal(input(renderer.root).props.value, "");
  await typeConfirmation(renderer.root);
  await act(async () => renderer.update(React.createElement(EduPiParentQuestionConfirmation, { query: "甲", service })));
  assert.equal(input(renderer.root).props.value, "");
  await typeConfirmation(renderer.root);
  await act(async () => renderer.update(React.createElement(EduPiParentQuestionConfirmation, { query: "不存在", service })));
  assert.equal(renderer.root.findAllByType("textarea").length, 0);
  await act(async () => renderer.update(React.createElement(EduPiParentQuestionConfirmation, { query: "", service })));
  assert.equal(input(renderer.root).props.value, "");
  await act(async () => renderer.unmount());
});

test("does not let an old service read overwrite a new candidate or loading state", async () => {
  const oldRead = deferred(), newRead = deferred();
  const oldService = { read: () => oldRead.promise, async update() {}, async refresh() {} };
  const newService = { read: () => newRead.promise, async update() {}, async refresh() {} };
  let renderer;
  await act(async () => { renderer = create(React.createElement(EduPiParentQuestionConfirmation, { query: "", service: oldService })); });
  await act(async () => renderer.update(React.createElement(EduPiParentQuestionConfirmation, { query: "", service: newService })));
  await act(async () => oldRead.resolve([entry("needs_confirmation")]));
  assert.match(text(renderer.root), /加载中/);
  await act(async () => newRead.resolve([]));
  assert.match(text(renderer.root), /暂无确认事项/);
  await act(async () => renderer.unmount());
});

test("ignores late mutation readback after switching services", async () => {
  const readback = deferred();
  let reads = 0;
  const oldService = { read: () => ++reads === 1 ? Promise.resolve([entry("needs_confirmation")]) : readback.promise, async update() {}, async refresh() {} };
  const newService = { async read() { return []; }, async update() {}, async refresh() {} };
  let renderer;
  await act(async () => { renderer = create(React.createElement(EduPiParentQuestionConfirmation, { query: "", service: oldService })); });
  await typeConfirmation(renderer.root);
  await act(async () => button(renderer.root, "确认收件人").props.onClick());
  await act(async () => renderer.update(React.createElement(EduPiParentQuestionConfirmation, { query: "", service: newService })));
  await act(async () => readback.resolve([entry("confirmed")]));
  assert.match(text(renderer.root), /暂无确认事项/);
  assert.equal(button(renderer.root, "撤销确认"), undefined);
  assert.equal(button(renderer.root, "刷新来源").props.disabled, false);
  await act(async () => renderer.unmount());
});

test("isolates each candidate input and prevents duplicate submissions while a mutation is pending", async () => {
  const pending = deferred(), first = entry("needs_confirmation");
  const second = { ...entry("needs_confirmation"), questionFactId: "second",
    candidate: { ...first.candidate, confirmation_text: "确认向家长乙沟通" } };
  const actions = [];
  const service = { async read() { return [first, second]; }, async update(...args) { actions.push(args); await pending.promise; }, async refresh() {} };
  let renderer;
  await act(async () => { renderer = create(React.createElement(EduPiParentQuestionConfirmation, { query: "", service })); });
  await act(async () => renderer.root.findAllByType("textarea")[0].props.onChange({ target: { value: first.candidate.confirmation_text } }));
  const buttons = renderer.root.findAllByType("button").filter(item => text(item) === "确认收件人");
  assert.equal(buttons[0].props.disabled, false);
  assert.equal(buttons[1].props.disabled, true);
  const submit = buttons[0].props.onClick;
  await act(async () => { submit(); submit(); });
  assert.equal(actions.length, 1);
  assert.match(text(renderer.root), /加载中/);
  await act(async () => pending.resolve());
  assert.equal(renderer.root.findAllByType("textarea").every(item => item.props.value === ""), true);
  await act(async () => renderer.unmount());
});

test("discards a pending mutation failure after unmount without starting another read", async () => {
  const pending = deferred();
  let reads = 0;
  const service = { async read() { reads++; return [entry("needs_confirmation")]; }, update: () => pending.promise, async refresh() {} };
  let renderer;
  await act(async () => { renderer = create(React.createElement(EduPiParentQuestionConfirmation, { query: "", service })); });
  await typeConfirmation(renderer.root);
  await act(async () => button(renderer.root, "确认收件人").props.onClick());
  await act(async () => renderer.unmount());
  await act(async () => pending.reject(new Error("旧请求失败")));
  assert.equal(reads, 1);
});

test("removes actionable stale candidates if mutation readback fails and allows refresh retry", async () => {
  let failRead = false;
  const service = {
    async read() { if (failRead) throw new Error("列表读取失败"); return [entry("needs_confirmation")]; },
    async update() { failRead = true; throw new Error("确认依据已变化"); },
    async refresh() { failRead = false; },
  };
  let renderer;
  await act(async () => { renderer = create(React.createElement(EduPiParentQuestionConfirmation, { query: "", service })); });
  await typeConfirmation(renderer.root);
  await act(async () => button(renderer.root, "确认收件人").props.onClick());
  assert.match(text(renderer.root), /确认依据已变化；列表读取失败/);
  assert.equal(button(renderer.root, "确认收件人"), undefined);
  await act(async () => button(renderer.root, "刷新来源").props.onClick());
  assert.equal(input(renderer.root).props.value, "");
  assert.equal(button(renderer.root, "确认收件人").props.disabled, true);
  await act(async () => renderer.unmount());
});
