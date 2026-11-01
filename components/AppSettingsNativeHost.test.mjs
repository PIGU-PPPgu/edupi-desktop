import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import ts from "typescript";

const require = createRequire(import.meta.url);
const sourceFiles = ["components/AppSettings.tsx", "components/EduPiAdminPanel.tsx", "lib/app-updates.ts",
  "lib/computer-use-permissions.ts", "lib/i18n/messages/zh-CN.ts", "hooks/useDesktopHostIdentity.ts", "lib/edupi-settings-navigation.ts"];
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
  let cardHidden = false;
  let getStatus = () => options.statusError ? Promise.reject(new Error("synthetic IPC failure")) : Promise.resolve(status);
  let requestPermission = () => Promise.resolve(status);
  let mutateControl = enabled => Promise.resolve({ ...status, enabled });
  const calls = { reads: 0, requests: [], enable: [], restart: 0, preferences: [], announcements: [], connectionDetails: 0, upgrades: 0 };
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
    "@/lib/desktop-updater": { isTauriDesktop: () => options.desktop !== false,
      installLatestDesktopRelease: async onProgress => {
        calls.upgrades++;
        onProgress({ phase: "downloading", downloadedBytes: 1, totalBytes: 2 });
        return { installed: true };
      } },
    "@/lib/desktop-computer-use": {
      getComputerUseStatusNative: () => { calls.reads++; return getStatus(); },
      requestComputerUsePermissionNative: permission => { calls.requests.push(permission); return requestPermission(permission); },
      setComputerUseEnabledNative: enabled => { calls.enable.push(enabled); return mutateControl(enabled); },
      emergencyStopComputerUseNative: () => { calls.enable.push(false); return mutateControl(false); },
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
    "./EduPiComputerUseStop": { COMPUTER_USE_CHANGED_EVENT: "synthetic-control-changed", announceComputerUseChanged(enabled) {
      calls.announcements.push(enabled);
      window.dispatchEvent(new CustomEvent("synthetic-control-changed", { detail: enabled }));
    } },
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
    const fetch = async url => {
      if (url.startsWith("/api/updates") && options.updateError) throw new Error("synthetic release API failure");
      return { ok: true, json: async () => url.startsWith("/api/updates")
      ? { components: [{ project: "edupi-desktop", currentVersion: "0.3.78", latestVersion: "0.3.78", updateAvailable: false,
        releaseStatus: "available", releaseUrl: "https://example.invalid/releases", ...options.releaseInfo }] }
      : {} };
    };
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
  const mount = async (surface = "settings", settingsProps = {}) => {
    await unmount();
    const props = surface === "settings" ? { onClose() {}, ...settingsProps, onOpenConnectionDetails() { calls.connectionDetails++; } } : { initialSection: "system", onClose() {}, onOpenContext() {},
      onAskStudentUpdate() {}, onNavigate() {}, modelSettingsDirty: false, modelsPanel: () => null, settingsPanel: () => null };
    await act(async () => { renderer = TestRenderer.create(React.createElement(surface === "settings" ? AppSettings : EduPiAdminPanel, props),
      { createNodeMock: element => ({ ownerDocument: globalThis.document, focus() {}, scrollTo() {}, isConnected: true,
        closest: selector => selector === "[hidden]" && element.props["data-setting-id"] === "computer-use" && cardHidden ? {} : null,
        contains: () => true }) }); });
  };
  const button = label => renderer.root.findAllByType("button").find(node => text(node) === label || node.props["aria-label"] === label);
  const click = async label => { const node = button(label); assert.ok(node, `button ${label}`); assert.notEqual(node.props.disabled, true); await act(async () => node.props.onClick({ currentTarget: node.instance })); };
  return {
    calls, errors, preferences, window, mount, unmount, click, button,
    setStatus(next) { status = next; }, setStatusReader(next) { getStatus = next; }, setRequest(next) { requestPermission = next; },
    setCardHidden(next) { cardHidden = next; },
    setControlMutation(next) { mutateControl = next; },
    versionChip: () => renderer.root.findByProps({ "data-setting-id": "updates" }).findByType("a"),
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
    assert.match(text(ui.versionChip()), /最新正式版v0\.3\.78/);
    assert.ok(ui.button("更新"), "the host version must also control update availability");
    assert.deepEqual(ui.calls.requests, []); assert.deepEqual(ui.calls.enable, []);
    await ui.mount("admin");
    assert.equal(text(ui.desktopRow()), "EduPi Desktop当前运行版本v0.3.77");
  } finally { await ui.cleanup(); }
});

