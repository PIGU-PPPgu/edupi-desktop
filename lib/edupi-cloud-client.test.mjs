import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createEduPiCloudClient } from "./edupi-cloud-client.ts";
import { EDUPI_MOBILE_DASHBOARD_CONTRACT } from "./edupi-cloud-contract.ts";
import { cloudStateTransaction } from "./edupi-cloud-store.ts";

const accountA = "11111111-1111-4111-8111-111111111111";
const accountB = "11111111-1111-4111-8111-222222222222";
const workspaceA = "22222222-2222-4222-8222-222222222222";
const workspaceB = "22222222-2222-4222-8222-333333333333";
const stateHash = `sha256:${"a".repeat(64)}`;
const command = id => ({
  command_type: "create_task", source: { source_id: `source-${id}`, source_kind: "teacher_message",
    source_hash: `sha256:${"b".repeat(64)}`, evidence_ids: [] },
  task: { task_id: id, title: "隔离测试任务", due_date: null, note: null },
});
const identity = id => ({ requestId: `request-${id}`, idempotencyKey: `request-${id}` });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-cloud-client-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = { PI_DESKTOP_STATE_DIR: dir, SUPABASE_ANON_KEY: "public-test-key" };
  const f = { dir, env, offline: false, requests: [], tasks: new Map(), receipts: new Map(), account: accountA,
    responseStatus: null, wrongReadback: false, unknownContract: false, beforeBroker: null, refreshGate: null };
  f.fetchImpl = async (url, init) => {
    const request = { url: String(url), body: init.body ? JSON.parse(init.body) : null, headers: init.headers };
    f.requests.push(request);
    if (request.url.includes("/auth/v1/token")) {
      const id = f.account;
      if (request.url.includes("refresh_token") && f.refreshGate) await f.refreshGate.promise;
      return Response.json({ access_token: `access-${id}`, refresh_token: `refresh-${id}`,
        expires_in: 3600, user: { id, email: "synthetic@example.invalid" } });
    }
    if (request.url.includes("/auth/v1/logout")) return new Response(null, { status: 204 });
    if (request.url.includes("/functions/v1/edupi-account")) return Response.json({
      ok: true, workspaces: [{ id: workspaceA, mode: "cloud" }, { id: workspaceB, mode: "cloud" }],
    });
    if (f.beforeBroker) await f.beforeBroker(request);
    if (f.offline) throw new TypeError("offline");
    if (f.responseStatus) return Response.json({ code: f.responseStatus === 409 ? "stale_revision" : "workspace_forbidden" }, { status: f.responseStatus });
    const workspace = init.headers["x-edupi-workspace-id"];
    const body = request.body;
    if (body.operation === "snapshot") return Response.json({
      ok: true, operation: "snapshot", snapshot_id: "snapshot-current", state_hash: stateHash, revision: 0,
      payload: { workspace_id: f.wrongWorkspace || workspace, tasks: f.wrongReadback ? [] : [...f.tasks.values()],
        facts: [], materials: [], external_send: false }, external_send: false,
    });
    if (body.operation === "mobile-dashboard") return Response.json({
      ok: true, operation: "mobile-dashboard", contract: f.unknownContract
        ? { ...EDUPI_MOBILE_DASHBOARD_CONTRACT, schema_hash: "unknown" } : EDUPI_MOBILE_DASHBOARD_CONTRACT,
      payload: { workspace_id: workspace, tasks: [...f.tasks.values()], students: [], calendar: [], timetable: [], external_send: false },
      external_send: false,
    });
    if (body.operation === "command") {
      const envelope = body.envelope;
      const prior = f.receipts.get(envelope.request_id);
      if (prior) {
        assert.deepEqual(envelope, prior.envelope, "retry must preserve every envelope field");
        return Response.json({ ...prior.result, replayed: true });
      }
      const cmd = envelope.command;
      const taskId = cmd.command_type === "create_task" ? cmd.task.task_id : cmd.task_id;
      const task = cmd.command_type === "create_task" ? { ...cmd.task, stage: "todo", revision: 0 }
        : { ...f.tasks.get(taskId), stage: cmd.to_stage, revision: cmd.expected_revision + 1 };
      f.tasks.set(taskId, task);
      const result = { ok: true, operation: "command", request_id: envelope.request_id, external_send: false, replayed: false,
        receipt: { contract_version: envelope.contract_version, schema_hash: envelope.schema_hash, request_id: envelope.request_id,
          external_send: false, payload: {
            command_id: envelope.message_id, request_id: envelope.request_id,
            target: { target_kind: "task", target_id: taskId }, status: cmd.command_type === "create_task" ? "accepted" : "modified",
            applied_ids: [taskId], rejected_ids: [], external_send: false,
          } },
      };
      f.receipts.set(envelope.request_id, { envelope, result });
      return Response.json(result);
    }
    throw new Error(`Unexpected mock operation ${body.operation}`);
  };
  f.client = createEduPiCloudClient({ env, fetchImpl: f.fetchImpl });
  f.login = async () => {
    await f.client.login("synthetic@example.invalid", "synthetic-only");
    await f.client.selectWorkspace(workspaceA);
  };
  return f;
}

