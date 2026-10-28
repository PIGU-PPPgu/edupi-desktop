import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { jsx, jsxs, Fragment } from "react/jsx-runtime";
import { parseHTML } from "linkedom";

const compileText = source => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const compile = relative => compileText(fs.readFileSync(new URL(relative, import.meta.url), "utf8"));
const shellText = fs.readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
const shellAst = ts.createSourceFile("AppShell.tsx", shellText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let fallback, embedded;
function findSidebarOwners(node) {
  if (ts.isJsxExpression(node) && node.expression && ts.isConditionalExpression(node.expression) && node.expression.getText(shellAst).includes("sidebarContent")) fallback = node.expression;
  if (ts.isJsxAttribute(node) && node.name.getText(shellAst) === "chatSidebar") embedded = node.initializer.expression;
  ts.forEachChild(node, findSidebarOwners);
}
findSidebarOwners(shellAst);
assert.ok(fallback && embedded);
const ownershipExports = {};
vm.runInNewContext(compileText(`exports.project = (edupiEducationModule, initialSessionRestored, sidebarContent, renderSessionSidebar) => ({ fallback: ${fallback.getText(shellAst)}, embedded: ${embedded.getText(shellAst)} });`), { exports: ownershipExports });
const tick = () => new Promise(resolve => setImmediate(resolve));

async function mount(initial = {}) {
  const saved = Object.fromEntries(["window", "document", "HTMLElement", "IS_REACT_ACT_ENVIRONMENT", "requestAnimationFrame", "cancelAnimationFrame"].map(key => [key, globalThis[key]]));
  const { window } = parseHTML("<html><body><button data-outside>其他模块</button><div id='root'></div></body></html>");
  const document = window.document;
  const focusState = { element: document.body };
  let nextFrame = 0;
  const focusEvents = [];
  const frames = new Map();
  const layout = { active: true, narrow: true, scope: "synthetic-root-a", ...initial };
  Object.assign(globalThis, { window, document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; }, cancelAnimationFrame(id) { frames.delete(id); } });
  Object.defineProperty(document, "hidden", { configurable: true, value: false, writable: true });
  Object.defineProperty(document, "activeElement", { configurable: true, get: () => focusState.element?.isConnected && !focusState.element.closest?.("[hidden]") ? focusState.element : document.body });
  Object.defineProperty(window.HTMLElement.prototype, "offsetParent", { configurable: true, get() {
    return this.closest("[hidden]") || !layout.narrow && this.closest(".edupi-chat-sidebar-header") ? null : document.body;
  } });
  window.HTMLElement.prototype.focus = function () {
    focusEvents.push({ tag: this.tagName, label: this.getAttribute("aria-label"), connected: this.isConnected, hidden: Boolean(this.closest("[hidden]")) });
    // Browsers ignore focus() on a hidden element. React may try to restore its
    // former trigger during commit before the modal effect takes focus.
    if (this.closest("[hidden]")) return;
    focusState.element = this; this.dispatchEvent(new window.Event("focusin", { bubbles: true }));
  };
  window.HTMLElement.prototype.attachEvent = () => {};
  window.HTMLElement.prototype.detachEvent = () => {};
  window.innerWidth = 800; window.innerHeight = 800;
  window.HTMLElement.prototype.getBoundingClientRect = function () { return { top: 100, bottom: 128, left: 40, right: 260, width: 220, height: 28 }; };
  const modules = { react: React, "react/jsx-runtime": { jsx, jsxs, Fragment }, "react-dom": { createPortal },
    "@/hooks/useI18n": { useI18n: () => ({ t: key => key }) },
    "./FileExplorer": {}, "./ProjectPicker": {}, "./DisclosureChevron": { DisclosureChevron: () => null },
    "./path-ui": {}, "@/lib/app-prefs": {}, "@/lib/desktop-notify": {}, "@/lib/desktop-updater": {},
    "@/lib/desktop-native": {}, "@/lib/desktop-window": {}, "@/lib/edupi-composer-context": { visibleTeacherMessageText: value => value },
  };
  const rowExports = {};
  vm.runInNewContext(compile("./SessionSidebar.tsx") + "\nexports.SessionItemProbe = SessionItem;", { exports: rowExports, document, window, setTimeout, clearTimeout,
    fetch() { assert.fail("No API may run in the menu probe"); },
    require(name) { assert.ok(modules[name], name); return modules[name]; },
  });
  const load = relative => {
    const exports = {};
    vm.runInNewContext(compile(relative), { exports, document, window,
      requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame,
      require(name) { assert.ok(modules[name], name); return modules[name]; } });
    return exports;
  };
  const { useModalDismiss } = load("../hooks/useModalDismiss.ts");
  modules["@/hooks/useModalDismiss"] = { useModalDismiss };
  const { EduPiChatSidebarFrame } = load("./EduPiChatSidebarFrame.tsx");
  const host = { sidebarMounts: 0, composerMounts: 0, sidebarPresentations: [], sidebarCommitCounts: [], visibilityCommits: [], chatFocus: 0, openResource: null, focusEvents };
  function Sidebar({ presentation = "embedded-chat" }) {
    const mountedPresentation = React.useRef(presentation);
    React.useEffect(() => { host.sidebarMounts++; host.sidebarPresentations.push(mountedPresentation.current); }, []);
    if (layout.actualMenu) return React.createElement("section", { "data-sidebar-instance": presentation },
      layout.headerResource ? React.createElement("button", { onClick: () => { window.dispatchEvent(new window.Event("edupi-chat-sidebar-action")); host.openResource(); } }, "打开合成资源") : null,
      React.createElement(rowExports.SessionItemProbe, {
        session: { id: "synthetic", name: "合成会话", firstMessage: "synthetic", created: "2026-10-27T00:00:00Z", messageCount: 2 },
        isSelected: true, onClick() {},
      }));
    return React.createElement("section", { "data-sidebar-instance": presentation },
      React.createElement("input", { "aria-label": "搜索对话", defaultValue: "" }),
      ...["选择合成会话", "新建合成会话"].map(name => React.createElement("button", { key: name, onClick: () => window.dispatchEvent(new window.Event("edupi-session-navigated")) }, name)),
      React.createElement("button", { onClick: () => { window.dispatchEvent(new window.Event("edupi-chat-sidebar-action")); host.openResource(); } }, "打开合成资源"));
  }
  function Composer() {
    React.useEffect(() => { host.composerMounts++; }, []);
    return React.createElement("textarea", { "aria-label": "合成草稿", defaultValue: "" });
  }
  function ResourceDialog({ close }) {
    const ref = useModalDismiss(close);
    return React.createElement("section", { ref, role: "dialog", "aria-modal": true, "aria-label": "合成资源" }, React.createElement("button", { "data-autofocus": true, onClick: close }, "关闭合成资源"));
  }
  function Parent() {
    const [resource, setResource] = React.useState(false);
    host.openResource = () => setResource(true);
    const owner = layout.startup ? ownershipExports.project("home", Boolean(layout.ready), React.createElement(Sidebar, { presentation: "default" }), presentation => React.createElement(Sidebar, { presentation })) : null;
    React.useLayoutEffect(() => {
      host.sidebarCommitCounts.push(document.querySelectorAll("[data-sidebar-instance]").length);
      const menu = document.querySelector(".session-item-menu");
      host.visibilityCommits.push({ scope: layout.scope, hidden: document.querySelector("aside").hidden, inert: document.querySelector("main").hasAttribute("inert"),
        menuInteractive: Boolean(menu && !menu.closest("[hidden], [inert]")) });
    });
    return React.createElement(React.Fragment, null,
      layout.startup ? React.createElement("div", { hidden: true }, owner.fallback) : null,
      React.createElement(EduPiChatSidebarFrame, { ...layout, sidebar: layout.startup ? owner.embedded : React.createElement(Sidebar), onFocusChat() { host.chatFocus++; document.querySelector("textarea").focus(); } },
        React.createElement("main", { "data-main": true, inert: layout.externalInert }, React.createElement(Composer))),
      resource ? React.createElement(ResourceDialog, { close: () => setResource(false) }) : null);
  }
  const root = createRoot(document.getElementById("root"));
  const f = { host, document, window, layout,
    aside: () => document.querySelector("aside"),
    main: () => document.querySelector("main"),
    composer: () => document.querySelector("textarea"),
    search: () => document.querySelector('input[aria-label="搜索对话"]'),
    trigger: () => document.querySelector('[aria-label="显示对话与文件"]'),
    button(name) { const button = [...document.querySelectorAll("button")].find(item => item.textContent === name || item.getAttribute("aria-label") === name); assert.ok(button, name); return button; },
    async render(next = {}) { Object.assign(layout, next); await act(async () => { root.render(React.createElement(Parent)); await tick(); }); },
    async run(callback) { await act(async () => { callback(); await tick(); }); },
    async click(name) { await f.run(() => { const button = f.button(name); button.focus(); button.click(); }); },
    async key(key, more = {}) { let event; await f.run(() => { event = new window.Event("keydown", { bubbles: true, cancelable: true }); Object.defineProperties(event, { key: { value: key }, shiftKey: { value: Boolean(more.shiftKey) } }); document.activeElement.dispatchEvent(event); }); return event; },
    async flushFrames() { await f.run(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); }); },
    async type(value) { await f.run(() => { const field = f.composer(); field.focus(); field.value = value; field.dispatchEvent(new window.Event("input", { bubbles: true })); }); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, saved); },
  };
  await f.render();
  return f;
}

