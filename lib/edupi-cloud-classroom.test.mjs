import assert from "node:assert/strict";
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import test, { before, after } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, moduleCache: false });
const { computeCloudClassroom } = await jiti.import("./edupi-cloud-classroom-compute.ts");
const { cloudClassroomService } = await jiti.import("./edupi-cloud-classroom.ts");
const { verifyCloudClassroomWrite } = await jiti.import("./edupi-cloud-classroom-verification.ts");
const { createEduPiCloudClient } = await jiti.import("./edupi-cloud-client.ts");
const { verifyHostClassroomComputation } = await jiti.import("../supabase/functions/edupi-classroom/compute.ts");
const coreSources = JSON.parse(readFileSync(new URL("../supabase/functions/edupi-classroom/core/source.json", import.meta.url), "utf8"));
const roster = Array.from({ length: 6 }, (_, i) => ({
  student_id: `cloud-${i}`, name: `合成${i}`, class_name: "隔离班", traits: [],
  revision: 0, profile_revision: 0,
}));
const grade = { title: "云端考试", class_name: "隔离班", date: "2026-11-23", subjects: [{ name: "数学", max_score: 100 }],
  rows: roster.map((s, i) => ({ row_id: `r${i}`, student_id: s.student_id, name: s.name, scores: { 数学: 45 + i * 10 } })) };
const seating = { title: "云端座位", class_name: "隔离班", mode: "seating", rows: 2, columns: 3, group_size: 3,
  student_ids: roster.map(s => s.student_id), features: {}, constraints: { gender_strategy: "ignore", avoid_pairs: [], fixed_seats: [] } };
const duty = { title: "云端值日", class_name: "隔离班", start_date: "2026-11-23", days: 5,
  weekdays: [1, 2, 3, 4, 5], student_ids: roster.map(s => s.student_id), exempt_ids: ["cloud-5"],
  posts: [{ id: "floor", name: "扫地", count: 1, weight: 2, gender: "any" }], max_per_day: 1, max_days_per_week: 5 };
const workspace = "10000000-0000-4000-8000-000000000001";
const actor = "20000000-0000-4000-8000-000000000001";
const actorB = "20000000-0000-4000-8000-000000000002";
const scope = { issuer: "https://fixture.invalid", accountId: actor, workspaceId: workspace, generation: 1 };
const coreAvailable = Boolean(process.env.EDUPI_CORE_ROOT);
const pgAvailable = coreAvailable && process.env.EDUPI_CLASSROOM_PG === "1";
const coreOptions = { skip: coreAvailable ? false : "EDUPI_CORE_ROOT required for real pinned Core computation" };

test("Edge engines are byte-for-byte copies of the pinned Core engines", coreOptions, () => {
  for (const file of coreSources.files) {
    const original = readFileSync(join(process.env.EDUPI_CORE_ROOT, "scripts/classroom", file.path));
    const copied = readFileSync(new URL(`../supabase/functions/edupi-classroom/core/${file.path}`, import.meta.url));
    assert.deepEqual(copied, original);
    assert.equal(createHash("sha256").update(copied).digest("hex"), file.sha256);
  }
});

test("preview calls actual pinned Core grade/seating/duty functions and never calls a writer", coreOptions, async () => {
  let writes = 0;
  const client = { operation: async (_op, body) => {
    assert.equal(body.action, "roster");
    return { ok: true, operation: "classroom", action: "roster", workspace_id: workspace, external_send: false, students: roster };
  }, operationWithOutbox: async () => { writes++; throw Error("preview wrote"); } };
  for (const [domain, input] of [["grades", grade], ["seating", seating], ["duty", duty]]) {
    const response = await cloudClassroomService({ domain, action: "preview", input }, client, scope);
    assert.equal(response.action, "preview");
    assert.equal(response.external_send, false);
    assert.ok(response.result);
    assert.deepEqual(response.issues.filter(issue => issue.severity === "error"), []);
    if (domain === "grades") assert.equal(response.result.subjects[0].mean, 70);
    if (domain === "seating") assert.deepEqual(response.result.assignments.map(s => s.student_id).sort(), roster.map(s => s.student_id).sort());
    if (domain === "duty") assert.equal(response.result.assignments.some(a => a.student_ids.includes("cloud-5")), false);
    const computed = await computeCloudClassroom(domain, input, roster);
    assert.equal(verifyHostClassroomComputation({ domain, computed }), true);
  }
  assert.equal(writes, 0);
});

