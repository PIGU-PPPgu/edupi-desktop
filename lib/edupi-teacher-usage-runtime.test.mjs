import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { createJiti } from "jiti";

const coreRoot = process.env.EDUPI_USAGE_TEST_CORE;
test("exact Core local usage pairing: consent, immutable retries, restart, source fencing, withdrawal and erasure", { skip: !coreRoot, timeout: 60_000 }, async () => {
  const fixture = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "desktop-usage-core-")));
  fs.chmodSync(fixture, 0o700);
  const dataRoot = path.join(fixture, "data"), stateDir = path.join(fixture, "desktop-state"), home = path.join(dataRoot, ".edupi");
  fs.mkdirSync(dataRoot, { mode: 0o700 }); fs.mkdirSync(stateDir, { mode: 0o700 });
  for (const dir of ["memory", "output", "locks"]) fs.mkdirSync(path.join(home, dir), { recursive: true, mode: 0o700 });
  const env = { EDUPI_PROJECT_ROOT: dataRoot, EDUPI_HOME: home, EDUPI_MEMORY_DIR: path.join(home, "memory"), EDUPI_OUTPUT_DIR: path.join(home, "output"), EDUPI_LOCK_DIR: path.join(home, "locks") };
  const priorEnv = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  const load = file => import(pathToFileURL(path.join(coreRoot, "scripts", file)).href);
  const coreCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: coreRoot, encoding: "utf8" }).trim();
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const { createTeacherUsageService } = await jiti.import("./edupi-teacher-usage-service.ts");
  const { teacherUsageDigest } = await jiti.import("./edupi-teacher-usage-documents.ts");
  const { prepareCoreRuntimeRoot } = await load("core_runtime_root.mjs");
  const { acquireCoreRuntimeWriterAdmission } = await load("core_runtime_writer_admission.mjs");
  const { createCoreRuntimeDaemon } = await load("core_runtime_daemon.mjs");
  const { buildRhythmPlan } = await load("rhythm_planner.mjs");
  const { syncWorkCandidates } = await load("teacher_review_store.mjs");
  const protocol = await load("core_runtime_protocol.mjs");
  const root = prepareCoreRuntimeRoot(dataRoot);
  const seed = await acquireCoreRuntimeWriterAdmission({ root, kind: "legacy_desktop_usage_test_seed" });
  let tasks;
  const timetableFile = path.join(home, "memory", "timetable.json");
  try {
    const slots = [1, 2].map(period => ({ id: `usage-slot-${period}`, day_of_week: 1, period, subject: "math", class_name: "SYNTHETIC 7B", class_id: "class-7b", kind: "class" }));
    const monday = new Date(); monday.setUTCDate(monday.getUTCDate() + ((8 - monday.getUTCDay()) % 7 || 7));
    const date = monday.toISOString().slice(0, 10);
    fs.writeFileSync(timetableFile, JSON.stringify({ slots }));
    tasks = buildRhythmPlan({ semesterStart: date, semesterEnd: date, timetableSlots: slots }).tasks;
    syncWorkCandidates(tasks, { cycleToken: `cycle:${date}`, observedAt: new Date().toISOString(), authoritativeCandidateIds: tasks.map(task => task.task_id) });
  } finally { await seed.release(); }
  const businessBytes = fs.readFileSync(timetableFile);
  const sentinel = path.join(home, "memory", "synthetic-teacher-note.txt"); fs.writeFileSync(sentinel, "SYNTHETIC non-usage data");
  const registryPath = path.join(fixture, "documents.json");
  const documentFiles = { privacy_policy: path.join(fixture, "privacy.txt"), user_agreement: path.join(fixture, "agreement.txt") };
  function configureDocuments(version) {
    const registry = { version: 1 };
    for (const [kind, file] of Object.entries(documentFiles)) {
      const text = `SYNTHETIC TEST FIXTURE ONLY: ${kind} ${version}\n`;
      fs.writeFileSync(file, text, { mode: 0o600 });
      registry[kind] = { version, file, sha256: teacherUsageDigest(text) };
    }
    fs.writeFileSync(registryPath, JSON.stringify(registry), { mode: 0o600 });
  }
  const token = crypto.randomBytes(32).toString("base64url"), ownerToken = crypto.randomBytes(32).toString("base64url");
  let daemon, sequence = 0, drop = null, offline = false;
  const sent = [];
  async function raw(operation, payload, owner = true) {
    const response = await fetch(daemon.endpoint, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(owner ? { "x-edupi-owner-control": ownerToken } : {}) },
      body: JSON.stringify({ protocol: protocol.CORE_RUNTIME_PROTOCOL, protocol_version: protocol.CORE_RUNTIME_PROTOCOL_VERSION, schema_hash: protocol.CORE_RUNTIME_SCHEMA_HASH, request_id: `desktop-usage-${++sequence}`, operation, payload }) });
    const value = await response.json();
    assert.deepEqual(protocol.validateRuntimeResponse(value), { ok: true });
    return value;
  }
  let service;
  const host = { call: (operation, payload) => raw(operation, payload, false), callOwnerControl: async (operation, payload) => {
    if (["teacher_usage_record", "teacher_usage_consent_set", "teacher_usage_erase_all"].includes(operation)) {
      const state = service.outbox.read();
      const persisted = state.entries.find(entry => entry.id === (payload.event_id ?? payload.command_id));
      assert.equal(persisted?.status, "pending", "immutable command must exist on disk before Core sees it");
      assert.deepEqual(persisted.payload, payload);
      sent.push({ operation, payload: structuredClone(payload) });
      if (offline && operation === "teacher_usage_record") throw new Error("synthetic offline");
    }
    const result = await raw(operation, payload);
    if (drop === operation) { drop = null; throw new Error("synthetic lost reply after commit"); }
    return result;
  } };
  async function start() {
    daemon = await createCoreRuntimeDaemon({ dataRoot, token, supervisorSessionId: "desktop-usage-synthetic", coreCommit, componentManifestHash: protocol.CORE_RUNTIME_SCHEMA_HASH, port: 0, ambientPlanning: true, ownerControlToken: ownerToken });
  }
  const freshService = () => createTeacherUsageService({ host, dataRoot, stateDir, registryPath });
  const at = () => new Date().toISOString();
  try {
    await start();
    await raw("owner_control", { command_id: "synthetic-bootstrap", root_ref: daemon.dataRootFingerprint, expected_owner_id: null, action: "bootstrap" });
    service = await createTeacherUsageService({ host, dataRoot, stateDir, registryPath: "" });
    assert.equal((await service.read()).documents.configured, false);
    await assert.rejects(service.perform({ action: "consent_set", command_id: "synthetic-unconfigured", decision: "accept", at: at(), policy_ref: `sha256:${"d".repeat(64)}`, checked: true, viewed: true }), error => error.code === "usage_documents_unconfigured");
    assert.equal(sent.length, 0, "unconfigured host never writes a consent attestation to Core");
    configureDocuments("fixture-1");
    service = await freshService();
    let status = await service.read(); assert.equal(status.collecting, false); assert.equal(status.usage.summary.total_events, 0);
    const acceptance = { action: "consent_set", command_id: "synthetic-accept-1", decision: "accept", at: at(), policy_ref: status.documents.policy_ref, checked: true, viewed: true };
    drop = "teacher_usage_consent_set";
    await assert.rejects(service.perform(acceptance), error => error.code === "usage_reply_unknown");
    service = await freshService();
    assert.equal((await service.read()).outbox.pending, 1);
    assert.equal((await service.read()).collecting, false);
    await service.perform({ action: "retry" });
    assert.deepEqual(sent[0], sent[1], "accept replay preserves command, revision, document digest and time after restart");
    status = await service.read(); assert.equal(status.collecting, true); assert.equal(status.usage.consent.revision, 1);
    const targets = [];
    for (const task of tasks) targets.push(await service.perform({ action: "target_read", target: { kind: "work_candidate", target_id: task.task_id } }));
    assert.equal(targets.length, 2);
    const makeEvent = (id, target = targets[0]) => ({ event_id: id, session_id: "synthetic-trial", domain: target.domain, scope: target.scope,
      target: { kind: target.kind, target_id: target.target_id, expected_revision: target.revision, expected_fingerprint: target.fingerprint }, action: "opportunity_visible", surface: "today", occurred_at: at() });
    const initial = makeEvent("synthetic-visible-1");
    const prepareInput = { action: "event_prepare", event_id: initial.event_id, session_id: initial.session_id, target: { kind: initial.target.kind, target_id: initial.target.target_id },
      expected_revision: initial.target.expected_revision, expected_fingerprint: initial.target.expected_fingerprint, usage_action: initial.action, surface: initial.surface, occurred_at: initial.occurred_at };
    const { event } = await service.perform(prepareInput);
    assert.equal((await service.read()).outbox.pending, 1, "event preparation persists the original interaction before dispatch");
    assert.deepEqual((await service.perform({ ...prepareInput, occurred_at: "2026-10-20T02:00:00.000Z" })).event, event, "rerender recovers original timestamp without relabeling the identity");
    await assert.rejects(service.perform({ ...prepareInput, surface: "task" }), error => error.code === "usage_outbox_conflict");
    drop = "teacher_usage_record";
    await assert.rejects(service.perform({ action: "record", event }), error => error.code === "usage_reply_unknown");
    await daemon.close(); await start(); service = await freshService();
    assert.deepEqual((await service.perform({ ...prepareInput, occurred_at: at() })).event, event, "a remount after real Core restart recovers original target proof and time");
    await service.perform({ action: "retry" });
    const eventCalls = sent.filter(item => item.operation === "teacher_usage_record");
    assert.deepEqual(eventCalls[0], eventCalls[1], "event payload survives a real Core restart and unknown reply unchanged");
    assert.equal((await service.perform({ action: "record", event })).sequence, 1);
    await service.perform({ action: "record", event: makeEvent("synthetic-visible-2", targets[1]) });
    await service.perform({ action: "record", event: { ...makeEvent("synthetic-open-3"), action: "draft_opened", surface: "task" } });
    status = await service.read(); assert.equal(status.usage.summary.total_events, 3); assert.equal(status.usage.summary.unique_targets, 2);
    const batch = await service.perform({ action: "upload_batch_read", through_revision: status.usage.revision });
    assert.equal(batch.observed_events, 3); assert.equal(batch.external_send, false);
    assert.doesNotMatch(JSON.stringify(batch), /synthetic-trial|usage-slot|class-7b|SYNTHETIC 7B/);
    await assert.rejects(service.perform({ action: "record", event: { ...event, action: "draft_opened" } }), error => error.code === "usage_outbox_conflict");
    await assert.rejects(service.perform({ action: "record", event: { ...makeEvent("synthetic-stale"), target: { ...event.target, expected_revision: event.target.expected_revision + 1 } } }), error => error.code === "teacher_usage_target_stale");
    offline = true;
    await assert.rejects(service.perform({ action: "record", event: makeEvent("synthetic-offline") }), error => error.code === "usage_reply_unknown");
    configureDocuments("fixture-2");
    status = await service.read(); assert.equal(status.collecting, false); assert.ok(status.outbox.quarantined >= 2);
    const sentBefore = sent.length;
    await service.perform({ action: "retry" }); assert.equal(sent.length, sentBefore, "old policy observations are never relabeled or resent");
    offline = false;
    const newAccept = { ...acceptance, command_id: "synthetic-accept-2", at: at(), policy_ref: status.documents.policy_ref };
    await service.perform(newAccept);
    status = await service.read(); assert.equal(status.usage.consent.start_after, 3);
    await assert.rejects(service.perform({ action: "upload_batch_read", through_revision: status.usage.revision, after: 0 }), error => error.code === "teacher_usage_consent_stale");
    assert.equal((await service.perform({ action: "upload_batch_read", through_revision: status.usage.revision })).observed_events, 0);
    await service.perform({ action: "record", event: makeEvent("synthetic-new-policy") });
    const revoke = { action: "consent_set", command_id: "synthetic-revoke", decision: "revoke", at: at() };
    await service.perform(revoke);
    const revokePayload = sent.findLast(item => item.operation === "teacher_usage_consent_set").payload;
    assert.equal(revokePayload.expected_revision, 2, "consent mutation uses consent.revision, not journal revision 4");
    status = await service.read(); assert.equal(status.collecting, false); assert.equal(status.usage.summary.total_events, 4);
    await assert.rejects(service.perform({ action: "record", event: makeEvent("synthetic-after-revoke") }), error => error.code === "teacher_usage_consent_required");
    const erase = { action: "erase_all", command_id: "synthetic-erase", requested_at: at() };
    drop = "teacher_usage_erase_all";
    await assert.rejects(service.perform(erase), error => error.code === "usage_reply_unknown");
    service = await freshService();
    const erasePendingBytes = fs.readFileSync(service.outbox.file);
    await assert.rejects(service.perform({ ...newAccept, command_id: "synthetic-accept-during-erase", at: at() }), error => error.code === "usage_control_pending");
    assert.deepEqual(fs.readFileSync(service.outbox.file), erasePendingBytes, "an unknown erasure cannot swallow a later consent or event");
    assert.equal((await service.read()).outbox.pending_control, 1);
    const erased = await service.perform(erase); assert.equal(erased.replayed, true); assert.equal(erased.removed_events, 4);
    assert.equal(sent.findLast(item => item.operation === "teacher_usage_erase_all").payload.expected_revision, 4, "erasure uses the top-level journal revision");
    status = await service.read(); assert.equal(status.usage.summary.total_events, 0); assert.equal(status.usage.consent.status, "revoked");
    assert.equal(status.outbox.pending, 0); assert.equal(service.outbox.read().entries.length, 1, "erasure drops all observation payloads and cached consent commands");
    assert.deepEqual(fs.readFileSync(timetableFile), businessBytes); assert.equal(fs.readFileSync(sentinel, "utf8"), "SYNTHETIC non-usage data");
    await service.perform({ ...newAccept, command_id: "synthetic-accept-capacity", at: at() });
    const capacityDir = path.join(fixture, "capacity-state"); fs.mkdirSync(capacityDir, { mode: 0o700 });
    const capped = await createTeacherUsageService({ host, dataRoot, stateDir: capacityDir, registryPath, maxEvents: 1 });
    await capped.perform({ ...prepareInput, event_id: "synthetic-capacity-1", occurred_at: at() });
    await assert.rejects(capped.perform({ ...prepareInput, event_id: "synthetic-capacity-2", occurred_at: at() }), error => error.code === "usage_outbox_capacity");
    const cappedStatus = await capped.read();
    assert.equal(cappedStatus.outbox.stopped, true); assert.equal(cappedStatus.outbox.pending, 1); assert.equal(cappedStatus.outbox.pending_control, 0);
    // A capacity stop has no unresolved control mutation; revocation/erasure remain reachable.
    service = capped;
    await capped.perform({ action: "erase_all", command_id: "synthetic-capacity-erase", requested_at: at() });
    assert.equal((await capped.read()).outbox.pending, 0);
    assert.equal(fs.readFileSync(sentinel, "utf8"), "SYNTHETIC non-usage data");
    service = await freshService();
    // A stale/deleted timetable source is checked by Core, not repaired by the Desktop carrier.
    await daemon.close(); fs.writeFileSync(timetableFile, JSON.stringify({ slots: [] })); await start(); service = await freshService();
    await service.perform({ ...newAccept, command_id: "synthetic-accept-3", at: at() });
    await assert.rejects(service.perform({ action: "record", event: makeEvent("synthetic-deleted-source") }), error => error.code === "teacher_usage_target_stale");
    const outboxPath = service.outbox.file;
    fs.writeFileSync(outboxPath, "{broken", { mode: 0o600 });
    await assert.rejects(service.read(), error => error.code === "usage_outbox_invalid");
    assert.equal((await raw("health", null, false)).ok, true, "optional carrier log failure does not stop teacher work");
    await daemon.close();
    fs.writeFileSync(path.join(home, "output", "teacher-usage-v1.json"), "{broken", { mode: 0o600 });
    await start();
    const held = await raw("health", null, false);
    assert.equal(held.result.capabilities.teacher_usage, "held");
    service = await freshService();
    await assert.rejects(service.read(), error => error.code === "teacher_usage_state_invalid");
    assert.equal((await raw("owner_read", {})).ok, true, "broken optional Core log leaves the authorized business owner readable");
    assert.equal(fs.readFileSync(sentinel, "utf8"), "SYNTHETIC non-usage data");
  } finally {
    if (daemon) await daemon.close();
    for (const [key, value] of Object.entries(priorEnv)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
