import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import ts from "typescript";
import { createJiti } from "jiti";

const source = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");
const draftSource = await readFile(new URL("../lib/draft-store.ts", import.meta.url), "utf8");
const composer = await createJiti(import.meta.url).import("../lib/edupi-composer-context.ts");
const compile = code => ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const noop = () => {};
const plain = value => value == null ? value : JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));
const scope = (account = "account-a", generation = 1, issuer = "https://cloud.example") =>
  JSON.stringify(["cloud", issuer, account, "workspace-a", generation]);
const original = "  合成请求：完整原文\n参考内容\u2028😀\n";

function fixture({ newChat = false, persisted = new Map(), server = new Map(), generation = 1 } = {}) {
  let currentScope = scope("account-a", generation), writable = true, dropAck = false, queued = false, readGate = null;
  const store = {};
  vm.runInNewContext(compile(draftSource), {
    exports: store, window: {}, setTimeout: () => 1, clearTimeout: noop,
    require: name => name.endsWith("edupi-composer-context") ? composer : {
      APP_PREF_KEYS: { chatDrafts: "drafts" },
      getPrefJson: key => persisted.has(key) ? JSON.parse(persisted.get(key)) : null,
      trySetPrefJson: (key, value) => {
        if (!writable) return false;
        persisted.set(key, JSON.stringify(value));
        return true;
      },
    },
  });
  const keyFor = (value, id) => store.cloudChatDraftKey?.(value, id)
    ?? `${id}:${JSON.stringify(JSON.parse(value).slice(0, 4))}`;
  const draftKey = keyFor(currentScope, newChat ? "new:cloud:workspace-a" : "cloud-session");
  if (!store.getDraft(draftKey)) {
    store.setDraft(draftKey, { value: "老师输入", images: [] });
    store.flushDraftNow(draftKey);
  }
  const sent = [], reads = [], notices = [], promoted = [], localCalls = [];
  const coldDraft = key => JSON.parse(persisted.get("drafts") || "{}")[key] ?? null;
  const rowFor = (sid, id, message) => ({
    workspace_id: "workspace-a", actor_id: "account-a", session_id: sid, request_id: id,
    command: { type: "prompt", message, clientRequestId: id }, status: "completed",
  });
  const fetcher = async (url, init = {}) => {
    if (init.method !== "POST") {
      reads.push({ url, scope: new Headers(init.headers).get("x-edupi-cloud-scope") });
      if (readGate) await readGate;
      const sid = decodeURIComponent(url.split("/")[3].split("?")[0]);
      return { ok: true, status: 200, json: async () => ({
        sessionId: sid, filePath: `cloud:workspace-a/${sid}`, cloudScope: currentScope,
        requests: [...server.values()].filter(row => row.session_id === sid),
        context: { messages: [], entryIds: [], thinkingLevel: "off", model: null }, leafId: null, tree: [],
      }) };
    }
    const body = JSON.parse(init.body);
    const sid = url === "/api/agent/new" ? context.sessionIdRef.current : decodeURIComponent(url.split("/").at(-1));
    sent.push({ url, body, bytes: init.body, scope: new Headers(init.headers).get("x-edupi-cloud-scope"),
      durableBeforeRequest: plain(coldDraft(draftKey)?.pendingPrompt) });
    if (!queued) {
      const previous = server.get(body.clientRequestId);
      if (previous) assert.deepEqual(previous.command, rowFor(sid, body.clientRequestId, body.message).command);
      else server.set(body.clientRequestId, rowFor(sid, body.clientRequestId, body.message));
    }
    if (dropAck) throw new Error("synthetic lost ACK");
    return { ok: true, status: queued ? 202 : 200, json: async () => ({
      success: true, sessionId: sid, clientRequestId: body.clientRequestId, queued, pendingSync: queued, data: null,
    }) };
  };
  const context = {
    useCallback: callback => callback, ...store, globalThis: { crypto: webcrypto }, TextEncoder,
    fetch: fetcher, fetchWithRetry: (url, options) => fetcher(url, options?.init), Headers,
    agentEducationWriteHeaders: (initial, expected) => {
      const headers = new Headers(initial);
      headers.set("x-edupi-cloud-scope", expected ?? currentScope);
      return headers;
    },
    getEduPiEducationScopeVersion: () => generation,
    console: { error: noop }, setTimeout, clearTimeout,
    isNew: newChat, newSessionCwd: newChat ? "cloud:workspace-a" : null, newSessionModel: null,
    session: newChat ? null : { id: "cloud-session", path: "cloud:workspace-a/cloud-session",
      cwd: "cloud:workspace-a", cloudScope: currentScope },
    draftKey, activeDraftKeyRef: { current: draftKey },
    sessionIdRef: { current: newChat ? null : "cloud-session" }, sessionGenerationRef: { current: 0 },
    promptRunIdRef: { current: 0 }, promptSubmissionRunIdRef: { current: null }, promptRequestIdRef: { current: null },
    agentRunningRef: { current: false }, bashRunningRef: { current: false }, rpcPromptPendingRef: { current: false },
    sdkAgentActiveRef: { current: false }, newSessionModelOverrideRef: { current: null },
    thinkingLevelOverrideRef: { current: null }, newSessionPromotedRef: { current: false },
    ensuringNewSessionRef: { current: null },
    contextLoadIdRef: { current: 0 }, messageHistoryRef: { current: { messageIds: [] } },
    pendingScrollToUserRef: { current: false }, completionScrollAllowedRef: { current: false },
    executeBashRef: { current: () => localCalls.push("bash") }, isTauriDesktop: () => true,
    setLoading: noop, setAgentRunning: noop, setAgentPhase: noop, setPromptAnchorActive: noop,
    setData: noop, setActiveLeafId: noop, setCurrentModelOverride: noop, setError: noop, setThinkingLevel: noop,
    dispatch: noop, dispatchMessageHistory: noop, cancelEventStreamGrace: noop, closeEvents: noop,
    settleUiStage: noop, refreshPromptRecovery: noop,
    ensureNewSession: async () => { context.sessionIdRef.current = "cloud-session"; return "cloud-session"; },
    ensureEventsConnected: async () => {}, waitForPromptSettlement: noop,
    promoteNewSession: (...args) => promoted.push(args), loadSession: async () => null,
    addNotice: notice => notices.push(notice),
    sendAgentCommand: async (sid, command) => {
      if (command.type !== "prompt") throw new Error("cloud must not call local/config commands");
      return fetcher(`/api/agent/${sid}`, { method: "POST", body: JSON.stringify(command) });
    },
    persistEduPiPromptIntent: async () => { localCalls.push("intent"); throw new Error("local intent forbidden"); },
    reconcileEduPiCapturedPrompt: async () => { localCalls.push("reconcile"); throw new Error("local reconcile forbidden"); },
    sendEduPiCapturedPrompt: async () => { localCalls.push("send"); throw new Error("local Core forbidden"); },
    chatInputRef: { current: {
      isHoldingSubmission: () => true, isSubmittedDraftUnedited: () => true,
      acknowledgeSubmittedMessage: () => true, refreshPendingFailedMessages: noop,
      replaceMessage: () => false, preserveContextForSession: noop,
    } },
  };
  const ast = ts.createSourceFile("hook.ts", source, ts.ScriptTarget.Latest, true);
  const helpers = ast.statements.filter(node => ts.isFunctionDeclaration(node)
    && ["captureCloudPromptScope", "cloudSessionIdForRequest", "readCloudPromptReceipt"].includes(node.name?.text))
    .map(node => node.getText(ast)).join("\n");
  const acknowledging = source.slice(source.indexOf("  const acknowledgeSubmittedPrompt = useCallback"),
    source.indexOf("  const loadSession = useCallback")).split("  useEffect(() => {")[0];
  const sending = source.slice(source.indexOf("  const handleSend = useCallback"), source.indexOf("  const executeBash = useCallback"));
  const api = new Function(...Object.keys(context), compile(`${helpers}\n${acknowledging}\n${sending}
    return { handleSend, reconcilePendingPrompt };`))(...Object.values(context));
  return {
    context, store, persisted, server, sent, reads, notices, promoted, localCalls, draftKey, coldDraft,
    send: (message = original) => api.handleSend(message),
    recover: async () => {
      context.promptSubmissionRunIdRef.current = null;
      await api.reconcilePendingPrompt(context.sessionIdRef.current, () => true, draftKey);
    },
    finish: () => { context.agentRunningRef.current = false; context.rpcPromptPendingRef.current = false; },
    dropAck: value => { dropAck = value; }, queue: value => { queued = value; },
    writable: value => { writable = value; }, scope: value => { currentScope = value; },
    delayRead: value => { readGate = value; },
  };
}