test("initial 800 layout reserves no list region and keeps the composer usable", async () => {
  const f = await mount();
  try {
    assert.equal(f.aside().hidden, true);
    assert.equal(f.aside().hasAttribute("inert"), true);
    assert.equal(f.main().hasAttribute("inert"), false);
    assert.equal(f.trigger().hidden, false);
    await f.type("[UI TEST] 未发送草稿");
    assert.equal(f.composer().value, "[UI TEST] 未发送草稿");
  } finally { await f.close(); }
});

test("list toggle traps keyboard focus and Escape returns to its visible trigger", async () => {
  const f = await mount();
  try {
    await f.click("显示对话与文件");
    assert.equal(f.aside().getAttribute("role"), "dialog");
    assert.equal(f.aside().getAttribute("aria-modal"), "true");
    assert.equal(f.main().hasAttribute("inert"), true);
    assert.ok(document.activeElement === f.button("收起对话与文件"), JSON.stringify({ focus: document.activeElement.tagName, hidden: f.aside().hidden, effects: f.host.focusEvents, inside: f.aside().contains(document.activeElement), html: f.aside().outerHTML.slice(0, 300) }));
    await f.key("Tab", { shiftKey: true });
    assert.ok(document.activeElement === f.button("打开合成资源"));
    await f.key("Tab");
    assert.ok(document.activeElement === f.button("收起对话与文件"));
    await f.key("Escape");
    assert.equal(f.aside().hidden, true);
    assert.equal(f.main().hasAttribute("inert"), false);
    assert.ok(document.activeElement === f.trigger());
  } finally { await f.close(); }
});

