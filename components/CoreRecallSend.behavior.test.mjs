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
  "chat-file-drop", "chat-lazy-load", "edupi-calendar-result", "edupi-priority-send"]) pure[`@/lib/${name}`] = await jiti.import(`../lib/${name}.ts`);
pure["./EduPiBrandMark"] = await jiti.import("./EduPiBrandMark.tsx");
pure["@/lib/edupi-recall-answer-client"] = {
  ...await jiti.import("../lib/edupi-recall-answer-client.ts"),
  coreRecallClient: { enabled: async () => false },
};
const sources = Object.fromEntries(["ChatInput", "ChatWindow"].map(name => [name, fs.readFileSync(new URL(`./${name}.tsx`, import.meta.url), "utf8")]));
sources.useAgentSession = fs.readFileSync(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
sources.recallClient = fs.readFileSync(new URL("../lib/edupi-recall-prompt-client.ts", import.meta.url), "utf8");
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

async function mount({ existing = true, durable = true, immediate = false, delayStartup = false, approved = true } = {}) {
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
  const host = { recallPosts: [], inspectReads: [], ordinaryIntents: [], ordinaryCaptures: [], commands: [], inspectStatus: "uncertain",
    recallSettings: { version: 1, normalApproved: approved, activation: {mode:"normal", enabled:true, reason:"ready"},
      config:{enabled:true, scope:{classId:"synthetic-class",subject:"数学"},model:{provider:"synthetic",modelId:"recall-model"},
        limit:2,used:0,remaining:2,validUntil:new Date(Date.now()+3600000).toISOString(),updatedAt:"2026-11-18T00:00:00.000Z"}}, api: null, hook: null, input: { current: null }, creations: [], history: new Map(), pending: [], imageReaders: [], startup: deferred() };
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
  let store = load("drafts");
  modules["@/lib/draft-store"] = store;
  const response = data => ({ ok: true, status: 200, json: async () => data });
  const fetch = async (url, options = {}) => {
    requests.push({ url, method: options.method ?? "GET", body: options.body ? JSON.parse(options.body) : null });
    if (url === "/api/edupi/recall/settings") return response(host.recallSettings);
    if (url.startsWith("/api/edupi/recall/prompts")) {
      if (options.method === "POST") {
        const item = { input: JSON.parse(options.body), ...deferred() };
        host.recallPosts.push(item);
        return response(await item.promise);
      }
      host.inspectReads.push(url);
      return response({version:1,status:host.inspectStatus,reasonCode:null,externalSend:false});
    }
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
    host.commands.push({sid,command});
    if (command.type === "get_tools") return [];
    if (command.type === "persist_session") return {};
    if (command.type === "prompt") return receive(sid, command);
    if (command.type === "get_commands") return { commands: [] };
    assert.fail(`Unexpected synthetic command ${command.type}`);
  } };
  modules["@/lib/edupi-ambient-message"] = { persistEduPiPromptIntent: async value => { host.ordinaryIntents.push(value); return "ready"; },
    reconcileEduPiCapturedPrompt: async () => "unavailable", resolveEduPiPromptIntentClient: async () => {},
    sendEduPiCapturedPrompt: async ({ sessionId, command }) => { host.ordinaryCaptures.push({sessionId, command}); if (!durable) { await receive(sessionId, command); return "accepted"; } return "disabled"; } };
  modules["@/lib/fetch-timeout"] = { fetchWithRetry: fetch, fetchJsonWithDeadline: async url => { const res = await fetch(url); return { response: res, body: await res.json() }; } };
  modules["@/lib/desktop-updater"] = { isTauriDesktop: () => durable };
  modules["./desktop-updater"] = { isTauriDesktop: () => durable };
  modules["./desktop-native"] = { fetchDesktopApi: fetch, desktopApiHeaders: async initial => {
    const headers = new Headers(initial); headers.set("x-pi-desktop-token", "synthetic-native-token"); return headers;
  } };
  modules["@/lib/edupi-recall-prompt-client"] = load("recallClient", { fetch });
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
  modules["./MessageView"] = { MessageView: ({ message }) => jsx("div", { "data-message": message.role, children: typeof message.content === "string" ? message.content : "synthetic response" }), toolVisualItems: () => [] };
  modules["./ChatVisualResult"] = { ChatVisualResult: () => null };
  let { ChatWindow } = load("ChatWindow");
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
  const f = { host, get store() { return store; }, origin, requests, events, errors, container,
    async chooseRecall() { await f.run(() => {
      const button = [...container.querySelectorAll("button")].find(node => node.textContent.trim() === "核对记忆");
      assert.ok(button && !button.disabled, "recall mode is available");
      button.dispatchEvent(new window.Event("click", {bubbles:true}));
    }); },
    async recallReply(status = "accepted", index = 0) { await f.run(() => {
      const item = host.recallPosts[index]; assert.ok(item);
      if (status === "accepted") {
        host.history.set(item.input.sessionId,[{role:"user",content:item.input.message,timestamp:Date.parse(item.input.occurredAt)}]);
        host.inspectStatus = "accepted";
      }
      item.resolve({version:1,status,reasonCode:status === "held" ? "recall_inactive" : null,externalSend:false});
    }); },
    async recallDone(index = 0) { await f.run(() => {
      const item = host.recallPosts[index];
      events.filter(source => source.url.includes(item.input.sessionId)).at(-1)?.emit({type:"prompt_done",clientRequestId:item.input.clientRequestId});
    }); },
    async coldReload() {
      await f.run(() => host.api.show(false));
      store = load("drafts"); modules["@/lib/draft-store"] = store;
      const hook = load("useAgentSession", {fetch, EventSource});
      modules["@/hooks/useAgentSession"] = {useAgentSession: options => { host.hook=hook.useAgentSession(options); return host.hook; }};
      modules["./ChatInput"] = load("ChatInput", {fetch});
      ({ChatWindow} = load("ChatWindow"));
      await f.run(() => host.api.show(true));
    },
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
    persisted(key) { act(() => store.flushDraftNow(key)); return JSON.parse(storage.get("drafts") ?? "{}")[key] ?? null; },
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


// Mounted production ChatInput + ChatWindow + useAgentSession + draft-store +
// recall client; all HTTP, SSE and local preferences are in-process fakes.
test("normal R04 activation leaves ordinary send ordinary; only explicit mode uses the strict recall POST", async () => {
  const f = await mount();
  try {
    await f.send();
    assert.equal(f.host.recallPosts.length,0);
    assert.equal(f.host.ordinaryIntents.length,1);
    await f.accept(); await f.done();
    await f.type("合成班会由谁主持？"); await f.chooseRecall(); await f.send();
    assert.equal(f.host.recallPosts.length,1);
    assert.equal(f.host.ordinaryIntents.length,1);
    assert.equal(f.host.ordinaryCaptures.length,1);
    const input=f.host.recallPosts[0].input;
    assert.deepEqual(Object.keys(input).sort(),["clientRequestId","message","occurredAt","sessionId"]);
    assert.equal(f.persisted(f.origin).pendingPrompt.purpose,"recall");
    await f.recallReply(); await f.recallDone();
    assert.equal(f.textarea().value,"");
    assert.equal(f.persisted(f.origin),null);
    await f.type("下一条普通消息"); await f.send();
    assert.equal(f.host.recallPosts.length,1);
    assert.equal(f.host.ordinaryIntents.length,2);
    await f.accept(1); await f.done(1);
  } finally { await f.close(); }
});

test("an unapproved gate disables explicit recall without disabling ordinary send", async () => {
  const f=await mount({approved:false});
  try {
    const button=[...f.container.querySelectorAll("button")].find(node=>node.textContent.trim()==="核对记忆");
    assert.ok(button.disabled); assert.equal(button.title,"待验收");
    await f.send(); assert.equal(f.host.recallPosts.length,0);
    await f.accept(); await f.done();
  } finally { await f.close(); }
});

test("explicit recall preserves leading and trailing whitespace in the real composer, POST and persisted pending prompt", async () => {
  const f = await mount();
  const raw = "\n  甲班合成班会由谁主持？ \t\n";
  try {
    await f.type(raw); await f.chooseRecall(); await f.send();
    assert.equal(f.host.recallPosts.length, 1);
    assert.equal(f.host.recallPosts[0].input.message, raw);
    assert.equal(f.persisted(f.origin).pendingPrompt.message, raw);
    assert.equal(f.host.ordinaryIntents.length, 0);
    await f.recallReply(); await f.recallDone();
    assert.equal(f.textarea().value, "");
  } finally { await f.close(); }
});

test("recall mode refuses slash, oversized text and images before any dispatch", async () => {
  const f=await mount();
  try {
    await f.chooseRecall();
    for(const message of ["/clear","!echo synthetic","问".repeat(513),` ${"问".repeat(512)}`]) {
      await f.type(message);
      assert.equal(f.container.querySelector(".composer-send-button").disabled,true);
      await act(async () => { assert.equal(await f.host.hook.handleSend(message,undefined,"recall"),false); });
    }
    await act(async () => { assert.equal(await f.host.hook.handleSend("合成问题",[{data:"AQID",mimeType:"image/png"}],"recall"),false); });
    assert.equal(f.host.recallPosts.length,0); assert.equal(f.host.ordinaryIntents.length,0);
  } finally { await f.close(); }
});

for(const status of ["held","uncertain"]) test(`recall ${status} preserves its draft and cannot borrow ordinary send`,async()=>{
  const f=await mount();
  try {
    await f.chooseRecall(); await f.send(); await f.recallReply(status); await f.recallDone();
    assert.equal(f.textarea().value,text);
    const pending=f.persisted(f.origin).pendingPrompt;
    assert.equal(pending.purpose,"recall");
    await f.run(()=>{void f.host.hook.handleSend(text);});
    assert.equal(f.host.recallPosts.length,1);
    assert.equal(f.host.ordinaryIntents.length,0); assert.equal(f.host.ordinaryCaptures.length,0);
    assert.ok(f.host.inspectReads.length>0);
    assert.equal(f.persisted(f.origin).pendingPrompt.clientRequestId,pending.clientRequestId);
  } finally {await f.close();}
});

test("cold recall pending recovery uses GET only and preserves a newer edited draft",async()=>{
  const f=await mount();
  try {
    await f.chooseRecall(); await f.send(); await f.recallReply("uncertain"); await f.recallDone();
    const pending=f.persisted(f.origin).pendingPrompt;
    await f.type("重启前修改的下一条草稿");
    assert.equal(f.persisted(f.origin).value, "重启前修改的下一条草稿");
    f.host.inspectStatus="accepted";
    f.host.history.set(pending.sessionId,[{role:"user",content:pending.message,timestamp:Date.parse(pending.occurredAt)}]);
    await f.coldReload();
    assert.equal(f.host.recallPosts.length,1);
    assert.equal(f.persisted(f.origin).pendingPrompt,undefined);
    assert.equal(f.textarea().value,"重启前修改的下一条草稿");
    assert.ok(f.host.inspectReads.every(url=>url.includes(encodeURIComponent(pending.clientRequestId))));
    assert.equal(f.host.ordinaryIntents.length,0);
  } finally {await f.close();}
});

test("pending recall has a read-only ACK action even after the normal gate closes", async () => {
  const f=await mount();
  try {
    await f.chooseRecall(); await f.send(); await f.recallReply("uncertain"); await f.recallDone();
    f.host.recallSettings={...f.host.recallSettings,normalApproved:false};
    await f.run(()=>window.dispatchEvent(new window.Event("focus")));
    assert.equal(f.container.querySelector(".composer-send-button").disabled,true);
    f.host.inspectStatus="accepted";
    await f.run(()=>{
      const button=[...f.container.querySelectorAll("button")].find(node=>node.textContent==="核对发送结果");
      assert.ok(button && !button.disabled);
      button.dispatchEvent(new window.Event("click",{bubbles:true}));
    });
    assert.equal(f.host.recallPosts.length,1);
    assert.equal(f.persisted(f.origin),null);
    assert.equal(f.host.ordinaryIntents.length,0);
  } finally {await f.close();}
});

test("the first new recall send promotes only after ACK and preserves a draft edited during submission", async () => {
  const f=await mount({existing:false});
  try {
    await f.chooseRecall(); await f.send();
    const pending=f.persisted(f.origin).pendingPrompt;
    assert.equal(pending.purpose,"recall");
    assert.equal(pending.sessionId,createdId);
    assert.equal(f.persisted(createdId).pendingPrompt.purpose,"recall");
    await f.type("发送期间编辑的下一问"); await f.recallReply(); await f.recallDone();
    assert.equal(f.textarea().value,"发送期间编辑的下一问");
    assert.equal(f.persisted(createdId).value,"发送期间编辑的下一问");
    assert.equal(f.persisted(createdId).pendingPrompt,undefined);
    assert.equal(f.host.ordinaryIntents.length,0); assert.equal(f.host.ordinaryCaptures.length,0);
  } finally {await f.close();}
});

test("late recall ACK after a session switch cannot clear another session or lend its purpose",async()=>{
  const f=await mount();
  try {
    await f.chooseRecall(); await f.send();
    const pending=f.persisted(f.origin).pendingPrompt;
    await f.run(()=>f.host.api.select("synthetic-other")); await f.type("另一会话草稿");
    await f.recallReply();
    assert.equal(f.textarea().value,"另一会话草稿");
    assert.equal(f.persisted("synthetic-other").pendingPrompt,undefined);
    assert.equal(f.host.recallPosts[0].input.sessionId,pending.sessionId);
    await f.send(); assert.equal(f.host.recallPosts.length,1); assert.equal(f.host.ordinaryIntents.length,1);
    await f.accept(); await f.done();
  } finally {await f.close();}
});