test("local mode reads without creating files or connecting", async t => {
  const f = fixture(t);
  const directory = path.join(f.dir, "not-created");
  const client = createEduPiCloudClient({ stateDir: directory, env: {}, fetchImpl: () => { throw new Error("network called"); } });
  assert.equal((await client.state()).mode, "local");
  assert.equal(fs.existsSync(directory), false);
  assert.deepEqual(client.config(), { url: "https://edupi.intelliclass.online", configured: false });
});

test("rejects privileged keys before issuing any login request", async t => {
  const f = fixture(t);
  for (const key of ["sb_secret_not-for-desktop", `a.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.b`]) {
    f.env.SUPABASE_ANON_KEY = key;
    await assert.rejects(f.client.login("synthetic@example.invalid", "synthetic"), { code: "configuration_invalid" });
  }
  assert.equal(f.requests.length, 0);
});

test("login requires explicit accessible workspace selection and keeps credentials private", async t => {
  const f = fixture(t);
  const result = await f.client.login("synthetic@example.invalid", "synthetic");
  assert.equal(result.state.mode, "local");
  assert.equal(result.state.workspaceId, null);
  await assert.rejects(f.client.dashboard(), { code: "workspace_required" });
  await assert.rejects(f.client.selectWorkspace("33333333-3333-4333-8333-333333333333"), { code: "workspace_forbidden" });
  await f.client.selectWorkspace(workspaceA);
  assert.equal((await f.client.state()).workspaceId, workspaceA);
  const file = path.join(f.dir, "cloud", "cloud-private.json");
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
});

test("unknown dashboard contract and cross-workspace snapshot fail closed", async t => {
  const f = fixture(t);
  await f.login();
  f.unknownContract = true;
  await assert.rejects(f.client.dashboard(), /contract/);
  f.wrongWorkspace = workspaceB;
  await assert.rejects(f.client.snapshot(), { code: "invalid_response" });
  assert.deepEqual((await f.client.state()).cursors, {});
});

test("offline task intent survives restart, materializes once, verifies readback and clears queue", async t => {
  const f = fixture(t);
  await f.login();
  f.offline = true;
  const queued = await f.client.taskCommand(command("offline-task"), identity("offline-task"));
  assert.equal(queued.queued, true);
  assert.equal((await f.client.outbox()).length, 1);
  assert.equal((await f.client.outbox())[0].body.envelope, undefined);
  const restarted = createEduPiCloudClient({ env: f.env, fetchImpl: f.fetchImpl });
  assert.equal((await restarted.state()).workspaceId, workspaceA);
  f.offline = false;
  assert.deepEqual(await restarted.flushOutbox(), { flushed: 1, pending: 0 });
  assert.equal(f.tasks.size, 1);
  assert.equal((await restarted.state()).completed.length, 1);
  assert.equal(Object.keys((await restarted.state()).cursors).length, 1);
  const writes = f.requests.filter(req => req.body?.operation === "command").length;
  await restarted.taskCommand(command("offline-task"), identity("offline-task"));
  assert.equal(f.requests.filter(req => req.body?.operation === "command").length, writes, "same completed intent is not recreated");
});

