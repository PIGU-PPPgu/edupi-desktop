import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import React, { act } from "react";
import { create } from "react-test-renderer";
import { jsx, jsxs } from "react/jsx-runtime";
import ts from "typescript";

const compile = file => ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const code = Object.fromEntries(["EduPiAdminPanel", "EduPiProactivityCanary", "EduPiBackgroundJobs", "EduPiPromptOutboxRecovery", "CoreRecallSettings"]
  .map(name => [name, compile(`./${name}.tsx`)]));
code.workspace = compile("../lib/edupi-education-client.ts");
code.navigation = compile("../lib/edupi-settings-navigation.ts");
code.parentView = compile("./EduPiParentRecipientConfirmation.tsx");
const text = node => typeof node === "string" || typeof node === "number" ? String(node) : node.children?.map(text).join("") ?? "";
const tick = () => new Promise(resolve => setImmediate(resolve));
const scope = { classId: "synthetic-class", className: "合成班", subject: "数学", ready: true };
const canary = (domain = "teaching_preparation", enabled = false) => ({
  ok: true, activation: { enabled, scope: enabled ? scope : null, updatedAt: null, configurationStatus: "ready" },
  scopes: [scope], grant: null, capabilities: null, limits: { domain, durationDays: 7, maxModelCalls: 12 },
});
const recall = (enabled = false) => ({
  version: 1, normalApproved: true, activation: { enabled, mode: enabled ? "normal" : "off", reason: "ready" },
  config: { enabled, scope: null, model: null, limit: null, used: null, remaining: null, validUntil: null, updatedAt: null },
  ...(!enabled ? { stop: { status: "stopped", grants: "none" } } : {}),
});
const row = { sessionId: "synthetic-session", clientRequestId: "synthetic-request", occurredAt: "2026-11-18T00:00:00.000Z", stage: "captured" };

