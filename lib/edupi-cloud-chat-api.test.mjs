import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { cloudChatApi } = await jiti.import("./edupi-cloud-chat-api.ts");
const { cloudScopeKey } = await jiti.import("./edupi-cloud-request-scope.ts");
const scope = { issuer: "https://synthetic.invalid", accountId: "teacher", workspaceId: "workspace", generation: 4 };
const state = { mode: "cloud", issuer: scope.issuer, session: { user: { id: scope.accountId } },
  workspaceId: scope.workspaceId, generation: scope.generation };
function fixture(queued) {
  const writes = [];
  const client = {
    state: async () => state, captureScope: async () => scope,
    operation: async () => ({ session: { revision: 3 } }),
    operationWithOutbox: async (_operation, body, selected) => {
      assert.deepEqual(selected, scope);
      writes.push(body);
      return { queued, ...(queued ? { entry: body } : { result: {} }) };
    },
  };
  const call = async (parts, method, body, key = cloudScopeKey(scope)) => {
    const response = await cloudChatApi(new Request(`http://localhost/api/${parts.join("/")}`, {
      method, headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json",
        ...(key ? { "x-edupi-cloud-scope": key } : {}) },
      ...(!["DELETE", "GET"].includes(method) ? { body: JSON.stringify(body) } : {}),
    }), parts, { client, pump: () => {} });
    return { response, data: await response.json() };
  };
  return { writes, call, client };
}

for (const queued of [false, true]) {
  for (const [method, action, body] of [["PATCH", "rename", { name: "新标题" }], ["DELETE", "delete", null]]) {
    test(`cloud ${action} reports ${queued ? "pending" : "applied"} without claiming early completion`, async () => {
      const f = fixture(queued);
      const { response, data } = await f.call(["sessions", "cloud-one"], method, body);
      assert.equal(response.status, queued ? 202 : 200);
      assert.equal(data.ok, !queued);
      assert.equal(data.pendingSync, queued);
      assert.equal(f.writes[0].action, action);
      assert.match(response.headers.get("cache-control"), /no-store/);
    });
  }
  for (const command of [{ type: "abort" }, { type: "set_model", provider: "local", modelId: "local" },
    { type: "set_thinking_level", level: "high" }]) {
    test(`cloud ${command.type} preserves its ${queued ? "pending" : "applied"} state`, async () => {
      const f = fixture(queued);
      const { response, data } = await f.call(["agent", "cloud-one"], "POST", command);
      assert.equal(response.status, queued ? 202 : 200);
      assert.equal(data.pendingSync, queued);
      assert.equal(data.success, !queued);
      assert.equal(f.writes.length, 1);
    });
  }
}

test("offline create preserves the stable session id and queues the original prompt after creation", async () => {
  const f = fixture(true);
  const command = { type: "prompt", message: "保留原始消息\n第二行", clientRequestId: "original-request" };
  const first = await f.call(["agent", "new"], "POST", command);
  const second = await f.call(["agent", "new"], "POST", command);
  assert.equal(first.response.status, 202);
  assert.equal(first.data.sessionId, second.data.sessionId);
  assert.equal(first.data.clientRequestId, command.clientRequestId);
  assert.equal(first.data.pendingSync, true);
  assert.deepEqual(f.writes.map(write => write.action), ["create", "enqueue", "create", "enqueue"]);
  assert.equal(f.writes[1].session_id, f.writes[0].session_id);
  assert.deepEqual(f.writes[1], f.writes[3]);
  assert.equal(f.writes[1].command.message, command.message);
});

test("an offline ensured session also returns its stable identity without inventing a prompt", async () => {
  const f = fixture(true);
  const { response, data } = await f.call(["agent", "new"], "POST", { type: "ensure_session", clientRequestId: "ensure-one" });
  assert.equal(response.status, 202);
  assert.match(data.sessionId, /^cloud-/);
  assert.equal(f.writes.length, 1);
});

test("cloud mutation refuses a missing or stale displayed scope before any write", async () => {
  const f = fixture(false);
  for (const key of [null, "local", cloudScopeKey({ ...scope, accountId: "other" }),
    cloudScopeKey({ ...scope, generation: 3 })]) {
    const { response, data } = await f.call(["sessions", "cloud-one"], "DELETE", null, key);
    assert.equal(response.status, 409);
    assert.equal(data.code, "scope_changed");
  }
  assert.equal(f.writes.length, 0);
});

test("a scoped chat read refuses another account or generation before returning its data", async () => {
  const f = fixture(false);
  for (const key of [cloudScopeKey({ ...scope, accountId: "other" }), cloudScopeKey({ ...scope, generation: 3 })]) {
    const { response, data } = await f.call(["agent", "cloud-one"], "GET", null, key);
    assert.equal(response.status, 409);
    assert.equal(data.code, "scope_changed");
  }
  assert.equal((await f.call(["agent", "cloud-one"], "GET", null)).response.status, 200);
});

test("an automatically reconnected event stream cannot inherit the server's new account", async () => {
  const f = fixture(false);
  const oldScope = cloudScopeKey({ ...scope, accountId: "old-account" });
  const response = await cloudChatApi(new Request(`http://localhost/api/agent/cloud-one/events?cloudScope=${encodeURIComponent(oldScope)}`, {
    headers: { host: "localhost", origin: "http://localhost" },
  }), ["agent", "cloud-one", "events"], { client: f.client, pump: () => assert.fail("a stale stream must not start a worker") });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "scope_changed");
});
