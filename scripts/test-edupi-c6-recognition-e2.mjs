#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createJiti } from "jiti";
import { assertMaterialReceiptOnly, createMaterialScheduleTestClient, snapshotScheduleState } from "./material-schedule-e2-client.mjs";

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
const scheduleRoute = await jiti.import("../app/api/edupi/material-schedule/route.ts");
const feedbackRoute = await jiti.import("../app/api/edupi/teacher-feedback/route.ts");
const supervisor = await jiti.import("../lib/edupi-runtime-supervisor.ts");
const token = "synthetic-c6-receipt-owner-token-012345678901";
const priorToken = process.env.PI_DESKTOP_API_TOKEN;
process.env.PI_DESKTOP_API_TOKEN = token;


try {
  const sourceText = path.join(temp, "第一学期安排.txt");
  const sourceDocx = path.join(temp, "第一学期安排.docx");
  fs.writeFileSync(sourceText, [
    "2026年9月1日开学。", "2026年9月25日中秋主题活动。",
    "十月下旬举行秋季运动会，具体日期待学校通知。", "每周一第1节，七年级二班数学课。",
  ].join("\n"), "utf8");
  execFileSync("/usr/bin/textutil", ["-convert", "docx", "-output", sourceDocx, sourceText]);
  const [descriptor] = staging.stageMaterialInputs([{ name: "第一学期安排.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: fs.readFileSync(sourceDocx) }]);
  const request = (pathname, method = "GET", body) => new Request("http://localhost" + pathname, { method,
    headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", "x-pi-desktop-token": token },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const owner = await feedbackRoute.POST(request("/api/edupi/teacher-feedback", "POST", { action: "bootstrap" }));
  assert.equal(owner.status, 200);
  const response = await POST(request("/api/edupi/intake", "POST", { kind: "material", stagingId: descriptor.staging_id,
    title: descriptor.original_name, materialKind: "other", subject: "数学", classId: "class-7-2", recognize: true }));
  const received = await response.json();
  assert.equal(response.status, 200, JSON.stringify(received));
  assertMaterialReceiptOnly(received);
  assert.deepEqual(staging.listStagedMaterials(), []);
  const materialId = received.receipt.applied_ids[0];
  const client = createMaterialScheduleTestClient(async (method, pathname, body) => {
    const response = await scheduleRoute[method](request(pathname, method, body));
    return { response, body: await response.json() };
  });
  const current = await client.read(materialId);
  assert.notEqual(current.status, "ready", "ambiguous free-form text cannot become an inferred automatic file schedule");
  const before = snapshotScheduleState(path.join(dataRoot, ".edupi"));
  await assert.rejects(client.adopt(materialId, "unresolved-file-must-not-apply", async () => true));
  assert.deepEqual(snapshotScheduleState(path.join(dataRoot, ".edupi")), before);
  const educationResponse = await GET();
  const education = await educationResponse.json();
  assert.equal(educationResponse.status, 200, JSON.stringify(education));
  assert.equal(education.calendar.length, 0);
  assert.equal(education.timetable.length, 0);
  console.log(JSON.stringify({ status: "passed", material_received_only: true, owner_read_held: true,
    legacy_model_schedule: { supported: false, automatic_events: 0, automatic_slots: 0 },
    external_model_calls: 0, external_send: false }));
} finally {
  await supervisor.closeAllEduPiRuntimes();
  if (priorToken === undefined) delete process.env.PI_DESKTOP_API_TOKEN;
  else process.env.PI_DESKTOP_API_TOKEN = priorToken;
  fs.rmSync(temp, { recursive: true, force: true });
}
