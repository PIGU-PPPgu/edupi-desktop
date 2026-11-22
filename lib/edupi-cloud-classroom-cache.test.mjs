import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, realpathSync, readdirSync, statSync,
  writeFileSync, unlinkSync, symlinkSync, linkSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import test, { before, after } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { cloudClassroomService } = await jiti.import("./edupi-cloud-classroom.ts");
const { createEduPiCloudClient, EduPiCloudError } = await jiti.import("./edupi-cloud-client.ts");
const { rememberCloudClassroomRead, cachedCloudClassroomRead, readCloudClassroomForPreparation } =
  await jiti.import("./edupi-cloud-classroom-cache.ts");
const { verifyHostClassroomComputation } = await jiti.import("../supabase/functions/edupi-classroom/compute.ts");
const { EDUPI_MOBILE_DASHBOARD_CONTRACT } = await jiti.import("./edupi-cloud-contract.ts");
const actor = "40000000-0000-4000-8000-000000000001";
const roster = Array.from({ length: 6 }, (_, index) => ({
  student_id: `cache-${index}`, name: `合成${index}`, class_name: "缓存隔离班", traits: [], revision: 0, profile_revision: 0,
}));
const grade = {
  title: "离线首次保存", class_name: "缓存隔离班", date: "2026-11-23",
  subjects: [{ name: "数学", max_score: 100 }],
  rows: roster.map((student, index) => ({ row_id: `r${index}`, name: student.name,
    student_id: student.student_id, scores: { 数学: 45 + index * 10 } })),
};
const duty = { title: "离线发布", class_name: grade.class_name, start_date: "2026-11-23", days: 5,
  weekdays: [1, 2, 3, 4, 5], student_ids: roster.map(student => student.student_id), exempt_ids: [],
  posts: [{ id: "floor", name: "扫地", count: 1, weight: 1, gender: "any" }], max_per_day: 1, max_days_per_week: 5 };
const unitScope = { issuer: "https://cache.fixture.invalid", accountId: actor,
  workspaceId: "50000000-0000-4000-8000-000000000001", generation: 1 };
const rosterBody = { domain: "grades", action: "roster", request_id: "roster-read" };
const rosterReply = () => ({ ok: true, operation: "classroom", action: "roster", request_id: rosterBody.request_id,
  workspace_id: unitScope.workspaceId, students: structuredClone(roster), external_send: false });
function recordReply(revision = 1, id = "downloaded") {
  return { ok: true, operation: "classroom", action: "read", workspace_id: unitScope.workspaceId,
    request_id: "object-read", external_send: false, record: {
      id, domain: "grades", revision, input: structuredClone(grade), result: { subjects: [{ mean: 70 }] }, issues: [],
      created_at: "2026-11-23T00:00:00Z", updated_at: `2026-11-23T00:00:0${revision}Z`,
      versions: Array.from({ length: revision }, (_, index) => ({ revision: index + 1, action: "save" })),
    } };
}
function cacheFixture(t) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "edupi-classroom-cache-unit-")));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const f = { directory, active: { ...unitScope }, network: async () => rosterReply() };
  f.client = {
    runtimeDirectory: () => directory,
    assertScope: async selected => {
      if (["issuer", "accountId", "workspaceId", "generation"].some(key => selected[key] !== f.active?.[key])) {
        throw new EduPiCloudError("scope_changed", "scope changed", 409);
      }
    },
    operation: async () => f.network(),
  };
  return f;
}

test("verified reads persist privately without credentials and survive helper/client reconstruction", async t => {
  const f = cacheFixture(t);
  await rememberCloudClassroomRead(f.client, unitScope, rosterBody, rosterReply());
  const filename = join(f.directory, readdirSync(f.directory)[0]);
  assert.equal(statSync(filename).mode & 0o777, 0o600);
  assert.equal(statSync(f.directory).mode & 0o777, 0o700);
  const bytes = readFileSync(filename, "utf8");
  assert.equal(bytes.includes("access_token"), false);
  assert.equal(bytes.includes("refresh_token"), false);
  const recreated = { ...f.client, runtimeDirectory: () => f.directory };
  const cached = await cachedCloudClassroomRead(recreated, unitScope, { ...rosterBody, domain: "duty", request_id: "new-prepare" });
  assert.deepEqual(cached.students, roster);
  assert.equal(cached.request_id, rosterBody.request_id, "cached data keeps its real original read identity");
});