for (const action of ["选择合成会话", "新建合成会话"]) test(`${action} closes the panel and focuses the same composer`, async () => {
  const f = await mount();
  try {
    const composer = f.composer(), sidebar = f.aside(), search = f.search();
    await f.type("[UI TEST] 待回执后的草稿");
    await f.click("显示对话与文件"); await f.click(action); await f.flushFrames();
    assert.equal(f.aside().hidden, true);
    assert.ok(document.activeElement === composer);
    assert.ok(f.composer() === composer && f.aside() === sidebar && f.search() === search);
    assert.equal(composer.value, "[UI TEST] 待回执后的草稿");
    assert.equal(f.host.sidebarMounts, 1); assert.equal(f.host.composerMounts, 1);
  } finally { await f.close(); }
});

test("wide and narrow transitions retain instances, draft and wide list visibility", async () => {
  const f = await mount({ narrow: false });
  try {
    const composer = f.composer(), sidebar = f.aside();
    assert.equal(sidebar.hidden, false);
    await f.type("[UI TEST] 变宽变窄保留");
    await f.render({ narrow: true });
    assert.equal(sidebar.hidden, true); assert.ok(document.activeElement === composer);
    await f.click("显示对话与文件"); await f.click("收起对话与文件");
    await f.render({ narrow: false });
    assert.equal(sidebar.hidden, false); assert.equal(sidebar.getAttribute("aria-modal"), null);
    await f.render({ narrow: true });
    assert.equal(sidebar.hidden, true);
    assert.ok(f.composer() === composer && f.aside() === sidebar);
    assert.equal(composer.value, "[UI TEST] 变宽变窄保留");
    assert.equal(f.host.sidebarMounts, 1); assert.equal(f.host.composerMounts, 1);
  } finally { await f.close(); }
});

