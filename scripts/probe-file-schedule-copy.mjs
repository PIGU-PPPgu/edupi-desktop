#!/usr/bin/env node
// Controlled Core contract probe, not a Desktop/App E2 or a pin override.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";

const configured = process.env.EDUPI_FILE_SCHEDULE_PROBE_CORE;
assert.ok(configured && path.isAbsolute(configured), "EDUPI_FILE_SCHEDULE_PROBE_CORE must select the explicit read-only Core probe tree");
const coreRoot = fs.realpathSync(configured);
const coreHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: coreRoot, encoding: "utf8" }).trim();
if (process.env.EDUPI_FILE_SCHEDULE_PROBE_EXPECTED) assert.equal(coreHead, process.env.EDUPI_FILE_SCHEDULE_PROBE_EXPECTED);
const temporaryRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-file-copy-probe-")));
const dataRoot = path.join(temporaryRoot, "data"), home = path.join(dataRoot, ".edupi"), stateDir = path.join(temporaryRoot, "state");
const environment = { EDUPI_PROJECT_ROOT: dataRoot, EDUPI_HOME: home, EDUPI_MEMORY_DIR: path.join(home, "memory"),
  EDUPI_OUTPUT_DIR: path.join(home, "output"), EDUPI_LOCK_DIR: path.join(home, "locks"), PI_DESKTOP_STATE_DIR: stateDir,
  EDUPI_CORE_COMMIT: coreHead };