test("issuer/account/workspace stay partitioned; a fresh login of the same identity can reuse its downloaded cache", async t => {
  const f = cacheFixture(t);
  await rememberCloudClassroomRead(f.client, unitScope, rosterBody, rosterReply());
  for (const change of [
    { issuer: "https://other.fixture.invalid" }, { accountId: randomUUID() }, { workspaceId: randomUUID() },
  ]) {
    const selected = { ...unitScope, ...change };
    f.active = selected;
    assert.equal(await cachedCloudClassroomRead(f.client, selected, rosterBody), null);
    await assert.rejects(cachedCloudClassroomRead(f.client, unitScope, rosterBody), { code: "scope_changed" });
  }
  f.active = { ...unitScope, generation: 2 };
  assert.ok(await cachedCloudClassroomRead(f.client, f.active, rosterBody));
});

test("temporary service/network errors can prepare from cache; auth/conflict/invalid-response errors cannot", async t => {
  const f = cacheFixture(t);
  await rememberCloudClassroomRead(f.client, unitScope, rosterBody, rosterReply());
  for (const status of [500, 502, 503]) {
    f.network = async () => { throw new EduPiCloudError("classroom_unavailable", "temporary", status); };
    assert.deepEqual((await readCloudClassroomForPreparation(f.client, unitScope, rosterBody)).students, roster);
  }
  for (const [status, code] of [
    [401, "unauthorized"], [403, "workspace_forbidden"], [404, "not_found"], [409, "stale_revision"],
    [502, "invalid_response"], [502, "unsupported_contract"], [503, "configuration_missing"],
  ]) {
    f.network = async () => { throw new EduPiCloudError(code, "must remain visible", status); };
    await assert.rejects(readCloudClassroomForPreparation(f.client, unitScope, rosterBody), { code });
  }
  f.network = async () => { throw new EduPiCloudError("network_unavailable", "offline", 503); };
  await assert.rejects(readCloudClassroomForPreparation(f.client, unitScope, rosterBody, false), { code: "network_unavailable" });
});

test("malformed successful responses neither fall back nor poison a previously verified cache", async t => {
  const f = cacheFixture(t);
  await rememberCloudClassroomRead(f.client, unitScope, rosterBody, rosterReply());
  const original = readFileSync(join(f.directory, readdirSync(f.directory)[0]));
  for (const mutate of [
    value => { value.workspace_id = randomUUID(); },
    value => { value.request_id = "wrong"; },
    value => { value.students.push(value.students[0]); },
    value => { value.students[0].revision = -1; },
  ]) {
    const response = rosterReply(); mutate(response);
    f.network = async () => response;
    await assert.rejects(readCloudClassroomForPreparation(f.client, unitScope, rosterBody), { code: "invalid_classroom_read" });
  }
  assert.deepEqual(readFileSync(join(f.directory, readdirSync(f.directory)[0])), original);
});

test("object/domain/history keys only expose versions actually downloaded and never replace a newer latest view", async t => {
  const f = cacheFixture(t);
  const body = { domain: "grades", action: "read", id: "downloaded", request_id: "object-read" };
  await rememberCloudClassroomRead(f.client, unitScope, body, recordReply(1));
  await rememberCloudClassroomRead(f.client, unitScope, body, recordReply(2));
  await rememberCloudClassroomRead(f.client, unitScope, body, recordReply(1));
  assert.equal((await cachedCloudClassroomRead(f.client, unitScope, body)).record.revision, 2);
  assert.equal((await cachedCloudClassroomRead(f.client, unitScope, { ...body, revision: 1 })).record.revision, 1);
  for (const change of [{ revision: 3 }, { id: "never-downloaded" }, { domain: "duty" }]) {
    assert.equal(await cachedCloudClassroomRead(f.client, unitScope, { ...body, ...change }), null);
  }
  const wrong = recordReply(2, "other-id");
  await assert.rejects(rememberCloudClassroomRead(f.client, unitScope, body, wrong), { code: "invalid_classroom_read" });
});

