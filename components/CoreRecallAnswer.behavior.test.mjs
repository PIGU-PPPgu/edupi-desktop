import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import React, { act } from "react";
import refresh from "next/dist/compiled/react-refresh/runtime.js";
import { jsx, jsxs, Fragment } from "react/jsx-runtime";
import { parseHTML } from "linkedom";
import { createJiti } from "jiti";

// The real renderer must see Refresh's hook before it initializes.
refresh.injectIntoGlobalHook(globalThis);
const { createRoot } = await import("react-dom/client");
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const pure = {};
for (const name of ["edupi-recall-answer", "edupi-composer-context", "normalize", "scroll-memory", "streaming-message",
  "agent-message-history", "tool-presets", "ansi", "terminal-input", "message-display", "chat-file-drop", "chat-lazy-load",
  "edupi-calendar-result", "edupi-priority-send", "compaction-summary", "patch", "slash-display", "file-paths", "file-links",
  "chat-image-source", "draft-store"]) pure[`@/lib/${name}`] = await jiti.import(`../lib/${name}.ts`);
const paths = {
  client: "../lib/edupi-recall-answer-client.ts", hook: "../hooks/useAgentSession.ts",
  drafts: "../lib/draft-store.ts",
  CoreRecallAnswer: "./CoreRecallAnswer.tsx", CoreRecallPersonConfirmation: "./CoreRecallPersonConfirmation.tsx",
  MessageView: "./MessageView.tsx", ChatWindow: "./ChatWindow.tsx",
};
const sources = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, fs.readFileSync(new URL(path, import.meta.url), "utf8")]));
const compile = source => ts.transpileModule(
  source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } },
).outputText;
const code = Object.fromEntries(Object.entries(sources).map(([key, source]) => [key, compile(source)]));
function withPassiveLifecycleCleanup() {
  const file = ts.createSourceFile("useAgentSession.ts", sources.hook, ts.ScriptTarget.Latest, true);
  const matches = [];
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(file) === "useLayoutEffect"
      && ts.isArrowFunction(node.arguments[0]) && ts.isArrowFunction(node.arguments[0].body)
      && node.arguments[0].body.getText(file).includes("promptRunIdRef.current")
      && node.arguments[0].body.getText(file).includes("closeEvents()")) matches.push(node.expression);
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.equal(matches.length, 1, "mutate only the lifecycle cleanup's effect kind in memory");
  const effect = matches[0];
  return compile(sources.hook.slice(0, effect.getStart(file)) + "useEffect" + sources.hook.slice(effect.end));
}
function capabilityCounterexample(variant) {
  const key = variant === "5xx-as-disabled" ? "client" : "ChatWindow";
  const source = sources[key], file = ts.createSourceFile(paths[key], source, ts.ScriptTarget.Latest, true);
  const matches = [];
  const visit = node => {
    if (variant === "context-key" && ts.isCallExpression(node) && node.expression.getText(file) === "useEffect"
      && node.arguments[0]?.getText(file).includes("coreRecallClient.enabled")) {
      const deps = node.arguments[1];
      matches.push({ node: deps, replacement: deps.getText(file).slice(0, -1) + ", coreRecallContextKey]" });
    }
    if (variant === "5xx-as-disabled" && ts.isIfStatement(node)
      && node.expression.getText(file) === "response.status >= 500" && ts.isThrowStatement(node.thenStatement)) {
      matches.push({ node: node.thenStatement, replacement: "return false;" });
    }
    if (variant === "abort-only" && ts.isCallExpression(node) && node.expression.getText(file) === "reject"
      && node.getText(file).includes("Core 核验读取超时")) matches.push({ node, replacement: "undefined" });
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.equal(matches.length, 1, `mutate only ${variant} in memory`);
  const { node, replacement } = matches[0];
  return { [key]: compile(source.slice(0, node.getStart(file)) + replacement + source.slice(node.end)) };
}
let refreshId = 0;
const noop = () => {};
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const plain = value => value == null ? value : JSON.parse(JSON.stringify(value));
const capability = (enabled, status = 200) => ({ body: { version: 1, enabled }, status });
const propsOf = node => node[Object.keys(node).find(key => key.startsWith("__reactProps$"))];
const user = (content, timestamp = 1) => ({ role: "user", content, timestamp });
const assistant = (content = [], extra = {}) => ({ role: "assistant", model: "synthetic", provider: "synthetic", content, ...extra });
const text = "花灯班会由**张老师**主持，排在第二场。\n<原文>";
function canonical(requestId = "request-history", entry = "source-entry", receipt = "11111111-1111-1111-1111-111111111111", sid = "synthetic-a") {
  const sources = [
    { id: "source-person", content: "花灯班会由张老师主持。", source_fingerprint: `sha256:${"a".repeat(64)}` },
    { id: "source-ordinal", content: "花灯班会排在第二场。", source_fingerprint: `sha256:${"b".repeat(64)}` },
  ];
  return { role: "custom", display: true, customType: "edupi_core_recall_answer_v1", content: text,
    details: { version: 1, receiptId: receipt, sessionId: sid, userEntryId: entry, clientRequestId: requestId,
      originalTextHash: `sha256:${"c".repeat(64)}`, issuedAt: "2026-11-17T00:00:00.000Z", reasonCode: null, sources,
      answer: { policy: "current-case-facets-v1", work_case_ref: "synthetic-case", anchor: "花灯班会", text,
        receipt_ref: `recall_answer:${"d".repeat(64)}`, valid_until: new Date(Date.now() + 60_000).toISOString(),
        question_case_verified: true, answer_verified: true, facets: sources.map((source, index) => ({
          facet_id: `facet_${index}`, question: index ? "排在第几场？" : "谁主持？", kind: index ? "ordinal" : "person",
          source_id: source.id, source_fingerprint: source.source_fingerprint, answer: [index ? "第二场" : "张老师"], evidence: [source.content],
        })) } } };
}
function personState(extra = {}) {
  return { version: 1, status: "current", reasonCode: null, personName: "张老师", previewId: "preview-zero",
    personId: "synthetic-person", personRevision: 0, sourceFingerprint: `sha256:${"a".repeat(64)}`, factWrite: false, ...extra };
}

async function mount({ history = [], ids = [], teacherMode = true, enabled = true, now = Date.now(), artifactRefreshOnAgentEnd = false, delayConnection = false, durable = false,
  strict = false, passiveCleanup = false, deferHistory = false, agentState = { running: false }, enabledReplies = [], capabilityVariant = null } = {}) {
  const { window } = parseHTML("<html><body><div id='root'></div></body></html>");
  const document = window.document;
  const previousGlobals = Object.fromEntries(["window", "document", "HTMLElement", "IS_REACT_ACT_ENVIRONMENT"].map(key => [key, globalThis[key]]));
  Object.assign(globalThis, { window, document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  let visibility = "visible", focused = true;
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  document.hasFocus = () => focused;
  window.HTMLElement.prototype.scrollIntoView = noop;
  window.HTMLElement.prototype.scrollTo = noop;
  const timers = new Map(), intervals = new Map(), events = [], requests = [], commands = [], errors = [];
  let nextTimer = 0;
  let clock = now;
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const timer = (callback, ms = 0) => { timers.set(++nextTimer, { callback, ms, at: clock + ms }); return nextTimer; };
  const host = {
    hook: null, input: null, pending: [], selected: "synthetic-a", enabled, answer: { version: 1, status: "current", reasonCode: null },
    answerGate: null, personGate: null, agentGate: null, intentGate: null, captureGate: null, intents: [], captures: [], resolutions: [],
    person: personState(), confirm: personState({ status: "confirmed", factWrite: true }), sendPromise: null, completions: 0,
    histories: new Map([["synthetic-a", { messages: history, entryIds: ids }]]),
    states: new Map([["synthetic-a", agentState]]), deferHistory, historyPending: [],
    enabledReplies: [...enabledReplies],
  };
  const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ url, method: init.method ?? "GET", body, signal: init.signal });
    if (url === "/api/edupi/recall/answer-state") {
      if (!body) {
        let reply = host.enabledReplies.shift();
        // Deliberately ignore abort: the component must fence off late transport replies.
        if (reply?.promise) reply = await reply.promise;
        if (reply instanceof Error) throw reply;
        return response(reply?.body ?? { version: 1, enabled: host.enabled }, reply?.status ?? 200);
      }
      if (host.answerGate) return response(await host.answerGate.promise);
      return response(host.answer);
    }
    if (url === "/api/edupi/recall/person") {
      if (host.personGate) return response(await host.personGate.promise);
      return response(body.action === "read" ? host.person : host.confirm);
    }
    if (url === "/api/models") return response({ models: {}, modelList: [] });
    if (url.startsWith("/api/sessions/")) {
      const sid = decodeURIComponent(url.split("/")[3].split("?")[0]);
      if (url.endsWith("/state")) return response(host.states.get(sid) ?? { running: false });
      if (host.deferHistory) {
        const pending = { sid, ...deferred(), shouldRetry: init.shouldRetry, currentAtStart: init.shouldRetry?.() };
        host.historyPending.push(pending);
        return response(await pending.promise);
      }
      return response({ sessionId: sid, tree: [], leafId: null, filePath: "", context: {
        ...(host.histories.get(sid) ?? { messages: [], entryIds: [] }), model: null, thinkingLevel: "off",
      } });
    }
    if (url.startsWith("/api/agent/")) return response(host.agentGate ? await host.agentGate.promise : { running: false });
    assert.fail(`Unexpected synthetic request: ${url}`);
  };
  const modules = { ...pure, react: React, "react/jsx-runtime": { jsx, jsxs, Fragment } };
  const mountedCode = { ...code, ...(capabilityVariant ? capabilityCounterexample(capabilityVariant) : {}),
    ...(passiveCleanup ? { hook: withPassiveLifecycleCleanup() } : {}) };
  const load = name => {
    const exports = {};
    vm.runInNewContext(mountedCode[name], { exports, window, document, Date: ClockDate, URL, URLSearchParams, crypto: globalThis.crypto,
      process: { env: { NODE_ENV: "test" } },
      AbortController, DOMException, TextDecoder, Event: window.Event, CustomEvent: window.CustomEvent, fetch, EventSource: FakeEventSource,
      setTimeout: timer, clearTimeout: id => timers.delete(id), setInterval: (callback, ms) => { intervals.set(++nextTimer, { callback, ms }); return nextTimer; },
      clearInterval: id => intervals.delete(id), requestAnimationFrame: callback => timer(callback, 16), cancelAnimationFrame: id => timers.delete(id),
      console: { error: (...args) => errors.push(args), warn: noop },
      require: name => { assert.ok(modules[name], `explicit synthetic import ${name}`); return modules[name]; },
    });
    return exports;
  };
  class FakeEventSource {
    static OPEN = 1; static CLOSED = 2;
    readyState = 1;
    constructor(url) {
      this.url = url; events.push(this);
      if (!delayConnection) queueMicrotask(() => this.emit({ type: "connected" }));
    }
    close() { this.readyState = 2; }
    emit(event) { this.onmessage?.({ data: JSON.stringify(event) }); }
  }
  if (durable) {
    const storage = new Map();
    modules["@/lib/app-prefs"] = { APP_PREF_KEYS: { chatDrafts: "drafts" },
      getPrefJson: key => storage.has(key) ? JSON.parse(storage.get(key)) : null,
      trySetPrefJson: (key, value) => { storage.set(key, JSON.stringify(value)); return true; } };
    modules["@/lib/draft-store"] = load("drafts");
    modules["@/lib/draft-store"].setDraft(host.selected, { value: "花灯班会谁主持，排在第几场？", images: [] });
  }
  modules["./desktop-native"] = { fetchDesktopApi: fetch };
  modules["./edupi-recall-answer"] = pure["@/lib/edupi-recall-answer"];
  const client = load("client");
  modules["@/lib/edupi-recall-answer-client"] = client;
  modules["@/lib/agent-client"] = { sendAgentCommand: async (sid, command) => {
    commands.push({ sid, command });
    if (command.type === "get_tools") return [];
    if (command.type === "abort") return {};
    if (durable && command.type === "persist_session") return {};
    if (command.type === "prompt") {
      const pending = { sid, command, ...deferred() }; host.pending.push(pending); return pending.promise;
    }
    assert.fail(`Unexpected synthetic command ${command.type}`);
  } };
  modules["@/lib/fetch-timeout"] = { fetchWithRetry: fetch, fetchJsonWithDeadline: async url => {
    const response = await fetch(url); return { response, body: await response.json() };
  } };
  modules["@/lib/edupi-ui-events"] = { EDUPI_STUDENT_RECORDS_UPDATED_EVENT: "edupi-student-records-updated" };
  modules["@/lib/edupi-ambient-message"] = { persistEduPiPromptIntent: async intent => {
    assert.ok(durable, "only the isolated durable harness can persist intents");
    host.intents.push(intent);
    return host.intentGate ? await host.intentGate.promise : "ready";
  }, reconcileEduPiCapturedPrompt: async () => "unavailable",
    resolveEduPiPromptIntentClient: async (...identity) => { assert.ok(durable); host.resolutions.push(identity); },
    sendEduPiCapturedPrompt: async capture => {
      host.captures.push(capture);
      return host.captureGate ? await host.captureGate.promise : "disabled";
    } };
  modules["@/lib/desktop-updater"] = { isTauriDesktop: () => durable };
  modules["@/lib/queue-recovery"] = { recallQueueWithBackup: assert.fail };
  const hook = load("hook");
  modules["@/hooks/useAgentSession"] = { useAgentSession: options => { host.hook = hook.useAgentSession(options); return host.hook; } };
  modules["@/hooks/useI18n"] = { useI18n: () => ({ t: key => key, locale: "zh-CN" }) };
  modules["@/lib/clipboard"] = { copyText: async () => {} };
  modules["./MarkdownBody"] = { MarkdownBody: ({ children }) => jsx("div", { "data-markdown": true, children }) };
  modules["./DisclosureChevron"] = { DisclosureChevron: () => null };
  modules["./ChatVisualResult"] = { ChatVisualResult: () => null };
  for (const name of ["CoreRecallAnswer", "CoreRecallPersonConfirmation", "MessageView"]) modules[`./${name}`] = load(name);
  modules["@/hooks/useKeyboardShortcuts"] = { registerAbortHandler: noop };
  modules["@/hooks/useAudio"] = { useAudio: () => ({ soundEnabled: false, playDoneSound: noop }) };
  modules["@/hooks/useDragDrop"] = { useDragDrop: () => ({}) };
  for (const name of ["EduPiConversationFiles", "EduPiProactiveHub", "EduPiRuntimeFlow", "ConversationNavigator", "EduPiBrandMark"]) modules[`./${name}`] = { [name]: () => null };
  modules["./ChatInput"] = { ChatInput: props => { host.input = props; return null; } };
  const { ChatWindow } = load("ChatWindow");
  const family = `synthetic-chat-window-${++refreshId}`;
  refresh.register(ChatWindow, family);
  const root = createRoot(document.getElementById("root")), container = document.getElementById("root");
  let unmounted = false;
  const session = id => ({ id, cwd: "/synthetic/R04", path: "", messageCount: 0 });
  function Parent() {
    const [id, select] = React.useState(host.selected);
    const [modelsRefreshKey, refreshModels] = React.useState(0);
    host.select = select;
    host.refreshModels = refreshModels;
    return jsx(ChatWindow, { session: session(id), newSessionCwd: null, teacherMode, modelsRefreshKey,
      onAgentEnd: artifactRefreshOnAgentEnd ? () => {
        host.completions++;
        window.dispatchEvent(new window.CustomEvent("edupi-artifacts-updated", { detail: { refreshOnly: true } }));
      } : undefined,
    });
  }
  const f = { host, requests, commands, events, container, client, store: modules["@/lib/draft-store"],
    enabledGets: () => requests.filter(item => item.url.endsWith("answer-state") && item.method === "GET"),
    answerPosts: () => requests.filter(item => item.url.endsWith("answer-state") && item.method === "POST"),
    personPosts: () => requests.filter(item => item.url.endsWith("/person")),
    historyReads: () => requests.filter(item => item.url.startsWith("/api/sessions/") && !item.url.endsWith("/state")),
    stateReads: () => requests.filter(item => item.url === `/api/agent/${host.selected}`),
    coldDraft: key => plain(load("drafts").getDraft(key)),
    probeTimers: () => [...timers.values()].filter(item => item.ms === 1_000 || item.ms === 10_000).map(item => item.ms),
    recheckButton: () => [...container.querySelectorAll(".core-recall-answer button")].find(node => node.textContent === "重新核对"),
    async flush() { await act(async () => { for (let i = 0; i < 5; i++) await tick(); }); },
    async run(callback) { await act(async () => { callback(); await tick(); }); await f.flush(); },
    async refresh() {
      const next = load("ChatWindow").ChatWindow;
      refresh.register(next, family);
      await f.run(() => {
        const update = refresh.performReactRefresh();
        assert.ok(update?.updatedFamilies.has(refresh.getFamilyByType(next)), "Refresh preserves the mounted component family");
        assert.equal(update.staleFamilies.size, 0, "the regression must not remount the hook");
      });
    },
    async history(pending, messages, entryIds) {
      await f.run(() => pending.resolve({ sessionId: pending.sid, tree: [], leafId: null, filePath: "", context: {
        messages, entryIds, model: null, thinkingLevel: "off",
      } }));
    },
    async send(content = "花灯班会谁主持，排在第几场？") {
      await f.run(() => { host.sendPromise = host.hook.handleSend(content); });
      assert.ok(host.pending.length);
      return host.pending.at(-1).command.clientRequestId;
    },
    async emit(event, requestId = host.pending.at(-1)?.command.clientRequestId) {
      await f.run(() => events.at(-1).emit({ ...event, ...(requestId ? { clientRequestId: requestId } : {}) }));
    },
    async deliver(message, entryId) {
      const history = host.histories.get(host.selected) ?? { messages: [], entryIds: [] };
      host.histories.set(host.selected, { messages: [...history.messages, message], entryIds: [...history.entryIds, entryId] });
      await f.emit({ type: "message_end", message, entryId, messageId: entryId });
    },
    async answer(receipt) {
      const requestId = await f.send();
      await f.deliver(user("花灯班会谁主持，排在第几场？"), "source-entry");
      const message = canonical(requestId, "source-entry", receipt);
      await f.deliver(message, `answer-${message.details.receiptId}`);
      return message;
    },
    async finish() {
      await f.run(() => host.pending.at(-1).resolve());
      await f.emit({ type: "agent_end" });
      await f.emit({ type: "prompt_done" });
    },
    async event(name, detail) { await f.run(() => window.dispatchEvent(detail === undefined
      ? new window.Event(name) : new window.CustomEvent(name, { detail }))); },
    async hidden(value) { visibility = value ? "hidden" : "visible"; await f.run(() => document.dispatchEvent(new window.Event("visibilitychange"))); },
    async blur() { focused = false; await f.event("blur"); },
    async focus() { focused = true; await f.event("focus"); },
    async reconcileTriggers() {
      await f.event("online");
      await f.run(() => document.dispatchEvent(new window.Event("visibilitychange")));
      const pollers = [...intervals.values()].filter(item => item.ms === 15_000);
      assert.equal(pollers.length, 1, "the mounted running hook owns its reconciliation interval");
      await f.run(() => pollers.forEach(item => item.callback()));
    },
    async switch(id) { host.selected = id; await f.run(() => host.select(id)); },
    async modelsRefresh() { await f.run(() => host.refreshModels(key => key + 1)); },
    async expire(ms) {
      const found = [...timers.entries()].find(([, item]) => item.ms === ms);
      assert.ok(found, `timer ${ms}`); timers.delete(found[0]); await f.run(found[1].callback);
    },
    async advance(ms) {
      const until = clock + ms;
      for (;;) {
        const found = [...timers.entries()].filter(([, item]) => item.at <= until)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!found) break;
        clock = found[1].at;
        timers.delete(found[0]);
        await f.run(found[1].callback);
      }
      clock = until;
      await f.flush();
    },
    async recheck() {
      await f.run(() => {
        const button = [...container.querySelectorAll(".core-recall-answer button")].find(node => node.textContent === "重新核对");
        assert.ok(button && !button.disabled, "explicit recheck is enabled");
        button.dispatchEvent(new window.Event("click", { bubbles: true }));
      });
    },
    person(index = 0) {
      const node = container.querySelectorAll(".core-recall-person")[index];
      assert.ok(node);
      const button = label => [...node.querySelectorAll("button")].find(item => item.textContent.trim() === label);
      return {
        node, button,
        async click(label, twice = false) { await f.run(() => { const item = button(label); assert.ok(item, label);
          const callback = propsOf(item).onClick; assert.ok(callback); callback(); if (twice) callback(); }); },
        async type(value) { await f.run(() => propsOf(node.querySelector("input")).onChange({ target: { value } })); },
        async read() { await f.run(() => node.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }))); },
      };
    },
    async unmount() {
      if (unmounted) return;
      unmounted = true;
      await act(async () => root.unmount());
    },
    async close() {
      await f.unmount();
      Object.assign(globalThis, previousGlobals);
      assert.deepEqual(errors, [], "no unexpected runtime errors");
    },
  };
  await act(async () => root.render(strict ? jsx(React.StrictMode, { children: jsx(Parent, {}) }) : jsx(Parent, {})));
  await f.flush(); return f;
}

