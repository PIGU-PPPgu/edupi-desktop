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

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const pure = {};
for (const name of ["edupi-composer-context", "image-attachments", "file-fuzzy", "tool-presets", "normalize",
  "scroll-memory", "streaming-message", "agent-message-history", "ansi", "terminal-input", "message-display",
  "chat-file-drop", "chat-lazy-load", "edupi-calendar-result"]) pure[`@/lib/${name}`] = await jiti.import(`../lib/${name}.ts`);
const sources = Object.fromEntries(["ChatInput", "ChatWindow"].map(name => [name, fs.readFileSync(new URL(`./${name}.tsx`, import.meta.url), "utf8")]));
sources.useAgentSession = fs.readFileSync(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
sources.drafts = fs.readFileSync(new URL("../lib/draft-store.ts", import.meta.url), "utf8");
const compile = source => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;
const noop = () => {};
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const cwd = "/synthetic/UI-Test-Data";
const createdId = "synthetic-created-session";
const session = (id = "synthetic-existing", directory = cwd) => ({ id, cwd: directory, path: "", created: "2026-10-28T00:00:00Z", modified: "2026-10-28T00:00:00Z", messageCount: 0, firstMessage: "" });
const text = "[UI TEST] 合成发送";

async function mount({ existing = false, durable = true, immediate = false, delayStartup = false } = {}) {
  const { window } = parseHTML("<html><body><div id='root'></div></body></html>");
  const globals = Object.fromEntries(["window", "document", "HTMLElement", "IS_REACT_ACT_ENVIRONMENT"].map(name => [name, globalThis[name]]));
  Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  window.HTMLElement.prototype.scrollIntoView = noop;
  window.HTMLElement.prototype.scrollTo = noop;
  window.HTMLElement.prototype.setSelectionRange = noop;
  window.getComputedStyle = () => ({});
  const timers = new Map(), intervals = new Map(), storage = new Map(), events = [], requests = [], errors = [];
  let timerId = 0;
  const timer = fn => { timers.set(++timerId, fn); return timerId; };
  const frame = fn => timer(fn);
  const host = { api: null, hook: null, input: { current: null }, creations: [], history: new Map(), pending: [], imageReaders: [], startup: deferred() };
  const modules = { ...pure, react: React, "react/jsx-runtime": { jsx, jsxs, Fragment: React.Fragment } };
  const load = (name, extras = {}) => {
    const exported = {};
    vm.runInNewContext(compile(sources[name]), { exports: exported, window, document: window.document,
      console: { error: (...args) => errors.push(args), warn: noop }, crypto: globalThis.crypto,
      URL: Object.assign(class extends URL {}, { createObjectURL: () => "blob:synthetic-image", revokeObjectURL: noop }), URLSearchParams,
      AbortController, DOMException, CustomEvent: window.CustomEvent, Event: window.Event, TextDecoder,
      FileReader: class { readAsDataURL() { host.imageReaders.push(this); } },
      setTimeout: timer, clearTimeout: id => timers.delete(id), setInterval: fn => { intervals.set(++timerId, fn); return timerId; }, clearInterval: id => intervals.delete(id),
      requestAnimationFrame: frame, cancelAnimationFrame: id => timers.delete(id),
      require: name => { assert.ok(modules[name], `explicitly mocked import ${name}`); return modules[name]; }, ...extras,
    });
    return exported;
  };
  modules["@/lib/app-prefs"] = { APP_PREF_KEYS: { chatDrafts: "drafts" }, getPrefJson: key => storage.has(key) ? JSON.parse(storage.get(key)) : null,
    trySetPrefJson: (key, value) => { storage.set(key, JSON.stringify(value)); return true; } };
  const store = load("drafts");
  modules["@/lib/draft-store"] = store;
  const response = data => ({ ok: true, status: 200, json: async () => data });
  const fetch = async (url, options = {}) => {
    requests.push({ url, method: options.method ?? "GET" });
    if (url === "/api/agent/new") { if (delayStartup) await host.startup.promise; return response({ sessionId: createdId }); }
    if (url.startsWith("/api/models")) return response({ models: {}, modelList: [] });
    if (url === "/api/edupi/proactivity/messages") return response({ status: "disabled" });
    if (url.startsWith("/api/sessions/")) {
      if (url.endsWith("/state")) return response({ running: false });
      const id = decodeURIComponent(url.split("/")[3].split("?")[0]);
      const messages = host.history.get(id) ?? [];
      return response({ id, context: { messages, entryIds: messages.map((_, index) => `entry-${index}`) }, tree: [], leafId: null });
    }
    if (url.startsWith("/api/agent/")) return response({ running: false });
    assert.fail(`Unexpected synthetic fetch ${url}`);
  };
  class EventSource {
    static OPEN = 1; static CLOSED = 2;
    readyState = EventSource.OPEN;
    constructor(url) { this.url = url; events.push(this); queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: "connected" }) })); }
    close() { this.readyState = EventSource.CLOSED; }
    emit(event) { this.onmessage?.({ data: JSON.stringify(event) }); }
  }
  const receive = async (sid, command) => {
    const item = { sid, command, ...deferred() };
    host.pending.push(item);
    if (immediate) item.resolve();
    await item.promise;
    host.history.set(sid, [{ role: "user", content: command.message, timestamp: 1 }]);
  };
  modules["@/lib/agent-client"] = { sendAgentCommand: async (sid, command) => {
    if (command.type === "get_tools") return [];
    if (command.type === "persist_session") return {};
    if (command.type === "prompt") return receive(sid, command);
    if (command.type === "get_commands") return { commands: [] };
    assert.fail(`Unexpected synthetic command ${command.type}`);
  } };
  modules["@/lib/edupi-ambient-message"] = { persistEduPiPromptIntent: async () => "pending",
    reconcileEduPiCapturedPrompt: async () => "unavailable", resolveEduPiPromptIntentClient: async () => {},
    sendEduPiCapturedPrompt: async ({ sessionId, command }) => { if (!durable) { await receive(sessionId, command); return "accepted"; } return "disabled"; } };
  modules["@/lib/fetch-timeout"] = { fetchWithRetry: fetch, fetchJsonWithDeadline: async url => { const res = await fetch(url); return { response: res, body: await res.json() }; } };
  modules["@/lib/desktop-updater"] = { isTauriDesktop: () => durable };
  modules["@/lib/edupi-ui-events"] = { EDUPI_STUDENT_RECORDS_UPDATED_EVENT: "synthetic-records" };
  modules["@/lib/queue-recovery"] = { recallQueueWithBackup: assert.fail };
  const hook = load("useAgentSession", { fetch, EventSource });
  modules["@/hooks/useAgentSession"] = { useAgentSession: options => { const value = hook.useAgentSession(options); host.hook = value; return value; } };
  modules["@/hooks/useI18n"] = { useI18n: () => ({ t: key => key, locale: "zh-CN" }) };
  modules["@/hooks/useIsMobile"] = { useIsMobile: () => false };
  modules["@/hooks/useSpeechDictation"] = { appendSpeechTranscript: (value, transcript) => value + transcript, useSpeechDictation: () => ({ abort: noop }) };
  modules["@/lib/desktop-native"] = { isTauriDesktop: () => durable, fetchDesktopApi: fetch, readDesktopImageAttachments: assert.fail, selectFilesNative: assert.fail };
  modules["./FileIcons"] = { FolderIcon: () => null, getFileIcon: () => null };
  modules["./EduPiResourcePicker"] = { EduPiResourcePicker: () => null };
  modules["./ExtensionStatusBar"] = { ExtensionStatusBar: () => null };
  modules["@/lib/edupi-chat-resources"] = { CHAT_RESOURCE_KINDS: [] };
  const input = load("ChatInput", { fetch });
  modules["./ChatInput"] = input;
  modules["@/hooks/useKeyboardShortcuts"] = { registerAbortHandler: noop };
  modules["@/hooks/useAudio"] = { useAudio: () => ({ soundEnabled: false, onSoundToggle: noop, playDoneSound: noop, unlockAudio: noop }) };
  modules["@/hooks/useDragDrop"] = { useDragDrop: () => ({ isDragOver: false, handleDragEnter: noop, handleDragOver: noop, handleDragLeave: noop, handleDrop: noop }) };
  modules["@/lib/branding"] = { PRODUCT_NAME: "EduPi" };
  for (const name of ["DisclosureChevron", "EduPiConversationFiles", "EduPiProactiveHub", "EduPiRuntimeFlow", "ConversationNavigator"]) modules[`./${name}`] = { [name]: () => null };
  modules["./MessageView"] = { MessageView: ({ message }) => jsx("div", { "data-message": message.role, children: typeof message.content === "string" ? message.content : "synthetic response" }) };
  const { ChatWindow } = load("ChatWindow");
  const initial = existing ? session() : null;
  const origin = initial?.id ?? `new:${cwd}`;
  store.setDraft(origin, { value: text, images: [] });
  function Parent() {
    const [selected, select] = React.useState(initial);
    const [directory, choose] = React.useState(existing ? null : cwd);
    const [visible, show] = React.useState(true);
    host.api = { select(id, path = cwd) { select(session(id, path)); choose(null); }, newCwd(path) { select(null); choose(path); }, show };
    return visible ? jsx(ChatWindow, { session: selected, newSessionCwd: directory, chatInputRef: host.input,
      onSessionCreated: value => { host.creations.push(value.id); select(value); choose(null); }, teacherMode: true }) : null;
  }
  const container = window.document.getElementById("root"), root = createRoot(container);
  const f = { host, store, origin, requests, events, errors, container,
    textarea: () => container.querySelector("textarea"),
    async flush() { await act(async () => { for (let i = 0; i < 8; i++) await tick(); }); },
    async run(fn) { await act(async () => { fn(); await tick(); }); await f.flush(); },
    async send() { await f.run(() => { const button = container.querySelector(".composer-send-button"); assert.ok(button && !button.disabled, "send enabled"); button.dispatchEvent(new window.Event("click", { bubbles: true })); }); },
    async type(value) { await f.run(() => host.input.current.replaceText(value)); },
    async adoptContext(context) {
      await f.run(() => host.input.current.offerContext(context));
      await f.run(() => {
        const button = [...container.querySelectorAll("button")].find(item => item.textContent === `带入${context.title}`);
        assert.ok(button, "reference offer is available");
        button.dispatchEvent(new window.Event("click", { bubbles: true }));
      });
    },
    async startImage() { await f.run(() => host.input.current.addImages([{ name: "synthetic.png", size: 3, type: "image/png" }])); },
    async finishImage() { await f.run(() => { const reader = host.imageReaders.shift(); assert.ok(reader); reader.result = "data:image/png;base64,AQID"; reader.onload(); }); },
    async startReady() { await f.run(() => host.startup.resolve()); },
    async accept(index = 0) { await f.run(() => host.pending[index].resolve()); },
    async fail(index = 0) { await f.run(() => host.pending[index].reject(new Error("synthetic delivery failure"))); },
    async done(index = 0) { await f.run(() => events.filter(source => source.url.includes(host.pending[index].sid)).at(-1)?.emit({ type: "prompt_done", clientRequestId: host.pending[index].command.clientRequestId })); },
    persisted(key) { store.flushDraftNow(key); return JSON.parse(storage.get("drafts") ?? "{}")[key] ?? null; },
    async close() {
      await act(async () => root.unmount()); Object.assign(globalThis, globals);
      assert.ok(errors.every(([label, error]) => label === "Failed to send message:"
        && /synthetic delivery failure|The conversation changed before the message was submitted/.test(error?.message)),
      "all mocked IO errors must be the deliberately failed or superseded send");
    },
  };
  await act(async () => root.render(jsx(Parent, {}))); await f.flush();
  return f;
}

