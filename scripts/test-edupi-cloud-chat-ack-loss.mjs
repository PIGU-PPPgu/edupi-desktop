import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";

const fixture = JSON.parse(fs.readFileSync(process.env.EDUPI_TEST_CLOUD_FIXTURE
  || "/tmp/edupi-risk-ui-20261123/fixture.json", "utf8"));
assert.ok(fixture.email?.endsWith("@example.invalid"), "only an isolated synthetic account is accepted");
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-chat-ack-loss-"));
fs.chmodSync(stateDir, 0o700);
const anon = process.env.SUPABASE_ANON_KEY || execFileSync("ssh", [
  "-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "ubuntu@43.134.4.108", "bash -s",
], { input: 'set -euo pipefail\n. /srv/edupi-supabase/.supabase.env\nprintf "%s" "$ANON_KEY"\n',
  encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 20_000 }).trim();
const env = { SUPABASE_URL: "https://edupi.intelliclass.online", SUPABASE_ANON_KEY: anon,
  PI_DESKTOP_STATE_DIR: stateDir };
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { createEduPiCloudClient } = await jiti.import("../lib/edupi-cloud-client.ts");
const { cloudChatApi } = await jiti.import("../lib/edupi-cloud-chat-api.ts");
const { cloudScopeKey } = await jiti.import("../lib/edupi-cloud-request-scope.ts");
const checks = [];
let phase = "login", sessionId, requestId = `ack-prompt-${randomUUID()}`;
const pass = label => { checks.push(label); console.log(`PASS ${label}`); };
let offline = false, dropAction = null, dropped = null;
const client = createEduPiCloudClient({ env, fetchImpl: async (input, init) => {
  const isSessions = new URL(String(input)).pathname === "/functions/v1/edupi-sessions";
  const body = isSessions ? JSON.parse(init.body) : null;
  if (isSessions && offline) {
    offline = false;
    throw new TypeError("synthetic outage before creation; the following request can reach the real server");
  }
  const response = await fetch(input, init);
  if (isSessions && body.action === dropAction && response.ok) {
    dropped = { body: structuredClone(body), result: await response.json() };
    assert.ok(response.bodyUsed, "consume the complete successful response before losing its ACK");
    dropAction = null;
    throw new TypeError("synthetic ACK loss after a complete successful response");
  }
  return response;
} });
let restarted;
try {
  await client.login(fixture.email, fixture.password);
  await client.selectWorkspace(fixture.workspaceId);
  const scope = await client.captureScope();
  assert.equal(scope.accountId, fixture.userId);
  const call = async (group, id, method, body) => {
    const response = await cloudChatApi(new Request(`http://localhost/api/${group}/${id}`, {
      method, headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json",
        "x-edupi-cloud-scope": cloudScopeKey(scope) },
      ...(method !== "DELETE" ? { body: JSON.stringify(body) } : {}),
    }), [group, id], { client, pump: () => {} });
    return { status: response.status, body: await response.json() };
  };
  phase = "offline-create";
  offline = true;
  const created = await call("agent", "new", "POST", {
    type: "prompt", message: "合成 ACK 恢复\n完整原文", clientRequestId: requestId,
  });
  assert.equal(created.status, 202);
  sessionId = created.body.sessionId;
  assert.ok(sessionId?.startsWith("cloud-"));
  const queued = await client.outbox();
  assert.deepEqual(queued.map(item => item.body.action), ["create", "enqueue"]);
  const original = JSON.stringify(queued.map(item => item.body));
  pass("offline-create-retains-session-request-and-complete-prompt");

  phase = "restart-flush";
  offline = false;
  restarted = createEduPiCloudClient({ env });
  assert.equal(JSON.stringify((await restarted.outbox()).map(item => item.body)), original);
  assert.equal((await restarted.flushOutbox()).pending, 0);
  let read = await restarted.operation("sessions", { action: "read", session_id: sessionId });
  assert.equal(read.requests.filter(row => row.request_id === requestId).length, 1);
  assert.equal(read.messages.filter(row => row.request_id === requestId && row.role === "user").length, 1);
  await call("agent", sessionId, "POST", {
    type: "prompt", message: "合成 ACK 恢复\n完整原文", clientRequestId: requestId,
  });
  read = await restarted.operation("sessions", { action: "read", session_id: sessionId });
  assert.equal(read.requests.filter(row => row.request_id === requestId).length, 1);
  pass("new-client-flush-and-same-id-retry-preserve-one-request-and-message");

  for (const [action, group, method, body] of [
    ["rename", "sessions", "PATCH", { name: "合成改名已确认" }],
    ["cancel", "agent", "POST", { type: "abort" }],
    ["configure", "agent", "POST", { type: "set_thinking_level", level: "high" }],
    ["delete", "sessions", "DELETE", null],
  ]) {
    phase = `${action}-ack-loss`;
    dropAction = action;
    dropped = null;
    const response = await call(group, sessionId, method, body);
    assert.equal(response.status, 202);
    assert.equal(response.body.pendingSync, true);
    if (group === "sessions") assert.equal(response.body.ok, false);
    else assert.equal(response.body.success, false);
    assert.equal(dropped?.body.action, action);
    const pending = await client.outbox();
    assert.equal(pending.length, 1);
    assert.deepEqual(pending[0].body, dropped.body);
    restarted = createEduPiCloudClient({ env });
    assert.equal((await restarted.flushOutbox()).pending, 0);
    const state = await restarted.state();
    const receipt = state.completed.find(row => row.entry.requestId === dropped.body.request_id);
    assert.ok(receipt);
    assert.equal(receipt.result.replayed, true);
    read = await restarted.operation("sessions", { action: "read", session_id: sessionId });
    if (action === "rename") assert.equal(read.session.title, body.name);
    if (action === "configure") assert.equal(read.session.thinking_level, body.level);
    if (action === "cancel") assert.equal(read.requests.find(row => row.request_id === requestId).status, "cancelled");
    if (action === "delete") {
      assert.ok(read.session.deleted_at);
      assert.ok(!(await restarted.operation("sessions", { action: "list" })).sessions.some(row => row.session_id === sessionId));
    }
    pass(`${action}-real-write-lost-ack-202-exact-replay-and-readback`);
  }
  console.log(JSON.stringify({ status: "passed", sessionId, requestId, checks, pending: (await restarted.outbox()).length,
    modelCalls: 0, note: "Synthetic workspace; no worker or model was started." }));
} catch (error) {
  console.error(JSON.stringify({ status: "failed", phase,
    code: /^[a-z0-9_]+$/u.test(error.code || "") ? error.code : "verification_failed",
    checks, sessionId, requestId }));
  process.exitCode = 1;
} finally {
  if (process.exitCode && sessionId && restarted) {
    try {
      const removed = await restarted.operationWithOutbox("sessions", {
        action: "delete", session_id: sessionId, request_id: `ack-cleanup-${randomUUID()}`,
      });
      console.log(JSON.stringify({ failedSessionRemoved: !removed.queued }));
    } catch { console.log(JSON.stringify({ failedSessionRemoved: false })); }
  }
  fs.rmSync(stateDir, { recursive: true, force: true });
}