// Real mounted components, isolated timers and transports. No browser, root,
// daemon, provider, installed app or filesystem persistence is used.
async function mount(t, name = "EduPiAdminPanel", extra = {}) {
  const prior = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const requests = [], intervals = new Map(), timeouts = new Map();
  let timerId = 0, hidden = false;
  const document = new EventTarget();
  Object.defineProperties(document, { hidden: { get: () => hidden }, visibilityState: { get: () => hidden ? "hidden" : "visible" } });
  class Element {
    isConnected = true; ownerDocument = document; style = {};
    focus() { document.activeElement = this; }
    contains() { return false; }
    querySelectorAll() { return []; }
    querySelector() { return null; }
    closest() { return null; }
    scrollTo() {}
    scrollIntoView() {}
  }
  document.body = new Element(); document.documentElement = new Element(); document.activeElement = document.body;
  document.contains = () => true;
  const window = Object.assign(new EventTarget(), { confirm: () => true });
  const schedule = (collection, callback, ms) => { collection.set(++timerId, { callback, ms }); return timerId; };
  const fetch = (url, init = {}) => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const item = { url, method: init.method ?? "GET", signal: init.signal,
      body: init.body ? JSON.parse(init.body) : null, resolve, reject, finished: false };
    requests.push(item);
    return promise; // Deliberately ignore abort to exercise generation fencing.
  };
  const json = async (url, init) => (await fetch(url, init)).json();
  const modules = {
    react: React, "react/jsx-runtime": { jsx, jsxs, Fragment: React.Fragment },
    "@/lib/desktop-updater": { isTauriDesktop: () => true },
    "@/lib/desktop-native": { fetchDesktopApi: fetch, openPathNative: async () => {} },
    "@/lib/edupi-proactivity-client": {
      readEduPiProactivity: (signal, domain) => json(`/canary/${domain}`, { signal }),
      updateEduPiProactivity: input => json(`/canary/${input.domain}`, { method: "POST", body: JSON.stringify(input) }),
    },
    "@/lib/edupi-recall-prompt-client": {
      readRecallSettings: signal => json("/recall", { signal }),
      updateRecallSettings: input => json("/recall", { method: "POST", body: JSON.stringify(input) }),
    },
    "@/lib/edupi-teacher-feedback": {},
    "@/lib/edupi-parent-recipient-client": {
      readParentRecipientEntries: signal => json("/recipient", { signal }),
      confirmParentRecipientEntry: (entry, commandId) => json("/recipient", {
        method: "POST", body: JSON.stringify({ clientRequestId: entry.clientRequestId, commandId }),
      }),
    },
    "@/lib/edupi-material-rows": { buildMaterialRows: () => [] },
    "@/lib/branding": { APP_VERSION_DISPLAY: "synthetic" },
    "@/hooks/useDesktopHostIdentity": { useDesktopHostIdentity: () => ({ refresh: async () => {} }) },
    "./desktop": { useDesktopChrome: () => ({ isDesktop: false }), WindowControls: () => null },
    "@/lib/desktop-window": {},
    "@/lib/edupi-schedule-display": { formatCoreSchedulerStatus: () => "" },
    "@/lib/edupi-runtime-health": { coreExecutionReadinessLabel: () => "" },
    "@/lib/edupi-runtime-client": {}, "@/lib/edupi-kernel-display": {}, "@/lib/edupi-entity-delete-client": {},
  };
  for (const component of ["EduPiSettingsIcon", "EduPiBrandMark", "EduPiCoreCompatibility", "EduPiDeletedEntities", "JevSettingsCard", "OpenConnectorAdminPanel"]) {
    modules[`./${component}`] = { [component]: () => null };
  }
  const load = key => {
    const exports = {};
    vm.runInNewContext(code[key], { exports, require: dependency => {
      assert.ok(Object.hasOwn(modules, dependency), dependency); return modules[dependency];
    }, window, document, HTMLElement: Element, AbortController, DOMException, Date, fetch, crypto: globalThis.crypto,
    Event, setInterval: (fn, ms) => schedule(intervals, fn, ms), clearInterval: id => intervals.delete(id),
    setTimeout: (fn, ms) => schedule(timeouts, fn, ms), clearTimeout: id => timeouts.delete(id),
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, MutationObserver: class { observe() {} disconnect() {} },
    });
    return exports;
  };
  window.setInterval = (fn, ms) => schedule(intervals, fn, ms);
  window.clearInterval = id => intervals.delete(id);
  const workspace = load("workspace");
  modules["@/lib/edupi-education-client"] = workspace;
  modules["@/lib/edupi-settings-navigation"] = load("navigation");
  modules["./EduPiParentRecipientConfirmation"] = load("parentView");
  const components = {};
  for (const child of ["EduPiProactivityCanary", "EduPiBackgroundJobs", "EduPiPromptOutboxRecovery", "CoreRecallSettings", "EduPiAdminPanel"]) {
    const loaded = load(child); modules[`./${child}`] = loaded; components[child] = loaded[child];
  }
  const props = {
    initialSection: "readiness", onClose() {}, onOpenContext() {}, onAskStudentUpdate() {}, onNavigate() {},
    modelsPanel: () => null, settingsPanel: () => null,
    data: { workspace: "/synthetic" }, onMaterials() {}, onModels() {},
    models: [{ provider: "synthetic", modelId: "synthetic-model" }], classes: [{ id: scope.classId, name: scope.className }], ...extra,
  };
  let renderer;
  await act(async () => { renderer = create(React.createElement(components[name], props), { createNodeMock: () => new Element() }); });
  t.after(async () => {
    await act(async () => renderer.unmount());
    assert.equal(intervals.size, 0);
    assert.equal(timeouts.size, 0);
    globalThis.IS_REACT_ACT_ENVIRONMENT = prior;
  });
  const run = async fn => act(async () => { await fn(); await tick(); });
  const f = {
    requests, intervals, components, workspace, document, props, run,
    root: () => renderer.root,
    async render(next) { Object.assign(props, next); await run(() => renderer.update(React.createElement(components[name], props))); },
    reads: url => requests.filter(item => item.method === "GET" && (!url || item.url === url)),
    pending: (url, method = "GET") => requests.find(item => !item.finished && item.url === url && item.method === method),
    async finish(item, value, error = null) {
      assert.ok(item && !item.finished, "pending transport");
      item.finished = true;
      await run(() => error ? item.reject(error) : item.resolve({ ok: true, status: 200, json: async () => value }));
    },
    async poll() { await run(() => [...intervals.values()].forEach(timer => timer.callback())); },
    async hide(value) { hidden = value; await run(() => document.dispatchEvent(new Event("visibilitychange"))); },
    async toggle(label, open) {
      const detail = renderer.root.findAllByType("details").find(node => text(node.findAllByType("summary")[0]) === label);
      assert.ok(detail, label);
      const target = { open };
      await run(() => detail.props.onToggle({ target, currentTarget: target }));
    },
    button: label => renderer.root.findAllByType("button").find(node => text(node) === label),
    async click(label) { await run(() => { const button = f.button(label); assert.ok(button && !button.props.disabled, label); return button.props.onClick(); }); },
  };
  return f;
}