for (const existing of [false, true]) test(`confirmed ${existing ? "existing" : "first new"} send clears the mounted composer and durable draft`, async () => {
  const f = await mount({ existing });
  try {
    const textarea = f.textarea();
    await f.send();
    assert.equal(f.host.pending.length, 1);
    await f.accept(); await f.done();
    assert.equal(f.textarea().value, "");
    assert.ok(f.textarea() === textarea, "optimistic send and promotion must retain the same composer instance");
    assert.equal(f.store.getDraft(f.origin), null);
    assert.equal(f.store.getDraft(createdId), null);
    assert.equal(f.persisted(f.origin), null);
    assert.equal(f.persisted(createdId), null);
    assert.deepEqual(f.host.creations, existing ? [] : [createdId]);
  } finally { await f.close(); }
});

for (const existing of [false, true]) test(`fresh web ${existing ? "existing" : "new"} send clears after promotion without a durable ACK`, async () => {
  const f = await mount({ existing, durable: false });
  try {
    await f.send(); await f.accept(); await f.done();
    assert.equal(f.textarea().value, "");
    assert.equal(f.store.getDraft(existing ? f.origin : createdId), null);
  } finally { await f.close(); }
});

for (const existing of [false, true]) for (const durable of [false, true]) test(`typing the next draft during ${existing ? "existing" : "new"} ${durable ? "durable" : "web"} send survives ACK, promotion and completion`, async () => {
  const f = await mount({ existing, durable });
  try {
    await f.send();
    await f.type("[UI TEST] 下一条草稿");
    await f.accept(); await f.done();
    assert.equal(f.textarea().value, "[UI TEST] 下一条草稿");
    assert.equal(f.store.getDraft(existing ? f.origin : createdId)?.value, "[UI TEST] 下一条草稿");
    assert.equal(f.persisted(existing ? f.origin : createdId)?.value, "[UI TEST] 下一条草稿");
  } finally { await f.close(); }
});

