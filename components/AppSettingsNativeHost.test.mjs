import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import ts from "typescript";

const require = createRequire(import.meta.url);
const sourceFiles = ["components/AppSettings.tsx", "components/EduPiAdminPanel.tsx", "lib/app-updates.ts",
  "lib/computer-use-permissions.ts", "lib/i18n/messages/zh-CN.ts", "hooks/useDesktopHostIdentity.ts"];
const sources = new Map(await Promise.all(sourceFiles.map(async path => [path,
  await readFile(new URL(`../${path}`, import.meta.url), "utf8").catch(error => {
    if (error.code === "ENOENT" && path === "hooks/useDesktopHostIdentity.ts") return null;
    throw error;
  })])));

const nativeStatus = (processId = 701, overrides = {}) => ({
  enabled: false, accessibility: true, screenRecording: false,
  host: { appName: "EduPi", appVersion: "0.3.77", platform: "macos", processId,
    executablePath: "/Applications/EduPi.app/Contents/MacOS/pi-agent-desktop",
    bundlePath: "/Applications/EduPi.app", bundleId: "com.abcwyc.pi-agent", signingTeam: "SYNTHETIC" },
  ...overrides,
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const text = node => typeof node === "string" || typeof node === "number" ? String(node)
  : Array.isArray(node) ? node.map(text).join("") : (node?.children || []).map(text).join("");

async function fixture(options = {}) {
  let status = options.status ?? nativeStatus();
  let getStatus = () => options.statusError ? Promise.reject(new Error("synthetic IPC failure")) : Promise.resolve(status);
  let requestPermission = () => Promise.resolve(status);
  const calls = { reads: 0, requests: [], enable: [], restart: 0, preferences: [] };
  const preferences = new Map([["computerUseEnabled", options.enabledPreference ?? false]]);
  const savedGlobals = Object.fromEntries(["window", "document", "HTMLElement", "IS_REACT_ACT_ENVIRONMENT"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const window = new EventTarget();
  Object.assign(window, { setInterval, clearInterval, confirm: () => false });
  Object.assign(globalThis, { window, document: { visibilityState: "visible", activeElement: null, contains: () => false },
    HTMLElement: class {}, IS_REACT_ACT_ENVIRONMENT: true });
  const originalConsoleError = console.error;
  const errors = [];
  console.error = (...args) => {
    if (String(args[0]).includes("react-test-renderer is deprecated")) return;
    errors.push(args);
  };
  const blank = () => null;
  const stubModule = new Proxy({}, { get: () => blank });
  const branding = { APP_VERSION: "0.3.78", APP_VERSION_DISPLAY: "0.3.78", APP_DISTRIBUTION_NAME: "EduPi",
    APP_RELEASES_URL: "https://example.invalid/releases" };
  const dependencies = {
    react: React,
    "@/lib/branding": branding, "./branding": branding,
    "@/lib/desktop-updater": { isTauriDesktop: () => options.desktop !== false },
    "@/lib/desktop-computer-use": {
      getComputerUseStatusNative: () => { calls.reads++; return getStatus(); },
      requestComputerUsePermissionNative: permission => { calls.requests.push(permission); return requestPermission(permission); },
      setComputerUseEnabledNative: async enabled => { calls.enable.push(enabled); return { ...status, enabled }; },
      emergencyStopComputerUseNative: async () => { calls.enable.push(false); return { ...status, enabled: false }; },
    },
    "@/lib/desktop-native": {
      getNotificationPermissionStatusNative: async () => ({ authorizationStatus: 0 }),
      getEduPiRootStatusNative: async () => ({ dataRoot: "/synthetic", canChangeDataRoot: false }),
      relaunchAppNative: async () => { calls.restart++; },
      handleExternalLinkClick() {},
    },
    "@/lib/app-prefs": { APP_PREF_KEYS: { computerUseEnabled: "computerUseEnabled" },
      getPrefBool: (key, fallback) => preferences.get(key) ?? fallback,
      setPrefBool: (key, value) => { calls.preferences.push([key, value]); preferences.set(key, value); } },
    "@/hooks/useTheme": { useTheme: () => ({ theme: "light", setTheme() {} }) },
    "@/lib/edupi-foreground-settings": { readForegroundSettings: () => ({ graceDays: 3 }), writeForegroundSettings: async () => {} },
    "./EduPiComputerUseStop": { COMPUTER_USE_CHANGED_EVENT: "synthetic-control-changed", announceComputerUseChanged() {} },
    "./EduPiConnectorSetup": { CONNECTOR_SETUP_IDS: [], EduPiConnectorSetup: blank },
    "./desktop": { useDesktopChrome: () => ({ isDesktop: options.desktop !== false, isMacOS: options.desktop !== false, dragRegionProps: {} }), WindowControls: blank },
  };
  const moduleCache = new Map();
  const load = path => {
    if (moduleCache.has(path)) return moduleCache.get(path).exports;
    const source = sources.get(path);
    assert.equal(typeof source, "string", `actual source required: ${path}`);
    const componentModule = { exports: {} };
    moduleCache.set(path, componentModule);
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const localRequire = name => {
      if (dependencies[name]) return dependencies[name];
      const localPath = name.startsWith("@/") ? name.slice(2) : name === "./desktop-computer-use" ? "lib/desktop-computer-use" : null;
      if (localPath === "lib/desktop-computer-use") return dependencies["@/lib/desktop-computer-use"];
      if (localPath && sources.has(`${localPath}.ts`)) return load(`${localPath}.ts`);
      if (name === "./edupi-computer-use") return {};
      if (name.startsWith("@/") || name.startsWith("./")) return stubModule;
      return require(name);
    };
    const fetch = async url => ({ ok: true, json: async () => url.startsWith("/api/updates")
      ? { components: [{ project: "edupi-desktop", currentVersion: "0.3.78", latestVersion: "0.3.78", updateAvailable: false,
        releaseStatus: "available", releaseUrl: "https://example.invalid/releases" }] }
      : {} });
    new Function("require", "module", "exports", "fetch", compiled)(localRequire, componentModule, componentModule.exports, fetch);
    return componentModule.exports;
  };
  const messages = load("lib/i18n/messages/zh-CN.ts").zhCNLocale.messages;
  dependencies["@/hooks/useI18n"] = { useI18n: () => ({ locale: "zh-CN", setLocale() {}, supportedLocales: [],
    t: (key, params = {}) => Object.entries(params).reduce((value, [name, replacement]) => value.replaceAll(`{${name}}`, replacement), messages[key] || key) }) };
  const { AppSettings } = load("components/AppSettings.tsx");
  const { EduPiAdminPanel } = load("components/EduPiAdminPanel.tsx");
  let renderer;
  const unmount = async () => { if (renderer) { await act(async () => renderer.unmount()); renderer = null; } };
  const mount = async (surface = "settings") => {
    await unmount();
    const props = surface === "settings" ? { onClose() {} } : { initialSection: "system", onClose() {}, onOpenSettings() {}, onNavigate() {} };
    await act(async () => { renderer = TestRenderer.create(React.createElement(surface === "settings" ? AppSettings : EduPiAdminPanel, props),
      { createNodeMock: () => ({ focus() {}, scrollTo() {} }) }); });
  };
  const button = label => renderer.root.findAllByType("button").find(node => text(node) === label || node.props["aria-label"] === label);
  const click = async label => { const node = button(label); assert.ok(node, `button ${label}`); assert.equal(node.props.disabled, false); await act(async () => node.props.onClick()); };
  return {
    calls, errors, preferences, window, mount, unmount, click, button,
    setStatus(next) { status = next; }, setStatusReader(next) { getStatus = next; }, setRequest(next) { requestPermission = next; },
    versionChip: () => renderer.root.findByType("header").findByType("a"),
    desktopRow: () => renderer.root.findAllByType("strong").find(node => /^EduPi (Desktop|Web)$/.test(text(node))).parent.parent,
    content: () => text(renderer.root),
    async cleanup() {
      await unmount();
      console.error = originalConsoleError;
      for (const [key, descriptor] of Object.entries(savedGlobals)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
      }
      assert.deepEqual(errors, [], "actual components must not report React errors");
    },
  };
}

test("settings compares the running native .77 with .78 even when the source update API reports .78 current", async () => {
  const ui = await fixture();
  try {
    await ui.mount();
    assert.match(ui.versionChip().props["aria-label"], /当前版本: v0\.3\.77\./);
    assert.match(text(ui.versionChip()), /最新版本v0\.3\.78/);
    assert.ok(ui.button("更新"), "the host version must also control update availability");
    assert.deepEqual(ui.calls.requests, []); assert.deepEqual(ui.calls.enable, []);
    await ui.mount("admin");
    assert.equal(text(ui.desktopRow()), "EduPi Desktop当前运行版本v0.3.77");
  } finally { await ui.cleanup(); }
});

test("web settings and management identify the source version as a web version without native calls", async () => {
  const ui = await fixture({ desktop: false });
  try {
    await ui.mount();
    assert.match(text(ui.versionChip()), /网页版本v0\.3\.78/);
    await ui.mount("admin");
    assert.equal(text(ui.desktopRow()), "EduPi Web网页版本v0.3.78");
    assert.doesNotMatch(ui.content(), /当前安装版本/);
    assert.equal(ui.calls.reads, 0);
  } finally { await ui.cleanup(); }
});

test("management system row reads the native version and never calls the source build an installed version", async () => {
  const ui = await fixture();
  try {
    await ui.mount("admin");
    assert.equal(text(ui.desktopRow()), "EduPi Desktop当前运行版本v0.3.77");
    assert.deepEqual(ui.calls.requests, []); assert.deepEqual(ui.calls.enable, []);
  } finally { await ui.cleanup(); }
});

for (const kind of ["missing host", "IPC failure", "loading"]) test(`native identity ${kind} never falls back to the source version`, async () => {
  const ui = await fixture(kind === "missing host" ? { status: nativeStatus(701, { host: undefined }) }
    : kind === "IPC failure" ? { statusError: true } : {});
  const pending = deferred();
  if (kind === "loading") ui.setStatusReader(() => pending.promise);
  try {
    await ui.mount();
    assert.doesNotMatch(ui.versionChip().props["aria-label"], /当前版本: v0\.3\.78/);
    assert.match(ui.versionChip().props["aria-label"], kind === "loading" ? /检测中/ : /无法检测/);
    assert.doesNotMatch(ui.versionChip().props["aria-label"], /当前已是最新版本/);
    await ui.mount("admin");
    assert.doesNotMatch(text(ui.desktopRow()), /v0\.3\.78/);
    assert.match(text(ui.desktopRow()), kind === "loading" ? /检测中/ : /无法检测/);
    assert.deepEqual(ui.calls.requests, []); assert.deepEqual(ui.calls.enable, []);
  } finally { await ui.cleanup(); }
});

test("restoring an accessibility flow after system authorization does not request screen recording on mount or focus", async () => {
  const ui = await fixture({ status: nativeStatus(701, { accessibility: false }) });
  try {
    await ui.mount(); await ui.click("申请权限");
    ui.setStatus(nativeStatus()); await ui.mount();
    assert.ok(ui.button("申请权限"));
    await act(async () => ui.window.dispatchEvent(new Event("focus")));
    assert.deepEqual(ui.calls.requests, ["accessibility"]);
    await ui.click("申请权限");
    assert.deepEqual(ui.calls.requests, ["accessibility", "screen_recording"]);
    assert.ok(ui.button("授权后重启")); assert.deepEqual(ui.calls.enable, []);
  } finally { await ui.cleanup(); }
});

test("an accessibility flow restored while still denied cannot request screen recording on a later focus", async () => {
  const ui = await fixture({ status: nativeStatus(701, { accessibility: false }) });
  try {
    await ui.mount(); await ui.click("申请权限"); await ui.mount();
    ui.setStatus(nativeStatus());
    await act(async () => ui.window.dispatchEvent(new Event("focus")));
    assert.deepEqual(ui.calls.requests, ["accessibility"], "restored progress cannot start a new TCC request");
    assert.ok(ui.button("申请权限")); assert.deepEqual(ui.calls.enable, []);
  } finally { await ui.cleanup(); }
});

test("a stale status read from an unmounted PID cannot restore its pending flow in a newer mount", async () => {
  const ui = await fixture(); const oldStatus = deferred();
  try {
    await ui.mount(); await ui.click("申请权限");
    ui.setStatusReader(() => oldStatus.promise); await ui.click("重新检测权限");
    await ui.unmount(); ui.setStatusReader(() => Promise.resolve(nativeStatus(702))); await ui.mount();
    await act(async () => oldStatus.resolve(nativeStatus(701)));
    assert.ok(ui.button("申请权限")); assert.doesNotMatch(ui.content(), /待系统确认或重启/);
    assert.deepEqual(ui.calls.requests, ["screen_recording"]); assert.deepEqual(ui.calls.enable, []);
  } finally { await ui.cleanup(); }
});

test("closing and reopening settings keeps a requested screen permission for the same native process", async () => {
  const ui = await fixture();
  try {
    await ui.mount(); await ui.click("申请权限");
    assert.deepEqual(ui.calls.requests, ["screen_recording"]);
    assert.match(ui.content(), /待系统确认或重启/);
    await ui.mount();
    assert.match(ui.content(), /待系统确认或重启/);
    assert.ok(ui.button("授权后重启"));
    await act(async () => ui.window.dispatchEvent(new Event("focus")));
    assert.deepEqual(ui.calls.requests, ["screen_recording"], "mount and focus only recheck a previously requested screen grant");
    assert.deepEqual(ui.calls.enable, []); assert.deepEqual(ui.calls.preferences, []);
  } finally { await ui.cleanup(); }
});

for (const condition of ["new process", "permission granted", "missing host", "unknown permission"]) test(`pending screen permission is not reused after ${condition}`, async () => {
  const ui = await fixture();
  try {
    await ui.mount(); await ui.click("申请权限");
    ui.setStatus(condition === "new process" ? nativeStatus(702)
      : condition === "permission granted" ? nativeStatus(701, { screenRecording: true })
        : condition === "missing host" ? nativeStatus(701, { host: undefined }) : nativeStatus(701, { screenRecording: null }));
    await ui.mount();
    assert.doesNotMatch(ui.content(), /待系统确认或重启/);
    assert.equal(ui.button("授权后重启"), undefined);
    assert.ok(ui.button(condition === "new process" ? "申请权限" : condition === "permission granted" ? "开启控制" : "检测权限"));
    assert.deepEqual(ui.calls.requests, ["screen_recording"]); assert.deepEqual(ui.calls.enable, []);
    if (condition === "permission granted") {
      ui.setStatus(nativeStatus()); await ui.mount();
      assert.ok(ui.button("申请权限"), "a granted status removes the old pending flow");
    }
  } finally { await ui.cleanup(); }
});

test("a late permission response from an unmounted old PID cannot change the new PID or request another permission", async () => {
  const ui = await fixture({ status: nativeStatus(701, { accessibility: false }) });
  const oldRequest = deferred(); ui.setRequest(() => oldRequest.promise);
  try {
    await ui.mount(); await ui.click("申请权限");
    ui.setStatus(nativeStatus(702)); await ui.mount();
    await act(async () => oldRequest.resolve(nativeStatus(701)));
    assert.ok(ui.button("申请权限"));
    assert.doesNotMatch(ui.content(), /待系统确认或重启/);
    assert.deepEqual(ui.calls.requests, ["accessibility"]); assert.deepEqual(ui.calls.enable, []);
    await ui.mount(); assert.ok(ui.button("申请权限"));
  } finally { await ui.cleanup(); }
});

test("a same-PID permission request that settles after close remains pending on the next mount without replay", async () => {
  const ui = await fixture(); const request = deferred(); ui.setRequest(() => request.promise);
  try {
    await ui.mount(); await ui.click("申请权限"); await ui.unmount();
    await act(async () => request.resolve(nativeStatus()));
    await ui.mount();
    assert.ok(ui.button("授权后重启")); assert.match(ui.content(), /待系统确认或重启/);
    assert.deepEqual(ui.calls.requests, ["screen_recording"]); assert.deepEqual(ui.calls.enable, []);
  } finally { await ui.cleanup(); }
});

for (const enabledPreference of [false, true]) test(`permission restart preserves the explicit control preference ${enabledPreference}`, async () => {
  const ui = await fixture({ enabledPreference });
  try {
    await ui.mount(); await ui.click("申请权限"); await ui.click("授权后重启");
    assert.equal(ui.calls.restart, 1);
    assert.equal(ui.preferences.get("computerUseEnabled"), enabledPreference);
    assert.deepEqual(ui.calls.preferences, [], "permission restart must not promote or overwrite the control preference");
    assert.deepEqual(ui.calls.enable, []); assert.deepEqual(ui.calls.requests, ["screen_recording"]);
  } finally { await ui.cleanup(); }
});
