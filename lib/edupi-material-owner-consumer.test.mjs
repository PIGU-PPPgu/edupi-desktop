import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createJiti } from "jiti";
import ts from "typescript";

// This explicit diagnostic root is not the production compat identity. Run this
// against the approved read-only Core snapshot, then repeat after final pairing.
const diagnosticRoot = process.env.EDUPI_FILE_FENCE_CORE_ROOT;
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const intake = await jiti.import("./edupi-education-intake.ts");
const flow = await jiti.import("./edupi-material-intake-flow.ts");
const staging = await jiti.import("./edupi-material-staging.ts");
const security = await jiti.import("./request-security.ts");
const bounded = await jiti.import("./bounded-form-data.ts");
const native = await jiti.import("./desktop-api-auth.ts");
const timetable = await jiti.import("./edupi-timetable-intake.ts");
const calendar = await jiti.import("./edupi-calendar-intake-request.ts");
const lock = await jiti.import("./edupi-material-recognition-lock.ts");
const require = createRequire(import.meta.url);

function route(relative, dependencies) {
  const compiled = ts.transpileModule(fs.readFileSync(new URL(relative, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const routeModule = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => dependencies[name] || require(name), routeModule, routeModule.exports);
  return routeModule.exports;
}

test("diagnostic Core file-fence consumer uses only current owner read and explicit apply", {
  skip: !diagnosticRoot, timeout: 45_000,
}, async t => {
  const coreRoot = fs.realpathSync(diagnosticRoot), temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-owner-consumer-")));
  const dataRoot = path.join(temp, "data"), stateDir = path.join(temp, "desktop"), edupiHome = path.join(dataRoot, ".edupi");
  const token = "synthetic-owner-consumer-desktop-token-1234567890";
  const environment = { EDUPI_PROJECT_ROOT: dataRoot, EDUPI_DATA_ROOT: dataRoot, EDUPI_DATA_ALLOWED_ROOT: temp,
    EDUPI_HOME: edupiHome, EDUPI_MEMORY_DIR: path.join(edupiHome, "memory"), EDUPI_OUTPUT_DIR: path.join(edupiHome, "output"),
    EDUPI_LOCK_DIR: path.join(edupiHome, "locks"), PI_DESKTOP_STATE_DIR: stateDir, PI_DESKTOP_API_TOKEN: token,
    EDUPI_CORE_COMMIT: "synthetic-diagnostic-file-fence" };
  const previous = new Map(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  for (const directory of [dataRoot, stateDir, environment.EDUPI_MEMORY_DIR, environment.EDUPI_OUTPUT_DIR, environment.EDUPI_LOCK_DIR]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const fromCore = name => import(pathToFileURL(path.join(coreRoot, "scripts", name)).href);
  const hash = bytes => `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
  let admission;
  try {
    const { prepareCoreRuntimeRoot } = await fromCore("core_runtime_root.mjs");
    const { acquireCoreRuntimeWriterAdmission } = await fromCore("core_runtime_writer_admission.mjs");
    const { createAmbientAuthorizationStore } = await fromCore("ambient_authorization_store.mjs");
    const { handleCommandRequest } = await fromCore("edupi_bridge_command.mjs");
    const { buildSnapshotForState } = await fromCore("edupi_bridge_snapshot.mjs");
    const { loadTeacherReviewState } = await fromCore("teacher_review_store.mjs");
    const { loadEducationIntakeState, readVerifiedEducationMaterial } = await fromCore("education_intake_store.mjs");
    const { normalizeMaterialMetadataState } = await fromCore("material_metadata_contract.mjs");
    const { readMaterialSchedule, applyMaterialSchedule } = await fromCore("material_schedule_read.mjs");
    const { proposeReceivedMaterialSchedule } = await fromCore("material_schedule_proposal.mjs");
    const { makePdfFixture } = await fromCore("test_material_pdf_fixture.mjs");
    const { zipSync, strToU8 } = createRequire(path.join(coreRoot, "package.json"))("fflate");
    const root = prepareCoreRuntimeRoot(dataRoot);
    admission = await acquireCoreRuntimeWriterAdmission({ root, kind: "legacy_material_schedule_read_test" });
    const ownerSecret = crypto.randomBytes(32), ownerHeader = ownerSecret.toString("base64url");
    const authorizationStore = createAmbientAuthorizationStore({ root,
      macKey: crypto.createHmac("sha256", ownerSecret).update(`edupi.owner.authorization.mac-key.v1\0${root.dataRootFingerprint}`).digest(),
      verifyControl: value => value === ownerHeader });
    authorizationStore.control({ command_id: "consumer-bootstrap", root_ref: root.dataRootFingerprint, expected_owner_id: null,
      action: "bootstrap" }, authorizationStore.authorizeControl(ownerHeader));
    const snapshot = () => buildSnapshotForState(loadTeacherReviewState(), { memoryDir: environment.EDUPI_MEMORY_DIR,
      outputDir: environment.EDUPI_OUTPUT_DIR, educationIntakeState: loadEducationIntakeState() });
    const bridgeCommands = [], ownerCalls = [];
    let commandNumber = 0, stageNumber = 0;
    const dispatch = async command => {
      const id = `owner-consumer-${++commandNumber}`;
      const envelope = intake.buildEducationIntakeCommandEnvelope({ snapshotId: snapshot().snapshot_id, command, requestId: id,
        messageId: id, idempotencyKey: id });
      const request = { operation: "command", request_id: id, envelope };
      bridgeCommands.push(command);
      const response = await handleCommandRequest(request);
      return { request, response };
    };
    const issue = async command => {
      const { request, response } = await dispatch(command);
      assert.equal(response.ok, true, JSON.stringify(response));
      assert.ok(["accepted", "modified"].includes(response.receipt.payload.status), JSON.stringify(response.receipt.payload));
      const materialScheduleProposal = await proposeReceivedMaterialSchedule({ root, authorizationStore, bridgeRequest: request, bridgeResponse: response });
      return { receipt: response.receipt.payload, data: snapshot(), ...(materialScheduleProposal ? { materialScheduleProposal } : {}) };
    };
    const host = { call: async operation => {
      assert.equal(operation, "health"); return { ok: true, result: { data_root_fingerprint: root.dataRootFingerprint } };
    }, callOwnerControl: async (operation, request) => {
      ownerCalls.push({ operation, request });
      try {
        if (operation === "owner_read") return { ok: true, result: authorizationStore.read() };
        if (operation === "material_schedule_read") return { ok: true, result: await readMaterialSchedule({ root, authorizationStore, request }) };
        assert.equal(operation, "material_schedule_apply");
        return { ok: true, result: await applyMaterialSchedule({ root, authorizationStore, request }) };
      } catch (error) { return { ok: false, error_code: error.code }; }
    } };
    const common = { "@/lib/request-security": security, "@/lib/bounded-form-data": bounded, "@/lib/desktop-api-auth": native };
    const intakeRoute = route("../app/api/edupi/intake/route.ts", { ...common,
      "@/lib/edupi-education-intake": { ...intake, issueEducationIntake: async command => {
        const { response } = await dispatch(command); return { receipt: response.receipt.payload, data: snapshot() };
      } }, "@/lib/edupi-material-staging": staging, "@/lib/edupi-material-recognition-lock": lock,
      "@/lib/edupi-material-intake-flow": { intakeRecognizedMaterial: input => flow.intakeRecognizedMaterial(input, { issue }) },
      "@/lib/edupi-timetable-intake": timetable, "@/lib/edupi-calendar-intake-request": calendar });
    const ownerRoute = route("../app/api/edupi/material-schedule/route.ts", { ...common,
      "@/lib/edupi-core-snapshot": { resolveEduPiBridgeRoots: () => ({}), readEduPiEducationSnapshot: async () => ({ payload: snapshot().payload }) },
      "@/lib/edupi-material-metadata": { readMaterialMetadataHistory: async materialId => ({ materialId,
        revision: normalizeMaterialMetadataState(loadEducationIntakeState().materials.find(material => material.material_id === materialId)).revision }) },
      "@/lib/edupi-runtime-supervisor": { ensureEduPiRuntime: async () => host } });
    const previewRoute = route("../app/api/edupi/calendar-preview/route.ts", common);
    const pairingRoute = route("../app/api/edupi/document-pairings/route.ts", common);
    const headers = { host: "localhost:30373", origin: "http://localhost:30373", "content-type": "application/json", "x-pi-desktop-token": token };
    const post = (pathname, body) => new Request(`http://localhost:30373/api/edupi/${pathname}`, { method: "POST", headers, body: JSON.stringify(body) });
    const stage = (name, bytes, mimeType) => staging.stageMaterialInputs([{ name, bytes, mimeType }], { stateDir, dataRoot, coreRoot,
      idFactory: () => `stg_${(++stageNumber).toString(16).padStart(32, "0")}` })[0];
    const receive = async descriptor => {
      const response = await intakeRoute.POST(post("intake", { kind: "material", stagingId: descriptor.staging_id, materialKind: "other" }));
      assert.equal(response.status, 200); const body = await response.json();
      assert.equal(body.materialReceivedOnly, true); assert.deepEqual(body.recognition, { eventCount: 0, slotCount: 0 });
      return body;
    };
    const readCurrent = async materialId => {
      const response = await ownerRoute.GET(new Request(`http://localhost:30373/api/edupi/material-schedule?materialId=${encodeURIComponent(materialId)}`, { headers }));
      assert.equal(response.status, 200, JSON.stringify(await response.clone().json())); return (await response.json()).result;
    };
    const applyBody = (current, commandId) => ({ action: "apply", materialId: current.source.material_id, expectedSourceHash: current.source.source_hash,
      expectedMetadataRevision: current.source.metadata_revision, expectedParseFingerprint: current.parse_fingerprint, commandId, confirm: true });
    const ics = (uid, extra = "") => {
      const properties = extra.split(/\r?\n/u).filter(Boolean);
      return Buffer.from(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Synthetic//EN",
        ...properties.filter(value => value.startsWith("METHOD:")), "BEGIN:VEVENT", `UID:${uid}`, "DTSTAMP:20261001T000000Z",
        "DTSTART:20261023T010000Z", "DTEND:20261023T020000Z", "SUMMARY:合成日程",
        ...properties.filter(value => !value.startsWith("METHOD:")), "END:VEVENT", "END:VCALENDAR", ""].join("\r\n"));
    };
    const docx = text => Buffer.from(zipSync(Object.fromEntries(Object.entries({
      "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      "word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
    }).map(([name, value]) => [name, strToU8(value)]))));
    const adopted = [];
    await t.test("new ICS and DOCX receive, current-read, explicit-confirm, reload and replay", async () => {
      for (const [format, bytes, mime] of [["ics", ics("owner-consumer-ics"), "text/calendar"],
        ["docx", docx("2026年10月24日 09:00-10:00 合成教研会 地点：东楼203 时区：Asia/Shanghai"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]]) {
        const before = loadEducationIntakeState().calendar_events.length, ownerBefore = ownerCalls.length;
        const descriptor = stage(`new.${format}`, bytes, mime), received = await receive(descriptor);
        assert.equal(loadEducationIntakeState().calendar_events.length, before);
        assert.equal(ownerCalls.length, ownerBefore, "upload sidecar does not submit an owner apply");
        assert.equal(received.materialScheduleProposal.status, "proposed", JSON.stringify(received.materialScheduleProposal));
        const materialId = received.receipt.applied_ids[0];
        const current = await readCurrent(materialId), reloaded = await readCurrent(materialId);
        assert.equal(current.status, "ready"); assert.equal(reloaded.parse_fingerprint, current.parse_fingerprint);
        assert.equal(loadEducationIntakeState().calendar_events.length, before, "current-read and reload never adopt");
        const payload = applyBody(current, `teacher-adopt-${format}`), applyBefore = ownerCalls.filter(call => call.operation === "material_schedule_apply").length;
        for (const bad of [{ ...payload, confirm: false }, { ...payload, sourceId: "legacy-source" }, { ...payload, owner_verified: true }]) {
          assert.equal((await ownerRoute.POST(post("material-schedule", bad))).status, 400);
        }
        assert.equal(ownerCalls.filter(call => call.operation === "material_schedule_apply").length, applyBefore);
        const applied = await ownerRoute.POST(post("material-schedule", payload));
        assert.equal(applied.status, 200, JSON.stringify(await applied.clone().json()));
        const result = (await applied.json()).result;
        assert.equal(result.status, "accepted");
        assert.equal(loadEducationIntakeState().calendar_events.length, before + current.events.length);
        const replay = await ownerRoute.POST(post("material-schedule", payload));
        assert.equal(replay.status, 200); assert.equal((await replay.json()).result.replayed, true);
        assert.equal(loadEducationIntakeState().calendar_events.length, before + current.events.length);
        const material = loadEducationIntakeState().materials.find(item => item.material_id === materialId);
        assert.equal(readVerifiedEducationMaterial(materialId).source_hash, descriptor.source_hash);
        adopted.push({ current, payload, material });
      }
      assert.equal(bridgeCommands.every(command => command.command_type === "intake_material"), true, "consumer has no generic file-arrangement dispatch");
    });
    await t.test("old source updates, pure CANCEL and pairing are refused before any mutation or staging settlement", async () => {
      const descriptor = stage("cancel.ics", ics("owner-consumer-ics", "METHOD:CANCEL\r\nSTATUS:CANCELLED"), "text/calendar");
      const before = fs.readFileSync(path.join(environment.EDUPI_OUTPUT_DIR, "education_intake_state.json")), count = bridgeCommands.length;
      for (const fields of [{ calendarSourceId: `calendar-source-${"2".repeat(32)}`, calendarSourceFingerprint: hash("old") },
        { calendarImportConfirmed: true, calendarPreviewFingerprint: hash("cancel") },
        { documentSourceId: `document-source-${"2".repeat(32)}`, documentSourceFingerprint: hash("old"), documentPairings: [] }]) {
        const response = await intakeRoute.POST(post("intake", { kind: "material", stagingId: descriptor.staging_id, ...fields }));
        assert.equal(response.status, 409); assert.equal((await response.json()).code, "file_schedule_update_unavailable");
      }
      assert.equal((await previewRoute.POST(post("calendar-preview", { stagingId: descriptor.staging_id }))).status, 409);
      assert.equal((await pairingRoute.POST(post("document-pairings", { stagingId: descriptor.staging_id,
        sourceId: `document-source-${"2".repeat(32)}`, sourceFingerprint: hash("old") }))).status, 409);
      for (const fields of [{ source: { source_kind: "teacher_message" } }, { ocrStatus: "trusted" }, { command: { command_type: "import_calendar" } }]) {
        assert.equal((await intakeRoute.POST(post("intake", { kind: "material", stagingId: descriptor.staging_id, ...fields }))).status, 400);
      }
      assert.equal(bridgeCommands.length, count); assert.deepEqual(fs.readFileSync(path.join(environment.EDUPI_OUTPUT_DIR, "education_intake_state.json")), before);
      assert.ok(staging.listStagedMaterials().some(item => item.staging_id === descriptor.staging_id));
    });
    await t.test("new cancellation, EXDATE and unsupported file arrangements remain held", async () => {
      const fixtures = [["cancel.ics", ics("held-cancel", "METHOD:CANCEL\r\nSTATUS:CANCELLED"), "text/calendar"],
        ["exdate.ics", ics("held-exdate", "RRULE:FREQ=DAILY;COUNT=2\r\nEXDATE:20261024T010000Z"), "text/calendar"],
        ["slots.docx", docx("星期一 第1节 数学 七一班"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
        ["text.pdf", makePdfFixture(), "application/pdf"],
        ["image.png", Buffer.from("89504e470d0a1a0a", "hex"), "image/png"],
        ["legacy.doc", Buffer.from("d0cf11e0a1b11ae1", "hex"), "application/msword"]];
      for (const [name, bytes, mime] of fixtures) {
        const before = loadEducationIntakeState().calendar_events.length;
        const received = await receive(stage(name, bytes, mime));
        const current = await readCurrent(received.receipt.applied_ids[0]);
        assert.notEqual(current.status, "ready", name);
        if (name === "cancel.ics") assert.equal(current.events.length, 0, "a pure CANCEL has no active event that could hide a delete-only bypass");
        assert.equal((await ownerRoute.POST(post("material-schedule", applyBody(current, `held-${name}`)))).status, 409);
        assert.equal(loadEducationIntakeState().calendar_events.length, before);
      }
    });
    await t.test("generic teacher_file calendar/timetable and spoofed proof fail without persistent writes", async () => {
      const material = adopted[0].material, before = fs.readFileSync(path.join(environment.EDUPI_OUTPUT_DIR, "education_intake_state.json"));
      const source = { source_id: "forged-file-source", source_kind: "teacher_file", source_hash: material.source_hash, evidence_ids: [material.material_id, material.staging_id] };
      for (const command of [{ command_type: "import_calendar", source, events: [{ event_id: "forged-event", date: "2026-10-25", end_date: null, name: "伪造安排", type: "meeting", confidence: "teacher_confirmed", notes: null }] },
        { command_type: "import_timetable", source, slots: [{ slot_id: "forged-slot", day_of_week: 1, period: 1, subject: "数学", class_name: "七一班", kind: "class", notes: null }] }]) {
        const { response } = await dispatch(command);
        assert.equal(response.receipt.payload.status, "failed"); assert.equal(response.receipt.payload.reason_code, "file_schedule_unverified");
      }
      assert.deepEqual(fs.readFileSync(path.join(environment.EDUPI_OUTPUT_DIR, "education_intake_state.json")), before);
      const request = { root_ref: root.dataRootFingerprint, expected_owner_id: authorizationStore.read().owner.id,
        material_id: material.material_id, expected_source_hash: material.source_hash, expected_metadata_revision: 0, trusted: true };
      await assert.rejects(readMaterialSchedule({ root, authorizationStore, request }), { code: "material_schedule_invalid" });
    });
    await t.test("changed backing bytes cannot reuse an accepted owner command and manual events remain valid", async () => {
      const { material, payload } = adopted[0], canonical = path.join(dataRoot, material.relative_path), bytes = fs.readFileSync(canonical);
      try {
        const changed = Buffer.from(bytes); changed[changed.length - 1] ^= 1; fs.writeFileSync(canonical, changed);
        assert.equal((await ownerRoute.POST(post("material-schedule", payload))).status, 409);
      } finally { fs.writeFileSync(canonical, bytes); }
      const response = await intakeRoute.POST(post("intake", { kind: "calendar", events: [{ date: "2026-10-25", name: "手动事项", type: "custom" }] }));
      assert.equal(response.status, 200); assert.ok(loadEducationIntakeState().calendar_events.some(item => item.name === "手动事项" && item.state === "confirmed"));
    });
    assert.equal(adopted.length, 2);
    console.log(JSON.stringify({ case: "diagnostic_file_fence_owner_consumer", stable_pairing: false,
      material_count: loadEducationIntakeState().materials.length, owner_apply_calls: ownerCalls.filter(call => call.operation === "material_schedule_apply").length,
      old_source_mutations: 0, external_send: false }));
  } finally {
    await admission?.close();
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
