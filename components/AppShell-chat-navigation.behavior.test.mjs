import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { jsx, jsxs } from "react/jsx-runtime";
import { parseHTML } from "linkedom";
import { createJiti } from "jiti";

const shellSource = fs.readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
const sidebarSource = fs.readFileSync(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const panelSource = fs.readFileSync(new URL("./EduPiEducationPanel.tsx", import.meta.url), "utf8");
const chatSource = fs.readFileSync(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const draftSource = fs.readFileSync(new URL("../lib/draft-store.ts", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const paths = await jiti.import("./path-ui.tsx");
const workbench = await jiti.import("../lib/edupi-workbench.ts");
const composer = await jiti.import("../lib/edupi-composer-context.ts");
const navigation = await jiti.import("../lib/workspace-state.ts");
const domainNavigation = await jiti.import("../lib/edupi-domain-navigation.ts");
const calendar = await jiti.import("../lib/edupi-calendar-model.ts");
const compile = source => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const noop = () => {};
const tick = () => new Promise(resolve => setImmediate(resolve));
const original = { id: "original-teacher", cwd: "/synthetic/teacher", projectRoot: "/synthetic/teacher", name: "Original", created: "2026-10-27T00:00:00Z", modified: "2026-10-28T00:00:00Z", messageCount: 2, firstMessage: "synthetic history" };
const other = { ...original, id: "other-conversation", cwd: "/synthetic/other", projectRoot: "/synthetic/other", name: "Other", modified: "2026-10-27T00:00:00Z" };
const testCwd = "/synthetic/UI-Test-Data";

function declaration(source, component, name) {
  const file = ts.createSourceFile("component.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const body = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === component)?.body;
  assert.ok(body, component);
  const found = body.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item =>
    ts.isIdentifier(item.name) ? item.name.text === name
      : ts.isArrayBindingPattern(item.name) && item.name.elements.some(binding => binding.name?.getText(file) === name)));
  assert.ok(found, `${component}.${name}`);
  return found.getText(file);
}

function initialDirectoryEffect() {
  const file = ts.createSourceFile("AppShell.tsx", shellSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const body = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "AppShell").body;
  const effect = body.statements.find(node => ts.isExpressionStatement(node) && node.getText(file).includes("const requestedCwd = initialNavigation.requestedCwd;"));
  assert.ok(effect);
  return effect.getText(file);
}

function educationDirectoryEffect() {
  const file = ts.createSourceFile("AppShell.tsx", shellSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const body = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "AppShell").body;
  const effect = body.statements.find(node => ts.isExpressionStatement(node) && node.getText(file).includes("void readEduPiWorkspace({ signal: controller.signal })"));
  assert.ok(effect);
  return effect.getText(file);
}

function draftStore() {
  const storage = new Map(), exports = {};
  vm.runInNewContext(compile(draftSource), { exports, window: {}, setTimeout: () => 1, clearTimeout: noop,
    require: name => name.endsWith("edupi-composer-context") ? composer : {
      APP_PREF_KEYS: { chatDrafts: "drafts" },
      getPrefJson: key => storage.has(key) ? JSON.parse(storage.get(key)) : null,
      trySetPrefJson: (key, value) => { storage.set(key, JSON.stringify(value)); return true; },
    },
  });
  return exports;
}

async function mount({ initialSessionId = original.id, sessions = [original, other], requestedCwd = null, delayed = false } = {}) {
  const { window } = parseHTML("<html><body><div id='root'></div></body></html>");
  const globals = { window: globalThis.window, document: globalThis.document, HTMLElement: globalThis.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  window.getComputedStyle = () => ({});
  const requests = [], validations = [], workspaceReads = [], urls = [], restores = [], manualCwdSelections = [], storage = new Map();
  const host = { state: null, api: null, sidebarProps: null, picker: null, sidebarMounts: 0, delayed, pendingUrls: [], holdUrls: false };
  const store = draftStore();
  store.setDraft(original.id, { value: "原会话合成未发送草稿", images: [] });
  const initialNavigation = navigation.resolveInitialNavigation(new URLSearchParams(requestedCwd ? `cwd=${encodeURIComponent(requestedCwd)}` : ""),
    initialSessionId ? { sessionId: initialSessionId, cwd: original.cwd, fileTabs: [], activeFileTabId: null, rightPanelOpen: false } : null);
  const fetch = (url, options = {}) => {
    if (url === "/api/cwd/validate") {
      assert.equal(options.method, "POST");
      const request = { input: JSON.parse(options.body), signal: options.signal };
      request.promise = new Promise((resolve, reject) => { request.resolve = (value = { cwd: request.input.cwd }) => resolve({ ok: !value.error, status: value.error ? 400 : 200, json: async () => value }); request.reject = reject; });
      validations.push(request);
      return request.promise;
    }
    assert.equal(options.method || "GET", "GET", "this harness performs no writes");
    if (url === "/api/sessions") {
      const request = { done: false };
      request.promise = new Promise(resolve => { request.resolve = value => { request.done = true; resolve({ ok: true, json: async () => ({ sessions: value }) }); }; });
      requests.push(request);
      if (!host.delayed) request.resolve(sessions);
      return request.promise;
    }
    if (url === "/api/home") return Promise.resolve({ ok: true, json: async () => ({ home: "/synthetic" }) });
    if (url.startsWith("/api/worktrees?")) return Promise.resolve({ ok: true, json: async () => ({ projectRoot: new URL(url, "http://synthetic").searchParams.get("cwd"), isGit: false, isTopLevel: true, worktrees: [] }) });
    assert.fail(`Unexpected synthetic fetch: ${url}`);
  };
  const sidebarModules = {
    react: React, "react-dom": { createPortal: children => children }, "react/jsx-runtime": { jsx, jsxs, Fragment: React.Fragment },
    "@/hooks/useI18n": { useI18n: () => ({ t: key => key }) },
    "./FileExplorer": { FileExplorer: () => null },
    "./ProjectPicker": { ProjectPicker: props => { host.picker = props; return jsx("div", { "data-picker-cwd": props.selectedCwd || "" }); } },
    "./DisclosureChevron": { DisclosureChevron: () => null },
    "./path-ui": { ...paths, AnimatedDropdown: ({ open, children }) => open ? jsx("div", { children }) : null },
    "@/lib/app-prefs": { APP_PREF_KEYS: {}, getPrefJson: key => storage.get(key) ?? null, setPrefJson: (key, value) => storage.set(key, value), removePref: key => storage.delete(key) },
    "@/lib/desktop-notify": { notifyDesktop: noop }, "@/lib/desktop-updater": { isTauriDesktop: () => false },
    "@/lib/desktop-native": { revealItemInDirNative: noop }, "@/lib/desktop-window": { getDesktopPlatform: () => null },
    "@/lib/edupi-composer-context": { visibleTeacherMessageText: value => value },
  };
  const sidebarExports = {};
  class EventSource { static CLOSED = 2; close() {} }
  vm.runInNewContext(compile(sidebarSource), { exports: sidebarExports, require: name => { assert.ok(sidebarModules[name], name); return sidebarModules[name]; },
    window, document: window.document, EventSource, fetch, setTimeout, clearTimeout, crypto: globalThis.crypto,
  });
  function SessionSidebar(props) {
    host.sidebarProps = props;
    React.useEffect(() => { host.sidebarMounts++; }, []);
    return jsx(sidebarExports.SessionSidebar, { ...props, onSelectSession(session, isRestore) {
      if (isRestore) restores.push(session.id);
      props.onSelectSession(session, isRestore);
    }, onCwdSelect(cwd) { manualCwdSelections.push(cwd); props.onCwdSelect?.(cwd); } });
  }
  const stateDeclarations = ["selectedSession", "newSessionCwd", "sessionKey", "edupiEducationModule", "edupiChatActive", "initialSessionId", "activeCwd", "activeCwdRef", "activeProjectRootRef", "initialSessionRestored", "suppressCwdBumpRef", "initialCwdSupersededRef", "activeSessionIdRef", "initialCwdStatus", "initialCwdError"]
    .map(name => declaration(shellSource, "AppShell", name)).join("\n");
  const handlers = ["handleCwdSelect", "handleCwdChange", "handleSelectSession", "handleEducationSelectSession", "handleNewSession", "handleEducationNewSession", "handleInitialRestoreDone", "openEducationView"]
    .map(name => declaration(shellSource, "AppShell", name)).join("\n");
  const scope = { exports: {}, React, useState: React.useState, useRef: React.useRef, useCallback: React.useCallback, useEffect: React.useEffect,
    require: name => name === "react/jsx-runtime" ? { jsx, jsxs, Fragment: React.Fragment } : assert.fail(name),
    SessionSidebar, host, store, initialNavigation, URLSearchParams, window: { dispatchEvent: noop, alert: assert.fail }, Event: window.Event,
    moduleFromView: workbench.moduleFromView, resetNewSessionDraft: store.resetNewSessionDraft, fetch, AbortController,
    readEduPiWorkspace: ({ signal }) => { const request = { signal }; request.promise = new Promise(resolve => { request.resolve = cwd => resolve({ data: { workspace: cwd } }); }); workspaceReads.push(request); return request.promise; },
  };
  const parent = `
    function Parent() {
      const [url, setUrl] = useState("edupi=1&module=home&view=chat");
      const searchParams = new URLSearchParams(url);
      const router = { replace(next) { urls.push(next); if (host.holdUrls) host.pendingUrls.push(next); else setUrl(next.split("?")[1] || ""); } };
      ${stateDeclarations}
      activeSessionIdRef.current = selectedSession?.id ?? null;
      ${initialDirectoryEffect()}
      const isMobile = false, branchLeafChangeFnRef = useRef(null), activeFileTab = null, sidebarHeaderControls = null;
      const refreshKey = 0, explorerRefreshKey = 0;
      const setPendingEduPiContext = noop, setPendingTeacherDraft = noop, setBranchTree = noop, setBranchActiveLeafId = noop;
      const setSystemPrompt = noop, setSessionStats = noop, setContextUsage = noop, setActiveTopPanel = noop, setTopMoreOpen = noop;
      const setSidebarOpen = noop, setFileTabs = noop, setActiveFileTabId = noop, setRightPanelOpen = noop, setEduPiAdminOpen = noop;
      const handleSessionDeleted = noop, handleOpenFile = noop, handleAtMention = noop, handleAtMentions = noop;
      const openEducationModule = noop, openEduPiAdmin = noop, setPluginsConfigOpen = noop, setSkillsConfigOpen = noop;
      ${handlers}
      ${declaration(shellSource, "AppShell", "effectiveNewSessionCwd")}
      ${educationDirectoryEffect()}
      ${declaration(shellSource, "AppShell", "renderSessionSidebar")}
      const session = selectedSession, reminderDraftKey = undefined, newSessionCwdForComposer = effectiveNewSessionCwd;
      const identity = ((newSessionCwd) => { ${declaration(chatSource, "ChatWindow", "draftKey")} return draftKey; })(newSessionCwdForComposer);
      host.state = { selectedSession, newSessionCwd, effectiveNewSessionCwd, activeCwd, initialSessionRestored, initialCwdStatus, initialCwdError, sessionKey, identity, view: searchParams.get("view"), url };
      host.api = { navigate: openEducationView, cwd: handleCwdChange, select: handleEducationSelectSession, newChat: handleEducationNewSession,
        replaceRoute: router.replace,
        bootstrapCwd(cwd) { suppressCwdBumpRef.current = true; setNewSessionCwd(cwd); },
        applyUrl(next) { setUrl(next.split("?")[1] || ""); } };
      return <div key={edupiChatActive ? "embedded" : "default"} hidden={!edupiChatActive}>
        {renderSessionSidebar(edupiChatActive ? "embedded-chat" : "default")}
      </div>;
    }
    exports.Parent = Parent;
  `;
  vm.runInNewContext(compile(parent), { ...scope, urls, noop });
  const container = window.document.getElementById("root"), root = createRoot(container);
  const f = { host, store, requests, validations, workspaceReads, urls, restores, manualCwdSelections,
    async revealSessions() { await f.run(() => container.querySelectorAll(".session-time-group__header[aria-expanded='false']").forEach(button => button.dispatchEvent(new window.Event("click", { bubbles: true })))); },
    sessionRow(session) { const title = [...container.querySelectorAll(".session-item-title")].find(item => item.textContent === session.name); assert.ok(title, `Session row ${session.name}`); return title.closest(".session-item"); },
    click(element) { element.dispatchEvent(new window.Event("click", { bubbles: true })); },
    async flush() { await act(async () => { for (let i = 0; i < 6; i++) await tick(); }); },
    async run(callback) { await act(async () => { callback(); await tick(); }); await f.flush(); },
    async newChat() { await f.run(() => host.api.newChat("synthetic-blank", host.picker.selectedCwd)); },
    async chooseCwd(cwd) { await f.run(() => host.picker.onSelectCwd(cwd)); },
    async navigate(view) { await f.run(() => host.api.navigate(view)); },
    async mainNavigate(view) {
      const context = { ...workbench, ...domainNavigation, calendarSelectionLink: calendar.calendarSelectionLink, URLSearchParams,
        useCallback: callback => callback, searchParams: new URLSearchParams(host.state.url), activeView: host.state.view,
        router: { replace: (...args) => host.api.replaceRoute(...args) },
        queryRef: { current: "" }, setQuery: noop, activeStage: "brief", activeTask: undefined,
        inspectorOpen: false, selectedStudentId: null, selectedObjectId: null, calendarSelection: null,
        calendarSelectionRef: { current: null }, objectNavigationForeground: false,
        collapseObjectNavigation: noop, cancelActivation: noop, setDrawer: noop, setFileReturnTaskKey: noop,
        setTaskDetailTask: noop, setAgentTask: noop, setPendingTaskBinding: noop, setCalendarSelection: noop,
        setReviewMode: noop, setSelectedC1Target: noop, setActiveView: noop, setSelectedObjectId: noop,
        setSelectedStudentId: noop, setActiveStage: noop, exports: {},
      };
      const code = declaration(panelSource, "EduPiEducationPanel", "updateLocation")
        + declaration(panelSource, "EduPiEducationPanel", "selectView") + "\nexports.navigate = selectView;";
      vm.runInNewContext(compile(code), context);
      await f.run(() => context.exports.navigate(view));
    },
    async resolveReads(value = sessions) { await f.run(() => requests.filter(item => !item.done).forEach(item => item.resolve(value))); },
    async resolveValidation(value) { await f.run(() => { assert.equal(validations.length, 1); validations[0].resolve(value); }); },
    writeDraft(value) { const key = host.state.identity; assert.ok(key); store.setDraft(key, { value, images: [] }); store.flushDraftNow(key); },
    readDraft() { return store.getDraft(host.state.identity)?.value ?? ""; },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, globals); },
  };
  await act(async () => root.render(jsx(scope.exports.Parent, {}))); await f.flush();
  return f;
}

test("startup restores its initial session once across hidden-default and embedded sidebar remounts", async () => {
  const f = await mount();
  try {
    assert.equal(f.host.state.selectedSession.id, original.id);
    await f.navigate("workspace"); await f.navigate("chat");
    assert.equal(f.host.state.selectedSession.id, original.id);
    assert.equal(f.host.picker.selectedCwd, original.cwd);
    assert.deepEqual(f.restores, [original.id]);
    assert.deepEqual(f.manualCwdSelections, [], "automatic restoration is not a manual directory intent");
    assert.ok(f.host.sidebarMounts >= 3);
  } finally { await f.close(); }
});

for (const cwd of [original.cwd, testCwd]) test(`explicit new draft in ${cwd} survives both sidebar remounts without restoring the startup conversation`, async () => {
  const f = await mount();
  try {
    await f.newChat();
    if (cwd !== original.cwd) await f.chooseCwd(cwd);
    f.writeDraft("[UI TEST] 草稿仍属于独立新对话");
    const key = f.host.state.identity, generation = f.host.state.sessionKey;
    await f.navigate("workspace"); await f.navigate("chat");
    assert.equal(f.host.state.selectedSession, null);
    assert.equal(f.host.state.effectiveNewSessionCwd, cwd);
    assert.equal(f.host.picker.selectedCwd, cwd);
    assert.equal(f.host.state.identity, key);
    assert.equal(f.host.state.sessionKey, generation);
    assert.equal(f.readDraft(), "[UI TEST] 草稿仍属于独立新对话");
    assert.equal(f.store.getDraft(original.id).value, "原会话合成未发送草稿");
    assert.deepEqual(f.restores, [original.id]);
  } finally { await f.close(); }
});

test("late session reads on both remounted sidebars do not override the explicit new directory", async () => {
  const f = await mount();
  try {
    await f.newChat(); await f.chooseCwd(testCwd); f.writeDraft("[UI TEST] 等待旧读取");
    f.host.delayed = true;
    await f.navigate("workspace"); await f.navigate("chat");
    await f.resolveReads([original, other]);
    assert.equal(f.host.state.selectedSession, null);
    assert.equal(f.host.picker.selectedCwd, testCwd);
    assert.equal(f.readDraft(), "[UI TEST] 等待旧读取");
  } finally { await f.close(); }
});

test("an explicit existing-session selection after a blank draft remains the current session", async () => {
  const f = await mount();
  try {
    await f.newChat(); await f.chooseCwd(testCwd); f.writeDraft("[UI TEST] 新草稿");
    await f.run(() => f.host.api.select(other));
    await f.navigate("workspace"); await f.navigate("chat");
    assert.equal(f.host.state.selectedSession.id, other.id);
    assert.equal(f.host.picker.selectedCwd, other.cwd);
    assert.equal(f.host.state.identity, other.id);
    assert.equal(f.store.getDraft(`new:${testCwd}`).value, "[UI TEST] 新草稿");
  } finally { await f.close(); }
});

test("first launch without an initial session still adopts the recent project", async () => {
  const f = await mount({ initialSessionId: null });
  try {
    assert.equal(f.host.state.selectedSession, null);
    assert.equal(f.host.state.effectiveNewSessionCwd, original.cwd);
    assert.equal(f.host.picker.selectedCwd, original.cwd);
    assert.deepEqual(f.restores, []);
    assert.deepEqual(f.manualCwdSelections, [], "the recent project is an automatic selection");
  } finally { await f.close(); }
});

test("a missing startup session is consumed once and does not return from a later list", async () => {
  const f = await mount({ initialSessionId: "missing-startup", sessions: [original, other] });
  try {
    assert.equal(f.host.state.initialSessionRestored, true);
    const cwd = f.host.state.effectiveNewSessionCwd;
    f.host.delayed = true;
    await f.navigate("workspace");
    await f.resolveReads([{ ...other, id: "missing-startup" }, original]);
    await f.navigate("chat"); await f.resolveReads([{ ...other, id: "missing-startup" }, original]);
    assert.equal(f.host.state.selectedSession, null);
    assert.equal(f.host.state.effectiveNewSessionCwd, cwd);
    assert.equal(f.host.picker.selectedCwd, cwd);
  } finally { await f.close(); }
});

test("a validated requested directory remains authoritative over recent projects", async () => {
  const f = await mount({ requestedCwd: testCwd });
  try {
    assert.deepEqual(JSON.parse(JSON.stringify(f.validations[0].input)), { cwd: testCwd });
    await f.resolveValidation();
    await f.navigate("workspace"); await f.navigate("chat");
    assert.equal(f.host.state.selectedSession, null);
    assert.equal(f.host.picker.selectedCwd, testCwd);
    assert.equal(f.host.state.effectiveNewSessionCwd, testCwd);
    assert.deepEqual(f.restores, []);
  } finally { await f.close(); }
});

for (const result of [{ cwd: testCwd }, { error: "旧目录校验失败" }]) test(`late requested-directory ${result.error ? "failure" : "success"} cannot replace a newer chosen context`, async () => {
  const f = await mount({ requestedCwd: testCwd });
  try {
    await f.chooseCwd(other.cwd); f.writeDraft("[UI TEST] 新目录草稿");
    await f.resolveValidation(result);
    assert.equal(f.host.state.effectiveNewSessionCwd, other.cwd);
    assert.equal(f.host.picker.selectedCwd, other.cwd);
    assert.equal(f.host.state.initialCwdStatus, "ready");
    assert.equal(f.host.state.initialCwdError, null);
    assert.equal(f.readDraft(), "[UI TEST] 新目录草稿");
  } finally { await f.close(); }
});

test("the actual main-rail navigation preserves the new draft across the hidden sidebar", async () => {
  const f = await mount();
  try {
    await f.newChat(); await f.chooseCwd(testCwd); f.writeDraft("[UI TEST] 实际主导航路径");
    await f.mainNavigate("workspace");
    assert.equal(f.host.state.selectedSession, null, "the hidden default sidebar must not restore the original");
    await f.mainNavigate("chat");
    assert.equal(f.host.state.identity, `new:${testCwd}`);
    assert.equal(f.host.picker.selectedCwd, testCwd);
    assert.equal(f.readDraft(), "[UI TEST] 实际主导航路径");
  } finally { await f.close(); }
});

test("a late old-session URL and list cannot revive the consumed startup selection", async () => {
  const f = await mount();
  try {
    await f.newChat(); await f.chooseCwd(testCwd); f.writeDraft("[UI TEST] 旧URL回填保护");
    f.host.delayed = true;
    await f.mainNavigate("workspace");
    await f.run(() => f.host.api.applyUrl(`/?edupi=1&module=home&view=chat&session=${original.id}`));
    await f.resolveReads();
    assert.equal(f.host.state.selectedSession, null);
    assert.equal(f.host.state.identity, `new:${testCwd}`);
    assert.equal(f.host.picker.selectedCwd, testCwd);
    assert.equal(f.readDraft(), "[UI TEST] 旧URL回填保护");
  } finally { await f.close(); }
});

test("a manual directory chosen before the startup read finishes consumes the initial restore", async () => {
  const f = await mount({ delayed: true });
  try {
    await f.chooseCwd(testCwd);
    assert.equal(f.host.state.initialSessionRestored, true);
    await f.resolveReads();
    await f.mainNavigate("workspace"); await f.mainNavigate("chat"); await f.resolveReads();
    assert.equal(f.host.state.selectedSession, null);
    assert.equal(f.host.picker.selectedCwd, testCwd);
    assert.deepEqual(f.restores, []);
  } finally { await f.close(); }
});

test("explicit selection in another project is not cleared by that sidebar's cwd notification", async () => {
  const f = await mount();
  try {
    await f.newChat(); await f.chooseCwd(testCwd);
    await f.run(() => f.host.api.select(other));
    assert.equal(f.host.state.selectedSession.id, other.id);
    assert.equal(f.host.state.activeCwd, other.cwd);
    assert.equal(f.host.state.effectiveNewSessionCwd, null);
  } finally { await f.close(); }
});


for (const result of [{ cwd: testCwd }, { error: "同批次旧目录校验失败" }]) test(`same-batch manual directory and late validation ${result.error ? "failure" : "success"} keeps the explicit directory`, async () => {
  const f = await mount({ requestedCwd: testCwd });
  try {
    await f.run(() => {
      f.host.picker.onSelectCwd(other.cwd);
      assert.equal(f.manualCwdSelections.length, 1, "the manual intent is notified before React effects");
      f.validations[0].resolve(result);
    });
    assert.equal(f.host.state.selectedSession, null);
    assert.equal(f.host.state.newSessionCwd, null);
    assert.equal(f.host.state.effectiveNewSessionCwd, other.cwd);
    assert.equal(f.host.picker.selectedCwd, other.cwd);
    assert.equal(f.host.state.initialCwdStatus, "ready");
    assert.equal(f.host.state.initialCwdError, null);
  } finally { await f.close(); }
});

for (const result of [{ cwd: testCwd }, { error: "两次选择间的旧校验失败" }]) test(`two same-batch manual choices and old validation ${result.error ? "failure" : "success"} keep the last choice`, async () => {
  const f = await mount({ requestedCwd: testCwd });
  try {
    await f.run(() => {
      f.host.picker.onSelectCwd(original.cwd);
      f.validations[0].resolve(result);
      f.host.picker.onSelectCwd(other.cwd);
      assert.equal(f.manualCwdSelections.length, 2);
    });
    assert.equal(f.host.state.selectedSession, null);
    assert.equal(f.host.state.newSessionCwd, null);
    assert.equal(f.host.state.effectiveNewSessionCwd, other.cwd);
    assert.equal(f.host.picker.selectedCwd, other.cwd);
    assert.equal(f.host.state.initialCwdStatus, "ready");
    assert.equal(f.host.state.initialCwdError, null);
    await f.mainNavigate("workspace"); await f.mainNavigate("chat");
    assert.equal(f.host.state.effectiveNewSessionCwd, other.cwd);
    assert.equal(f.host.picker.selectedCwd, other.cwd);
    assert.deepEqual(f.restores, []);
  } finally { await f.close(); }
});

for (const result of [{ cwd: testCwd }, { error: "选择现有会话后的旧校验失败" }]) test(`same-batch actual session click and old validation ${result.error ? "failure" : "success"} preserve the selected conversation`, async () => {
  const f = await mount({ requestedCwd: testCwd });
  try {
    await f.revealSessions();
    const row = f.sessionRow(other);
    await f.run(() => {
      f.click(row);
      f.validations[0].resolve(result);
    });
    assert.equal(f.host.state.selectedSession.id, other.id);
    assert.equal(f.host.state.selectedSession.name, other.name);
    assert.deepEqual(f.manualCwdSelections, [], "a session click does not reset manual directory intent");
    assert.equal(f.host.state.newSessionCwd, null);
    assert.equal(f.host.state.effectiveNewSessionCwd, null);
    assert.equal(f.host.state.identity, other.id);
    assert.equal(f.host.picker.selectedCwd, other.cwd);
    assert.equal(f.host.state.initialCwdStatus, "ready");
    assert.equal(f.host.state.initialCwdError, null);
    await f.mainNavigate("workspace"); await f.mainNavigate("chat");
    assert.equal(f.host.state.selectedSession.id, other.id);
    assert.equal(f.host.picker.selectedCwd, other.cwd);
  } finally { await f.close(); }
});


test("a manual choice after a startup success was queued in the same batch wins before commit", async () => {
  const f = await mount({ requestedCwd: testCwd });
  try {
    await act(async () => {
      f.validations[0].resolve();
      for (let i = 0; i < 6; i++) await Promise.resolve();
      assert.equal(f.host.state.effectiveNewSessionCwd, null, "React has not committed the queued startup result");
      f.host.picker.onSelectCwd(other.cwd);
      await tick();
    });
    await f.flush();
    assert.equal(f.host.state.selectedSession, null);
    assert.equal(f.host.state.effectiveNewSessionCwd, other.cwd);
    assert.equal(f.host.picker.selectedCwd, other.cwd);
    assert.equal(f.host.state.initialCwdStatus, "ready");
    assert.equal(f.host.state.initialCwdError, null);
  } finally { await f.close(); }
});


test("an explicit requested directory does not launch the education workspace fallback", async () => {
  const f = await mount({ requestedCwd: testCwd });
  try {
    assert.equal(f.workspaceReads.length, 0);
    await f.resolveValidation();
    assert.equal(f.host.state.effectiveNewSessionCwd, testCwd);
  } finally { await f.close(); }
});

test("the education fallback still supplies the directory when startup has no context", async () => {
  const f = await mount({ initialSessionId: null, sessions: [] });
  try {
    assert.equal(f.workspaceReads.length, 1);
    await f.run(() => f.workspaceReads[0].resolve(testCwd));
    await f.resolveValidation();
    assert.equal(f.host.state.selectedSession, null);
    assert.equal(f.host.state.effectiveNewSessionCwd, testCwd);
    assert.equal(f.host.picker.selectedCwd, testCwd);
    assert.equal(f.host.state.initialCwdStatus, "ready");
    assert.deepEqual(f.manualCwdSelections, []);
  } finally { await f.close(); }
});

for (const result of [{ cwd: testCwd }, { error: "旧教育工作区校验失败" }]) test(`same-batch manual directory and education fallback validation ${result.error ? "failure" : "success"} keep the manual choice`, async () => {
  const f = await mount({ initialSessionId: null, sessions: [] });
  try {
    await f.run(() => f.workspaceReads[0].resolve(testCwd));
    assert.equal(f.validations.length, 1);
    await f.run(() => {
      f.host.picker.onSelectCwd(other.cwd);
      f.validations[0].resolve(result);
    });
    assert.equal(f.host.state.selectedSession, null);
    assert.equal(f.host.state.newSessionCwd, null);
    assert.equal(f.host.state.effectiveNewSessionCwd, other.cwd);
    assert.equal(f.host.picker.selectedCwd, other.cwd);
    assert.equal(f.host.state.initialCwdError, null);
  } finally { await f.close(); }
});

test("a late education workspace read cannot validate or replace a manual directory", async () => {
  const f = await mount({ initialSessionId: null, sessions: [] });
  try {
    await f.chooseCwd(other.cwd);
    await f.run(() => f.workspaceReads[0].resolve(testCwd));
    assert.equal(f.validations.length, 0);
    assert.equal(f.host.state.effectiveNewSessionCwd, other.cwd);
    assert.equal(f.host.picker.selectedCwd, other.cwd);
    assert.equal(f.host.state.initialCwdError, null);
  } finally { await f.close(); }
});