test("a native preview above stable identifies the stable channel without claiming it is latest", async () => {
  const ui = await fixture({ status: nativeStatus(701, { host: { ...nativeStatus().host, appVersion: "0.3.96" } }),
    releaseInfo: { latestVersion: "0.3.70" } });
  try {
    await ui.mount();
    assert.match(text(ui.versionChip()), /当前版本v0\.3\.96.*最新正式版v0\.3\.70/);
    assert.match(ui.content(), /当前版本高于最新正式版。/);
    assert.doesNotMatch(ui.content(), /当前已是最新/);
    assert.equal(ui.button("更新"), undefined, "a preview must never downgrade to stable");
  } finally { await ui.cleanup(); }
});

test("a native version equal to stable is reported as the latest stable release", async () => {
  const ui = await fixture({ status: nativeStatus(701, { host: { ...nativeStatus().host, appVersion: "0.3.78" } }) });
  try {
    await ui.mount();
    assert.match(ui.content(), /当前已是最新正式版。/);
    assert.doesNotMatch(ui.content(), /当前版本高于/);
    assert.equal(ui.button("更新"), undefined);
  } finally { await ui.cleanup(); }
});

for (const releaseStatus of ["unknown", "unpublished"]) test(`release state ${releaseStatus} never reports up to date`, async () => {
  const ui = await fixture({ releaseInfo: { releaseStatus, latestVersion: null, releaseUrl: null } });
  try {
    await ui.mount();
    assert.match(ui.content(), releaseStatus === "unknown" ? /无法获取发布信息。/ : /暂无正式版/);
    assert.doesNotMatch(ui.content(), /当前已是最新/);
    assert.equal(ui.button("更新"), undefined);
  } finally { await ui.cleanup(); }
});

