#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";
import { assertFileScheduleUpdateUnavailable, assertMaterialReceiptOnly, snapshotScheduleState } from "./material-schedule-e2-client.mjs";

const coreRoot = process.env.EDUPI_CORE_ROOT;
if (!coreRoot || !path.isAbsolute(coreRoot)) throw new Error("EDUPI_CORE_ROOT must be an absolute Core checkout");
const desktopRoot = path.resolve(new URL("..", import.meta.url).pathname);
const compat = JSON.parse(fs.readFileSync(path.join(desktopRoot, "contracts/edupi-core-compat.json"), "utf8"));
const temporaryRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-slot-alias-e2-")));
const dataRoot = path.join(temporaryRoot, "data");
const home = path.join(dataRoot, ".edupi");
const stateDir = path.join(temporaryRoot, "desktop-state");
for (const directory of [stateDir, path.join(home, "memory"), path.join(home, "output"), path.join(home, "locks")]) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

const keys = ["EDUPI_PROJECT_ROOT", "EDUPI_DATA_ROOT", "EDUPI_DATA_ALLOWED_ROOT", "EDUPI_CORE_ROOT", "EDUPI_CORE_ALLOWED_ROOT",
  "EDUPI_HOME", "EDUPI_MEMORY_DIR", "EDUPI_OUTPUT_DIR", "EDUPI_LOCK_DIR", "EDUPI_CORE_COMMIT", "PI_DESKTOP_STATE_DIR"];
const previous = new Map(keys.map((key) => [key, process.env[key]]));
let supervisor;
Object.assign(process.env, {
  EDUPI_PROJECT_ROOT: dataRoot,
  EDUPI_DATA_ROOT: dataRoot,
  EDUPI_DATA_ALLOWED_ROOT: temporaryRoot,
  EDUPI_CORE_ROOT: fs.realpathSync(coreRoot),
  EDUPI_CORE_ALLOWED_ROOT: path.dirname(fs.realpathSync(coreRoot)),
  EDUPI_HOME: home,
  EDUPI_MEMORY_DIR: path.join(home, "memory"),
  EDUPI_OUTPUT_DIR: path.join(home, "output"),
  EDUPI_LOCK_DIR: path.join(home, "locks"),
  EDUPI_CORE_COMMIT: compat.core_runtime.core_commit,
  PI_DESKTOP_STATE_DIR: stateDir,
});


try {
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const { stageMaterialInputs } = await jiti.import("../lib/edupi-material-staging.ts");
  const intake = await jiti.import("../lib/edupi-education-intake.ts");
  const { intakeRecognizedMaterial } = await jiti.import("../lib/edupi-material-intake-flow.ts");
  const intakeRoute = await jiti.import("../app/api/edupi/intake/route.ts");
  const snapshot = await jiti.import("../lib/edupi-core-snapshot.ts");
  supervisor = await jiti.import("../lib/edupi-runtime-supervisor.ts");
  const stage = (name, marker) => stageMaterialInputs([{ name, mimeType: "application/pdf",
    bytes: Buffer.from("%PDF-1.4\n" + marker + "\n%%EOF\n", "utf8") }])[0];
  const receive = async (descriptor, extra = {}) => {
    const response = await intakeRoute.POST(new Request("http://localhost/api/edupi/intake", { method: "POST",
      headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ kind: "material", stagingId: descriptor.staging_id, title: descriptor.original_name,
        materialKind: "other", subject: "数学", classId: "七年级二班", recognize: true, ...extra }),
    }));
    return { response, body: await response.json() };
  };
  const first = stage("旧版课表.pdf", "synthetic unverified timetable source");
  const received = await receive(first);
  assert.equal(received.response.status, 200, JSON.stringify(received.body));
  assertMaterialReceiptOnly(received.body);
  const before = snapshotScheduleState(home);
  await assert.rejects(intake.issueEducationIntake({ command_type: "import_timetable", source: {
    source_id: "document-source-" + "a".repeat(32), source_kind: "teacher_file", source_hash: first.source_hash,
    evidence_ids: [first.staging_id, received.body.receipt.applied_ids[0]],
  }, slots: [{ slot_id: "unverified-file-slot", day_of_week: 1, period: 2, subject: "数学",
    class_name: "七年级二班", kind: "class", notes: null }] }), error => error?.code === "file_schedule_unverified");
  assert.deepEqual(snapshotScheduleState(home), before, "file slots do not have an owner apply contract");

  const revision = stage("修订课表.pdf", "second unverified timetable source");
  const alias = "document-source-" + "a".repeat(32);
  const beforeUpdate = snapshotScheduleState(home);
  assertFileScheduleUpdateUnavailable(await receive(revision, { documentSourceId: alias,
    documentSourceFingerprint: "sha256:" + "b".repeat(64) }));
  await assert.rejects(intakeRecognizedMaterial({ descriptor: revision, scheduleSourceId: alias,
    materialKind: "other", subject: "数学", classId: "七年级二班" }),
  error => error?.code === "file_schedule_update_unavailable");
  assert.equal(fs.existsSync(revision.staging_path), true);
  assert.deepEqual(snapshotScheduleState(home), beforeUpdate);

  let read = await snapshot.readEduPiEducationSnapshot({ requestId: "file-slot-readonly" });
  assert.equal(read.payload.education_workspace.timetable.length, 0);
  assert.equal(read.payload.education_workspace.calendar.length, 0);
  await supervisor.closeAllEduPiRuntimes();
  read = await snapshot.readEduPiEducationSnapshot({ requestId: "file-slot-cold-read" });
  assert.equal(read.payload.education_workspace.timetable.length, 0);
  assert.equal(read.payload.education_workspace.calendar.length, 0);
  console.log(JSON.stringify({ status: "passed", core_commit: compat.core_runtime.core_commit,
    file_material_receipt_only: true, cold_read_zero_schedule: true,
    file_timetable: { supported: false, generic_import_rejected: true, canonical_slots: 0 },
    file_slot_alias_update: { supported: false, rejected_409: true, staged_retained: true, schedule_writes: 0, delete_writes: 0 },
    external_send: false, artifacts: process.env.EDUPI_E2_KEEP === "1" ? temporaryRoot : null }));
} finally {
  await supervisor?.closeAllEduPiRuntimes();
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (process.env.EDUPI_E2_KEEP !== "1") fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
