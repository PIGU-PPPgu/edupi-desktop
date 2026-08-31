#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createJiti } from "jiti";

const configuredCoreRoot = process.env.EDUPI_CORE_ROOT;
assert.equal(typeof configuredCoreRoot, "string", "EDUPI_CORE_ROOT is required");
assert.equal(path.isAbsolute(configuredCoreRoot), true, "EDUPI_CORE_ROOT must be absolute");
const coreRoot = fs.realpathSync(configuredCoreRoot);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-c6-recognition-e2-"));
const dataRoot = path.join(temp, "teacher-data");
const stateDir = path.join(temp, "desktop-state");
for (const directory of [stateDir, path.join(dataRoot, ".edupi", "memory"), path.join(dataRoot, ".edupi", "output"), path.join(dataRoot, ".edupi", "locks")]) fs.mkdirSync(directory, { recursive: true });

process.env.EDUPI_CORE_ROOT = coreRoot;
process.env.EDUPI_CORE_ALLOWED_ROOT = path.dirname(coreRoot);
process.env.EDUPI_DATA_ROOT = dataRoot;
process.env.EDUPI_DATA_ALLOWED_ROOT = temp;
process.env.PI_DESKTOP_STATE_DIR = stateDir;

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const staging = await jiti.import("../lib/edupi-material-staging.ts");
const { POST } = await jiti.import("../app/api/edupi/intake/route.ts");
const { GET } = await jiti.import("../app/api/edupi/education/route.ts");

function unavailableDiagnostic(error) {
  const message = typeof error?.error === "string" ? error.error : "";
  const category = typeof error?.diagnosticCategory === "string"
    ? error.diagnosticCategory
    : message.match(/诊断：([a-z_]+)/)?.[1];
  const model = message.match(/模型：([A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,255})/)?.[1];
  return {
    category: category && /^[a-z_]+$/.test(category) ? category : "model_unavailable",
    ...(model ? { model } : {}),
  };
}

try {
  const sourceText = path.join(temp, "第一学期安排.txt");
  const sourceDocx = path.join(temp, "第一学期安排.docx");
  fs.writeFileSync(sourceText, [
    "2026年9月1日开学。",
    "2026年9月25日中秋主题活动。",
    "十月下旬举行秋季运动会，具体日期待学校通知。",
    "每周一第1节，七年级二班数学课。",
  ].join("\n"), "utf8");
  execFileSync("/usr/bin/textutil", ["-convert", "docx", "-output", sourceDocx, sourceText]);
  const [descriptor] = staging.stageMaterialInputs([{
    name: "第一学期安排.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    bytes: new Uint8Array(fs.readFileSync(sourceDocx)),
  }]);

  const intakeResponse = await POST(new Request("http://localhost/api/edupi/intake", {
    method: "POST",
    headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ kind: "material", stagingId: descriptor.staging_id, title: descriptor.original_name, materialKind: "other", subject: "数学", classId: "class-7-2", recognize: true }),
  }));
  const result = await intakeResponse.json();
  if (result?.code === "model_unavailable") {
    assert.equal(intakeResponse.status, 503, JSON.stringify(result));
    console.log(JSON.stringify({ status: "unavailable", code: result.code, ...unavailableDiagnostic(result) }, null, 2));
  } else {
    assert.equal(intakeResponse.status, 200, JSON.stringify(result));
    assert.equal(result.recognition.eventCount, 3, JSON.stringify(result.recognition));
    assert.equal(result.recognition.slotCount, 1, JSON.stringify(result.recognition));
    assert.deepEqual(result.receipts.map((receipt) => receipt.command_type), ["intake_material", "import_calendar", "import_timetable"]);
    assert.deepEqual(result.receipts.map((receipt) => receipt.status), ["accepted", "modified", "accepted"]);

    const response = await GET();
    const education = await response.json();
    assert.equal(response.status, 200, JSON.stringify(education));
    const opening = education.calendar.find((event) => event.date === "2026-09-01" && event.name.includes("开学"));
    const festival = education.calendar.find((event) => event.date === "2026-09-25");
    const held = education.calendar.find((event) => event.name.includes("运动会"));
    assert.ok(opening);
    assert.ok(festival);
    for (const event of [opening, festival]) {
      assert.equal(event.confidence, "inferred");
      assert.equal(event.preparationStatus, "hold");
    }
    assert.ok(held, "ambiguous recognized facts must remain visible instead of being dropped");
    assert.equal(held.date, null);
    assert.equal(held.dateStatus, "invalid");
    assert.equal(held.confidence, "inferred");
    assert.equal(held.preparationStatus, "hold");
    assert.match(held.notes, /十月下旬/);
    const slot = education.timetable.find((item) => item.day_of_week === 1 && item.period === 1 && item.subject === "数学");
    assert.ok(slot);
    assert.match(slot.notes, /^材料识别待确认：/);
    assert.equal(education.intakeReceipts.some((receipt) => receipt.commandType === "intake_material"), true);
    assert.equal(education.intakeTargets.some((target) => target.commandType === "intake_material" && target.title === "第一学期安排.docx"), true);
    assert.equal(JSON.stringify(education.intakeTargets).includes("stg_"), false);
    assert.equal(JSON.stringify(education.intakeTargets).includes("sha256:"), false);
    assert.deepEqual(staging.listStagedMaterials(), []);

    console.log(JSON.stringify({
      status: "passed",
      recognized_events: result.recognition.eventCount,
      recognized_slots: result.recognition.slotCount,
      projected_calendar: education.calendar.length,
      held_calendar: education.calendar.filter((event) => event.preparationStatus === "hold").length,
      projected_timetable: education.timetable.length,
      staging_after_receipt: 0,
    }, null, 2));
  }
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