const previous = new Map(Object.keys(environment).map(key => [key, process.env[key]]));
Object.assign(process.env, environment);
for (const directory of [dataRoot, stateDir, environment.EDUPI_MEMORY_DIR, environment.EDUPI_OUTPUT_DIR, environment.EDUPI_LOCK_DIR]) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}
const hash = bytes => "sha256:" + crypto.createHash("sha256").update(bytes).digest("hex");
const snapshotFor = state => {
  const stateHash = hash(JSON.stringify(state));
  return { snapshot_id: "snapshot_" + stateHash.slice(7), state_hash: stateHash, payload: { review_targets: [] } };
};
const loadCore = name => import(pathToFileURL(path.join(coreRoot, "scripts", name)).href);
let admission;
let networkCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { networkCalls += 1; throw new Error("external request forbidden in file-copy probe"); };
try {
  const { prepareCoreRuntimeRoot } = await loadCore("core_runtime_root.mjs");
  const { acquireCoreRuntimeWriterAdmission } = await loadCore("core_runtime_writer_admission.mjs");
  const { createAmbientAuthorizationStore } = await loadCore("ambient_authorization_store.mjs");
  const { readMaterialSchedule, applyMaterialSchedule } = await loadCore("material_schedule_read.mjs");
  const intake = await loadCore("education_intake_store.mjs");
  const { buildCommandEnvelope } = await loadCore("edupi_bridge_command.mjs");
  const root = prepareCoreRuntimeRoot(dataRoot);
  admission = await acquireCoreRuntimeWriterAdmission({ root, kind: "legacy_desktop_file_copy_probe" });
  const control = crypto.randomBytes(32);
  const controlHeader = control.toString("base64url");
  const authorizationStore = createAmbientAuthorizationStore({ root,
    macKey: crypto.createHmac("sha256", control).update("edupi.owner.authorization.mac-key.v1\0" + root.dataRootFingerprint).digest(),
    verifyControl: value => value === controlHeader });
  authorizationStore.control({ command_id: "copy-probe-owner", root_ref: root.dataRootFingerprint, expected_owner_id: null,
    action: "bootstrap" }, authorizationStore.authorizeControl(controlHeader));
  const ownerId = authorizationStore.read().owner.id;
  let sequence = 0;
  const state = () => intake.loadEducationIntakeState();
  const currentSnapshot = value => snapshotFor(intake.canonicalEducationIntakeIdentityState(value));
  async function receive(bytes, extension, fixedId = null) {
    sequence += 1;
    const stagingId = "stg_" + sequence.toString(16).padStart(32, "0");
    const materialId = fixedId || "material-" + stagingId.slice(4);
    const directory = path.join(stateDir, "material-staging", stagingId);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stagingPath = path.join(directory, "material" + extension);
    fs.writeFileSync(stagingPath, bytes, { mode: 0o600 });
    const source = { source_id: fixedId || stagingId, source_kind: "teacher_file", source_hash: hash(bytes), evidence_ids: [stagingId] };
    const issuedAt = new Date().toISOString();
    const envelope = buildCommandEnvelope({ contractVersion: "1.1", messageId: "copy-intake-" + sequence,
      requestId: "copy-intake-" + sequence, issuedAt, snapshotId: currentSnapshot(state()).snapshot_id,
      idempotencyKey: "copy-intake-" + sequence, provenance: [{ ...source, source_path: null, observed_at: issuedAt,
        actor: "teacher", parent_ids: [] }], teacherReview: { state: "pending_review", reviewer_id: null,
        reviewed_at: null, note: null, revision: 0 }, command: { command_type: "intake_material", source,
        material: { material_id: materialId, staging_id: stagingId, staging_path: stagingPath, source_path: null,
          source_hash: hash(bytes), expected_size_bytes: bytes.length, kind: "other", title: "合成独立副本",
          subject: null, class_id: null, source_scope: "desktop_staging" } } });
    const received = await intake.applyEducationIntakeCommand({ commandEnvelope: envelope, buildSnapshotForState: currentSnapshot });
    assert.ok(["accepted", "modified"].includes(received.receipt.payload.status));
    return { root_ref: root.dataRootFingerprint, expected_owner_id: ownerId, material_id: materialId,
      expected_source_hash: hash(bytes), expected_metadata_revision: 0 };
  }
  async function adopt(request, commandId) {
    const read = await readMaterialSchedule({ root, authorizationStore, request });
    assert.equal(read.status, "ready");
    assert.deepEqual(read.issues, []);
    return applyMaterialSchedule({ root, authorizationStore, request: { ...request, command_id: commandId,
      expected_parse_fingerprint: read.parse_fingerprint, confirm: true } });
  }
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>2026年10月28日 13:00-14:00 独立副本会议 时区：Asia/Shanghai 地点：会议室</w:t></w:r></w:p></w:body></w:document>');
  const docx = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const ics = Buffer.from("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Synthetic copy//EN\r\nBEGIN:VEVENT\r\nUID:copy-probe\r\nDTSTAMP:20261021T000000Z\r\nDTSTART:20261029T010000Z\r\nDTEND:20261029T020000Z\r\nSUMMARY:独立ICS副本\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n");
  const observations = [];
  for (const [format, bytes, fixedId] of [["docx", docx, null], ["ics", ics, "calendar-evidence-" + hash(ics).slice(7, 39)]]) {
    const first = await receive(bytes, "." + format, fixedId);
    const accepted = await adopt(first, format + "-original-command");
    assert.ok(["accepted", "modified"].includes(accepted.status));
    assert.deepEqual(accepted.rejected_ids, []);
    assert.ok(accepted.applied_ids.length > 0);
    const beforeReplay = JSON.stringify(state());
    const replay = await adopt(first, format + "-original-command");
    assert.equal(replay.replayed, true);
    assert.equal(JSON.stringify(state()), beforeReplay);
    const copy = await receive(bytes, "." + format, fixedId);
    const before = state();
    const copied = await adopt(copy, format + "-independent-copy-command");
    const after = state();
    const eventRows = value => value.calendar_events.filter(event => accepted.applied_ids.includes(event.event_id));
    assert.ok(["accepted", "modified"].includes(copied.status), "a held copy is not a successful adoption");
    assert.deepEqual(copied.rejected_ids, []);
    assert.equal(eventRows(after).length, eventRows(before).length);
    assert.equal(eventRows(after).every(event => event.evidence_ids.includes(copy.material_id)), true,
      "an independent DOCX copy must actually add its own material evidence to the canonical event");
    observations.push({ format, original_status: accepted.status, original_command_replayed: replay.replayed,
      distinct_material: first.material_id !== copy.material_id, copy_status: copied.status, copy_reason: copied.reason_code,
      copy_applied_ids: copied.applied_ids, copy_rejected_ids: copied.rejected_ids,
      same_calendar_rows: JSON.stringify(eventRows(before)) === JSON.stringify(eventRows(after)),
      copy_material_id: copy.material_id,
      canonical_material_evidence: eventRows(after).map(event => ({ event_id: event.event_id,
        source_ids: event.source_ids, evidence_ids: event.evidence_ids })) });
  }
  assert.equal(networkCalls, 0);
  console.log(JSON.stringify({ status: "passed", evidence: "controlled_Core_contract_probe_not_Desktop_E2",
    core_commit: coreHead, observations, network_calls: networkCalls, external_send: false }, null, 2));
} finally {
  await admission?.release();
  globalThis.fetch = originalFetch;
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
