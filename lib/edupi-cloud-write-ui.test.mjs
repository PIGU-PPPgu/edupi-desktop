import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import React, { act } from "react";
import { create } from "react-test-renderer";
import ts from "typescript";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const require = createRequire(import.meta.url);
const compile = name => ts.transpileModule(fs.readFileSync(new URL(`../components/${name}.tsx`, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const content = node => typeof node === "string" ? node : (node.children || []).map(content).join("");
const fact = { id: "fact-a", entityId: "student-a", kind: "academic", predicate: "掌握", value: "隔离事实", confidence: { basis: "explicit", score: 1 },
  status: "candidate", revision: 0, conflictIds: [], sourceIds: [], observationIds: [] };

test("a queued fact write shows pending status without applying nonexistent education data", async t => {
  const exports = {};
  const modules = {
    "@/lib/edupi-fact-lifecycle-model": { conflictingAcceptedFacts: () => [] },
    "@/lib/edupi-ui-events": { EDUPI_FACTS_UPDATED_EVENT: "edupi-facts-updated" },
    "@/lib/edupi-fact-mutation-client": { runSerializedFactMutation: operation => operation() },
    "./EduPiDeleteConfirmation": { EduPiDeleteConfirmation: () => null },
    "@/lib/edupi-education-client": { educationWriteHeaders: value => value },
  };
  vm.runInNewContext(compile("EduPiFactActions"), {
    exports, require: name => modules[name] || require(name),
    window: new EventTarget(), Event, fetch: async () => ({ ok: true, status: 202, json: async () => ({ queued: true, outboxId: "saved", data: null }) }),
  });
  let updates = 0, renderer;
  await act(async () => { renderer = create(React.createElement(exports.EduPiFactActions, {
    fact, spine: { conflicts: [] }, reviewer: "teacher", onEducation: () => updates++,
  })); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  const accept = renderer.root.findAllByType("button").find(node => content(node) === "接受");
  await act(async () => accept.props.onClick());
  assert.equal(updates, 0);
  assert.match(content(renderer.toJSON()), /已保存在本机，联网后同步/);
  assert.equal(renderer.root.findAllByProps({ role: "alert" }).length, 0);
});

test("facts with missing conflict relationships cannot be accepted", async t => {
  const exports = {};
  vm.runInNewContext(compile("EduPiFactActions"), {
    exports, require: name => name === "@/lib/edupi-fact-lifecycle-model"
      ? { conflictingAcceptedFacts: () => [] } : name === "@/lib/edupi-ui-events" ? {}
        : name === "@/lib/edupi-fact-mutation-client" ? {} : name === "./EduPiDeleteConfirmation" ? {}
          : name === "@/lib/edupi-education-client" ? {} : require(name),
  });
  let renderer;
  await act(async () => { renderer = create(React.createElement(exports.EduPiFactActions, {
    fact: { ...fact, conflictIds: ["missing-conflict"] }, spine: { conflicts: [] }, reviewer: "teacher", onEducation() {},
  })); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  const accept = renderer.root.findAllByType("button").find(node => content(node) === "先处理冲突事实");
  assert.equal(accept.props.disabled, true);
  assert.match(content(renderer.toJSON()), /冲突关系尚未读取完整/);
});
