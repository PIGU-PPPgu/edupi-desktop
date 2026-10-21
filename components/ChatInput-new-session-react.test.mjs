import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import React, { act } from "react";
import { create } from "react-test-renderer";
import { createJiti } from "jiti";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import sharp from "sharp";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { ChatInput } = await jiti.import("./ChatInput.tsx");
const { ChatWindow } = await jiti.import("./ChatWindow.tsx");
const { useAgentSession } = await jiti.import("../hooks/useAgentSession.ts");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");
const drafts = await jiti.import("../lib/draft-store.ts");
const png = async width => (await sharp({ create: { width, height: 1, channels: 4, background: "white" } }).png().toBuffer()).toString("base64");
const smallPng = await png(1), oversizedPng = await png(4096);
const noop = () => {};
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function waitFor(read, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!read()) {
    assert.ok(Date.now() < deadline, "synthetic SDK turn did not settle");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function fixture(t, { slowCreation = false, slowAck = false, outcome = "accepted", fullWindow = true, resolvedIntent = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-first-prompt-react-"));
  const cwd = path.join(root, "project");
  const agentDir = path.join(root, "agent");
  fs.mkdirSync(cwd); fs.mkdirSync(agentDir);
  const isolatedEnvironment = { PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1", EDUPI_SAFE_MODE: "1",
    EDUPI_DATA_ROOT: path.join(root, "data"), EDUPI_PROJECT_ROOT: path.join(root, "data"),
    EDUPI_CORE_ROOT: path.join(root, "core"), PI_DESKTOP_STATE_DIR: path.join(root, "state") };
  const originalEnvironment = Object.fromEntries(Object.keys(isolatedEnvironment).map(key => [key, process.env[key]]));
  for (const directory of [isolatedEnvironment.EDUPI_DATA_ROOT, isolatedEnvironment.EDUPI_CORE_ROOT, isolatedEnvironment.PI_DESKTOP_STATE_DIR]) fs.mkdirSync(directory);
  Object.assign(process.env, isolatedEnvironment);
  const originalGlobals = Object.fromEntries(["window", "document", "EventSource", "fetch", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"].map(key => [key, globalThis[key]]));
  const realFetch = globalThis.fetch;
  const storage = new Map();
  const window = Object.assign(new EventTarget(), {
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    setTimeout, clearTimeout, matchMedia: () => Object.assign(new EventTarget(), { matches: false }),
    __TAURI_INTERNALS__: { invoke: async command => command === "get_desktop_api_token" ? "synthetic-react-token-000000000000000000" : null },
  });
  Object.assign(globalThis, { window, document: Object.assign(new EventTarget(), { visibilityState: "visible", activeElement: null, documentElement: {} }),
    requestAnimationFrame: () => 0, cancelAnimationFrame: noop, IS_REACT_ACT_ENVIRONMENT: true });
  let calls = 0, wrapper, renderer;
  const gate = deferred(), created = deferred(), creationGate = deferred(), submitted = deferred(), finished = deferred(), reconciling = deferred();
  const server = http.createServer(async (request, response) => {
    for await (const chunk of request) { void chunk; /* Consume only the synthetic SDK request. */ }
    calls++;
    response.writeHead(200, { "content-type": "text/event-stream" });
    const base = { id: "synthetic", object: "chat.completion.chunk", created: 1, model: "local" };
    response.end(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "SYNTHETIC_FIRST_REPLY" }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const providerPort = server.address().port;
  fs.writeFileSync(path.join(agentDir, "models.json"), JSON.stringify({ providers: { local: {
    api: "openai-completions", baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: "synthetic-only",
    models: [{ id: "local", name: "local", input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 128 }],
  } } }));
  const { startRpcSession } = await jiti.import("../lib/rpc-manager.ts");
  const streams = new Set();
  globalThis.EventSource = class {
    static CLOSED = 2;
    readyState = 1;
    constructor() {
      streams.add(this);
      this.unsubscribe = wrapper.onEvent(event => {
        this.onmessage?.({ data: JSON.stringify(event) });
        if (event.type === "prompt_done") finished.resolve();
      });
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: "connected" }) }));
    }
    close() { this.unsubscribe(); streams.delete(this); this.readyState = 2; }
  };
  const json = value => Response.json(value);
  const messages = () => wrapper?.sessionFile && fs.existsSync(wrapper.sessionFile)
    ? SessionManager.open(wrapper.sessionFile).buildSessionContext().messages : [];
  let requestCommand;
  globalThis.fetch = async (url, options = {}) => {
    if (!String(url).startsWith("/")) {
      assert.equal(new URL(String(url)).origin, `http://127.0.0.1:${providerPort}`, "only this fixture's provider may receive a real request");
      return realFetch(url, options);
    }
    const pathname = String(url).split("?")[0];
    const input = options.body ? JSON.parse(options.body) : null;
    if (pathname === "/api/agent/new") {
      if (!wrapper) ({ session: wrapper } = await startRpcSession(`react-${crypto.randomUUID()}`, "", cwd,
        { toolNames: [], initialModel: { provider: "local", modelId: "local" } }));
      created.resolve();
      if (slowCreation) await creationGate.promise;
      return json({ sessionId: wrapper.sessionId });
    }
    if (pathname === "/api/edupi/proactivity/prompt/intent") {
      if (resolvedIntent && options.method === "POST") {
        // The recovered intent has already reached Pi. Reconciliation must
        // confirm this real persisted request, never dispatch it a second time.
        requestCommand = { type: "prompt", message: input.message, clientRequestId: input.clientRequestId };
        await wrapper.send({ ...requestCommand, awaitUserPersistence: true });
        submitted.resolve();
        return json({ status: "resolved" });
      }
      return json({ status: "ready" });
    }
    if (pathname === "/api/edupi/proactivity/prompt") {
      if (resolvedIntent && options.method === "PATCH") {
        reconciling.resolve();
        await gate.promise;
        return json({ status: "accepted" });
      }
      if (!input) return json({ status: outcome === "uncertain" ? "uncertain" : "unavailable" });
      requestCommand = input.command;
      if (outcome === "blocked") return json({ status: "blocked" });
      if (input.command.images?.length) return json({ status: "disabled" });
      await wrapper.send({ ...input.command, awaitUserPersistence: true });
      submitted.resolve();
      if (slowAck) await gate.promise;
      return json({ status: outcome });
    }
    if (pathname === "/api/edupi/proactivity/messages") return json({ status: "disabled" });
    if (pathname.startsWith("/api/agent/")) {
      if (input?.type === "get_tools") return json({ success: true, data: [] });
      if (input?.type === "get_commands") return json({ success: true, data: { commands: [] } });
      if (input?.type === "prompt") {
        requestCommand = input;
        const data = await wrapper.send(input);
        submitted.resolve();
        return json({ success: true, data });
      }
      if (input) return json({ success: true, data: await wrapper.send(input) });
      return json({ running: true, state: { isStreaming: false, isPromptRunning: false, messageCount: messages().length, pendingMessageCount: 0 } });
    }
    if (pathname.startsWith("/api/sessions/")) {
      const id = pathname.split("/")[3];
      return json({ sessionId: id, filePath: id === wrapper?.sessionId ? wrapper.sessionFile : "",
        tree: [], leafId: null, context: { messages: id === wrapper?.sessionId ? messages() : [], entryIds: [], thinkingLevel: "off", model: null } });
    }
    if (pathname === "/api/models") return json({ models: {}, modelList: [], defaultModel: null });
    return json({ skills: [], files: [], entries: [] });
  };
  const controls = {};
  function HookInput({ session, setSession, input, draftKey }) {
    const agent = useAgentSession({ session, newSessionCwd: session ? null : cwd, draftKey,
      chatInputRef: input, onSessionCreated: setSession });
    controls.agent = agent;
    return React.createElement(ChatInput, { ref: input, onSend: agent.handleSend, onAbort: agent.handleAbort,
      isStreaming: agent.isStreaming, draftKey, teacherMode: true });
  }
  function App() {
    const [session, setSession] = React.useState(null);
    const [generation, setGeneration] = React.useState(0);
    const input = React.useRef(null);
    const key = session?.id ?? `new:${cwd}`;
    Object.assign(controls, { input, key, navigate: setSession, newTask: () => {
      const reset = drafts.resetNewSessionDraft(`new:${cwd}`);
      if (reset) { setSession(null); setGeneration(value => value + 1); }
      return reset;
    } });
    return fullWindow ? React.createElement(ChatWindow, { key: generation, session, newSessionCwd: session ? null : cwd,
      chatInputRef: input, onSessionCreated: setSession, teacherMode: true })
      : React.createElement(HookInput, { session, setSession, input, draftKey: key });
  }
  t.after(async () => {
    gate.resolve(); creationGate.resolve();
    if (renderer) await act(async () => renderer.unmount());
    for (const stream of streams) stream.close();
    wrapper?.destroy(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    for (const key of [`new:${cwd}`, wrapper?.sessionId, `${cwd}:other`]) if (key) {
      const pending = drafts.getDraft(key)?.pendingPrompt;
      if (pending) drafts.releasePendingPromptForNewMessage(key, pending.clientRequestId);
      drafts.clearDraft(key);
      drafts.flushDraftNow(key);
    }
    for (const [key, value] of Object.entries(originalGlobals)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
    assert.equal(fs.existsSync(root), false);
    assert.equal(server.listening, false);
    t.diagnostic(JSON.stringify({ fixtureRoot: root, providerPort, providerCalls: calls, rootRemoved: true, providerStopped: true }));
  });
  await act(async () => { renderer = create(React.createElement(I18nProvider, { initialLocale: "zh-CN" }, React.createElement(App)),
    { createNodeMock: element => element.type === "textarea" ? { style: {}, value: "", focus: noop, setSelectionRange: noop, scrollHeight: 24 } : null }); });
  const textarea = () => renderer.root.findByType("textarea");
  const edit = async value => act(async () => textarea().props.onChange({ target: { value }, currentTarget: { value } }));
  const sendHandler = () => renderer.root.findAllByType("button").find(button => button.props.title === "发送" || button.props["aria-label"] === "发送").props.onClick;
  const send = () => sendHandler()();
  return { controls, cwd, edit, send, sendHandler, text: () => textarea().props.value,
    imageCount: () => renderer.root.findAllByType("button").filter(button => /^移除图片 /.test(button.props["aria-label"] ?? "")).length,
    created: created.promise, releaseCreation: creationGate.resolve,
    submitted: submitted.promise, finished: finished.promise, reconciling: reconciling.promise, sessionId: () => wrapper.sessionId,
    releaseAck: gate.resolve, calls: () => calls, messages, command: () => requestCommand,
    proof: async () => {
      const { inspectEduPiPromptSession } = await jiti.import("../lib/edupi-prompt-reconciliation.ts");
      return inspectEduPiPromptSession({ sessionId: wrapper.sessionId, clientRequestId: requestCommand.clientRequestId, command: requestCommand }, wrapper.sessionFile);
    },
    acceptedEntries: () => SessionManager.open(wrapper.sessionFile).getEntries().filter(entry => entry.type === "custom"
      && entry.customType === "edupi_prompt_accepted_v1" && entry.data.clientRequestId === requestCommand.clientRequestId),
  };
}

test("real React first durable prompt stays cleared after new-session promotion and a real SDK receipt", { timeout: 20_000 }, async t => {
  const f = await fixture(t, { slowCreation: true });
  await f.edit("SYNTHETIC_FIRST_PROMPT");
  let sending;
  await act(async () => { sending = f.send(); await f.created; });
  const holding = f.controls.input.current.isHoldingSubmission(f.controls.key);
  await act(async () => { f.releaseCreation(); await sending; await f.finished; });
  assert.equal(await f.proof(), "confirmed");
  assert.equal(f.messages().filter(message => message.role === "user").length, 1);
  assert.equal(f.calls(), 1);
  assert.ok(!f.controls.key.startsWith("new:"));
  assert.deepEqual({ holding, text: f.text() }, { holding: true, text: "" },
    "the first optimistic message must retain its composer and clear only the positively accepted draft");
});

test("a slow first ACK and promotion preserve text edited after the real SDK accepted the first prompt", { timeout: 20_000 }, async t => {
  const f = await fixture(t, { slowAck: true });
  await f.edit("SYNTHETIC_FIRST_PROMPT");
  let sending;
  await act(async () => { sending = f.send(); await f.submitted; await f.finished; });
  await f.edit("SYNTHETIC_NEWER_DRAFT");
  await act(async () => { f.releaseAck(); await sending; });
  assert.equal(await f.proof(), "confirmed");
  assert.equal(f.text(), "SYNTHETIC_NEWER_DRAFT");
  assert.equal(drafts.getDraft(f.controls.key)?.value, "SYNTHETIC_NEWER_DRAFT");
  assert.equal(f.messages().filter(message => message.role === "user").length, 1);
});

test("a slow positive first ACK still clears an untouched draft after the SDK turn settles", { timeout: 20_000 }, async t => {
  const f = await fixture(t, { slowAck: true });
  await f.edit("SYNTHETIC_FIRST_PROMPT");
  let sending;
  await act(async () => { sending = f.send(); await f.submitted; await f.finished; });
  assert.equal(f.text(), "SYNTHETIC_FIRST_PROMPT");
  await act(async () => { f.releaseAck(); await sending; });
  assert.equal(f.text(), "");
  assert.equal(await f.proof(), "confirmed");
});

test("an in-flight first prompt cannot be submitted twice while its real SDK session is being created", { timeout: 20_000 }, async t => {
  const f = await fixture(t, { slowCreation: true });
  await f.edit("SYNTHETIC_DOUBLE_CLICK");
  const click = f.sendHandler();
  let first, second;
  await act(async () => { first = click(); second = click(); await f.created; });
  await act(async () => { f.releaseCreation(); await Promise.all([first, second]); await f.finished; });
  assert.equal(f.calls(), 1);
  assert.equal(f.messages().filter(message => message.role === "user").length, 1);
  assert.equal(f.text(), "");
});

test("pre-dispatch failure and an unknown receipt retain the first draft without a blind retry", { timeout: 20_000 }, async t => {
  for (const outcome of ["blocked", "uncertain"]) await t.test(outcome, async sub => {
    const f = await fixture(sub, { outcome });
    await f.edit("SYNTHETIC_RETAIN_ON_FAILURE");
    await act(async () => { await f.send(); if (outcome === "uncertain") await f.finished; });
    assert.equal(f.text(), "SYNTHETIC_RETAIN_ON_FAILURE");
    assert.ok(f.controls.key.startsWith("new:"));
    assert.equal(f.calls(), outcome === "uncertain" ? 1 : 0);
    assert.equal(f.messages().filter(message => message.role === "user").length, outcome === "uncertain" ? 1 : 0);
    if (outcome === "uncertain") assert.ok(drafts.getDraft(f.controls.key)?.pendingPrompt);
  });
});

test("navigation during a first ACK preserves both newer source edits and the other session draft", { timeout: 20_000 }, async t => {
  const f = await fixture(t, { slowAck: true });
  await f.edit("SYNTHETIC_FIRST_PROMPT");
  let sending;
  await act(async () => { sending = f.send(); await f.submitted; await f.finished; });
  const origin = f.controls.key;
  await f.edit("SYNTHETIC_SOURCE_EDIT");
  await act(async () => f.controls.navigate({ id: `${f.cwd}:other`, cwd: f.cwd, path: "", created: "", modified: "", messageCount: 0, firstMessage: "" }));
  await f.edit("SYNTHETIC_OTHER_DRAFT");
  await act(async () => { f.releaseAck(); await sending; });
  assert.equal(f.text(), "SYNTHETIC_OTHER_DRAFT");
  assert.equal(drafts.getDraft(origin)?.value, "SYNTHETIC_SOURCE_EDIT");
  await act(async () => f.controls.navigate(null));
  assert.equal(f.text(), "SYNTHETIC_SOURCE_EDIT");
  assert.equal(f.messages().filter(message => message.role === "user").length, 1);
});

test("same-cwd New Task remount cannot let a late resolved-intent ACK overwrite the old session with a fresh task", { timeout: 20_000 }, async t => {
  const f = await fixture(t, { resolvedIntent: true });
  await f.edit("SYNTHETIC_OLD_RESOLVED_REQUEST");
  let sending;
  await act(async () => { sending = f.send(); await f.reconciling; await f.finished; });
  assert.equal(await f.proof(), "confirmed");
  await act(async () => assert.equal(f.controls.newTask(), true));
  const oldSessionDraft = structuredClone(drafts.getDraft(f.sessionId()));
  assert.equal(oldSessionDraft.pendingPrompt.clientRequestId, f.command().clientRequestId);
  await f.edit("SYNTHETIC_UNRELATED_FRESH_TASK");
  await act(async () => { f.releaseAck(); await sending; });
  assert.deepEqual(drafts.getDraft(f.sessionId()), oldSessionDraft,
    "a resolved receipt cannot migrate a new task whose source pending identity has been reset");
  assert.equal(f.text(), "SYNTHETIC_UNRELATED_FRESH_TASK");
  assert.equal(drafts.getDraft(f.controls.key)?.value, "SYNTHETIC_UNRELATED_FRESH_TASK");
  assert.equal(f.calls(), 1);
  assert.equal(f.messages().filter(message => message.role === "user").length, 1);
});

test("a current resolved-intent ACK still preserves its own newer edit and never replays the SDK prompt", { timeout: 20_000 }, async t => {
  const f = await fixture(t, { resolvedIntent: true });
  await f.edit("SYNTHETIC_CURRENT_RESOLVED_REQUEST");
  let sending;
  await act(async () => { sending = f.send(); await f.reconciling; await f.finished; });
  await f.edit("SYNTHETIC_SAME_REQUEST_NEWER_DRAFT");
  await act(async () => { f.releaseAck(); await sending; });
  assert.equal(await f.proof(), "confirmed");
  assert.equal(f.text(), "SYNTHETIC_SAME_REQUEST_NEWER_DRAFT");
  assert.equal(f.controls.key, f.sessionId());
  assert.equal(drafts.getDraft(f.sessionId())?.value, "SYNTHETIC_SAME_REQUEST_NEWER_DRAFT");
  assert.equal(drafts.getDraft(f.sessionId())?.pendingPrompt, undefined);
  assert.equal(f.calls(), 1);
  assert.equal(f.messages().filter(message => message.role === "user").length, 1);
});

test("first-message attachments survive the layout transition and clear only after SDK acceptance", { timeout: 20_000 }, async t => {
  const f = await fixture(t, { slowCreation: true });
  const image = { type: "image", source: { type: "base64", media_type: "image/png",
    data: smallPng } };
  await act(async () => assert.equal(f.controls.input.current.replaceMessage({ role: "user", content: [{ type: "text", text: "SYNTHETIC_IMAGE_PROMPT" }, image] }), true));
  let sending;
  await act(async () => { sending = f.send(); await f.created; });
  assert.equal(f.imageCount(), 1);
  assert.equal(f.controls.input.current.isHoldingSubmission(f.controls.key), true);
  await act(async () => { f.releaseCreation(); await sending; await f.finished; });
  assert.equal(f.text(), "");
  assert.equal(f.imageCount(), 0);
  assert.equal(f.messages().filter(message => message.role === "user").length, 1);
  assert.equal(f.acceptedEntries().length, 1);
});

test("SDK resizing of a valid oversized image cannot clear attachments without an exact positive receipt", { timeout: 20_000 }, async t => {
  const f = await fixture(t);
  await act(async () => f.controls.input.current.replaceMessage({ role: "user", content: [
    { type: "text", text: "SYNTHETIC_IMAGE_RETAIN" },
    { type: "image", source: { type: "base64", media_type: "image/png",
      data: oversizedPng } },
  ] }));
  await act(async () => { await f.send(); await f.finished; });
  assert.equal(f.text(), "SYNTHETIC_IMAGE_RETAIN");
  assert.equal(f.imageCount(), 1);
  assert.equal(f.acceptedEntries().length, 0);
});

test("a promoted session's next real SDK submission also clears without sharing another draft", { timeout: 20_000 }, async t => {
  const f = await fixture(t);
  await f.edit("SYNTHETIC_FIRST_PROMPT");
  await act(async () => { await f.send(); await f.finished; });
  const sessionKey = f.controls.key;
  await f.edit("SYNTHETIC_SECOND_PROMPT");
  await act(async () => { await f.send(); await waitFor(() => f.messages().filter(message => message.role === "assistant").length === 2); });
  assert.equal(f.controls.key, sessionKey);
  assert.equal(f.text(), "");
  assert.equal(f.calls(), 2);
  assert.equal(f.messages().filter(message => message.role === "user").length, 2);
});