test("a failed release check never reports up to date", async () => {
  const ui = await fixture({ updateError: true });
  try {
    await ui.mount();
    assert.match(ui.content(), /无法检查 GitHub 发布。/);
    assert.doesNotMatch(ui.content(), /当前已是最新/);
    assert.equal(ui.button("更新"), undefined);
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

test("connection details invokes the desktop callback in standalone and embedded settings and stays blocked during an upgrade", async () => {
  for (const embedded of [false, true]) {
    const ui = await fixture();
    try {
      await ui.mount("settings", { embedded, page: "about" });
      await ui.click("连接详情"); assert.equal(ui.calls.connectionDetails, 1);
      await ui.click("更新"); await ui.click("继续更新");
      assert.equal(ui.calls.upgrades, 1);
      assert.equal(ui.button("连接详情").props.disabled, true);
      await act(async () => ui.button("连接详情").props.onClick());
      assert.equal(ui.calls.connectionDetails, 1, "an in-progress upgrade also blocks a direct invocation of the navigation handler");
      assert.deepEqual(ui.calls.requests, []); assert.deepEqual(ui.calls.enable, []);
    } finally { await ui.cleanup(); }
  }
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
    assert.doesNotMatch(ui.versionChip().props["aria-label"], /当前已是最新/);
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

test("a hidden devices page cannot advance an accessibility request from a focus status read", async () => {
  const ui = await fixture({ status: nativeStatus(701, { accessibility: false }) });
  try {
    await ui.mount(); await ui.click("申请权限");
    ui.setCardHidden(true); ui.setStatus(nativeStatus());
    const reads = ui.calls.reads;
    await act(async () => ui.window.dispatchEvent(new Event("focus")));
    assert.equal(ui.calls.reads, reads + 1, "the hidden page may refresh status without requesting another permission");
    assert.deepEqual(ui.calls.requests, ["accessibility"]);
    ui.setCardHidden(false); await ui.click("申请权限");
    assert.deepEqual(ui.calls.requests, ["accessibility", "screen_recording"]);
    assert.ok(ui.button("授权后重启")); assert.deepEqual(ui.calls.enable, []); assert.deepEqual(ui.calls.preferences, []);
  } finally { await ui.cleanup(); }
});

test("hiding devices while accessibility is pending prevents an automatic screen request from its late receipt", async () => {
  const ui = await fixture({ status: nativeStatus(701, { accessibility: false }) });
  const accessibility = deferred(); ui.setRequest(() => accessibility.promise);
  try {
    await ui.mount(); await ui.click("申请权限"); ui.setCardHidden(true);
    await act(async () => accessibility.resolve(nativeStatus()));
    assert.deepEqual(ui.calls.requests, ["accessibility"]); assert.ok(ui.button("申请权限"));
    ui.setCardHidden(false); ui.setRequest(() => Promise.resolve(nativeStatus())); await ui.click("申请权限");
    assert.deepEqual(ui.calls.requests, ["accessibility", "screen_recording"]);
    assert.ok(ui.button("授权后重启")); assert.deepEqual(ui.calls.enable, []); assert.deepEqual(ui.calls.preferences, []);
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

for (const recovery of ["refresh", "reopen"]) test(`review followup: a rejected screen request can retry after ${recovery}`, async () => {
  const ui = await fixture();
  try {
    await ui.mount(); ui.setRequest(() => Promise.reject(new Error("synthetic permission IPC rejection")));
    await ui.click("申请权限");
    assert.match(ui.content(), /synthetic permission IPC rejection/);
    if (recovery === "refresh") await ui.click("检测权限"); else await ui.mount();
    assert.ok(ui.button("申请权限"), "rejected IPC must not be restored as a completed permission request");
    assert.equal(ui.button("授权后重启"), undefined);
    ui.setRequest(() => Promise.resolve(nativeStatus())); await ui.click("申请权限");
    assert.deepEqual(ui.calls.requests, ["screen_recording", "screen_recording"]);
    assert.ok(ui.button("授权后重启")); assert.deepEqual(ui.calls.enable, []);
  } finally { await ui.cleanup(); }
});

test("review followup: a late rejection cannot clear a newer host's screen request", async () => {
  const ui = await fixture(); const oldRequest = deferred();
  try {
    await ui.mount(); ui.setRequest(() => oldRequest.promise); await ui.click("申请权限");
    ui.setStatus(nativeStatus(702)); await ui.mount();
    ui.setRequest(() => Promise.resolve(nativeStatus(702))); await ui.click("申请权限");
    await act(async () => oldRequest.reject(new Error("old PID rejected")));
    await ui.click("重新检测权限"); await ui.mount();
    assert.ok(ui.button("授权后重启")); assert.match(ui.content(), /待系统确认或重启/);
    assert.deepEqual(ui.calls.requests, ["screen_recording", "screen_recording"]);
    assert.deepEqual(ui.calls.enable, []);
  } finally { await ui.cleanup(); }
});

for (const surface of ["settings", "admin"]) test(`review followup: ${surface} manual refresh retries failed native identity without remounting`, async () => {
  const ui = await fixture({ statusError: true });
  try {
    await ui.mount(surface);
    assert.match(surface === "settings" ? text(ui.versionChip()) : text(ui.desktopRow()), /无法检测/);
    const reads = ui.calls.reads;
    ui.setStatusReader(() => Promise.resolve(nativeStatus()));
    await ui.click(surface === "settings" ? "检查更新" : "刷新状态");
    assert.equal(ui.calls.reads, reads + 1, "manual refresh must make a new read-only native identity request");
    assert.match(surface === "settings" ? text(ui.versionChip()) : text(ui.desktopRow()), /v0\.3\.77/);
    assert.deepEqual(ui.calls.requests, []); assert.deepEqual(ui.calls.enable, []);
  } finally { await ui.cleanup(); }
});

for (const surface of ["settings", "admin"]) test(`review followup: ${surface} ignores a late identity retry after a newer retry or unmount`, async () => {
  const ui = await fixture({ statusError: true }); const older = deferred(), unmounted = deferred();
  const refresh = surface === "settings" ? "检查更新" : "刷新状态";
  const label = () => surface === "settings" ? text(ui.versionChip()) : text(ui.desktopRow());
  try {
    await ui.mount(surface); ui.setStatusReader(() => older.promise); await ui.click(refresh);
    ui.setStatusReader(() => Promise.resolve(nativeStatus())); await ui.click(refresh);
    await act(async () => older.resolve(nativeStatus(701, { host: { ...nativeStatus().host, appVersion: "0.3.76" } })));
    assert.match(label(), /v0\.3\.77/); assert.doesNotMatch(label(), /v0\.3\.76/);
    ui.setStatusReader(() => unmounted.promise); await ui.click(refresh); await ui.unmount();
    ui.setStatusReader(() => Promise.resolve(nativeStatus(702))); await ui.mount(surface);
    await act(async () => unmounted.reject(new Error("old retry rejected")));
    assert.match(label(), /v0\.3\.77/); assert.deepEqual(ui.calls.requests, []); assert.deepEqual(ui.calls.enable, []);
  } finally { await ui.cleanup(); }
});

test("review followup: web manual update and admin refresh never call native identity", async () => {
  const ui = await fixture({ desktop: false });
  try {
    await ui.mount(); await ui.click("检查更新");
    await ui.mount("admin"); await ui.click("刷新状态");
    assert.equal(ui.calls.reads, 0); assert.deepEqual(ui.calls.requests, []); assert.deepEqual(ui.calls.enable, []);
  } finally { await ui.cleanup(); }
});

for (const enabled of [false, true]) test(`review followup: control ${enabled} persists its native receipt after an earlier focus read settles`, async () => {
  const ui = await fixture({ enabledPreference: !enabled,
    status: nativeStatus(701, { enabled: !enabled, screenRecording: true }) });
  const mutation = deferred(), focusRead = deferred(); ui.setControlMutation(() => mutation.promise);
  try {
    await ui.mount(); ui.setStatusReader(() => focusRead.promise);
    const reads = ui.calls.reads;
    await act(async () => ui.window.dispatchEvent(new Event("focus")));
    assert.equal(ui.calls.reads, reads + 1, "the overlapping background read must actually start");
    await ui.click(enabled ? "开启控制" : "停止控制");
    await act(async () => focusRead.resolve(nativeStatus(701, { enabled: !enabled, screenRecording: true })));
    assert.equal(ui.button(enabled ? "开启控制" : "停止控制").props.disabled, true, "finishing a read cannot release mutation busy");
    await act(async () => mutation.resolve(nativeStatus(701, { enabled, screenRecording: true })));
    assert.equal(ui.preferences.get("computerUseEnabled"), enabled, "a newer read must not discard a definite native control result");
    assert.deepEqual(ui.calls.announcements, [enabled]); assert.deepEqual(ui.calls.enable, [enabled]);
    assert.ok(ui.button(enabled ? "停止控制" : "开启控制")); assert.deepEqual(ui.calls.requests, []);
    assert.equal(ui.button(enabled ? "停止控制" : "开启控制").props.disabled, false, "the confirmed action settles its busy state");
  } finally { await ui.cleanup(); }
});

test("review followup: a confirmed stop rejects an older focus read even when the read finishes last", async () => {
  const ui = await fixture({ enabledPreference: true, status: nativeStatus(701, { enabled: true, screenRecording: true }) });
  const mutation = deferred(), staleRead = deferred(); ui.setControlMutation(() => mutation.promise);
  try {
    await ui.mount(); ui.setStatusReader(() => staleRead.promise);
    const reads = ui.calls.reads;
    await act(async () => ui.window.dispatchEvent(new Event("focus")));
    assert.equal(ui.calls.reads, reads + 1, "the stale background read must actually start");
    await ui.click("停止控制");
    await act(async () => mutation.resolve(nativeStatus(701, { enabled: false, screenRecording: true })));
    await act(async () => staleRead.resolve(nativeStatus(701, { enabled: true, screenRecording: true })));
    assert.equal(ui.preferences.get("computerUseEnabled"), false); assert.deepEqual(ui.calls.announcements, [false]);
    assert.ok(ui.button("开启控制")); assert.deepEqual(ui.calls.requests, []);
  } finally { await ui.cleanup(); }
});

test("review followup: a late enable result cannot overwrite a newer explicit stop", async () => {
  const ui = await fixture({ status: nativeStatus(701, { screenRecording: true }) }); const enable = deferred();
  ui.setControlMutation(value => value ? enable.promise : Promise.resolve(nativeStatus(701, { screenRecording: true, enabled: false })));
  try {
    await ui.mount(); await ui.click("开启控制"); ui.setStatus(nativeStatus(701, { screenRecording: true, enabled: true }));
    await ui.mount(); await ui.click("停止控制");
    await act(async () => enable.resolve(nativeStatus(701, { screenRecording: true, enabled: true })));
    assert.equal(ui.preferences.get("computerUseEnabled"), false);
    assert.deepEqual(ui.calls.announcements, [false]); assert.deepEqual(ui.calls.enable, [true, false]);
    assert.ok(ui.button("开启控制"));
  } finally { await ui.cleanup(); }
});

test("review followup: a late enable result cannot overwrite an announced emergency stop", async () => {
  const ui = await fixture({ status: nativeStatus(701, { screenRecording: true }) }); const enable = deferred();
  ui.setControlMutation(() => enable.promise);
  try {
    await ui.mount(); await ui.click("开启控制");
    await act(async () => ui.window.dispatchEvent(new CustomEvent("synthetic-control-changed", { detail: false })));
    await act(async () => enable.resolve(nativeStatus(701, { screenRecording: true, enabled: true })));
    assert.equal(ui.preferences.get("computerUseEnabled"), false); assert.deepEqual(ui.calls.announcements, []);
    assert.ok(ui.button("开启控制"));
  } finally { await ui.cleanup(); }
});

test("review followup: a late mutation from an old PID cannot persist into a newer native host", async () => {
  const ui = await fixture({ status: nativeStatus(701, { screenRecording: true }) }); const enable = deferred();
  ui.setControlMutation(() => enable.promise);
  try {
    await ui.mount(); await ui.click("开启控制"); ui.setStatus(nativeStatus(702, { screenRecording: true })); await ui.mount();
    await act(async () => enable.resolve(nativeStatus(701, { screenRecording: true, enabled: true })));
    assert.equal(ui.preferences.get("computerUseEnabled"), false); assert.deepEqual(ui.calls.announcements, []);
    assert.ok(ui.button("开启控制"));
  } finally { await ui.cleanup(); }
});

test("review followup: a rejected request after unmount clears only its own pending ticket", async () => {
  const ui = await fixture(); const request = deferred();
  try {
    await ui.mount(); ui.setRequest(() => request.promise); await ui.click("申请权限"); await ui.unmount();
    await act(async () => request.reject(new Error("unmounted request rejected")));
    await ui.mount(); assert.ok(ui.button("申请权限")); assert.equal(ui.button("授权后重启"), undefined);
    assert.deepEqual(ui.calls.requests, ["screen_recording"]);
  } finally { await ui.cleanup(); }
});

test("review followup: an old rejected ticket cannot cancel a newer pending request in the same PID", async () => {
  const ui = await fixture(); const old = deferred();
  try {
    await ui.mount(); ui.setRequest(() => old.promise); await ui.click("申请权限");
    ui.setStatus(nativeStatus(701, { screenRecording: true })); await ui.mount();
    ui.setStatus(nativeStatus()); await ui.click("重新检测权限");
    ui.setRequest(() => Promise.resolve(nativeStatus())); await ui.click("申请权限");
    await act(async () => old.reject(new Error("superseded request rejected")));
    await ui.click("重新检测权限"); await ui.mount(); assert.ok(ui.button("授权后重启"));
    assert.deepEqual(ui.calls.requests, ["screen_recording", "screen_recording"]);
  } finally { await ui.cleanup(); }
});

test("review followup: a screen rejection after accessibility succeeds rolls back the screen ticket", async () => {
  const ui = await fixture({ status: nativeStatus(701, { accessibility: false }) });
  ui.setRequest(permission => permission === "accessibility" ? Promise.resolve(nativeStatus()) : Promise.reject(new Error("screen request rejected")));
  try {
    await ui.mount(); await ui.click("申请权限"); ui.setStatus(nativeStatus()); await ui.click("检测权限");
    assert.ok(ui.button("申请权限")); assert.equal(ui.button("授权后重启"), undefined);
    assert.deepEqual(ui.calls.requests, ["accessibility", "screen_recording"]); assert.deepEqual(ui.calls.enable, []);
  } finally { await ui.cleanup(); }
});

test("review followup: the latest same-host stop receipt persists after its settings instance unmounts", async () => {
  const ui = await fixture({ enabledPreference: true, status: nativeStatus(701, { enabled: true, screenRecording: true }) });
  const stop = deferred(); ui.setControlMutation(() => stop.promise);
  try {
    await ui.mount(); await ui.click("停止控制"); await ui.unmount();
    await act(async () => stop.resolve(nativeStatus(701, { enabled: false, screenRecording: true })));
    assert.equal(ui.preferences.get("computerUseEnabled"), false); assert.deepEqual(ui.calls.announcements, [false]);
    assert.deepEqual(ui.calls.enable, [false]); assert.deepEqual(ui.calls.requests, []);
  } finally { await ui.cleanup(); }
});

test("review followup: an older stop receipt cannot overwrite a newer explicit enable", async () => {
  const ui = await fixture({ enabledPreference: true, status: nativeStatus(701, { enabled: true, screenRecording: true }) });
  const oldStop = deferred(); ui.setControlMutation(enabled => enabled
    ? Promise.resolve(nativeStatus(701, { enabled: true, screenRecording: true })) : oldStop.promise);
  try {
    await ui.mount(); await ui.click("停止控制"); ui.setStatus(nativeStatus(701, { screenRecording: true })); await ui.mount();
    await ui.click("开启控制"); await act(async () => oldStop.resolve(nativeStatus(701, { screenRecording: true })));
    assert.equal(ui.preferences.get("computerUseEnabled"), true); assert.deepEqual(ui.calls.announcements, [true]);
    assert.deepEqual(ui.calls.enable, [false, true]); assert.ok(ui.button("停止控制"));
    assert.equal(ui.button("停止控制").props.disabled, false);
  } finally { await ui.cleanup(); }
});

test("review followup: a focus IPC failure cannot discard a same-host confirmed stop", async () => {
  const ui = await fixture({ enabledPreference: true, status: nativeStatus(701, { enabled: true, screenRecording: true }) });
  const stop = deferred(), focusRead = deferred(); ui.setControlMutation(() => stop.promise);
  try {
    await ui.mount(); ui.setStatusReader(() => focusRead.promise);
    const reads = ui.calls.reads;
    await act(async () => ui.window.dispatchEvent(new Event("focus")));
    assert.equal(ui.calls.reads, reads + 1, "the failing background read must actually start");
    await ui.click("停止控制");
    await act(async () => focusRead.reject(new Error("focus read failed")));
    assert.equal(ui.button("停止控制").props.disabled, true);
    assert.doesNotMatch(ui.content(), /focus read failed/);
    await act(async () => stop.resolve(nativeStatus(701, { enabled: false, screenRecording: true })));
    assert.equal(ui.preferences.get("computerUseEnabled"), false); assert.deepEqual(ui.calls.announcements, [false]);
    assert.equal(ui.button("开启控制").props.disabled, false);
  } finally { await ui.cleanup(); }
});

test("review followup: an unattributed late true event cannot invalidate a pending explicit stop", async () => {
  const ui = await fixture({ enabledPreference: true, status: nativeStatus(701, { enabled: true, screenRecording: true }) });
  const stop = deferred(); ui.setControlMutation(() => stop.promise);
  try {
    await ui.mount(); await ui.click("停止控制");
    await act(async () => ui.window.dispatchEvent(new CustomEvent("synthetic-control-changed", { detail: true })));
    assert.equal(ui.button("停止控制").props.disabled, true);
    await act(async () => stop.resolve(nativeStatus(701, { enabled: false, screenRecording: true })));
    assert.equal(ui.preferences.get("computerUseEnabled"), false); assert.deepEqual(ui.calls.announcements, [false]);
    assert.equal(ui.button("开启控制").props.disabled, false);
  } finally { await ui.cleanup(); }
});

test("review followup: an external stop announcement does not settle a pending permission request", async () => {
  const ui = await fixture(); const permission = deferred(); ui.setRequest(() => permission.promise);
  try {
    await ui.mount(); await ui.click("申请权限");
    await act(async () => ui.window.dispatchEvent(new CustomEvent("synthetic-control-changed", { detail: false })));
    assert.equal(ui.button("授权后重启").props.disabled, true);
    await act(async () => permission.resolve(nativeStatus()));
    assert.equal(ui.button("授权后重启").props.disabled, false);
    assert.deepEqual(ui.calls.requests, ["screen_recording"]); assert.deepEqual(ui.calls.enable, []);
  } finally { await ui.cleanup(); }
});

test("review followup: a rejection updates the same pending ticket already restored by a newer instance", async () => {
  const ui = await fixture(); const old = deferred();
  try {
    await ui.mount(); ui.setRequest(() => old.promise); await ui.click("申请权限"); await ui.mount();
    assert.ok(ui.button("授权后重启"));
    await act(async () => old.reject(new Error("restored ticket rejected")));
    assert.ok(ui.button("申请权限"), "the cancelled ticket must stop displaying restart without an extra native read");
    assert.equal(ui.button("授权后重启"), undefined);
    assert.deepEqual(ui.calls.requests, ["screen_recording"]); assert.deepEqual(ui.calls.enable, []);
  } finally { await ui.cleanup(); }
});

test("review followup: an external stop also supersedes an enable whose settings instance already unmounted", async () => {
  const ui = await fixture({ status: nativeStatus(701, { screenRecording: true }) }); const enable = deferred();
  ui.setControlMutation(() => enable.promise);
  try {
    await ui.mount(); await ui.click("开启控制"); await ui.unmount();
    await act(async () => ui.window.dispatchEvent(new CustomEvent("synthetic-control-changed", { detail: false })));
    await act(async () => enable.resolve(nativeStatus(701, { enabled: true, screenRecording: true })));
    assert.equal(ui.preferences.get("computerUseEnabled"), false); assert.deepEqual(ui.calls.announcements, []);
    assert.deepEqual(ui.calls.enable, [true]);
  } finally { await ui.cleanup(); }
});

test("review followup: admin observing a newer native PID invalidates an unmounted settings receipt", async () => {
  const ui = await fixture({ enabledPreference: true, status: nativeStatus(701, { enabled: true, screenRecording: true }) });
  const stop = deferred(); ui.setControlMutation(() => stop.promise);
  try {
    await ui.mount(); await ui.click("停止控制");
    ui.setStatus(nativeStatus(702, { screenRecording: true })); await ui.mount("admin");
    await act(async () => stop.resolve(nativeStatus(701, { enabled: false, screenRecording: true })));
    assert.equal(ui.preferences.get("computerUseEnabled"), true, "old PID cannot change another host's preference");
    assert.deepEqual(ui.calls.announcements, []); assert.deepEqual(ui.calls.enable, [false]);
  } finally { await ui.cleanup(); }
});