test("HTTP 200 with missing readback stays pending and reuses original envelope on retry", async t => {
  const f = fixture(t);
  await f.login();
  f.wrongReadback = true;
  const queued = await f.client.taskCommand(command("readback"), identity("readback"));
  assert.equal(queued.queued, true);
  const first = (await f.client.outbox())[0].body.envelope;
  assert.ok(first.snapshot_id);
  f.wrongReadback = false;
  assert.deepEqual(await f.client.flushOutbox(), { flushed: 1, pending: 0 });
  const writes = f.requests.filter(req => req.body?.operation === "command");
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0].body.envelope, writes[1].body.envelope);
  assert.equal(f.tasks.size, 1);
});

test("409 remains a visible conflict, 403 retains the record, and flush never silently rebases", async t => {
  const f = fixture(t);
  await f.login();
  f.responseStatus = 409;
  await assert.rejects(f.client.taskCommand(command("conflict"), identity("conflict")), { status: 409 });
  assert.equal((await f.client.outbox())[0].status, "conflict");
  const before = f.requests.length;
  await f.client.flushOutbox();
  assert.equal(f.requests.length, before);
  f.responseStatus = 403;
  await assert.rejects(f.client.taskCommand(command("forbidden"), identity("forbidden")), { status: 403 });
  assert.equal((await f.client.outbox()).length, 2);
});

test("queued writes are isolated by workspace and account and retained by logout", async t => {
  const f = fixture(t);
  await f.login();
  f.offline = true;
  await f.client.taskCommand(command("scoped"), identity("scoped"));
  f.offline = false;
  await f.client.selectWorkspace(workspaceB);
  assert.deepEqual(await f.client.flushOutbox(), { flushed: 0, pending: 1 });
  assert.equal(f.tasks.size, 0);
  await f.client.logout();
  assert.equal((await f.client.outbox()).length, 1);
  assert.equal((await f.client.state()).session, null);
  f.account = accountB;
  await f.login();
  assert.deepEqual(await f.client.flushOutbox(), { flushed: 0, pending: 1 });
  assert.equal(f.tasks.size, 0);
});

test("changing issuer never sends the old account token to another server", async t => {
  const f = fixture(t);
  await f.login();
  const before = f.requests.length;
  f.env.SUPABASE_URL = "https://another.example.invalid";
  await assert.rejects(f.client.dashboard(), { code: "issuer_changed" });
  assert.equal(f.requests.length, before);
});

test("late reads are discarded after workspace change", async t => {
  const f = fixture(t);
  await f.login();
  const started = deferred(), gate = deferred();
  f.beforeBroker = async req => { if (req.body.operation === "snapshot") { started.resolve(); await gate.promise; } };
  const reading = f.client.snapshot();
  await started.promise;
  await f.client.selectWorkspace(workspaceB);
  gate.resolve();
  await assert.rejects(reading, { code: "scope_changed" });
  assert.deepEqual((await f.client.state()).cursors, {});
});

test("refresh is singleflight and cannot resurrect a logged-out session", async t => {
  const f = fixture(t);
  await f.login();
  f.refreshGate = deferred();
  const a = f.client.refresh(), b = f.client.refresh();
  while (!f.requests.some(req => req.url.includes("grant_type=refresh_token"))) await new Promise(resolve => setImmediate(resolve));
  await f.client.logout();
  f.refreshGate.resolve();
  await Promise.all([a, b]);
  assert.equal(f.requests.filter(req => req.url.includes("grant_type=refresh_token")).length, 1);
  assert.equal((await f.client.state()).session, null);
});