test("symlink/hardlink/public-permission/corrupt files are not accepted as cached reads", async t => {
  const f = cacheFixture(t);
  await rememberCloudClassroomRead(f.client, unitScope, rosterBody, rosterReply());
  const filename = join(f.directory, readdirSync(f.directory)[0]);
  const safe = readFileSync(filename);
  const external = realpathSync(mkdtempSync(join(tmpdir(), "edupi-classroom-cache-external-")));
  t.after(() => rmSync(external, { recursive: true, force: true }));
  const sentinel = join(external, "sentinel.json");
  writeFileSync(sentinel, safe, { mode: 0o600 });
  unlinkSync(filename); symlinkSync(sentinel, filename);
  assert.equal(await cachedCloudClassroomRead(f.client, unitScope, rosterBody), null);
  await rememberCloudClassroomRead(f.client, unitScope, rosterBody, rosterReply());
  assert.deepEqual(readFileSync(sentinel), safe);
  unlinkSync(filename); linkSync(sentinel, filename);
  assert.equal(await cachedCloudClassroomRead(f.client, unitScope, rosterBody), null);
  unlinkSync(filename); writeFileSync(filename, safe, { mode: 0o600 }); chmodSync(filename, 0o644);
  assert.equal(await cachedCloudClassroomRead(f.client, unitScope, rosterBody), null);
  chmodSync(filename, 0o600); writeFileSync(filename, "{broken");
  assert.equal(await cachedCloudClassroomRead(f.client, unitScope, rosterBody), null);
});