test("cloud lost ACK persists the complete original request before POST and cold recovery uses cloud readback", async () => {
  const f = fixture();
  f.dropAck(true);
  assert.equal(await f.send(), false);
  const pending = f.coldDraft(f.draftKey)?.pendingPrompt;
  assert.equal(pending?.message, original);
  assert.equal(f.sent[0].durableBeforeRequest?.clientRequestId, f.sent[0].body.clientRequestId);
  assert.equal(f.sent[0].scope, scope());
  const cold = fixture({ persisted: f.persisted, server: f.server, generation: 8 });
  await cold.recover();
  assert.equal(cold.coldDraft(cold.draftKey), null);
  assert.deepEqual(cold.localCalls, []);
  assert.equal(cold.sent.length, 0);
  assert.equal(cold.reads[0]?.scope, scope("account-a", 8));
});

test("an offline queued retry reuses identical bytes and request ID after a browser restart", async () => {
  const f = fixture();
  f.queue(true);
  assert.equal(await f.send(), false);
  assert.ok(f.coldDraft(f.draftKey)?.pendingPrompt);
  assert.equal(f.promoted.length, 0);
  const cold = fixture({ persisted: f.persisted, server: f.server, generation: 3 });
  assert.equal(await cold.send(), true);
  assert.equal(cold.sent[0].body.clientRequestId, f.sent[0].body.clientRequestId);
  assert.equal(cold.sent[0].bytes, f.sent[0].bytes);
  assert.equal(cold.server.size, 1);
  assert.equal(cold.coldDraft(cold.draftKey), null);
  assert.deepEqual(cold.localCalls, []);
});

