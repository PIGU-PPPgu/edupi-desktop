#!/usr/bin/env node
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createJiti } from "jiti";

assert.equal(process.platform, "darwin", "this isolated source harness covers macOS only");
assert.ok(process.env.EDUPI_CORE_ROOT && path.isAbsolute(process.env.EDUPI_CORE_ROOT), "EDUPI_CORE_ROOT is required");
const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
assert.equal(fs.realpathSync(process.cwd()), fs.realpathSync(desktopRoot), "run from this Desktop worktree");
const coreRoot = fs.realpathSync(process.env.EDUPI_CORE_ROOT);
const git = (root, ...args) => childProcess.execFileSync("git", ["-C", root, ...args], { encoding: "utf8", timeout: 15_000 }).trim();
const identity = { desktopCommit: git(desktopRoot, "rev-parse", "HEAD"), coreCommit: git(coreRoot, "rev-parse", "HEAD"),
  desktopDirty: Boolean(git(desktopRoot, "status", "--porcelain")), coreDirty: Boolean(git(coreRoot, "status", "--porcelain")) };
const compatibility = JSON.parse(fs.readFileSync(path.join(desktopRoot, "contracts/edupi-core-compat.json"), "utf8"));
assert.equal(identity.coreCommit, compatibility.core_runtime.core_commit, "the joint harness requires the pinned Core commit");
assert.equal(identity.coreDirty, false, "the pinned Core worktree must be clean");
const digestFile = file => `sha256:${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
const sourceHashes = Object.fromEntries([
  "scripts/test-edupi-reflection-source-joint.mjs", "app/api/edupi/proactivity/reflection/route.ts",
  "app/api/edupi/proactivity/route.ts", "lib/edupi-proactivity-control.ts", "lib/edupi-proactivity-config.ts", "lib/edupi-reflection-client.ts",
  "lib/edupi-reflection-index.ts", "lib/edupi-reflection-operation.ts", "contracts/edupi-core-compat.json",
].map(file => [file, digestFile(path.join(desktopRoot, file))]));
sourceHashes.coreRuntimeManifest = digestFile(path.join(coreRoot, "contracts/edupi-core-runtime-component-manifest.json"));
const dataRoot = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "edupi-g4-joint-")));
const controlRoot = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "edupi-g4-control-")));
const home = path.join(dataRoot, ".edupi"), stateDir = path.join(controlRoot, "desktop-state");
const agentDir = path.join(controlRoot, "synthetic-agent"), memoryDir = path.join(home, "memory");
for (const directory of [stateDir, agentDir, memoryDir, path.join(home, "output"), path.join(home, "locks")]) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}
const token = crypto.randomBytes(32).toString("hex");
const environment = { EDUPI_PROJECT_ROOT: dataRoot, EDUPI_DATA_ROOT: dataRoot, EDUPI_DATA_ALLOWED_ROOT: path.dirname(dataRoot),
  EDUPI_CORE_ROOT: coreRoot, EDUPI_CORE_ALLOWED_ROOT: path.dirname(coreRoot), EDUPI_HOME: home,
  EDUPI_MEMORY_DIR: memoryDir, EDUPI_OUTPUT_DIR: path.join(home, "output"), EDUPI_LOCK_DIR: path.join(home, "locks"),
  PI_DESKTOP_STATE_DIR: stateDir, PI_DESKTOP_API_TOKEN: token, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1",
  EDUPI_DESKTOP_ISOLATED_CANARY: "1", TMPDIR: "/tmp" };
const previous = new Map([...Object.keys(environment), "EDUPI_AMBIENT_PLANNING"].map(key => [key, process.env[key]]));
Object.assign(process.env, environment);
delete process.env.EDUPI_AMBIENT_PLANNING;
const originalFetch = globalThis.fetch, originalFork = childProcess.fork;
let deniedRequests = 0, modelRequests = 0, droppedResponses = 0, refusedDesktopPosts = 0;
let dropNextOperation = null;
const mutationCalls = [];
const launches = [], runtimeFailures = [], healthChecks = [], ownerChecks = [];
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) {
    deniedRequests++;
    throw new Error("isolated harness forbids external requests");
  }
  let response;
  try { response = await originalFetch(input, options); }
  catch (error) {
    runtimeFailures.push({ operation: "fetch", errorCode: error.name });
    throw error;
  }
  if (typeof options?.body === "string") {
    const operation = JSON.parse(options.body).operation;
    const body = await response.clone().json().catch(() => null);
    if (["owner_reflection_lesson_register", "owner_reflection_completion_capture", "owner_reflection_completion_review",
      "owner_reflection_content_capture", "owner_reflection_content_review"].includes(operation)) {
      mutationCalls.push(operation);
    }
    if (operation === dropNextOperation && body?.ok === true) {
      dropNextOperation = null;
      droppedResponses++;
      throw new Error("isolated harness dropped a committed Core response");
    }
    if (body?.ok === false) runtimeFailures.push({ operation, errorCode: body.error_code });
    if (operation === "owner_read") ownerChecks.push({ operation, ok: body?.ok,
      grants: body?.result?.grants?.map(grant => ({ status: grant.status, version: grant.version, endsAt: grant.ends_at })) });
    if (operation === "owner_control") {
      const payload = JSON.parse(options.body).payload;
      ownerChecks.push({ operation, action: payload?.action, expectedVersion: payload?.expected_version,
        ok: body?.ok, errorCode: body?.error_code, grantVersion: body?.result?.grant_version });
    }
    if (operation === "health") healthChecks.push({
      capabilities: Object.fromEntries(["g3_processor", "ambient_planning", "owner_message_registration",
        "attention_delivery", "teacher_feedback"].map(key => [key, body?.result?.capabilities?.[key]])),
      capacity: body?.result?.owner_message_capacity?.storage,
    });
  }
  return response;
};
childProcess.fork = (file, args, options) => {
  assert.equal(path.resolve(file), path.join(desktopRoot, "desktop/core-runtime-host.mjs"));
  assert.equal(options.env.EDUPI_PROJECT_ROOT, dataRoot);
  const child = originalFork(file, args, options);
  const launch = { pid: child.pid, exited: false, sourceReflectionGoals: false };
  launches.push(launch);
  child.once("exit", () => { launch.exited = true; });
  child.on("message", message => {
    if (message?.type === "runtime-error") runtimeFailures.push({ operation: "runtime-start", errorCode: message.code });
    if (message?.type === "model-run") modelRequests++;
  });
  const originalSend = child.send;
  child.send = function (message, ...rest) {
    if (message?.type === "runtime-start") launch.sourceReflectionGoals = message.options.sourceReflectionGoals === true;
    return originalSend.call(this, message, ...rest);
  };
  return child;
};
syncBuiltinESMExports();
const loadCore = name => import(pathToFileURL(path.join(coreRoot, "scripts", name)).href);
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const request = (pathname, method = "GET", body, authorized = true) => new Request(`http://localhost${pathname}`, {
  method, headers: { host: "localhost", origin: "http://localhost", "sec-fetch-site": "same-origin",
    "content-type": "application/json", ...(authorized ? { "x-pi-desktop-token": token } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const checks = [];
const keepFixtures = process.env.EDUPI_E2_KEEP === "1";
let supervisor;
try {
  const { prepareCoreRuntimeRoot } = await loadCore("core_runtime_root.mjs");
  const admission = await loadCore("core_runtime_writer_admission.mjs");
  const facts = await loadCore("education_fact_store.mjs");
  const intake = await loadCore("education_intake_store.mjs");
  const schedule = await loadCore("schedule_dedupe.mjs");
  const scheduler = await loadCore("g3_capability_scheduler.mjs");
  const root = prepareCoreRuntimeRoot(dataRoot);
  assert.equal(root.ok, true);
  const now = new Date().toISOString();
  const date = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const completedAt = `${date}T11:00:00.000Z`;
  let lease = await admission.acquireCoreRuntimeWriterAdmission({ root, kind: "legacy_g4_source_seed" });
  let classroom, foreign, term, slots;
  try {
    const entity = (entity_kind, external_id) => facts.registerEducationEntity({ memoryDir, now,
      entity: { entity_kind, external_id, namespace: "isolated-desktop-g4",
        canonical_name: `合成验收-${external_id}`, aliases: [] } }).entity;
    classroom = entity("class", "selected-class");
    foreign = entity("class", "foreign-class");
    term = entity("term", "shared-term");
    slots = [1, 2, 3].map(period => {
      const selected = period < 3 ? classroom : foreign;
      const slot = { slot_id: `g4-synthetic-slot-${period}`, day_of_week: new Date(`${date}T12:00:00.000Z`).getUTCDay() || 7,
        period, subject: "math", class_id: selected.entity_id, class_name: selected.canonical_name,
        start_time: period === 2 ? "10:00" : "09:00", time_zone: "UTC", kind: "class", notes: null,
        created_at: new Date(Date.now() - 10 * 86_400_000).toISOString(),
        source_ids: [`g4-synthetic-timetable-${period}`], evidence_ids: [`g4-synthetic-timetable-${period}`],
        _source_slot_ids: [`g4-synthetic-slot-${period}`], _revision: 1, _conflicts: [], _distinct_from: [] };
      slot._dedupe_identity = schedule.timetableScheduleIdentity(slot);
      slot._content_hash = schedule.scheduleContentFingerprint(slot, "timetable");
      return slot;
    });
    intake.saveEducationIntakeState({ schema_version: 1, updated_at: now, calendar_events: [],
      timetable_slots: slots, materials: [], receipts: [], review_history: [],
      review_targets: [{ projection_kind: "timetable_import",
        target: { target_kind: "timetable_import", target_id: "isolated-g4-timetable", command_type: "import_timetable" },
        revision: 1, title: "合成验收课表", summary: "隔离验收数据", status: "accepted",
        source_ids: slots.flatMap(slot => slot.source_ids), evidence_ids: slots.flatMap(slot => slot.evidence_ids),
        teacher_review: { state: "accepted", reviewer_id: "synthetic-teacher", reviewed_at: now, note: null, revision: 1 },
        external_send: false, source_hash: `sha256:${crypto.createHash("sha256").update(JSON.stringify(slots)).digest("hex")}`,
        item_count: slots.length, conflict_count: 0, held_count: 0 }], idempotency_records: [] });
  } finally { await lease.release(); }
  const rootsModule = await jiti.import("../lib/edupi-core-snapshot.ts");
  const route = await jiti.import("../app/api/edupi/proactivity/reflection/route.ts");
  const activationRoute = await jiti.import("../app/api/edupi/proactivity/route.ts");
  const { readEduPiProactivityActivation } = await jiti.import("../lib/edupi-proactivity-config.ts");
  const client = await jiti.import("../lib/edupi-reflection-client.ts");
  supervisor = await jiti.import("../lib/edupi-runtime-supervisor.ts");
  const roots = rootsModule.resolveEduPiBridgeRoots();
  const parse = async (response, status = 200) => {
    const body = await response.json();
    assert.equal(response.status, status, JSON.stringify({ body, runtimeFailures, healthChecks: healthChecks.slice(-4), launches }));
    return body;
  };
  const read = async (query = "") => {
    const body = await parse(await route.GET(request(`/api/edupi/proactivity/reflection?date=${date}${query}`)));
    assert.equal(body.externalSend, false);
    const result = client.parseReflectionList(body, date);
    return { ...result, entries: result.entries.filter(entry => entry.content === null) };
  };
  assert.equal((await read()).enabled, false);
  await parse(await route.GET(request(`/api/edupi/proactivity/reflection?date=${date}`, "GET", undefined, false)), 403);
  checks.push("default-off-and-token-refusal");
  let host = await supervisor.ensureEduPiRuntime(roots);
  const health = await host.call("health", null), rootRef = health.result.data_root_fingerprint;
  const bootstrap = await host.callOwnerControl("owner_control", { command_id: "isolated-g4-bootstrap",
    root_ref: rootRef, expected_owner_id: null, action: "bootstrap" });
  assert.equal(bootstrap.ok, true, JSON.stringify(bootstrap));
  await supervisor.closeAllEduPiRuntimes();
  const { loadOwnerControlToken } = await jiti.import("../lib/edupi-owner-control-token.ts");
  const ownerControlToken = loadOwnerControlToken(stateDir, dataRoot);
  const { migrateCoreOwnerHistoryForTest } = await loadCore("test_core_runtime_v3_support.mjs");
  await migrateCoreOwnerHistoryForTest({ dataRoot, ownerControlToken });
  const { createCoreRuntimeMigrationQuiescenceProof } = await loadCore("core_runtime_migration_quiescence.mjs");
  const { migrateCoreRuntimePlanningV4 } = await loadCore("core_runtime_store.mjs");
  const authority = () => {
    const database = new DatabaseSync(root.databasePath, { readOnly: true });
    try {
      const value = { ...database.prepare("SELECT * FROM authority WHERE singleton=1").get() };
      return { root_ref: rootRef, fencing_generation: value.fencing_generation, authority: value };
    } finally { database.close(); }
  };
  const activate = async () => {
    const state = await parse(await activationRoute.GET(request("/api/edupi/proactivity?domain=lesson_reflection")));
    if (!state.scopes.some(scope => scope.classId === classroom.entity_id && scope.subject === "math" && scope.ready)) {
      const snapshot = await rootsModule.readEduPiEducationSnapshot({ roots });
      assert.fail(JSON.stringify({ scopes: state.scopes, timetable: snapshot.workspace.timetable, spine: snapshot.workspace.fact_spine }));
    }
    return parse(await activationRoute.POST(request("/api/edupi/proactivity", "POST", {
      domain: "lesson_reflection", enabled: true, classId: classroom.entity_id, subject: "math",
      expectedUpdatedAt: state.activation.updatedAt,
    })));
  };
  await activate();
  await supervisor.closeAllEduPiRuntimes();
  lease = await admission.acquireCoreRuntimeWriterAdmissionV3Runtime({ root, kind: "daemon", ownerControlToken });
  try {
    const before = authority();
    admission.prepareCoreRuntimeWriterAdmissionV3Transition(lease, createCoreRuntimeMigrationQuiescenceProof({
      rootRef, generation: before.fencing_generation, authority: before.authority, admissionLease: lease, checkCurrent: authority,
    })).commit();
    lease = await admission.acquireCoreRuntimeWriterAdmissionV3Migration({ root });
    assert.equal((await migrateCoreRuntimePlanningV4({ root, admissionLease: lease, ownerControlToken })).status, "active");
  } finally { await lease.release(); }
  checks.push("v3-grant-activation-before-isolated-main4-migration");
  let entries = (await read()).entries;
  assert.equal(entries.length, 2, "only the selected class's two lessons must be returned");
  assert.equal(new Set(entries.map(entry => entry.lessonId)).size, 2);
  assert.ok(entries.every(entry => entry.registrationStatus === "unregistered" && entry.completion === null));
  const prepare = async mutation => {
    const response = await route.PUT(request("/api/edupi/proactivity/reflection", "PUT", {
      operationId: crypto.randomUUID(), mutation,
    }));
    return { response, body: await response.clone().json() };
  };
  const postPrepared = async (body, operation, status = 200) => {
    const result = await parse(await route.POST(request("/api/edupi/proactivity/reflection", "POST", {
      ...body, operationId: operation.id, operationFingerprint: operation.fingerprint,
    })), status);
    assert.equal(result.externalSend, false);
    assert.equal(result.operation.id, operation.id);
    assert.equal(result.operation.fingerprint, operation.fingerprint);
    if (status === 200) {
      assert.equal(result.readbackConfirmed, true, JSON.stringify(result));
      assert.equal(result.operation.status, "committed");
      assert.equal(result.operation.terminal, true);
    }
    return result;
  };
  const post = async (body, status = 200) => {
    const beforeFacts = facts.educationFactStateHash(facts.loadEducationFactState({ memoryDir }));
    const prepared = await prepare(body);
    let result;
    if (prepared.response.status !== 200) result = await parse(prepared.response, status);
    else {
      assert.equal(prepared.body.operation.status, "prepared");
      result = await postPrepared(body, prepared.body.operation, status);
    }
    if (status !== 200) assert.equal(facts.educationFactStateHash(facts.loadEducationFactState({ memoryDir })), beforeFacts,
      "refused mutation must preserve the fact state");
    return result;
  };
  const factStateHash = () => facts.educationFactStateHash(facts.loadEducationFactState({ memoryDir }));
  const rejectPreparedPost = async (body, operation, code) => {
    const beforeFacts = factStateHash(), beforeMutations = mutationCalls.length;
    const result = await parse(await route.POST(request("/api/edupi/proactivity/reflection", "POST", {
      ...body, operationId: operation.id, operationFingerprint: operation.fingerprint,
    })), 409);
    assert.equal(result.ok, false);
    assert.equal(result.code, code);
    assert.equal(result.externalSend, false);
    assert.equal(mutationCalls.length, beforeMutations, "refused Desktop POST must not dispatch a Core mutation");
    assert.equal(factStateHash(), beforeFacts, "refused Desktop POST must preserve the fact state");
    refusedDesktopPosts++;
  };
  const recover = async (operation, status = 200) => {
    const before = mutationCalls.length;
    const result = await parse(await route.PATCH(request("/api/edupi/proactivity/reflection", "PATCH", {
      operationId: operation.id, operationFingerprint: operation.fingerprint,
    })), status);
    assert.equal(result.operation.id, operation.id);
    assert.equal(result.operation.fingerprint, operation.fingerprint);
    assert.equal(result.externalSend, false);
    assert.equal(mutationCalls.length, before, "PATCH recovery must not repeat a Core mutation");
    if (status === 200) {
      assert.equal(result.readbackConfirmed, true);
      assert.equal(result.operation.status, "committed");
      assert.equal(result.operation.terminal, true);
    }
    return result;
  };
  const write = async (entry, action) => (await post(client.reflectionRequest(entry, action))).entry;
  const historyPage = async (cursor, extra = "") => {
    const response = await route.GET(request(`/api/edupi/proactivity/reflection?history=true&pageSize=1${extra}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`));
    const body = await parse(response);
    assert.equal(body.readOnly, true);
    return client.parseReflectionHistory(body, cursor);
  };
  const historyReadback = async expected => {
    const before = mutationCalls.length;
    const beforeFacts = facts.educationFactStateHash(facts.loadEducationFactState({ memoryDir }));
    const first = await historyPage();
    assert.equal(first.entries.length, 1);
    assert.ok(first.nextCursor, "two completions must require another page");
    const second = await historyPage(first.nextCursor);
    assert.equal(second.entries.length, 1);
    assert.equal(second.nextCursor, null);
    assert.equal(second.snapshotHash, first.snapshotHash);
    const saved = [...first.entries, ...second.entries];
    assert.equal(new Set(saved.map(item => item.fact_id)).size, 2);
    for (const item of expected) {
      const actual = saved.find(row => row.fact_id === item.completion.factId);
      assert.ok(actual);
      assert.equal(actual.lesson_id, item.lessonId);
      assert.equal(actual.slot_id, item.slotId);
      assert.equal(actual.status, item.completion.status);
      assert.equal(actual.revision, item.completion.revision);
      assert.equal(actual.raw_text, item.completion.rawText);
    }
    assert.equal(mutationCalls.length, before, "history pagination must not mutate Core");
    assert.equal(facts.educationFactStateHash(facts.loadEducationFactState({ memoryDir })), beforeFacts);
    return { entries: saved, cursor: first.nextCursor, snapshotHash: first.snapshotHash };
  };
  const readWork = () => scheduler.loadCapabilityWorkState({ outputDir: path.join(home, "output") }).cases;
  const restartForDrafts = async count => {
    await supervisor.closeAllEduPiRuntimes();
    assert.ok(launches.every(launch => launch.exited));
    const launchCount = launches.length;
    await supervisor.ensureEduPiRuntime(roots);
    const deadline = Date.now() + 15_000;
    let work;
    do {
      work = readWork();
      if (work.length === count && work.every(item => item.status === "draft_ready")) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    assert.ok(launches.length > launchCount, "draft readback must use a new Core process");
    assert.equal(work.length, count, JSON.stringify({ work, runtimeFailures }));
    assert.ok(work.every(item => item.status === "draft_ready" && item.attempt === 1 && item.external_send === false),
      JSON.stringify(work));
    for (const item of work) {
      const artifact = item.artifacts.find(value => value.key === "reflection_draft");
      assert.ok(artifact);
      assert.ok(fs.readFileSync(path.join(dataRoot, artifact.relative_path), "utf8").includes("合成课堂观察"));
    }
    return work;
  };
  const firstInput = client.reflectionRequest(entries[0], { action: "register" });
  assert.equal((await parse(await route.POST(request("/api/edupi/proactivity/reflection", "POST", firstInput)), 409)).code,
    "operation_not_prepared");
  const abandoned = await prepare(firstInput);
  assert.equal(abandoned.response.status, 200);
  const resolvedAbandoned = await recover(abandoned.body.operation, 409);
  assert.equal(resolvedAbandoned.operation.status, "not_committed");
  assert.equal(resolvedAbandoned.operation.terminal, true);
  const beforeAbandonedRetry = mutationCalls.length;
  await postPrepared(firstInput, abandoned.body.operation, 409);
  assert.equal(mutationCalls.length, beforeAbandonedRetry);
  checks.push("unprepared-post-refusal-and-prepared-operation-patch-resolution");
  await post({ ...firstInput, classId: foreign.entity_id }, 409);
  await post({ ...firstInput, expectedGrantVersion: firstInput.expectedGrantVersion + 1 }, 409);
  await post({ ...firstInput, expectedSourceBasisHash: `sha256:${"0".repeat(64)}` }, 409);
  await post({ ...firstInput, unexpected: true }, 400);
  const ambiguous = { ...firstInput };
  delete ambiguous.slotId;
  assert.equal((await post(ambiguous, 409)).result.reason_code, "lesson_ambiguous");
  const firstPrepared = await prepare(firstInput);
  assert.equal(firstPrepared.response.status, 200);
  const firstRegistered = await postPrepared(firstInput, firstPrepared.body.operation);
  const beforeRegistrationRetry = mutationCalls.length;
  assert.deepEqual(await postPrepared(firstInput, firstPrepared.body.operation), firstRegistered);
  assert.equal(mutationCalls.length, beforeRegistrationRetry);
  entries[0] = firstRegistered.entry;
  entries[1] = await write(entries[1], { action: "register" });
  assert.deepEqual((await recover(firstPrepared.body.operation)).entry, entries[0]);
  assert.equal((await post(firstInput)).result.replayed, true);
  assert.ok((await read()).entries.every(entry => entry.registrationStatus === "registered"));
  checks.push("same-day-slot-isolation-registration-replay-and-cas-refusal");
  const seedLessonObservation = async index => {
    await supervisor.closeAllEduPiRuntimes();
    lease = await admission.acquireCoreRuntimeWriterAdmissionV4Runtime({ root, kind: "daemon", ownerControlToken });
    try {
      const entry = entries[index];
      const observation = facts.captureEducationObservation({ memoryDir, now, observation: {
        source_kind: "teacher_utterance", source_id: `g4-synthetic-observation-${index}`, source_revision: "1",
        raw_text: `合成课堂观察 ${index}：学生说明了等式两边同减的依据。`, observed_at: completedAt,
        actor_ref: bootstrap.result.owner_id, entity_ids: [classroom.entity_id, term.entity_id, entry.lessonId],
      } }).observation;
      const fact = facts.proposeEducationFact({ memoryDir, now, fact: {
        entity_id: entry.lessonId, fact_kind: "evidence", predicate: "lesson.observation", subject_ref: "math",
        value: observation.raw_text, confidence: { basis: "explicit", score: 1 },
        source_ids: [observation.source_id], observation_ids: [observation.observation_id],
      } }).fact;
      facts.reviewEducationFact({ memoryDir, now, fact_id: fact.fact_id, expected_revision: fact.revision,
        decision: "accept", reviewer: bootstrap.result.owner_id });
    } finally { await lease.release(); }
  };
  await seedLessonObservation(0);
  await activate();
  entries = (await read()).entries;
  assert.equal(entries[0].completionSourceIds.length, 1);
  assert.equal(entries[1].completionSourceIds.length, 1, "each registered lesson has an independent completion token");
  assert.notEqual(entries[0].completionSourceIds[0], entries[1].completionSourceIds[0]);
  assert.equal(entries[1].completion, null, "a completion token is authorization, never a completion fact");
  assert.deepEqual(readWork(), [], "registration and observation alone must not create reflection drafts");
  const captureInput = (entry, index) => client.reflectionRequest(entry, {
    action: "capture", sourceId: entry.completionSourceIds[0], sourceRevision: "1", completedAt,
    rawText: `合成验收第 ${index + 1} 课于 ${completedAt} 完成。`,
  });
  const captureInputs = [captureInput(entries[0], 0)];
  const capturePrepared = await prepare(captureInputs[0]);
  assert.equal(capturePrepared.response.status, 200);
  dropNextOperation = "owner_reflection_completion_capture";
  const uncertainCapture = await postPrepared(captureInputs[0], capturePrepared.body.operation, 409);
  assert.equal(uncertainCapture.operation.status, "unknown");
  assert.equal(uncertainCapture.operation.terminal, false);
  assert.equal(uncertainCapture.readbackConfirmed, false);
  await supervisor.closeAllEduPiRuntimes();
  entries[0] = (await recover(capturePrepared.body.operation)).entry;
  assert.equal(entries[0].completion.status, "pending_review");
  assert.equal((await post(captureInputs[0])).result.replayed, true);
  const staleReview = client.reflectionRequest(entries[0], { action: "review", decision: "accept" });
  await post({ ...staleReview, expectedFactRevision: staleReview.expectedFactRevision + 1 }, 409);
  entries[0] = await write(entries[0], { action: "review", decision: "accept" });
  const firstWork = (await restartForDrafts(1))[0];
  const firstBeforeExpansion = structuredClone(entries[0]);
  const firstCompletionFact = facts.loadEducationFactState({ memoryDir }).facts
    .find(fact => fact.fact_id === entries[0].completion.factId);
  const staleWithdrawal = client.reflectionRequest(entries[0], { action: "review", decision: "withdraw" });
  await seedLessonObservation(1);
  await activate();
  entries = (await read()).entries;
  assert.ok(entries.every(entry => entry.completionSourceIds.length === 1));
  assert.notEqual(entries[0].completionSourceIds[0], entries[1].completionSourceIds[0]);
  assert.equal(entries[0].grantVersion, firstBeforeExpansion.grantVersion + 1);
  assert.equal(entries[0].sourceBasisHash, firstBeforeExpansion.sourceBasisHash);
  const { sourceBasisHash: priorCompletionBasis, ...priorCompletion } = firstBeforeExpansion.completion;
  const { sourceBasisHash: expandedCompletionBasis, ...expandedCompletion } = entries[0].completion;
  assert.deepEqual(expandedCompletion, priorCompletion);
  assert.notEqual(expandedCompletionBasis, priorCompletionBasis, "completion CAS proof includes the current grant version");
  assert.deepEqual(facts.loadEducationFactState({ memoryDir }).facts
    .find(fact => fact.fact_id === entries[0].completion.factId), firstCompletionFact);
  await post(staleWithdrawal, 409);
  await post(captureInputs[0], 409);
  await post({ ...firstInput, expectedGrantVersion: firstBeforeExpansion.grantVersion,
    expectedSourceBasisHash: firstBeforeExpansion.sourceBasisHash }, 409);
  assert.deepEqual((await restartForDrafts(1))[0], firstWork,
    "source expansion must not stale, rewrite or rerun the first lesson draft");
  captureInputs.push(captureInput(entries[1], 1));
  await post({ ...captureInputs[1], sourceId: captureInputs[0].sourceId }, 409);
  entries[1] = (await post(captureInputs[1])).entry;
  assert.equal(entries[1].completion.status, "pending_review");
  assert.equal(new Set(entries.map(entry => entry.completion.factId)).size, 2);
  const secondReviewInput = client.reflectionRequest(entries[1], { action: "review", decision: "accept" });
  const secondReviewPrepared = await prepare(secondReviewInput);
  assert.equal(secondReviewPrepared.response.status, 200);
  dropNextOperation = "owner_reflection_completion_review";
  const uncertainReview = await postPrepared(secondReviewInput, secondReviewPrepared.body.operation, 409);
  assert.equal(uncertainReview.operation.status, "unknown");
  await supervisor.closeAllEduPiRuntimes();
  entries[1] = (await recover(secondReviewPrepared.body.operation)).entry;
  const bothWork = await restartForDrafts(2);
  assert.deepEqual(bothWork.find(item => item.work_case_id === firstWork.work_case_id), firstWork);
  assert.deepEqual(await restartForDrafts(2), bothWork, "both lesson drafts must survive restart without rerunning");
  checks.push("second-lesson-source-expansion-preserves-first-draft-and-both-drafts-after-real-core-restart");
  checks.push("same-operation-replay-and-lost-capture-review-response-patch-recovery-after-core-restart");
  await post(staleReview, 409);
  const readStatuses = async () => {
    const saved = (await read()).entries;
    assert.equal(saved.length, 2);
    for (const entry of entries) {
      const current = saved.find(item => item.lessonId === entry.lessonId);
      assert.deepEqual(current.completion, entry.completion, "list readback must retain rejected completions");
    }
    return saved;
  };
  await readStatuses();
  await historyReadback(entries);
  entries[1] = await write(entries[1], { action: "review", decision: "withdraw" });
  checks.push("exact-completion-source-capture-replay-accept-reject-and-list-readback");
  const restart = async () => {
    const before = launches.length;
    await supervisor.closeAllEduPiRuntimes();
    assert.ok(launches.every(launch => launch.exited));
    await readStatuses();
    assert.ok(launches.length > before, "readback must start a new real Core process");
  };
  await restart();
  entries[0] = await write(entries[0], { action: "review", decision: "withdraw" });
  assert.equal(entries[0].completion.status, "rejected");
  await readStatuses();
  await restart();
  checks.push("accepted-and-rejected-restart-withdraw-and-restart-readback");
  const contentSourceIds = [];
  const contentEvidence = entries.map((_entry, index) => ({
    predicate: index === 0 ? "lesson.feedback" : "lesson.outcome",
    rawText: ` 合成课堂内容 ${index + 1}：学生解释等式变形。\n保留原始换行。 `,
  }));
  for (let index = 0; index < entries.length; index++) {
    const current = entries[index];
    const mutation = { action: "registerContentSource", classId: current.classId, subject: current.subject,
      date: current.date, slotId: current.slotId, expectedSourceBasisHash: current.sourceBasisHash,
      expectedGrantVersion: current.grantVersion, ...contentEvidence[index] };
    const beforeFacts = factStateHash();
    const response = await route.POST(request("/api/edupi/proactivity/reflection", "POST", mutation));
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const registered = await parse(response);
    assert.equal(registered.readbackConfirmed, true);
    assert.equal(registered.externalSend, false);
    assert.equal(registered.entry.lessonId, current.lessonId);
    assert.equal(registered.entry.grantVersion, current.grantVersion + 1);
    assert.equal(factStateHash(), beforeFacts, "source registration must not create a fact");
    contentSourceIds.push(registered.sourceId);
    entries = (await read()).entries;
    const replay = await route.POST(request("/api/edupi/proactivity/reflection", "POST",
      { ...mutation, expectedGrantVersion: entries[index].grantVersion }));
    assert.equal(replay.status, 200);
    assert.equal((await parse(replay)).entry.grantVersion, entries[index].grantVersion,
      "source registration replay must not consume another grant version");
  }
  assert.notEqual(contentSourceIds[0], contentSourceIds[1]);
  assert.equal(entries[0].contentSourceIds.includes(contentSourceIds[1]), false);
  assert.equal(entries[1].contentSourceIds.includes(contentSourceIds[0]), false);
  checks.push("desktop-content-source-registration-cas-replay-and-lesson-isolation");
  const completionBeforeContent = entries.map(entry => structuredClone(entry.completion));
  const contentRead = async (entry, factId) => {
    const beforeFacts = factStateHash(), beforeMutations = mutationCalls.length;
    const response = await parse(await route.GET(request(`/api/edupi/proactivity/reflection?content=true&date=${date}&slotId=${encodeURIComponent(entry.slotId)}&factId=${encodeURIComponent(factId)}`)));
    const result = client.parseReflectionList(response, date);
    assert.equal(result.entries.length, 1);
    assert.equal(response.externalSend, false);
    assert.equal(factStateHash(), beforeFacts);
    assert.equal(mutationCalls.length, beforeMutations);
    return result.entries[0];
  };
  const contentHistory = async () => {
    const beforeFacts = factStateHash(), beforeMutations = mutationCalls.length;
    const saved = [], cursors = new Set();
    let cursor = null, snapshotHash = null;
    do {
      const result = await parse(await route.GET(request(`/api/edupi/proactivity/reflection?history=true&content=true&pageSize=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)));
      assert.equal(result.readOnly, true);
      assert.equal(result.content, true);
      assert.equal(result.externalSend, false);
      assert.equal(result.entries.length, 1);
      if (snapshotHash === null) snapshotHash = result.snapshotHash;
      else assert.equal(result.snapshotHash, snapshotHash);
      saved.push(...result.entries);
      cursor = result.nextCursor;
      if (cursor !== null) {
        assert.equal(cursors.has(cursor), false, "content history must advance its cursor");
        cursors.add(cursor);
        assert.ok(cursors.size < 10, "synthetic content history must remain bounded");
      }
    } while (cursor !== null);
    assert.equal(new Set(saved.map(item => item.fact_id)).size, saved.length);
    assert.ok(saved.every(item => item.predicate !== "lesson.completed" && !Object.hasOwn(item, "completed_at")));
    assert.equal(factStateHash(), beforeFacts);
    assert.equal(mutationCalls.length, beforeMutations);
    return saved;
  };
  const contentInputs = entries.map((entry, index) => client.reflectionRequest(entry, {
    action: "contentCapture", sourceId: contentSourceIds[index], sourceRevision: "1",
    ...contentEvidence[index],
  }));
  await post({ ...contentInputs[0], classId: foreign.entity_id }, 409);
  await post({ ...contentInputs[0], sourceId: "g4-ungranted-content" }, 409);
  await post({ ...contentInputs[0], sourceId: entries[0].completionSourceIds[0] }, 409);
  await post({ ...contentInputs[0], sourceId: slots[0].source_ids[0] }, 409);
  await post({ ...contentInputs[0], sourceId: contentSourceIds[1] }, 409);
  await post({ ...contentInputs[0], rawText: contentInputs[0].rawText.trim() }, 409);
  await post({ ...contentInputs[0], predicate: "lesson.completed" }, 400);
  const contentPrepared = await prepare(contentInputs[0]);
  assert.equal(contentPrepared.response.status, 200);
  dropNextOperation = "owner_reflection_content_capture";
  const uncertainContent = await postPrepared(contentInputs[0], contentPrepared.body.operation, 409);
  assert.equal(uncertainContent.operation.status, "unknown");
  assert.equal(uncertainContent.operation.terminal, false);
  assert.equal(uncertainContent.readbackConfirmed, false);
  await supervisor.closeAllEduPiRuntimes();
  const contentEntries = [(await recover(contentPrepared.body.operation)).entry];
  assert.equal(contentEntries[0].content.status, "pending_review");
  assert.equal(contentEntries[0].content.rawText, contentInputs[0].rawText);
  assert.equal((await post(contentInputs[0])).result.replayed, true);
  assert.deepEqual((await contentRead(entries[0], contentEntries[0].content.factId)).content, contentEntries[0].content);
  const crossLesson = await contentRead(entries[1], contentEntries[0].content.factId);
  assert.equal(crossLesson.status, "held");
  assert.equal(crossLesson.content, null);
  await post({ ...contentInputs[0], slotId: entries[1].slotId,
    expectedSourceBasisHash: entries[1].sourceBasisHash }, 409);
  contentEntries.push((await post(contentInputs[1])).entry);
  assert.notEqual(contentEntries[0].content.factId, contentEntries[1].content.factId);
  assert.notEqual(contentEntries[0].lessonId, contentEntries[1].lessonId);
  const contentReviewInputs = contentEntries.map((entry, index) => client.reflectionRequest(entry, {
    action: "contentReview", factId: entry.content.factId, expectedFactRevision: entry.content.revision,
    expectedContentBasisHash: entry.content.sourceBasisHash, decision: index === 0 ? "accept" : "reject",
  }));
  await post({ ...contentReviewInputs[0], expectedFactRevision: contentReviewInputs[0].expectedFactRevision + 1 }, 409);
  await post({ ...contentReviewInputs[0], expectedContentBasisHash: `sha256:${"0".repeat(64)}` }, 409);
  await post({ ...contentReviewInputs[0], slotId: entries[1].slotId,
    expectedSourceBasisHash: entries[1].sourceBasisHash }, 409);
  contentEntries[0] = (await post(contentReviewInputs[0])).entry;
  assert.equal(contentEntries[0].content.status, "accepted");
  const rejectedPrepared = await prepare(contentReviewInputs[1]);
  assert.equal(rejectedPrepared.response.status, 200);
  dropNextOperation = "owner_reflection_content_review";
  const uncertainRejection = await postPrepared(contentReviewInputs[1], rejectedPrepared.body.operation, 409);
  assert.equal(uncertainRejection.operation.status, "unknown");
  assert.equal(uncertainRejection.operation.terminal, false);
  assert.equal(uncertainRejection.readbackConfirmed, false);
  await supervisor.closeAllEduPiRuntimes();
  contentEntries[1] = (await recover(rejectedPrepared.body.operation)).entry;
  assert.equal(contentEntries[1].content.status, "rejected");
  const rejectedHash = factStateHash();
  const rejectedReplay = await post(contentInputs[1]);
  assert.equal(rejectedReplay.result.replayed, true);
  assert.equal(rejectedReplay.entry.content.status, "rejected");
  assert.equal(factStateHash(), rejectedHash, "capture replay must not reopen rejected classroom content");
  await post(contentReviewInputs[1], 409);
  const savedContent = await contentHistory();
  assert.equal(savedContent.length, 4, "history contains two seeded observations and two captured content facts");
  for (const entry of contentEntries) {
    const saved = savedContent.find(item => item.fact_id === entry.content.factId);
    assert.ok(saved, "accepted and rejected content must both remain in history");
    assert.equal(saved.lesson_id, entry.lessonId);
    assert.equal(saved.slot_id, entry.slotId);
    assert.equal(saved.status, entry.content.status);
    assert.equal(saved.revision, entry.content.revision);
    assert.equal(saved.raw_text, entry.content.rawText);
    assert.equal(saved.predicate, entry.content.predicate);
    assert.equal(saved.source_id, entry.content.sourceId);
    assert.equal(saved.last_review.action, entry.content.status === "accepted" ? "accept" : "reject");
  }
  await supervisor.closeAllEduPiRuntimes();
  assert.deepEqual(await contentHistory(), savedContent, "rejected content history must survive a real Core restart");
  for (const entry of contentEntries) {
    assert.deepEqual((await contentRead(entry, entry.content.factId)).content, entry.content);
  }
  const combined = await parse(await route.GET(request(`/api/edupi/proactivity/reflection?date=${date}`)));
  const combinedEntries = client.parseReflectionList(combined, date).entries;
  assert.ok(contentEntries.every(entry => combinedEntries.some(item => item.content?.factId === entry.content.factId)),
    "the normal lesson list must expose accepted and rejected content");
  entries = (await read()).entries;
  assert.deepEqual(entries.map(entry => entry.completion), completionBeforeContent,
    "content capture and review must not rewrite either completion");
  const contentSnapshot = await rootsModule.readEduPiEducationSnapshot({ roots });
  assert.ok(contentSnapshot.workspace.fact_spine.accepted_facts.some(fact => fact.fact_id === contentEntries[0].content.factId));
  assert.ok(contentSnapshot.workspace.fact_spine.accepted_facts.every(fact => fact.fact_id !== contentEntries[1].content.factId),
    "rejected content remains in history but must not become accepted evidence");
  const contentFacts = facts.loadEducationFactState({ memoryDir });
  for (const entry of contentEntries) {
    const observation = contentFacts.observations.find(item => item.source_id === entry.content.sourceId);
    assert.ok(observation);
    assert.deepEqual([...observation.entity_ids].sort(), [classroom.entity_id, term.entity_id, entry.lessonId].sort());
  }
  checks.push("synthetic-owner-granted-content-capture-read-review-cas-and-two-lesson-isolation");
  checks.push("content-lost-capture-and-reject-receipt-readonly-recovery-after-real-core-restart");
  checks.push("accepted-and-rejected-content-history-pagination-replay-and-restart-readback");
  const historyBeforeRemoval = await historyReadback(entries);
  const filteredHistory = await historyPage(undefined, `&date=${date}&slotId=${encodeURIComponent(entries[0].slotId)}`);
  assert.deepEqual(filteredHistory.entries.map(item => item.fact_id), [entries[0].completion.factId]);
  assert.equal(filteredHistory.nextCursor, null);
  const mutationBeforeRemoval = { ...staleReview, expectedGrantVersion: entries[0].grantVersion,
    expectedFactRevision: entries[0].completion.revision,
    expectedCompletionBasisHash: entries[0].completion.sourceBasisHash };
  await supervisor.closeAllEduPiRuntimes();
  lease = await admission.acquireCoreRuntimeWriterAdmissionV4Runtime({ root, kind: "daemon", ownerControlToken });
  let savedIntake;
  try {
    savedIntake = intake.loadEducationIntakeState();
    intake.saveEducationIntakeState({ ...savedIntake, timetable_slots: [] });
  } finally { await lease.release(); }
  assert.deepEqual((await read()).entries, []);
  assert.equal((await post(mutationBeforeRemoval, 409)).result.reason_code, "lesson_not_found");
  assert.deepEqual((await historyReadback(entries)).entries, historyBeforeRemoval.entries);
  const beforeRefresh = await parse(await activationRoute.GET(request("/api/edupi/proactivity?domain=lesson_reflection")));
  const refreshed = await parse(await activationRoute.POST(request("/api/edupi/proactivity", "POST", {
    domain: "lesson_reflection", enabled: true, classId: classroom.entity_id, subject: "math",
    expectedUpdatedAt: beforeRefresh.activation.updatedAt,
  })));
  assert.equal(refreshed.activation.enabled, true);
  const historyBinding = readEduPiProactivityActivation({ dataRoot, domain: "lesson_reflection" });
  host = await supervisor.ensureEduPiRuntime(roots);
  const refreshedOwner = await host.callOwnerControl("owner_read", { root_ref: rootRef, expected_owner_id: historyBinding.ownerId });
  assert.equal(refreshedOwner.ok, true);
  const refreshedGrant = refreshedOwner.result.grants.find(grant => grant.id === historyBinding.grantId);
  const requiredHistorySources = [...new Set([...historyBeforeRemoval.entries.map(item => item.source_id),
    ...savedContent.map(item => item.source_id), ...slots.slice(0, 2).flatMap(slot => slot.source_ids)])];
  assert.ok(requiredHistorySources.every(source => refreshedGrant.source_ids.includes(source)));
  assert.equal(refreshedGrant.source_ids.length, requiredHistorySources.length + 1);
  assert.equal(refreshedGrant.source_ids.filter(source => source.startsWith("conversation:")).length, 1);
  assert.ok(slots[2].source_ids.every(source => !refreshedGrant.source_ids.includes(source)),
    "source refresh must exclude the foreign class even when retaining content history");
  assert.deepEqual((await read()).entries, []);
  assert.deepEqual((await historyReadback(entries)).entries, historyBeforeRemoval.entries,
    "refresh after timetable removal must retain only the verified history's required sources");
  assert.deepEqual(await contentHistory(), savedContent);
  await supervisor.closeAllEduPiRuntimes();
  assert.deepEqual((await historyReadback(entries)).entries, historyBeforeRemoval.entries);
  assert.deepEqual(await contentHistory(), savedContent);
  checks.push("deleted-timetable-source-refresh-history-pagination-restart-and-write-refusal");
  await supervisor.closeAllEduPiRuntimes();
  lease = await admission.acquireCoreRuntimeWriterAdmissionV4Runtime({ root, kind: "daemon", ownerControlToken });
  try { intake.saveEducationIntakeState(savedIntake); }
  finally { await lease.release(); }
  await activate();
  entries = (await read()).entries;
  const activeState = await parse(await activationRoute.GET(request("/api/edupi/proactivity?domain=lesson_reflection")));
  const activation = readEduPiProactivityActivation({ dataRoot, domain: "lesson_reflection" });
  assert.equal(activation.updatedAt, activeState.activation.updatedAt);
  assert.ok(activation.ownerId && activation.grantId);
  const rpcBinding = { root_ref: rootRef, expected_owner_id: activation.ownerId, grant_id: activation.grantId,
    class_id: classroom.entity_id, subject: "math", date, slot_id: entries[0].slotId };
  const rpcExpected = { ...rpcBinding, expected_source_basis_hash: entries[0].sourceBasisHash,
    expected_grant_version: entries[0].grantVersion };
  const rpcWrites = [
    ["owner_reflection_lesson_register", rpcExpected],
    ["owner_reflection_completion_capture", { ...rpcExpected, source_id: entries[0].completion.sourceId,
      source_revision: "after-stop", raw_text: `合成禁写验收 ${completedAt}`, completed_at: completedAt }],
    ["owner_reflection_completion_review", { ...rpcExpected, fact_id: entries[0].completion.factId,
      expected_fact_revision: entries[0].completion.revision,
      expected_completion_basis_hash: entries[0].completion.sourceBasisHash, decision: "accept" }],
  ];
  const desktopWrites = [
    { ...firstInput, expectedSourceBasisHash: entries[0].sourceBasisHash,
      expectedGrantVersion: entries[0].grantVersion },
    { ...captureInputs[0], expectedSourceBasisHash: entries[0].sourceBasisHash,
      expectedGrantVersion: entries[0].grantVersion },
    { ...staleReview, expectedSourceBasisHash: entries[0].sourceBasisHash,
      expectedGrantVersion: entries[0].grantVersion,
      expectedFactRevision: entries[0].completion.revision,
      expectedCompletionBasisHash: entries[0].completion.sourceBasisHash },
  ];
  const preparedBeforeStop = [];
  for (const body of desktopWrites) {
    const prepared = await prepare(body);
    assert.equal(prepared.response.status, 200);
    assert.equal(prepared.body.operation.status, "prepared");
    preparedBeforeStop.push({ body, operation: prepared.body.operation });
  }
  const disabled = await parse(await activationRoute.POST(request("/api/edupi/proactivity", "POST", {
    domain: "lesson_reflection", enabled: false, classId: null, subject: null, expectedUpdatedAt: activation.updatedAt,
  })));
  assert.equal(disabled.activation.enabled, false);
  assert.equal(disabled.grantPaused, true);
  assert.equal((await read()).enabled, false);
  for (const { body, operation } of preparedBeforeStop) await rejectPreparedPost(body, operation, "activation_pending");
  const stoppedHistory = await historyReadback(entries);
  assert.deepEqual(stoppedHistory.entries, historyBeforeRemoval.entries);
  assert.deepEqual(await contentHistory(), savedContent);
  const changedHistory = await parse(await route.GET(request(`/api/edupi/proactivity/reflection?history=true&pageSize=1&cursor=${historyBeforeRemoval.cursor}`)), 409);
  assert.equal(changedHistory.code, "history_changed", "grant state changes must invalidate old history cursors");
  await supervisor.closeAllEduPiRuntimes();
  assert.deepEqual((await historyReadback(entries)).entries, historyBeforeRemoval.entries);
  host = await supervisor.ensureEduPiRuntime(roots);
  assert.equal((await host.call("health", null)).result.capabilities.g3_processor, "activation_pending");
  const pausedOwner = await host.callOwnerControl("owner_read", { root_ref: rootRef, expected_owner_id: activation.ownerId });
  assert.equal(pausedOwner.ok, true);
  const pausedGrant = pausedOwner.result.grants.find(item => item.id === activation.grantId);
  assert.equal(pausedGrant.status, "paused");
  assert.equal(pausedGrant.version, entries[0].grantVersion + 1);
  assert.ok(pausedGrant.source_ids.includes("g4-synthetic-observation-0"));
  assert.ok(pausedGrant.source_ids.includes("g4-synthetic-observation-1"));
  for (const [operation, payload] of [
    ["owner_reflection_lesson_read", rpcBinding],
    ["owner_reflection_completion_read", { ...rpcBinding, fact_id: entries[0].completion.factId }],
    ...rpcWrites,
  ]) {
    const beforeFacts = factStateHash();
    const response = await host.callOwnerControl(operation, payload);
    assert.equal(response.ok, false, JSON.stringify(response));
    assert.equal(response.error_code, "activation_pending", JSON.stringify(response));
    assert.equal(factStateHash(), beforeFacts, `${operation} must preserve facts while disabled`);
  }
  const stoppedRpcHistory = await host.callOwnerControl("owner_reflection_history_read", {
    root_ref: rootRef, expected_owner_id: activation.ownerId, grant_id: activation.grantId,
    class_id: classroom.entity_id, subject: "math", page_size: 1,
  });
  assert.equal(stoppedRpcHistory.ok, true, JSON.stringify(stoppedRpcHistory));
  assert.equal(stoppedRpcHistory.result.status, "ready");
  assert.equal(stoppedRpcHistory.result.read_only, true);
  assert.equal(stoppedRpcHistory.result.external_send, false);
  assert.equal(stoppedRpcHistory.result.entries.length, 1);
  assert.deepEqual((await historyReadback(entries)).entries, stoppedHistory.entries);
  checks.push("disabled-history-pagination-restart-and-real-core-rpc-refusal");
  const replacementSlot = { ...slots[0], slot_id: "g4-synthetic-slot-replacement", period: 4, start_time: "10:30",
    source_ids: ["g4-synthetic-timetable-replacement"], evidence_ids: ["g4-synthetic-timetable-replacement"],
    _source_slot_ids: ["g4-synthetic-slot-replacement"] };
  replacementSlot._dedupe_identity = schedule.timetableScheduleIdentity(replacementSlot);
  replacementSlot._content_hash = schedule.scheduleContentFingerprint(replacementSlot, "timetable");
  await supervisor.closeAllEduPiRuntimes();
  lease = await admission.acquireCoreRuntimeWriterAdmissionV4Runtime({ root, kind: "daemon", ownerControlToken });
  try {
    intake.saveEducationIntakeState({ ...savedIntake, timetable_slots: [replacementSlot, slots[2]] });
  } finally { await lease.release(); }
  assert.ok(intake.loadEducationIntakeState().timetable_slots.every(slot => !entries.some(entry => entry.slotId === slot.slot_id)));
  assert.deepEqual((await historyReadback(entries)).entries, stoppedHistory.entries);
  const factsBeforeResume = factStateHash();
  await activate();
  assert.equal(factStateHash(), factsBeforeResume, "reenabling must not rewrite historical facts");
  const resumedActivation = readEduPiProactivityActivation({ dataRoot, domain: "lesson_reflection" });
  assert.equal(resumedActivation.ownerId, activation.ownerId);
  assert.equal(resumedActivation.grantId, activation.grantId);
  host = await supervisor.ensureEduPiRuntime(roots);
  const ownerState = await host.callOwnerControl("owner_read", { root_ref: rootRef, expected_owner_id: activation.ownerId });
  assert.equal(ownerState.ok, true);
  assert.equal(ownerState.result.grants.filter(item => item.id === activation.grantId).length, 1);
  const activeGrant = ownerState.result.grants.find(item => item.id === activation.grantId);
  assert.equal(activeGrant.status, "active");
  assert.equal(activeGrant.version, pausedGrant.version + 2, "update and resume must advance the existing grant");
  const conversationSources = pausedGrant.source_ids.filter(source => source.startsWith("conversation:"));
  assert.equal(conversationSources.length, 1);
  assert.deepEqual([...activeGrant.source_ids].sort(),
    [...new Set([...conversationSources, ...replacementSlot.source_ids, ...requiredHistorySources])].sort(),
    "reenabling must grant exactly current timetable sources and verified historical sources");
  assert.ok(slots[2].source_ids.every(source => !activeGrant.source_ids.includes(source)),
    "foreign sources must stay excluded while verified content history remains readable");
  const replacementEntries = (await read()).entries;
  assert.equal(replacementEntries.length, 1);
  assert.equal(replacementEntries[0].slotId, replacementSlot.slot_id);
  assert.equal(replacementEntries[0].registrationStatus, "unregistered");
  assert.equal(replacementEntries[0].completion, null);
  assert.equal(replacementEntries[0].grantVersion, activeGrant.version);
  assert.deepEqual((await historyReadback(entries)).entries, stoppedHistory.entries);
  assert.deepEqual(await contentHistory(), savedContent);
  for (const body of desktopWrites) {
    const beforeFacts = factStateHash();
    const result = await post({ ...body, expectedGrantVersion: activeGrant.version }, 409);
    assert.equal(result.result.reason_code, "lesson_not_found");
    assert.equal(factStateHash(), beforeFacts, `${body.action} must not write a removed lesson`);
  }
  await supervisor.closeAllEduPiRuntimes();
  assert.deepEqual((await historyReadback(entries)).entries, stoppedHistory.entries);
  assert.deepEqual((await read()).entries, replacementEntries);
  checks.push("disabled-slot-replacement-reenable-same-grant-exact-source-union-history-pagination-restart-and-old-slot-refusal");
  const revokedBodies = [
    client.reflectionRequest(replacementEntries[0], { action: "register" }),
    ...desktopWrites.slice(1).map(body => ({ ...body, expectedGrantVersion: activeGrant.version })),
  ];
  const preparedBeforeRevoke = [];
  for (const body of revokedBodies) {
    const prepared = await prepare(body);
    assert.equal(prepared.response.status, 200);
    assert.equal(prepared.body.operation.status, "prepared");
    preparedBeforeRevoke.push({ body, operation: prepared.body.operation });
  }
  host = await supervisor.ensureEduPiRuntime(roots);
  const revoked = await host.callOwnerControl("owner_control", { command_id: "isolated-g4-revoke",
    root_ref: rootRef, expected_owner_id: activation.ownerId, action: "revoke",
    grant_id: activation.grantId, expected_version: activeGrant.version });
  assert.equal(revoked.ok, true, JSON.stringify(revoked));
  for (const { body, operation } of preparedBeforeRevoke) await rejectPreparedPost(body, operation, "owner_unavailable");
  for (const [operation, payload] of rpcWrites) {
    const beforeFacts = factStateHash();
    const response = await host.callOwnerControl(operation, { ...payload, expected_grant_version: revoked.result.grant_version });
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(response.result.status, "held");
    assert.equal(response.result.reason_code, "permission_denied");
    assert.equal(factStateHash(), beforeFacts, `${operation} must preserve facts after revocation`);
  }
  assert.deepEqual((await historyReadback(entries)).entries, historyBeforeRemoval.entries);
  await supervisor.closeAllEduPiRuntimes();
  assert.deepEqual((await historyReadback(entries)).entries, historyBeforeRemoval.entries);
  checks.push("revoked-history-pagination-restart-and-desktop-core-write-refusal");
  assert.equal(refusedDesktopPosts, 6);
  checks.push("prepared-register-capture-review-post-refusal-after-disable-and-revoke-preserves-fact-hash");
  host = await supervisor.ensureEduPiRuntime(roots);
  const snapshot = await rootsModule.readEduPiEducationSnapshot({ roots });
  assert.ok(snapshot.workspace.fact_spine.accepted_facts.every(fact => !entries.some(entry => entry.completion.factId === fact.fact_id)));
  assert.ok(launches.some(launch => launch.sourceReflectionGoals), "the real host must enable source reflection processing");
  const database = new DatabaseSync(root.databasePath, { readOnly: true });
  try {
    assert.equal(database.prepare("PRAGMA quick_check").get().quick_check, "ok");
    assert.equal(database.prepare("PRAGMA user_version").get().user_version, 4);
    assert.equal(database.prepare("PRAGMA foreign_key_check").get(), undefined);
  } finally { database.close(); }
  assert.equal(deniedRequests, 0);
  assert.equal(modelRequests, 0);
  assert.equal(droppedResponses, 4);
  assert.equal(dropNextOperation, null);
  console.log(JSON.stringify({ status: "passed", mode: "isolated-dirty-source-joint", ...identity, sourceHashes, checks,
    realCoreLaunches: launches.length, reflectionHostLaunches: launches.filter(launch => launch.sourceReflectionGoals).length,
    lessonCount: entries.length, modelRequests, droppedResponses, refusedDesktopPosts, mutationCalls: mutationCalls.length,
    syntheticDrafts: bothWork.length, contentFacts: contentEntries.length, contentHistoryRows: savedContent.length,
    contentSourceSetup: "Desktop exact content registration", adapter: "Core deterministic lesson reflection", externalSend: false, productionMigration: false,
    ...(keepFixtures ? { retainedFixtureRoots: [dataRoot, controlRoot] } : {}),
    unverified: ["browser interaction", "fresh Main4 activation", "draft artifact teacher review",
      "installed application", "teaching content quality", "Windows"] }));
} catch (error) {
  const failure = { status: "failed", ...identity, sourceHashes, checks,
    error: error.message, runtimeFailures, realCoreLaunches: launches.length, modelRequests, deniedRequests,
    healthChecks: healthChecks.slice(-8), ownerChecks: ownerChecks.slice(-12),
    ...(keepFixtures ? { retainedFixtureRoots: [dataRoot, controlRoot] } : {}) };
  if (keepFixtures) fs.writeFileSync(path.join(controlRoot, "failure-diagnostics.json"), JSON.stringify(failure, null, 2), { mode: 0o600 });
  console.error(JSON.stringify(failure));
  throw error;
} finally {
  await supervisor?.closeAllEduPiRuntimes();
  globalThis.fetch = originalFetch;
  childProcess.fork = originalFork;
  syncBuiltinESMExports();
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  assert.ok(launches.every(launch => launch.exited), "all harness-owned hosts must exit before removing the fixture");
  assert.equal(path.dirname(dataRoot), fs.realpathSync("/tmp"));
  assert.match(path.basename(dataRoot), /^edupi-g4-joint-[A-Za-z0-9]+$/u);
  assert.equal(path.dirname(controlRoot), fs.realpathSync("/tmp"));
  assert.match(path.basename(controlRoot), /^edupi-g4-control-[A-Za-z0-9]+$/u);
  if (!keepFixtures) {
    fs.rmSync(dataRoot, { recursive: true, force: true });
    fs.rmSync(controlRoot, { recursive: true, force: true });
    assert.equal(fs.existsSync(dataRoot), false);
    assert.equal(fs.existsSync(controlRoot), false);
  }
}
