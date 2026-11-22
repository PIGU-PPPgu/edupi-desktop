import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { createEduPiCloudClient } = await jiti.import("./edupi-cloud-client.ts");
const { cloudChatApi } = await jiti.import("./edupi-cloud-chat-api.ts");
const { cloudScopeKey } = await jiti.import("./edupi-cloud-request-scope.ts");
const { CLOUD_SYNC_CONTRACT } = await jiti.import("./edupi-cloud-sync-contract.ts");
const account = "11111111-1111-4111-8111-111111111111";
const workspace = "22222222-2222-4222-8222-222222222222";
async function fixture(t) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-chat-dependency-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const env = { PI_DESKTOP_STATE_DIR: stateDir, SUPABASE_URL: "https://synthetic.invalid", SUPABASE_ANON_KEY: "synthetic-public" };
  const f = { offlineCreates: true, conflictSession: null, calls: [], sessions: new Map(), requests: new Map() };
  f.fetchImpl = async (input, init) => {
    if (String(input).includes("/auth/v1/token")) return Response.json({
      access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: 3600, user: { id: account },
    });
    if (String(input).endsWith("/edupi-account")) return Response.json({ workspaces: [{ id: workspace, mode: "cloud" }] });
    const body = JSON.parse(init.body);
    f.calls.push(body);
    if (body.action === "create") {
      if (f.offlineCreates) throw new TypeError("connection interrupted before session creation");
      if (f.conflictSession === body.session_id) return Response.json({ code: "idempotency_conflict" }, { status: 409 });
      f.sessions.set(body.session_id, { ...body, workspace_id: workspace, revision: 0, thinking_level: body.thinking_level });
    } else if (!f.sessions.has(body.session_id)) return Response.json({ code: "session_not_found" }, { status: 404 });
    if (body.action === "enqueue") f.requests.set(body.request_id, { ...body, status: "queued" });
    return Response.json({
      ok: true, operation: "sessions", external_send: false,
      contract: CLOUD_SYNC_CONTRACT, workspace_id: workspace, action: body.action, session_id: body.session_id,
      request_id: body.request_id, session: f.sessions.get(body.session_id),
      requests: [...f.requests.values()].filter(row => row.session_id === body.session_id),
      messages: [...f.requests.values()].filter(row => row.session_id === body.session_id).map(row => ({
        request_id: row.request_id, role: "user", message: { role: "user", content: row.command.message },
      })),
    });
  };
  f.client = createEduPiCloudClient({ env, fetchImpl: f.fetchImpl });
  await f.client.login("synthetic@example.invalid", "synthetic");
  await f.client.selectWorkspace(workspace);
  f.scope = await f.client.captureScope();
  f.newClient = () => createEduPiCloudClient({ env, fetchImpl: f.fetchImpl });
  f.create = () => cloudChatApi(new Request("http://localhost/api/agent/new", {
    method: "POST", headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json",
      "x-edupi-cloud-scope": cloudScopeKey(f.scope) },
    body: JSON.stringify({ type: "prompt", message: "完整首条\n保留字节", clientRequestId: "same-first-request" }),
  }), ["agent", "new"], { client: f.client, pump: () => {} });
  return f;
}

test("a connection recovery between create and enqueue cannot poison the durable first message", async t => {
  const f = await fixture(t);
  const response = await f.create();
  assert.equal(response.status, 202);
  const created = await response.json();
  assert.ok(created.sessionId);
  assert.equal(f.calls.filter(row => row.action === "enqueue").length, 0, "never dispatch a dependent prompt early");
  const pending = await f.client.outbox();
  assert.deepEqual(pending.map(row => [row.body.action, row.status]), [["create", "pending"], ["enqueue", "pending"]]);
  f.offlineCreates = false;
  const rebuilt = f.newClient();
  assert.deepEqual((await rebuilt.outbox()).map(row => row.body), pending.map(row => row.body));
  const result = await rebuilt.flushOutbox();
  assert.deepEqual(result, { flushed: 2, pending: 0 });
  assert.equal(f.calls.filter(row => row.action === "enqueue").length, 1);
  assert.equal(f.requests.size, 1);
  assert.equal(f.requests.get("same-first-request").command.message, "完整首条\n保留字节");
});

test("a conflicted create retains its dependent prompt while independent sessions can still flush", async t => {
  const f = await fixture(t);
  const response = await f.create();
  const { sessionId } = await response.json();
  await f.client.operationWithOutbox("sessions", { action: "create", session_id: "independent",
    request_id: "independent-create", title: "", thinking_level: "off", model: null });
  f.offlineCreates = false;
  f.conflictSession = sessionId;
  assert.deepEqual(await f.newClient().flushOutbox(), { flushed: 1, pending: 2 });
  const remaining = await f.client.outbox();
  assert.deepEqual(remaining.map(row => [row.body.action, row.status]), [["create", "conflict"], ["enqueue", "pending"]]);
  assert.equal(f.calls.filter(row => row.action === "enqueue").length, 0);
  assert.ok(f.sessions.has("independent"));
});
