#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";

const configuredCoreRoot = process.env.EDUPI_CORE_ROOT;
assert.equal(typeof configuredCoreRoot, "string", "EDUPI_CORE_ROOT is required");
assert.equal(path.isAbsolute(configuredCoreRoot), true, "EDUPI_CORE_ROOT must be absolute");
const coreRoot = fs.realpathSync(configuredCoreRoot);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-c6-e2-"));
const dataRoot = path.join(temp, "teacher-data");
const stateDir = path.join(temp, "desktop-state");
fs.mkdirSync(dataRoot, { recursive: true });
fs.mkdirSync(stateDir, { recursive: true });
for (const directory of ["memory", "output", "locks"]) fs.mkdirSync(path.join(dataRoot, ".edupi", directory), { recursive: true });

process.env.EDUPI_CORE_ROOT = coreRoot;
process.env.EDUPI_CORE_ALLOWED_ROOT = path.dirname(coreRoot);
process.env.EDUPI_DATA_ROOT = dataRoot;
process.env.EDUPI_DATA_ALLOWED_ROOT = temp;
process.env.PI_DESKTOP_STATE_DIR = stateDir;

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { POST } = await jiti.import("../app/api/edupi/intake/route.ts");
const { GET } = await jiti.import("../app/api/edupi/education/route.ts");
const staging = await jiti.import("../lib/edupi-material-staging.ts");

function request(body) {
  return new Request("http://localhost/api/edupi/intake", {
    method: "POST",
    headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

async function post(body) {
  const response = await POST(request(body));
  const value = await response.json();
  assert.equal(response.status, 200, JSON.stringify(value));
  return value;
}

try {
  const calendar = await post({
    kind: "calendar",
    events: [
      { eventId: "c6-opening", date: "2026-08-31", endDate: null, name: "开学第一周", type: "teaching", confidence: "teacher_confirmed", notes: "C6 E2" },
      { eventId: "c6-held", date: "日期待确认", endDate: null, name: "运动会", type: "activity", confidence: "inferred", notes: null },
    ],
  });
  assert.equal(calendar.receipt.status, "modified");
  assert.deepEqual(calendar.receipt.applied_ids, ["c6-opening"]);
  assert.deepEqual(calendar.receipt.rejected_ids, ["c6-held"]);

  const timetable = await post({
    kind: "timetable",
    slots: [{ slotId: "c6-monday-math", dayOfWeek: 1, period: 1, subject: "数学", className: "七年级二班", kind: "class", notes: null }],
  });
  assert.equal(timetable.receipt.status, "accepted");

  const pdf = Buffer.from("%PDF-1.4\nEduPi C6 E2\n%%EOF\n", "utf8");
  const [descriptor] = staging.stageMaterialInputs([{ name: "lesson.pdf", mimeType: "application/pdf", bytes: pdf }]);
  assert.equal(staging.listStagedMaterials().length, 1);
  const material = await post({
    kind: "material",
    stagingId: descriptor.staging_id,
    title: "七年级数学教案",
    materialKind: "lesson_note",
    subject: "数学",
    classId: "class-7-2",
    recognize: false,
  });
  assert.equal(material.receipt.status, "accepted");
  assert.deepEqual(material.staged, []);
  assert.deepEqual(staging.listStagedMaterials(), []);

  const educationResponse = await GET();
  const education = await educationResponse.json();
  assert.equal(educationResponse.status, 200, JSON.stringify(education));
  assert.equal(education.calendar.some((event) => event.id === "c6-opening" && event.name === "开学第一周"), true);
  const heldEvent = education.calendar.find((event) => event.id === "c6-held");
  assert.ok(heldEvent, "the ambiguous calendar fact must remain visible for teacher confirmation");
  assert.equal(heldEvent.date, null);
  assert.equal(heldEvent.dateStatus, "invalid");
  assert.equal(heldEvent.preparationStatus, "hold");
  assert.match(heldEvent.notes, /日期待确认/);
  assert.equal(education.timetable.some((slot) => slot.slot_id === "c6-monday-math"), true);
  assert.equal(education.intakeReceipts.length, 3);
  assert.deepEqual(education.intakeReceipts.map((receipt) => receipt.commandType), ["import_calendar", "import_timetable", "intake_material"]);

  const materialId = `material-${descriptor.staging_id.slice("stg_".length)}`;
  const acceptedPath = path.join(dataRoot, ".edupi", "inbox", "teacher-materials", `${materialId}.pdf`);
  assert.deepEqual(fs.readFileSync(acceptedPath), pdf);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataRoot, ".edupi", "memory", "calendar.json"), "utf8")).events.length, 2);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataRoot, ".edupi", "memory", "timetable.json"), "utf8")).slots.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataRoot, ".edupi", "output", "material_candidates.json"), "utf8")).entries.length, 1);

  console.log(JSON.stringify({
    status: "passed",
    calendar_events: education.calendar.length,
    timetable_slots: education.timetable.length,
    intake_receipts: education.intakeReceipts.length,
    staging_after_receipt: 0,
    core_commit: education.coreCommit || "pinned",
  }, null, 2));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