test("a focused wide list becomes foreground on narrowing instead of losing its search", async () => {
  const f = await mount({ narrow: false });
  try {
    f.search().focus(); await f.render({ narrow: true });
    assert.equal(f.aside().hidden, false); assert.equal(f.main().hasAttribute("inert"), true);
    assert.ok(document.activeElement === f.search());
  } finally { await f.close(); }
});

test("a workspace change wins over focused-list preservation in the first narrowing commit", async () => {
  const f = await mount({ narrow: false });
  try {
    const sidebar = f.aside(), composer = f.composer(), search = f.search();
    await f.run(() => search.focus());
    await f.render({ narrow: true, scope: "synthetic-root-b" });
    assert.equal(sidebar.hidden, true); assert.equal(f.main().hasAttribute("inert"), false);
    assert.ok(f.host.visibilityCommits.filter(commit => commit.scope === "synthetic-root-b").every(commit => commit.hidden && !commit.inert));
    assert.ok(f.aside() === sidebar && f.composer() === composer && f.search() === search);
    assert.equal(f.host.sidebarMounts, 1); assert.equal(f.host.composerMounts, 1);
  } finally { await f.close(); }
});

test("the actual SessionItem body portal consumes one Escape and preserves the underlying list", async () => {
  const f = await mount({ actualMenu: true });
  try {
    const sidebar = f.aside(), composer = f.composer(); await f.type("[UI TEST] 菜单层级草稿");
    await f.click("显示对话与文件"); await f.click("sidebar.moreActions");
    const menu = f.document.querySelector('[role="menu"]'), opener = f.button("sidebar.moreActions");
    assert.ok(menu && !sidebar.contains(menu));
    assert.equal(opener.getAttribute("aria-controls"), menu.id);
    assert.equal((await f.key("Escape")).defaultPrevented, true);
    assert.equal(f.document.querySelector('[role="menu"]'), null);
    assert.equal(sidebar.hidden, false); assert.equal(f.main().hasAttribute("inert"), true);
    assert.ok(f.document.activeElement === opener);
    await f.key("Escape");
    assert.equal(sidebar.hidden, true); assert.ok(f.document.activeElement === f.trigger());
    assert.ok(f.aside() === sidebar && f.composer() === composer);
    assert.equal(composer.value, "[UI TEST] 菜单层级草稿");
    assert.equal(f.host.sidebarMounts, 1); assert.equal(f.host.composerMounts, 1);
  } finally { await f.close(); }
});

test("the actual SessionItem portal joins the list Tab cycle without losing its interior focus", async () => {
  const f = await mount({ actualMenu: true });
  try {
    await f.click("显示对话与文件"); await f.click("sidebar.moreActions");
    const [first, last] = f.document.querySelectorAll('[role="menuitem"]');
    const opener = f.button("sidebar.moreActions"), close = f.button("收起对话与文件");
    await f.run(() => first.focus());
    assert.equal((await f.key("Tab")).defaultPrevented, false);
    assert.ok(f.document.activeElement === first, "the browser owns interior Tab movement");
    await f.run(() => last.focus());
    assert.equal((await f.key("Tab")).defaultPrevented, true); assert.ok(f.document.activeElement === close);
    assert.equal((await f.key("Tab", { shiftKey: true })).defaultPrevented, true); assert.ok(f.document.activeElement === last);
    await f.run(() => first.focus());
    assert.equal((await f.key("Tab", { shiftKey: true })).defaultPrevented, true); assert.ok(f.document.activeElement === opener);
    assert.equal((await f.key("Tab")).defaultPrevented, true); assert.ok(f.document.activeElement === first);
  } finally { await f.close(); }
});

