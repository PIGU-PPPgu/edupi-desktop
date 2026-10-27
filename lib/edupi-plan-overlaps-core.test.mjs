import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { createJiti } from "jiti";

const coreRoot = process.env.EDUPI_CALENDAR_NOTES_TEST_CORE_ROOT;
const jiti = createJiti(import.meta.url);
const { createPlanOverlapService, createSnapshotBoundPlanCalendar } = await jiti.import("./edupi-plan-overlaps.ts");
const { issueCalendarNotes } = await jiti.import("./edupi-calendar-notes.ts");
const { buildEducationContractFromWorkspace } = await jiti.import("./edupi-education-contract.ts");

test("Desktop canonical merge resumes after restart and owner conflict review; concurrent Core revision protects the other plan", { skip: !coreRoot }, async () => {
  const dataRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-desktop-plan-notes-")));
  const home = path.join(dataRoot, ".edupi"), outputDir = path.join(home, "output");
  const prior = { ...process.env };
  for (const part of ["memory", "output", "locks", "desktop"]) fs.mkdirSync(path.join(home, part), { recursive: true });
  Object.assign(process.env, { EDUPI_PROJECT_ROOT: dataRoot, EDUPI_HOME: home, EDUPI_MEMORY_DIR: path.join(home, "memory"),
    EDUPI_OUTPUT_DIR: outputDir, EDUPI_LOCK_DIR: path.join(home, "locks"), EDUPI_CORE_COMMIT: "f".repeat(40) });
  const load = name => import(pathToFileURL(path.join(coreRoot, "scripts", name)).href);
  const protocol = await load("core_runtime_protocol.mjs");
  const { prepareCoreRuntimeRoot } = await load("core_runtime_root.mjs");
  const { acquireCoreRuntimeWriterAdmission } = await load("core_runtime_writer_admission.mjs");
  const { applyEducationIntakeCommand, loadEducationIntakeState } = await load("education_intake_store.mjs");
  const { buildCommandEnvelope } = await load("edupi_bridge_command.mjs");
  const { buildSnapshotForState } = await load("edupi_bridge_snapshot.mjs");
  const { loadTeacherReviewState } = await load("teacher_review_store.mjs");
  const { createCoreRuntimeDaemon } = await load("core_runtime_daemon.mjs");
  const root = prepareCoreRuntimeRoot(dataRoot), at = "2026-10-28T00:00:00.000Z";
  const interval = { start: "2026-10-30T09:15+00:00", end: "2026-10-30T10:30+00:00", time_zone: "UTC" };
  const a = { event_id: "canonical-a", source_occurrence_ref: "occurrence-a", date: "2026-10-30", end_date: null,
    name: "[TEST] 主安排", type: "meeting", confidence: "teacher_confirmed", notes: "原备注A", time_interval: interval, location: "测试教室A" };
  const b = { ...a, event_id: "canonical-b", source_occurrence_ref: "occurrence-b", name: "[TEST] 补充安排", notes: "补充B", location: "测试教室B" };
  const sourceInputs = new Map([[a.event_id, a], [b.event_id, b]]);
  function envelope(events, key, snapshotId) {
    const source = { source_kind: "teacher_message", source_id: "fixture-nonmanual-issuer", source_hash: `sha256:${crypto.createHash("sha256").update(key).digest("hex")}`,
      evidence_ids: [`evidence-${key}`] };
    return buildCommandEnvelope({ contractVersion: "1.2", messageId: key, requestId: key, issuedAt: at, snapshotId, idempotencyKey: key,
      provenance: [{ ...source, source_path: null, observed_at: at, actor: "teacher", parent_ids: [] }],
      teacherReview: { state: "pending_review", reviewer_id: null, reviewed_at: null, note: null, revision: 0 },
      command: { command_type: "import_calendar", source, events } });
  }
  const admission = await acquireCoreRuntimeWriterAdmission({ root, kind: "legacy_desktop_notes_synthetic_seed", busyTimeoutMs: 250 });
  try {
    const snapshotFor = value => buildSnapshotForState(loadTeacherReviewState(), { educationIntakeState: value });
    const result = await applyEducationIntakeCommand({ commandEnvelope: envelope([a, b], "seed-plans", snapshotFor(loadEducationIntakeState()).snapshot_id),
      buildSnapshotForState: snapshotFor });
    assert.equal(result.receipt.payload.status, "accepted");
  } finally { await admission.release(); }
  const token = crypto.randomBytes(32).toString("base64url"), ownerToken = crypto.randomBytes(32).toString("base64url");
  const options = { dataRoot, token, ownerControlToken: ownerToken, supervisorSessionId: "desktop-notes-test", coreCommit: "f".repeat(40),
    componentManifestHash: protocol.CORE_RUNTIME_SCHEMA_HASH, port: 0, ambientPlanning: true };
  let daemon, sequence = 0, noteWrites = 0, deleteAttempts = 0, failDelete = true, concurrentLocation = false;
  async function call(operation, payload, ownerControl = false) {
    const response = await fetch(daemon.endpoint, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`,
      ...(ownerControl ? { "x-edupi-owner-control": ownerToken } : {}) }, body: JSON.stringify({ protocol: protocol.CORE_RUNTIME_PROTOCOL,
      protocol_version: protocol.CORE_RUNTIME_PROTOCOL_VERSION, schema_hash: protocol.CORE_RUNTIME_SCHEMA_HASH,
      request_id: `desktop-plan-${++sequence}`, operation, payload }) });
    const body = await response.json(); assert.deepEqual(protocol.validateRuntimeResponse(body), { ok: true }, JSON.stringify(body)); return body;
  }
  async function bridge(operation, fields = {}, write = false) {
    const response = await call(write ? "bridge_call" : "bridge_read", { bridge_frame: JSON.stringify({ protocol: "edupi-desktop-bridge", protocol_version: 1,
      producer: "edupi-desktop", operation, request_id: `desktop-bridge-${++sequence}`, ...fields }) });
    assert.equal(response.ok, true, JSON.stringify(response)); return JSON.parse(response.result.bridge_frame);
  }
  const readSnapshot = async () => {
    const response = await bridge("snapshot", { schedule_occurrence_version: "1.2" });
    assert.equal(response.ok, true, JSON.stringify(response));
    return { envelope: response.envelope, payload: response.envelope.payload, workspace: response.envelope.payload.education_workspace,
      occurrenceProjection: response.occurrence_projection, runtime: { root: coreRoot }, dataRoot: { root: dataRoot } };
  };
  const host = { call: (operation, payload) => call(operation, payload), callOwnerControl: (operation, payload) => call(operation, payload, true) };
  const cachePath = path.join(home, "desktop", "plan-overlaps.json");
  const adapter = createSnapshotBoundPlanCalendar({ readSnapshot,
    intake: async () => { throw new Error("unexpected calendar reimport; never contact a non-test root"); },
    project: async snapshot => buildEducationContractFromWorkspace({ ...snapshot.workspace, calendar: snapshot.occurrenceProjection.events }, {
      workspacePath: dataRoot, snapshotPayload: snapshot.payload, supportedCommands: snapshot.payload.capabilities.supported_commands,
    }),
    updateNotes: async (input, dependencies) => {
      noteWrites++; await issueCalendarNotes(input, { ...dependencies, host });
      if (concurrentLocation) {
        const changed = { ...sourceInputs.get(input.canonicalId), notes: input.notes, location: "Core并发修改后的教室" };
        const response = await bridge("command", { envelope: envelope([changed], "concurrent-core-edit", (await readSnapshot()).payload.snapshot_id) }, true);
        assert.equal(response.receipt.payload.status, "accepted", JSON.stringify(response));
      }
    },
    deleteEntity: async (input, dependencies) => {
      deleteAttempts++; if (failDelete) throw new Error("synthetic offline before deletion");
      const captured = await dependencies.readSnapshot();
      const response = await bridge("delete", { action: "delete", target_kind: "calendar", target_id: input.id,
        snapshot_id: captured.payload.snapshot_id, reviewer: "teacher", note: "Synthetic plan merge" }, true);
      assert.equal(response.ok, true, JSON.stringify(response));
    },
  });
  const deps = { ...adapter,
    load: async () => fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, "utf8")) : null,
    save: async value => fs.writeFileSync(cachePath, JSON.stringify(value), { mode: 0o600 }),
    classify: async pairs => JSON.stringify(pairs.map(pair => ({ id: pair.id, kind: "duplicate", reason: "Synthetic classified pair" }))),
  };
  try {
    daemon = await createCoreRuntimeDaemon(options);
    assert.equal((await call("owner_control", { command_id: "bootstrap-desktop-notes", root_ref: root.dataRootFingerprint, expected_owner_id: null,
      action: "bootstrap" }, true)).ok, true);
    const original = structuredClone(loadEducationIntakeState().calendar_events.find(row => row.event_id === a.event_id));
    const run = createPlanOverlapService(deps), scan = await run({ action: "scan" }), id = scan.suggestions[0].id;
    await assert.rejects(run({ action: "merge", id, keepId: a.event_id }), /synthetic offline/);
    assert.equal(noteWrites, 1); assert.equal(deleteAttempts, 1);
    const saved = JSON.parse(fs.readFileSync(cachePath, "utf8")); assert.ok(saved.intents[id]);
    const after = loadEducationIntakeState().calendar_events.find(row => row.event_id === a.event_id);
    assert.equal(after._occurrence_issuer, original._occurrence_issuer); assert.deepEqual(after.time_interval, original.time_interval);
    assert.equal(after.location, original.location); assert.match(after.notes, /原备注A.*补充B/);
    assert.equal(loadEducationIntakeState().calendar_events.length, 2, "no third occurrence after the actual adapter update");
    const auditCount = loadEducationIntakeState().calendar_notes_updates.length;
    await daemon.close(); daemon = await createCoreRuntimeDaemon({ ...options, supervisorSessionId: "desktop-notes-restarted" });
    failDelete = false;
    const resumed = createPlanOverlapService(deps);
    assert.equal((await resumed()).suggestions[0].merging, true);
    assert.equal((await resumed({ action: "merge", id })).suggestions[0].status, "merged");
    assert.equal(noteWrites, 1, "restart resumes only deletion, without repeating a notes command");
    assert.equal(loadEducationIntakeState().calendar_notes_updates.length, auditCount);
    const reread = await adapter.readCalendar(); assert.deepEqual(reread.map(row => row.id), [a.event_id]);

    // Create the same reviewed-basis protection as the retained native test A.
    const ownerId = (await call("owner_read", {}, true)).result.owner.id;
    const conflictRequest = { root_ref: root.dataRootFingerprint, expected_owner_id: ownerId };
    const resolve = (target, decision, key) => call("schedule_conflict_resolve", { ...conflictRequest, command_id: key,
      conflict_id: target.conflict_id, kind: target.kind, canonical_id: target.canonical_id,
      expected_revision: target.expected_revision, expected_content_hash: target.expected_content_hash,
      expected_conflict_hash: target.expected_conflict_hash, decision }, true);
    const keep = loadEducationIntakeState().calendar_events.find(row => row.event_id === a.event_id);
    const moved = { ...a, notes: keep.notes, time_interval: { ...interval, start: "2026-10-30T09:30+00:00" } };
    const proposedMove = await bridge("command", { envelope: envelope([moved], "protect-original-time", (await readSnapshot()).payload.snapshot_id) }, true);
    assert.equal(proposedMove.receipt.payload.status, "held");
    let conflicts = (await call("schedule_conflicts_read", conflictRequest, true)).result.conflicts;
    assert.equal((await resolve(conflicts.find(row => row.canonical_id === a.event_id), "keep_existing", "keep-original-time")).ok, true);
    const c = { ...b, event_id: "canonical-c", source_occurrence_ref: "occurrence-c", name: "[TEST] 第三份补充", notes: "补充C" };
    sourceInputs.set(c.event_id, c);
    const imported = await bridge("command", { envelope: envelope([c], "import-c", (await readSnapshot()).payload.snapshot_id) }, true);
    assert.equal(imported.receipt.payload.status, "accepted");
    const secondScan = await resumed({ action: "scan" }), secondId = secondScan.suggestions.find(item => item.status === "pending").id;
    const beforeReviewDeletes = deleteAttempts;
    await assert.rejects(resumed({ action: "merge", id: secondId, keepId: a.event_id }), /待确认/);
    assert.equal(deleteAttempts, beforeReviewDeletes);
    assert.ok((await adapter.readCalendar()).some(row => row.id === c.event_id));
    const protectedWrites = noteWrites;
    conflicts = (await call("schedule_conflicts_read", conflictRequest, true)).result.conflicts;
    const notesTarget = conflicts.find(row => row.canonical_id === a.event_id);
    assert.match(notesTarget.candidate.notes, /补充C/);
    assert.deepEqual(notesTarget.candidate.time_interval, interval);
    assert.equal((await resolve(notesTarget, "replace_with_candidate", "accept-merge-notes")).ok, true);
    assert.equal((await createPlanOverlapService(deps)({ action: "merge", id: secondId })).suggestions.find(row => row.id === secondId).status, "merged");
    assert.equal(noteWrites, protectedWrites, "after teacher resolution the service only deletes the supplement");
    assert.deepEqual((await adapter.readCalendar()).map(row => row.id), [a.event_id]);
    assert.equal(loadEducationIntakeState().calendar_events.length, 3);

    const d = { ...b, event_id: "canonical-d", source_occurrence_ref: "occurrence-d", name: "[TEST] 第四份补充", notes: "补充D" };
    sourceInputs.set(d.event_id, d);
    const fourth = await bridge("command", { envelope: envelope([d], "import-d", (await readSnapshot()).payload.snapshot_id) }, true);
    assert.equal(fourth.receipt.payload.status, "accepted");
    const thirdScan = await resumed({ action: "scan" }), thirdId = thirdScan.suggestions.find(item => item.status === "pending").id;
    concurrentLocation = true; const beforeDeletes = deleteAttempts;
    await assert.rejects(resumed({ action: "merge", id: thirdId, keepId: d.event_id }), /核对/);
    assert.equal(deleteAttempts, beforeDeletes, "concurrent official Core edit prevents the other plan deletion");
    assert.ok((await adapter.readCalendar()).some(row => row.id === a.event_id));
    assert.equal(loadEducationIntakeState().calendar_events.length, 4, "only the explicitly imported C and D were added");
  } finally {
    await daemon?.close(); fs.rmSync(dataRoot, { recursive: true, force: true });
    for (const key of Object.keys(process.env)) if (!(key in prior)) delete process.env[key];
    Object.assign(process.env, prior);
  }
});
