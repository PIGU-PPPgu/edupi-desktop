#!/usr/bin/env node
// Actual Desktop supervisor/host and public Core routes; retained synthetic data only.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import JSZip from "jszip";
import sharp from "sharp";
import { createJiti } from "jiti";
import { assertMaterialReceiptOnly } from "./material-schedule-e2-client.mjs";

if (process.platform !== "darwin" || parseInt(os.release(), 10) < 22) {
  console.log(JSON.stringify({ status: "skipped", reason: "supported_macos_required" })); process.exit(0);
}
const format = process.argv[2] || "pdf";
assert.ok(["pdf", "png", "jpeg"].includes(format));
assert.ok(process.env.EDUPI_CORE_ROOT && path.isAbsolute(process.env.EDUPI_CORE_ROOT), "EDUPI_CORE_ROOT is required");
const coreRoot = fs.realpathSync(process.env.EDUPI_CORE_ROOT), desktopRoot = path.resolve(new URL("..", import.meta.url).pathname);
const compat = JSON.parse(fs.readFileSync(path.join(desktopRoot, "contracts/edupi-core-compat.json"), "utf8"));
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `edupi-visible-preparation-${format}-`)));
const dataRoot = path.join(root, "data"), home = path.join(dataRoot, ".edupi"), stateDir = path.join(root, "desktop-state"), agentDir = path.join(root, "agent");
for (const directory of [agentDir, stateDir, path.join(home, "memory"), path.join(home, "output"), path.join(home, "locks"), path.join(root, "sources")]) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}
const environment = { EDUPI_PROJECT_ROOT: dataRoot, EDUPI_DATA_ROOT: dataRoot, EDUPI_DATA_ALLOWED_ROOT: root,
  EDUPI_CORE_ROOT: coreRoot, EDUPI_CORE_ALLOWED_ROOT: path.dirname(coreRoot), EDUPI_HOME: home,
  EDUPI_MEMORY_DIR: path.join(home, "memory"), EDUPI_OUTPUT_DIR: path.join(home, "output"), EDUPI_LOCK_DIR: path.join(home, "locks"),
  EDUPI_CORE_COMMIT: compat.core_runtime.core_commit, PI_DESKTOP_STATE_DIR: stateDir, PI_CODING_AGENT_DIR: agentDir,
  PI_DESKTOP_API_TOKEN: "synthetic-visible-preparation-token-0123456789", PI_OFFLINE: "1", EDUPI_SAFE_MODE: "0",
  EDUPI_DESKTOP_ISOLATED_CANARY: "1", EDUPI_AMBIENT_PLANNING: "0" };
