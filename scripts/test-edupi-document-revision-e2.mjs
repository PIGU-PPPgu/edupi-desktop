#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { createJiti } from "jiti";
import { assertFileScheduleUpdateUnavailable, assertMaterialReceiptOnly, createMaterialScheduleTestClient, snapshotScheduleState } from "./material-schedule-e2-client.mjs";

const configuredCoreRoot = process.env.EDUPI_CORE_ROOT;
if (typeof configuredCoreRoot !== "string" || !path.isAbsolute(configuredCoreRoot)) {
  throw new Error("EDUPI_CORE_ROOT must be an absolute Core checkout");
}
const coreRoot = fs.realpathSync(configuredCoreRoot);
const uiFixture = process.env.EDUPI_E2_UI_FIXTURE === "1";
const keepArtifacts = process.env.EDUPI_E2_KEEP === "1" || uiFixture;
const desktopRoot = path.resolve(new URL("..", import.meta.url).pathname);
const compat = JSON.parse(fs.readFileSync(path.join(desktopRoot, "contracts", "edupi-core-compat.json"), "utf8"));
const temporaryRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-document-revision-e2-")));
const dataRoot = path.join(temporaryRoot, "data");
const stateDir = path.join(temporaryRoot, "desktop-state");
const home = path.join(dataRoot, ".edupi");
const desktopToken = "document-revision-canary-token-0123456789012345";
for (const directory of [stateDir, path.join(home, "memory"), path.join(home, "output"), path.join(home, "locks")]) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

const keys = ["EDUPI_PROJECT_ROOT", "EDUPI_DATA_ROOT", "EDUPI_DATA_ALLOWED_ROOT", "EDUPI_CORE_ROOT", "EDUPI_CORE_ALLOWED_ROOT",
  "EDUPI_HOME", "EDUPI_MEMORY_DIR", "EDUPI_OUTPUT_DIR", "EDUPI_LOCK_DIR", "EDUPI_CORE_COMMIT", "PI_DESKTOP_STATE_DIR", "PI_DESKTOP_API_TOKEN"];
const previous = new Map(keys.map((key) => [key, process.env[key]]));
let runtimeSupervisor;
Object.assign(process.env, {
  EDUPI_PROJECT_ROOT: dataRoot,
  EDUPI_DATA_ROOT: dataRoot,
  EDUPI_DATA_ALLOWED_ROOT: temporaryRoot,
  EDUPI_CORE_ROOT: coreRoot,
  EDUPI_CORE_ALLOWED_ROOT: path.dirname(coreRoot),
  EDUPI_HOME: home,
  EDUPI_MEMORY_DIR: path.join(home, "memory"),
  EDUPI_OUTPUT_DIR: path.join(home, "output"),
  EDUPI_LOCK_DIR: path.join(home, "locks"),
  EDUPI_CORE_COMMIT: compat.core_runtime.core_commit,
  PI_DESKTOP_STATE_DIR: stateDir,
  PI_DESKTOP_API_TOKEN: desktopToken,
});