test("Admin collapsed disclosures issue zero private reads; open/collapse/hidden/visible preserve mounted panels", async t => {
  const f = await mount(t);
  assert.equal(f.reads().length, 3, "only the workspace/status/platform overview");
  const canaryPanel = f.root().findAllByType(f.components.EduPiProactivityCanary)[0];
  assert.equal(f.intervals.size, 0);
  await f.toggle("课前准备试用配置", true);
  assert.equal(f.reads("/canary/teaching_preparation").length, 1);
  const old = f.pending("/canary/teaching_preparation");
  await f.toggle("课前准备试用配置", false);
  assert.equal(old.signal.aborted, true);
  assert.equal(f.intervals.size, 0);
  await f.toggle("课前准备试用配置", true);
  await f.finish(old, canary("teaching_preparation", true));
  assert.ok(!f.button("停止主动运行"), "late ignored-abort state cannot replace current read");
  await f.finish(f.pending("/canary/teaching_preparation"), canary());
  await f.toggle("文档任务", true); await f.toggle("记忆核验", true); await f.toggle("待核对消息 0", true);
  const before = f.reads().length;
  await f.hide(true);
  assert.equal(f.intervals.size, 0);
  for (const request of f.reads().filter(item => item.signal && !item.finished)) {
    // A caller releases its own lease; the shared workspace transport remains
    // available to peers. All panel-owned reads must still be cancelled.
    assert.equal(request.signal.aborted, request.url !== "/api/edupi/workspace", request.url);
  }
  await f.poll(); assert.equal(f.reads().length, before);
  await f.hide(false);
  assert.equal(f.reads("/api/edupi/jobs").length, 2);
  assert.equal(f.reads("/recall").length, 2);
  assert.equal(f.reads("/api/edupi/proactivity/prompt").length, 2);
  assert.equal(f.reads("/canary/teaching_preparation").length, 3);
  await f.render({ initialSection: "general" });
  assert.equal(f.intervals.size, 0);
  assert.equal(f.root().findAllByType(f.components.EduPiProactivityCanary)[0], canaryPanel);
});

test("Admin joins the existing workspace request without aborting a peer or caching the next read", async t => {
  const f = await mount(t);
  const peer = f.workspace.readEduPiWorkspace();
  assert.equal(f.reads("/api/edupi/workspace").length, 1);
  await f.render({ active: false });
  await f.finish(f.pending("/api/edupi/workspace"), { context: {}, data: { workspace: "/synthetic" } });
  assert.equal((await peer).data.workspace, "/synthetic");
  await f.render({ active: true });
  assert.equal(f.reads("/api/edupi/workspace").length, 2, "completed snapshots are not cached");
});

test("Canary inactive read cancellation never aborts or unlocks an in-flight save", async t => {
  const f = await mount(t, "EduPiProactivityCanary", { active: false });
  assert.equal(f.reads().length, 0);
  await f.render({ active: true }); await f.finish(f.pending("/canary/teaching_preparation"), canary());
  await f.click("启用试用");
  const post = f.pending("/canary/teaching_preparation", "POST");
  await f.render({ active: false }); await f.render({ active: true });
  assert.equal(post.signal, undefined);
  assert.equal(f.button("处理中…").props.disabled, true);
  await f.render({ active: false }); await f.finish(post, canary("teaching_preparation", true));
  assert.ok(f.button("停止主动运行"));
  assert.equal(f.reads().length, 1);
  await f.render({ active: true });
  assert.equal(f.reads().length, 2);
});