test("same request with different content is rejected without dropping the first write", async t => {
  const f = fixture(t);
  await f.login();
  f.offline = true;
  await f.client.taskCommand(command("same-id"), identity("same-id"));
  const edited = command("same-id");
  edited.task.title = "不同内容";
  await assert.rejects(f.client.taskCommand(edited, identity("same-id")), { code: "idempotency_conflict" });
  assert.equal((await f.client.outbox())[0].body.command.task.title, "隔离测试任务");
});

test("a full outbox rejects the new write and preserves every older record", async t => {
  const f = fixture(t);
  await f.login();
  f.offline = true;
  await f.client.taskCommand(command("full"), identity("full"));
  await cloudStateTransaction(f.dir, current => {
    const original = current.outbox[0];
    current.outbox = Array.from({ length: 256 }, (_, index) => ({ ...original, id: `entry-${index}`, requestId: `old-${index}` }));
    return { result: null, write: true };
  });
  await assert.rejects(f.client.taskCommand(command("overflow"), identity("overflow")), { code: "outbox_full" });
  assert.equal((await f.client.outbox()).length, 256);
  assert.equal((await f.client.outbox())[0].id, "entry-0");
});

test("local mode never replays a previously queued cloud write", async t => {
  const f = fixture(t);
  await f.login();
  f.offline = true;
  await f.client.taskCommand(command("local"), identity("local"));
  await f.client.persistMode("local");
  const before = f.requests.length;
  f.offline = false;
  assert.deepEqual(await f.client.flushOutbox(), { flushed: 0, pending: 1 });
  assert.equal(f.requests.length, before);
});

test("task identities retain their first envelope after more than 64 later writes and restart", async t => {
  const f = fixture(t);
  await f.login();
  for (let index = 0; index < 65; index++) {
    const id = `archive-${index}`;
    assert.equal((await f.client.taskCommand(command(id), identity(id))).queued, false);
  }
  const before = f.requests.filter(req => req.body?.operation === "command").length;
  const restarted = createEduPiCloudClient({ env: f.env, fetchImpl: f.fetchImpl });
  assert.equal((await restarted.state()).completed.length, 65);
  assert.equal((await restarted.taskCommand(command("archive-0"), identity("archive-0"))).queued, false);
  assert.equal(f.requests.filter(req => req.body?.operation === "command").length, before);
  assert.equal((await restarted.outbox()).length, 0);
});

test("another device advancing one object becomes a conflict and does not block the next queued object", async t => {
  const f = fixture(t);
  await f.login();
  f.offline = true;
  await f.client.taskCommand(command("advanced"), identity("advanced"));
  await f.client.taskCommand(command("independent"), identity("independent"));
  f.offline = false;
  f.beforeBroker = async req => {
    if (req.body.operation === "snapshot" && f.tasks.has("advanced")) {
      f.tasks.set("advanced", { ...f.tasks.get("advanced"), stage: "progress", revision: 1 });
    }
  };
  assert.deepEqual(await f.client.flushOutbox(), { flushed: 1, pending: 1 });
  const [conflict] = await f.client.outbox();
  assert.equal(conflict.status, "conflict");
  assert.equal(conflict.lastError, "readback_conflict");
  assert.ok(f.tasks.has("independent"));
});

test("a scope switch during delivery preserves pending state for original-workspace retry", async t => {
  const f = fixture(t);
  await f.login();
  const started = deferred(), gate = deferred();
  f.beforeBroker = async req => {
    if (req.body.operation === "command") { started.resolve(); await gate.promise; }
  };
  const writing = f.client.taskCommand(command("switch-during-write"), identity("switch-during-write"));
  await started.promise;
  await f.client.selectWorkspace(workspaceB);
  gate.resolve();
  await assert.rejects(writing, { code: "scope_changed" });
  assert.equal((await f.client.outbox())[0].status, "pending");
  await f.client.selectWorkspace(workspaceA);
  f.beforeBroker = null;
  assert.deepEqual(await f.client.flushOutbox(), { flushed: 1, pending: 0 });
  assert.equal(f.tasks.size, 1);
});