test("readback of the same exact cloud request prevents another model enqueue on retry", async () => {
  const f = fixture();
  f.dropAck(true);
  await f.send();
  f.finish();
  f.dropAck(false);
  assert.equal(await f.send(), true);
  assert.equal(f.sent.length, 1);
  assert.equal(f.server.size, 1);
  assert.deepEqual(f.localCalls, []);
});

test("a pending cloud prompt with edited text checks the original cloud request without local Core", async () => {
  const f = fixture();
  f.queue(true);
  await f.send();
  f.finish();
  assert.equal(await f.send("新草稿"), false);
  assert.equal(f.sent.length, 1);
  assert.deepEqual(f.localCalls, []);
  assert.ok(f.coldDraft(f.draftKey)?.pendingPrompt);
});

test("a cloud pending record cannot be acknowledged by a different command or account", async () => {
  for (const changed of ["message", "actor_id", "session_id", "scope"]) {
    const f = fixture();
    f.dropAck(true);
    await f.send();
    const row = [...f.server.values()][0];
    if (changed === "message") row.command.message = original.trim();
    else if (changed === "scope") f.scope(scope("account-b"));
    else row[changed] = "different";
    await f.recover();
    assert.ok(f.coldDraft(f.draftKey)?.pendingPrompt, changed);
  }
});

test("late readback after a scope generation switch preserves the original pending request and newer text", async () => {
  const f = fixture();
  f.dropAck(true);
  await f.send();
  let release;
  f.delayRead(new Promise(resolve => { release = resolve; }));
  const recovering = f.recover();
  await flush();
  f.scope(scope("account-a", 2));
  f.store.setDraft(f.draftKey, { value: "新编辑", images: [] });
  f.store.flushDraftNow(f.draftKey);
  release();
  await recovering;
  assert.equal(f.coldDraft(f.draftKey)?.value, "新编辑");
  assert.ok(f.coldDraft(f.draftKey)?.pendingPrompt);
});

test("cloud browser persistence failure blocks the request before anything is sent", async () => {
  const f = fixture();
  f.writable(false);
  assert.equal(await f.send(), false);
  assert.equal(f.sent.length, 0);
  assert.equal(f.server.size, 0);
});

test("a new offline cloud chat keeps one deterministic session and original request on cold retry", async () => {
  const f = fixture({ newChat: true });
  f.queue(true);
  assert.equal(await f.send(), false);
  const pending = f.coldDraft(f.draftKey)?.pendingPrompt;
  assert.ok(pending?.sessionId?.startsWith("cloud-"));
  const cold = fixture({ newChat: true, persisted: f.persisted, server: f.server, generation: 5 });
  assert.equal(await cold.send(), true);
  assert.equal(cold.sent[0].url, "/api/agent/new");
  assert.equal(cold.sent[0].bytes, f.sent[0].bytes);
  assert.equal(cold.context.sessionIdRef.current, pending.sessionId);
  assert.equal(cold.server.size, 1);
  assert.deepEqual(cold.localCalls, []);
});

