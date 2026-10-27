#!/usr/bin/env node
// Real Desktop routes and Core owner; only synthetic data in a new retained root.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { createJiti } from "jiti";
import { assertMaterialReceiptOnly, createMaterialScheduleTestClient, snapshotScheduleState } from "./material-schedule-e2-client.mjs";

if (process.platform !== "darwin" || parseInt(os.release(), 10) < 22) {
  console.log(JSON.stringify({ status: "skipped", reason: "supported_macos_required", evidence: "not_run" }));
  process.exit(0);
}
assert.ok(process.env.EDUPI_CORE_ROOT && path.isAbsolute(process.env.EDUPI_CORE_ROOT), "EDUPI_CORE_ROOT is required");
const coreRoot = fs.realpathSync(process.env.EDUPI_CORE_ROOT);
const desktopRoot = path.resolve(new URL("..", import.meta.url).pathname);
const compat = JSON.parse(fs.readFileSync(path.join(desktopRoot, "contracts/edupi-core-compat.json"), "utf8"));
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-visible-material-source-e2-")));
const dataRoot = path.join(root, "data"), home = path.join(dataRoot, ".edupi"), stateDir = path.join(root, "desktop-state");
for (const directory of [stateDir, path.join(home, "memory"), path.join(home, "output"), path.join(home, "locks"), path.join(root, "sources")]) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}
const environment = { EDUPI_PROJECT_ROOT: dataRoot, EDUPI_DATA_ROOT: dataRoot, EDUPI_DATA_ALLOWED_ROOT: root,
  EDUPI_CORE_ROOT: coreRoot, EDUPI_CORE_ALLOWED_ROOT: path.dirname(coreRoot), EDUPI_HOME: home,
  EDUPI_MEMORY_DIR: path.join(home, "memory"), EDUPI_OUTPUT_DIR: path.join(home, "output"), EDUPI_LOCK_DIR: path.join(home, "locks"),
  EDUPI_CORE_COMMIT: compat.core_runtime.core_commit, PI_DESKTOP_STATE_DIR: stateDir,
  PI_DESKTOP_API_TOKEN: "synthetic-visible-material-source-token-0123456789" };
const previous = new Map(Object.keys(environment).map(key => [key, process.env[key]]));
Object.assign(process.env, environment);
const evidence = { status: "running", synthetic_only: true, core_commit: compat.core_runtime.core_commit,
  source: "Desktop API routes with the actual managed Core owner", checks: [], cases: [], wire: [], external_model_calls: 0, external_send: false };