test("a late response cannot populate or read cache after the active scope changes", async t => {
  const f = cacheFixture(t);
  let finish;
  f.network = () => new Promise(resolve => { finish = resolve; });
  const reading = readCloudClassroomForPreparation(f.client, unitScope, rosterBody);
  while (!finish) await Promise.resolve();
  f.active = { ...unitScope, accountId: randomUUID(), generation: 2 };
  finish(rosterReply());
  await assert.rejects(reading, { code: "scope_changed" });
  assert.equal(readdirSync(f.directory).length, 0);
});
const pgEnabled = process.env.EDUPI_CLASSROOM_PG === "1" && Boolean(process.env.EDUPI_CORE_ROOT);
const integration = { skip: pgEnabled ? false : "requires EDUPI_CLASSROOM_PG=1 and a complete pinned EDUPI_CORE_ROOT" };
const container = "supabase_db_edupi-desktop";
let database;
const docker = args => execFileSync("docker", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
const sql = query => docker(["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", database,
  "-v", "ON_ERROR_STOP=1", "-At", "-c", query]).trim();
const literal = value => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const rpc = (name, workspace, body) => JSON.parse(sql(`select edupi.${name}('${workspace}','${actor}',${literal(body)});`));

before(() => {
  if (!pgEnabled) return;
  database = `classroom_cache_${randomUUID().replaceAll("-", "")}`;
  const schema = docker(["exec", container, "pg_dump", "-U", "postgres", "-d", "postgres",
    "--schema-only", "--no-owner", "--no-privileges", "-n", "auth", "-n", "edupi"]);
  docker(["exec", container, "createdb", "-U", "postgres", database]);
  sql("create schema extensions; create extension pgcrypto with schema extensions;");
  execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", database,
    "-v", "ON_ERROR_STOP=1"], { input: schema, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  sql("alter table edupi.student_profiles add column if not exists profile_revision integer not null default 0;");
  sql(readFileSync(new URL("../supabase/migrations/20261122185235_edupi_classroom_verified_writes.sql", import.meta.url), "utf8"));
  sql(`insert into auth.users(id) values('${actor}');`);
  if (sql("select count(*) from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='edupi' and p.proname='mobile_dashboard_payload'") === "0") {
    const source = readFileSync(new URL("../supabase/migrations/20261121120000_edupi_mobile_snapshot.sql", import.meta.url), "utf8");
    sql(source.slice(source.indexOf("create or replace function edupi.mobile_dashboard_payload"),
      source.indexOf("create or replace function edupi.workspace_snapshot_payload")));
  }
});
after(() => {
  if (database) docker(["exec", container, "dropdb", "-U", "postgres", "--force", database]);
});

async function fixture(t) {
  const workspace = randomUUID();
  sql(`insert into edupi.workspaces(id,owner_account_id,mode) values('${workspace}','${actor}','cloud');
    insert into edupi.workspace_members(workspace_id,account_id,role) values('${workspace}','${actor}','owner');`);
  for (const student of roster) sql(`insert into edupi.student_profiles(workspace_id,student_id,name,class_name,profile)
    values('${workspace}','${student.student_id}','${student.name}','${student.class_name}',${literal({ traits: [] })});`);
  const stateDir = realpathSync(mkdtempSync(join(tmpdir(), "edupi-classroom-cache-state-")));
  t.after(() => rmSync(stateDir, { recursive: true, force: true }));
  const server = { offline: false, readStatus: 0, reads: [], writes: [] };
  const fetchImpl = async (url, init) => {
    if (server.offline) throw new TypeError("synthetic offline");
    const body = JSON.parse(init.body || "{}");
    if (String(url).includes("/auth/v1/token")) return Response.json({
      access_token: "synthetic-cache-access", refresh_token: "synthetic-cache-refresh", expires_in: 3600,
      user: { id: actor, email: "cache@example.invalid" },
    });
    if (String(url).includes("/edupi-account")) return Response.json({ workspaces: [{ id: workspace, mode: "cloud" }] });
    assert.equal(init.headers["x-edupi-workspace-id"], workspace);
    if (body.operation === "mobile-dashboard") return Response.json({
      ok: true, operation: "mobile-dashboard", contract: EDUPI_MOBILE_DASHBOARD_CONTRACT,
      payload: JSON.parse(sql(`select edupi.mobile_dashboard_payload('${workspace}');`)), external_send: false,
    });
    if (["save", "restore", "publish"].includes(body.action)) {
      server.writes.push(structuredClone(body));
      assert.equal(verifyHostClassroomComputation(body), true, "the body must contain real pinned Core computation");
      try {
        rpc("admit_classroom_computation", workspace, body);
        return Response.json(rpc("mutate_classroom_object", workspace, body));
      } catch (error) {
        const message = String(error.stderr || error.message);
        const conflict = ["stale_roster", "stale_revision", "idempotency_conflict", "stale_reference"].find(code => message.includes(code));
        if (conflict) return Response.json({ code: conflict }, { status: 409 });
        throw error;
      }
    }
    server.reads.push(structuredClone(body));
    if (server.readStatus) return Response.json({
      code: server.readStatus >= 500 ? "classroom_unavailable" : server.readStatus === 403 ? "workspace_forbidden" : "not_found",
    }, { status: server.readStatus });
    try { return Response.json(rpc("cloud_classroom_read", workspace, body)); }
    catch (error) {
      if (String(error.stderr || error.message).includes("not_found")) return Response.json({ code: "not_found" }, { status: 404 });
      throw error;
    }
  };
  const options = { stateDir, env: { SUPABASE_URL: "https://cache.fixture.invalid", SUPABASE_ANON_KEY: "synthetic-public" }, fetchImpl };
  let client = createEduPiCloudClient(options);
  await client.login("cache@example.invalid", "synthetic-only");
  await client.selectWorkspace(workspace);
  return {
    workspace, stateDir, server, get client() { return client; },
    rebuild() { client = createEduPiCloudClient(options); return client; },
    call: async request => cloudClassroomService(request, client, await client.captureScope()),
  };
}

test("download roster, first save while offline, recreate client, reconnect and clear outbox with real readback", integration, async t => {
  const f = await fixture(t);
  await f.call({ domain: "grades", action: "roster", request_id: "download-roster" });
  f.server.offline = true;
  const queued = await f.call({ domain: "grades", action: "save", id: "offline-first", expected_revision: 0,
    request_id: "offline-first-save", input: grade });
  assert.equal(queued.queued, true);
  const pending = structuredClone((await f.client.outbox())[0]);
  assert.equal(pending.body.computed.result.subjects[0].mean, 70);
  assert.equal(sql(`select count(*) from edupi.classroom_objects where workspace_id='${f.workspace}'`), "0");
  f.rebuild();
  assert.deepEqual((await f.client.outbox())[0].body, pending.body);
  f.server.offline = false;
  const result = await f.client.flushOutbox();
  assert.equal(result.flushed, 1);
  assert.equal((await f.client.outbox()).length, 0);
  assert.deepEqual(f.server.writes[0], pending.body);
  const read = await f.call({ domain: "grades", action: "read", id: "offline-first", request_id: "read-saved" });
  assert.equal(read.record.revision, 1);
  assert.equal(read.record.result.subjects[0].mean, 70);
  assert.equal(sql(`select count(*) from edupi.classroom_object_versions where workspace_id='${f.workspace}'`), "1");
});

test("offline first save keeps the original outbox body when the server detects stale_roster", integration, async t => {
  const f = await fixture(t);
  await f.call({ domain: "grades", action: "roster", request_id: "stale-roster-download" });
  f.server.offline = true;
  const queued = await f.call({ domain: "grades", action: "save", id: "stale-roster-plan", expected_revision: 0,
    request_id: "stale-roster-save", input: grade });
  assert.equal(queued.queued, true);
  const original = structuredClone((await f.client.outbox())[0].body);
  f.rebuild();
  sql(`update edupi.student_profiles set revision=revision+1,profile_revision=profile_revision+1
    where workspace_id='${f.workspace}' and student_id='cache-0';`);
  f.server.offline = false;
  assert.equal((await f.client.flushOutbox()).flushed, 0);
  const conflict = (await f.client.outbox())[0];
  assert.equal(conflict.status, "conflict");
  assert.equal(conflict.lastError, "stale_roster");
  assert.deepEqual(conflict.body, original);
  assert.equal(sql(`select count(*) from edupi.classroom_objects where workspace_id='${f.workspace}'`), "0");
  const writes = f.server.writes.length;
  await f.client.flushOutbox();
  assert.equal(f.server.writes.length, writes, "conflicted writes are retained without automatic replacement");
});

test("server expected_revision still rejects an offline update prepared from an older view", integration, async t => {
  const f = await fixture(t);
  await f.call({ domain: "grades", action: "save", id: "revision-plan", expected_revision: 0, request_id: "revision-create", input: grade });
  await f.call({ domain: "grades", action: "read", id: "revision-plan", request_id: "revision-download" });
  const concurrent = structuredClone(f.server.writes[0]);
  concurrent.request_id = "revision-server-edit"; concurrent.expected_revision = 1;
  concurrent.source_request.request_id = concurrent.request_id; concurrent.source_request.expected_revision = 1;
  rpc("admit_classroom_computation", f.workspace, concurrent);
  rpc("mutate_classroom_object", f.workspace, concurrent);
  f.server.offline = true;
  const queued = await f.call({ domain: "grades", action: "save", id: "revision-plan", expected_revision: 1,
    request_id: "revision-offline-edit", input: { ...grade, title: "离线修订" } });
  assert.equal(queued.queued, true);
  f.rebuild(); f.server.offline = false;
  await f.client.flushOutbox();
  const pending = (await f.client.outbox())[0];
  assert.equal(pending.status, "conflict");
  assert.equal(pending.lastError, "stale_revision");
  assert.equal(rpc("cloud_classroom_read", f.workspace, { domain: "grades", action: "read", id: "revision-plan" }).record.revision, 2);
});

test("cached exact reads prepare offline restore, and cached references prepare a real baseline computation", integration, async t => {
  const f = await fixture(t);
  await f.call({ domain: "grades", action: "save", id: "cached-grade", expected_revision: 0, request_id: "history-create", input: grade });
  await f.call({ domain: "grades", action: "read", id: "cached-grade", request_id: "history-download-1" });
  await f.call({ domain: "grades", action: "save", id: "cached-grade", expected_revision: 1, request_id: "history-edit",
    input: { ...grade, title: "在线修订" } });
  await f.call({ domain: "grades", action: "read", id: "cached-grade", request_id: "history-download-2" });
  f.server.offline = true;
  const restore = await f.call({ domain: "grades", action: "restore", id: "cached-grade", expected_revision: 2,
    revision: 1, request_id: "history-offline-restore" });
  assert.equal(restore.queued, true);
  f.rebuild(); f.server.offline = false;
  assert.equal((await f.client.flushOutbox()).flushed, 1);
  const restored = await f.call({ domain: "grades", action: "read", id: "cached-grade", request_id: "history-download-3" });
  assert.equal(restored.record.revision, 3);
  assert.equal(restored.record.input.title, grade.title);
  f.server.offline = true;
  const comparison = await f.call({ domain: "grades", action: "save", id: "cached-comparison", expected_revision: 0,
    request_id: "comparison-offline", input: { ...grade, baseline_id: "cached-grade",
      rows: grade.rows.map(item => ({ ...item, scores: { 数学: item.scores.数学 + 5 } })) } });
  assert.equal(comparison.queued, true);
  assert.equal((await f.client.outbox())[0].body.computed.result.comparison.students[0].delta, 5);
  f.server.offline = false;
  assert.equal((await f.client.flushOutbox()).flushed, 1);
  assert.equal((await f.client.outbox()).length, 0);
});

test("cached duty read prepares an offline publish whose real task is created after reconnect", integration, async t => {
  const f = await fixture(t);
  await f.call({ domain: "duty", action: "save", id: "cached-duty", expected_revision: 0, request_id: "duty-create", input: duty });
  await f.call({ domain: "duty", action: "read", id: "cached-duty", request_id: "duty-download" });
  f.server.offline = true;
  const queued = await f.call({ domain: "duty", action: "publish", id: "cached-duty", expected_revision: 1, request_id: "duty-offline-publish" });
  assert.equal(queued.queued, true);
  assert.equal(sql(`select count(*) from edupi.tasks where workspace_id='${f.workspace}'`), "0");
  f.rebuild(); f.server.offline = false;
  assert.equal((await f.client.flushOutbox()).flushed, 1);
  assert.equal(sql(`select count(*) from edupi.tasks where workspace_id='${f.workspace}' and task_id='duty-cached-duty'`), "1");
  assert.equal((await f.client.outbox()).length, 0);
});

test("offline preparation never fabricates an object or historical version not downloaded", integration, async t => {
  const f = await fixture(t);
  await f.call({ domain: "grades", action: "roster", request_id: "only-roster" });
  f.server.offline = true;
  await assert.rejects(f.call({ domain: "duty", action: "publish", id: "never-downloaded", expected_revision: 1, request_id: "missing-publish" }),
    { code: "network_unavailable" });
  await assert.rejects(f.call({ domain: "grades", action: "restore", id: "never-downloaded", expected_revision: 1, revision: 99, request_id: "missing-restore" }),
    { code: "network_unavailable" });
  assert.equal((await f.client.outbox()).length, 0);
});

test("even an exact cached saved revision cannot acknowledge a write while its live verifier read fails", integration, async t => {
  const f = await fixture(t);
  await f.call({ domain: "grades", action: "save", id: "verify-live", expected_revision: 0, request_id: "verify-create", input: grade });
  await f.call({ domain: "grades", action: "read", id: "verify-live", request_id: "verify-download-1" });
  f.server.readStatus = 503;
  const queued = await f.call({ domain: "grades", action: "save", id: "verify-live", expected_revision: 1, request_id: "verify-edit",
    input: { ...grade, title: "等待真实回读" } });
  assert.equal(queued.queued, true);
  assert.equal(rpc("cloud_classroom_read", f.workspace, { domain: "grades", action: "read", id: "verify-live" }).record.revision, 2);
  f.server.readStatus = 0;
  await f.call({ domain: "grades", action: "read", id: "verify-live", request_id: "verify-download-exact-2" });
  const cached = await cachedCloudClassroomRead(f.client, await f.client.captureScope(), { domain: "grades", action: "read", id: "verify-live" });
  assert.equal(cached.record.revision, 2);
  f.server.readStatus = 503;
  const readsBefore = f.server.reads.length;
  assert.equal((await f.client.flushOutbox()).flushed, 0);
  assert.ok(f.server.reads.length > readsBefore, "verification must attempt a real network read despite the matching cache");
  assert.equal((await f.client.outbox()).length, 1);
  assert.equal((await f.client.outbox())[0].status, "pending");
  f.server.readStatus = 0;
  assert.equal((await f.client.flushOutbox()).flushed, 1);
  assert.equal((await f.client.outbox()).length, 0);
});
