import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import * as React from "react";
import * as runtime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const source = await readFile(new URL("./AppSettings.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const proxySource = await readFile(new URL("./UpdateProxySettingsCard.tsx", import.meta.url), "utf8");
const compiledProxy = ts.transpileModule(proxySource, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));

function loadSettings({ hooks = React, jsxRuntime = runtime, realProxy = false } = {}) {
  const calls = [];
  const record = name => async (...args) => { calls.push({ name, args }); return null; };
  const jsx = jsxRuntime.jsx;
  const modules = {
    react: hooks, "react/jsx-runtime": jsxRuntime,
    "@/lib/branding": { APP_DISTRIBUTION_NAME: "EduPi", APP_RELEASES_URL: "https://example.test/releases", APP_VERSION: "0.3.77", APP_VERSION_DISPLAY: "0.3.77" },
    "@/lib/app-updates": { compareAppVersions: () => 0, hasAppUpdateCheckError: () => false },
    "@/lib/app-prefs": { APP_PREF_KEYS: { closeQuits: "closeQuits", notifyOnComplete: "notifyOnComplete" }, getPrefBool: (_key, fallback) => fallback, setPrefBool: (key, value) => calls.push({ name: "setPrefBool", args: [key, value] }) },
    "@/lib/desktop-computer-use": {},
    "@/lib/desktop-updater": { isTauriDesktop: () => true },
    "@/lib/desktop-native": {
      setCloseQuitsNative: record("setCloseQuitsNative"), getNotificationPermissionStatusNative: record("notificationStatus"),
      getEduPiRootStatusNative: async () => ({ dataRoot: "/fixture/teacher", canChangeDataRoot: true, dataSource: "selected", coreSource: "bundled" }),
      selectDirectoryNative: record("selectDirectoryNative"), setEduPiDataRootNative: record("setEduPiDataRootNative"), relaunchAppNative: record("relaunchAppNative"),
    },
    "@/hooks/useI18n": { useI18n: () => ({ t: key => key, locale: "zh-CN", supportedLocales: [{ id: "en", label: "English" }, { id: "zh-CN", label: "简体中文" }], setLocale: record("setLocale") }) },
    "@/hooks/useTheme": { useTheme: () => ({ theme: "light", setTheme: record("setTheme") }) },
    "@/lib/desktop-notify": { testDesktopNotification: record("testNotification") },
    "@/lib/computer-use-permissions": { computerUsePrimaryAction: () => ({ kind: "detect" }), computerUsePrimaryActionLabel: () => "重新检测", computerUseHostLabel: () => "EduPi", computerUsePermissionLabel: () => "未检测" },
    "./UpdateProxySettingsCard": { UpdateProxySettingsCard: () => jsx("details", { children: jsx("summary", { children: "更新代理" }) }) },
    "./EduPiComputerUseStop": {},
    "./MobileBridgeSettingsCard": { MobileBridgeSettingsCard: () => jsx("div", { id: "mobile-bridge-settings", children: "手机继续对话" }) },
    "./EduPiUsageSettingsCard": { EduPiUsageSettingsCard: () => jsx("section", { children: "本地用量" }) },
    "@/lib/edupi-foreground-settings": { readForegroundSettings: () => ({ graceDays: 3 }) },
  };
  if (realProxy) {
    const exports = {};
    const proxyModules = { react: hooks, "react/jsx-runtime": jsxRuntime,
      "@/lib/update-proxy-native": {
        getUpdateProxyNative: async () => { calls.push({ name: "readUpdateProxy", args: [] }); return "http://127.0.0.1:7897"; },
        setUpdateProxyNative: record("saveUpdateProxy"),
      },
      "@/lib/update-proxy-url": { parseUpdateProxyInput: value => value.trim() || null },
    };
    vm.runInNewContext(compiledProxy, { exports, require(name) { assert.ok(proxyModules[name], name); return proxyModules[name]; } });
    modules["./UpdateProxySettingsCard"] = exports;
  }
  const exports = {};
  vm.runInNewContext(compiled, { exports, require(name) { assert.ok(modules[name], name); return modules[name]; }, AbortController, DOMException, Date,
    fetch: async url => { calls.push({ name: "fetch", args: [url] }); return { ok: true, json: async () => ({ components: [] }) }; },
    window: { addEventListener() {}, removeEventListener() {} },
  });
  return { AppSettings: exports.AppSettings, calls };
}

const pageItems = {
  general: ["language", "appearance", "foreground", "window-close"], profile: ["teacher-profile"],
  notifications: ["completion-notifications", "notification-permission"], devices: ["computer-use", "mobile"],
  data: ["data-root", "usage"], about: ["updates", "update-proxy"],
};

test("each embedded settings page renders only its own controls with one page title", () => {
  const { AppSettings } = loadSettings();
  for (const [page, ids] of Object.entries(pageItems)) {
    const markup = renderToStaticMarkup(React.createElement(AppSettings, { embedded: true, page, onClose() {} }));
    assert.equal((markup.match(/<h1\b/g) || []).length, 1, page);
    const actual = [...markup.matchAll(/data-setting-id="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(actual, ids, page);
    assert.doesNotMatch(markup, /role="dialog"/, page);
  }
});

test("standalone settings keep all pages while the existing mobile shortcut targets devices", () => {
  const { AppSettings } = loadSettings();
  const standalone = renderToStaticMarkup(React.createElement(AppSettings, { initialSection: "mobile", onClose() {} }));
  assert.match(standalone, /role="dialog"/);
  for (const id of Object.values(pageItems).flat()) assert.ok(standalone.includes(`data-setting-id="${id}"`), id);
  const mobile = renderToStaticMarkup(React.createElement(AppSettings, { embedded: true, initialSection: "mobile", onClose() {} }));
  assert.match(mobile, /data-page="devices"/);
  assert.match(mobile, /data-setting-id="mobile"/);
  assert.doesNotMatch(mobile, /data-setting-id="updates"/);
});

function mountPage(page) {
  const slots = [], effects = [];
  let cursor = 0;
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
    useMemo(fn) { return fn(); }, useCallback(fn) { return fn; }, useEffect(fn) { effects.push(fn); },
  };
  const jsx = (type, props) => ({ type, props: props || {} });
  const panel = loadSettings({ hooks, jsxRuntime: { jsx, jsxs: jsx } });
  const render = () => { cursor = 0; return panel.AppSettings({ embedded: true, page, onClose() {} }); };
  return { ...panel, render, effects };
}
const nodes = node => !node || typeof node !== "object" || !node.props ? [] : [node, ...[node.props.children].flat(Infinity).flatMap(nodes)];

test("general settings do not check releases or notification permission until those pages open", async () => {
  for (const [page, expected] of [["general", []], ["notifications", ["notificationStatus"]], ["about", ["fetch"]]]) {
    const panel = mountPage(page);
    panel.render();
    const cleanups = panel.effects.map(fn => fn());
    await tick();
    assert.deepEqual(panel.calls.map(call => call.name), expected, page);
    cleanups.forEach(cleanup => cleanup?.());
  }
});

test("moving window and notification switches to separate pages preserves their actual persistence handlers", async () => {
  const general = mountPage("general");
  nodes(general.render()).find(node => node.props.id === "window-close").props.onChange(true);
  await tick();
  assert.deepEqual(general.calls, [{ name: "setPrefBool", args: ["closeQuits", true] }, { name: "setCloseQuitsNative", args: [true] }]);
  const notifications = mountPage("notifications");
  nodes(notifications.render()).find(node => node.props.id === "completion-notifications").props.onChange(false);
  assert.deepEqual(notifications.calls, [{ name: "setPrefBool", args: ["notifyOnComplete", false] }]);
  assert.equal(nodes(notifications.render()).find(node => node.type === "button" && node.props.children === "测试通知跳转").props.disabled, true);
});

test("canceling the data-directory picker leaves the stored root and application untouched", async () => {
  const panel = mountPage("data");
  const renderData = () => nodes(panel.render()).find(node => node.type?.name === "EduPiDataSettingsCard").type();
  renderData();
  const cleanups = panel.effects.map(fn => fn());
  await tick();
  const choose = nodes(renderData()).find(node => node.type === "button" && node.props.children === "appSettings.dataChoose");
  assert.equal(choose.props.disabled, false);
  choose.props.onClick();
  await tick();
  assert.deepEqual(panel.calls, [{ name: "selectDirectoryNative", args: ["/fixture/teacher", "appSettings.dataSelectTitle"] }]);
  cleanups.forEach(cleanup => cleanup?.());
});

// Exercise both compiled components with state/effects owned by component
// instances. Removing a page unmounts its descendants and clears their slots;
// hiding a page retains them, as React does in the installed application.
function mountSettingsPages(initialPage) {
  const instances = new Map();
  let active, cursor, dirty = false, page = initialPage, tree;
  const pendingEffects = [];
  const sameDeps = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const hooks = {
    useState(initial) {
      const instance = active, index = cursor++;
      if (!instance.slots[index]) {
        const slot = { value: typeof initial === "function" ? initial() : initial };
        slot.set = value => { const next = typeof value === "function" ? value(slot.value) : value; if (!Object.is(next, slot.value)) { slot.value = next; dirty = true; } };
        instance.slots[index] = slot;
      }
      const slot = instance.slots[index];
      return [slot.value, slot.set];
    },
    useRef(initial) { const index = cursor++; active.slots[index] ??= { current: initial }; return active.slots[index]; },
    useMemo(fn, deps) { const index = cursor++; if (!active.slots[index] || !sameDeps(active.slots[index].deps, deps)) active.slots[index] = { value: fn(), deps }; return active.slots[index].value; },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const index = cursor++; if (!active.slots[index] || !sameDeps(active.slots[index].deps, deps)) pendingEffects.push({ instance: active, index, fn, deps }); },
  };
  const jsx = (type, props) => ({ type, props: props || {} });
  const panel = loadSettings({ hooks, jsxRuntime: { jsx, jsxs: jsx }, realProxy: true });
  const onClose = () => {};
  function resolve(node, path, seen) {
    if (Array.isArray(node)) return node.map((child, index) => resolve(child, `${path}.${index}`, seen));
    if (!node || typeof node !== "object" || !node.props) return node;
    if (typeof node.type === "function") {
      const key = `${path}:${node.type.name}`;
      let instance = instances.get(key);
      if (!instance) { instance = { slots: [] }; instances.set(key, instance); }
      seen.add(key); active = instance; cursor = 0;
      return resolve(node.type(node.props), `${path}.render`, seen);
    }
    return { ...node, props: { ...node.props, children: resolve(node.props.children, `${path}.children`, seen) } };
  }
  function render() {
    let attempts = 0;
    do {
      assert.ok(attempts++ < 20, "component lifecycle should settle");
      dirty = false;
      const seen = new Set();
      tree = resolve(jsx(panel.AppSettings, { embedded: true, page, onClose }), "root", seen);
      for (const [key, instance] of instances) {
        if (!seen.has(key)) { for (const slot of instance.slots) slot?.cleanup?.(); instances.delete(key); }
      }
      for (const { instance, index, fn, deps } of pendingEffects.splice(0)) {
        instance.slots[index]?.cleanup?.(); instance.slots[index] = { deps, cleanup: fn() };
      }
    } while (dirty);
    return tree;
  }
  return { ...panel, render, open(nextPage) { page = nextPage; return render(); },
    unmount() { for (const instance of instances.values()) for (const slot of instance.slots) slot?.cleanup?.(); instances.clear(); },
  };
}

test("an unsaved update-proxy draft survives leaving and returning to its settings page", async () => {
  const panel = mountSettingsPages("general");
  try {
    panel.render(); await tick();
    assert.equal(panel.calls.filter(call => call.name === "readUpdateProxy").length, 0, "unvisited pages stay lazy");
    panel.open("about"); await tick();
    const input = () => nodes(panel.render()).find(node => node.type === "input" && node.props.placeholder === "http://127.0.0.1:7897");
    assert.equal(input().props.value, "http://127.0.0.1:7897");
    input().props.onChange({ target: { value: "http://127.0.0.1:4321" } });
    panel.render();
    const generalTree = panel.open("general");
    assert.equal(nodes(generalTree).find(node => node.type === "section" && node.props["aria-label"] === "关于与更新").props.hidden, true);
    const aboutTree = panel.open("about"); await tick();
    assert.equal(input().props.value, "http://127.0.0.1:4321");
    assert.equal(nodes(aboutTree).filter(node => node.type === "h1").length, 1);
    assert.equal(nodes(aboutTree).find(node => node.type === "section" && node.props["aria-label"] === "关于与更新").props.hidden, false);
    assert.equal(panel.calls.filter(call => call.name === "readUpdateProxy").length, 1, "returning must not remount and overwrite the draft");
    assert.equal(panel.calls.filter(call => call.name === "saveUpdateProxy").length, 0, "navigation must not save a draft");
  } finally { panel.unmount(); }
});