async function mountCapability(options = {}) {
  return mount({ history: [user("谁主持？"), canonical()], ids: ["source-entry", "historical-custom"], ...options });
}

async function capabilityRecoveryContract(firstReply, capabilityVariant = null) {
  const f = await mountCapability({ enabledReplies: [firstReply, capability(true)], capabilityVariant });
  try {
    assert.equal(f.enabledGets().length, 1);
    assert.equal(f.recheckButton(), undefined);
    await f.blur(); await f.focus();
    await f.advance(999);
    assert.equal(f.enabledGets().length, 1, "reentry does not bypass the 1s retry delay");
    await f.advance(1);
    assert.equal(f.enabledGets().length, 2, "temporary capability failure must retry once the 1s delay elapses");
    assert.ok(f.recheckButton() && !f.recheckButton().disabled, "reentry regains the explicit recheck action");
    assert.doesNotMatch(f.container.textContent, /本轮核验/);
    assert.equal(f.answerPosts().length, 0, "capability discovery never grants current authority");
    assert.deepEqual(f.probeTimers(), []);
    await f.recheck();
    assert.match(f.container.textContent, /本轮核验/);
    assert.equal(f.answerPosts().length, 1, "current still requires a separate explicit proof");
  } finally { await f.close(); }
}

for (const failure of ["network", "503"]) test(`capability probe recovers the reentry action after its first ${failure} failure`, async () => {
  await capabilityRecoveryContract(failure === "network" ? new TypeError("synthetic offline") : capability(false, 503));
});

