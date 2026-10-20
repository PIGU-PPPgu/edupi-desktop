import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(await readFile(new URL("./DesktopConnectionNotice.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const record = (sequence, patch = {}) => ({ sequence, startedAt: 1_700_000_000_000 + sequence, documentStartedAt: 1_699_999_999_000,
  durationMs: 4_000, visibility: "visible", settledVisibility: "hidden", outcome: "timeout", httpStatus: null, instance: "unavailable", ...patch });

function fixture() {
  let open = false, retries = 0, dismiss;
  const exports = {};
  vm.runInNewContext(compiled, { exports, Date, require(name) {
    if (name === "react") return { useState: () => [open, value => { open = value; }] };
    if (name === "react/jsx-runtime") return require(name);
    if (name === "@/hooks/useI18n") return { useI18n: () => ({ t: key => ({ "connection.offline": "连接已断开", "connection.retry": "重新连接" })[key] }) };
    if (name === "@/hooks/useModalDismiss") return { useModalDismiss: onDismiss => { dismiss = onDismiss; return { current: null }; } };
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  const render = (state, diagnostics = []) => exports.DesktopConnectionNotice({ state, diagnostics, retry() { retries++; } });
  return { render, retries: () => retries, dismiss: () => dismiss() };
}

function button(element, text) {
  if (!React.isValidElement(element)) return null;
  if (element.type === "button" && element.props.children === text) return element;
  return React.Children.toArray(element.props.children).map(child => button(child, text)).find(Boolean);
}

test("connection details are disclosed on demand and leave the existing reconnect action intact", () => {
  const view = fixture();
  const initial = view.render("offline", [record(1)]);
  const html = renderToStaticMarkup(initial);
  assert.ok(html.includes('role="alert"'));
  assert.ok(!html.includes('role="dialog"'));
  assert.ok(!html.includes("4000 ms"));
  button(initial, "重新连接").props.onClick();
  assert.equal(view.retries(), 1);
  button(initial, "连接详情").props.onClick();
  const opened = renderToStaticMarkup(view.render("offline", [record(1)]));
  assert.ok(opened.includes('role="dialog" aria-modal="true" aria-labelledby="desktop-connection-title"'));
  assert.ok(opened.includes("4000 ms"));
  assert.ok(opened.includes("超时"));
  assert.ok(opened.includes("前台 → 后台"));
  assert.ok(opened.includes('data-autofocus="true"'));
});

test("an opened connection dialog survives online recovery until dismissed", () => {
  const view = fixture();
  button(view.render("offline", [record(1)]), "连接详情").props.onClick();
  const html = renderToStaticMarkup(view.render("online", [record(1), record(2, { outcome: "ok", httpStatus: 204, durationMs: 12, instance: "same" })]));
  assert.ok(!html.includes('role="alert"'));
  assert.ok(html.includes('role="dialog"'));
  assert.ok(html.includes("超时"));
  assert.ok(html.includes("正常 204"));
  assert.ok(html.includes("相同"));
  assert.ok(html.includes("文档启动"));
  view.dismiss();
  assert.equal(renderToStaticMarkup(view.render("online", [record(1)])), "");
});

test("online and checking connections add no default diagnostic copy", () => {
  const view = fixture();
  assert.equal(renderToStaticMarkup(view.render("online", [record(1)])), "");
  assert.equal(renderToStaticMarkup(view.render("checking", [record(1)])), "");
});
