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
vm.runInNewContext(code, { exports, AbortController, Error, require: name => name === "@/lib/edupi-parent-question-recipient-client" ? {} : require(name) });
const { EduPiParentQuestionConfirmation } = exports;
const entry = status => ({ questionFactId: "question", questionRevision: 1, messageGeneration: 1, status,
  candidate: { confirmation_text: "确认向家长甲沟通", source_basis_hash: "hash" } });
const text = node => typeof node === "string" ? node : (node.children || []).map(text).join("");
const button = (root, label) => root.findAllByType("button").find(item => text(item) === label);

test("confirms and revokes entries, refreshes only on request, and rereads after conflicts", async () => {
  let entries = [entry("needs_confirmation")], reads = 0, refreshes = 0, conflict = false;
  const actions = [];
  const service = {
    async read() { reads++; return entries; },
    async update(item, action) {
      actions.push([item.status, action]);
      if (conflict) { entries = [entry("stale_confirmed")]; throw new Error("确认依据已变化，请刷新后重试"); }
      entries = [entry(action === "confirm" ? "confirmed" : "needs_confirmation")];
    },
    async refresh() { refreshes++; },
  };
  let renderer;
  await act(async () => { renderer = create(React.createElement(EduPiParentQuestionConfirmation, { query: "", service })); });
  assert.match(text(renderer.root), /确认向家长甲沟通/);
  assert.equal(refreshes, 0);
  await act(async () => { button(renderer.root, "确认收件人").props.onClick(); });
  assert.deepEqual(actions[0], ["needs_confirmation", "confirm"]);
  assert.ok(button(renderer.root, "撤销确认"));
  await act(async () => { button(renderer.root, "撤销确认").props.onClick(); });
  assert.deepEqual(actions[1], ["confirmed", "cancel"]);
  conflict = true;
  await act(async () => { button(renderer.root, "确认收件人").props.onClick(); });
  assert.match(text(renderer.root), /确认依据已变化/);
  assert.ok(button(renderer.root, "撤销确认"));
  conflict = false;
  await act(async () => { button(renderer.root, "撤销确认").props.onClick(); });
  assert.deepEqual(actions[3], ["stale_confirmed", "cancel"]);
  await act(async () => { button(renderer.root, "刷新来源").props.onClick(); });
  assert.equal(refreshes, 1);
  assert.equal(reads, 6);
  await act(async () => renderer.unmount());
});
