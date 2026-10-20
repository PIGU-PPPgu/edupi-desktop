#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createJiti } from "jiti";
import { fetchStagedGetAfterReset } from "./staged-read-retry.mjs";
import { assertFileScheduleUpdateUnavailable, assertMaterialReceiptOnly, createMaterialScheduleTestClient, snapshotScheduleState } from "./material-schedule-e2-client.mjs";

const desktopRoot = path.resolve(new URL("..", import.meta.url).pathname);
const staged = process.env.EDUPI_UPLOADED_CALENDAR_E2_STAGED === "1";
const resources = path.resolve(process.env.EDUPI_STAGED_RESOURCES || path.join(desktopRoot, "src-tauri", "resources"));
const coreRootValue = staged ? path.join(resources, "edupi-core") : process.env.EDUPI_CORE_ROOT;
if (!coreRootValue || !path.isAbsolute(coreRootValue)) throw new Error("EDUPI_CORE_ROOT must be an absolute Core checkout");
const coreRoot = fs.realpathSync(coreRootValue);
const temporaryRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-uploaded-calendar-e2-")));
const dataRoot = path.join(temporaryRoot, "data");
const desktopStateDir = path.join(temporaryRoot, "desktop-state");
const home = path.join(dataRoot, ".edupi");
for (const directory of [dataRoot, desktopStateDir, path.join(home, "memory"), path.join(home, "output"), path.join(home, "locks")]) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}
const compat = JSON.parse(fs.readFileSync(path.join(desktopRoot, "contracts", "edupi-core-compat.json"), "utf8"));
const token = "uploaded-calendar-test-token-012345678901234567890123456";
const keys = ["EDUPI_PROJECT_ROOT", "EDUPI_DATA_ROOT", "EDUPI_DATA_ALLOWED_ROOT", "EDUPI_CORE_ROOT", "EDUPI_CORE_ALLOWED_ROOT", "EDUPI_HOME", "EDUPI_MEMORY_DIR", "EDUPI_OUTPUT_DIR", "EDUPI_LOCK_DIR", "EDUPI_CORE_COMMIT", "EDUPI_AMBIENT_PLANNING", "PI_DESKTOP_STATE_DIR", "PI_DESKTOP_API_TOKEN"];
const previous = new Map(keys.map((key) => [key, process.env[key]]));
Object.assign(process.env, {
  EDUPI_PROJECT_ROOT: dataRoot,
  EDUPI_DATA_ROOT: dataRoot,
  EDUPI_DATA_ALLOWED_ROOT: temporaryRoot,
  EDUPI_CORE_ROOT: coreRoot,
  EDUPI_CORE_ALLOWED_ROOT: staged ? resources : path.dirname(coreRoot),
  EDUPI_HOME: home,
  EDUPI_MEMORY_DIR: path.join(home, "memory"),
  EDUPI_OUTPUT_DIR: path.join(home, "output"),
  EDUPI_LOCK_DIR: path.join(home, "locks"),
  EDUPI_CORE_COMMIT: compat.core_runtime.core_commit,
  EDUPI_AMBIENT_PLANNING: "1",
  PI_DESKTOP_STATE_DIR: desktopStateDir,
  PI_DESKTOP_API_TOKEN: token,
});

let stagedServer;
let runtimeSupervisor;

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => address && typeof address === "object" ? resolve(address.port) : reject(new Error("port unavailable")));
    });
  });
}

async function startStagedServer() {
  const serverDir = path.join(resources, "server");
  const nodeBinary = path.join(resources, "Pi Agent Server.app", "Contents", "MacOS", "node");
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(nodeBinary, [path.join(serverDir, "desktop-server.cjs")], {
    cwd: serverDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: String(port), NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
      EDUPI_CORE_VALIDATION_MODE: "bundled", PI_DESKTOP_INSTANCE_ID: "staged-uploaded-calendar-e2", PI_WEB_PARENT_PID: String(process.pid), PI_OFFLINE: "1" },
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs = (logs + chunk.toString("utf8")).slice(-5000); });
  child.stderr.on("data", (chunk) => { logs = (logs + chunk.toString("utf8")).slice(-5000); });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    if (await Promise.race([exited.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 3000))])) return;
    child.kill("SIGKILL");
    if (!await Promise.race([exited.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 3000))])) throw new Error("staged server did not exit");
  };
  try {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`staged server exited: ${logs}`);
      try {
        const identity = await fetch(`${url}/api/desktop/identity`, { signal: AbortSignal.timeout(2000) });
        if (identity.status === 204) {
          const route = await fetch(`${url}/api/edupi/materials/staging`, {
            headers: { origin: url }, signal: AbortSignal.timeout(5000),
          });
          await route.arrayBuffer();
          if (route.status === 403) {
            const educationRead = await fetchStagedGetAfterReset(`${url}/api/edupi/education`, {
              origin: url, "x-pi-desktop-token": token,
            });
            await educationRead.arrayBuffer();
            if (educationRead.status === 200) return { url, stop };
          }
        }
      } catch { /* cold start */ }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`staged server not ready: ${logs}`);
  } catch (error) { await stop(); throw error; }
}