async function capabilityDeadlineContract(latestEnabled, capabilityVariant = null) {
  const first = deferred(), second = deferred();
  const f = await mountCapability({ enabledReplies: [first, second], capabilityVariant });
  try {
    const oldRequest = f.enabledGets()[0];
    await f.blur(); await f.focus();
    await f.advance(9_999);
    assert.equal(oldRequest.signal.aborted, false);
    assert.equal(f.enabledGets().length, 1);
    await f.advance(1);
    assert.equal(oldRequest.signal.aborted, true, "the 10s deadline aborts the stalled attempt");
    await f.advance(999);
    assert.equal(f.enabledGets().length, 1);
    await f.advance(1);
    assert.equal(f.enabledGets().length, 2, "deadline must start a replacement probe despite ignored abort");
    assert.equal(f.enabledGets()[1].signal.aborted, false);
    await f.run(() => second.resolve(capability(latestEnabled)));
    assert.equal(Boolean(f.recheckButton()), latestEnabled);
    await f.run(() => first.resolve(capability(!latestEnabled)));
    assert.equal(Boolean(f.recheckButton()), latestEnabled, "a late timed-out reply cannot overwrite the replacement result");
    assert.equal(f.answerPosts().length, 0);
    assert.doesNotMatch(f.container.textContent, /本轮核验/);
    assert.deepEqual(f.probeTimers(), []);
  } finally { await f.close(); }
}

for (const latestEnabled of [true, false]) test(`capability probe fences a late ignored-abort reply after the 10s deadline and replacement ${latestEnabled}`, async () => {
  await capabilityDeadlineContract(latestEnabled);
});

async function capabilityRevocationContract(invalidate, capabilityVariant = null) {
  const f = await mount({ capabilityVariant });
  try {
    await f.answer(); await f.finish();
    assert.match(f.container.textContent, /本轮核验/);
    const reads = f.enabledGets().length, posts = f.answerPosts().length;
    assert.equal(reads, 1, "turn changes must not restart capability discovery");
    f.host.enabledReplies.push(new TypeError("synthetic next probe unavailable"));
    if (invalidate === "source") await f.event("edupi-facts-updated");
    if (invalidate === "blur") { await f.blur(); await f.focus(); }
    if (invalidate === "hidden") { await f.hidden(true); await f.hidden(false); }
    assert.doesNotMatch(f.container.textContent, /本轮核验/);
    assert.ok(f.host.hook.messages.every(item => !item.coreRecallLive));
    assert.equal(f.enabledGets().length, reads, "source/view revocation must not restart capability discovery");
    assert.equal(f.answerPosts().length, posts, "returning to the view never restores current automatically");
    assert.ok(f.recheckButton() && !f.recheckButton().disabled, "revocation keeps the explicit recovery action available");
    await f.recheck();
    assert.equal(f.answerPosts().length, posts + 1);
    assert.match(f.container.textContent, /本轮核验/);
  } finally { await f.close(); }
}

for (const invalidate of ["source", "blur", "hidden"]) test(`capability probe stays cached while ${invalidate} revokes current and retains explicit recheck`, async () => {
  await capabilityRevocationContract(invalidate);
});

test("capability probe never leaks a late enabled true from the previous session", async () => {
  const old = deferred(), next = deferred();
  const f = await mountCapability({ enabledReplies: [old, next] });
  try {
    f.host.histories.set("synthetic-b", { messages: [user("谁主持？"), canonical(undefined, undefined, undefined, "synthetic-b")],
      entryIds: ["source-entry", "b-answer"] });
    const oldRequest = f.enabledGets()[0];
    await f.switch("synthetic-b");
    assert.equal(oldRequest.signal.aborted, true);
    assert.equal(f.enabledGets().length, 2);
    await f.run(() => old.resolve(capability(true)));
    assert.equal(f.recheckButton(), undefined, "old enabled true must not leak while the new probe is pending");
    await f.run(() => next.resolve(capability(false)));
    await f.advance(12_000);
    assert.equal(f.recheckButton(), undefined);
    assert.equal(f.enabledGets().length, 2);
    assert.equal(f.answerPosts().length, 0);
    assert.equal(f.container.querySelector(".core-recall-person"), null);
  } finally { await f.close(); }
});

for (const status of [200, 403]) test(`capability probe treats ${status} disabled as final until modelsRefreshKey changes`, async () => {
  const f = await mountCapability({ enabledReplies: [capability(false, status)] });
  try {
    await f.advance(30_000);
    assert.equal(f.enabledGets().length, 1, "disabled is a normal result and must not retry");
    assert.equal(f.recheckButton(), undefined);
    assert.deepEqual(f.probeTimers(), []);
    await f.modelsRefresh();
    assert.equal(f.enabledGets().length, 2, "an explicit model configuration refresh reprobes capability");
    assert.ok(f.recheckButton() && !f.recheckButton().disabled);
    assert.equal(f.answerPosts().length, 0);
    assert.doesNotMatch(f.container.textContent, /本轮核验/);
  } finally { await f.close(); }
});

test("capability probe stops after three failed attempts and model refresh starts a new probe", async () => {
  const f = await mountCapability({ enabledReplies: [
    new TypeError("synthetic offline"), capability(false, 503), new TypeError("synthetic offline again"),
  ] });
  try {
    await f.advance(1_000);
    assert.equal(f.enabledGets().length, 2);
    await f.advance(1_000);
    assert.equal(f.enabledGets().length, 3);
    await f.advance(30_000);
    assert.equal(f.enabledGets().length, 3, "a failed probe is capped at three attempts");
    assert.equal(f.recheckButton(), undefined);
    assert.deepEqual(f.probeTimers(), []);
    await f.modelsRefresh();
    assert.equal(f.enabledGets().length, 4);
    assert.ok(f.recheckButton() && !f.recheckButton().disabled);
    assert.equal(f.answerPosts().length, 0);
  } finally { await f.close(); }
});

for (const stage of ["pending deadline", "pending retry"]) test(`capability probe aborts and cancels ${stage} on unmount`, async () => {
  const gate = deferred();
  const f = await mountCapability({ enabledReplies: [stage === "pending deadline" ? gate : new TypeError("synthetic offline")] });
  try {
    assert.deepEqual(f.probeTimers(), [stage === "pending deadline" ? 10_000 : 1_000]);
    const request = f.enabledGets()[0];
    await f.unmount();
    assert.equal(request.signal.aborted, true);
    assert.deepEqual(f.probeTimers(), [], "unmount cancels deadline and retry timers");
    await f.run(() => gate.resolve(capability(true)));
    await f.advance(30_000);
    assert.equal(f.enabledGets().length, 1, "no late reply or retry may restart an unmounted probe");
    assert.deepEqual(f.probeTimers(), []);
  } finally { await f.close(); }
});