test("Outbox inactive cancellation keeps its DELETE alive and stale GETs cannot replace its outcome", async t => {
  const f = await mount(t, "EduPiPromptOutboxRecovery");
  await f.finish(f.pending("/api/edupi/proactivity/prompt"), { status: "ready", entries: [row] });
  await f.finish(f.pending("/api/edupi/proactivity/prompt/intent"), { status: "ready", entries: [] });
  await f.click("取消");
  const mutation = f.pending("/api/edupi/proactivity/prompt", "DELETE");
  await f.render({ active: false }); await f.render({ active: true });
  assert.equal(f.button("处理中…").props.disabled, true);
  const stale = f.pending("/api/edupi/proactivity/prompt");
  const staleIntents = f.pending("/api/edupi/proactivity/prompt/intent");
  await f.render({ active: false });
  assert.equal(stale.signal.aborted, true);
  await f.finish(mutation, { status: "cancelled" });
  assert.ok(text(f.root()).includes("已取消"));
  await f.finish(stale, { status: "ready", entries: [] });
  await f.finish(staleIntents, { status: "ready", entries: [] });
  assert.ok(text(f.root()).includes("已取消"));
  assert.equal(mutation.signal, undefined);
});

test("Recall settings retain the draft and submitted stop while inactive; failed stop remains uncertain", async t => {
  const f = await mount(t, "CoreRecallSettings");
  await f.finish(f.pending("/recall"), recall(true));
  const subject = f.root().findAllByType("input")[0];
  await f.run(() => subject.props.onChange({ target: { value: "合成草稿学科" } }));
  await f.click("停止");
  const mutation = f.pending("/recall", "POST");
  await f.render({ active: false }); await f.render({ active: true });
  assert.equal(f.button("停止").props.disabled, true);
  await f.render({ active: false });
  await f.finish(mutation, null, new Error("synthetic timeout after possible commit"));
  assert.ok(text(f.root()).includes("停止结果待核对"));
  assert.ok(!text(f.root()).includes("已停止"));
  assert.equal(mutation.signal, undefined);
  await f.render({ active: true }); await f.finish(f.pending("/recall"), recall());
  assert.equal(f.root().findAllByType("input")[0].props.value, "合成草稿学科");
  assert.ok(text(f.root()).includes("停止结果待核对"));
});

test("an affirmative recall stop completes while collapsed without launching a follow-up panel read", async t => {
  const f = await mount(t, "CoreRecallSettings");
  await f.finish(f.pending("/recall"), recall(true));
  await f.click("停止");
  const post = f.pending("/recall", "POST");
  await f.render({ active: false }); await f.finish(post, recall());
  assert.ok(text(f.root()).includes("已停止"));
  assert.equal(f.reads("/recall").length, 1);
  await f.render({ active: true });
  assert.equal(f.reads("/recall").length, 2);
});

test("Outbox detail is a cancellable read even though its transport uses POST", async t => {
  const f = await mount(t, "EduPiPromptOutboxRecovery");
  await f.finish(f.pending("/api/edupi/proactivity/prompt"), { status: "ready", entries: [row] });
  await f.finish(f.pending("/api/edupi/proactivity/prompt/intent"), { status: "ready", entries: [] });
  await f.click("查看原文");
  const detail = f.pending("/api/edupi/proactivity/prompt/detail", "POST");
  await f.render({ active: false });
  assert.equal(detail.signal.aborted, true);
  await f.render({ active: true }); await f.click("取消");
  assert.equal(f.button("处理中…").props.disabled, true);
  await f.finish(detail, { message: "late synthetic detail" });
  assert.ok(!text(f.root()).includes("late synthetic detail"));
  assert.equal(f.button("处理中…").props.disabled, true);
  await f.render({ active: false });
  await f.finish(f.pending("/api/edupi/proactivity/prompt", "DELETE"), { status: "cancelled" });
});

test("parent recipient reads follow Canary activity while its submitted confirmation stays mounted", async t => {
  const f = await mount(t, "EduPiProactivityCanary", { domain: "parent_communication" });
  await f.finish(f.pending("/canary/parent_communication"), canary("parent_communication", true));
  await f.finish(f.pending("/recipient"), [{
    ...row, status: "ready", candidate: {
      source_fingerprint: "synthetic-fingerprint", student: { label: "合成学生" },
      recipient: { label: "合成联系人" }, term: { label: "合成学期" },
    },
  }]);
  await f.click("确认收件人");
  const confirmation = f.pending("/recipient", "POST");
  await f.render({ active: false });
  assert.equal(f.intervals.size, 0);
  await f.finish(confirmation, {});
  assert.equal(confirmation.signal, undefined);
  assert.ok(text(f.root()).includes("收件人已确认"));
  assert.equal(f.reads("/recipient").length, 1);
  await f.render({ active: true });
  assert.equal(f.reads("/recipient").length, 2);
});
