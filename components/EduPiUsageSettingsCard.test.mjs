import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function render(outbox, loading = false) {
  let index = 0;
  const status = loading ? null : { collecting: false, usage: { consent: { status: "accepted" }, summary: { total_events: 1 } }, documents: { configured: false }, outbox };
  const react = { useState: value => [index++ === 0 ? status : value, () => {}], useEffect() {}, useCallback: fn => fn };
  const jsx = (type, props) => ({ type, props });
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(new URL("./EduPiUsageSettingsCard.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require: name => name === "react" ? react : name.includes("jsx-runtime") ? { jsx, jsxs: jsx } : {} });
  return exports.EduPiUsageSettingsCard();
}
function nodes(value) { return Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === "object" ? [value, ...nodes(value.props?.children)] : []; }
function button(tree, label) { return nodes(tree).find(node => node.type === "button" && node.props.children === label); }

test("initial usage read shows loading without claiming collection is off or offering an error retry", () => {
  const tree = render({}, true);
  assert.equal(nodes(tree).find(node => node.props?.role === "status").props.children, "读取中");
  assert.equal(button(tree, "重新读取"), undefined);
});

test("capacity-stopped events leave withdrawal and erasure available", () => {
  const tree = render({ stopped: true, pending: 1, pending_control: 0, quarantined: 0 });
  assert.equal(button(tree, "擦除用量记录").props.disabled, false);
  assert.equal(button(tree, "撤销同意").props.disabled, false);
  assert.equal(button(tree, "重试待确认操作"), undefined);
});

test("an unresolved consent or erasure exposes the original retry and blocks new controls", () => {
  const tree = render({ stopped: true, pending: 1, pending_control: 1, quarantined: 0 });
  assert.equal(button(tree, "擦除用量记录").props.disabled, true);
  assert.equal(button(tree, "撤销同意").props.disabled, true);
  assert.equal(button(tree, "重试待确认操作").props.disabled, false);
});