function commandHandlers({ cloud = true, pending = false, delayedSession = null } = {}) {
  const commands = [], notices = [], models = [];
  const context = {
    useCallback: fn => fn, cloudChatRef: { current: cloud }, cloudScopeRef: { current: cloud ? scope() : null },
    sessionIdRef: { current: delayedSession ? null : "cloud-session" },
    ensuringNewSessionRef: { current: delayedSession }, isNew: Boolean(delayedSession), addNotice: notice => notices.push(notice),
    bashRunningRef: { current: false }, invalidateCoreRecallLive: noop,
    thinkingLevelOverrideRef: { current: null }, newSessionModelOverrideRef: { current: null },
    setThinkingLevel: noop, setNewSessionModel: noop, setPendingModel: noop, setCurrentModelOverride: model => models.push(model),
    console: { error: noop },
    sendAgentCommand: async (...args) => {
      commands.push(args);
      if (pending) {
        const error = new Error("已保存，联网后同步。");
        error.name = "AgentCommandPendingError";
        throw error;
      }
    },
  };
  const names = ["handleSteer", "handleFollowUp", "handlePromptWithStreamingBehavior", "handleModelChange", "handleThinkingLevelChange", "handleAbort"];
  const ast = ts.createSourceFile("hook.ts", source, ts.ScriptTarget.Latest, true);
  const statements = [];
  function visit(node) {
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => names.includes(declaration.name.getText(ast)))) {
      statements.push(node.getText(ast));
    } else ts.forEachChild(node, visit);
  }
  visit(ast);
  const api = new Function(...Object.keys(context), compile(`${statements.join("\n")}\nreturn { ${names.join(",")} };`))(...Object.values(context));
  return { api, context, commands, notices, models };
}

test("all three cloud streaming submission entries reject an untracked send and leave local queues available", async () => {
  for (const [method, args] of [
    ["handleSteer", [original]], ["handleFollowUp", [original]], ["handlePromptWithStreamingBehavior", [original, "followUp"]],
  ]) {
    const f = commandHandlers();
    await assert.rejects(f.api[method](...args), /草稿已保留/u);
    assert.equal(f.commands.length, 0, method);
    assert.match(f.notices[0]?.message, /等待当前回复/u);
    const local = commandHandlers({ cloud: false });
    await local.api[method](...args);
    assert.equal(local.commands.length, 1, method);
    assert.equal(local.commands[0][2], null);
  }
});

test("queued cloud model, thinking and abort commands show a notice and retain their captured scope", async () => {
  for (const [method, args] of [["handleModelChange", ["provider", "model"]],
    ["handleThinkingLevelChange", ["high"]], ["handleAbort", []]]) {
    const f = commandHandlers({ pending: true });
    await f.api[method](...args);
    assert.equal(f.commands[0]?.[2], scope(), method);
    assert.equal(f.notices[0]?.message, "已保存，联网后同步。", method);
    assert.equal(f.notices[0]?.type, "info");
    assert.equal(f.models.length, 0, "a queued model change must not be reported as applied");
  }
});

test("an awaiting model operation cannot inherit a different account's later scope", async () => {
  let release;
  const f = commandHandlers({ delayedSession: new Promise(resolve => { release = resolve; }) });
  const changing = f.api.handleModelChange("provider", "model");
  f.context.cloudScopeRef.current = scope("account-b", 2);
  release("old-session");
  await changing;
  assert.equal(f.commands[0]?.[0], "old-session");
  assert.equal(f.commands[0]?.[2], scope(), "the server can reject the original stale identity instead of mutating the new account");
});

test("ChatWindow scopes both existing/new drafts and promotes into the scoped session without adopting legacy text", () => {
  const f = fixture();
  const chat = readFile(new URL("../components/ChatWindow.tsx", import.meta.url), "utf8");
  return chat.then(text => {
    const keys = text.slice(text.indexOf("  const cloudChat ="), text.indexOf("  const appliedReminderOpenId"));
    const promote = text.slice(text.indexOf("  const handleSessionCreated ="), text.indexOf("\n  const {", text.indexOf("  const handleSessionCreated =")));
    const promotions = [];
    const render = new Function("session", "newSessionCwd", "reminderDraftKey", "cloudChatDraftKey", "educationWriteHeaders",
      "useCallback", "chatInputRef", "onSessionCreated", compile(`${keys}\n${promote}\nreturn { draftKey, cloudScope, handleSessionCreated };`));
    const run = (session, cwd, current) => render(session, cwd, undefined, f.store.cloudChatDraftKey,
      () => new Headers({ "x-edupi-cloud-scope": current }), fn => fn,
      { current: { promoteDraftToSession: (...args) => promotions.push(args) } }, noop);
    const session = { id: "cloud-session", path: "cloud:workspace-a/cloud-session", cloudScope: scope() };
    const a = run(session, null, scope()), b = run({ ...session, cloudScope: scope("account-b") }, null, scope("account-b"));
    assert.notEqual(a.draftKey, b.draftKey);
    assert.equal(run(session, null, scope("account-b")).draftKey, null);
    assert.equal(run({ ...session, cloudScope: scope("account-a", 9) }, null, scope("account-a", 9)).draftKey, a.draftKey);
    const blank = run(null, "cloud:workspace-a", scope());
    assert.notEqual(blank.draftKey, "new:cloud:workspace-a");
    blank.handleSessionCreated(session);
    assert.deepEqual(promotions[0], [blank.draftKey, a.draftKey]);
    assert.equal(run({ id: "local" }, null, scope()).draftKey, "local");
  });
});
