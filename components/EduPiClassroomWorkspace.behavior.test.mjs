import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as crypto from "node:crypto";
import test from "node:test";
import vm from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { act, create } from "react-test-renderer";
import ts from "typescript";
import { educationWriteHeaders } from "../lib/edupi-education-client.ts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const source = readFileSync(new URL("./EduPiClassroomWorkspace.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
} }).outputText;
const students = ["a", "b"].map(student_id => ({ student_id, name: student_id, class_name: "合成班", traits: [] }));
function record(id, title = id, revision = 2) {
  return { id, domain: "duty", revision, task_id: `duty-${id}`,
    input: { title, class_name: "合成班", start_date: "2026-11-17", days: 1, weekdays: [2],
      student_ids: ["a", "b"], exempt_ids: [], posts: [{ id: "floor", name: "扫地", count: 1, weight: 1, gender: "any" }],
      max_per_day: 1, max_days_per_week: 5 },
    result: { assignments: [], workloads: [], fairness_gap: 0 }, issues: [],
    versions: Array.from({ length: revision }, (_, index) => ({ revision: index + 1, saved_at: "2026-11-17T00:00:00Z", action: "save" })),
  };
}

async function mount(t, handler) {
  const calls = [], exports = {};
  const modules = { react: React, "react/jsx-runtime": jsxRuntime,
    "@/lib/edupi-education-client": { educationWriteHeaders },
    "next/navigation": { useSearchParams: () => new URLSearchParams("classroom=duty&classroomId=classroom-a") } };
  vm.runInNewContext(compiled, { exports, crypto, URLSearchParams, window: { confirm: () => true },
    require(name) { assert.ok(modules[name], name); return modules[name]; },
    fetch: async (_url, options) => {
      const request = JSON.parse(options.body); calls.push(request);
      const response = request.action === "roster" ? { students }
        : request.action === "list" ? { records: [record("classroom-a"), record("classroom-b")].map(item => ({
          id: item.id, domain: item.domain, title: item.input.title, class_name: item.input.class_name, revision: item.revision,
        })) } : await handler(request);
      return { ok: true, json: async () => ({ ok: true, ...response }) };
    },
  });
  let renderer;
  await act(async () => { renderer = create(React.createElement(exports.EduPiClassroomWorkspace, { rosterView: null })); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return { renderer, calls };
}

test("a slow URL read cannot overwrite a later selected plan or its unsaved edits", async t => {
  let release;
  const delayed = new Promise(resolve => { release = resolve; });
  const { renderer } = await mount(t, async request => ({
    record: request.id === "classroom-a" ? await delayed : record("classroom-b"),
  }));
  assert.equal(renderer.root.findByProps({ className: "edupi-classroom-form" }).props.disabled, true);
  await act(async () => renderer.root.findByProps({ "aria-label": "打开已存方案" }).props.onChange({ target: { value: "classroom-b" } }));
  await act(async () => renderer.root.findByProps({ "aria-label": "方案名称" }).props.onChange({ target: { value: "B 的未保存修改" } }));
  await act(async () => { release(record("classroom-a")); await delayed; });
  assert.equal(renderer.root.findByProps({ "aria-label": "打开已存方案" }).props.value, "classroom-b");
  assert.equal(renderer.root.findByProps({ "aria-label": "方案名称" }).props.value, "B 的未保存修改");
});

test("a linked duty plan can restore a prior version through the same service and keep its task link", async t => {
  const { renderer, calls } = await mount(t, async request => ({
    record: request.action === "restore" ? record(request.id, "恢复的排班", 3) : record(request.id),
  }));
  const restore = renderer.root.findAllByType("button").filter(button => button.props.children === "恢复");
  assert.deepEqual(restore.map(button => button.props.disabled), [true, false]);
  await act(async () => restore[1].props.onClick());
  assert.deepEqual(calls.find(request => request.action === "restore"), {
    domain: "duty", action: "restore", input: record("classroom-a").input, id: "classroom-a", expected_revision: 2, revision: 1,
  });
  assert.equal(renderer.root.findByProps({ "aria-label": "方案名称" }).props.value, "恢复的排班");
  assert.ok(renderer.root.findAllByType("a").some(link => link.props.href.includes("taskDetail=duty-classroom-a")));
});
