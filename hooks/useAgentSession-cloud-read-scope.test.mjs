import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
const source = fs.readFileSync(new URL("./useAgentSession.ts", import.meta.url), "utf8");
const compile = code => ts.transpileModule(code, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const noop = () => {};
const scope = (account = "a", generation = 1) => JSON.stringify(["cloud", "https://synthetic.invalid", account, "workspace", generation]);
const headers = (initial, selected) => {
  const result = new Headers(initial);
  result.set("x-edupi-cloud-scope", selected);
  return result;
};
function reader({ captured = scope(), returned = captured, sessionId = "same-session" } = {}) {
  const writes = [], requests = [];
  const context = {
    useCallback: callback => callback, URLSearchParams,
    cloudScopeRef: { current: captured }, cloudChatRef: { current: captured !== null },
    sessionIdRef: { current: "same-session" }, sessionGenerationRef: { current: 1 },
    promptRunIdRef: { current: 1 }, contextLoadIdRef: { current: 0 }, messageHistoryRef: { current: { messageIds: [] } },
    agentEducationWriteHeaders: headers, console: { error: noop }, normalizeQueuedMessages: value => value,
    reconcilePendingPrompt: async () => writes.push("reconcile"),
    fetchWithRetry: async (url, options) => {
      requests.push({ url, headers: options.init?.headers });
      return { ok: true, status: 200, json: async () => ({
        sessionId, ...(returned ? { cloudScope: returned } : {}),
        context: { messages: [{ role: "user", content: "合成消息" }], entryIds: ["one"], thinkingLevel: "off" },
        leafId: "one", tree: [],
      }) };
    },
    fetch: async (url, options) => {
      requests.push({ url, headers: options?.headers });
      return { ok: true, json: async () => ({ running: false }) };
    },
  };
  for (const name of ["setLoading", "setData", "setActiveLeafId", "dispatchMessageHistory", "setCurrentModelOverride",
    "setError", "setThinkingLevel", "setContextUsage", "setSystemPrompt", "setPermissionMode", "setExtensionStatuses",
    "setExtensionWidgets", "setQueuedMessages"]) context[name] = value => writes.push({ name, value });
  const body = source.slice(source.indexOf("  const loadSession = useCallback"), source.indexOf("  /** Re-run the initial session load"));
  const load = new Function(...Object.keys(context), compile(`${body}\nreturn loadSession;`))(...Object.values(context));
  return { load, context, writes, requests };
}

for (const [label, options] of [
  ["another account", { returned: scope("b") }],
  ["another generation", { returned: scope("a", 2) }],
  ["another session id", { sessionId: "other-session" }],
  ["unscoped local view receiving cloud data", { captured: null, returned: scope() }],
  ["cloud view receiving a local payload", { returned: null }],
]) test(`ordinary history load rejects ${label} before reconciliation or history mutation`, async () => {
  const f = reader(options);
  await f.load("same-session", true, true);
  assert.ok(!f.writes.includes("reconcile"));
  assert.ok(!f.writes.some(write => ["setData", "dispatchMessageHistory"].includes(write?.name)));
  assert.equal(f.requests.length, 1, "a rejected history response must not start its state read");
});

test("valid history and state loads carry the same captured cloud scope", async () => {
  const f = reader();
  await f.load("same-session", true, true);
  assert.ok(f.writes.includes("reconcile"));
  assert.equal(f.writes.filter(write => write?.name === "dispatchMessageHistory").length, 1);
  assert.equal(f.requests.length, 2);
  assert.ok(f.requests.every(request => request.headers.get("x-edupi-cloud-scope") === scope()));
});

test("a scope switch while a history request waits cannot commit its old response", async () => {
  const f = reader();
  let release;
  f.context.reconcilePendingPrompt = async () => {};
  const original = f.context.fetchWithRetry;
  f.context.fetchWithRetry = async (...args) => {
    await new Promise(resolve => { release = resolve; });
    return original(...args);
  };
  const body = source.slice(source.indexOf("  const loadSession = useCallback"), source.indexOf("  /** Re-run the initial session load"));
  const load = new Function(...Object.keys(f.context), compile(`${body}\nreturn loadSession;`))(...Object.values(f.context));
  const pending = load("same-session", true);
  f.context.cloudScopeRef.current = scope("b", 2);
  release();
  await pending;
  assert.ok(!f.writes.some(write => ["setData", "dispatchMessageHistory"].includes(write?.name)));
});

test("cloud event reconnects retain the original scope and late frames cannot enter a different account", async () => {
  const sources = [], events = [], timers = new Map();
  let id = 0;
  class EventSource {
    static CLOSED = 2;
    readyState = 1;
    constructor(url) { this.url = url; sources.push(this); }
    close() { this.readyState = EventSource.CLOSED; }
  }
  const context = {
    useCallback: callback => callback, EventSource, EVENT_STREAM_CONNECT_TIMEOUT_MS: 6000,
    cloudScopeRef: { current: scope() }, cloudChatRef: { current: true },
    sessionIdRef: { current: "same-session" }, eventSourceRef: { current: null },
    eventSourceSessionIdRef: { current: null }, eventConnectionAttemptRef: { current: null },
    eventStreamGraceActiveRef: { current: true }, eventStreamGraceGenerationRef: { current: 0 },
    agentRunningRef: { current: true }, handleAgentEventRef: { current: event => events.push(event) },
    setTimeout: callback => { timers.set(++id, callback); return id; }, clearTimeout: timer => timers.delete(timer),
  };
  const body = source.slice(source.indexOf("  const closeEvents = useCallback"), source.indexOf("  const ensureEventsConnected = useCallback"));
  const connect = new Function(...Object.keys(context), compile(`${body}\nreturn connectEvents;`))(...Object.values(context));
  const pending = connect("same-session");
  const eventSource = sources[0];
  assert.equal(new URL(eventSource.url, "http://localhost").searchParams.get("cloudScope"), scope());
  eventSource.onmessage({ data: JSON.stringify({ type: "connected" }) });
  assert.equal((await pending).status, "connected");
  context.cloudScopeRef.current = scope("b", 2);
  eventSource.onmessage({ data: JSON.stringify({ type: "message_update", secret: "synthetic-other-account" }) });
  assert.deepEqual(events.map(event => event.type), ["connected"]);
  eventSource.readyState = EventSource.CLOSED;
  eventSource.onerror();
  assert.equal(timers.size, 0, "an obsolete account must not schedule a new connection");
});