function xml(value) {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

async function docx(text) {
  const zip = new JSZip();
  const options = { date: new Date("2026-01-01T00:00:00.000Z") };
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`, options);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`, options);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${text.split("\n").map((line) => `<w:p><w:r><w:t>${xml(line)}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`, options);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}


try {
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const staging = await jiti.import("../lib/edupi-material-staging.ts");
  const metadata = await jiti.import("../lib/edupi-material-metadata.ts");
  const routes = {
    "/api/edupi/intake": await jiti.import("../app/api/edupi/intake/route.ts"),
    "/api/edupi/education": await jiti.import("../app/api/edupi/education/route.ts"),
    "/api/edupi/document-pairings": await jiti.import("../app/api/edupi/document-pairings/route.ts"),
    "/api/edupi/material-schedule": await jiti.import("../app/api/edupi/material-schedule/route.ts"),
    "/api/edupi/teacher-feedback": await jiti.import("../app/api/edupi/teacher-feedback/route.ts"),
  };
  runtimeSupervisor = await jiti.import("../lib/edupi-runtime-supervisor.ts");
  const call = async (method, pathname, body) => {
    const request = new Request("http://localhost" + pathname, { method,
      headers: { host: "localhost", "x-pi-desktop-token": desktopToken, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const response = await routes[new URL(request.url).pathname][method](request);
    return { response, body: await response.json() };
  };
  const client = createMaterialScheduleTestClient(call);
  const bootstrapped = await call("POST", "/api/edupi/teacher-feedback", { action: "bootstrap" });
  assert.equal(bootstrapped.response.status, 200, JSON.stringify(bootstrapped.body));
  const stage = async (name, text) => staging.stageMaterialInputs([{ name,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: await docx(text) }])[0];
  const receive = (descriptor, extra = {}) => call("POST", "/api/edupi/intake", { kind: "material",
    stagingId: descriptor.staging_id, title: descriptor.original_name, materialKind: "other",
    subject: "行政", classId: "全校", recognize: true, ...extra });
  const education = async () => {
    const result = await call("GET", "/api/edupi/education");
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
    return result.body;
  };

  const noZone = await stage("待核对会议.docx", "2026年10月27日 12:00-13:00 待核对会议 地点：一号会议室");
  const noZoneReceived = await receive(noZone);
  assert.equal(noZoneReceived.response.status, 200, JSON.stringify(noZoneReceived.body));
  assertMaterialReceiptOnly(noZoneReceived.body);
  assert.equal(noZoneReceived.body.materialScheduleProposal?.status, "held");
  const noZoneCurrent = await client.read(noZoneReceived.body.receipt.applied_ids[0]);
  assert.notEqual(noZoneCurrent.status, "ready");
  assert.ok(noZoneCurrent.issues.length > 0);
  assert.equal((await education()).calendar.length, 0, "a missing timezone cannot become a date-only imported event");

  const text = [
    "2026年10月28日 13:00-14:00 路由合同会议 时区：Asia/Shanghai 地点：一号会议室",
    "2026年10月30日 16:00-17:00 来源核对会议 时区：Asia/Shanghai 地点：二号会议室",
  ].join("\n");
  const descriptor = await stage("校内安排.docx", text);
  const received = await receive(descriptor);
  assert.equal(received.response.status, 200, JSON.stringify(received.body));
  assertMaterialReceiptOnly(received.body);
  const materialId = received.body.receipt.applied_ids[0];
  assert.equal(received.body.materialScheduleProposal?.material_id, materialId);
  assert.equal(received.body.materialScheduleProposal.status, "proposed");
  assert.equal(fs.existsSync(descriptor.staging_path), false, "staging is settled only after accepted file receipt");
  assert.equal((await education()).calendar.length, 0);
  let current = await client.read(materialId);
  assert.equal(current.events.length, 2);
  assert.equal(current.source.source_hash, descriptor.source_hash);
  const cancelBefore = snapshotScheduleState(home);
  assert.equal((await client.adopt(materialId, "document-cancelled", async () => false)).status, "cancelled");
  assert.deepEqual(snapshotScheduleState(home), cancelBefore, "cancel does not adopt the proposal");

  const oldProof = { action: "apply", materialId, expectedSourceHash: current.source.source_hash,
    expectedMetadataRevision: current.source.metadata_revision, expectedParseFingerprint: current.parse_fingerprint,
    commandId: "document-old-metadata-proof", confirm: true };
  const updated = await metadata.updateMaterialMetadata({ materialId, expectedRevision: current.source.metadata_revision,
    patch: { title: "校内安排已核对" } });
  assert.equal(updated.revision, current.source.metadata_revision + 1);
  const revisionBefore = snapshotScheduleState(home);
  const stale = await call("POST", "/api/edupi/material-schedule", oldProof);
  assert.equal(stale.response.status, 409, JSON.stringify(stale.body));
  assert.equal(stale.body.errorCode, "material_schedule_stale");
  assert.deepEqual(snapshotScheduleState(home), revisionBefore);
  current = await client.read(materialId);
  assert.equal(current.source.metadata_revision, updated.revision);
  assert.notEqual(current.parse_fingerprint, oldProof.expectedParseFingerprint);
  const adopted = await client.adopt(materialId, "document-confirmed-current-revision", async proposal => {
    assert.equal(proposal.source.source_hash, descriptor.source_hash);
    assert.equal(proposal.source.metadata_revision, updated.revision);
    return true;
  });
  assert.equal(adopted.status, "accepted");
  assert.equal(adopted.applied_ids.length, 2);
  const adoptedState = snapshotScheduleState(home);
  const replay = await client.adopt(materialId, "document-confirmed-current-revision", async () => true);
  assert.equal(replay.replayed, true);
  assert.deepEqual(snapshotScheduleState(home), adoptedState, "same owner command replay cannot rewrite files");
  let read = await education();
  const names = ["路由合同会议", "来源核对会议"];
  const ids = read.calendar.filter(item => names.includes(item.name)).map(item => item.id).sort();
  assert.equal(ids.length, 2);
  const canonical = JSON.parse(fs.readFileSync(path.join(home, "output", "education_intake_state.json"), "utf8"));
  const canonicalEvents = canonical.calendar_events.filter(item => ids.includes(item.event_id));
  assert.equal(canonicalEvents.length, ids.length);
  assert.equal(canonicalEvents.every(item => item.evidence_ids.includes(materialId)), true);

  const revision = await stage("校内安排-修订.docx", text.replace("2026年10月28日", "2026年10月29日"));
  const source = { documentSourceId: "document-source-" + "a".repeat(32), documentSourceFingerprint: "sha256:" + "b".repeat(64) };
  const pairing = { documentPairingFingerprint: "sha256:" + "c".repeat(64),
    documentPairings: [{ incomingVariantRef: "document-occurrence-" + "a".repeat(32) + "-" + "b".repeat(32),
      currentSourceOccurrenceRef: "document-ref-1" }] };
  for (const extra of [source, { ...source, ...pairing }]) {
    const before = snapshotScheduleState(home);
    assertFileScheduleUpdateUnavailable(await receive(revision, extra));
    assert.deepEqual(snapshotScheduleState(home), before, "unsupported source updates and pairings cannot mutate canonical/deletion state");
    assert.equal(fs.existsSync(revision.staging_path), true);
  }
  const pairingBefore = snapshotScheduleState(home);
  assertFileScheduleUpdateUnavailable(await call("POST", "/api/edupi/document-pairings", {
    stagingId: revision.staging_id, sourceId: source.documentSourceId, sourceFingerprint: source.documentSourceFingerprint,
  }));
  assert.deepEqual(snapshotScheduleState(home), pairingBefore);
  assert.equal(fs.existsSync(revision.staging_path), true);
  assert.deepEqual((await education()).calendar.filter(item => names.includes(item.name)).map(item => item.id).sort(), ids);

  await runtimeSupervisor.closeAllEduPiRuntimes();
  const cold = await client.read(materialId);
  assert.equal(cold.source.metadata_revision, updated.revision);
  assert.equal(cold.source.source_hash, descriptor.source_hash);
  assert.deepEqual((await education()).calendar.filter(item => names.includes(item.name)).map(item => item.id).sort(), ids);
  assert.deepEqual(snapshotScheduleState(home), pairingBefore, "cold read must not apply a deferred file revision");

  const tamperDescriptor = await stage("独立字节核对.docx", "2026年11月2日 10:00-11:00 字节核对会议 时区：Asia/Shanghai 地点：三号会议室");
  const tamperReceipt = await receive(tamperDescriptor);
  assert.equal(tamperReceipt.response.status, 200, JSON.stringify(tamperReceipt.body));
  assertMaterialReceiptOnly(tamperReceipt.body);
  const tamperId = tamperReceipt.body.receipt.applied_ids[0];
  const tamperSource = await client.read(tamperId);
  const acceptedFile = path.join(dataRoot, tamperSource.source.relative_path);
  const bytes = fs.readFileSync(acceptedFile);
  fs.writeFileSync(acceptedFile, Buffer.alloc(bytes.length, 0x61));
  const tamperBefore = snapshotScheduleState(home);
  const tampered = await call("GET", "/api/edupi/material-schedule?materialId=" + tamperId);
  assert.equal(tampered.response.status, 409, JSON.stringify(tampered.body));
  assert.equal(tampered.body.errorCode, "material_schedule_source_unavailable");
  assert.deepEqual(snapshotScheduleState(home), tamperBefore, "same-length changed bytes cannot import or delete a schedule");
  console.log(JSON.stringify({ status: uiFixture ? "ui_fixture" : "passed", core_commit: compat.core_runtime.core_commit,
    ...(uiFixture ? { material_id: materialId, staging_id: revision.staging_id } : {}),
    material_receipt_only: true, literal_docx_owner_adoption: true, no_desktop_model_calls: true,
    current_metadata_revision_rechecked: true, stale_confirmation_rejected: true, user_cancel_zero_write: true,
    exact_command_replay_no_write: true, same_length_tamper_rejected: true, cold_readback: true,
    legacy_source_update: { supported: false, rejected_409: true, staged_retained: true },
    multi_item_pairing: { supported: false, rejected_409: true, schedule_writes: 0, delete_writes: 0 },
    external_send: false }));
} finally {
  await runtimeSupervisor?.closeAllEduPiRuntimes();
  if (keepArtifacts) console.log(JSON.stringify({ status: "retained", temporary_root: temporaryRoot, data_root: dataRoot, state_dir: stateDir }));
  else fs.rmSync(temporaryRoot, { recursive: true, force: true });
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