for (const existing of [false, true]) test(`failed ${existing ? "existing" : "new"} send retains its original text for retry`, async () => {
  const f = await mount({ existing });
  try {
    await f.send(); await f.fail();
    assert.equal(f.textarea().value, text);
    assert.equal(f.store.getDraft(f.origin)?.value, text);
    assert.deepEqual(f.host.creations, []);
  } finally { await f.close(); }
});

for (const existing of [false, true]) for (const transition of ["session", "cwd", "module"]) test(`late ${existing ? "existing" : "new"} success after ${transition} switch preserves both drafts`, async () => {
  const f = await mount({ existing });
  try {
    await f.send(); await f.type("[UI TEST] 下一条草稿");
    if (transition === "session") await f.run(() => f.host.api.select("synthetic-other", "/synthetic/other"));
    if (transition === "cwd") await f.run(() => f.host.api.newCwd("/synthetic/other"));
    if (transition === "module") { await f.run(() => f.host.api.show(false)); await f.run(() => f.host.api.show(true)); }
    await f.type("[UI TEST] 切换后的草稿");
    await f.accept(); await f.done();
    assert.equal(f.textarea().value, "[UI TEST] 切换后的草稿");
    assert.deepEqual(f.host.creations, [], "late old send cannot promote the active conversation");
    if (transition !== "module") assert.equal(f.store.getDraft(f.origin)?.value, "[UI TEST] 下一条草稿");
  } finally { await f.close(); }
});

