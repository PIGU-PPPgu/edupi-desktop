import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";

const coreRoot = process.env.EDUPI_SCHEDULE_RESOLUTION_TEST_CORE_ROOT;
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const client = await jiti.import("./edupi-schedule-conflicts.ts");

test("formal route resolves canonical notes after a foreign issuer alias was soft-deleted without relaxing other alias or CAS guards", { skip: !coreRoot }, async () => {
  // No application endpoint or existing data directory is used by this test.
  const previous = { ...process.env };
  const dataRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-notes-alias-resolution-")));
  const home = path.join(dataRoot, ".edupi");
  for (const part of ["memory", "output", "locks"]) fs.mkdirSync(path.join(home, part), { recursive: true });
  const desktopToken = crypto.randomBytes(32).toString("hex");
  Object.assign(process.env, { EDUPI_PROJECT_ROOT: dataRoot, EDUPI_HOME: home, EDUPI_MEMORY_DIR: path.join(home, "memory"),
    EDUPI_OUTPUT_DIR: path.join(home, "output"), EDUPI_LOCK_DIR: path.join(home, "locks"), EDUPI_CORE_COMMIT: "f".repeat(40),
    PI_DESKTOP_API_TOKEN: desktopToken });
  const load = name => import(pathToFileURL(path.join(coreRoot, "scripts", name)).href);
  const protocol = await load("core_runtime_protocol.mjs");
  const { createCoreRuntimeDaemon } = await load("core_runtime_daemon.mjs");
  const { buildCommandEnvelope } = await load("edupi_bridge_command.mjs");
  const { loadEducationIntakeState } = await load("education_intake_store.mjs");
  const { scheduleContentFingerprint } = await load("schedule_dedupe.mjs");
  const token = crypto.randomBytes(32).toString("base64url"), ownerToken = crypto.randomBytes(32).toString("base64url");
  const statePath = path.join(home, "output", "education_intake_state.json");
  const options = { dataRoot, token, ownerControlToken: ownerToken, supervisorSessionId: "notes-alias-resolution", coreCommit: "f".repeat(40),
    componentManifestHash: protocol.CORE_RUNTIME_SCHEMA_HASH, port: 0, ambientPlanning: true };
  let daemon, sequence = 0, ownerId, rootRef;
  const seenRuntimeCalls = [];
  async function call(operation, payload, owner = false) {
    const response = await fetch(daemon.endpoint, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`,
      ...(owner ? { "x-edupi-owner-control": ownerToken } : {}) }, body: JSON.stringify({ protocol: protocol.CORE_RUNTIME_PROTOCOL,
      protocol_version: protocol.CORE_RUNTIME_PROTOCOL_VERSION, schema_hash: protocol.CORE_RUNTIME_SCHEMA_HASH,
      request_id: `alias-test-${++sequence}`, operation, payload }) });
    const result = await response.json();
    assert.deepEqual(protocol.validateRuntimeResponse(result), { ok: true }, JSON.stringify(result));
    return result;
  }
  async function bridge(operation, fields = {}, write = false) {
    const result = await call(write ? "bridge_call" : "bridge_read", { bridge_frame: JSON.stringify({ protocol: "edupi-desktop-bridge", protocol_version: 1,
      producer: "edupi-desktop", operation, request_id: `alias-bridge-${++sequence}`, ...fields }) });
    assert.equal(result.ok, true, JSON.stringify(result)); return JSON.parse(result.result.bridge_frame);
  }
  const snapshot = async () => {
    const result = await bridge("snapshot", { schedule_occurrence_version: "1.2" });
    assert.equal(result.ok, true, JSON.stringify(result)); return result;
  };
  const current = id => loadEducationIntakeState().calendar_events.find(item => item.event_id === id);
  const item = (id, sourceRef = `ref-${id}`) => ({ event_id: id, date: "2026-10-30", end_date: null,
    name: `[TEST] ${id}`, type: "meeting", confidence: "teacher_confirmed", notes: `原备注 ${id}`,
    source_occurrence_ref: sourceRef,
    time_interval: { start: "2026-10-30T09:15+00:00", end: "2026-10-30T10:30+00:00", time_zone: "UTC" }, location: "合成隔离教室" });
  async function imported(event, issuer, key) {
    const before = await snapshot(), at = new Date().toISOString();
    const source = { source_kind: "teacher_message", source_id: issuer,
      source_hash: `sha256:${crypto.createHash("sha256").update(key).digest("hex")}`, evidence_ids: [`evidence-${key}`] };
    const envelope = buildCommandEnvelope({ contractVersion: event.source_occurrence_ref ? "1.2" : "1.1", messageId: key, requestId: key,
      issuedAt: at, snapshotId: before.envelope.payload.snapshot_id, idempotencyKey: key,
      provenance: [{ ...source, source_path: null, observed_at: at, actor: "teacher", parent_ids: [] }],
      teacherReview: { state: "pending_review", reviewer_id: null, reviewed_at: null, note: null, revision: 0 },
      command: { command_type: "import_calendar", source, events: [event] } });
    const response = await bridge("command", { envelope }, true);
    assert.equal(response.ok, true, JSON.stringify(response)); return response;
  }
  async function deleted(id) {
    const result = await bridge("delete", { action: "delete", target_kind: "calendar", target_id: id,
      snapshot_id: (await snapshot()).envelope.payload.snapshot_id, reviewer: "teacher", note: "Synthetic alias regression" }, true);
    assert.equal(result.ok, true, JSON.stringify(result));
  }
  const roots = { runtime: { root: coreRoot }, dataRoot: { root: dataRoot } };
  const host = { call: (operation, payload) => call(operation, payload), callOwnerControl: (operation, payload) => {
    seenRuntimeCalls.push({ operation, payload }); return call(operation, payload, true);
  } };
  const [bounded, auth, security] = await Promise.all([
    jiti.import("./bounded-form-data.ts"), jiti.import("./desktop-api-auth.ts"), jiti.import("./request-security.ts"),
  ]);
  const routeSource = fs.readFileSync(new URL("../app/api/edupi/schedule-conflicts/route.ts", import.meta.url), "utf8");
  const routeCode = ts.transpileModule(routeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const runtimeModules = { "next/server": createRequire(import.meta.url)("next/server"), "node:crypto": crypto,
    "@/lib/bounded-form-data": bounded, "@/lib/desktop-api-auth": auth, "@/lib/request-security": security,
    "@/lib/edupi-core-snapshot": { resolveEduPiBridgeRoots: () => roots },
    "@/lib/edupi-runtime-supervisor": { ensureEduPiRuntime: async captured => { assert.equal(captured, roots); return host; } } };
  const route = {};
  vm.runInNewContext(routeCode, { exports: route, Request, Response, URL, Headers,
    require(name) { assert.ok(runtimeModules[name], `explicit synthetic transport dependency ${name}`); return runtimeModules[name]; } });
  const headers = async extra => ({ host: "localhost:30141", origin: "http://localhost:30141", "x-pi-desktop-token": desktopToken, ...extra });
  const routeFetcher = (url, init = {}) => route[init.method || "GET"](new Request(new URL(url, "http://localhost:30141"), init));
  const read = async id => (await client.readScheduleConflicts(routeFetcher, headers)).conflicts.find(conflict => conflict.canonicalId === id);
  async function decide(id, decision, commandId) {
    const conflict = await read(id); assert.ok(conflict, id);
    const captured = client.captureScheduleDecision(conflict, decision, commandId);
    return { captured, result: await client.resolveScheduleConflict(captured, routeFetcher, headers) };
  }
  async function heldNotes(id, key) {
    const read = await snapshot();
    const hash = read.envelope.provenance.find(source => source.source_kind === "core_event" && source.source_id === "education_intake_state").source_hash;
    const result = await call("calendar_notes_update", { command_id: key, root_ref: rootRef, expected_owner_id: ownerId,
      expected_snapshot_id: read.envelope.payload.snapshot_id, expected_intake_hash: hash, canonical_id: id,
      expected_notes: current(id).notes, notes: `${current(id).notes} 合并后的补充备注`, evidence_ids: [`notes-${key}`] }, true);
    assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.result.status, "held"); return result;
  }
  async function makeProtected(original, issuer, key) {
    assert.equal((await imported(original, issuer, `${key}-seed`)).receipt.payload.status, "accepted");
    const moved = { ...original, time_interval: { ...original.time_interval, start: "2026-10-30T09:30+00:00" } };
    assert.equal((await imported(moved, issuer, `${key}-move`)).receipt.payload.status, "held");
    await decide(original.event_id, "keep_existing", `${key}-keep`);
  }
  try {
    daemon = await createCoreRuntimeDaemon(options);
    rootRef = (await call("health", null)).result.data_root_fingerprint;
    const bootstrap = await call("owner_control", { command_id: "bootstrap-alias-owner", root_ref: rootRef, expected_owner_id: null, action: "bootstrap" }, true);
    assert.equal(bootstrap.ok, true); ownerId = bootstrap.result.owner_id;

    // Reproduce the installed history through formal commands: independent
    // issuer import creates the old third row, then native-equivalent delete
    // hides it without erasing its input alias.
    const original = item("canonical-retained"), supplement = item("canonical-supplement");
    await makeProtected(original, "original-manual-source", "retained");
    await imported(supplement, "original-manual-source", "supplement-seed");
    await imported({ ...original, notes: "旧版重复导入的合并备注" }, "historical-plan-merge-source", "old-third-row");
    const extra = loadEducationIntakeState().calendar_events.find(event => event.event_id !== original.event_id
      && event._source_event_ids?.includes(original.event_id));
    assert.ok(extra); assert.notEqual(extra._occurrence_issuer, current(original.event_id)._occurrence_issuer);
    await deleted(extra.event_id);
    assert.equal((await snapshot()).occurrence_projection.events.some(event => event.event_id === extra.event_id), false);
    assert.ok(current(extra.event_id)._source_event_ids.includes(original.event_id));
    const retainedBefore = structuredClone(current(original.event_id)), supplementBefore = structuredClone(current(supplement.event_id));
    const held = await heldNotes(original.event_id, "held-notes-after-deleted-alias");
    const notesConflict = await read(original.event_id);
    assert.ok(notesConflict);
    assert.equal(scheduleContentFingerprint(current(original.event_id), "calendar"), notesConflict.expectedContentHash);
    assert.equal(scheduleContentFingerprint(current(original.event_id)._conflicts[0].candidate, "calendar"), notesConflict.expectedConflictHash);
    const capture = client.captureScheduleDecision(notesConflict, "replace_with_candidate", "adopt-canonical-notes");
    const beforeNegatives = fs.readFileSync(statePath);
    for (const patch of [{ expectedRevision: capture.expectedRevision + 1 }, { expectedContentHash: `sha256:${"0".repeat(64)}` },
      { expectedConflictHash: `sha256:${"0".repeat(64)}` }]) {
      await assert.rejects(client.resolveScheduleConflict({ ...capture, commandId: `bad-cas-${++sequence}`, ...patch }, routeFetcher, headers),
        error => error?.code === "schedule_conflict_stale");
      assert.deepEqual(fs.readFileSync(statePath), beforeNegatives);
    }
    const wire = { command_id: "wrong-owner", root_ref: rootRef, expected_owner_id: "another-owner", conflict_id: capture.conflictId,
      kind: capture.kind, canonical_id: capture.canonicalId, expected_revision: capture.expectedRevision,
      expected_content_hash: capture.expectedContentHash, expected_conflict_hash: capture.expectedConflictHash, decision: capture.decision };
    assert.equal((await call("schedule_conflict_resolve", wire, true)).ok, false);
    assert.equal((await call("schedule_conflict_resolve", { ...wire, expected_owner_id: ownerId, root_ref: `sha256:${"0".repeat(64)}` }, true)).ok, false);
    assert.equal((await call("schedule_conflict_resolve", { ...wire, expected_owner_id: ownerId })).error_code, "owner_control_required");
    assert.deepEqual(fs.readFileSync(statePath), beforeNegatives);

    // This exact route/client decision is the native failure on Core af19.
    assert.deepEqual(await client.resolveScheduleConflict(capture, routeFetcher, headers), { replayed: false });
    const after = current(original.event_id);
    assert.equal(after.notes, held.result.notes); assert.equal(after.event_id, original.event_id);
    for (const field of ["date", "end_date", "source_occurrence_ref", "_occurrence_issuer", "time_interval", "location"])
      assert.deepEqual(after[field], retainedBefore[field]);
    assert.deepEqual(current(supplement.event_id), supplementBefore);
    assert.equal(loadEducationIntakeState().calendar_notes_updates.length, 1);
    const acceptedBytes = fs.readFileSync(statePath);
    assert.deepEqual(await client.resolveScheduleConflict(capture, routeFetcher, headers), { replayed: true });
    assert.deepEqual(fs.readFileSync(statePath), acceptedBytes);
    const forwarded = seenRuntimeCalls.filter(call => call.operation === "schedule_conflict_resolve").at(-1).payload;
    assert.equal(forwarded.expected_revision, capture.expectedRevision); assert.equal(forwarded.expected_content_hash, capture.expectedContentHash);
    assert.equal(forwarded.expected_conflict_hash, capture.expectedConflictHash); assert.equal(forwarded.canonical_id, capture.canonicalId);
    await daemon.close(); daemon = await createCoreRuntimeDaemon({ ...options, supervisorSessionId: "notes-alias-restarted" });
    assert.deepEqual(await client.resolveScheduleConflict(capture, routeFetcher, headers), { replayed: true });
    assert.deepEqual(fs.readFileSync(statePath), acceptedBytes);

    // An active independent issuer can also retain the same local input ID.
    // Resolving this canonical's own same-occurrence notes must not edit it.
    await imported({ ...original, notes: "仍有效的另一来源记录" }, "independent-live-source", "live-foreign-alias");
    const liveAlias = loadEducationIntakeState().calendar_events.find(event => event._occurrence_issuer === "teacher_message:independent-live-source");
    assert.ok(liveAlias?._source_event_ids.includes(original.event_id));
    const liveAliasBefore = structuredClone(liveAlias);
    const secondNotes = await heldNotes(original.event_id, "held-notes-with-live-foreign-alias");
    await decide(original.event_id, "replace_with_candidate", "adopt-own-notes-with-live-alias");
    assert.equal(current(original.event_id).notes, secondNotes.result.notes);
    assert.deepEqual(current(liveAlias.event_id), liveAliasBefore);
    assert.deepEqual(current(supplement.event_id), supplementBefore);

    // A candidate from a different input ID cannot take an alias already
    // owned by another live canonical record.
    const target = item("other-source-target"), aliasOwner = item("other-source-alias-owner");
    await imported(target, "other-target-source", "other-target-seed");
    await imported(aliasOwner, "alias-owner-source", "alias-owner-seed");
    await imported({ ...aliasOwner, event_id: "claimed-input-alias" }, "alias-owner-source", "claim-alias");
    await imported({ ...target, event_id: "claimed-input-alias", time_interval: { ...target.time_interval, start: "2026-10-30T09:30+00:00" } },
      "other-target-source", "conflicting-owned-alias");
    const other = await read(target.event_id); assert.equal(other.candidate.source_item_id, "claimed-input-alias");
    assert.equal(scheduleContentFingerprint(current(target.event_id), "calendar"), other.expectedContentHash);
    assert.equal(scheduleContentFingerprint(current(target.event_id)._conflicts[0].candidate, "calendar"), other.expectedConflictHash);
    const otherCapture = client.captureScheduleDecision(other, "replace_with_candidate", "reject-foreign-alias-claim");
    const collisionBytes = fs.readFileSync(statePath);
    await assert.rejects(client.resolveScheduleConflict(otherCapture, routeFetcher, headers), error => error?.code === "schedule_conflict_stale");
    assert.deepEqual(fs.readFileSync(statePath), collisionBytes);

    // Exact ID alone is not enough: rebinding a legacy canonical to another
    // occurrence still cannot consume an alias owned by a different record.
    const legacy = { event_id: "legacy-rebind-target", date: "2026-10-30", end_date: null, name: "[TEST] legacy target",
      type: "meeting", confidence: "teacher_confirmed", notes: "旧全天安排" };
    const rebindOwner = item("rebind-alias-owner");
    await imported(legacy, "legacy-target-source", "legacy-rebind-seed");
    await imported(rebindOwner, "rebind-alias-source", "rebind-owner-seed");
    await imported({ ...rebindOwner, event_id: legacy.event_id }, "rebind-alias-source", "rebind-alias-claim");
    const proposed = await imported({ ...legacy, source_occurrence_ref: "new-bound-occurrence" }, "new-rebind-source", "rebind-proposal");
    assert.equal(proposed.receipt.payload.status, "held");
    const rebind = await read(legacy.event_id); assert.equal(rebind.candidate.source_item_id, legacy.event_id);
    const rebindCapture = client.captureScheduleDecision(rebind, "replace_with_candidate", "reject-different-identity-alias");
    const rebindBytes = fs.readFileSync(statePath);
    await assert.rejects(client.resolveScheduleConflict(rebindCapture, routeFetcher, headers), error => error?.code === "schedule_conflict_stale");
    assert.deepEqual(fs.readFileSync(statePath), rebindBytes);
  } finally {
    await daemon?.close(); fs.rmSync(dataRoot, { recursive: true, force: true });
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});
