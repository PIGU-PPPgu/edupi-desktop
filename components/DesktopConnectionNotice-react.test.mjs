import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test, { after } from "node:test";
import vm from "node:vm";
import React, { act } from "react";
import { create } from "react-test-renderer";
import { createJiti } from "jiti";
import ts from "typescript";

const require = createRequire(import.meta.url), jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const originalAct = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
after(() => { if (originalAct === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT; else globalThis.IS_REACT_ACT_ENVIRONMENT = originalAct; });
const filenames = { connection: "../lib/desktop-connection.ts", notice: "./DesktopConnectionNotice.tsx", settings: "./AppSettings.tsx", shell: "./AppShell.tsx", dismiss: "../hooks/useModalDismiss.ts", nativeIdentity: "../hooks/useDesktopHostIdentity.ts" };
const compiled = Object.fromEntries(await Promise.all(Object.entries(filenames).map(async ([name, file]) => [name, ts.transpileModule(await readFile(new URL(file, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText])));
const pureNames = ["desktop-connection-probe", "branding", "app-updates", "computer-use-permissions", "panel-layout", "workspace-state", "edupi-education-ui", "edupi-workbench", "edupi-composer-context"];
const pure = Object.fromEntries(await Promise.all(pureNames.map(async name => [`@/lib/${name}`, await jiti.import(`../lib/${name}.ts`)])));
const noop = () => {}, flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const identity = value => new Response(null, { status: 204, headers: { "x-pi-desktop-instance": value } });
const text = node => typeof node === "string" ? node : (node.children ?? []).map(text).join("");

async function fixture(t, { fullShell = false, enabled = true, desktop = true, ignoreAbort = false, timeOrigin = 1_699_999_999_000 } = {}) {
  const timers = new Map(), requests = [], otherRequests = [], controls = {}, loaded = {};
  let clock = 0, wall = 1_700_000_000_000, visible = "visible", nextTimer = 0, renderer, reloads = 0, relaunches = 0;
  const setTimer = (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, at: clock + delay }); return id; };
  const clearTimer = id => timers.delete(id);
  const document = Object.assign(new EventTarget(), { title: "Synthetic", head: {}, activeElement: null, documentElement: {}, getElementById: () => null });
  Object.defineProperty(document, "visibilityState", { get: () => visible });
  const window = Object.assign(new EventTarget(), { setTimeout: setTimer, clearTimeout: clearTimer, setInterval: setTimer, clearInterval: clearTimer,
    innerWidth: 1200, location: { origin: "http://127.0.0.1:1", reload() { reloads++; } } });
  const native = new Proxy({ isTauriDesktop: () => desktop, relaunchAppNative: async () => { relaunches++; },
    listenDesktopResumeNative: async () => noop, listenQuickEntryNative: async () => noop,
    getComputerUseStatusNative: async () => ({ enabled: false, accessibility: false, screenRecording: false }),
    getNotificationPermissionStatusNative: async () => ({ authorizationStatus: 0 }),
  }, { get: (target, name) => target[name] ?? (async () => null) });
  const search = new URLSearchParams();
  const preferences = { APP_PREF_KEYS: new Proxy({}, { get: (_, key) => key }), getPrefBool: (key, fallback) => key === "edupiFirstRunGuideComplete" ? true : fallback,
    getPrefJson: () => null, setPrefBool: noop, setPrefJson: noop };
  const foreground = { FOREGROUND_SETTINGS_CHANGED: "synthetic-foreground", readForegroundSettings: () => ({ graceDays: 0, pinnedTaskIds: [], dismissedStaleTaskIds: [] }),
    restoreForegroundSettings: async () => {}, writeForegroundSettings: async () => {} };
  const Empty = () => null;
  const modules = {
    "react": React, "react/jsx-runtime": require("react/jsx-runtime"),
    "next/navigation": { useRouter: () => ({ push: noop, replace: noop }), useSearchParams: () => search },
    "next/dynamic": loader => React.lazy(async () => ({ default: await loader() })),
    "@/hooks/useI18n": { useI18n: () => ({ t: key => ({ "connection.offline": "连接已断开", "connection.retry": "重新连接" })[key] ?? key,
      locale: "zh-CN", setLocale: noop, supportedLocales: [] }) },
    "@/hooks/useTheme": { useTheme: () => ({ theme: "light", isDark: false, toggleTheme: noop, setTheme: noop }) },
    "@/hooks/useIsMobile": { useIsMobile: () => false }, "@/hooks/useViewportHeight": { useViewportHeight: noop },
    "@/hooks/useResizablePanel": { useResizablePanel: () => ({ width: 240, panelRef: { current: null }, separatorProps: {}, reclampWidth: noop }) },
    "@/hooks/useKeyboardShortcuts": { useGlobalKeyboardShortcuts: noop }, "@/hooks/useEduPiCompletionMonitor": { useEduPiCompletionMonitor: noop },
    "@/hooks/useEduPiReminderNotifications": { useEduPiReminderNotifications: noop, reminderContinuationTaskId: () => null },
    "@/lib/app-prefs": preferences, "@/lib/edupi-foreground-settings": foreground,
    "@/lib/desktop-native": native, "@/lib/desktop-updater": native, "@/lib/desktop-computer-use": native,
    "@/lib/desktop-catch-up": { createDesktopCatchUpCoordinator: () => ({ trigger: noop, dispose: noop }) },
    "@/lib/edupi-education-client": { readEduPiWorkspace: async () => ({ data: { workspace: "/synthetic-workspace" } }) },
    "./desktop": { WindowControls: Empty, useDesktopChrome: () => ({ isMacOS: false, dragRegionProps: {} }) },
    "./EduPiForeground": { EduPiForegroundProvider: ({ children }) => children },
    "./UpdateReminder": { UpdateReminder: ({ onOpenSettings }) => React.createElement("button", { onClick: onOpenSettings }, "Open settings") },
    // The settings shell now hosts preference pages through this slot. The
    // actual AppSettings component still owns the diagnostic action below.
    "./EduPiAdminPanel": { EduPiAdminPanel: ({ settingsPanel }) => settingsPanel("about") },
    ...pure,
  };
  function load(name) {
    if (loaded[name]) return loaded[name];
    const exports = {}; loaded[name] = exports;
    vm.runInNewContext(compiled[name], { exports, Date: class extends Date { static now() { return wall; } },
      performance: { now: () => clock, timeOrigin }, window, document, AbortController, DOMException, URL, URLSearchParams,
      setTimeout: setTimer, clearTimeout: clearTimer, requestAnimationFrame: () => 0, cancelAnimationFrame: noop,
      MutationObserver: class { observe() {} disconnect() {} }, ResizeObserver: class { observe() {} disconnect() {} },
      console, fetch(url, options = {}) {
        if (url === "/api/desktop/identity") {
          const request = { ...deferred(), options }; requests.push(request);
          if (!ignoreAbort) options.signal.addEventListener("abort", () => request.reject(new DOMException("Aborted", "AbortError")));
          return request.promise;
        }
        otherRequests.push(String(url));
        return Promise.resolve(Response.json(url === "/api/sessions" ? [] : { components: [], trusted: true }));
      }, require(specifier) {
        if (specifier === "@/lib/desktop-connection") return { useDesktopConnection: (...args) => { const value = load("connection").useDesktopConnection(...args); controls.connection = value; return value; } };
        if (specifier === "./DesktopConnectionNotice") return load("notice");
        if (specifier === "./AppSettings") return load("settings");
        if (specifier === "@/hooks/useModalDismiss") return load("dismiss");
        if (specifier === "@/hooks/useDesktopHostIdentity") return load("nativeIdentity");
        if (Object.hasOwn(modules, specifier)) return modules[specifier];
        if (specifier.endsWith(".css")) return {};
        if (specifier.startsWith("./")) return new Proxy({}, { get: () => Empty });
        return new Proxy({}, { get: () => noop });
      },
    }, { filename: filenames[name] });
    return exports;
  }
  function Hook({ active }) { controls.connection = load("connection").useDesktopConnection(active); return null; }
  const tree = () => fullShell ? React.createElement(React.Suspense, { fallback: null }, React.createElement(load("shell").AppShell)) : React.createElement(Hook, { active: enabled });
  t.after(async () => {
    if (renderer) await act(async () => renderer.unmount());
    assert.equal(timers.size, 0, "all owned hook timers must be removed at unmount");
  });
  await act(async () => { renderer = create(tree()); await flush(); });
  return {
    requests, otherRequests, controls, get root() { return renderer.root; },
    snapshots: () => JSON.parse(JSON.stringify(controls.connection)),
    deadlines: () => [...timers.values()].map(timer => timer.at).sort((a, b) => a - b), counters: () => ({ reloads, relaunches }),
    async answer(value) { await act(async () => { requests.at(-1).resolve(value); await flush(); }); },
    async fail() { await act(async () => { requests.at(-1).reject(new Error("synthetic error /private/token must not be retained")); await flush(); }); },
    async online() { await act(async () => { window.dispatchEvent(new Event("online")); await flush(); }); },
    async visibility(value) { await act(async () => { visible = value; document.dispatchEvent(new Event("visibilitychange")); await flush(); }); },
    async active(value) { enabled = value; await act(async () => { renderer.update(tree()); await flush(); }); },
    async unmount() { await act(async () => { renderer.unmount(); await flush(); }); renderer = null; },
    async click(label) { const button = renderer.root.findAllByType("button").find(button => text(button) === label); assert.ok(button, `missing ${label} button`); await act(async () => { button.props.onClick(); await flush(); }); },
    async advance(ms) {
      const target = clock + ms;
      await act(async () => {
        for (;;) {
          const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
          if (!next || next[1].at > target) break;
          wall += next[1].at - clock; clock = next[1].at; timers.delete(next[0]); next[1].callback(); await flush();
        }
        wall += target - clock; clock = target; await flush();
      });
    },
  };
}

async function offline(f) {
  await f.answer(identity("synthetic-private-instance"));
  await f.advance(8_000); await f.visibility("hidden"); await f.advance(23); await f.answer(new Response(null, { status: 503 }));
  await f.advance(8_000); await f.advance(4_000);
  assert.equal(f.controls.connection.state, "offline");
}

test("real React hook retains the accepted two-failure incident after more than eight healthy probes", async t => {
  const f = await fixture(t); await offline(f);
  const incident = f.snapshots().failureIncident;
  assert.deepEqual(incident.map(record => [record.sequence, record.outcome, record.httpStatus, record.durationMs, record.visibility, record.settledVisibility, record.instance]),
    [[1, "ok", 204, 0, "visible", "visible", "pinned"], [2, "http", 503, 23, "visible", "hidden", "unavailable"], [3, "timeout", null, 4_000, "hidden", "hidden", "unavailable"]]);
  for (let index = 0; index < 12; index++) { await f.advance(8_000); await f.answer(identity("synthetic-private-instance")); }
  assert.equal(f.controls.connection.state, "online");
  assert.equal(f.snapshots().diagnostics.length, 8); assert.ok(f.snapshots().diagnostics.every(record => record.outcome === "ok"));
  assert.deepEqual(f.snapshots().failureIncident, incident);
  assert.ok(!JSON.stringify(incident).includes("private-instance"));
});

test("actual AppShell settings reopen the same details after recovery without probing, retrying or reloading", async t => {
  const f = await fixture(t, { fullShell: true }); await offline(f);
  await f.click("连接详情");
  const detailsType = f.root.findAll(node => typeof node.type === "function" && node.type.name === "ConnectionDetails")[0]?.type;
  assert.ok(detailsType); await f.click("关闭");
  for (let index = 0; index < 10; index++) { await f.advance(8_000); await f.answer(identity("synthetic-private-instance")); }
  assert.equal(f.root.findAllByProps({ role: "alert" }).length, 0);
  await f.click("Open settings");
  const before = { requests: f.requests.length, other: f.otherRequests.length, state: f.controls.connection.state, timers: f.deadlines(), counters: f.counters() };
  await f.click("连接详情");
  const dialogs = f.root.findAllByProps({ role: "dialog" }); assert.equal(dialogs.length, 1);
  assert.equal(dialogs[0].props["aria-labelledby"], "desktop-connection-title");
  assert.equal(f.root.findAll(node => node.type === detailsType).length, 1);
  assert.ok(text(dialogs[0]).includes("HTTP 响应 503")); assert.ok(text(dialogs[0]).includes("超时")); assert.ok(text(dialogs[0]).includes("23 ms"));
  await f.click("关闭");
  assert.deepEqual({ requests: f.requests.length, other: f.otherRequests.length, state: f.controls.connection.state, timers: f.deadlines(), counters: f.counters() }, before);
});

test("real React disabled, unmounted and fresh-document hooks do not retain another lifecycle's incident", async t => {
  const f = await fixture(t); await offline(f); await f.active(false);
  assert.deepEqual(f.snapshots().failureIncident, []); assert.deepEqual(f.snapshots().diagnostics, []);
  const requests = f.requests.length; await f.online(); await f.advance(20_000); assert.equal(f.requests.length, requests);
  await f.unmount();
  const next = await fixture(t, { timeOrigin: 1_800_000_000_000 });
  assert.deepEqual(next.snapshots().failureIncident, []); assert.deepEqual(next.snapshots().diagnostics, []);
});

test("a superseded real React probe cannot replace the latest incident or its timer", async t => {
  const f = await fixture(t, { ignoreAbort: true });
  await f.answer(new Response(null, { status: 503 })); await f.advance(8_000); await f.answer(new Response(null, { status: 503 }));
  const incident = f.snapshots().failureIncident;
  await f.online(); const stale = f.requests.at(-1); await f.online();
  await f.answer(identity("synthetic-current-instance")); const deadlines = f.deadlines().filter(value => value >= 16_000);
  await act(async () => { stale.reject(new Error("stale failure")); await flush(); });
  assert.equal(f.controls.connection.state, "online"); assert.deepEqual(f.snapshots().failureIncident, incident);
  assert.deepEqual(f.deadlines().filter(value => value >= 16_000), deadlines); assert.deepEqual(f.snapshots().diagnostics.map(record => record.sequence), [1, 2, 4]);
});

test("incident snapshots are bounded, fixed through a long outage, and replaced only by a new two-failure chain", async t => {
  const f = await fixture(t); await f.answer(identity("synthetic-private-instance"));
  for (let index = 0; index < 10; index++) { await f.advance(8_000); await f.answer(identity("synthetic-private-instance")); }
  await f.advance(8_000); await f.answer(new Response(null, { status: 503 })); await f.advance(8_000); await f.fail();
  const incident = f.snapshots().failureIncident; assert.equal(incident.length, 8);
  assert.deepEqual(incident.slice(-2).map(record => record.outcome), ["http", "network"]);
  for (let index = 0; index < 10; index++) { await f.advance(8_000); await f.fail(); }
  assert.deepEqual(f.snapshots().failureIncident, incident);
  await f.advance(8_000); await f.answer(identity("synthetic-private-instance"));
  await f.advance(8_000); await f.answer(new Response(null, { status: 503 })); await f.advance(8_000); await f.fail();
  const next = f.snapshots().failureIncident; assert.equal(next.length, 8); assert.ok(next.at(-1).sequence > incident.at(-1).sequence);
  assert.deepEqual(next.slice(-2).map(record => record.outcome), ["http", "network"]);
  const keys = ["sequence", "startedAt", "documentStartedAt", "durationMs", "visibility", "settledVisibility", "outcome", "httpStatus", "instance"].sort();
  for (const record of [...next, ...f.snapshots().diagnostics]) assert.deepEqual(Object.keys(record).sort(), keys);
  for (const forbidden of ["/private/", "token", "private-instance", "http://", "body", "headers"]) assert.ok(!JSON.stringify(next).includes(forbidden));
});

test("disabling or unmounting an in-flight real React probe cannot leak a prior document into a fresh one", async t => {
  const f = await fixture(t, { ignoreAbort: true }); await f.active(false);
  await act(async () => { f.requests[0].resolve(identity("synthetic-stale-instance")); await flush(); });
  assert.deepEqual(f.snapshots().diagnostics, []); assert.deepEqual(f.snapshots().failureIncident, []); assert.deepEqual(f.deadlines(), []);
  await f.active(true); await f.answer(new Response(null, { status: 503 })); assert.equal(f.controls.connection.state, "checking");
  await f.advance(8_000); await f.answer(new Response(null, { status: 503 })); assert.equal(f.controls.connection.state, "offline");
  await f.online(); const stale = f.requests.at(-1); await f.unmount();
  const next = await fixture(t, { timeOrigin: 1_800_000_000_000 });
  await act(async () => { stale.resolve(identity("synthetic-stale-instance")); await flush(); });
  assert.deepEqual(f.deadlines(), []); assert.deepEqual(next.snapshots().diagnostics, []); assert.deepEqual(next.snapshots().failureIncident, []);
  await next.answer(identity("synthetic-fresh-instance"));
  assert.deepEqual(next.snapshots().diagnostics.map(record => [record.sequence, record.documentStartedAt, record.instance]), [[1, 1_800_000_000_000, "pinned"]]);
});

test("the settings connection entry is desktop-only and adds no default online workspace notice", async t => {
  const f = await fixture(t, { fullShell: true, desktop: false });
  assert.equal(f.requests.length, 0); assert.equal(f.root.findAllByProps({ role: "alert" }).length, 0);
  await f.click("Open settings");
  assert.equal(f.root.findAllByType("button").some(button => text(button) === "连接详情"), false);
});