for (const existing of [false, true]) test(`immediate receipt during ${existing ? "existing" : "new"} send still clears once`, async () => {
  const f = await mount({ existing, immediate: true });
  try {
    await f.send(); await f.done();
    assert.equal(f.textarea().value, "");
    assert.equal(f.host.pending.length, 1);
  } finally { await f.close(); }
});

test("an old unmounted send cannot erase an identical retype in the remounted composer", async () => {
  const f = await mount({ existing: true });
  try {
    await f.send();
    await f.run(() => f.host.api.show(false)); await f.run(() => f.host.api.show(true));
    await f.type(text);
    await f.accept(); await f.done();
    assert.equal(f.textarea().value, text);
    assert.equal(f.store.getDraft(f.origin)?.value, text);
  } finally { await f.close(); }
});

test("typing while the new session is still being created survives its later receipt", async () => {
  const f = await mount({ delayStartup: true });
  try {
    await f.send();
    assert.equal(f.host.pending.length, 0);
    await f.type("[UI TEST] 会话准备时输入");
    await f.startReady(); await f.accept(); await f.done();
    assert.equal(f.textarea().value, "[UI TEST] 会话准备时输入");
    assert.equal(f.store.getDraft(createdId)?.value, "[UI TEST] 会话准备时输入");
    assert.equal(f.store.getDraft(f.origin), null);
  } finally { await f.close(); }
});

test("an identical retype during the first send keeps its editing proof after promotion", async () => {
  const f = await mount();
  try {
    await f.send(); await f.type(text); await f.accept(); await f.done();
    assert.equal(f.textarea().value, text);
    assert.equal(f.store.getDraft(createdId)?.value, text);
    assert.equal(f.store.getDraft(f.origin), null);
  } finally { await f.close(); }
});

for (const existing of [false, true]) test(`an image selected before ${existing ? "existing" : "new"} send and loaded during it stays in the next draft`, async () => {
  const f = await mount({ existing });
  try {
    await f.startImage(); await f.send();
    await f.type("[UI TEST] 下一条带图片"); await f.finishImage();
    await f.accept(); await f.done();
    assert.equal(f.textarea().value, "[UI TEST] 下一条带图片");
    const draft = f.store.getDraft(existing ? f.origin : createdId);
    assert.equal(draft.images.length, 1);
    assert.equal(draft.images[0].data, "AQID");
    assert.ok(f.container.querySelector('img[src="blob:synthetic-image"]'));
  } finally { await f.close(); }
});

test("an unchanged submitted image clears with its first message", async () => {
  const f = await mount({ durable: false });
  try {
    await f.startImage(); await f.finishImage(); await f.send();
    assert.equal(f.host.pending[0].command.images.length, 1);
    await f.accept(); await f.done();
    assert.equal(f.textarea().value, "");
    assert.equal(f.store.getDraft(createdId), null);
    assert.equal(f.container.querySelector(".chat-composer img"), null);
  } finally { await f.close(); }
});

