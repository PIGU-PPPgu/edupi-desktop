import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const code = ts.transpileModule(fs.readFileSync(new URL("./edupi-recall-prompt-client.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const plain = value => JSON.parse(JSON.stringify(value));
const input = { sessionId: "synthetic-session", clientRequestId: "synthetic-request",
  message: "合成问题由谁主持？", occurredAt: "2026-11-18T00:00:00.000Z" };
const reply = (status, reasonCode = null) => ({ version: 1, status, reasonCode, externalSend: false });
const settings = () => ({
  version: 1, normalApproved: true, activation: { mode: "normal", enabled: true, reason: "ready" },
  config: { enabled: true, scope: { classId: "synthetic-class", subject: "数学" },
    model: { provider: "synthetic", modelId: "model" }, limit: 2, used: 1, remaining: 1,
    validUntil: new Date(Date.now() + 60_000).toISOString(), updatedAt: input.occurredAt },
});
function fixture({ native = true, responses = [], fetch } = {}) {
  const requests = [], events = [], timers = new Map();
  let next = 0;
  const exports = {};
  const transport = async (url, init) => {
    requests.push({ url, ...init });
    if (fetch) return fetch(url, init);
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return { ok: (response?.code ?? 200) < 400, status: response?.code ?? 200, json: async () => response?.body };
  };
  const dependencies = {
    "./desktop-updater": { isTauriDesktop: () => native },
    "./desktop-native": {
      fetchDesktopApi: (url, init) => {
        assert.match(url, /^\/api\/[a-z0-9/_-]+$/iu, "match the production native helper's path-only contract");
        return transport(url, init);
      },
      desktopApiHeaders: async initial => {
        const headers = new Headers(initial); headers.set("x-pi-desktop-token", "synthetic-native-token"); return headers;
      },
    },
  };
  vm.runInNewContext(code, { exports, require: name => {
    assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name];
  }, URLSearchParams, AbortController, Event, Headers, fetch: transport,
  window: { dispatchEvent: event => events.push(event.type) },
  setTimeout: fn => { timers.set(++next, fn); return next; }, clearTimeout: id => timers.delete(id) });
  return { client: exports, requests, events, timers };
}
test("explicit recall submit sends only the four public fields and never ordinary transport", async () => {
  const f = fixture({ responses: [{ body: reply("accepted") }] });
  assert.deepEqual(plain(await f.client.submitRecallPrompt({ ...input, purpose: "recall", approveNormal: true, grantId: "forged" })), reply("accepted"));
  assert.equal(f.requests[0].url, "/api/edupi/recall/prompts");
  assert.equal(f.requests[0].method, "POST");
  assert.deepEqual(JSON.parse(f.requests[0].body), input);
  assert.equal(f.timers.size, 0);
});
test("held, closed and semantic refusals never fall back to ordinary Pi", async () => {
  for (const reason of ["recall_inactive", "recall_budget_exhausted", "recall_normal_not_approved"]) {
    const f = fixture({ responses: [{ code: 409, body: reply("held", reason) }] });
    assert.equal((await f.client.submitRecallPrompt(input)).status, "held");
    assert.equal(f.requests.length, 1);
  }
  const f = fixture({ native: false });
  assert.equal((await f.client.submitRecallPrompt(input)).status, "held");
  assert.equal(f.requests.length, 0);
});
test("lost ACK uses GET inspect only with the original session/request identity", async () => {
  const f = fixture({ responses: [new Error("lost-ack"), ...["accepted", "uncertain", "cancelled", "not_sent"].map(status => ({ body: reply(status) }))] });
  await assert.rejects(f.client.submitRecallPrompt(input));
  for (const status of ["accepted", "uncertain", "cancelled", "not_sent"]) {
    assert.equal((await f.client.inspectRecallPrompt(input.sessionId, input.clientRequestId)).status, status);
  }
  assert.deepEqual(f.requests.map(item => item.method), ["POST", "GET", "GET", "GET", "GET"]);
  assert.equal(f.requests[1].url, "/api/edupi/recall/prompts?sessionId=synthetic-session&clientRequestId=synthetic-request");
  assert.equal(f.requests[1].headers.get("x-pi-desktop-token"), "synthetic-native-token");
});
test("inspect rejects malformed or failed acceptance and has an independent reject deadline", async () => {
  for (const response of [{ code: 503, body: reply("accepted") }, { body: { ...reply("accepted"), externalSend: true } },
    { body: { ...reply("accepted"), version: 2 } }, { body: reply("held") }]) {
    const f = fixture({ responses: [response] });
    assert.equal((await f.client.inspectRecallPrompt("session", "request")).status, "unavailable");
  }
  const f = fixture({ fetch: () => new Promise(() => {}) });
  const pending = f.client.inspectRecallPrompt("session", "request");
  for (const timer of f.timers.values()) timer();
  assert.equal((await pending).status, "unavailable");
  assert.equal(f.requests[0].signal.aborted, true);
  assert.equal(f.timers.size, 0);
});
test("normal availability requires the public server gate, explicit scope/model, budget and expiry", () => {
  const f = fixture(), valid = settings();
  assert.equal(f.client.recallSendAvailable(valid), true);
  for (const value of [null, { ...valid, normalApproved: false },
    { ...valid, activation: { ...valid.activation, mode: "canary" } },
    { ...valid, config: { ...valid.config, remaining: 0 } },
    { ...valid, config: { ...valid.config, validUntil: new Date(Date.now() - 1).toISOString() } },
    { ...valid, config: { ...valid.config, model: null } }]) {
    assert.equal(f.client.recallSendAvailable(value), false);
  }
});
test("stop re-reads public state and retains unknown status/grants without client approval fields", async () => {
  const current = settings();
  const f = fixture({ responses: [
    { body: { ...current, stop: { status: "unknown", grants: "unknown" } } }, { body: current },
  ] });
  const value = await f.client.updateRecallSettings({ enabled: false, expectedUpdatedAt: input.occurredAt });
  assert.deepEqual(plain(value.stop), { status: "unknown", grants: "unknown" });
  assert.deepEqual(JSON.parse(f.requests[0].body), { enabled: false, expectedUpdatedAt: input.occurredAt });
  assert.deepEqual(f.requests.map(item => item.method), ["POST", "GET"]);
  assert.deepEqual(f.events, ["edupi-recall-settings-changed"]);
});
