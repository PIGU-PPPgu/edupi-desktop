import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createJiti } from "jiti";

const discovery = await createJiti(import.meta.url).import("../lib/openconnector-discovery.ts");
const source = await readFile(new URL("./OpenConnectorProviderIcon.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
} }).outputText;

test("official logos load privately and lazily, then fall back after an image error", () => {
  let failed = null;
  const jsx = (type, props) => ({ type, props });
  const modules = { react: { useState: () => [failed, (value) => { failed = value; }] },
    "react/jsx-runtime": { jsx, jsxs: jsx }, "@/lib/openconnector-discovery": discovery };
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: (name) => modules[name] });
  const github = { service: "github", displayName: "GitHub" };
  const initial = exports.OpenConnectorProviderIcon(github);
  assert.equal(initial.props["aria-hidden"], "true");
  assert.equal(initial.props.children.type, "img");
  assert.equal(initial.props.children.props.loading, "lazy");
  assert.equal(initial.props.children.props.referrerPolicy, "no-referrer");
  assert.equal(initial.props.children.props.alt, "");
  initial.props.children.props.onError();
  assert.equal(exports.OpenConnectorProviderIcon(github).props.children, "GI");
  assert.equal(exports.OpenConnectorProviderIcon({ service: "workday", displayName: "Workday" }).props.children, "WO");
  const next = exports.OpenConnectorProviderIcon({ service: "feishu", displayName: "Feishu" });
  assert.equal(next.props.children.type, "img", "failure belongs to one image URL");
  assert.ok(next.props.children.props.src.endsWith("/feishu.svg"));
});