test("a pending next image that finishes after first-send promotion belongs to the created session", async () => {
  const f = await mount();
  try {
    await f.startImage(); await f.send(); await f.accept(); await f.done(); await f.finishImage();
    assert.equal(f.textarea().value, "");
    assert.equal(f.store.getDraft(createdId)?.images[0]?.data, "AQID");
    assert.equal(f.store.getDraft(f.origin), null);
  } finally { await f.close(); }
});

for (const existing of [false, true]) test(`completion before the ${existing ? "existing" : "new"} persistence receipt cannot clear the next draft`, async () => {
  const f = await mount({ existing });
  try {
    await f.send(); await f.done(); await f.type("[UI TEST] 完成消息后的下一稿");
    await f.accept();
    assert.equal(f.textarea().value, "[UI TEST] 完成消息后的下一稿");
    assert.equal(f.store.getDraft(existing ? f.origin : createdId)?.value, "[UI TEST] 完成消息后的下一稿");
  } finally { await f.close(); }
});

const proposalContext = { title: "合成下一页", reference: "[UI TEST] 下一页参考" };
const proposalText = "[UI TEST] 下一条教师要求";
const submittedContext = { title: "合成本次参考", reference: "[UI TEST] 本次提交参考" };
function offerNext(f, kind) { return f.run(() => kind === "teacher" ? f.host.input.current.offerTeacherDraft(proposalText) : f.host.input.current.offerContext(proposalContext)); }
function assertProposal(draft, kind) {
  assert.equal(kind === "teacher" ? draft?.pendingTeacherText : draft?.offeredContext?.reference,
    kind === "teacher" ? proposalText : proposalContext.reference);
}

for (const existing of [false, true]) for (const durable of [false, true]) for (const kind of ["teacher", "page"]) test(`${existing ? "existing" : "new"} ${durable ? "Desktop image" : "web text"} success retains the later ${kind} proposal while clearing submitted content`, async () => {
  const f = await mount({ existing, durable });
  try {
    await f.adoptContext(submittedContext);
    if (durable) { await f.startImage(); await f.finishImage(); }
    await f.send();
    assert.ok(f.host.pending[0].command.message.includes(submittedContext.reference));
    await offerNext(f, kind);
    assertProposal(f.store.getDraft(f.origin), kind);
    await f.accept(); await f.done();
    const key = existing ? f.origin : createdId;
    assert.equal(f.textarea().value, "");
    const draft = f.store.getDraft(key);
    assert.equal(draft.value, "");
    assert.equal(draft.images.length, 0);
    assert.equal(draft.context, undefined, "the active reference belonged to this submission");
    assertProposal(draft, kind);
    assertProposal(f.persisted(key), kind);
    assert.equal(f.container.querySelector(".chat-composer img"), null);
    if (!existing) assert.equal(f.store.getDraft(f.origin), null);
  } finally { await f.close(); }
});

for (const existing of [false, true]) for (const kind of ["teacher", "page"]) test(`${existing ? "existing" : "new"} image failure retains submitted content and the later ${kind} proposal`, async () => {
  const f = await mount({ existing });
  try {
    await f.adoptContext(submittedContext);
    await f.startImage(); await f.finishImage(); await f.send(); await offerNext(f, kind); await f.fail();
    assert.equal(f.textarea().value, text);
    const draft = f.store.getDraft(f.origin);
    assert.equal(draft.images.length, 1);
    assert.equal(draft.context.reference, submittedContext.reference);
    assertProposal(draft, kind);
    assertProposal(f.persisted(f.origin), kind);
    assert.deepEqual(f.host.creations, []);
  } finally { await f.close(); }
});

for (const durable of [false, true]) test(`${durable ? "Desktop image" : "web text"} success retains a proposal that was already offered but not adopted before send`, async () => {
  const f = await mount({ existing: durable, durable });
  try {
    if (durable) { await f.startImage(); await f.finishImage(); }
    await offerNext(f, "page"); await f.send();
    assert.equal(f.host.pending[0].command.message.includes(proposalContext.reference), false);
    await f.accept(); await f.done();
    assert.equal(f.textarea().value, "");
    const key = durable ? f.origin : createdId;
    assertProposal(f.store.getDraft(key), "page");
    assertProposal(f.persisted(key), "page");
  } finally { await f.close(); }
});
