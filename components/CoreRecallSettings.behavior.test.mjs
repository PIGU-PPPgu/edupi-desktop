import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import React, { act } from "react";
import { create } from "react-test-renderer";
import { jsx, jsxs } from "react/jsx-runtime";
import ts from "typescript";

const compiled = ts.transpileModule(fs.readFileSync(new URL("./CoreRecallSettings.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const models = [{ provider: "synthetic", modelId: "synthetic-model", name: "合成模型" }];
const snapshot = (approved = false, mode = "off") => ({
  version: 1, normalApproved: approved, activation: { mode, enabled: mode !== "off", reason: "ready" },
  config: { enabled: false, scope: null, model: null, limit: null, used: null, remaining: null, validUntil: null, updatedAt: null },
});
const content = node => typeof node === "string" ? node : node.children?.map(content).join("") ?? "";
async function mount(t, initial = snapshot(), classes = [{ id: "synthetic-class", name: "合成班级" }]) {
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const writes = [], state = { view: initial };
  const exports = {}, dependencies = {
    react: React, "react/jsx-runtime": { jsx, jsxs },
    "@/lib/edupi-recall-prompt-client": {
      readRecallSettings: async () => state.view,
      updateRecallSettings: async value => { writes.push(JSON.parse(JSON.stringify(value))); return state.view; },
    },
  };
  vm.runInNewContext(compiled, { exports, Date, AbortController, setTimeout: () => 1, clearTimeout() {}, require: name => {
    assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name];
  } });
  let renderer;
  await act(async () => { renderer = create(React.createElement(exports.CoreRecallSettings, { models, classes })); });
  t.after(async () => { await act(async () => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = previous; });
  const root = () => renderer.root;
  const input = label => {
    const field = root().findAllByType("label").find(node => content(node) === label);
    return root().findByProps({ id: field.props.htmlFor });
  };
  const f = {
    root, writes, state, input,
    button: label => root().findAllByType("button").find(node => content(node) === label),
    edit: (label, value) => act(async () => input(label).props.onChange({ target: { value } })),
    submit: () => act(async () => root().findByType("form").props.onSubmit({ preventDefault() {} })),
  };
  return f;
}
test("default release gate shows pending acceptance and cannot write a future enable", async t => {
  const f = await mount(t);
  assert.ok(content(f.root()).includes("待验收"));
  assert.equal(f.button("开启").props.disabled, true);
  assert.equal(f.root().findAllByType("input").length, 0);
  await f.submit();
  assert.deepEqual(f.writes, []);
  assert.equal(/grant|owner|apiKey|G1/u.test(content(f.root())), false);
});
test("unapproved canary can independently stop with the config CAS, including unknown Core stop", async t => {
  const f = await mount(t, snapshot(false, "canary"));
  assert.equal(f.button("停止").props.disabled, false);
  f.state.view = { ...snapshot(), stop: { status: "unknown", grants: "unknown" } };
  await act(async () => f.button("停止").props.onClick());
  assert.deepEqual(f.writes, [{ enabled: false, expectedUpdatedAt: null }]);
  assert.ok(content(f.root()).includes("已关闭，停止状态待核对"));
});
test("approved synthetic enable requires explicit class, subject, model, N and at most seven days without term/client authority", async t => {
  const f = await mount(t, snapshot(true));
  assert.equal(f.button("开启").props.disabled, true);
  await f.edit("班级", "synthetic-class"); await f.edit("学科", "数学");
  await f.edit("模型", JSON.stringify(["synthetic", "synthetic-model"]));
  const future = new Date(Date.now() + 86_400_000);
  const local = new Date(future.getTime() - future.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  await f.edit("有效期至", local);
  for (const count of ["", "0", "13", "1.5"]) {
    await f.edit("调用次数", count); assert.equal(f.button("开启").props.disabled, true); await f.submit();
  }
  await f.edit("调用次数", "3");
  await f.edit("有效期至", new Date(Date.now() + 8 * 86_400_000).toISOString().slice(0, 16));
  assert.equal(f.button("开启").props.disabled, true); await f.submit();
  await f.edit("有效期至", local);
  assert.equal(f.button("开启").props.disabled, false);
  await f.submit();
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.writes[0], {
    enabled: true, expectedUpdatedAt: null, scope: { classId: "synthetic-class", subject: "数学" },
    model: { provider: "synthetic", modelId: "synthetic-model" }, limit: 3, validUntil: new Date(local).toISOString(),
  });
  assert.equal(Object.hasOwn(f.writes[0].scope, "termId"), false);
});
test("an empty class source cannot manufacture scope or enable through a stale class value", async t => {
  const f = await mount(t, snapshot(true), []);
  await f.edit("班级", "synthetic-class"); await f.edit("学科", "数学");
  await f.edit("模型", JSON.stringify(["synthetic", "synthetic-model"])); await f.edit("调用次数", "1");
  await f.edit("有效期至", new Date(Date.now() + 86_400_000).toISOString().slice(0, 16));
  await f.submit();
  assert.equal(f.button("开启").props.disabled, true);
  assert.deepEqual(f.writes, []);
});