test("name-only and cross-cloud/class student identities are rejected before computation", coreOptions, async () => {
  for (const rows of [
    grade.rows.map(row => { const copy = { ...row }; delete copy.student_id; return copy; }),
    grade.rows.map((row, i) => i ? row : { ...row, student_id: "local-student" }),
  ]) await assert.rejects(computeCloudClassroom("grades", { ...grade, rows }, roster), /云端班级.*学生 ID/u);
  await assert.rejects(computeCloudClassroom("seating", seating, roster.map(s => ({ ...s, class_name: "其他班" }))), /云端班级.*学生 ID/u);
});

test("queued retry reuses first full computation before reading a new roster", async () => {
  const source = { domain: "duty", action: "save", id: "queued", expected_revision: 0, input: duty, request_id: "stable" };
  const body = { ...source, source_request: source, computed: { first: "immutable" } };
  let persisted = null;
  const client = {
    state: async () => ({ outbox: [{ operation: "classroom", issuer: scope.issuer, accountId: actor,
      workspaceId: workspace, body }], completed: [] }),
    operation: async () => { throw Error("must not fetch changed roster"); },
    operationWithOutbox: async (op, value, selected) => {
      assert.equal(op, "classroom"); assert.deepEqual(selected, scope); persisted = value;
      return { queued: true, entry: { id: "durable-id" } };
    },
  };
  const result = await cloudClassroomService(source, client, scope, undefined, async () => { throw Error("must not recompute"); });
  assert.equal(result.queued, true); assert.deepEqual(persisted, body);
  await assert.rejects(cloudClassroomService({ ...source, input: { ...duty, title: "changed" } }, client, scope), /相同请求 ID/u);
});

test("default request identity binds the actor and remains stable for the same payload", async () => {
  const ids = [];
  const client = { state: async () => ({ outbox: [], completed: [] }),
    operation: async () => ({ ok: true, operation: "classroom", action: "roster",
      workspace_id: workspace, external_send: false, students: roster }),
    operationWithOutbox: async (_operation, body) => { ids.push(body.request_id); return { queued: true, entry: { id: body.request_id } }; },
  };
  const request = { domain: "duty", action: "save", input: duty };
  const compute = async () => ({ input: duty, result: { assignments: [] }, issues: [] });
  await cloudClassroomService(request, client, scope, undefined, compute);
  await cloudClassroomService(request, client, scope, undefined, compute);
  await cloudClassroomService(request, client, { ...scope, accountId: actorB }, undefined, compute);
  assert.equal(ids[0], ids[1]); assert.notEqual(ids[0], ids[2]);
});