const evidenceFile = path.join(root, "evidence.json");
const save = () => fs.writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2) + "\n", { mode: 0o600 });
save();
console.log(JSON.stringify({ phase: "isolated_root", root, evidence: evidenceFile, cleanup: "retained" }));
let supervisor;
try {
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const staging = await jiti.import("../lib/edupi-material-staging.ts");
  const intake = await jiti.import("../lib/edupi-education-intake.ts");
  const snapshot = await jiti.import("../lib/edupi-core-snapshot.ts");
  const intakeRoute = await jiti.import("../app/api/edupi/intake/route.ts");
  const scheduleRoute = await jiti.import("../app/api/edupi/material-schedule/route.ts");
  const sourceRoute = await jiti.import("../app/api/edupi/material-excerpt/source/route.ts");
  const excerptRoute = await jiti.import("../app/api/edupi/material-excerpt/route.ts");
  const metadataRoute = await jiti.import("../app/api/edupi/materials/[materialId]/metadata/route.ts");
  const feedbackRoute = await jiti.import("../app/api/edupi/teacher-feedback/route.ts");
  supervisor = await jiti.import("../lib/edupi-runtime-supervisor.ts");
  const { makePdfFixture } = await import(pathToFileURL(path.join(coreRoot, "scripts/test_material_pdf_fixture.mjs")).href);
  const request = (pathname, method = "GET", body) => new Request("http://localhost" + pathname, { method,
    headers: { host: "localhost", origin: "http://localhost", "x-pi-desktop-token": environment.PI_DESKTOP_API_TOKEN,
      ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const call = async (route, pathname, method = "GET", body, params) => {
    const response = await route[method](request(pathname, method, body), params);
    const result = await response.json();
    evidence.wire.push({ pathname, method, ...(body === undefined ? {} : { request: body }), status: response.status, response: result });
    save(); return { response, body: result };
  };
  const bootstrap = await call(feedbackRoute, "/api/edupi/teacher-feedback", "POST", { action: "bootstrap" });
  assert.equal(bootstrap.response.status, 200, JSON.stringify(bootstrap.body));
  const client = createMaterialScheduleTestClient((method, pathname, body) => call(scheduleRoute, pathname, method, body));
  const projection = () => snapshot.readEduPiEducationSnapshot({ requestId: crypto.randomUUID(), scheduleOccurrenceVersion: "1.2" });
  const excerptState = () => {
    const file = path.join(home, "output/g1_confirmed_excerpts.json");
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  };
  const text = "2026年10月09日 七年级会议";
  const image = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="360"><rect width="1600" height="360" fill="white"/><text x="60" y="220" font-family="PingFang SC,Arial,sans-serif" font-size="70" fill="black">${text}</text></svg>`);
  const inputs = [
    ["pdf", makePdfFixture({ pages: [[{ text, unicode: true }]] }), "application/pdf"],
    ["png", await sharp(image).png().toBuffer(), "image/png"],
    ["jpeg", await sharp(image).jpeg({ quality: 95 }).toBuffer(), "image/jpeg"],
  ];
  let expectedEventId;
  for (const [format, bytes, mimeType] of inputs) {
    fs.writeFileSync(path.join(root, "sources", `synthetic.${format}`), bytes, { mode: 0o600 });
    const stage = name => staging.stageMaterialInputs([{ name, mimeType, bytes }])[0];
    const receive = async descriptor => {
      const before = await projection();
      const result = await call(intakeRoute, "/api/edupi/intake", "POST", { kind: "material", stagingId: descriptor.staging_id,
        title: descriptor.original_name, materialKind: "lesson_note", subject: "数学", classId: "703" });
      assert.equal(result.response.status, 200, JSON.stringify(result.body)); assertMaterialReceiptOnly(result.body);
      assert.deepEqual((await projection()).occurrenceProjection.events.map(item => item.event_id).sort(),
        before.occurrenceProjection.events.map(item => item.event_id).sort(), "file receipt must not adopt an arrangement");
      return result.body;
    };
    const descriptor = stage(`可见来源.${format}`), received = await receive(descriptor), materialId = received.receipt.applied_ids[0];
    assert.equal(received.materialScheduleProposal.status, "proposed", JSON.stringify(received.materialScheduleProposal));
    const beforeRead = snapshotScheduleState(home), read = await client.read(materialId);
    assert.deepEqual(snapshotScheduleState(home), beforeRead); assert.equal(read.status, "ready");
    assert.equal(read.source_review_required, format === "pdf" ? undefined : "image_text");
    assert.equal(read.source.source_hash, descriptor.source_hash);
    const beforeCancel = snapshotScheduleState(home);
    const cancel = await client.adopt(materialId, `cancel-${format}`, async () => false, async () => true);
    assert.equal(cancel.status, "cancelled"); assert.deepEqual(snapshotScheduleState(home), beforeCancel);
    const proof = { action: "apply", materialId, expectedSourceHash: read.source.source_hash,
      expectedMetadataRevision: read.source.metadata_revision, expectedParseFingerprint: read.parse_fingerprint,
      commandId: `adopt-${format}`, confirm: true, ...(format === "pdf" ? {} : { confirmSourceText: true }) };
    if (format !== "pdf") {
      const missingTextReview = { ...proof }; delete missingTextReview.confirmSourceText;
      const denied = await call(scheduleRoute, "/api/edupi/material-schedule", "POST", missingTextReview);
      assert.equal(denied.response.status, 409); assert.deepEqual(snapshotScheduleState(home), beforeCancel);
    }
    const forged = await call(scheduleRoute, "/api/edupi/material-schedule", "POST", { ...proof, verified: true });
    assert.equal(forged.response.status, 400); assert.deepEqual(snapshotScheduleState(home), beforeCancel);
    const applied = await call(scheduleRoute, "/api/edupi/material-schedule", "POST", proof);
    assert.equal(applied.response.status, 200, JSON.stringify(applied.body));
    assert.ok(["accepted", "modified"].includes(applied.body.result.status), JSON.stringify(applied.body));
    let canonical = JSON.parse(fs.readFileSync(path.join(home, "output/education_intake_state.json"), "utf8"));
    const event = canonical.calendar_events.find(item => item.evidence_ids.includes(materialId));
    assert.ok(event); expectedEventId ??= event.event_id; assert.equal(event.event_id, expectedEventId);
    const adoptedState = snapshotScheduleState(home);
    const replay = await call(scheduleRoute, "/api/edupi/material-schedule", "POST", proof);
    assert.equal(replay.response.status, 200); assert.equal(replay.body.result.replayed, true);
    assert.deepEqual(snapshotScheduleState(home), adoptedState);
    const copy = await receive(stage(`同字节副本.${format}`));
    const copyId = copy.receipt.applied_ids[0];
    const duplicated = await client.adopt(copyId, `adopt-copy-${format}`, async () => true, async () => true);
    assert.ok(["accepted", "modified"].includes(duplicated.status));
    canonical = JSON.parse(fs.readFileSync(path.join(home, "output/education_intake_state.json"), "utf8"));
    assert.equal(canonical.calendar_events.length, 1, "identical schedule content must remain one canonical event");
    assert.ok(canonical.calendar_events[0].evidence_ids.includes(copyId));

    const sourcePath = `/api/edupi/material-excerpt/source?materialId=${encodeURIComponent(materialId)}`;
    const previewResult = await call(sourceRoute, sourcePath);
    assert.equal(previewResult.response.status, 200, JSON.stringify(previewResult.body));
    const preview = previewResult.body.preview;
    assert.equal(preview.status, "ready"); assert.equal(preview.format, format === "pdf" ? "pdf" : "image");
    assert.equal(preview.blocks.map(block => block.text).join("").replace(/\s+/gu, ""), text.replace(/\s+/gu, ""),
      "the synthetic visible text must match the source input before the fixture confirms it");
    assert.equal(preview.source_review_required, format === "pdf" ? undefined : "image_text");
    assert.ok(preview.blocks.every(block => block.page === 1 && block.region.width > 0 && block.region.height > 0));
    const review = { materialId, expectedRevision: 0, expectedBasisHash: preview.basis_hash,
      sourceSpans: preview.blocks.map(block => ({ path: block.path, start: 0, end: block.text.length })),
      ...(format === "pdf" ? {} : { confirmSourceText: true }) };
    if (format !== "pdf") {
      const before = excerptState(), missingTextReview = { ...review }; delete missingTextReview.confirmSourceText;
      const denied = await call(sourceRoute, "/api/edupi/material-excerpt/source", "POST", missingTextReview);
      assert.equal(denied.response.status, 400); assert.equal(excerptState(), before);
    }
    const confirmed = await call(sourceRoute, "/api/edupi/material-excerpt/source", "POST", review);
    assert.equal(confirmed.response.status, 200, JSON.stringify(confirmed.body));
    assert.equal(confirmed.body.excerpt.source_kind, format === "pdf" ? "pdf_visible_fragment" : "image_reviewed_fragment");
    const readExcerpt = await call(excerptRoute, `/api/edupi/material-excerpt?materialId=${encodeURIComponent(materialId)}`);
    assert.equal(readExcerpt.response.status, 200); assert.deepEqual(readExcerpt.body.excerpt, confirmed.body.excerpt);
    await supervisor.closeAllEduPiRuntimes();
    const cold = await client.read(materialId), coldSource = await call(sourceRoute, sourcePath);
    assert.equal(cold.parse_fingerprint, read.parse_fingerprint); assert.equal(coldSource.response.status, 200);
    const coldExcerpt = await call(excerptRoute, `/api/edupi/material-excerpt?materialId=${encodeURIComponent(materialId)}`);
    assert.deepEqual(coldExcerpt.body.excerpt, confirmed.body.excerpt);
    assert.equal((await projection()).occurrenceProjection.events.filter(item => item.event_id === expectedEventId).length, 1);

    const metadata = await call(metadataRoute, `/api/edupi/materials/${materialId}/metadata`, "PUT",
      { expectedRevision: 0, patch: { title: `已修订的可见材料 ${format}` } }, { params: Promise.resolve({ materialId }) });
    assert.equal(metadata.response.status, 200, JSON.stringify(metadata.body));
    const beforeStale = snapshotScheduleState(home), beforeExcerpt = excerptState();
    assert.equal((await call(scheduleRoute, "/api/edupi/material-schedule", "POST", proof)).response.status, 409);
    assert.equal((await call(sourceRoute, "/api/edupi/material-excerpt/source", "POST", { ...review, expectedRevision: 1 })).response.status, 409);
    assert.deepEqual(snapshotScheduleState(home), beforeStale); assert.equal(excerptState(), beforeExcerpt);
    const material = canonical.materials.find(item => item.material_id === materialId), canonicalPath = path.join(dataRoot, material.relative_path);
    const original = fs.readFileSync(canonicalPath), changed = Buffer.from(original); changed[changed.length - 1] ^= 1;
    try {
      fs.writeFileSync(canonicalPath, changed);
      assert.notEqual((await call(scheduleRoute, `/api/edupi/material-schedule?materialId=${encodeURIComponent(materialId)}`)).response.status, 200);
      assert.notEqual((await call(sourceRoute, sourcePath)).response.status, 200);
      assert.deepEqual(snapshotScheduleState(home), beforeStale); assert.equal(excerptState(), beforeExcerpt);
    } finally { fs.writeFileSync(canonicalPath, original); }
    await assert.rejects(intake.issueEducationIntake({ command_type: "import_calendar",
      source: { source_id: descriptor.staging_id, source_kind: "teacher_file", source_hash: descriptor.source_hash,
        evidence_ids: [descriptor.staging_id, materialId] }, events: read.events }), { code: "file_schedule_unverified" });
    assert.deepEqual(snapshotScheduleState(home), beforeStale);
    evidence.cases.push({ format, material_id: materialId, source_hash: descriptor.source_hash, event_id: expectedEventId,
      source_kind: confirmed.body.excerpt.source_kind, current_read: true, text_review_required: format !== "pdf",
      explicit_adopt: true, cancel_zero_write: true, duplicate_unique_event: true, fragment_readback: true,
      restart_readback: true, old_metadata_and_changed_bytes_rejected: true, generic_file_write_rejected: true });
    save(); console.log(JSON.stringify({ phase: "format_passed", format, material_id: materialId }));
  }
  const heldBytes = makePdfFixture({ pages: Array.from({ length: 4 }, () => [{ text, unicode: true }]) });
  fs.writeFileSync(path.join(root, "sources/over-limit.pdf"), heldBytes, { mode: 0o600 });
  const heldStage = staging.stageMaterialInputs([{ name: "超出页数.pdf", mimeType: "application/pdf", bytes: heldBytes }])[0];
  const heldReceipt = await call(intakeRoute, "/api/edupi/intake", "POST", { kind: "material", stagingId: heldStage.staging_id,
    title: heldStage.original_name, materialKind: "lesson_note", subject: "数学", classId: "703" });
  assert.equal(heldReceipt.response.status, 200); assertMaterialReceiptOnly(heldReceipt.body);
  const heldId = heldReceipt.body.receipt.applied_ids[0], heldRead = await client.read(heldId);
  assert.equal(heldRead.status, "unresolved"); assert.ok(heldRead.issues.length > 0);
  const heldSource = await call(sourceRoute, `/api/edupi/material-excerpt/source?materialId=${encodeURIComponent(heldId)}`);
  assert.equal(heldSource.response.status, 200); assert.equal(heldSource.body.preview.status, "held");
  assert.ok(heldSource.body.preview.issues.some(issue => issue.code === "pdf_native_page_limit"));
  const beforeHeld = snapshotScheduleState(home), beforeHeldExcerpt = excerptState();
  const refused = await call(scheduleRoute, "/api/edupi/material-schedule", "POST", { action: "apply", materialId: heldId,
    expectedSourceHash: heldRead.source.source_hash, expectedMetadataRevision: heldRead.source.metadata_revision,
    expectedParseFingerprint: heldRead.parse_fingerprint, commandId: "held-pdf-adoption", confirm: true });
  assert.equal(refused.response.status, 409);
  assert.deepEqual(snapshotScheduleState(home), beforeHeld); assert.equal(excerptState(), beforeHeldExcerpt);
  evidence.status = "passed"; evidence.checks.push("upload_read_confirm_apply", "source_preview_review_read", "duplicate_and_restart", "stale_source_zero_write", "over_limit_pdf_held_with_core_reason");
} catch (error) {
  evidence.status = "failed"; evidence.failure = { code: error.code || error.name, message: error.message };
  throw error;
} finally {
  try { await supervisor?.closeAllEduPiRuntimes(); } finally {
    save();
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    console.log(JSON.stringify({ status: evidence.status, core_commit: evidence.core_commit, root, evidence: evidenceFile,
      cases: evidence.cases.length, process_stopped: true, cleanup: "retained", external_send: false }));
  }
}