test("capability probe counterexample catches per-turn context-key discovery", async () => {
  await assert.rejects(() => capabilityRevocationContract("source", "context-key"), {
    code: "ERR_ASSERTION", message: /^turn changes must not restart capability discovery\b/,
  });
});

test("capability probe counterexample catches treating 503 as disabled", async () => {
  await assert.rejects(() => capabilityRecoveryContract(capability(false, 503), "5xx-as-disabled"), {
    code: "ERR_ASSERTION", message: /^temporary capability failure must retry once the 1s delay elapses\b/,
  });
});

test("capability probe counterexample catches abort without a rejecting deadline", async () => {
  await assert.rejects(() => capabilityDeadlineContract(true, "abort-only"), {
    code: "ERR_ASSERTION", message: /^deadline must start a replacement probe despite ignored abort\b/,
  });
});

for (const passiveCleanup of [false, true]) test(`mounted StrictMode replay lets only the latest history load clear loading with ${passiveCleanup ? "passive" : "layout"} cleanup`, async () => {
  const f = await mount({ strict: true, deferHistory: true, durable: true, passiveCleanup });
  try {
    assert.equal(f.host.historyPending.length, 2, "StrictMode actually replays the initial load");
    const [retired, latest] = f.host.historyPending;
    const draft = plain(f.store.getDraft("synthetic-a"));
    assert.equal(f.host.hook.loading, true);
    assert.ok(f.container.querySelector(".chat-session-skeleton"));
    await f.history(retired, [user("retired StrictMode history")], ["retired"]);
    assert.equal(f.host.hook.loading, true, "retired lifecycle cannot clear the replacement's loading state");
    assert.equal(f.host.hook.messages.length, 0);
    await f.history(latest, [user("latest StrictMode history")], ["latest"]);
    assert.equal(f.host.hook.loading, false);
    assert.equal(f.host.hook.error, null);
    assert.equal(f.container.querySelector(".chat-session-skeleton"), null);
    assert.ok(f.container.textContent.includes("latest StrictMode history"));
    assert.ok(!f.container.textContent.includes("retired StrictMode history"));
    f.store.flushDraftNow("synthetic-a");
    assert.deepEqual(f.coldDraft("synthetic-a"), draft);
  } finally { await f.close(); }
});

test("mounted A to B to A keeps the newest history, closes old SSE and preserves each draft", async () => {
  const f = await mount({ durable: true, history: [user("initial A")], ids: ["initial-a"],
    agentState: { running: true, state: { isStreaming: true, clientRequestId: "synthetic-active-a" } } });
  let closed = false;
  try {
    const sameInstance = f.host.hook.sessionIdRef, oldStream = f.events.at(-1);
    assert.ok(oldStream && oldStream.readyState === 1);
    for (const [sid, value] of [["synthetic-a", "A draft\n"], ["synthetic-b", "B draft\n"]]) {
      f.store.setDraft(sid, { value, images: [{ data: "AQID", mimeType: "image/png" }],
        context: { title: sid, reference: `synthetic reference ${sid}` } });
      f.store.flushDraftNow(sid);
    }
    const drafts = ["synthetic-a", "synthetic-b"].map(sid => f.coldDraft(sid));
    f.host.deferHistory = true;
    await f.run(() => f.host.hook.retryLoad());
    await f.switch("synthetic-b");
    assert.equal(oldStream.readyState, 2, "leaving A closes its stream");
    await f.switch("synthetic-a");
    assert.equal(f.host.hook.sessionIdRef, sameInstance, "switch sessions without remounting");
    assert.equal(f.host.historyPending.length, 3);
    const [oldA, oldB, latestA] = f.host.historyPending;
    await f.history(oldB, [user("stale B")], ["old-b"]);
    assert.equal(f.host.hook.loading, true);
    assert.equal(f.host.hook.messages.length, 0);
    await f.history(latestA, [user("latest A history")], ["new-a"]);
    await f.history(oldA, [user("stale first A")], ["old-a"]);
    assert.equal(f.host.hook.loading, false);
    assert.equal(f.host.hook.error, null);
    assert.ok(f.container.textContent.includes("latest A history"));
    assert.ok(!f.container.textContent.includes("stale"));
    assert.equal(f.host.input.draftKey, "synthetic-a");
    const currentStream = f.events.at(-1);
    assert.notEqual(currentStream, oldStream);
    await f.run(() => oldStream.emit({ type: "queue_update", steering: ["stale stream queue"] }));
    assert.deepEqual([...f.host.hook.queuedMessages.steering], []);
    await f.emit({ type: "queue_update", steering: ["current stream queue"] });
    assert.deepEqual([...f.host.hook.queuedMessages.steering], ["current stream queue"]);
    assert.deepEqual(["synthetic-a", "synthetic-b"].map(sid => f.coldDraft(sid)), drafts);
    closed = true; await f.close();
    assert.ok(f.events.every(stream => stream.readyState === 2), "unmount closes every stream");
  } finally { if (!closed) await f.close(); }
});

async function refreshLoadContract(passiveCleanup) {
  const f = await mount({ durable: true, passiveCleanup, history: [user("before refresh")], ids: ["initial"],
    agentState: { running: true, state: { isStreaming: true, clientRequestId: "synthetic-refresh-run" } } });
  try {
    const sameInstance = f.host.hook.sessionIdRef, oldStream = f.events.at(-1);
    const draft = plain(f.store.getDraft("synthetic-a"));
    f.host.deferHistory = true;
    await f.run(() => f.host.hook.retryLoad());
    await f.refresh();
    assert.equal(f.host.hook.sessionIdRef, sameInstance, "Fast Refresh retains the hook's refs");
    assert.equal(oldStream.readyState, 2);
    assert.equal(f.host.historyPending.length, 2);
    const [retired, latest] = f.host.historyPending;
    assert.equal(latest.currentAtStart, true, "the replacement request starts as the loading owner");
    await f.history(retired, [user("retired pre-refresh history")], ["retired"]);
    assert.equal(f.host.hook.loading, true);
    await f.history(latest, [user("latest refreshed history")], ["latest"]);
    assert.equal(f.host.hook.loading, false, "latest lifecycle history must clear loading");
    assert.equal(f.host.hook.error, null);
    assert.equal(f.container.querySelector(".chat-session-skeleton"), null);
    assert.ok(f.container.textContent.includes("latest refreshed history"));
    assert.ok(!f.container.textContent.includes("retired pre-refresh history"));
    f.store.flushDraftNow("synthetic-a");
    assert.deepEqual(f.coldDraft("synthetic-a"), draft);
  } finally { await f.close(); }
}

test("mounted Fast Refresh lets the replacement layout load display history and clear loading", async () => {
  await refreshLoadContract(false);
});

test("passive cleanup counterexample loses the replacement Fast Refresh loading owner", async () => {
  await assert.rejects(() => refreshLoadContract(true), {
    code: "ERR_ASSERTION", message: /^latest lifecycle history must clear loading\b/,
  });
});

