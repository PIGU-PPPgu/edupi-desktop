#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createJiti } from "jiti";
import { imageOnlyPdfFromJpeg } from "./image-pdf-fixture.mjs";
import { assertMaterialReceiptOnly, snapshotScheduleState } from "./material-schedule-e2-client.mjs";

const configuredCoreRoot = process.env.EDUPI_CORE_ROOT;
if (!configuredCoreRoot || !path.isAbsolute(configuredCoreRoot)) throw new Error("EDUPI_CORE_ROOT must be an absolute Core checkout");
const coreRoot = fs.realpathSync(configuredCoreRoot);
const root = path.resolve(new URL("..", import.meta.url).pathname);
const compat = JSON.parse(fs.readFileSync(path.join(root, "contracts", "edupi-core-compat.json"), "utf8"));
const temporaryRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-ocr-schedule-e2-")));
const dataRoot = path.join(temporaryRoot, "data");
const stateDir = path.join(temporaryRoot, "desktop-state");
const home = path.join(dataRoot, ".edupi");
for (const directory of [stateDir, path.join(home, "memory"), path.join(home, "output"), path.join(home, "locks")]) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

const keys = ["EDUPI_PROJECT_ROOT", "EDUPI_DATA_ROOT", "EDUPI_DATA_ALLOWED_ROOT", "EDUPI_CORE_ROOT", "EDUPI_CORE_ALLOWED_ROOT",
  "EDUPI_HOME", "EDUPI_MEMORY_DIR", "EDUPI_OUTPUT_DIR", "EDUPI_LOCK_DIR", "EDUPI_CORE_COMMIT", "PI_DESKTOP_STATE_DIR", "PI_DESKTOP_API_TOKEN"];
const previous = new Map(keys.map(key => [key, process.env[key]]));
const token = "synthetic-ocr-readonly-intake-token-012345678901";
let supervisor;
Object.assign(process.env, {
  EDUPI_PROJECT_ROOT: dataRoot, EDUPI_DATA_ROOT: dataRoot, EDUPI_DATA_ALLOWED_ROOT: temporaryRoot,
  EDUPI_CORE_ROOT: coreRoot, EDUPI_CORE_ALLOWED_ROOT: path.dirname(coreRoot),
  EDUPI_HOME: home, EDUPI_MEMORY_DIR: path.join(home, "memory"), EDUPI_OUTPUT_DIR: path.join(home, "output"),
  EDUPI_LOCK_DIR: path.join(home, "locks"), EDUPI_CORE_COMMIT: compat.core_runtime.core_commit,
  PI_DESKTOP_STATE_DIR: stateDir, PI_DESKTOP_API_TOKEN: token,
});

function printedNotice(name, date, width, height) {
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="60" y="210" fill="black" font-family="Arial,sans-serif" font-size="70">${name} ${date}</text></svg>`;
}


try {
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const staging = await jiti.import("../lib/edupi-material-staging.ts");
  const intake = await jiti.import("../lib/edupi-education-intake.ts");
  const intakeRoute = await jiti.import("../app/api/edupi/intake/route.ts");
  const snapshot = await jiti.import("../lib/edupi-core-snapshot.ts");
  supervisor = await jiti.import("../lib/edupi-runtime-supervisor.ts");
  const png = await sharp(Buffer.from(printedNotice("MEETING", "2026-09-24", 1600, 400))).png().toBuffer();
  const jpeg = await sharp(Buffer.from(printedNotice("EXAM", "2026-09-25", 800, 1200))).jpeg().toBuffer();
  const pdf = imageOnlyPdfFromJpeg(jpeg, 800, 1200);
  const descriptors = staging.stageMaterialInputs([
    { name: "meeting.png", mimeType: "image/png", bytes: png },
    { name: "exam.pdf", mimeType: "application/pdf", bytes: pdf },
  ]);
  for (const [index, descriptor] of descriptors.entries()) {
    const response = await intakeRoute.POST(new Request("http://localhost/api/edupi/intake", {
      method: "POST", headers: { host: "localhost", "content-type": "application/json", "x-pi-desktop-token": token },
      body: JSON.stringify({ kind: "material", stagingId: descriptor.staging_id, title: descriptor.original_name,
        materialKind: "other", subject: null, classId: null, recognize: true }),
    }));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assertMaterialReceiptOnly(body);
    assert.equal(descriptor.source_hash, "sha256:" + createHash("sha256").update(index === 0 ? png : pdf).digest("hex"));
    const before = snapshotScheduleState(home);
    await assert.rejects(intake.issueEducationIntake({ command_type: "import_calendar",
      source: { source_id: descriptor.staging_id, source_kind: "teacher_file", source_hash: descriptor.source_hash,
        evidence_ids: [descriptor.staging_id, body.receipt.applied_ids[0]] },
      events: [{ event_id: "legacy-ocr-event-" + index, date: index === 0 ? "2026-09-24" : "2026-09-25",
        end_date: null, name: index === 0 ? "MEETING" : "EXAM", type: "meeting", confidence: "inferred",
        notes: "合成 OCR 候选，不是 Core 文件重读证明" }],
    }), error => error?.code === "file_schedule_unverified");
    assert.deepEqual(snapshotScheduleState(home), before, "an OCR/model candidate is not file writer proof");
  }
  let read = await snapshot.readEduPiEducationSnapshot({ requestId: "ocr-schedule-readonly", scheduleOccurrenceVersion: "1.2" });
  assert.equal(read.occurrenceProjection.events.length, 0);
  assert.equal(read.payload.education_workspace.timetable.length, 0);
  await supervisor.closeAllEduPiRuntimes();
  read = await snapshot.readEduPiEducationSnapshot({ requestId: "ocr-schedule-cold-read", scheduleOccurrenceVersion: "1.2" });
  assert.equal(read.occurrenceProjection.events.length, 0);
  assert.equal(read.payload.education_workspace.timetable.length, 0);
  console.log(JSON.stringify({ status: "passed", core_commit: compat.core_runtime.core_commit,
    scanned_image_material_received: true, scanned_pdf_material_received: true, cold_read_zero_schedule: true,
    ocr_execution: "not_run_read_only_gate", external_model_calls: 0,
    ocr_schedule_adoption: { supported: false, generic_file_write_rejected: true, imported_events: 0, imported_slots: 0 },
    external_send: false }));
} finally {
  await supervisor?.closeAllEduPiRuntimes();
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
