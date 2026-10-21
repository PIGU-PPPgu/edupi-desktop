#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { createJiti } from "jiti";
import { assertMaterialReceiptOnly, createMaterialScheduleTestClient } from "./material-schedule-e2-client.mjs";

const configuredCoreRoot = process.env.EDUPI_CORE_ROOT;
if (typeof configuredCoreRoot !== "string" || !path.isAbsolute(configuredCoreRoot)) {
  throw new Error("EDUPI_CORE_ROOT must be an absolute Core checkout");
}
const coreRoot = fs.realpathSync(configuredCoreRoot);
const desktopRoot = path.resolve(new URL("..", import.meta.url).pathname);
const compat = JSON.parse(fs.readFileSync(path.join(desktopRoot, "contracts", "edupi-core-compat.json"), "utf8"));
const temporaryRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-text-schedule-evidence-e2-")));
const dataRoot = path.join(temporaryRoot, "data");
const stateDir = path.join(temporaryRoot, "desktop-state");
const home = path.join(dataRoot, ".edupi");
for (const directory of [stateDir, path.join(home, "memory"), path.join(home, "output"), path.join(home, "locks")]) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

const keys = ["EDUPI_PROJECT_ROOT", "EDUPI_DATA_ROOT", "EDUPI_DATA_ALLOWED_ROOT", "EDUPI_CORE_ROOT", "EDUPI_CORE_ALLOWED_ROOT",
  "EDUPI_HOME", "EDUPI_MEMORY_DIR", "EDUPI_OUTPUT_DIR", "EDUPI_LOCK_DIR", "EDUPI_CORE_COMMIT", "PI_DESKTOP_STATE_DIR", "PI_DESKTOP_API_TOKEN"];
const previous = new Map(keys.map((key) => [key, process.env[key]]));
const token = "synthetic-text-owner-intake-token-012345678901";
let supervisor;
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
  PI_DESKTOP_STATE_DIR: stateDir, PI_DESKTOP_API_TOKEN: token,
});

function xml(value) {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

async function docx(text) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  const paragraphs = text.split("\n").map((line) => `<w:p><w:r><w:t>${xml(line)}</w:t></w:r></w:p>`).join("");
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}