for (const stage of ["connection preflight", "intent preflight", "capture", "POST ACK"]) test(`submission reconciliation preserves the mounted request through pending ${stage} and settles after ACK`, async () => {
  const f = await mount({ delayConnection: stage === "connection preflight", durable: true, artifactRefreshOnAgentEnd: true });
  try {
    if (stage === "intent preflight") f.host.intentGate = deferred();
    if (stage === "capture") f.host.captureGate = deferred();
    let acknowledged = false;
    await f.run(() => {
      f.host.sendPromise = f.host.hook.handleSend("花灯班会谁主持，排在第几场？");
      void f.host.sendPromise.then(() => { acknowledged = true; });
    });
    assert.equal(f.host.intents.length, stage === "connection preflight" ? 0 : 1);
    assert.equal(f.host.captures.length, stage.endsWith("preflight") ? 0 : 1);
    assert.equal(f.host.pending.length, stage === "POST ACK" ? 1 : 0);
    const historyReads = f.historyReads().length, stateReads = f.stateReads().length;
    await f.reconcileTriggers();
    assert.equal(f.stateReads().length, stateReads, "no idle GET may start before this submission can ACK");
    assert.equal(f.historyReads().length, historyReads, "idle recovery cannot reload away the optimistic row");
    assert.equal(f.host.hook.messages.length, 1);
    assert.equal(f.host.hook.messages[0].content, "花灯班会谁主持，排在第几场？");
    assert.ok(!f.host.hook.entryIds[0], "the optimistic row has no invented persisted entry");
    assert.equal(f.host.hook.agentRunning, true);
    assert.equal(f.host.hook.streamState.isStreaming, true);
    assert.equal(f.host.completions, 0);
    assert.equal(acknowledged, false);
    let duplicate;
    await f.run(() => { duplicate = f.host.hook.handleSend("a duplicate send must stay blocked"); });
    assert.equal(await duplicate, false);

    if (stage === "connection preflight") await f.emit({ type: "connected" }, null);
    if (stage === "intent preflight") await f.run(() => f.host.intentGate.resolve("ready"));
    if (stage === "capture") await f.run(() => f.host.captureGate.resolve("disabled"));
    assert.equal(f.host.captures.length, 1, "reconciliation never replaces or resubmits the current request");
    assert.equal(f.host.pending.length, 1);
    const requestId = f.host.pending[0].command.clientRequestId;
    assert.equal(requestId, f.host.captures[0].command.clientRequestId);
    assert.equal(requestId, f.host.intents[0].clientRequestId);
    assert.equal(f.store.getDraft("synthetic-a").pendingPrompt.clientRequestId, requestId);
    await f.emit({ type: "agent_start" });
    await f.deliver(user("花灯班会谁主持，排在第几场？"), "source-entry");
    const message = canonical(requestId);
    await f.deliver(message, "answer-entry");
    assert.equal(f.host.hook.messages.length, 2, "the persisted user replaces its optimistic row");
    assert.equal(f.host.hook.messages[1].coreRecallLive?.clientRequestId, requestId);
    assert.match(f.container.querySelector(".core-recall-answer").textContent, /本轮核验/);
    const posts = f.answerPosts().length;
    assert.ok(posts > 0, "the actual Core answer component checked the matching request");
    await f.reconcileTriggers();
    assert.equal(f.stateReads().length, stateReads);
    assert.equal(f.historyReads().length, historyReads);
    assert.equal(f.host.hook.agentRunning, true, "pending POST keeps both the request and SDK stage alive");
    assert.equal(f.host.completions, 0);
    assert.equal(f.host.hook.messages[1].coreRecallLive?.receiptId, message.details.receiptId);
    assert.equal(f.answerPosts().length, posts, "pending idle recovery cannot invalidate or restart the current check");
    assert.equal(f.store.getDraft("synthetic-a").pendingPrompt.clientRequestId, requestId);
    assert.equal(f.host.resolutions.length, 0);
    assert.equal(acknowledged, false);

    await f.run(() => f.host.pending[0].resolve());
    assert.equal(await f.host.sendPromise, true);
    assert.equal(acknowledged, true);
    assert.deepEqual(f.host.resolutions.map(identity => [...identity]), [["synthetic-a", requestId]]);
    assert.ok(!f.store.getDraft("synthetic-a")?.pendingPrompt);
    assert.equal(f.stateReads().length, stateReads, "ACK cannot apply an idle read started during submission");
    assert.equal(f.host.hook.agentRunning, true, "a missing terminal SSE still needs post-ACK recovery");
    await f.event("online");
    assert.equal(f.stateReads().length, stateReads + 1);
    assert.equal(f.historyReads().length, historyReads + 1);
    assert.equal(f.host.hook.agentRunning, false);
    assert.equal(f.host.hook.streamState.isStreaming, false);
    assert.equal(f.host.completions, 1, "post-ACK idle recovery emits exactly one completion");
    assert.deepEqual([...f.host.hook.entryIds], ["source-entry", "answer-entry"]);
    assert.equal(f.host.hook.messages[1].coreRecallLive?.receiptId, message.details.receiptId);
    assert.match(f.container.querySelector(".core-recall-answer").textContent, /本轮核验/);
    for (const request of f.answerPosts()) assert.deepEqual(request.body, {
      sessionId: "synthetic-a", userEntryId: "source-entry", receiptId: message.details.receiptId,
    }, "a settlement recheck stays bound to the same canonical receipt");
    await f.emit({ type: "prompt_done" });
    await f.emit({ type: "message_start", message: assistant() });
    assert.equal(f.host.completions, 1);
    assert.equal(f.host.hook.streamState.isStreaming, false, "late terminal/stream packets cannot restart a settled run");
  } finally { await f.close(); }
});

test("submission reconciliation cannot apply a pre-ACK idle snapshot after the ACK arrives", async () => {
  const f = await mount({ artifactRefreshOnAgentEnd: true });
  try {
    const requestId = await f.send();
    await f.emit({ type: "agent_start" });
    const idleGate = deferred();
    f.host.agentGate = idleGate;
    const stateReads = f.stateReads().length, historyReads = f.historyReads().length;
    await f.event("online");
    await f.run(() => f.host.pending[0].resolve());
    assert.equal(await f.host.sendPromise, true);
    await f.deliver(user("花灯班会谁主持，排在第几场？"), "source-entry");
    const message = canonical(requestId);
    await f.deliver(message, "answer-entry");
    f.host.agentGate = null;
    await f.run(() => idleGate.resolve({ running: false, state: { isStreaming: false, isPromptRunning: false } }));
    assert.equal(f.host.hook.agentRunning, true, "an idle snapshot from before ACK cannot settle the accepted run");
    assert.equal(f.host.completions, 0);
    assert.equal(f.historyReads().length, historyReads);
    assert.equal(f.stateReads().length, stateReads, "submission must prevent the stale GET from being started");
    assert.equal(f.host.hook.messages[1].coreRecallLive?.clientRequestId, requestId);
    assert.match(f.container.querySelector(".core-recall-answer").textContent, /本轮核验/);

    await f.emit({ type: "agent_settled" });
    assert.equal(f.host.hook.agentRunning, true, "SDK settlement alone cannot finish the RPC prompt");
    assert.equal(f.host.completions, 0);
    await f.emit({ type: "prompt_done" });
    assert.equal(f.host.hook.agentRunning, false);
    assert.equal(f.host.completions, 1, "the matching terminal SSE still finishes normally");
    assert.equal(f.host.hook.messages[1].coreRecallLive?.receiptId, message.details.receiptId);
    await f.emit({ type: "agent_settled" });
    await f.emit({ type: "prompt_done" });
    assert.equal(f.host.completions, 1, "replayed terminal SSE cannot notify twice");
  } finally { await f.close(); }
});

test("submission reconciliation discards an old idle GET after a new mounted request starts", async () => {
  const f = await mount({ artifactRefreshOnAgentEnd: true });
  try {
    const oldRequest = await f.send("first synthetic request");
    await f.deliver(user("first synthetic request"), "old-user");
    await f.run(() => f.host.pending[0].resolve());
    const idleGate = deferred();
    f.host.agentGate = idleGate;
    const stateReads = f.stateReads().length;
    await f.event("online");
    assert.equal(f.stateReads().length, stateReads + 1, "the old idle GET is actually in flight");
    await f.emit({ type: "prompt_done" }, oldRequest);
    assert.equal(f.host.hook.agentRunning, false);
    assert.equal(f.host.completions, 1);

    const requestId = await f.send();
    assert.notEqual(requestId, oldRequest);
    await f.emit({ type: "agent_start" });
    await f.emit({ type: "queue_update", steering: ["new run queue"], followUp: [] });
    const historyReads = f.historyReads().length;
    f.host.agentGate = null;
    await f.run(() => idleGate.resolve({ running: false, state: {
      isStreaming: false, isPromptRunning: false, queuedMessages: { steering: ["old run queue"], followUp: [] },
    } }));
    assert.equal(f.historyReads().length, historyReads, "an old GET cannot start a new run's history settlement");
    assert.equal(f.host.hook.agentRunning, true);
    assert.equal(f.host.completions, 1);
    assert.deepEqual([...f.host.hook.queuedMessages.steering], ["new run queue"], "stale state cannot overwrite the new run's queue");
    assert.equal(f.host.hook.messages.length, 2);
    assert.ok(!f.host.hook.entryIds[1], "the new optimistic row survives the old idle response");
    await f.deliver(user("花灯班会谁主持，排在第几场？"), "source-entry");
    const message = canonical(requestId);
    await f.deliver(message, "new-answer");
    assert.equal(f.host.hook.messages.at(-1).coreRecallLive?.clientRequestId, requestId);
    assert.match(f.container.querySelector(".core-recall-answer").textContent, /本轮核验/);
    await f.run(() => f.host.pending[1].resolve());
    await f.event("online");
    assert.equal(f.host.hook.agentRunning, false);
    assert.equal(f.host.completions, 2);
    const messages = f.host.hook.messages.length;
    await f.emit({ type: "prompt_done" }, oldRequest);
    await f.emit({ type: "message_end", message: assistant([{ type: "text", text: "stale answer" }]), entryId: "old-late" }, oldRequest);
    assert.equal(f.host.hook.messages.length, messages);
    assert.equal(f.host.completions, 2);
    assert.equal(f.host.hook.messages.at(-1).coreRecallLive?.receiptId, message.details.receiptId);
  } finally { await f.close(); }
});