test("unowned, externally owned, closed and nonmatching portals cannot bypass the list trap", async () => {
  for (const ownership of ["unowned", "external", "closed", "nonmatching"]) {
    const f = await mount();
    try {
      await f.click("显示对话与文件");
      const popup = f.document.createElement("div"), item = f.document.createElement("button"), owner = f.document.createElement("button");
      popup.id = "synthetic-unowned-popup"; popup.className = ownership === "nonmatching" ? "other-menu" : "session-item-menu";
      popup.setAttribute("role", "menu"); popup.append(item); f.document.body.append(popup);
      owner.setAttribute("aria-controls", popup.id); owner.setAttribute("aria-expanded", String(ownership !== "closed"));
      if (ownership === "external") f.document.body.append(owner);
      if (ownership === "closed" || ownership === "nonmatching") f.aside().append(owner);
      await f.run(() => item.focus());
      assert.equal((await f.key("Tab")).defaultPrevented, true, ownership);
      assert.ok(f.document.activeElement === f.button("收起对话与文件"), ownership);
      await f.key("Escape"); assert.equal(f.aside().hidden, true, ownership);
    } finally { await f.close(); }
  }
});

test("a real resource modal remains above an open SessionItem portal and keeps ordinary modal handling", async () => {
  const f = await mount({ actualMenu: true });
  try {
    await f.click("显示对话与文件"); await f.click("sidebar.moreActions");
    await f.run(() => f.host.openResource());
    const close = f.button("关闭合成资源"), menuItem = f.document.querySelector('[role="menuitem"]');
    assert.ok(f.document.activeElement === close);
    await f.run(() => menuItem.focus());
    assert.equal((await f.key("Tab")).defaultPrevented, true); assert.ok(f.document.activeElement === close);
    await f.key("Escape");
    assert.equal(f.document.querySelector('[aria-label="合成资源"]'), null);
    assert.ok(f.document.querySelector('[role="menu"]'), "closing the upper modal leaves the menu layer intact");
    assert.equal(f.aside().hidden, false);
    await f.key("Escape"); assert.equal(f.document.querySelector('[role="menu"]'), null); assert.equal(f.aside().hidden, false);
  } finally { await f.close(); }
});

for (const [label, next, back] of [
  ["view", { active: false }, { active: true }],
  ["workspace", { scope: "synthetic-root-b" }, { scope: "synthetic-root-a" }],
  ["admin", { scope: "synthetic-root-a/admin-suspended" }, { scope: "synthetic-root-a" }],
]) test(`a ${label} lifetime change removes the actual menu in the first layout commit and never revives it`, async () => {
  for (const narrow of [true, false]) {
    const f = await mount({ actualMenu: true, narrow });
    try {
      const sidebar = f.aside(), composer = f.composer(), row = f.document.querySelector(".session-item");
      await f.type(`[UI TEST] ${label} 草稿`);
      if (narrow) await f.click("显示对话与文件");
      await f.click("sidebar.moreActions");
      const menuId = f.document.querySelector('[role="menu"]').id, before = f.host.visibilityCommits.length;
      await f.render(next);
      assert.ok(f.host.visibilityCommits.slice(before).every(commit => !commit.menuInteractive), "no completed new layout commit exposes the old portal");
      assert.equal(f.document.querySelector('[role="menu"]'), null);
      await f.render(back);
      assert.equal(f.document.querySelector('[role="menu"]'), null, "returning to the owner does not revive the previous menu");
      if (f.aside().hidden) await f.click("显示对话与文件");
      assert.equal(f.document.querySelector('[role="menu"]'), null);
      await f.click("sidebar.moreActions");
      assert.equal(f.document.querySelector('[role="menu"]').id, menuId, "the same SessionItem instance owns the fresh menu");
      assert.ok(f.aside() === sidebar && f.composer() === composer && f.document.querySelector(".session-item") === row);
      assert.equal(composer.value, `[UI TEST] ${label} 草稿`);
      assert.equal(f.host.sidebarMounts, 1); assert.equal(f.host.composerMounts, 1);
    } finally { await f.close(); }
  }
});