const previous = new Map(Object.keys(environment).map(key => [key, process.env[key]]));
Object.assign(process.env, environment);
const hash = value => `sha256:${crypto.createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex")}`;
const evidence = { status: "running", format, core_commit: compat.core_runtime.core_commit,
  desktop_code_commit: execFileSync("git", ["-C", desktopRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), synthetic_only: true,
  environment: { node: process.version, platform: process.platform, architecture: process.arch, os: os.release() },
  wire: [], phases: [], checks: [], external_provider_calls: 0, external_send: false };
const evidenceFile = path.join(root, "evidence.json"), save = () => fs.writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2) + "\n", { mode: 0o600 });
let phase = "initialize", supervisor, provider;
const stamp = name => { phase = name; evidence.phases.push({ phase, at: new Date().toISOString() }); save(); console.log(JSON.stringify({ phase, format })); };
save(); console.log(JSON.stringify({ root, evidence: evidenceFile, cleanup: "retained" }));
try {
  const fromCore = name => import(pathToFileURL(path.join(coreRoot, "scripts", name)).href);
  const [{ createG1TeachingLoopbackProvider }, { makePdfFixture }, { isRegularTeachingDate }] = await Promise.all([
    fromCore("g1_teaching_rehearsal_support.mjs"), fromCore("test_material_pdf_fixture.mjs"), fromCore("teaching_calendar_policy.mjs"),
  ]);
  const packageFixture = JSON.parse(fs.readFileSync(path.join(coreRoot, "fixtures/teaching-quality/linear-equations-v1.json"), "utf8"));
  let selectedMaterialId, selectedContent, expectedTaskId;
  provider = await createG1TeachingLoopbackProvider({ onRequest(record) {
    assert.ok(selectedMaterialId && selectedContent && expectedTaskId, "a public task and confirmed source must precede model execution");
    if (record.phase === "plan") {
      assert.deepEqual(record.input.materials.map(item => item.source_id), [selectedMaterialId], "the first five materials must not replace the teacher's sixth selection");
      assert.equal(record.input.materials[0].content, selectedContent);
      assert.equal(record.input.task.title, "一元一次方程");
      const plan = structuredClone(packageFixture.plan);
      const sourceEquation = /^Solve\s+(2\s*x\s*\+\s*3\s*=\s*7)$/u.exec(selectedContent.trim())?.[1];
      assert.ok(sourceEquation, "the model fixture must copy the current source equation literally");
      plan.objectives = plan.objectives.map(item => ({ ...item, source_id: selectedMaterialId, quote: selectedContent }));
      plan.exercises = plan.exercises.filter(item => item.id === "q1").map(item => ({ ...item, source_id: selectedMaterialId,
        quote: selectedContent, equation_text: sourceEquation }));
      record.reply(plan);
    } else {
      assert.equal(record.sourceId, selectedMaterialId);
      const draft = structuredClone(packageFixture.draft);
      draft.activities = draft.activities.map(item => ({ ...item, exercise_ids: ["q1"] }));
      draft.answers = draft.answers.filter(item => item.exercise_id === "q1");
      draft.preparation = draft.preparation.map(item => ({ ...item, source_ids: [selectedMaterialId] }));
      record.reply(draft);
    }
  } });
  fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "synthetic", defaultModel: "synthetic" }), { mode: 0o600 });
  fs.writeFileSync(path.join(agentDir, "auth.json"), JSON.stringify({ synthetic: { type: "api_key", key: "synthetic-not-a-real-key" } }), { mode: 0o600 });
  fs.writeFileSync(path.join(agentDir, "models.json"), JSON.stringify({ providers: { synthetic: { baseUrl: provider.baseUrl, api: "openai-completions",
    models: [{ id: "synthetic", name: "Synthetic loopback", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 4096 }] } } }), { mode: 0o600 });
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const staging = await jiti.import("../lib/edupi-material-staging.ts");
  const intake = await jiti.import("../lib/edupi-education-intake.ts");
  const snapshots = await jiti.import("../lib/edupi-core-snapshot.ts");
  const processClient = await jiti.import("../lib/edupi-core-process-client.ts");
  const registeredPrompt = await jiti.import("../lib/edupi-registered-prompt.ts");
  const { proactivityConversationId } = await jiti.import("../lib/edupi-proactivity-control.ts");
  const intakeRoute = await jiti.import("../app/api/edupi/intake/route.ts");
  const sourceRoute = await jiti.import("../app/api/edupi/material-excerpt/source/route.ts");
  const proactivityRoute = await jiti.import("../app/api/edupi/proactivity/route.ts");
  const educationRoute = await jiti.import("../app/api/edupi/education/route.ts");
  const artifactRoute = await jiti.import("../app/api/edupi/preparation-artifact/route.ts");
  const feedbackRoute = await jiti.import("../app/api/edupi/teacher-feedback/route.ts");
  supervisor = await jiti.import("../lib/edupi-runtime-supervisor.ts");
  const request = (pathname, method = "GET", body) => new Request("http://localhost" + pathname, { method,
    headers: { host: "localhost", origin: "http://localhost", "x-pi-desktop-token": environment.PI_DESKTOP_API_TOKEN,
      ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const call = async (route, pathname, method = "GET", body, expectedStatus = 200) => {
    const response = await route[method](request(pathname, method, body)); const result = await response.json();
    evidence.wire.push({ pathname, method, ...(body === undefined ? {} : { request: body }), status: response.status, response: result }); save();
    assert.equal(response.status, expectedStatus, `${phase}: ${JSON.stringify(result)}`); return result;
  };
  const rawSnapshot = () => snapshots.readEduPiEducationSnapshot({ requestId: crypto.randomUUID(), scheduleOccurrenceVersion: "1.2" });
  const getHost = () => supervisor.ensureEduPiRuntime(snapshots.resolveEduPiBridgeRoots());
  const ownerCall = async (operation, payload) => {
    const host = await getHost(), response = await host.callOwnerControl(operation, payload);
    evidence.wire.push({ operation, request: payload, response }); save(); assert.equal(response.ok, true, `${operation}: ${response.error_code}`); return response.result;
  };
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  const lessonDate = new Date(Date.parse(`${today}T12:00:00+08:00`) + 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  assert.equal(isRegularTeachingDate(lessonDate), true, "this source rehearsal needs a regular teaching date tomorrow inside Core's 24-hour preparation window");
  const localHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  const startTime = `${String(Math.max(0, localHour - 1)).padStart(2, "0")}:00`;
  const classId = "visual-preparation-703", subject = "数学", slotId = `visual-preparation-${format}-slot`;
  const slot = { slot_id: slotId, day_of_week: new Date(`${lessonDate}T00:00:00.000Z`).getUTCDay() || 7,
    period: 1, subject, class_id: classId, class_name: "合成七三班", start_time: startTime, time_zone: "Asia/Shanghai", kind: "class", notes: null };
  stamp("public_timetable_and_five_interference_uploads");
  await call(feedbackRoute, "/api/edupi/teacher-feedback", "POST", { action: "bootstrap" });
  const timetableSource = { source_id: "visible-preparation-timetable", source_kind: "teacher_message", source_hash: hash(slot), evidence_ids: ["synthetic-timetable"] };
  const imported = await intake.issueEducationIntake({ command_type: "import_timetable", source: timetableSource, slots: [slot] });
  assert.equal(imported.receipt.status, "accepted"); evidence.timetable_receipt = imported.receipt;
  const upload = async (name, bytes, mimeType) => {
    fs.writeFileSync(path.join(root, "sources", name), bytes, { mode: 0o600 });
    const descriptor = staging.stageMaterialInputs([{ name, mimeType, bytes }])[0];
    const received = await call(intakeRoute, "/api/edupi/intake", "POST", { kind: "material", stagingId: descriptor.staging_id,
      title: name, materialKind: "lesson_note", subject, classId });
    assertMaterialReceiptOnly(received); return { descriptor, received, materialId: received.receipt.applied_ids[0] };
  };
  const xml = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const docx = async text => {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file("word/document.xml", `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${xml(text)}</w:t></w:r></w:p></w:body></w:document>`);
    return zip.generateAsync({ type: "nodebuffer" });
  };
  const interference = [];
  for (let index = 1; index <= 5; index++) interference.push((await upload(`未选用材料${index}.docx`, await docx(`第${index}份干扰材料：不要用作本次备课。`),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).materialId);
  assert.equal((await call(educationRoute, "/api/edupi/education")).teacherMaterials.length, 5);
  const settings = await call(proactivityRoute, "/api/edupi/proactivity");
  const enabled = await call(proactivityRoute, "/api/edupi/proactivity", "POST", { enabled: true, classId, subject, expectedUpdatedAt: settings.activation.updatedAt });
  assert.equal(enabled.activation.enabled, true); assert.equal(provider.requests.length, 0);

  const visibleText = "Solve 2x + 3 = 7";
  const bytes = format === "pdf" ? makePdfFixture({ font: "Times-Roman", pages: [[{ text: visibleText, size: 28, y: 700 }]] })
    : await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="360"><rect width="1400" height="360" fill="white"/><text x="60" y="220" font-family="Arial,sans-serif" font-size="90" fill="black">${visibleText}</text></svg>`))[format]().toBuffer();
  const staged = staging.stageMaterialInputs([{ name: `第六份来源.${format}`, bytes, mimeType: format === "pdf" ? "application/pdf" : `image/${format}` }])[0];
  fs.writeFileSync(path.join(root, "sources", `第六份来源.${format}`), bytes, { mode: 0o600 });
  selectedMaterialId = `material-${staged.staging_id.slice("stg_".length)}`;
  const owner = await ownerCall("owner_read", {}), rootRef = owner.root_ref, ownerId = owner.owner.id;
  const scopedGrants = owner.grants.filter(item => item.scope.class_id === classId && item.scope.subject === subject
    && item.domains.length === 1 && item.domains[0] === "teaching_preparation");
  assert.equal(scopedGrants.length, 1); const grant = scopedGrants[0];
  const sourceRef = (kind, id) => `${kind}:${crypto.createHash("sha256").update(id).digest("hex")}`;
  const conversationId = proactivityConversationId("teaching_preparation");
  const sourceIds = [sourceRef("conversation", conversationId), sourceRef("timetable", slotId), sourceRef("material", selectedMaterialId)].sort();
  const spec = { scope: { class_id: classId, subject }, domains: ["teaching_preparation"], actions: ["prepare", "update"], source_ids: sourceIds,
    starts_at: grant.starts_at, ends_at: grant.ends_at, budget: { ...grant.budget, max_calls: 2 } };
  await ownerCall("owner_control", { command_id: "visible-preparation-exact-grant", root_ref: rootRef, expected_owner_id: ownerId,
    action: "update", grant_id: grant.id, expected_version: grant.version, spec });
  evidence.selected_material_id = selectedMaterialId; evidence.interference_material_ids = interference; evidence.grant_source_ids = sourceIds;
  stamp("sixth_visual_source_preview_and_confirmation");
  const received = await call(intakeRoute, "/api/edupi/intake", "POST", { kind: "material", stagingId: staged.staging_id,
    title: `第六份一元一次方程来源 ${format}`, materialKind: "lesson_note", subject, classId });
  assertMaterialReceiptOnly(received); assert.equal(received.receipt.applied_ids[0], selectedMaterialId);
  assert.equal((await call(educationRoute, "/api/edupi/education")).teacherMaterials.length, 6);
  const preview = (await call(sourceRoute, `/api/edupi/material-excerpt/source?materialId=${encodeURIComponent(selectedMaterialId)}`)).preview;
  assert.equal(preview.status, "ready", JSON.stringify(preview)); assert.equal(preview.format, format === "pdf" ? "pdf" : "image");
  selectedContent = preview.blocks.map(item => item.text).join("\n");
  assert.equal(selectedContent.replace(/\s+/gu, ""), visibleText.replace(/\s+/gu, ""), "visible equation must match before the synthetic teacher confirms it");
  const sourceSpans = preview.blocks.map(item => ({ path: item.path, start: 0, end: item.text.length }));
  const review = { materialId: selectedMaterialId, expectedRevision: 0, expectedBasisHash: preview.basis_hash, sourceSpans,
    ...(format === "pdf" ? {} : { confirmSourceText: true }) };
  if (format !== "pdf") {
    const noTextReview = { ...review }; delete noTextReview.confirmSourceText;
    await call(sourceRoute, "/api/edupi/material-excerpt/source", "POST", noTextReview, 400);
  }
  const confirmed = await call(sourceRoute, "/api/edupi/material-excerpt/source", "POST", review);
  assert.equal(confirmed.excerpt.source_kind, format === "pdf" ? "pdf_visible_fragment" : "image_reviewed_fragment");
  assert.equal(provider.requests.length, 0, "source confirmation cannot start generation");

  stamp("public_selected_task_before_owner_capture");
  expectedTaskId = `visible-preparation-${format}-task`;
  const task = { task_id: expectedTaskId, title: "一元一次方程", due_date: lessonDate, note: "合成教师显式选择第六份来源",
    preparation_source: { kind: "teaching_before_class", timetable_slot_id: slotId, lesson_date: lessonDate,
      material_ids: [selectedMaterialId], deliverables: packageFixture.input.deliverables } };
  const beforeTask = await rawSnapshot(), commandId = `visible-preparation-create-${format}`;
  const envelope = intake.buildEducationIntakeCommandEnvelope({ snapshotId: beforeTask.payload.snapshot_id, requestId: commandId,
    messageId: commandId, idempotencyKey: commandId, command: { command_type: "create_task", task,
      source: { source_id: commandId, source_kind: "teacher_message", source_hash: hash(task), evidence_ids: [commandId] } } });
  const created = await processClient.runCoreProcess({ ...snapshots.resolveEduPiBridgeRoots(), timeoutMs: 15_000,
    request: { protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop", request_id: commandId, operation: "command", envelope } });
  assert.equal(created.ok, true); assert.equal(created.receipt.payload.status, "accepted", JSON.stringify(created)); evidence.task_receipt = created.receipt;
  const host = await getHost(), health = await host.call("health", null); assert.equal(health.ok, true);
  assert.equal(health.result.capabilities.g1_processor, "active"); assert.equal(health.result.capabilities.owner_message_registration, "active");
  const preCapture = await host.call("prepare_due", null); assert.equal(preCapture.ok, true); assert.equal(preCapture.result.tasks.length, 0);
  assert.equal(provider.requests.length, 0);
  const currentGrant = (await ownerCall("owner_read", {})).grants.find(item => item.id === grant.id);
  const readBindings = () => ownerCall("owner_goal_bindings_read", { root_ref: rootRef, expected_owner_id: ownerId,
    grant_id: grant.id, expected_grant_version: currentGrant.version });
  assert.deepEqual((await readBindings()).bindings, []);

  stamp("registered_owner_capture_automatically_creates_goal_and_durable_queue");
  const prompt = await registeredPrompt.registerAndCapturePrompt(host, { rootRef, grantId: grant.id, sessionId: `visible-preparation-${format}-session`,
    messageId: `visible-preparation-${format}-message`, occurredAt: new Date().toISOString(), text: `帮我准备${lessonDate}的数学教案，一元一次方程`,
    domain: "teaching_preparation", carrierId: "desktop-visible-preparation-e2", planId: `visible-preparation-${format}` }, {
    onBound(binding) { evidence.capture_binding = binding; save(); },
    onRegistered(proof) { evidence.registered_message_ref = proof.messageRef; save(); },
    onCaptured(proof) { evidence.captured_message_ref = proof.messageRef; save(); },
  });
  let readyData, workCase;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    readyData = await call(educationRoute, "/api/edupi/education"); workCase = readyData.workCases.find(item => item.taskId === expectedTaskId);
    if (workCase?.currentState === "draft_ready") break;
    assert.notEqual(workCase?.currentState, "failed", JSON.stringify(workCase));
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(workCase?.currentState, "draft_ready", JSON.stringify({ workCase, requests: provider.requests.map(item => item.phase) }));
  const bindings = (await readBindings()).bindings.filter(item => item.message_ref === prompt.messageRef);
  assert.equal(bindings.length, 1); assert.equal(bindings[0].task_id, expectedTaskId); assert.ok(bindings[0].goal_id);
  evidence.goal_binding = bindings[0];
  assert.deepEqual(provider.requests.map(item => item.phase), ["plan", "draft"], "the actual Desktop host must use the default Durable plan/draft path");
  assert.deepEqual(provider.errors, []);
  evidence.model_calls = provider.requests.map(({ phase, sourceId, input }) => ({ phase, source_id: sourceId, input }));
  const { prepareCoreRuntimeRoot } = await fromCore("core_runtime_root.mjs");
  assert.equal(fs.existsSync(path.join(prepareCoreRuntimeRoot(dataRoot).runtimeDirectory, "teaching-preparation-durable-v1.sqlite")), true);

  stamp("desktop_artifact_reads_review_and_synthetic_feedback");
  const artifacts = readyData.generatedArtifacts.filter(item => item.task_id === expectedTaskId && item.origin === "preparation");
  assert.equal(artifacts.length, 4); assert.equal(workCase.artifactIds.length, 4);
  const contents = [];
  for (const artifact of artifacts) {
    const value = await call(artifactRoute, `/api/edupi/preparation-artifact?artifactId=${encodeURIComponent(artifact.artifact_id)}`);
    assert.ok(value.artifact.content.trim()); contents.push({ artifact_id: artifact.artifact_id, content_hash: hash(value.artifact.content), title: artifact.title });
    fs.writeFileSync(path.join(root, `artifact-${contents.length}.md`), value.artifact.content, { mode: 0o600 });
  }
  evidence.artifacts = contents;
  const reviewSnapshot = await rawSnapshot(), target = reviewSnapshot.payload.review_targets.find(item => item.projection_kind === "work_candidate"
    && (item.target.target_id === expectedTaskId || item.evidence_ids.includes(expectedTaskId)));
  assert.ok(target, "the public snapshot must expose the same candidate for review");
  const reviewed = await call(educationRoute, "/api/edupi/education", "POST", { commandType: "review_work_candidate", candidateId: target.target.target_id,
    expectedSnapshotId: reviewSnapshot.payload.snapshot_id, expectedRevision: target.revision, decision: "accept", patch: null, note: null });
  assert.equal(reviewed.receipt.status, "accepted", JSON.stringify(reviewed.receipt));
  const feedbackTarget = await call(feedbackRoute, "/api/edupi/teacher-feedback", "POST", { action: "target_read", target: { kind: "work_candidate", target_id: expectedTaskId } });
  assert.equal(feedbackTarget.ok, true); const feedbackBasis = feedbackTarget.result;
  const feedback = { command_id: `visible-preparation-${format}-feedback`, session_id: `visible-preparation-${format}-session`, evidence_level: "synthetic",
    domain: "teaching_preparation", scope: { class_id: classId, subject }, signal: "surfaced",
    target: { kind: feedbackBasis.kind, target_id: feedbackBasis.target_id, expected_revision: feedbackBasis.revision, expected_fingerprint: feedbackBasis.fingerprint },
    decision: "accept", usefulness: "useful", used: false, would_use_again: null, baseline_minutes: null, review_minutes: null,
    issue_codes: [], note: "合成来源消费链验收", evidence_ids: feedbackBasis.evidence_ids, occurred_at: new Date().toISOString(), supersedes_feedback_id: null };
  const recorded = await call(feedbackRoute, "/api/edupi/teacher-feedback", "POST", { action: "record", record: feedback });
  assert.equal(recorded.ok, true, JSON.stringify(recorded)); assert.equal(recorded.result.replayed, false);
  const readFeedback = () => call(feedbackRoute, "/api/edupi/teacher-feedback", "POST", { action: "read", session_id: feedback.session_id });
  const persistedFeedback = await readFeedback();
  assert.equal(persistedFeedback.result.feedback.length, 1); assert.equal(persistedFeedback.result.feedback[0].source_status, "current");
  assert.equal(persistedFeedback.result.feedback[0].evidence_level, "synthetic");

  stamp("actual_desktop_host_cold_restart_preserves_artifacts_feedback_and_reservations");
  const initialInstance = health.result.instance_nonce, initialGeneration = health.result.fencing_generation;
  await supervisor.closeAllEduPiRuntimes();
  const coldHost = await getHost(), coldHealth = await coldHost.call("health", null); assert.equal(coldHealth.ok, true);
  assert.notEqual(coldHealth.result.instance_nonce, initialInstance); assert.ok(coldHealth.result.fencing_generation > initialGeneration);
  const coldData = await call(educationRoute, "/api/edupi/education");
  assert.equal(coldData.tasks.find(item => item.id === expectedTaskId)?.status, "accepted");
  const coldWorkCase = coldData.workCases.find(item => item.taskId === expectedTaskId);
  assert.equal(coldWorkCase?.currentState, "draft_ready");
  assert.equal(coldWorkCase.executionRevision, workCase.executionRevision); assert.equal(coldWorkCase.artifactRevision, workCase.artifactRevision);
  assert.deepEqual(coldWorkCase.transitions, workCase.transitions, "a cold restart must not create even a rejected duplicate execution attempt");
  assert.deepEqual(coldData.generatedArtifacts.filter(item => item.task_id === expectedTaskId).map(item => item.artifact_id).sort(), artifacts.map(item => item.artifact_id).sort());
  for (const artifact of contents) {
    const value = await call(artifactRoute, `/api/edupi/preparation-artifact?artifactId=${encodeURIComponent(artifact.artifact_id)}`);
    assert.equal(hash(value.artifact.content), artifact.content_hash);
  }
  const coldFeedback = await readFeedback(); assert.equal(coldFeedback.result.feedback.length, 1);
  assert.equal(coldFeedback.result.feedback[0].source_status, "current");
  const coldBudget = (await ownerCall("owner_read", {})).g1_model_budget.find(item => item.grant_id === grant.id);
  assert.equal(coldBudget.used_calls, 2);
  assert.equal(provider.requests.length, 2, "cold recovery cannot recreate the plan, draft or signed reservations");
  evidence.cold_recovery = { distinct_instance: true, fencing_generation_increased: true, model_calls: 2, artifact_hashes_unchanged: true,
    feedback_count: 1, feedback_source_status: "current", budget_used_calls: coldBudget.used_calls };
  evidence.checks = ["five_interference_then_sixth_visual", "real_source_preview_and_confirmation", "strict_source_grant", "registered_owner_natural_goal_queue",
    "desktop_isolated_durable_plan_draft", "four_desktop_artifact_reads", "public_work_review", "synthetic_feedback_write_read", "actual_host_cold_restart_no_repeat"];
  evidence.status = "passed";
} catch (error) {
  evidence.model_attempts = provider?.requests.map(({ phase, sourceId, input }) => ({ phase, source_id: sourceId, input })) || [];
  evidence.provider_errors = provider?.errors.map(error => String(error).split("\n")[0]) || [];
  evidence.status = "failed"; evidence.failure = { phase, code: error.code || error.name, message: error.message }; throw error;
} finally {
  try { await supervisor?.closeAllEduPiRuntimes(); } finally {
    await provider?.close(); save();
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    console.log(JSON.stringify({ status: evidence.status, phase, format, core_commit: evidence.core_commit, root, evidence: evidenceFile,
      model_calls: provider?.requests.length ?? 0, runtime_and_provider_closed: true, cleanup: "retained", external_send: false }));
  }
}