try {
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const staging = await jiti.import("../lib/edupi-material-staging.ts");
  const recognition = await jiti.import("../lib/edupi-material-recognition.ts");
  const snapshot = await jiti.import("../lib/edupi-core-snapshot.ts");
  const intakeRoute = await jiti.import("../app/api/edupi/intake/route.ts");
  const scheduleRoute = await jiti.import("../app/api/edupi/material-schedule/route.ts");
  const feedbackRoute = await jiti.import("../app/api/edupi/teacher-feedback/route.ts");
  supervisor = await jiti.import("../lib/edupi-runtime-supervisor.ts");
  const request = (pathname, method = "GET", body) => new Request("http://localhost" + pathname, { method,
    headers: { host: "localhost", "x-pi-desktop-token": token, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const bootstrap = await feedbackRoute.POST(request("/api/edupi/teacher-feedback", "POST", { action: "bootstrap" }));
  assert.equal(bootstrap.status, 200);
  const client = createMaterialScheduleTestClient(async (method, pathname, body) => {
    const response = await scheduleRoute[method](request(pathname, method, body));
    return { response, body: await response.json() };
  });
  const shanghaiEvidence = "2026年10月20日 09:00-10:00 教研会 时区：Asia/Shanghai 地点：东楼203";
  const dstEvidence = "2026年11月1日 00:30-02:30 值班会议 时区：America/New_York 地点：西楼";
  const sourceText = shanghaiEvidence + "\n" + dstEvidence;
  const bytes = await docx(sourceText);
  const descriptors = ["教研安排.docx", "改名后的安排.docx"].map(name => staging.stageMaterialInputs([{
    name, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes,
  }])[0]);
  assert.equal(descriptors[0].source_hash, descriptors[1].source_hash);
  const eventIds = [];
  let modelCalls = 0;
  for (const descriptor of descriptors) {
    // Local deterministic analysis remains data only. Its IDs/results never
    // enter a calendar writer; the owner independently parses accepted DOCX.
    const modelOutput = JSON.stringify({ events: [{
      date: "2026-10-20", name: "教研会", type: "meeting", evidence_quote: shanghaiEvidence,
      time_interval: { start: "2026-10-20T09:00+08:00", end: "2026-10-20T10:00+08:00", time_zone: "Asia/Shanghai" },
      location: "东楼203",
    }, {
      date: "2026-11-01", name: "值班会议", type: "meeting", evidence_quote: dstEvidence,
      time_interval: { start: "2026-11-01T00:30-04:00", end: "2026-11-01T02:30-05:00", time_zone: "America/New_York" },
      location: "西楼",
    }], slots: [] });
    const analyzed = await recognition.recognizeStagedMaterial(descriptor, {
      runModel: async input => { modelCalls += 1; assert.equal(input.text.includes(shanghaiEvidence), true); return modelOutput; },
      idFactory: () => "analysis-only-" + modelCalls,
    });
    recognition.saveRecognitionCache(descriptor, analyzed, { modelOutput, sourceText });
    assert.deepEqual(await recognition.recognizeStagedMaterial(descriptor), analyzed);

    const before = await snapshot.readEduPiEducationSnapshot({ requestId: "text-before-receipt", scheduleOccurrenceVersion: "1.2" });
    const received = await intakeRoute.POST(request("/api/edupi/intake", "POST", { kind: "material",
      stagingId: descriptor.staging_id, title: descriptor.original_name, materialKind: "other",
      subject: null, classId: null, recognize: true }));
    const receipt = await received.json();
    assert.equal(received.status, 200, JSON.stringify(receipt));
    assertMaterialReceiptOnly(receipt);
    const afterReceipt = await snapshot.readEduPiEducationSnapshot({ requestId: "text-after-receipt", scheduleOccurrenceVersion: "1.2" });
    assert.deepEqual(afterReceipt.occurrenceProjection.events.map(item => item.event_id).sort(),
      before.occurrenceProjection.events.map(item => item.event_id).sort(), "cached model analysis cannot auto-import an arrangement");
    const materialId = receipt.receipt.applied_ids[0];
    const read = await client.read(materialId);
    assert.equal(read.source.source_hash, descriptor.source_hash);
    assert.equal(read.events.length, 2);
    assert.deepEqual(read.events.find(event => event.name === "值班会议").time_interval,
      { start: "2026-11-01T00:30-04:00", end: "2026-11-01T02:30-05:00", time_zone: "America/New_York" });
    const result = await client.adopt(materialId, "text-owner-adoption-" + modelCalls, async current => {
      assert.equal(current.parse_fingerprint, read.parse_fingerprint);
      return true;
    });
    assert.ok(["accepted", "modified"].includes(result.status), "a held DOCX is not a successful owner adoption or dedupe");
    assert.deepEqual(result.rejected_ids, []);
    const accepted = await snapshot.readEduPiEducationSnapshot({ requestId: "text-owner-readback", scheduleOccurrenceVersion: "1.2" });
    const matching = accepted.occurrenceProjection.events.filter(event => ["教研会", "值班会议"].includes(event.name));
    assert.equal(matching.length, 2);
    assert.equal(matching.every(event => event.external_send === false && event.confidence === "inferred" && event.preparation_status === "hold"), true);
    const canonical = JSON.parse(fs.readFileSync(path.join(home, "output", "education_intake_state.json"), "utf8"));
    for (const event of matching) {
      const row = canonical.calendar_events.find(item => item.event_id === event.event_id);
      assert.equal(row?.evidence_ids.includes(materialId), true, "adopting an independent DOCX must bind its own material evidence, not merely retain old events");
    }
    eventIds.push(matching.map(event => event.event_id).sort());
  }
  assert.equal(modelCalls, 2);
  assert.deepEqual(eventIds[0], eventIds[1], "renamed identical DOCX bytes cannot add another schedule");
  await supervisor.closeAllEduPiRuntimes();
  const cold = await snapshot.readEduPiEducationSnapshot({ requestId: "text-owner-cold-read", scheduleOccurrenceVersion: "1.2" });
  assert.deepEqual(cold.occurrenceProjection.events.map(item => item.event_id).sort(), eventIds[0]);
  console.log(JSON.stringify({ status: "passed", core_commit: compat.core_runtime.core_commit,
    typed_text_evidence: true, model_analysis_only: true, cached_analysis_did_not_write: true,
    current_owner_read_and_confirmed_apply: true, independent_copy_evidence_bound: true, renamed_exact_dedupe: true, dst_transition: true,
    cold_readback: true, projected_events: 2, external_model_calls: 0, external_send: false }));
} finally {
  await supervisor?.closeAllEduPiRuntimes();
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