test("same-workspace width transitions clear the actual body menu while retaining list and composer instances", async () => {
  const f = await mount({ actualMenu: true });
  try {
    const sidebar = f.aside(), composer = f.composer(), row = f.document.querySelector(".session-item");
    await f.type("[UI TEST] 宽窄菜单草稿");
    await f.click("显示对话与文件"); await f.click("sidebar.moreActions");
    const menuId = f.document.querySelector('[role="menu"]').id;
    await f.render({ narrow: false }); assert.equal(sidebar.hidden, false); assert.equal(f.document.querySelector('[role="menu"]'), null);
    await f.click("sidebar.moreActions");
    const before = f.host.visibilityCommits.length;
    await f.render({ narrow: true });
    assert.ok(f.host.visibilityCommits.slice(before).every(commit => !commit.menuInteractive));
    assert.equal(f.document.querySelector('[role="menu"]'), null);
    await f.click("sidebar.moreActions"); assert.equal(f.document.querySelector('[role="menu"]').id, menuId);
    assert.ok(f.aside() === sidebar && f.composer() === composer && f.document.querySelector(".session-item") === row);
    assert.equal(composer.value, "[UI TEST] 宽窄菜单草稿");
    assert.equal(f.host.sidebarMounts, 1); assert.equal(f.host.composerMounts, 1);
  } finally { await f.close(); }
});

test("explicit header resource actions invalidate the actual menu before opening the resource modal", async () => {
  for (const narrow of [true, false]) {
    const f = await mount({ actualMenu: true, headerResource: true, narrow });
    try {
      const sidebar = f.aside(), composer = f.composer();
      if (narrow) await f.click("显示对话与文件");
      await f.click("sidebar.moreActions"); assert.ok(f.document.querySelector('[role="menu"]'));
      await f.click("打开合成资源");
      assert.equal(f.document.querySelector('[role="menu"]'), null);
      assert.ok(f.document.activeElement === f.button("关闭合成资源"));
      await f.key("Escape");
      assert.equal(f.document.querySelector('[aria-label="合成资源"]'), null);
      assert.equal(f.document.querySelector('[role="menu"]'), null);
      assert.ok(f.document.activeElement === (narrow ? f.trigger() : f.button("打开合成资源")));
      assert.ok(f.aside() === sidebar && f.composer() === composer);
      assert.equal(f.host.sidebarMounts, 1); assert.equal(f.host.composerMounts, 1);
    } finally { await f.close(); }
  }
});

test("close and backdrop actions clear actual owned portals without requiring mousedown", async () => {
  for (const action of ["收起对话与文件", "关闭对话与文件"]) {
    const f = await mount({ actualMenu: true });
    try {
      await f.click("显示对话与文件"); await f.click("sidebar.moreActions");
      await f.click(action);
      assert.equal(f.document.querySelector('[role="menu"]'), null); assert.equal(f.aside().hidden, true);
      assert.ok(f.document.activeElement === f.trigger());
      await f.click("显示对话与文件"); assert.equal(f.document.querySelector('[role="menu"]'), null);
    } finally { await f.close(); }
  }
});

test("the topmost resource owns Escape directly from the actual lower menu portal in wide and narrow layouts", async () => {
  for (const narrow of [true, false]) {
    const f = await mount({ actualMenu: true, narrow });
    try {
      if (narrow) await f.click("显示对话与文件");
      await f.click("sidebar.moreActions");
      await f.run(() => f.host.openResource());
      const menu = f.document.querySelector('[role="menu"]');
      await f.run(() => menu.querySelector('[role="menuitem"]').focus());
      await f.key("Escape");
      assert.equal(f.document.querySelector('[aria-label="合成资源"]'), null);
      assert.ok(f.document.querySelector('[role="menu"]') === menu, "the lower menu is not dismissed by the upper modal's key");
      assert.equal(f.aside().hidden, false);
      await f.key("Escape"); assert.equal(f.document.querySelector('[role="menu"]'), null);
      assert.equal(f.aside().hidden, false);
    } finally { await f.close(); }
  }
});