function calendar(events, method = null) {
  return Buffer.from(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//EduPi Uploaded Calendar E2//EN",
    ...(method ? [`METHOD:${method}`] : []), ...events.flat(), "END:VCALENDAR", ""].join("\r\n"));
}

function timed(uid, date, hour, title, location) {
  const end = String(Number(hour) + 1).padStart(2, "0");
  return ["BEGIN:VEVENT", `UID:${uid}`, "DTSTAMP:20260923T000000Z", `DTSTART;TZID=Asia/Shanghai:${date}T${hour}0000`,
    `DTEND;TZID=Asia/Shanghai:${date}T${end}0000`, `SUMMARY:${title}`, `LOCATION:${location}`, "STATUS:CONFIRMED", "END:VEVENT"];
}


try {
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const routes = staged ? null : {
    "/api/edupi/materials/staging": await jiti.import("../app/api/edupi/materials/staging/route.ts"),
    "/api/edupi/intake": await jiti.import("../app/api/edupi/intake/route.ts"),
    "/api/edupi/education": await jiti.import("../app/api/edupi/education/route.ts"),
    "/api/edupi/calendar-preview": await jiti.import("../app/api/edupi/calendar-preview/route.ts"),
    "/api/edupi/material-schedule": await jiti.import("../app/api/edupi/material-schedule/route.ts"),
    "/api/edupi/teacher-feedback": await jiti.import("../app/api/edupi/teacher-feedback/route.ts"),
  };
  const snapshot = staged ? null : await jiti.import("../lib/edupi-core-snapshot.ts");
  runtimeSupervisor = staged ? null : await jiti.import("../lib/edupi-runtime-supervisor.ts");
  if (staged) stagedServer = await startStagedServer();
  const baseUrl = () => stagedServer?.url || "http://localhost:30141";
  const headers = authorized => ({ host: new URL(baseUrl()).host, origin: baseUrl(),
    ...(authorized ? { "x-pi-desktop-token": token } : {}) });
  const call = async (method, pathname, body, authorized = true) => {
    const request = new Request(baseUrl() + pathname, { method, headers: { ...headers(authorized),
      ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const response = stagedServer
      ? method === "GET" ? await fetchStagedGetAfterReset(request.url, headers(authorized))
        : await fetch(request, { signal: AbortSignal.timeout(30_000) })
      : await routes[new URL(request.url).pathname][method](request);
    return { response, body: await response.json() };
  };
  const client = createMaterialScheduleTestClient(call);
  const bootstrap = await call("POST", "/api/edupi/teacher-feedback", { action: "bootstrap" });
  assert.equal(bootstrap.response.status, 200, JSON.stringify(bootstrap.body));

  const stage = async (bytes, name = "官方校历.ics") => {
    const form = new FormData();
    form.append("files", new File([bytes], name, { type: "text/calendar" }), name);
    const request = new Request(baseUrl() + "/api/edupi/materials/staging", { method: "POST", headers: headers(true), body: form });
    const response = stagedServer ? await fetch(request, { signal: AbortSignal.timeout(15_000) }) : await routes["/api/edupi/materials/staging"].POST(request);
    const body = await response.json();
    assert.equal(response.status, 201, JSON.stringify(body));
    assert.equal(body.staged.length, 1);
    return body.staged[0];
  };
  const receive = (descriptor, extra = {}) => call("POST", "/api/edupi/intake", {
    kind: "material", stagingId: descriptor.staging_id, title: descriptor.original_name,
    materialKind: "other", subject: null, classId: null, ...extra,
  });
  const education = async () => {
    const result = await call("GET", "/api/edupi/education");
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
    return result.body;
  };
  const manual = await call("POST", "/api/edupi/intake", { kind: "calendar", events: [{
    eventId: null, date: "2026-10-09", endDate: null, name: "手工日程", type: "meeting",
    confidence: "teacher_confirmed", notes: null, sourceOccurrenceRef: "manual-ui-occurrence",
    timeInterval: { start: "2026-10-09T09:00+08:00", end: "2026-10-09T10:00+08:00", timeZone: "Asia/Shanghai" },
    location: "手工地点",
  }] });
  assert.equal(manual.response.status, 200, JSON.stringify(manual.body));

  const firstBytes = calendar([
    timed("upload-a", "20261001", "09", "教研会", "东楼 203"),
    timed("upload-b", "20261002", "14", "备课组会", "西楼 401"),
  ]);
  const descriptor = await stage(firstBytes);
  const received = await receive(descriptor);
  assert.equal(received.response.status, 200, JSON.stringify(received.body));
  assertMaterialReceiptOnly(received.body);
  assert.equal(received.body.staged.some(item => item.staging_id === descriptor.staging_id), false);
  assert.equal((await education()).calendar.some(item => ["教研会", "备课组会"].includes(item.name)), false,
    "accepting the file is not adoption of its schedule");
  const materialId = received.body.receipt.applied_ids[0];
  assert.equal(received.body.materialScheduleProposal?.material_id, materialId);
  const readBefore = snapshotScheduleState(home);
  const current = await client.read(materialId);
  assert.equal(current.events.length, 2);
  assert.equal(current.source.source_hash, descriptor.source_hash);
  assert.deepEqual(snapshotScheduleState(home), readBefore, "current Core proposal read must not write");
  const cancelled = await client.adopt(materialId, "calendar-cancelled-confirmation", async () => false);
  assert.equal(cancelled.status, "cancelled");
  assert.deepEqual(snapshotScheduleState(home), readBefore, "user cancellation must not adopt or delete anything");

  const proof = { action: "apply", materialId, expectedSourceHash: current.source.source_hash,
    expectedMetadataRevision: current.source.metadata_revision, expectedParseFingerprint: current.parse_fingerprint,
    commandId: "calendar-guard-probe", confirm: true };
  for (const [changed, errorCode] of [
    [{ ...proof, confirm: false }, "material_schedule_invalid"],
    [{ ...proof, expectedSourceHash: "sha256:" + "0".repeat(64) }, "material_schedule_stale"],
    [{ ...proof, expectedParseFingerprint: "sha256:" + "0".repeat(64) }, "material_schedule_stale"],
    [{ ...proof, expectedMetadataRevision: current.source.metadata_revision + 1 }, "material_schedule_stale"],
  ]) {
    const result = await call("POST", "/api/edupi/material-schedule", changed);
    assert.ok([400, 409].includes(result.response.status), JSON.stringify(result.body));
    assert.equal(result.body.errorCode, errorCode);
    assert.deepEqual(snapshotScheduleState(home), readBefore, "invalid or stale proof cannot write schedules");
  }
  assert.equal((await call("GET", "/api/edupi/material-schedule?materialId=" + materialId, undefined, false)).response.status, 403);
  assert.equal((await call("POST", "/api/edupi/material-schedule", proof, false)).response.status, 403);
  const adopted = await client.adopt(materialId, "calendar-explicit-adoption", async result => {
    assert.equal(result.source.source_hash, descriptor.source_hash);
    assert.equal(result.parse_fingerprint, current.parse_fingerprint);
    return true;
  });
  assert.equal(adopted.status, "accepted");
  assert.equal(adopted.applied_ids.length, 2);
  const replay = await client.adopt(materialId, "calendar-explicit-adoption", async () => true);
  assert.equal(replay.replayed, true);
  let read = await education();
  const firstIds = read.calendar.filter(item => ["教研会", "备课组会"].includes(item.name)).map(item => item.id).sort();
  assert.equal(firstIds.length, 2);
  assert.equal(read.calendar.find(item => item.name === "教研会").startsAt, "2026-10-01T09:00+08:00");

  const renamed = await stage(firstBytes, "校历副本.ics");
  const renamedReceipt = await receive(renamed);
  assertMaterialReceiptOnly(renamedReceipt.body);
  const renamedResult = await client.adopt(renamedReceipt.body.receipt.applied_ids[0], "calendar-renamed-adoption", async () => true);
  assert.ok(["accepted", "modified"].includes(renamedResult.status), "a held copy is not a successful owner adoption");
  assert.deepEqual(renamedResult.rejected_ids, []);
  assert.deepEqual((await education()).calendar.filter(item => ["教研会", "备课组会"].includes(item.name)).map(item => item.id).sort(), firstIds,
    "new owner issuer/ref identity, not a Desktop-derived UID, owns exact-file dedupe");

  const update = await stage(calendar([timed("upload-a", "20261003", "10", "教研会修订", "新楼")]), "校历-修订.ics");
  const pureCancellation = await stage(calendar([["BEGIN:VEVENT", "UID:upload-a", "DTSTAMP:20260923T000000Z",
    "STATUS:CANCELLED", "END:VEVENT"]], "CANCEL"), "校历-纯取消.ics");
  const exdateRevision = await stage(calendar([["BEGIN:VEVENT", "UID:upload-recurring", "DTSTAMP:20260923T000000Z",
    "DTSTART;TZID=Asia/Shanghai:20261020T090000", "DTEND;TZID=Asia/Shanghai:20261020T100000",
    "RRULE:FREQ=WEEKLY;COUNT=3", "EXDATE;TZID=Asia/Shanghai:20261027T090000", "SUMMARY:循环事项", "END:VEVENT"]]), "校历-排除一次.ics");
  const singleCancellation = await stage(calendar([["BEGIN:VEVENT", "UID:upload-recurring", "DTSTAMP:20260923T000000Z",
    "RECURRENCE-ID;TZID=Asia/Shanghai:20261103T090000", "STATUS:CANCELLED", "END:VEVENT"]], "CANCEL"), "校历-取消一次.ics");
  const legacySource = { calendarSourceId: "calendar-source-" + "a".repeat(32), calendarSourceFingerprint: "sha256:" + "b".repeat(64) };
  for (const candidate of [update, pureCancellation, exdateRevision, singleCancellation]) {
    const before = snapshotScheduleState(home);
    assertFileScheduleUpdateUnavailable(await receive(candidate, legacySource));
    assert.deepEqual(snapshotScheduleState(home), before, "unsupported legacy update/cancel cannot alter canonical bytes or deletion history");
    assert.equal(fs.existsSync(candidate.staging_path), true, "unsupported intent must retain staged bytes");
  }
  const previewBefore = snapshotScheduleState(home);
  assertFileScheduleUpdateUnavailable(await call("POST", "/api/edupi/calendar-preview", { stagingId: update.staging_id }));
  assert.deepEqual(snapshotScheduleState(home), previewBefore);
  assertFileScheduleUpdateUnavailable(await receive(update, { calendarImportConfirmed: true, calendarPreviewFingerprint: "sha256:" + "c".repeat(64) }));
  assert.deepEqual(snapshotScheduleState(home), previewBefore);
  assert.equal(fs.existsSync(update.staging_path), true);

  if (stagedServer) {
    await stagedServer.stop();
    stagedServer = await startStagedServer();
  } else {
    await runtimeSupervisor.closeAllEduPiRuntimes();
    await runtimeSupervisor.ensureEduPiRuntime(snapshot.resolveEduPiBridgeRoots());
  }
  read = await education();
  assert.deepEqual(read.calendar.filter(item => ["教研会", "备课组会"].includes(item.name)).map(item => item.id).sort(), firstIds);
  assert.equal(read.calendar.some(item => item.name === "手工日程"), true);
  assert.deepEqual(snapshotScheduleState(home), previewBefore, "cold read cannot apply deferred updates or cancellation");
  console.log(JSON.stringify({ status: "passed", staged_server: staged, material_receipt_only: true,
    owner_current_read: true, explicit_confirm_apply: true, confirmation_cancel_zero_write: true,
    stale_hash_revision_fingerprint_rejected: true, exact_replay: true, restart_readback: true,
    legacy_source_update: { supported: false, rejected_409: true, schedule_writes: 0, delete_writes: 0 },
    legacy_calendar_preview: { supported: false, rejected_409: true },
    ics_exdate_reconciliation: { supported: false, rejected_409: true, delete_writes: 0 },
    ics_cancellation: { supported: false, rejected_409: true, staged_retained: true }, external_send: false }));
} finally {
  await stagedServer?.stop();
  await runtimeSupervisor?.closeAllEduPiRuntimes();
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