let database, directory;
const container = "supabase_db_edupi-desktop";
const docker = args => execFileSync("docker", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
const sql = query => docker(["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1", "-At", "-c", query]).trim();
const literal = value => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const call = (name, body, account = actor, ws = workspace) => {
  if (name === "mutate_classroom_object") sql(`select edupi.admit_classroom_computation('${ws}','${account}',${literal(body)});`);
  return JSON.parse(sql(`select edupi.${name}('${ws}'::uuid,'${account}'::uuid,${literal(body)});`));
};
function read(operation, body = {}) {
  if (operation === "classroom") return Promise.resolve(call("cloud_classroom_read", body));
  assert.equal(operation, "mobile-dashboard");
  return Promise.resolve(JSON.parse(sql(`select jsonb_build_object('external_send',false,'payload',edupi.mobile_dashboard_payload('${workspace}'));`)));
}
const payload = (action, id, requestId, expected, computed, extra = {}) => {
  const source = { domain: id.startsWith("grade") ? "grades" : "duty", action, id, request_id: requestId,
    expected_revision: expected, ...extra };
  return { ...source, source_request: source, computed };
};
before(() => {
  if (!pgAvailable) return;
  directory = mkdtempSync(join(tmpdir(), "edupi-cloud-classroom-db-"));
  database = `classroom_test_${randomUUID().replaceAll("-", "")}`;
  const schema = docker(["exec", container, "pg_dump", "-U", "postgres", "-d", "postgres", "--schema-only", "--no-owner", "--no-privileges", "-n", "edupi", "-n", "auth"]);
  docker(["exec", container, "createdb", "-U", "postgres", database]);
  sql("create schema extensions; create extension pgcrypto with schema extensions;");
  execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1"], { input: schema, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  sql("alter table edupi.student_profiles add column if not exists profile_revision integer not null default 0;");
  sql(readFileSync(new URL("../supabase/migrations/20261122185235_edupi_classroom_verified_writes.sql", import.meta.url), "utf8"));
  sql(`insert into auth.users(id) values('${actor}'),('${actorB}');
    insert into edupi.workspaces(id,owner_account_id,mode) values('${workspace}','${actor}','cloud');
    insert into edupi.workspace_members(workspace_id,account_id,role) values('${workspace}','${actor}','owner'),('${workspace}','${actorB}','teacher');`);
  for (const s of roster) sql(`insert into edupi.student_profiles(workspace_id,student_id,name,class_name,profile)
    values('${workspace}','${s.student_id}','${s.name}','${s.class_name}',${literal({ traits: [] })});`);
  // Production mobile projection, used for the independent publication readback.
  if (sql("select count(*) from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='edupi' and p.proname='mobile_dashboard_payload'") === "0") {
    const source = readFileSync(new URL("../supabase/migrations/20261121120000_edupi_mobile_snapshot.sql", import.meta.url), "utf8");
    sql(source.slice(source.indexOf("create or replace function edupi.mobile_dashboard_payload"), source.indexOf("create or replace function edupi.workspace_snapshot_payload")));
  }
});
after(() => {
  if (database) docker(["exec", container, "dropdb", "-U", "postgres", "--force", database]);
  if (directory) rmSync(directory, { recursive: true, force: true });
});
const pgOptions = { skip: pgAvailable ? false : "EDUPI_CLASSROOM_PG=1 and pinned Core required for isolated PostgreSQL behavior tests" };

test("real SQL save/replay/changed actor/changed payload/expected revision are durable", pgOptions, async () => {
  const computed = await computeCloudClassroom("grades", grade, roster);
  const body = payload("save", "grade-a", "grade-save-1", 0, computed, { input: grade });
  const first = call("mutate_classroom_object", body);
  assert.equal(first.record.revision, 1);
  await verifyCloudClassroomWrite(body, first, workspace, read);
  assert.equal(call("mutate_classroom_object", body).replayed, true);
  assert.throws(() => call("mutate_classroom_object", body, actorB), /idempotency_conflict/);
  assert.throws(() => call("mutate_classroom_object", { ...body, computed: { ...computed, result: {} } }), /idempotency_conflict/);
  assert.throws(() => call("mutate_classroom_object", payload("save", "grade-a", "stale", 0, computed)), /stale_revision/);
  assert.equal(sql(`select count(*) from edupi.classroom_object_versions where object_id='grade-a'`), "1");
});

test("real grade baseline uses cloud reference and restore exactly recovers saved version", pgOptions, async () => {
  const references = [call("cloud_classroom_read", { domain: "grades", action: "read", id: "grade-a" }).record];
  const input = { ...grade, title: "第二次考试", baseline_id: "grade-a",
    rows: grade.rows.map(r => ({ ...r, scores: { 数学: r.scores.数学 + 5 } })) };
  const computed = await computeCloudClassroom("grades", input, roster, references);
  assert.equal(computed.result.comparison.students[0].delta, 5);
  const created = payload("save", "grade-b", "grade-b-create", 0, computed, { input });
  await verifyCloudClassroomWrite(created, call("mutate_classroom_object", created), workspace, read);
  const changed = await computeCloudClassroom("grades", { ...grade, title: "修订" }, roster);
  const revision = payload("save", "grade-a", "grade-a-edit", 1, changed);
  call("mutate_classroom_object", revision);
  const original = await computeCloudClassroom("grades", grade, roster);
  const restore = payload("restore", "grade-a", "grade-a-restore", 2, original, { revision: 1 });
  const restored = call("mutate_classroom_object", restore);
  await verifyCloudClassroomWrite(restore, restored, workspace, read);
  assert.equal(restored.record.revision, 3); assert.equal(restored.record.input.title, grade.title);
});

test("a concurrently revised reference cannot silently change a seating plan", pgOptions, async () => {
  const old = call("cloud_classroom_read", { domain: "grades", action: "read", id: "grade-a", revision: 1 }).record;
  const input = { ...seating, exam_id: "grade-a" };
  const computed = await computeCloudClassroom("seating", input, roster, [old]);
  const body = payload("save", "stale-seat", "stale-seat", 0, computed, { domain: "seating", input });
  assert.throws(() => call("mutate_classroom_object", body), /stale_reference/);
  assert.equal(sql("select count(*) from edupi.classroom_objects where object_id='stale-seat'"), "0");
});

test("real duty publish inserts one actual task and readback rejects a fake task link", pgOptions, async () => {
  const computed = await computeCloudClassroom("duty", duty, roster);
  const saved = payload("save", "duty-a", "duty-save", 0, computed);
  call("mutate_classroom_object", saved);
  const publish = payload("publish", "duty-a", "duty-publish", 1, computed);
  const result = call("mutate_classroom_object", publish);
  assert.equal(result.record.publication.state, "linked");
  assert.equal(result.task.task_id, "duty-duty-a");
  await verifyCloudClassroomWrite(publish, result, workspace, read);
  assert.equal(call("mutate_classroom_object", publish).replayed, true);
  assert.equal(sql(`select count(*) from edupi.tasks where task_id='duty-duty-a'`), "1");
  assert.equal(sql(`select count(*) from edupi.teacher_tasks where task_id='duty-duty-a'`), "1");
  await assert.rejects(verifyCloudClassroomWrite(publish, result, workspace, async (op, body) =>
    op === "mobile-dashboard" ? { external_send: false, payload: { workspace_id: workspace, tasks: [] } } : read(op, body)));
});

test("actual durable client recreates and replays the first host body after lost responses", pgOptions, async t => {
  const stateDir = mkdtempSync(join(tmpdir(), "edupi-classroom-outbox-"));
  t.after(() => rmSync(stateDir, { recursive: true, force: true }));
  const writes = [];
  let lastResult, rosterReads = 0;
  const transport = async (url, init) => {
    const body = JSON.parse(init.body || "{}");
    if (String(url).includes("/auth/v1/token")) return Response.json({
      access_token: "synthetic-only", refresh_token: "synthetic-refresh", expires_in: 3600,
      user: { id: actor, email: "synthetic@example.invalid" },
    });
    if (String(url).includes("/edupi-account")) return Response.json({ workspaces: [{ id: workspace, mode: "cloud" }] });
    assert.equal(init.headers["x-edupi-workspace-id"], workspace);
    if (["save", "restore", "publish"].includes(body.action)) {
      writes.push(init.body);
      lastResult = call("mutate_classroom_object", body);
      throw new TypeError("synthetic response lost after commit");
    }
    if (body.action === "roster") rosterReads++;
    return Response.json(call("cloud_classroom_read", body));
  };
  const options = { stateDir, env: { SUPABASE_URL: "https://fixture.invalid", SUPABASE_ANON_KEY: "synthetic-public" }, fetchImpl: transport };
  let client = createEduPiCloudClient(options);
  await client.login("synthetic@example.invalid", "synthetic-only");
  await client.selectWorkspace(workspace);
  const request = { domain: "duty", action: "save", id: "outbox-duty", expected_revision: 0, request_id: "outbox-create", input: duty };
  const first = await cloudClassroomService(request, client, await client.captureScope());
  assert.equal(first.queued, true);
  const saved = structuredClone((await client.outbox())[0]);
  assert.equal(saved.body.computed.result.assignments.length, 5);
  client = createEduPiCloudClient(options);
  const second = await cloudClassroomService(request, client, await client.captureScope(), undefined, () => { throw Error("recomputed on replay"); });
  assert.equal(second.queued, true);
  assert.equal(rosterReads, 1);
  assert.equal(writes.length, 2);
  assert.equal(writes[0], writes[1]);
  assert.deepEqual((await client.outbox())[0].body, saved.body);
  assert.equal(sql("select count(*) from edupi.classroom_object_versions where object_id='outbox-duty'"), "1");
  await verifyCloudClassroomWrite(saved.body, lastResult, workspace, read);
});

test("two actual PostgreSQL connections cannot overwrite one expected revision", pgOptions, async () => {
  const computed = await computeCloudClassroom("duty", duty, roster);
  const requests = ["race-a", "race-b"].map(id => payload("save", "race-plan", id, 0, computed));
  for (const body of requests) call("admit_classroom_computation", body);
  const asyncExec = promisify(execFile);
  const results = await Promise.allSettled(requests.map(body => asyncExec("docker", [
    "exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1", "-At",
    "-c", `select edupi.mutate_classroom_object('${workspace}','${actor}',${literal(body)});`,
  ])));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.filter(result => result.status === "rejected" && /stale_revision/.test(result.reason.stderr)).length, 1);
  assert.equal(sql("select count(*) from edupi.classroom_object_versions where object_id='race-plan'"), "1");
});

