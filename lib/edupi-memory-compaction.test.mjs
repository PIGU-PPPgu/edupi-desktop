import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { Type } from "typebox";
import { InMemoryCredentialStore, InMemoryModelsStore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { ModelRuntime, SessionManager, SettingsManager, createAgentSessionFromServices, createAgentSessionServices } from "@earendil-works/pi-coding-agent";

const { createEduPiMemoryRecallAccess } = await createJiti(import.meta.url).import("./edupi-memory-recall-access.ts");
const { loadOwnerControlToken } = await createJiti(import.meta.url).import("./edupi-owner-control-token.ts");
const { createMemoryWriteTool } = await createJiti(import.meta.url).import("./edupi-memory-write-tool.ts");
const { createMemoryForgetTool } = await createJiti(import.meta.url).import("./edupi-memory-forget-tool.ts");
const hash = value => `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
const DELETED = "SYNTHETIC_DELETED_MEMORY_BODY", NAME = "SYNTHETIC_DELETED_STUDENT_NAME", KEEP = "SYNTHETIC_CURRENT_PREFERENCE";

async function fixture(t, { ownerKey = true } = {}) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-memory-compact-")));
  const root = path.join(directory, "teacher"), stateDir = path.join(directory, "state"), agentDir = path.join(directory, "agent");
  for (const file of [root, stateDir, agentDir]) fs.mkdirSync(file, { mode: 0o700 });
  if (ownerKey) loadOwnerControlToken(stateDir, root);
  const requests = [], authenticated = [], sessions = [], servicesList = [], rootRef = hash(root), providerId = `compact-local-${crypto.randomUUID()}`;
  let summaries = 0, ordinary = 0, coreCalls = 0, toolResponses = 0;
  const control = { ordinaryText: "SYNTHETIC_CURRENT_REPLY", summaryText: "SYNTHETIC_SAFE_COMPACTION", inputTokens: 3000,
    summaryFail: false, beforeSummary: null, beforeRecall: null, beforeOrdinaryResponse: null, outboxThrows: false, coreHeld: false, grant: "synthetic-grant", selectedModel: null,
    ordinaryFailures: 0, ordinaryOverflows: 0, ordinaryTool: null, builtinRead: false, retry: false };
  const server = http.createServer(async (req, res) => {
    let body = ""; for await (const bytes of req) body += bytes;
    const value = JSON.parse(body); requests.push(value); authenticated.push(req.headers.authorization === "Bearer synthetic-test-only");
    if (req.url !== "/v1/chat/completions") { res.writeHead(404).end(); return; }
    const wire = JSON.stringify(value.messages);
    const summary = wire.includes("<conversation>") || wire.includes("The messages above are earlier context from an ongoing conversation.");
    if (summary) summaries++; else ordinary++;
    if (!summary && control.ordinaryOverflows > 0) {
      control.ordinaryOverflows--; res.writeHead(400, { "content-type": "application/json" })
        .end(JSON.stringify({ error: { code: "context_length_exceeded", message: "maximum context length exceeded" } })); return;
    }
    if (!summary && control.ordinaryFailures > 0) {
      control.ordinaryFailures--; res.writeHead(503).end("synthetic temporary overload"); return;
    }
    if (summary && control.beforeSummary) { const next = control.beforeSummary; control.beforeSummary = null; await next(); }
    if (!summary && control.beforeOrdinaryResponse) { const next = control.beforeOrdinaryResponse; control.beforeOrdinaryResponse = null; await next(); }
    if (summary && control.summaryFail) { res.writeHead(400).end("synthetic rejected summary"); return; }
    const configured = summary ? control.summaryText : control.ordinaryText, text = typeof configured === "function" ? configured(wire) : configured;
    const chunk = (delta, finish_reason, usage) => `data: ${JSON.stringify({ id: "synthetic", object: "chat.completion.chunk", created: 1,
      model: "synthetic", choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}) })}\n\n`;
    res.writeHead(200, { "content-type": "text/event-stream" });
    if (!summary && control.ordinaryTool) {
      const queue = control.ordinaryTool, tool = Array.isArray(queue) ? queue.shift() : queue;
      if (!Array.isArray(queue) || !queue.length) control.ordinaryTool = null;
      const name = typeof tool === "string" ? tool : tool.name, args = typeof tool === "string" ? "{}" : JSON.stringify(tool.arguments);
      res.end(chunk({ role: "assistant", tool_calls: [{ index: 0, id: `synthetic-tool-call-${++toolResponses}`, type: "function", function: { name, arguments: args } }] }, null)
        + chunk({}, "tool_calls", { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }) + "data: [DONE]\n\n"); return;
    }
    res.end(chunk({ role: "assistant", content: text }, null) + chunk({}, "stop", {
      prompt_tokens: summary ? 10 : control.inputTokens, completion_tokens: 5, total_tokens: summary ? 15 : control.inputTokens + 5,
    }) + "data: [DONE]\n\n");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(),
    modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  runtime.registerProvider(providerId, { api: "openai-completions", baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    apiKey: "synthetic-test-only", models: [{ id: "synthetic", name: "Synthetic compaction fixture", input: ["text"], reasoning: false,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 2048, maxTokens: 512 }] });
  const current = [{ id: "preference-current", category: "preferences", content: KEEP, source_fingerprint: hash(KEEP),
    student_id: null, student: null, managed_method: false }];
  let command, manager, outbox;
  const makeAdapter = () => createEduPiMemoryRecallAccess(root, { readOutbox: () => { if (control.outboxThrows) throw new Error("synthetic outbox unavailable"); return outbox; }, core: async () => ({ rootRef,
    call: async request => { coreCalls++; if (control.beforeRecall) { const next = control.beforeRecall; control.beforeRecall = null; await next(); }
      return { ok: true, result: { version: 1, ...request, status: control.coreHeld ? "held" : "current", reason_code: null,
      external_send: false, model_execute: false, entries: current } }; } }) });
  let adapter = makeAdapter();
  async function open(nextManager, enabled = true, extra = [], cwd = root) {
    manager = nextManager;
    const settingsManager = SettingsManager.inMemory({ compaction: { enabled, reserveTokens: 256, keepRecentTokens: 100 },
      retry: { enabled: control.retry, baseDelayMs: 1, maxRetries: 1 }, cacheWarming: "off" });
    const services = await createAgentSessionServices({ cwd, agentDir, modelRuntime: runtime, settingsManager,
      resourceLoaderOptions: { noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true, noThemes: true,
        extensionFactories: [adapter.extension, ...extra] } });
    adapter.bindSummarization?.(services, manager, stateDir);
    servicesList.push(services);
    const { session } = await createAgentSessionFromServices({ services, sessionManager: manager, model: control.selectedModel ?? runtime.getModel(providerId, "synthetic"),
      ...(control.builtinRead ? {} : { noTools: "builtin" }) });
    await session.bindExtensions({}); sessions.push(session); return session;
  }
  function capture(text) {
    command = { type: "prompt", message: text, clientRequestId: crypto.randomUUID() };
    manager.appendCustomEntry("edupi_prompt_dispatch_v1", { clientRequestId: command.clientRequestId, commandHash: hash(JSON.stringify(command)) });
    outbox = { sessionId: manager.getSessionId(), stage: "pi_accepted", command, cancellationProofs: null,
      bindings: [{ domain: "teaching_preparation", ownerId: "synthetic-owner", grantId: control.grant, grantVersion: 1,
        captured: true, registration: { producerEpoch: "synthetic-epoch", sequence: 1 }, messageRef: "synthetic-message",
        carrierId: "synthetic-carrier", planId: "synthetic-plan", captureMessageId: "synthetic-capture" }] };
    return command;
  }
  t.after(async () => {
    for (const session of sessions) { await session.abort().catch(() => {}); await session.dispose(); }
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true });
  });
  return { root, stateDir, requests, authenticated, open, capture, current, control, runtime, providerId,
    get adapter() { return adapter; }, cold() { adapter = makeAdapter(); }, get coreCalls() { return coreCalls; },
    get services() { return servicesList.at(-1); },
    get manager() { return manager; }, get summaries() { return summaries; }, get ordinary() { return ordinary; },
    async send(session, text = "SYNTHETIC_CURRENT_USER", captured = true) {
      const cmd = captured ? capture(text) : { type: "prompt", message: text, clientRequestId: crypto.randomUUID() };
      await adapter.run(manager, cmd, captured, () => session.prompt(cmd.message)); await session.waitForIdle(); } };
}

test("real SDK threshold compaction never resends deleted persisted memory to a random loopback provider", { timeout: 20000 }, async t => {
  const f = await fixture(t), manager = SessionManager.create(f.root, path.join(f.root, "sessions"));
  manager.appendMessage({ role: "user", content: "SYNTHETIC_PRIOR_USER " + "padding ".repeat(180), timestamp: Date.now() });
  manager.appendMessage(fauxAssistantMessage(fauxToolCall("memory_recall", {}), { stopReason: "toolUse" }));
  const old = { id: "memory-deleted", category: "class", content: DELETED, source_fingerprint: hash(DELETED),
    student_id: "student-deleted", student: NAME, managed_method: false };
  manager.appendMessage({ role: "toolResult", toolCallId: "tool-call-0", toolName: "memory_recall", isError: false,
    content: [{ type: "text", text: `${NAME}: ${DELETED}` }], details: { entries: [old] }, timestamp: Date.now() });
  manager.appendMessage(fauxAssistantMessage("SYNTHETIC_PRIOR_REPLY"));
  let preparation;
  const session = await f.open(manager, true, [pi => pi.on("session_before_compact", event => { preparation = event.preparation; })]); await f.send(session);
  const summaryInputs = f.requests.filter(value => JSON.stringify(value.messages).includes("<conversation>"));
  assert.equal(f.ordinary, 1); assert.ok(summaryInputs.length > 0, "must observe the SDK's actual automatic summary request");
  assert.equal(JSON.stringify(f.requests[0].messages).includes(DELETED), false, "ordinary model input is already sanitized");
  assert.equal(summaryInputs.some(value => JSON.stringify(value.messages).includes(DELETED)), false, "automatic compaction must not bypass historical memory projection");
  assert.equal(summaryInputs.some(value => JSON.stringify(value.messages).includes(NAME)), false, "deleted object name must not reach the summary request");
  const result = SessionManager.open(manager.getSessionFile()).getEntries().findLast(entry => entry.type === "compaction");
  assert.ok(result, "the safe compaction must really persist");
  assert.equal(result.firstKeptEntryId, preparation.firstKeptEntryId); assert.equal(result.tokensBefore, preparation.tokensBefore);
  assert.equal(result.fromHook, true); assert.equal(result.usage.input, 10); assert.equal(result.usage.output, 5);
});

function seedHistory(manager, entries) {
  manager.appendMessage({ role: "user", content: "SYNTHETIC_HISTORY " + "padding ".repeat(180), timestamp: Date.now() });
  manager.appendMessage(fauxAssistantMessage(fauxToolCall("memory_recall", {}), { stopReason: "toolUse" }));
  manager.appendMessage({ role: "toolResult", toolCallId: "tool-call-0", toolName: "memory_recall", isError: false,
    content: [{ type: "text", text: entries.map(entry => entry.content).join("\n") }], details: { entries }, timestamp: Date.now() });
  manager.appendMessage(fauxAssistantMessage("SYNTHETIC_LEGACY_REPLY"));
}

test("signed summary and complete non-memory assistant history remain usable after a real cold reopen", { timeout: 20000 }, async t => {
  const f = await fixture(t), manager = SessionManager.create(f.root, path.join(f.root, "sessions"));
  seedHistory(manager, f.current); f.control.summaryText = "SYNTHETIC_PREFERENCE_SUMMARY";
  const session = await f.open(manager); await f.send(session);
  const file = manager.getSessionFile(), compacted = SessionManager.open(file).getBranch().findLast(entry => entry.type === "compaction");
  assert.ok(compacted?.details.edupi_memory_summary_v1.mac);
  assert.ok(compacted.details.edupi_memory_summary_v1.memories.some(ref => ref.id === f.current[0].id));
  assert.equal(JSON.stringify(compacted.details).includes(KEEP), false, "provenance stores references and digests, never memory bodies");
  await session.dispose(); f.cold(); const cold = await f.open(SessionManager.open(file), false);
  const start = f.requests.length; f.control.inputTokens = 10; await f.send(cold, "SYNTHETIC_COLD_USER");
  const input = JSON.stringify(f.requests[start].messages);
  assert.equal(input.includes("SYNTHETIC_PREFERENCE_SUMMARY"), true, "stable existing owner key must verify the real persisted summary after rebuilding the adapter");
  assert.equal(input.includes("SYNTHETIC_CURRENT_REPLY"), true, "the retained assistant chain must survive cold reopen, not be blanket-held");
});

test("deleted automatic memory cannot revive through assistant echo, signed summary or cold history", { timeout: 20000 }, async t => {
  const f = await fixture(t), manager = SessionManager.create(f.root, path.join(f.root, "sessions"));
  const secret = { id: "memory-deleted", category: "class", content: `${DELETED} ${NAME}`, source_fingerprint: hash(DELETED),
    student_id: "student-deleted", student: NAME, managed_method: false };
  f.current.push(secret); seedHistory(manager, f.current);
  f.control.ordinaryText = `${DELETED} ${NAME}`; f.control.summaryText = `${DELETED} ${NAME} SYNTHETIC_OLD_SUMMARY`;
  const session = await f.open(manager); await f.send(session);
  const saved = SessionManager.open(manager.getSessionFile()).getBranch();
  assert.ok(saved.some(entry => entry.type === "custom" && entry.customType === "edupi_memory_output_v1"), "real message_end must persist host provenance before assistant output");
  assert.ok(saved.findLast(entry => entry.type === "compaction").details.edupi_memory_summary_v1.memories.some(ref => ref.id === secret.id));
  f.current.splice(f.current.indexOf(secret), 1);
  await session.dispose(); f.cold(); const cold = await f.open(SessionManager.open(manager.getSessionFile()), false);
  f.control.ordinaryText = "SYNTHETIC_AFTER_DELETE"; f.control.inputTokens = 10; const start = f.requests.length;
  await f.send(cold, "SYNTHETIC_AFTER_DELETE_USER");
  const input = JSON.stringify(f.requests[start].messages);
  assert.equal(input.includes(DELETED) || input.includes(NAME), false);
  assert.equal(input.includes(KEEP), true, "an unrelated current preference must remain available");
  assert.equal(fs.readFileSync(manager.getSessionFile(), "utf8").includes(DELETED), true, "privacy projection must not erase original historical evidence");
});

test("manual compact has no active recall capability and failures never fall back to the default raw summary", { timeout: 20000 }, async t => {
  const f = await fixture(t), manager = SessionManager.create(f.root, path.join(f.root, "sessions"));
  seedHistory(manager, [{ id: "old", category: "class", content: DELETED, source_fingerprint: hash(DELETED), student_id: null, student: NAME, managed_method: false }]);
  manager.appendMessage({ role: "user", content: "SYNTHETIC_MANUAL_TAIL", timestamp: Date.now() });
  manager.appendMessage(fauxAssistantMessage("SYNTHETIC_MANUAL_REPLY " + "bounded ".repeat(180)));
  const session = await f.open(manager, false), before = f.coreCalls; f.control.summaryFail = true;
  await assert.rejects(session.compact(), /cancel/i);
  assert.equal(f.coreCalls, before, "manual compaction must not expand recall beyond an active captured turn");
  assert.equal(f.summaries, 1, "failed custom summary must not invoke a second raw SDK fallback");
  assert.equal(JSON.stringify(f.requests).includes(DELETED), false);
  assert.equal(SessionManager.open(manager.getSessionFile()).getEntries().some(entry => entry.type === "compaction"), false);
  f.control.summaryFail = false; await session.compact();
  assert.ok(SessionManager.open(manager.getSessionFile()).getEntries().some(entry => entry.type === "compaction"), "safe manual compaction remains functional");
});

test("legacy summaries, unproved file paths and split-turn inputs are rebuilt without source resurrection", { timeout: 20000 }, async t => {
  const f = await fixture(t), manager = SessionManager.create(f.root, path.join(f.root, "sessions"));
  const first = manager.appendMessage({ role: "user", content: "SYNTHETIC_LEGACY_USER " + "history ".repeat(180), timestamp: Date.now() });
  manager.appendMessage(fauxAssistantMessage("SYNTHETIC_LEGACY_ANSWER"));
  manager.appendCompaction(`${DELETED} ${NAME}`, first, 700, { readFiles: [`/synthetic/${NAME}`], modifiedFiles: [] });
  manager.appendMessage({ role: "user", content: "SYNTHETIC_SPLIT_USER " + "prefix ".repeat(180), timestamp: Date.now() });
  manager.appendMessage(fauxAssistantMessage("SYNTHETIC_PREFIX " + "answer ".repeat(160)));
  manager.appendMessage(fauxAssistantMessage(fauxToolCall("read", { path: `/synthetic/${NAME}` }), { stopReason: "toolUse" }));
  manager.appendMessage({ role: "toolResult", toolCallId: "tool-call-0", toolName: "read", isError: false,
    content: [{ type: "text", text: "SYNTHETIC_READ_RESULT" }], timestamp: Date.now() });
  manager.appendMessage(fauxAssistantMessage("SYNTHETIC_TAIL"));
  let preparation;
  const session = await f.open(manager, false, [pi => pi.on("session_before_compact", event => { preparation = event.preparation; })]);
  await session.compact();
  assert.equal(preparation.isSplitTurn, true, "exercise the real SDK split-turn preparation, not a parallel helper");
  assert.equal(JSON.stringify(f.requests).includes(DELETED) || JSON.stringify(f.requests).includes(NAME), false);
  const result = SessionManager.open(manager.getSessionFile()).getEntries().findLast(entry => entry.type === "compaction");
  assert.equal(result.summary.includes(NAME) || result.summary.includes(DELETED), false);
  assert.deepEqual(result.details.readFiles, []);
});

test("non-EduPi sessions retain ordinary default SDK compaction and do not use the owner key", { timeout: 20000 }, async t => {
  const f = await fixture(t), other = path.join(f.root, "unrelated-project"); fs.mkdirSync(other);
  const manager = SessionManager.create(other, path.join(other, "sessions")); seedHistory(manager, []);
  const session = await f.open(manager, true, [], other); await session.prompt("SYNTHETIC_OTHER_PROJECT"); await session.waitForIdle();
  assert.ok(f.summaries > 0); assert.equal(f.coreCalls, 0);
  const result = SessionManager.open(manager.getSessionFile()).getEntries().findLast(entry => entry.type === "compaction");
  assert.equal(result.fromHook, false); assert.equal(result.details.edupi_memory_summary_v1, undefined);
});

test("virtual summary routing sees only sanitized input and preserves configured provider authentication", { timeout: 20000 }, async t => {
  const f = await fixture(t), manager = SessionManager.create(f.root, path.join(f.root, "sessions")), routes = [];
  f.runtime.registerVirtualModel({ provider: f.providerId, id: "selected-virtual", name: "Synthetic selected virtual model",
    contextWindow: 2048, maxTokens: 512, route: async request => {
      routes.push({ reason: request.reason, deleted: JSON.stringify(request.messages).includes(DELETED) });
      return { model: f.runtime.getPhysicalModel(f.providerId, "synthetic"), thinkingLevel: "off" };
    } });
  f.control.selectedModel = f.runtime.getModel(f.providerId, "selected-virtual");
  seedHistory(manager, [{ id: "old", category: "class", content: DELETED, source_fingerprint: hash(DELETED), student_id: null, student: NAME, managed_method: false }]);
  const session = await f.open(manager); await f.send(session);
  assert.ok(routes.some(route => route.reason === "direct"), "the selected virtual model must be routed for the actual SDK summary");
  assert.equal(routes.some(route => route.deleted), false);
  assert.ok(f.authenticated.length >= 2); assert.equal(f.authenticated.every(Boolean), true, "normal and summary calls must use the configured runtime authentication");
  assert.equal(session.model.id, "selected-virtual", "summarization must not replace the user's selected virtual model");
  assert.ok(routes.some(route => route.reason === "user"), "the ordinary resolver runs before the normal context hook and must be guarded too");
});

test("forged summary text, scope change and owner-key rotation cannot borrow persisted provenance", { timeout: 20000 }, async t => {
  const f = await fixture(t), manager = SessionManager.create(f.root, path.join(f.root, "sessions")); seedHistory(manager, f.current);
  const session = await f.open(manager); await f.send(session);
  const good = manager.getEntries().findLast(entry => entry.type === "compaction");
  manager.appendCompaction("SYNTHETIC_FORGED_SUMMARY", good.firstKeptEntryId, good.tokensBefore, structuredClone(good.details));
  session.setAutoCompactionEnabled(false); f.control.inputTokens = 10;
  let start = f.requests.length; await f.send(session, "SYNTHETIC_VERIFY_FORGED");
  assert.equal(JSON.stringify(f.requests[start].messages).includes("SYNTHETIC_FORGED_SUMMARY"), false);
  f.control.ordinaryText = "SYNTHETIC_SCOPE_BOUND_REPLY"; await f.send(session, "SYNTHETIC_BEFORE_SCOPE_CHANGE");
  f.control.grant = "synthetic-other-scope"; start = f.requests.length; await f.send(session, "SYNTHETIC_AFTER_SCOPE_CHANGE");
  assert.equal(JSON.stringify(f.requests[start].messages).includes("SYNTHETIC_SCOPE_BOUND_REPLY"), false);
  f.control.ordinaryText = "SYNTHETIC_KEY_BOUND_REPLY"; await f.send(session, "SYNTHETIC_BEFORE_KEY_ROTATION");
  const dir = path.join(f.stateDir, "edupi-owner-control"), keyFile = path.join(dir, fs.readdirSync(dir)[0]);
  fs.writeFileSync(keyFile, crypto.randomBytes(32).toString("base64url"), { mode: 0o600 });
  start = f.requests.length; await f.send(session, "SYNTHETIC_AFTER_KEY_ROTATION");
  assert.equal(JSON.stringify(f.requests[start].messages).includes("SYNTHETIC_KEY_BOUND_REPLY"), false);
});

test("source revocation during the actual summary request cancels persistence without default fallback", { timeout: 20000 }, async t => {
  const f = await fixture(t), manager = SessionManager.create(f.root, path.join(f.root, "sessions")); seedHistory(manager, f.current);
  f.control.beforeSummary = async () => { f.current.splice(0); };
  const session = await f.open(manager); await f.send(session);
  assert.equal(f.summaries, 1);
  assert.equal(manager.getEntries().some(entry => entry.type === "compaction"), false, "a revoked dependency cannot be sealed into a new persisted summary");
});

function virtual(f, routes) {
  f.runtime.registerVirtualModel({ provider: f.providerId, id: "selected-virtual", name: "Synthetic selected virtual model",
    contextWindow: 2048, maxTokens: 512, route: async request => {
      routes.push(structuredClone({ reason: request.reason, messages: request.messages, failed: request.failed, state: request.state }));
      return { model: f.runtime.getPhysicalModel(f.providerId, "synthetic"), thinkingLevel: "off" };
    } });
  return f.runtime.getModel(f.providerId, "selected-virtual");
}

test("public virtual guard survives setModel, reload, cold reopen and navigation without leaking old history", { timeout: 20000 }, async t => {
  const f = await fixture(t), manager = SessionManager.create(f.root, path.join(f.root, "sessions")), routes = [];
  seedHistory(manager, [{ id: "old", category: "class", content: DELETED, source_fingerprint: hash(DELETED), student_id: null, student: NAME, managed_method: false }]);
  const selected = virtual(f, routes), session = await f.open(manager, false); f.control.inputTokens = 10;
  await session.setModel(selected); await f.send(session, "SYNTHETIC_SWITCHED_MODEL");
  await session.reload(); await f.send(session, "SYNTHETIC_AFTER_RELOAD");
  const file = manager.getSessionFile(); await session.dispose(); f.cold();
  f.control.selectedModel = selected; const cold = await f.open(SessionManager.open(file), false);
  await f.send(cold, "SYNTHETIC_COLD_VIRTUAL");
  const entry = f.manager.getBranch().find(row => row.type === "message" && row.message.role === "user");
  assert.equal((await cold.navigateTree(entry.id)).cancelled, false);
  await f.send(cold, "SYNTHETIC_NAVIGATED_VIRTUAL");
  assert.equal(routes.length, 4, "all four actual SDK ordinary calls must invoke the selected resolver exactly once");
  assert.equal(JSON.stringify(routes).includes(DELETED) || JSON.stringify(routes).includes(NAME), false);
  assert.equal(f.ordinary, 4); assert.equal(f.authenticated.every(Boolean), true);
});

test("unproved virtual router state, direct streams and forged retry responses are held before any resolver call", { timeout: 20000 }, async t => {
  const f = await fixture(t), manager = SessionManager.create(f.root, path.join(f.root, "sessions")), routes = [];
  f.control.selectedModel = virtual(f, routes); f.control.inputTokens = 10;
  manager.appendCustomEntry("pi.virtual-model-state", { provider: f.providerId, modelId: "selected-virtual", state: { prior: DELETED } });
  const session = await f.open(manager, false); await f.send(session);
  assert.equal(routes.length, 0); assert.equal(f.requests.length, 0);
  assert.match(manager.getBranch().findLast(entry => entry.type === "message" && entry.message.role === "assistant").message.errorMessage, /memory_model_route_held/);
  await assert.rejects(f.services.modelRuntime.resolveModel(f.control.selectedModel, [], { reason: "retry", thinkingLevel: "off",
    failed: fauxAssistantMessage(DELETED, { stopReason: "error", errorMessage: DELETED }) }), /memory_model_route_held/);
  const streamHeld = await f.services.modelRuntime.streamSimple(f.control.selectedModel, { messages: [{ role: "user", content: DELETED, timestamp: 0 }] }).result();
  const completeHeld = await f.services.modelRuntime.completeSimple(f.control.selectedModel, { messages: [{ role: "user", content: DELETED, timestamp: 0 }] });
  for (const result of [streamHeld, completeHeld]) {
    assert.equal(result.stopReason, "error"); assert.match(result.errorMessage, /memory_model_route_held/);
  }
  assert.equal(routes.length, 0); assert.equal(f.requests.length, 0);
});

test("actual SDK virtual retry retains authenticated dispatch and refuses a revoked dependency", { timeout: 20000 }, async t => {
  const f = await fixture(t), manager = SessionManager.create(f.root, path.join(f.root, "sessions")), routes = [];
  f.control.selectedModel = virtual(f, routes); f.control.inputTokens = 10; f.control.retry = true; f.control.ordinaryFailures = 1;
  const session = await f.open(manager, false); await f.send(session);
  assert.equal(routes.length, 2); assert.equal(routes[1].reason, "retry");
  assert.ok(routes[1].failed, "the actual failed response must reach a retry only with host provenance");
  assert.equal(f.ordinary, 2); assert.equal(f.authenticated.every(Boolean), true);
  f.control.ordinaryFailures = 1;
  const off = session.subscribe(event => { if (event.type === "auto_retry_start") f.current.splice(0); });
  const start = routes.length, requests = f.requests.length; await f.send(session, "SYNTHETIC_REVOKED_RETRY"); off();
  assert.equal(routes.length - start, 1, "after source revocation the second resolver cannot inspect the failed response");
  assert.equal(f.requests.length - requests, 1, "held retry must not call the provider again");
});

test("old services and a scope change during Core await cannot borrow a new manager binding", { timeout: 20000 }, async t => {
  const f = await fixture(t), first = SessionManager.create(f.root, path.join(f.root, "sessions")), routes = [];
  f.control.selectedModel = virtual(f, routes); const session = await f.open(first, false), old = f.services.modelRuntime;
  const next = SessionManager.create(f.root, path.join(f.root, "sessions")), nextSession = await f.open(next, false);
  await assert.rejects(old.resolveModel(f.control.selectedModel, [], { reason: "user", thinkingLevel: "off" }), /memory_model_route_held/);
  assert.equal(routes.length, 0);
  f.control.beforeRecall = async () => { f.adapter.invalidate(next); };
  await f.send(nextSession, "SYNTHETIC_REVOKED_WHILE_ROUTING");
  assert.equal(routes.length, 0); assert.equal(f.requests.length, 0);
  const replacement = SessionManager.forkFrom(next.getSessionFile(), f.root, path.join(f.root, "sessions")), oldId = next.getSessionId();
  next.setSessionFile(replacement.getSessionFile()); assert.notEqual(next.getSessionId(), oldId);
  await assert.rejects(f.services.modelRuntime.resolveModel(f.control.selectedModel, [], { reason: "user", thinkingLevel: "off" }), /memory_model_route_held/);
  assert.equal(routes.length, 0, "reusing the same manager object for a different session cannot reuse its facade");
  await session.dispose();
});

test("missing existing owner key and an active held recall cancel automatic summaries without credential bootstrap", { timeout: 20000 }, async t => {
  const f = await fixture(t), manager = SessionManager.create(f.root, path.join(f.root, "sessions")); seedHistory(manager, f.current);
  const privateDir = path.join(f.stateDir, "edupi-owner-control"), file = path.join(privateDir, fs.readdirSync(privateDir)[0]);
  fs.unlinkSync(file);
  const session = await f.open(manager); await f.send(session);
  assert.equal(f.ordinary, 1); assert.equal(f.summaries, 0); assert.equal(fs.existsSync(file), false);
  assert.equal(manager.getEntries().some(entry => entry.type === "compaction"), false);
  loadOwnerControlToken(f.stateDir, f.root); f.control.coreHeld = true;
  const heldManager = SessionManager.create(f.root, path.join(f.root, "sessions")); seedHistory(heldManager, f.current);
  const held = await f.open(heldManager); await f.send(held, "SYNTHETIC_HELD_CAPTURE");
  assert.equal(f.ordinary, 2); assert.equal(f.summaries, 0);
  assert.equal(heldManager.getEntries().some(entry => entry.type === "compaction"), false);
});

test("aborting a real in-flight custom compaction prevents persistence and default retry", { timeout: 20000 }, async t => {
  const f = await fixture(t), manager = SessionManager.create(f.root, path.join(f.root, "sessions")); seedHistory(manager, []);
  manager.appendMessage({ role: "user", content: "SYNTHETIC_ABORT_TAIL", timestamp: Date.now() });
  manager.appendMessage(fauxAssistantMessage("SYNTHETIC_ABORT_REPLY " + "bounded ".repeat(180)));
  let entered, release;
  const waiting = new Promise(resolve => { entered = resolve; }), barrier = new Promise(resolve => { release = resolve; });
  f.control.beforeSummary = async () => { entered(); await barrier; };
  const session = await f.open(manager, false), operation = session.compact();
  const rejected = assert.rejects(operation, /cancel/i);
  try { await waiting; session.abortCompaction(); } finally { release(); }
  await rejected;
  assert.equal(f.summaries, 1); assert.equal(manager.getEntries().some(entry => entry.type === "compaction"), false);
});

test("protected branch summarization is explicitly held while ordinary tree navigation remains available", { timeout: 20000 }, async t => {
  const f = await fixture(t), manager = SessionManager.create(f.root, path.join(f.root, "sessions")); seedHistory(manager, []);
  const target = manager.getBranch().find(entry => entry.type === "message" && entry.message.role === "user").id;
  manager.appendMessage({ role: "user", content: "SYNTHETIC_OTHER_BRANCH", timestamp: Date.now() });
  manager.appendMessage(fauxAssistantMessage(`${DELETED} ${NAME}`));
  const session = await f.open(manager, false), leaf = manager.getLeafId();
  assert.equal((await session.navigateTree(target, { summarize: true })).cancelled, true);
  assert.equal(manager.getLeafId(), leaf); assert.equal(f.requests.length, 0);
  assert.equal((await session.navigateTree(target)).cancelled, false);
});

test("a real independent session fork cannot borrow copied summary or assistant provenance", { timeout: 20000 }, async t => {
  const f = await fixture(t), manager = SessionManager.create(f.root, path.join(f.root, "sessions")); seedHistory(manager, f.current);
  f.control.ordinaryText = "SYNTHETIC_PARENT_SIGNED_REPLY"; f.control.summaryText = "SYNTHETIC_PARENT_SIGNED_SUMMARY";
  const session = await f.open(manager); await f.send(session); await session.dispose();
  const fork = SessionManager.forkFrom(manager.getSessionFile(), f.root, path.join(f.root, "sessions"));
  assert.notEqual(fork.getSessionId(), manager.getSessionId());
  f.cold(); const child = await f.open(fork, false); f.control.inputTokens = 10; const start = f.requests.length;
  await f.send(child, "SYNTHETIC_CHILD_USER");
  const input = JSON.stringify(f.requests[start].messages);
  assert.equal(input.includes("SYNTHETIC_PARENT_SIGNED_REPLY") || input.includes("SYNTHETIC_PARENT_SIGNED_SUMMARY"), false);
  assert.equal(input.includes(KEEP), true, "a fork still gets independently captured current recall, not parent proof authority");
});

test("changed assistant bytes and edited user provenance cannot reuse a valid host signature", { timeout: 20000 }, async t => {
  const f = await fixture(t), manager = SessionManager.create(f.root, path.join(f.root, "sessions")); f.control.inputTokens = 10;
  const session = await f.open(manager, false); await f.send(session);
  const assistant = manager.getBranch().findLast(entry => entry.type === "message" && entry.message.role === "assistant");
  manager.appendContextEdit(assistant.id, { content: `${DELETED} ${NAME}` });
  let start = f.requests.length; await f.send(session, "SYNTHETIC_EDITED_ASSISTANT_USER");
  assert.equal(JSON.stringify(f.requests[start].messages).includes(DELETED), false);
  const user = manager.getBranch().findLast(entry => entry.type === "message" && entry.message.role === "user");
  f.control.ordinaryText = "SYNTHETIC_OLD_USER_BOUND_REPLY"; await f.send(session, "SYNTHETIC_NEW_SIGNED_USER");
  const newUser = manager.getBranch().findLast(entry => entry.type === "message" && entry.message.role === "user");
  manager.appendContextEdit(newUser.id, { content: "SYNTHETIC_REVISED_USER" });
  start = f.requests.length; await f.send(session, "SYNTHETIC_VERIFY_EDITED_USER");
  assert.equal(JSON.stringify(f.requests[start].messages).includes("SYNTHETIC_OLD_USER_BOUND_REPLY"), false);
  assert.notEqual(user.id, newUser.id);
});

test("non-EduPi virtual routing retains the SDK's unmodified public behavior", { timeout: 20000 }, async t => {
  const f = await fixture(t), other = path.join(f.root, "ordinary-project"), routes = []; fs.mkdirSync(other);
  const manager = SessionManager.create(other, path.join(other, "sessions")); f.control.selectedModel = virtual(f, routes); f.control.inputTokens = 10;
  const session = await f.open(manager, false, [], other);
  await session.prompt(`SYNTHETIC_OTHER_PROJECT_${DELETED}`); await session.waitForIdle();
  assert.equal(routes.length, 1); assert.equal(JSON.stringify(routes).includes(DELETED), true);
  assert.equal(f.coreCalls, 0); assert.equal(f.ordinary, 1);
});

test("real SDK overflow recovery uses the same safe custom compaction and resumes the selected model", { timeout: 20000 }, async t => {
  const f = await fixture(t), manager = SessionManager.create(f.root, path.join(f.root, "sessions"));
  seedHistory(manager, [{ id: "old", category: "class", content: DELETED, source_fingerprint: hash(DELETED), student_id: null, student: NAME, managed_method: false }]);
  f.control.ordinaryOverflows = 1; f.control.inputTokens = 10;
  const session = await f.open(manager); await f.send(session);
  assert.equal(f.ordinary, 2, "SDK must actually retry the original turn after overflow recovery");
  assert.ok(f.summaries > 0); assert.equal(JSON.stringify(f.requests).includes(DELETED) || JSON.stringify(f.requests).includes(NAME), false);
  assert.ok(manager.getEntries().some(entry => entry.type === "compaction" && entry.fromHook));
  assert.equal(session.model.id, "synthetic"); assert.equal(f.authenticated.every(Boolean), true);
});

test("new non-memory conversation history compacts and remains usable after cold reopening", { timeout: 20000 }, async t => {
  const f = await fixture(t), manager = SessionManager.create(f.root, path.join(f.root, "sessions")); f.current.splice(0);
  f.control.inputTokens = 10; f.control.ordinaryText = "SYNTHETIC_NORMAL_FIRST_REPLY";
  const session = await f.open(manager, false); await f.send(session, "SYNTHETIC_NORMAL_FIRST_USER " + "padding ".repeat(180));
  f.control.ordinaryText = "SYNTHETIC_NORMAL_SECOND_REPLY"; await f.send(session, "SYNTHETIC_NORMAL_SECOND_USER");
  f.control.ordinaryText = "SYNTHETIC_NORMAL_THIRD_REPLY " + "bounded ".repeat(180); f.control.inputTokens = 3000; session.setAutoCompactionEnabled(true);
  const lifecycle = []; session.subscribe(event => { if (event.type.includes("compaction")) lifecycle.push({ type: event.type, errorMessage: event.errorMessage }); });
  await f.send(session, "SYNTHETIC_NORMAL_THIRD_USER");
  const compacted = manager.getEntries().findLast(entry => entry.type === "compaction");
  assert.ok(compacted, JSON.stringify({ ordinary: f.ordinary, summaries: f.summaries, lifecycle }));
  assert.deepEqual(compacted.details.edupi_memory_summary_v1.memories, []);
  const summaryInput = f.requests.find(value => JSON.stringify(value.messages).includes("<conversation>"));
  assert.equal(JSON.stringify(summaryInput.messages).includes("SYNTHETIC_NORMAL_FIRST_REPLY"), true, "new normal assistant messages are retained, not blanket-held");
  await session.dispose(); f.cold(); const cold = await f.open(SessionManager.open(manager.getSessionFile()), false);
  f.control.inputTokens = 10; const start = f.requests.length; await f.send(cold, "SYNTHETIC_NORMAL_COLD_USER");
  const input = JSON.stringify(f.requests[start].messages);
  assert.equal(input.includes("SYNTHETIC_SAFE_COMPACTION"), true); assert.equal(input.includes("SYNTHETIC_NORMAL_THIRD_REPLY"), true);
});

test("non-revalidatable tool output cannot acquire permanent memory authority through a signed assistant or summary", { timeout: 20000 }, async t => {
  const f = await fixture(t), manager = SessionManager.create(f.root, path.join(f.root, "sessions"));
  let toolCalls = 0;
  const tool = pi => pi.registerTool({ name: "synthetic_read", label: "Synthetic local read", description: "Synthetic source with no Core provenance",
    parameters: Type.Object({}), execute: async () => { toolCalls++; return { content: [{ type: "text", text: `${DELETED} ${NAME}` }] }; } });
  f.control.ordinaryTool = "synthetic_read"; f.control.ordinaryText = wire => wire.includes(DELETED) ? `${DELETED} ${NAME}` : "SYNTHETIC_SAFE_REPLY";
  f.control.summaryText = wire => wire.includes(DELETED) ? `${DELETED} ${NAME}` : "SYNTHETIC_SAFE_SUMMARY";
  const session = await f.open(manager, true, [tool]); session.setActiveToolsByName(["synthetic_read"]);
  await f.send(session, "SYNTHETIC_CURRENT_TOOL_USER " + "padding ".repeat(180));
  assert.equal(toolCalls, 1, "exercise a real SDK tool execution and resumed assistant, not raw fixture insertion");
  assert.equal(f.requests.some(value => JSON.stringify(value.messages).includes(DELETED)), true, "the initial authorized current tool result really reached the model");
  session.setAutoCompactionEnabled(false); f.control.inputTokens = 10; const start = f.requests.length;
  await f.send(session, "SYNTHETIC_NEXT_TOOL_USER");
  assert.equal(JSON.stringify(f.requests[start].messages).includes(DELETED) || JSON.stringify(f.requests[start].messages).includes(NAME), false,
    "unknown tool source must not be certified permanently by unrelated memory references");
});

test("actual builtin read is usable in its captured turn but replaced source and derived output are held in manual and cold input", { timeout: 20000 }, async t => {
  const f = await fixture(t), manager = SessionManager.create(f.root, path.join(f.root, "sessions")), file = path.join(f.root, "synthetic-source.txt");
  fs.writeFileSync(file, `${DELETED} ${NAME}`, { mode: 0o600 });
  f.control.builtinRead = true; f.control.ordinaryTool = { name: "read", arguments: { path: file } }; f.control.inputTokens = 10;
  f.control.ordinaryText = wire => wire.includes(DELETED) ? `${DELETED} ${NAME} ` + "bounded ".repeat(180) : "SYNTHETIC_SAFE_REPLY";
  f.control.summaryText = wire => wire.includes(DELETED) ? `${DELETED} ${NAME}` : "SYNTHETIC_SAFE_SUMMARY";
  const session = await f.open(manager, false); session.setActiveToolsByName(["read"]);
  let reads = 0; session.subscribe(event => { if (event.type === "tool_execution_end" && event.toolName === "read") reads++; });
  await f.send(session, "SYNTHETIC_READ_OWN_SOURCE " + "padding ".repeat(180));
  assert.equal(reads, 1); assert.equal(JSON.stringify(f.requests[1].messages).includes(DELETED), true);
  const output = manager.getEntries().findLast(entry => entry.type === "custom" && entry.customType === "edupi_memory_output_v1");
  assert.match(output.data.turnKey, /^sha256:[a-f0-9]{64}$/u);
  fs.writeFileSync(file, "SYNTHETIC_REPLACED_SOURCE", { mode: 0o600 });
  let start = f.requests.length; await session.compact();
  assert.ok(f.requests.length > start); assert.equal(JSON.stringify(f.requests.slice(start)).includes(DELETED), false,
    "manual compaction cannot use turn-only proof after the original capture has ended, even with the same latest user");
  await session.dispose(); f.cold(); const cold = await f.open(SessionManager.open(manager.getSessionFile()), false);
  start = f.requests.length; await f.send(cold, "SYNTHETIC_AFTER_COLD_REPLACEMENT");
  assert.equal(JSON.stringify(f.requests[start].messages).includes(DELETED) || JSON.stringify(f.requests[start].messages).includes(NAME), false);
  assert.equal(fs.readFileSync(manager.getSessionFile(), "utf8").includes(DELETED), true, "the original evidence and visible history are not erased");
});

test("ordinary uncaptured builtin reads keep the current multi-step turn usable without gaining Core recall or permanent source authority", { timeout: 20000 }, async t => {
  const f = await fixture(t), manager = SessionManager.create(f.root, path.join(f.root, "sessions"));
  const first = path.join(f.root, "synthetic-first.txt"), second = path.join(f.root, "synthetic-second.txt");
  fs.writeFileSync(first, `${DELETED} ${NAME}`, { mode: 0o600 }); fs.writeFileSync(second, "SYNTHETIC_SECOND_READ", { mode: 0o600 });
  f.control.builtinRead = true; f.control.inputTokens = 10;
  f.control.ordinaryTool = [{ name: "read", arguments: { path: first } }, { name: "read", arguments: { path: second } }];
  f.control.ordinaryText = wire => wire.includes(DELETED) ? `${DELETED} ${NAME} ` + "bounded ".repeat(180) : "SYNTHETIC_SAFE_REPLY";
  f.control.summaryText = wire => wire.includes(DELETED) ? `${DELETED} ${NAME}` : "SYNTHETIC_SAFE_SUMMARY";
  const session = await f.open(manager, false); session.setActiveToolsByName(["read"]);
  let reads = 0; session.subscribe(event => { if (event.type === "tool_execution_end" && event.toolName === "read") reads++; });
  await f.send(session, "SYNTHETIC_ORDINARY_READ_USER " + "padding ".repeat(180), false);
  assert.equal(reads, 2); assert.equal(f.ordinary, 3); assert.equal(f.coreCalls, 0);
  assert.equal(JSON.stringify(f.requests[2].messages).includes(DELETED), true, "second continuation still gets the current first read result");
  assert.equal(JSON.stringify(f.requests[2].messages).includes("SYNTHETIC_SECOND_READ"), true);
  fs.writeFileSync(first, "SYNTHETIC_REPLACED_SOURCE", { mode: 0o600 });
  let start = f.requests.length; await session.compact();
  assert.equal(JSON.stringify(f.requests.slice(start)).includes(DELETED), false);
  await session.dispose(); f.cold(); const cold = await f.open(SessionManager.open(manager.getSessionFile()), false);
  start = f.requests.length; await f.send(cold, "SYNTHETIC_ORDINARY_COLD_USER", false);
  assert.equal(JSON.stringify(f.requests[start].messages).includes(DELETED), false); assert.equal(f.coreCalls, 0);
});

function mutationReceipt(f, name) {
  const recordFile = path.join(f.root, `synthetic-${name}-receipt.json`), calls = [];
  const result = { name, recordFile, calls, afterMutation: null };
  const record = value => {
    calls.push(value); fs.writeFileSync(recordFile, JSON.stringify(value), { mode: 0o600 }); result.afterMutation?.();
  };
  if (name === "memory_write") {
    result.arguments = { category: "preferences", content: "SYNTHETIC_EXPLICIT_PREFERENCE" };
    result.text = "已记住。";
    result.tool = createMemoryWriteTool(f.root, async value => { record(value); return { ok: true, id: "synthetic-written-memory", count: 1 }; });
  } else if (name === "memory_forget") {
    result.arguments = { category: "preferences", query: "SYNTHETIC_EXPLICIT_PREFERENCE" };
    result.text = "已删除 1 条记忆。";
    result.tool = createMemoryForgetTool(f.root, {
      read: async () => ({ continuity: { memories: [{ id: "synthetic-forgotten-memory", category: "preferences",
        content: result.arguments.query, tags: [], state: "active" }] } }),
      remove: async value => { record({ id: value.id, removed: true }); },
    });
  } else {
    assert.equal(name, "student_note");
    result.arguments = {};
    result.text = "SYNTHETIC_STUDENT_NOTE_RECORDED";
    result.tool = { name, label: "Synthetic legacy student note", description: "Synthetic receipt without Core recall identity", parameters: Type.Object({}),
      execute: async () => { record({ id: "synthetic-note", saved: true }); return { content: [{ type: "text", text: result.text }], details: { saved: true } }; } };
  }
  result.extension = pi => pi.registerTool(result.tool);
  return result;
}

for (const name of ["memory_write", "memory_forget", "student_note"]) test(`real SDK ${name} receipt stays exact in its current turn and cannot become historical memory authority`, { timeout: 20000 }, async t => {
  for (const [ownerKey, selectedVirtual] of [[true, false], [false, false], [false, true]]) {
    const f = await fixture(t, { ownerKey }), manager = SessionManager.create(f.root, path.join(f.root, "sessions"));
    const mutation = mutationReceipt(f, name), echo = `SYNTHETIC_${name}_RECEIPT_ECHO`, routes = [];
    f.current.splice(0); f.control.inputTokens = 10;
    manager.appendMessage({ role: "user", content: "SYNTHETIC_OLD_MUTATION_USER", timestamp: Date.now() });
    manager.appendMessage(fauxAssistantMessage(fauxToolCall(name, mutation.arguments), { stopReason: "toolUse" }));
    manager.appendMessage({ role: "toolResult", toolCallId: "tool-call-0", toolName: name, isError: false,
      content: [{ type: "text", text: DELETED }], details: { ok: true }, timestamp: Date.now() });
    if (selectedVirtual) f.control.selectedModel = virtual(f, routes);
    f.control.ordinaryTool = { name, arguments: mutation.arguments };
    f.control.ordinaryText = wire => wire.includes(mutation.text) ? echo + " bounded ".repeat(180) : "SYNTHETIC_RECEIPT_NOT_SEEN";
    const session = await f.open(manager, false, [mutation.extension]); session.setActiveToolsByName([name]);
    await f.send(session, "SYNTHETIC_CURRENT_MUTATION_USER " + "padding ".repeat(180), false);
    assert.equal(mutation.calls.length, 1, "the actual SDK tool executes exactly once");
    assert.deepEqual(JSON.parse(fs.readFileSync(mutation.recordFile, "utf8")), mutation.calls[0], "the mutation is already persisted before the continuation");
    assert.equal(f.ordinary, 2); assert.equal(f.coreCalls, 0, "a local receipt must not manufacture Core recall identity");
    const receipt = manager.getBranch().findLast(entry => entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolName === name);
    assert.equal(receipt.message.content[0].text, mutation.text, "the stored raw result remains intact");
    const forwarded = f.requests[1].messages.filter(message => message.role === "tool");
    assert.equal(forwarded.length, 1, "the current persisted receipt must reach the resumed model");
    assert.equal(forwarded[0].content, mutation.text, "the context guard must preserve the exact tool body");
    assert.equal(JSON.stringify(f.requests).includes(DELETED), false, "current receipt admission cannot validate an older mutation result");
    const output = manager.getEntries().findLast(entry => entry.type === "custom" && entry.customType === "edupi_memory_output_v1");
    if (ownerKey) assert.match(output.data.turnKey, /^sha256:[a-f0-9]{64}$/u);
    else assert.equal(output, undefined, "no persistent owner signature may be invented for a current receipt");
    const assertHeld = requests => {
      const wire = JSON.stringify(requests); assert.equal(wire.includes(mutation.text) || wire.includes(echo), false);
    };
    if (selectedVirtual) {
      const start = routes.length;
      await f.adapter.run(manager, { message: "SYNTHETIC_CURRENT_MUTATION_USER", clientRequestId: crypto.randomUUID() }, false,
        () => f.services.modelRuntime.resolveModel(f.control.selectedModel, [], { reason: "user", thinkingLevel: "off" }));
      assert.equal(routes.length, start + 1);
      assertHeld(routes.slice(start));
      assert.equal(manager.getBranch().findLast(entry => entry.type === "message" && entry.message.role === "user").message.content[0].text,
        "SYNTHETIC_CURRENT_MUTATION_USER " + "padding ".repeat(180), "a new local nonce cannot re-authorize the unchanged previous SDK user entry");
    }
    let start = f.requests.length;
    if (ownerKey) { await session.compact(); assert.ok(f.requests.length > start); }
    else { await assert.rejects(session.compact(), /cancel/i); assert.equal(f.requests.length, start); }
    assertHeld(f.requests.slice(start));
    start = f.requests.length; await f.send(session, "SYNTHETIC_NEXT_MUTATION_USER", false); assertHeld(f.requests.slice(start));
    await session.dispose(); f.cold(); const cold = await f.open(SessionManager.open(manager.getSessionFile()), false);
    start = f.requests.length; await f.send(cold, "SYNTHETIC_COLD_MUTATION_USER", false); assertHeld(f.requests.slice(start));
    assert.equal(f.coreCalls, 0); assert.equal(fs.existsSync(path.join(f.stateDir, "edupi-owner-control")), ownerKey);
  }
});

test("automatic compaction cannot certify mutation receipts or their assistant echo while the source turn is still active", { timeout: 20000 }, async t => {
  for (const name of ["memory_write", "memory_forget", "student_note"]) {
    const f = await fixture(t), manager = SessionManager.create(f.root, path.join(f.root, "sessions")), mutation = mutationReceipt(f, name);
    const echo = `SYNTHETIC_ACTIVE_${name}_ECHO`;
    f.current.splice(0); f.control.ordinaryTool = { name, arguments: mutation.arguments };
    f.control.ordinaryText = wire => wire.includes(mutation.text) ? echo + " bounded ".repeat(180) : "SYNTHETIC_RECEIPT_NOT_SEEN";
    const session = await f.open(manager, true, [mutation.extension]); session.setActiveToolsByName([name]);
    await f.send(session, "SYNTHETIC_ACTIVE_MUTATION_USER " + "padding ".repeat(180), false);
    assert.equal(mutation.calls.length, 1); assert.equal(f.ordinary, 2); assert.ok(f.summaries > 0);
    assert.equal(JSON.stringify(f.requests[1].messages).includes(mutation.text), true);
    const summaries = f.requests.filter(request => {
      const wire = JSON.stringify(request.messages);
      return wire.includes("<conversation>") || wire.includes("The messages above are earlier context from an ongoing conversation.");
    });
    assert.ok(summaries.length > 0);
    assert.equal(JSON.stringify(summaries).includes(mutation.text) || JSON.stringify(summaries).includes(echo), false, name);
    assert.deepEqual(manager.getEntries().findLast(entry => entry.type === "compaction").details.edupi_memory_summary_v1.memories, []);
    assert.equal(f.coreCalls, 0);
  }
});

test("a mutation may invalidate recalled source without erasing its independently bound current receipt", { timeout: 20000 }, async t => {
  for (const name of ["memory_write", "memory_forget", "student_note"]) {
    const f = await fixture(t), manager = SessionManager.create(f.root, path.join(f.root, "sessions")), mutation = mutationReceipt(f, name);
    const echo = `SYNTHETIC_CHANGED_SOURCE_${name}_RECEIPT_ECHO`;
    f.current[0].content = DELETED; f.current[0].source_fingerprint = hash(DELETED);
    mutation.afterMutation = () => { f.current.splice(0); };
    f.control.inputTokens = 10; f.control.ordinaryTool = { name, arguments: mutation.arguments };
    f.control.ordinaryText = wire => wire.includes(mutation.text) ? echo : "SYNTHETIC_RECEIPT_NOT_SEEN";
    const session = await f.open(manager, false, [mutation.extension]); session.setActiveToolsByName([name]);
    await f.send(session, "SYNTHETIC_MUTATION_CHANGES_CURRENT_SOURCE " + "padding ".repeat(180));
    assert.equal(mutation.calls.length, 1); assert.equal(f.ordinary, 2);
    assert.equal(JSON.stringify(f.requests[0].messages).includes(DELETED), true, "the initial recall was current before this mutation");
    const continuation = JSON.stringify(f.requests[1].messages);
    assert.equal(continuation.includes(DELETED), false, "revoked source and its assistant/tool-call derivation must remain held");
    assert.equal(continuation.includes(mutation.text), true, "source invalidation does not undo the separately persisted mutation");
    assert.equal(f.requests[1].messages.some(message => message.role === "tool"), false, "a held assistant call must not leave an orphaned tool message");
    const output = manager.getEntries().findLast(entry => entry.type === "custom" && entry.customType === "edupi_memory_output_v1");
    assert.deepEqual(output.data.memories, []); assert.match(output.data.turnKey, /^sha256:[a-f0-9]{64}$/u);
    let start = f.requests.length; await f.send(session, "SYNTHETIC_AFTER_CHANGED_SOURCE_MUTATION");
    assert.equal(JSON.stringify(f.requests.slice(start)).includes(mutation.text) || JSON.stringify(f.requests.slice(start)).includes(echo), false);
  }
});

test("a current SDK memory_recall body still needs current Core entries and cannot use mutation-receipt admission", { timeout: 20000 }, async t => {
  const f = await fixture(t), manager = SessionManager.create(f.root, path.join(f.root, "sessions"));
  f.current.splice(0); f.control.inputTokens = 10; f.control.ordinaryTool = "memory_recall";
  const extension = pi => pi.registerTool({ name: "memory_recall", label: "Synthetic unproved recall", description: "Synthetic unproved memory source",
    parameters: Type.Object({}), execute: async () => ({ content: [{ type: "text", text: DELETED }],
      details: { entries: [{ id: "synthetic-forged-memory", category: "preferences", source_fingerprint: hash(DELETED), content: DELETED }] } }) });
  const session = await f.open(manager, false, [extension]); session.setActiveToolsByName(["memory_recall"]);
  await f.send(session, "SYNTHETIC_UNCAPTURED_RECALL_USER", false);
  assert.equal(f.ordinary, 2); assert.equal(f.coreCalls, 0);
  assert.equal(JSON.stringify(f.requests).includes(DELETED), false);
  assert.equal(fs.readFileSync(manager.getSessionFile(), "utf8").includes(DELETED), true, "the original unproved result remains evidence, not model authority");
});

test("current mutation receipts cannot borrow edited, duplicated or invalidated SDK source entries", { timeout: 20000 }, async t => {
  for (const change of ["tool-edit", "tool-noop-edit", "duplicate", "user-edit", "invalidate"]) {
    const f = await fixture(t), manager = SessionManager.create(f.root, path.join(f.root, "sessions")), mutation = mutationReceipt(f, "memory_write");
    f.current.splice(0); f.control.inputTokens = 10; f.control.ordinaryTool = { name: "memory_write", arguments: mutation.arguments };
    mutation.afterMutation = () => { f.control.beforeRecall = async () => {
      const receipt = manager.getBranch().findLast(entry => entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolName === "memory_write");
      assert.ok(receipt, "the original SDK result must exist before the next context recheck");
      if (change === "tool-edit" || change === "tool-noop-edit") manager.appendContextEdit(receipt.id,
        { content: change === "tool-edit" ? [{ type: "text", text: "SYNTHETIC_FORGED_MUTATION_RECEIPT" }] : structuredClone(receipt.message.content) });
      if (change === "duplicate") manager.appendMessage(structuredClone(receipt.message));
      if (change === "user-edit") {
        const user = manager.getBranch().findLast(entry => entry.type === "message" && entry.message.role === "user");
        manager.appendContextEdit(user.id, { content: "SYNTHETIC_CHANGED_CURRENT_USER" });
      }
      if (change === "invalidate") f.adapter.invalidate(manager);
    }; };
    const session = await f.open(manager, false, [mutation.extension]); session.setActiveToolsByName(["memory_write"]);
    await f.send(session, "SYNTHETIC_MUTATION_SOURCE_FENCE");
    assert.equal(mutation.calls.length, 1); assert.equal(f.ordinary, 2, change);
    const continued = JSON.stringify(f.requests[1].messages);
    assert.equal(continued.includes(mutation.text) || continued.includes("SYNTHETIC_FORGED_MUTATION_RECEIPT"), false, change);
  }
});

for (const [ownerKey, selectedVirtual] of [[false, false], [true, false], [false, true]]) test(`current ordinary SDK tool chains survive ${ownerKey ? "with" : "without"} an existing owner key through ${selectedVirtual ? "virtual" : "physical"} routing but never become historical source proof`, { timeout: 20000 }, async t => {
  const f = await fixture(t, { ownerKey }), manager = SessionManager.create(f.root, path.join(f.root, "sessions"));
  const first = path.join(f.root, "synthetic-current-first.txt"), second = path.join(f.root, "synthetic-current-second.txt");
  const firstBody = "SYNTHETIC_CURRENT_FIRST_SOURCE", secondBody = "SYNTHETIC_CURRENT_SECOND_SOURCE", echo = "SYNTHETIC_CURRENT_SOURCE_ECHO";
  fs.writeFileSync(first, firstBody, { mode: 0o600 }); fs.writeFileSync(second, secondBody, { mode: 0o600 });
  manager.appendMessage({ role: "user", content: "SYNTHETIC_UNPROVED_OLD_USER", timestamp: Date.now() });
  manager.appendMessage(fauxAssistantMessage(fauxToolCall("synthetic_unknown", {}), { stopReason: "toolUse" }));
  manager.appendMessage({ role: "toolResult", toolCallId: "tool-call-0", toolName: "synthetic_unknown", isError: false,
    content: [{ type: "text", text: `${DELETED} ${NAME}` }], timestamp: Date.now() });
  manager.appendMessage(fauxAssistantMessage(`${DELETED} ${NAME}`));
  f.control.builtinRead = true; f.control.inputTokens = 10;
  if (selectedVirtual) f.control.selectedModel = virtual(f, []);
  f.control.ordinaryTool = [{ name: "read", arguments: { path: first } }, { name: "read", arguments: { path: second } }];
  f.control.ordinaryText = wire => wire.includes(firstBody) ? `${echo} ` + "bounded ".repeat(180) : "SYNTHETIC_SAFE_REPLY";
  const session = await f.open(manager, false); session.setActiveToolsByName(["read"]);
  await f.send(session, "SYNTHETIC_CURRENT_SOURCE_USER " + "padding ".repeat(180), false);
  assert.equal(f.ordinary, 3); assert.equal(f.coreCalls, 0);
  assert.equal(JSON.stringify(f.requests[1].messages).includes(firstBody), true, "the first real read result must reach the next provider request");
  assert.equal(JSON.stringify(f.requests[2].messages).includes(firstBody), true, "the same run must retain its first tool step");
  assert.equal(JSON.stringify(f.requests[2].messages).includes(secondBody), true);
  assert.equal(JSON.stringify(f.requests).includes(DELETED) || JSON.stringify(f.requests).includes(NAME), false, "current-run proof cannot certify old unknown tools");
  const saved = SessionManager.open(manager.getSessionFile()).getEntries();
  assert.equal(saved.filter(entry => entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolName === "read").length, 2);
  assert.equal(saved.some(entry => entry.type === "custom" && entry.customType === "edupi_memory_output_v1"), ownerKey,
    "private current-run proof is never persisted in place of the missing owner signature");
  const assertHeld = values => { const wire = JSON.stringify(values); assert.equal(wire.includes(firstBody) || wire.includes(secondBody) || wire.includes(echo), false); };
  let start = f.requests.length;
  if (ownerKey) { await session.compact(); assert.ok(f.requests.length > start); }
  else { await assert.rejects(session.compact(), /cancel/i); assert.equal(f.requests.length, start); }
  assertHeld(f.requests.slice(start));
  start = f.requests.length;
  await f.send(session, "SYNTHETIC_NEXT_SOURCE_USER", false); assertHeld(f.requests.slice(start));
  await session.dispose(); f.cold(); const cold = await f.open(SessionManager.open(manager.getSessionFile()), false);
  start = f.requests.length; await f.send(cold, "SYNTHETIC_COLD_SOURCE_USER", false); assertHeld(f.requests.slice(start));
  const fork = SessionManager.forkFrom(manager.getSessionFile(), f.root, path.join(f.root, "sessions"));
  f.cold(); const child = await f.open(fork, false);
  start = f.requests.length; await f.send(child, "SYNTHETIC_FORK_SOURCE_USER", false); assertHeld(f.requests.slice(start));
  assert.equal(f.coreCalls, 0);
  assert.equal(fs.existsSync(path.join(f.stateDir, "edupi-owner-control")), ownerKey, "no current-run operation may bootstrap an owner credential");
});

test("real executeBash history cannot reintroduce a replaced source through the next ordinary model context", { timeout: 20000 }, async t => {
  const f = await fixture(t), manager = SessionManager.create(f.root, path.join(f.root, "sessions")), file = path.join(f.root, "synthetic-shell-source.txt");
  fs.writeFileSync(file, `${DELETED} ${NAME}`, { mode: 0o600 });
  f.control.inputTokens = 10; const session = await f.open(manager, false);
  const result = await session.executeBash("cat ./synthetic-shell-source.txt");
  assert.equal(result.exitCode, 0); assert.equal(result.output.includes(DELETED), true);
  assert.ok(manager.getEntries().some(entry => entry.type === "message" && entry.message.role === "bashExecution"));
  fs.writeFileSync(file, "SYNTHETIC_REPLACED_SHELL_SOURCE", { mode: 0o600 });
  await f.send(session, "SYNTHETIC_AFTER_SHELL_USER", false);
  assert.equal(JSON.stringify(f.requests[0].messages).includes(DELETED) || JSON.stringify(f.requests[0].messages).includes(NAME), false);
  assert.equal(fs.readFileSync(manager.getSessionFile(), "utf8").includes(DELETED), true); assert.equal(f.coreCalls, 0);
});

test("public custom messages without host source proof remain in history but cannot mint assistant memory authority", { timeout: 20000 }, async t => {
  const f = await fixture(t), manager = SessionManager.create(f.root, path.join(f.root, "sessions")); f.control.inputTokens = 10;
  const session = await f.open(manager, false);
  await session.sendCustomMessage({ customType: "synthetic-unproved-source", content: `${DELETED} ${NAME}`, display: false });
  await f.send(session, "SYNTHETIC_AFTER_CUSTOM_USER", false);
  assert.equal(JSON.stringify(f.requests[0].messages).includes(DELETED) || JSON.stringify(f.requests[0].messages).includes(NAME), false);
  assert.equal(fs.readFileSync(manager.getSessionFile(), "utf8").includes(DELETED), true); assert.equal(f.coreCalls, 0);
});

test("a throwing initial capture recheck explicitly cancels SDK compaction instead of being swallowed into raw fallback", { timeout: 20000 }, async t => {
  const f = await fixture(t), manager = SessionManager.create(f.root, path.join(f.root, "sessions"));
  seedHistory(manager, [{ id: "old", category: "class", content: DELETED, source_fingerprint: hash(DELETED), student_id: null, student: NAME, managed_method: false }]);
  f.control.beforeOrdinaryResponse = async () => { f.control.outboxThrows = true; };
  const session = await f.open(manager); await f.send(session);
  assert.equal(f.ordinary, 1); assert.equal(f.summaries, 0, "the first guard read itself can fail; SDK must not execute its default summary");
  assert.equal(manager.getEntries().some(entry => entry.type === "compaction"), false);
});

test("public SDK input transformation binds the actual new user for local read without expanding raw Core capture authority", { timeout: 20000 }, async t => {
  for (const selectedVirtual of [false, true]) {
    const f = await fixture(t), manager = SessionManager.create(f.root, path.join(f.root, "sessions")), file = path.join(f.root, "synthetic-transformed-source.txt"), routes = [];
    fs.writeFileSync(file, `${DELETED} ${NAME}`, { mode: 0o600 });
    f.control.builtinRead = true; f.control.inputTokens = 10; f.control.ordinaryTool = { name: "read", arguments: { path: file } };
    if (selectedVirtual) f.control.selectedModel = virtual(f, routes);
    const original = "SYNTHETIC_INPUT_TRANSFORM", expanded = "SYNTHETIC_ACTUAL_EXPANDED_SDK_USER";
    const transform = pi => pi.on("input", event => event.text === original ? { action: "transform", text: expanded } : undefined);
    const session = await f.open(manager, false, [transform]); session.setActiveToolsByName(["read"]);
    await f.send(session, original);
    assert.equal(manager.getBranch().find(entry => entry.type === "message" && entry.message.role === "user").message.content[0].text, expanded);
    assert.equal(JSON.stringify(f.requests[1].messages).includes(DELETED), true, "legitimate SDK transformation must not hide the current read result");
    assert.equal(f.coreCalls, 0, "expanded text is not the captured raw text and must never acquire Core recall authority");
    const start = f.requests.length; await f.send(session, "SYNTHETIC_AFTER_TRANSFORM_USER", false);
    assert.equal(JSON.stringify(f.requests[start].messages).includes(DELETED), false); assert.equal(f.coreCalls, 0);
    if (selectedVirtual) { assert.equal(routes.length, 3); assert.equal(JSON.stringify(routes[2]).includes(DELETED), false); }
  }
});