// Execute the actual callback declarations, with history IO and close timers at
// the boundary. The mounted cases above verify React effects and Core UI wiring.
function finisherHarness({ submitting = false } = {}) {
  const source = ts.createSourceFile("useAgentSession.ts", sources.hook, ts.ScriptTarget.Latest, true);
  const hook = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "useAgentSession");
  const names = new Set(["retirePromptRequest", "settleUiStage", "notifyPromptStage", "finishPromptWithoutStream"]);
  const callbacks = hook.body.statements.filter(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(item => names.has(item.name.getText(source))));
  assert.equal(callbacks.length, names.size, "all tested callbacks come from the actual hook");
  const state = { reads: 0, completions: 0, running: true, ends: 0, closes: [], gate: null };
  const context = {
    exports: {}, useCallback: callback => callback,
    sessionIdRef: { current: "synthetic-a" }, promptRunIdRef: { current: 1 },
    promptSubmissionRunIdRef: { current: submitting ? 1 : null },
    promptRequestIdRef: { current: "synthetic-request" }, completedPromptRequestIdsRef: { current: new Set() },
    notifiedPromptRunIdRef: { current: -1 }, agentRunningRef: { current: true },
    rpcPromptPendingRef: { current: true }, sdkAgentActiveRef: { current: true },
    loadSession: async () => { state.reads++; if (state.gate) await state.gate.promise; },
    setAgentRunning: value => { state.running = value; }, setAgentPhase: noop, setRetryInfo: noop,
    dispatch: action => { if (action.type === "end") state.ends++; },
    onAgentEnd: () => { state.completions++; }, scheduleEventStreamClose: sid => state.closes.push(sid),
  };
  vm.runInNewContext(ts.transpileModule(callbacks.map(node => node.getText(source)).join("\n")
    + "\nexports.finish = finishPromptWithoutStream;", {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  return { context, state, finish: context.exports.finish, snapshot: () => ({
    reads: state.reads, completions: state.completions, running: state.running, ends: state.ends,
    closes: [...state.closes], rpcPending: context.rpcPromptPendingRef.current,
    sdkActive: context.sdkAgentActiveRef.current, retired: [...context.completedPromptRequestIdsRef.current],
    agentRunning: context.agentRunningRef.current,
  }) };
}

test("submission finisher rejects pending work before history IO without clearing RPC/SDK or notifying", async () => {
  const f = finisherHarness({ submitting: true }), before = f.snapshot();
  await f.finish("synthetic-a", 1);
  assert.deepEqual(f.snapshot(), before);
});

test("submission finisher rechecks pending work in finally after awaited history IO", async () => {
  const f = finisherHarness();
  f.state.gate = deferred();
  const before = f.snapshot(), pending = f.finish("synthetic-a", 1);
  assert.equal(f.state.reads, 1);
  f.context.promptSubmissionRunIdRef.current = 1;
  f.state.gate.resolve();
  await pending;
  assert.deepEqual(f.snapshot(), { ...before, reads: 1 }, "a pending submission cannot be retired, notified or have its flags cleared in finally");
});

for (const boundary of ["entry", "finally"]) test(`submission finisher drops a previous run at ${boundary} without changing the new run`, async () => {
  const f = finisherHarness();
  f.state.gate = deferred();
  let pending;
  if (boundary === "finally") pending = f.finish("synthetic-a", 1);
  f.context.promptRunIdRef.current = 2;
  f.context.promptSubmissionRunIdRef.current = 2;
  f.context.promptRequestIdRef.current = "new-request";
  const before = f.snapshot();
  if (boundary === "entry") pending = f.finish("synthetic-a", 1);
  f.state.gate.resolve();
  await pending;
  assert.deepEqual(f.snapshot(), before);
});

test("streamed canonical text and both citations remain visible as the final answer through settlement reload", async () => {
  const f = await mount();
  try {
    await f.answer();
    await f.deliver({ role: "toolResult", toolCallId: "recall", content: [{ type: "text", text: "ordinary tool result" }] }, "tool");
    await f.deliver(assistant([], { stopReason: "error" }), "sdk-abort");
    const body = f.container.querySelector(".core-recall-answer");
    assert.ok(body);
    assert.equal(body.children[1].textContent, text);
    assert.equal(body.querySelectorAll("[data-markdown],strong").length, 0, "Core text is never regenerated or parsed as Markdown");
    assert.equal(body.querySelector("details").hasAttribute("open"), true);
    assert.deepEqual([...body.querySelectorAll("blockquote")].map(node => node.textContent), [
      "花灯班会由张老师主持。", "花灯班会排在第二场。",
    ]);
    assert.match(body.textContent, /本轮核验/);
    assert.doesNotMatch(f.container.textContent, /Unknown provider error/);
    assert.ok(f.answerPosts().length > 0, "current requires a server recheck");
    await f.finish();
    assert.match(f.container.textContent, /本轮核验/);
    assert.ok(f.host.hook.messages.find(item => item.role === "custom").coreRecallLive);
    assert.equal(f.host.histories.get("synthetic-a").messages.find(item => item.role === "custom").coreRecallLive, undefined);
  } finally { await f.close(); }
});

for (const order of ["before", "after"]) test(`SDK empty abort ${order} custom preserves the exact answer before POST ACK and settlement`, async () => {
  const f = await mount();
  try {
    const requestId = await f.send();
    let acknowledged = false;
    void f.host.sendPromise.then(() => { acknowledged = true; });
    await f.deliver(user("花灯班会谁主持，排在第几场？"), "source-entry");
    const abort = assistant([], { stopReason: "error", errorMessage: "This operation was aborted" });
    if (order === "before") await f.deliver(abort, "sdk-abort");
    const message = canonical(requestId);
    await f.deliver(message, "sdk-custom-entry");
    if (order === "after") await f.deliver(abort, "sdk-abort");

    const body = f.container.querySelector(".core-recall-answer");
    assert.ok(body);
    assert.equal(body.children[1].textContent, text);
    assert.equal(body.querySelectorAll("[data-markdown],strong").length, 0);
    assert.deepEqual([...body.querySelectorAll("blockquote")].map(node => node.textContent),
      message.details.sources.map(source => source.content));
    assert.match(body.querySelector('[role="status"]').textContent, /本轮核验/);
    assert.equal(f.container.querySelector('[role="alert"]'), null, "only the precise empty SDK terminator is hidden");
    assert.equal(acknowledged, false, "the canonical answer is usable while the prompt POST is still pending");
    assert.ok(f.answerPosts().length > 0, "current always requires a complete state POST");
    for (const request of f.answerPosts()) assert.deepEqual(request.body, {
      sessionId: "synthetic-a", userEntryId: "source-entry", receiptId: message.details.receiptId,
    });
    const customIndex = f.host.hook.messages.findIndex(item => item.role === "custom");
    assert.equal(f.host.hook.entryIds[customIndex], "sdk-custom-entry", "custom uses its own persisted entry identity");
    const beforeReplay = f.host.hook.messages.length;
    const postsBeforeReplay = f.answerPosts().length;
    await f.emit({ type: "message_end", message, entryId: "sdk-custom-entry", messageId: "sdk-custom-entry" });
    assert.equal(f.host.hook.messages.length, beforeReplay, "the same custom entry cannot be appended twice");
    assert.equal(f.answerPosts().length, postsBeforeReplay, "an identical SSE replay cannot restart verification");

    await f.deliver(assistant([], { stopReason: "error", errorMessage: "synthetic provider 429" }), "provider-error");
    assert.match(f.container.querySelector('[role="alert"]').textContent, /synthetic provider 429/);
    assert.doesNotMatch(f.container.textContent, /This operation was aborted|Unknown provider error/);
    assert.match(body.textContent, /本轮核验/);
    assert.equal(acknowledged, false);
    await f.finish();
    assert.equal(acknowledged, true);
    assert.match(f.container.querySelector(".core-recall-answer").textContent, /本轮核验/);
    assert.match(f.container.querySelector('[role="alert"]').textContent, /synthetic provider 429/);
  } finally { await f.close(); }
});

for (const matches of [true, false]) test(`fast custom waits for ${matches ? "matching" : "mismatched"} actual user identity before a state POST`, async () => {
  const f = await mount();
  try {
    const requestId = await f.send();
    const message = canonical(requestId);
    await f.emit({ type: "message_end", message, entryId: "sdk-custom-entry", messageId: "sdk-custom-entry" });
    assert.equal(f.answerPosts().length, 0, "an optimistic user without a persisted entry cannot authorize a state read");
    assert.doesNotMatch(f.container.textContent, /本轮核验/);
    await f.deliver(user("花灯班会谁主持，排在第几场？"), matches ? "source-entry" : "unrelated-user-entry");
    assert.equal(f.answerPosts().length, matches ? 1 : 0);
    if (matches) {
      assert.deepEqual(f.answerPosts()[0].body, {
        sessionId: "synthetic-a", userEntryId: "source-entry", receiptId: message.details.receiptId,
      });
      assert.match(f.container.querySelector(".core-recall-answer").textContent, /本轮核验/);
    } else assert.doesNotMatch(f.container.textContent, /本轮核验/);
  } finally { await f.close(); }
});

test("ordinary tool success and persisted true flags cannot establish current verification", async () => {
  const message = canonical();
  message.coreRecallLive = { receiptId: message.details.receiptId, clientRequestId: message.details.clientRequestId };
  const f = await mount({ history: [user("谁主持？"), message, assistant([], { stopReason: "error" })], ids: ["source-entry", "answer", "abort"] });
  try {
    assert.match(f.container.textContent, /历史回答，未重新核验/);
    assert.equal(f.answerPosts().length, 0);
    assert.equal(f.host.hook.messages[1].coreRecallLive, undefined);
    await f.run(() => { void f.host.hook.retryLoad(); });
    assert.equal(f.answerPosts().length, 0, "historical rereads never upgrade to current");
  } finally { await f.close(); }
  const ordinary = await mount({ history: [user("谁主持？"), assistant([{ type: "toolCall", toolCallId: "old", toolName: "memory_recall", input: {} }]),
    { role: "toolResult", toolCallId: "old", content: [], details: { ok: true, answer_verified: true } },
    assistant([{ type: "text", text: "张老师" }])], ids: ["u", "a", "t", "final"] });
  try { assert.doesNotMatch(ordinary.container.textContent, /本轮核验/); assert.equal(ordinary.answerPosts().length, 0); }
  finally { await ordinary.close(); }
});

for (const status of ["current", "held", "historical"]) test(`historical true flags require an explicit state POST and its ${status} result is respected`, async () => {
  const message = canonical();
  message.coreRecallLive = { receiptId: message.details.receiptId, clientRequestId: message.details.clientRequestId };
  const f = await mount({ history: [user("谁主持？"), message], ids: ["source-entry", "historical-custom"] });
  try {
    assert.match(f.container.querySelector(".core-recall-answer").textContent, /历史回答，未重新核验/);
    assert.equal(f.answerPosts().length, 0);
    assert.equal(f.host.hook.messages[1].coreRecallLive, undefined, "persisted true flags and forged live authority are ignored");
    f.host.answerGate = deferred();
    await f.recheck();
    assert.match(f.container.querySelector(".core-recall-answer").textContent, /核验中/);
    assert.doesNotMatch(f.container.textContent, /本轮核验/);
    assert.deepEqual(f.answerPosts().map(item => item.body), [{
      sessionId: "synthetic-a", userEntryId: "source-entry", receiptId: message.details.receiptId,
    }]);
    assert.equal(f.answerPosts()[0].signal.aborted, false);
    await f.run(() => f.host.answerGate.resolve({ version: 1, status, reasonCode: status === "held" ? "source_changed" : null }));
    const body = f.container.querySelector(".core-recall-answer");
    if (status === "current") assert.match(body.querySelector('[role="status"]').textContent, /本轮核验/);
    else assert.doesNotMatch(body.textContent, /本轮核验/);
    assert.ok([...body.children].some(node => node.textContent === text), "manual verification preserves the canonical text verbatim");
    assert.equal(f.answerPosts().length, 1, "reading the result never posts a second request");
    assert.equal(f.host.hook.messages[1].coreRecallLive, undefined, "manual verification does not forge hook delivery authority");
  } finally { await f.close(); }
});

for (const invalidate of ["source", "blur", "hidden"]) test(`historical recheck cannot regain current from a late reply after ${invalidate}`, async () => {
  const message = canonical();
  const f = await mount({ history: [user("谁主持？"), message], ids: ["source-entry", "historical-custom"] });
  try {
    f.host.answerGate = deferred();
    await f.recheck();
    const request = f.answerPosts()[0];
    assert.equal(request.signal.aborted, false);
    if (invalidate === "source") await f.event("edupi-facts-updated");
    if (invalidate === "blur") { await f.blur(); await f.focus(); }
    if (invalidate === "hidden") { await f.hidden(true); await f.hidden(false); }
    assert.equal(request.signal.aborted, true, "leaving the checked source or active view retires the pending request");
    await f.run(() => f.host.answerGate.resolve({ version: 1, status: "current", reasonCode: null }));
    assert.doesNotMatch(f.container.textContent, /本轮核验/);
    assert.equal(f.answerPosts().length, 1, "source events and returning to the page never recheck automatically");
    assert.ok(f.host.hook.messages.every(item => !item.coreRecallLive));
  } finally { await f.close(); }
});

test("a streamed custom with a mismatched session, user entry or request cannot obtain current authority", async () => {
  for (const field of ["sessionId", "userEntryId", "clientRequestId"]) {
    const f = await mount();
    try {
      const request = await f.send();
      await f.deliver(user("花灯班会谁主持，排在第几场？"), "source-entry");
      const message = canonical(request);
      message.details[field] = "synthetic-unrelated-identity";
      await f.deliver(message, "wrong-identity");
      assert.doesNotMatch(f.container.textContent, /本轮核验/, field);
      assert.ok(f.host.hook.messages.every(item => !item.coreRecallLive), field);
      assert.equal(f.answerPosts().length, 0, field);
    } finally { await f.close(); }
  }
});

test("explicit provider errors remain visible with or without a canonical answer", async () => {
  for (const withCore of [true, false]) {
    const messages = [user("谁主持？"), ...(withCore ? [canonical()] : []), assistant([], { stopReason: "error", errorMessage: "synthetic provider 429" })];
    const f = await mount({ history: messages, ids: ["source-entry", ...(withCore ? ["answer"] : []), "failure"] });
    try { assert.match(f.container.querySelector('[role="alert"]').textContent, /synthetic provider 429/); }
    finally { await f.close(); }
  }
});

test("cancel revokes a delivered receipt and rejects its replay in the same run", async () => {
  const f = await mount();
  try {
    const message = await f.answer(); assert.match(f.container.textContent, /本轮核验/);
    await f.run(() => { void f.host.hook.handleAbort(); });
    await f.deliver(message, "replayed-custom");
    assert.doesNotMatch(f.container.textContent, /本轮核验/);
    assert.ok(f.host.hook.messages.filter(item => item.role === "custom").every(item => !item.coreRecallLive));
  } finally { await f.close(); }
});

test("identical new prompts reject old SSE and receipts, and accept only the new run's canonical delivery", async () => {
  const f = await mount();
  try {
    const old = await f.answer(); await f.finish();
    const requestId = await f.send();
    const before = f.host.hook.messages.length;
    await f.emit({ type: "message_end", message: old, entryId: "late-old" }, old.details.clientRequestId);
    assert.equal(f.host.hook.messages.length, before);
    await f.deliver(user("花灯班会谁主持，排在第几场？"), "second-user");
    await f.deliver(canonical(requestId, "second-user", old.details.receiptId), "reused-receipt");
    assert.doesNotMatch(f.container.textContent, /本轮核验/);
    await f.deliver(canonical(requestId, "second-user", "22222222-2222-2222-2222-222222222222"), "new-answer");
    assert.equal(f.host.hook.messages.at(-1).coreRecallLive?.clientRequestId, requestId);
    assert.match([...f.container.querySelectorAll(".core-recall-answer")].at(-1).textContent, /本轮核验/);
  } finally { await f.close(); }
});

test("A to B to A session generations and a late old stream never restore live authority", async () => {
  const f = await mount();
  try {
    const old = await f.answer(), source = f.events.at(-1);
    await f.switch("synthetic-b"); await f.switch("synthetic-a");
    await f.run(() => source.emit({ type: "message_end", message: old, clientRequestId: old.details.clientRequestId, entryId: "late-old" }));
    assert.doesNotMatch(f.container.textContent, /本轮核验/);
    assert.ok(f.host.hook.messages.every(item => !item.coreRecallLive));
  } finally { await f.close(); }
});

test("settlement artifact refresh preserves a live answer while a real artifact update revokes it", async () => {
  const f = await mount({ artifactRefreshOnAgentEnd: true });
  try {
    const message = await f.answer();
    assert.match(f.container.querySelector(".core-recall-answer").textContent, /本轮核验/);
    await f.finish();
    assert.equal(f.host.completions, 1, "the mounted send lifecycle actually dispatched the refresh-only completion event");
    assert.match(f.container.querySelector(".core-recall-answer").textContent, /本轮核验/);
    assert.equal(f.host.hook.messages.find(item => item.role === "custom").coreRecallLive?.receiptId, message.details.receiptId);
    const posts = f.answerPosts().length;
    await f.event("edupi-artifacts-updated", { refreshOnly: true });
    assert.match(f.container.querySelector(".core-recall-answer").textContent, /本轮核验/);
    assert.equal(f.answerPosts().length, posts, "a pure file-panel refresh never restarts answer verification");

    await f.event("edupi-artifacts-updated");
    assert.doesNotMatch(f.container.textContent, /本轮核验/);
    assert.ok(f.host.hook.messages.every(item => !item.coreRecallLive), "a real artifact write still revokes runtime authority");
    await f.focus();
    assert.doesNotMatch(f.container.textContent, /本轮核验/);
    assert.equal(f.answerPosts().length, posts, "returning to the page cannot revive a receipt invalidated by a write");
  } finally { await f.close(); }
});

test("only explicit artifact refreshOnly true bypasses source invalidation", async () => {
  for (const [name, detail] of [
    ["edupi-artifacts-updated", { refreshOnly: false }],
    ["edupi-artifacts-updated", { refreshOnly: "true" }],
    ["edupi-facts-updated", { refreshOnly: true }],
    ["edupi-student-records-updated", { refreshOnly: true }],
    ["edupi-education-refresh", { refreshOnly: true }],
    ["edupi-core-recall-invalidated", { refreshOnly: true }],
  ]) {
    const f = await mount();
    try {
      await f.answer();
      assert.match(f.container.querySelector(".core-recall-answer").textContent, /本轮核验/);
      await f.event(name, detail);
      assert.doesNotMatch(f.container.textContent, /本轮核验/, `${name} ${JSON.stringify(detail)}`);
      assert.ok(f.host.hook.messages.every(item => !item.coreRecallLive), name);
      assert.equal(f.answerPosts().length, 1, `${name} cannot schedule an automatic recheck`);
    } finally { await f.close(); }
  }
});

for (const invalidate of ["source", "blur", "hidden"]) test(`${invalidate} revokes verification and a late current reply cannot restore it`, async () => {
  const f = await mount();
  try {
    f.host.answerGate = deferred();
    await f.answer();
    if (invalidate === "source") await f.event("edupi-facts-updated");
    if (invalidate === "blur") { await f.blur(); await f.focus(); }
    if (invalidate === "hidden") { await f.hidden(true); await f.hidden(false); }
    await f.run(() => f.host.answerGate.resolve({ version: 1, status: "current", reasonCode: null }));
    assert.doesNotMatch(f.container.textContent, /本轮核验/);
    assert.ok(f.host.hook.messages.every(item => !item.coreRecallLive));
    assert.equal(f.answerPosts().length, 1, "revocation never schedules an automatic recheck");
  } finally { await f.close(); }
});

for (const delivery of ["history", "live"]) test(`an already expired ${delivery} answer cannot become current or be rechecked`, async () => {
  const now = Date.parse("2026-11-17T00:00:00.000Z");
  const message = canonical();
  message.details.answer.valid_until = new Date(now - 1).toISOString();
  const f = await mount({ now, ...(delivery === "history" ? {
    history: [user("谁主持？"), message], ids: ["source-entry", "expired-custom"],
  } : {}) });
  try {
    if (delivery === "live") {
      f.host.answerGate = deferred();
      message.details.clientRequestId = await f.send();
      await f.deliver(user("谁主持？"), "source-entry");
      await f.deliver(message, "expired-custom");
      await f.run(() => f.host.answerGate.resolve({ version: 1, status: "current", reasonCode: null }));
    }
    const body = f.container.querySelector(".core-recall-answer"), button = body.querySelector("button");
    assert.doesNotMatch(body.textContent, /本轮核验/);
    assert.equal(button?.textContent, "重新核对");
    assert.equal(button.disabled, true);
    const posts = f.answerPosts().length;
    await f.run(() => propsOf(button).onClick());
    assert.equal(f.answerPosts().length, posts, "even a stale click handler cannot post an expired receipt");
    if (delivery === "live") await f.finish();
    else await f.run(() => { void f.host.hook.retryLoad(); });
    assert.doesNotMatch(f.container.textContent, /本轮核验/);
    assert.equal(f.answerPosts().length, posts, "history reload cannot revive an expired receipt");
  } finally { await f.close(); }
});

test("valid_until revokes a current answer at its deadline and rejects replay and manual upgrade", async () => {
  const now = Date.parse("2026-11-17T00:00:00.000Z");
  const f = await mount({ now });
  try {
    const message = canonical(await f.send());
    message.details.answer.valid_until = new Date(now + 1_000).toISOString();
    await f.deliver(user("谁主持？"), "source-entry");
    await f.deliver(message, "expiring-custom");
    assert.match(f.container.querySelector(".core-recall-answer").textContent, /本轮核验/);
    await f.advance(999);
    assert.match(f.container.querySelector(".core-recall-answer").textContent, /本轮核验/);
    await f.advance(1);
    assert.doesNotMatch(f.container.textContent, /本轮核验/);
    assert.ok(f.host.hook.messages.every(item => !item.coreRecallLive), "expiry also retires live hook authority");
    const button = f.container.querySelector(".core-recall-answer button");
    assert.equal(button.disabled, true);
    await f.run(() => propsOf(button).onClick());
    await f.deliver(message, "expired-replay");
    await f.finish();
    assert.doesNotMatch(f.container.textContent, /本轮核验/);
    assert.equal(f.answerPosts().length, 1, "expiry, replay and settlement never recheck an expired receipt");
  } finally { await f.close(); }
});

test("valid_until discards a pending periodic current reply and never schedules another upgrade", async () => {
  const now = Date.parse("2026-11-17T00:00:00.000Z");
  const f = await mount({ now });
  try {
    const message = canonical(await f.send());
    message.details.answer.valid_until = new Date(now + 6_000).toISOString();
    await f.deliver(user("谁主持？"), "source-entry");
    await f.deliver(message, "expiring-custom");
    assert.match(f.container.querySelector(".core-recall-answer").textContent, /本轮核验/);
    f.host.answerGate = deferred();
    await f.advance(5_000);
    assert.equal(f.answerPosts().length, 2);
    assert.match(f.container.querySelector(".core-recall-answer").textContent, /核验中/);
    const pending = f.answerPosts()[1];
    assert.equal(pending.signal.aborted, false);
    await f.advance(1_000);
    assert.equal(pending.signal.aborted, true);
    await f.run(() => f.host.answerGate.resolve({ version: 1, status: "current", reasonCode: null }));
    await f.finish();
    await f.advance(5_000);
    assert.doesNotMatch(f.container.textContent, /本轮核验/);
    assert.equal(f.container.querySelector(".core-recall-answer button").disabled, true);
    assert.ok(f.host.hook.messages.every(item => !item.coreRecallLive));
    assert.equal(f.answerPosts().length, 2, "a late current reply cannot schedule periodic verification after expiry");
  } finally { await f.close(); }
});

test("a held server recheck permanently downgrades that receipt through another history reload", async () => {
  const f = await mount();
  try {
    await f.answer();
    f.host.answer = { version: 1, status: "held", reasonCode: "source_changed" };
    await f.expire(5_000);
    assert.doesNotMatch(f.container.textContent, /本轮核验/);
    assert.ok(f.host.hook.messages.every(item => !item.coreRecallLive), "a held response retires runtime authority too");
    f.host.answer = { version: 1, status: "current", reasonCode: null };
    await f.emit({ type: "agent_end" });
    assert.doesNotMatch(f.container.textContent, /本轮核验/);
  } finally { await f.close(); }
});

test("a stalled backend recheck expires the old green state before its response arrives", async () => {
  const f = await mount();
  try {
    await f.answer();
    assert.match(f.container.textContent, /本轮核验/);
    f.host.answerGate = deferred();
    await f.expire(5_000);
    assert.doesNotMatch(f.container.textContent, /本轮核验/);
    assert.match(f.container.textContent, /核验中/);
    await f.run(() => f.host.answerGate.resolve({ version: 1, status: "held", reasonCode: "source_changed" }));
    assert.doesNotMatch(f.container.textContent, /本轮核验/);
    assert.ok(f.host.hook.messages.every(item => !item.coreRecallLive));
  } finally { await f.close(); }
});

test("a changed canonical payload under the same receipt revokes live authority permanently", async () => {
  const f = await mount();
  try {
    const original = await f.answer();
    const changed = structuredClone(original);
    changed.content += "\n历史正文发生修订";
    changed.details.answer.text = changed.content;
    f.host.histories.set("synthetic-a", { messages: [user("花灯班会谁主持，排在第几场？"), changed], entryIds: ["source-entry", "answer"] });
    await f.emit({ type: "agent_end" });
    assert.doesNotMatch(f.container.textContent, /本轮核验/);
    assert.ok(f.host.hook.messages.every(item => !item.coreRecallLive));
    f.host.histories.set("synthetic-a", { messages: [user("花灯班会谁主持，排在第几场？"), original], entryIds: ["source-entry", "answer"] });
    await f.emit({ type: "agent_end" });
    assert.doesNotMatch(f.container.textContent, /本轮核验/);
  } finally { await f.close(); }
});

test("person reads require a human click and a name in that exact earlier user source; CAS revision zero can confirm once", async () => {
  const f = await mount({ history: [user("花灯班会由张老师和李老师准备。"), user("谁主持？", 2)], ids: ["earlier-source", "later-question"] });
  try {
    assert.equal(f.personPosts().length, 0);
    const source = f.person();
    await source.click("人物"); await source.type("张老师");
    assert.equal(f.personPosts().length, 0, "opening and typing never reads or confirms");
    await source.read();
    assert.deepEqual(f.personPosts()[0].body, { action: "read", sessionId: "synthetic-a", entryId: "earlier-source", personName: "张老师" });
    assert.ok(source.button("确认人物"), "revision 0 is a valid preview");
    await source.click("确认人物", true);
    assert.equal(f.personPosts().length, 2);
    assert.deepEqual(f.personPosts()[1].body, { action: "confirm", sessionId: "synthetic-a", entryId: "earlier-source", personName: "张老师", previewId: "preview-zero" });
    assert.match(source.node.textContent, /已确认：张老师/);
    const question = f.person(1); await question.click("人物"); await question.type("张老师");
    assert.equal(question.button("核对").disabled, true);
    await question.read(); assert.equal(f.personPosts().length, 2, "a later unnamed question cannot replace the real source");
  } finally { await f.close(); }
});

test("person name changes, cancel, context switch and source changes discard late preview and confirmation receipts", async () => {
  for (const boundary of ["name", "cancel", "session", "source", "run"]) {
    const f = await mount({ history: [user("张老师和李老师准备。")], ids: ["source"] });
    try {
      const person = f.person(); await person.click("人物"); await person.type("张老师");
      f.host.personGate = deferred(); await person.read();
      if (boundary === "name") await person.type("李老师");
      if (boundary === "cancel") await person.click("取消");
      if (boundary === "session") await f.switch("synthetic-b");
      if (boundary === "source") await f.event("edupi-facts-updated");
      if (boundary === "run") await f.send();
      await f.run(() => f.host.personGate.resolve(personState()));
      assert.ok(![...f.container.querySelectorAll("button")].some(node => node.textContent === "确认人物"), boundary);
      assert.equal(f.personPosts().length, 1);
    } finally { await f.close(); }
  }
  const f = await mount({ history: [user("张老师准备。")], ids: ["source"] });
  try {
    const person = f.person(); await person.click("人物"); await person.type("张老师"); await person.read();
    f.host.personGate = deferred(); await person.click("确认人物", true);
    assert.equal(f.personPosts().length, 2);
    await person.click("取消");
    await f.run(() => f.host.personGate.resolve(personState({ status: "confirmed", factWrite: true })));
    assert.doesNotMatch(f.container.textContent, /已确认/);
  } finally { await f.close(); }
});

test("a stale confirm handler cannot write after the name changes in the same event batch", async () => {
  const f = await mount({ history: [user("张老师和李老师准备。")], ids: ["source"] });
  try {
    const person = f.person(); await person.click("人物"); await person.type("张老师"); await person.read();
    const confirm = propsOf(person.button("确认人物")).onClick;
    await f.run(() => {
      propsOf(person.node.querySelector("input")).onChange({ target: { value: "李老师" } });
      confirm();
    });
    assert.equal(f.personPosts().length, 1);
    assert.equal(person.button("确认人物"), undefined);
  } finally { await f.close(); }
});

test("an interrupted confirm shows an unknown result and needs a new explicit read", async () => {
  const f = await mount({ history: [user("张老师准备。")], ids: ["source"] });
  try {
    const person = f.person(); await person.click("人物"); await person.type("张老师"); await person.read();
    f.host.personGate = deferred(); await person.click("确认人物");
    await f.run(() => f.host.personGate.reject(new Error("synthetic interrupted confirmation")));
    assert.match(person.node.querySelector('[role="alert"]').textContent, /确认结果待核对/);
    assert.equal(person.button("确认人物"), undefined);
    await f.flush(); assert.equal(f.personPosts().length, 2);
  } finally { await f.close(); }
});

for (const [factWrite, reasonCode, expected] of [
  [true, "source_changed", "已保存，但来源已变化"], [null, "confirmation_unknown", "确认结果待核对"],
]) test(`held confirmation with factWrite ${factWrite} reports its actual write state without retry`, async () => {
  const f = await mount({ history: [user("张老师准备。")], ids: ["source"] });
  try {
    f.host.confirm = personState({ status: "held", factWrite, reasonCode });
    const person = f.person(); await person.click("人物"); await person.type("张老师"); await person.read(); await person.click("确认人物");
    assert.ok(person.node.querySelector('[role="alert"]').textContent.includes(expected));
    assert.doesNotMatch(person.node.textContent, /未保存|未写/);
    await f.flush(); assert.equal(f.personPosts().length, 2);
  } finally { await f.close(); }
});

test("disabled R04 or non-EduPi mode exposes no person action or read", async () => {
  for (const props of [{ enabled: false }, { teacherMode: false }]) {
    const f = await mount({ ...props, history: [user("张老师准备。")], ids: ["source"] });
    try {
      assert.equal(f.container.querySelector(".core-recall-person"), null);
      assert.equal(f.personPosts().length, 0);
      if (props.teacherMode === false) assert.equal(f.requests.filter(item => item.url.endsWith("answer-state")).length, 0);
    } finally { await f.close(); }
  }
});