test("leaving and returning to chat hides the temporary panel without remounting either child", async () => {
  const f = await mount();
  try {
    const composer = f.composer(), sidebar = f.aside(); await f.type("[UI TEST] 模块切换");
    await f.click("显示对话与文件");
    const outside = f.document.querySelector("[data-outside]"); outside.focus();
    await f.render({ active: false });
    assert.equal(sidebar.hidden, true); assert.equal(f.main().hasAttribute("inert"), false); assert.ok(document.activeElement === outside);
    await f.render({ active: true });
    assert.equal(sidebar.hidden, true); assert.ok(f.composer() === composer && f.aside() === sidebar);
    assert.equal(composer.value, "[UI TEST] 模块切换"); assert.equal(f.host.sidebarMounts, 1); assert.equal(f.host.composerMounts, 1);
  } finally { await f.close(); }
});

test("a queued selection focus cannot move focus after a different workspace or an external control", async () => {
  for (const change of ["root", "focus"]) {
    const f = await mount();
    try {
      await f.click("显示对话与文件"); await f.click("选择合成会话");
      const outside = f.document.querySelector("[data-outside]");
      if (change === "root") await f.render({ scope: "synthetic-root-b" });
      else { outside.focus(); f.document.body.focus(); }
      await f.flushFrames();
      assert.equal(f.host.chatFocus, 0);
    } finally { await f.close(); }
  }
});

test("resource modal receives focus and returns to the list trigger when it closes", async () => {
  const f = await mount();
  try {
    await f.click("显示对话与文件"); await f.click("打开合成资源");
    assert.equal(f.aside().hidden, true);
    assert.ok(document.activeElement === f.button("关闭合成资源"));
    await f.click("关闭合成资源");
    assert.ok(document.activeElement === f.trigger());
    assert.equal(f.host.chatFocus, 0);
  } finally { await f.close(); }
});

test("a pre-existing main inert state remains intact when the temporary list closes", async () => {
  const f = await mount({ externalInert: true });
  try { await f.click("显示对话与文件"); await f.key("Escape"); assert.equal(f.main().hasAttribute("inert"), true); }
  finally { await f.close(); }
});

test("actual AppShell ownership conditions hand startup restore to one persistent teacher list", async () => {
  const f = await mount({ startup: true, ready: false, active: false });
  try {
    assert.deepEqual(f.host.sidebarPresentations, ["default"]);
    assert.equal(f.document.querySelectorAll("[data-sidebar-instance]").length, 1);
    await f.render({ ready: true });
    const sidebar = f.aside(), search = f.search(), composer = f.composer();
    assert.deepEqual(f.host.sidebarPresentations, ["default", "embedded-chat"]);
    await f.render({ active: true }); await f.type("[UI TEST] 启动恢复后草稿");
    await f.click("显示对话与文件"); await f.key("Escape");
    await f.render({ active: false }); await f.render({ active: true, narrow: false }); await f.render({ narrow: true });
    assert.ok(f.aside() === sidebar && f.search() === search && f.composer() === composer);
    assert.equal(composer.value, "[UI TEST] 启动恢复后草稿");
    assert.equal(f.host.sidebarMounts, 2); assert.equal(f.host.composerMounts, 1);
    assert.ok(f.host.sidebarCommitCounts.every(count => count === 1));
  } finally { await f.close(); }
});

test("backdrop cancellation returns focus without exposing hidden list controls", async () => {
  const f = await mount();
  try { await f.click("显示对话与文件"); await f.click("关闭对话与文件"); assert.equal(f.aside().hidden, true); assert.ok(document.activeElement === f.trigger()); }
  finally { await f.close(); }
});

test("teacher caller keeps one stable frame and the narrow CSS removes the old stacked track", () => {
  const panel = fs.readFileSync(new URL("./EduPiEducationPanel.tsx", import.meta.url), "utf8");
  const shell = fs.readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../app/edupi-workbench.css", import.meta.url), "utf8");
  assert.equal((panel.match(/<EduPiChatSidebarFrame /g) || []).length, 1);
  assert.match(shell, /\{edupiEducationModule && initialSessionRestored \? null : sidebarContent\}/);
  assert.doesNotMatch(css, /\.edupi-teacher-body\.is-chat\s*\{[^}]*grid-template-rows:\s*210px/);
  assert.match(css, /\.edupi-chat-session-sidebar\[hidden\][\s\S]*?display:\s*none !important/);
});