test("Edge and database reject fabricated computation before writing; host verifier also refuses it", pgOptions, async () => {
  const computed = await computeCloudClassroom("grades", grade, roster);
  const forged = structuredClone(computed); forged.result.subjects[0].mean = 999;
  const body = payload("save", "grade-forged", "forged", 0, forged);
  assert.equal(verifyHostClassroomComputation(body), false);
  assert.throws(() => sql(`select edupi.mutate_classroom_object('${workspace}','${actor}',${literal(body)});`), /compute_admission_required/);
  const response = { ok: true, operation: "classroom", action: "save", workspace_id: workspace, request_id: "forged",
    external_send: false, replayed: false, record: { id: "grade-forged", domain: "grades", revision: 1,
      input: forged.input, result: forged.result, issues: forged.issues,
      versions: [{ revision: 1, action: "save", restored_from: null }] } };
  await assert.rejects(verifyCloudClassroomWrite(body, response, workspace, read));
});

test("SQL rejects empty computation, stale roster, revoked actor and phantom preview", pgOptions, async () => {
  assert.throws(() => call("mutate_classroom_object", { domain: "duty", action: "preview", id: "fake", request_id: "fake", expected_revision: 0 }), /invalid_request/);
  const computed = await computeCloudClassroom("duty", duty, roster);
  assert.throws(() => call("mutate_classroom_object", payload("save", "empty", "empty", 0, { ...computed, result: {} })), /compute_required/);
  assert.throws(() => call("mutate_classroom_object", payload("save", "old-roster", "old-roster", 0, { ...computed, roster: roster.slice(1) })), /stale_roster/);
  sql(`update edupi.workspace_members set revoked_at=now() where workspace_id='${workspace}' and account_id='${actorB}'`);
  assert.throws(() => call("mutate_classroom_object", payload("save", "revoked", "revoked", 0, computed), actorB), /workspace_forbidden/);
});

test("reviewer can read but cannot attest/write; browser roles cannot bypass the Edge admission", pgOptions, async () => {
  sql(`update edupi.workspace_members set role='reviewer',revoked_at=null where workspace_id='${workspace}' and account_id='${actorB}'`);
  const response = call("cloud_classroom_read", { domain: "duty", action: "roster" }, actorB);
  assert.equal(response.students.length, roster.length);
  const computed = await computeCloudClassroom("duty", duty, roster);
  assert.throws(() => call("mutate_classroom_object", payload("save", "reviewer", "reviewer", 0, computed), actorB), /workspace_forbidden/);
  for (const name of ["admit_classroom_computation", "mutate_classroom_object"]) {
    assert.equal(sql(`select has_function_privilege('authenticated','edupi.${name}(uuid,uuid,jsonb)','EXECUTE');`), "f");
    assert.equal(sql(`select has_function_privilege('anon','edupi.${name}(uuid,uuid,jsonb)','EXECUTE');`), "f");
    assert.equal(sql(`select has_function_privilege('service_role','edupi.${name}(uuid,uuid,jsonb)','EXECUTE');`), "t");
  }
});
