import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const { EduPiContentSider } = await createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } }).import("./EduPiContentSider.tsx");
const source = fs.readFileSync(new URL("./EduPiObjectNavigationRestore.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports, require: () => ({}) });
const { findObjectNavigationHeader, objectNavigationLayout, restoreObjectNavigationFocus } = exports;

test("narrow detail links hide the list until explicitly restored and do not carry that overlay into another module", () => {
  const state = { collapsed: false, narrow: true, revealedView: null, view: "students" };
  const initial = objectNavigationLayout(state);
  assert.equal(initial.collapsed, true);
  assert.equal(initial.foreground, false);
  const restored = objectNavigationLayout({ ...state, revealedView: "students" });
  assert.equal(restored.collapsed, false);
  assert.equal(restored.foreground, true);
  const calendar = objectNavigationLayout({ ...state, revealedView: "students", view: "calendar" });
  assert.equal(calendar.collapsed, true);
  assert.equal(calendar.foreground, false);
});

test("narrow list visibility is temporary while the wide list follows its saved preference", () => {
  for (const collapsed of [false, true]) {
    const state = { collapsed, narrow: true, revealedView: null, view: "insights" };
    assert.equal(objectNavigationLayout(state).collapsed, true);
    const revealed = objectNavigationLayout({ ...state, revealedView: "insights" });
    assert.equal(revealed.collapsed, false);
    assert.equal(revealed.foreground, true);
    const wide = objectNavigationLayout({ ...state, narrow: false, revealedView: "insights" });
    assert.equal(wide.collapsed, collapsed);
    assert.equal(wide.foreground, false);
  }
});

function element({ hidden = false, visible = true } = {}) {
  return { closest: () => hidden ? {} : null, getClientRects: () => visible ? [{}] : [] };
}

test("recovery chooses the visible current heading and the student dialog heading in a narrow window", () => {
  const old = element({ hidden: true }), heading = element(), dialog = element();
  const root = { querySelectorAll: selector => selector === ".edupi-student-drawer > header" ? [dialog] : [old, heading] };
  assert.equal(findObjectNavigationHeader(root, false), heading);
  assert.equal(findObjectNavigationHeader(root, true), dialog);
  assert.equal(findObjectNavigationHeader({ querySelectorAll: () => [element({ visible: false })] }, true), null);
});

test("the narrow calendar dialog receives the recovery control above the background calendar heading", () => {
  const main = element(), detail = element();
  const root = { querySelectorAll: selector => selector === ".edupi-student-drawer > header" ? [] : selector === ".edupi-calendar-detail > header" ? [detail] : [main] };
  assert.equal(findObjectNavigationHeader(root, true), detail);
});

function focusContext() {
  const from = {}, document = { activeElement: from, body: {} }, scroll = { scrollTop: 0 };
  const button = toolbar => ({
    calls: [], closest: () => toolbar ? {} : null,
    focus(options) { this.calls.push(options); document.activeElement = this; },
  });
  const targets = { document, collapsed: true, restoreButton: null, collapseButton: button(true), scroll, scrollTop: 173 };
  return { from, document, scroll, button, targets };
}

test("collapse waits for a late heading without stealing focus from a new user target", () => {
  const { from, document, button, targets } = focusContext();
  const request = { target: "restore", from };
  assert.equal(restoreObjectNavigationFocus(request, targets), request);
  document.activeElement = {};
  targets.restoreButton = button(true);
  assert.equal(restoreObjectNavigationFocus(request, targets), null);
  assert.equal(targets.restoreButton.calls.length, 0);
});

test("focus follows the fallback into the loaded toolbar and expansion restores list scroll", () => {
  const { from, document, scroll, button, targets } = focusContext();
  targets.restoreButton = button(false);
  const pending = restoreObjectNavigationFocus({ target: "restore", from }, targets);
  assert.equal(pending.from, targets.restoreButton);
  const removedFallback = targets.restoreButton;
  targets.restoreButton = button(true);
  document.activeElement = document.body;
  assert.equal(restoreObjectNavigationFocus(pending, targets), null);
  assert.equal(targets.restoreButton.calls.length, 1);
  const expand = { target: "list", from: targets.restoreButton };
  assert.equal(restoreObjectNavigationFocus(expand, targets), expand);
  targets.collapsed = false;
  document.activeElement = document.body;
  assert.equal(restoreObjectNavigationFocus(expand, targets), null);
  assert.equal(scroll.scrollTop, 173);
  assert.equal(targets.collapseButton.calls.length, 1);
  assert.equal(removedFallback.calls.length, 1);
});

test("the hidden list retains its content DOM and becomes unavailable to focus", () => {
  const html = renderToStaticMarkup(React.createElement(EduPiContentSider, { hidden: true, id: "list", header: "学生" }, React.createElement("input", { defaultValue: "query" })));
  assert.match(html, /hidden=""/);
  assert.match(html, /inert=""/);
  assert.match(html, /value="query"/);
  assert.doesNotMatch(html, /width:248/);
});

test("the foreground list exposes the modal navigation scope", () => {
  const html = renderToStaticMarkup(React.createElement(EduPiContentSider, { foreground: true, ariaLabel: "班级导航" }, "学生"));
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
});

test("the mounted recovery effect moves its toolbar marker and releases observers on cleanup", () => {
  const effects = [], updates = [], calls = [];
  const header = { ...element(), setAttribute: () => calls.push("mark"), removeAttribute: () => calls.push("unmark") };
  let candidates = [header], observerCallback;
  const root = { querySelectorAll: () => candidates };
  const media = { matches: false, addEventListener: () => calls.push("listen"), removeEventListener: () => calls.push("unlisten") };
  const effectExports = {};
  vm.runInNewContext(compiled, {
    exports: effectExports,
    require(name) {
      if (name === "react") return { useState: () => [null, value => updates.push(value)], useEffect: callback => effects.push(callback) };
      if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      return {};
    },
    window: { matchMedia: () => media },
    MutationObserver: class {
      constructor(callback) { observerCallback = callback; }
      observe(value) { assert.equal(value, root); calls.push("observe"); }
      disconnect() { calls.push("disconnect"); }
    },
  });
  effectExports.EduPiObjectNavigationRestore({ rootRef: { current: root }, buttonRef: { current: null }, view: "homeroom", onExpand() {}, onReady() {} });
  const cleanup = effects[0]();
  assert.equal(updates.at(-1), header);
  candidates = [];
  observerCallback();
  assert.equal(updates.at(-1), null);
  assert.ok(calls.includes("unmark"));
  cleanup();
  assert.ok(calls.includes("disconnect"));
  assert.ok(calls.includes("unlisten"));
});
