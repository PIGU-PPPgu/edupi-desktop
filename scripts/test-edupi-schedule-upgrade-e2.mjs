#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createJiti } from "jiti";

// Run each phase in a new process, with the repository's actual paired pin.
// --legacy-seed --checkpoint /absolute/evidence/seed.json
// --verify-current --checkpoint /absolute/evidence/seed.json
// Both phases deliberately retain the synthetic root for upgrade evidence.
const { values } = parseArgs({ options: { "legacy-seed": { type: "boolean" }, "verify-current": { type: "boolean" }, checkpoint: { type: "string" } } });
assert.notEqual(Boolean(values["legacy-seed"]), Boolean(values["verify-current"]), "select exactly one phase");
assert.ok(values.checkpoint && path.isAbsolute(values.checkpoint), "--checkpoint must be an absolute path");
const checkpointFile = path.resolve(values.checkpoint), legacy = Boolean(values["legacy-seed"]);
const phase = legacy ? "legacy-seed" : "verify-current", oldCommit = "03bbb893bb609eb68513a65cf4fd808ab8aa30ed";
const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hash = value => `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const write = (file, value, exclusive = false) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: exclusive ? "wx" : "w" });
assert.ok(process.env.EDUPI_CORE_ROOT && path.isAbsolute(process.env.EDUPI_CORE_ROOT), "EDUPI_CORE_ROOT must be an absolute path");
const coreRoot = fs.realpathSync(process.env.EDUPI_CORE_ROOT);
const coreCommit = execFileSync("git", ["-C", coreRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const compatFile = path.join(desktopRoot, "contracts/edupi-core-compat.json"), compat = read(compatFile);
assert.equal(coreCommit, compat.core_runtime.core_commit, "the actual Core tree must match the real Desktop pin");
if (legacy) { assert.equal(coreCommit, oldCommit); assert.equal(fs.existsSync(checkpointFile), false, "never replace an old upgrade checkpoint"); }
const seed = legacy ? null : read(checkpointFile);
if (seed) { assert.equal(seed.test, "edupi-schedule-upgrade-v1"); assert.equal(seed.status, "seeded"); assert.equal(seed.runtimeClosed, true); assert.equal(seed.identity.coreCommit, oldCommit); assert.notEqual(coreCommit, oldCommit); }
const { createG1TeachingRehearsalRoot, createG1TeachingLoopbackProvider } = await import(pathToFileURL(path.join(coreRoot, "scripts/g1_teaching_rehearsal_support.mjs")).href);
const temporaryRoot = seed?.temporaryRoot ?? createG1TeachingRehearsalRoot({ prefix: "edupi-schedule-upgrade-" });
assert.equal(fs.realpathSync(temporaryRoot), temporaryRoot);
assert.equal(path.dirname(temporaryRoot), fs.realpathSync(os.tmpdir()));
assert.match(path.basename(temporaryRoot), /^edupi-schedule-upgrade-[A-Za-z0-9]+$/u);
const dataRoot = path.join(temporaryRoot, "teacher-data"), stateDir = path.join(temporaryRoot, "desktop-state"), agentDir = path.join(temporaryRoot, "agent");
const memoryDir = path.join(dataRoot, ".edupi/memory"), outputDir = path.join(dataRoot, ".edupi/output");
for (const directory of [agentDir, stateDir, memoryDir, outputDir, path.join(dataRoot, ".edupi/locks")]) {
  if (legacy) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  assert.equal(fs.realpathSync(directory), directory);
}
const day = offset => new Date(Date.now() + offset * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
const today = day(0), lessonDate = seed?.lessonDate ?? day(1);
assert.ok(lessonDate >= today, "the real lesson date passed; do not alter the clock or renew the old grant");
const slot = seed?.slot ?? { slot_id: "synthetic-upgrade-slot", subject: "数学", class_id: "703", class_name: "703",
  day_of_week: new Date(`${lessonDate}T12:00:00Z`).getUTCDay() || 7, period: 2, start_time: "09:00", time_zone: "Asia/Shanghai", kind: "class", notes: "一元一次方程" };
const teachingFixture = read(path.join(coreRoot, "fixtures/teaching-quality/linear-equations-v1.json"));
const materialText = teachingFixture.materials[0].content;
if (legacy) {
  write(path.join(memoryDir, "calendar.json"), { events: [] });
  write(path.join(memoryDir, "timetable.json"), { slots: [] });
  write(path.join(memoryDir, "preferences.json"), { entries: [] });
  write(path.join(memoryDir, "semester.json"), { start_date: today, end_date: lessonDate, entries: [] });
} else {
  for (const [relative, expected] of Object.entries(seed.sourceFiles)) assert.equal(hash(fs.readFileSync(path.join(dataRoot, relative))), expected, `preserved source changed before new Runtime: ${relative}`);
  assert.equal(hash(fs.readFileSync(path.join(stateDir, "edupi-proactivity.json"))), seed.activationHash, "do not rewrite or renew the old activation");
}
const desktopToken = crypto.randomBytes(32).toString("hex");
Object.assign(process.env, { PI_CODING_AGENT_DIR: agentDir, PI_DESKTOP_STATE_DIR: stateDir, PI_DESKTOP_API_TOKEN: desktopToken,
  PI_OFFLINE: "1", EDUPI_SAFE_MODE: "0", EDUPI_DESKTOP_ISOLATED_CANARY: "1", EDUPI_CORE_ROOT: coreRoot,
  EDUPI_CORE_ALLOWED_ROOT: path.dirname(coreRoot), EDUPI_CORE_VALIDATION_MODE: "external", EDUPI_DATA_ROOT: dataRoot,
  EDUPI_DATA_ALLOWED_ROOT: temporaryRoot, EDUPI_PROJECT_ROOT: dataRoot, EDUPI_HOME: path.join(dataRoot, ".edupi"),
  EDUPI_MEMORY_DIR: memoryDir, EDUPI_OUTPUT_DIR: outputDir, EDUPI_LOCK_DIR: path.join(dataRoot, ".edupi/locks"),
  EDUPI_DATA_DIR: path.join(dataRoot, "data"), EDUPI_CONFIG_DIR: path.join(dataRoot, "config"), EDUPI_SKILLS_DIR: path.join(dataRoot, "skills") });
delete process.env.EDUPI_AMBIENT_PLANNING;
let materialId = seed?.materialId;
const provider = await createG1TeachingLoopbackProvider({ onRequest(record) {
  if (record.phase === "plan") { assert.equal(record.input.materials.length, 1); assert.equal(record.input.materials[0].source_id, materialId); assert.equal(record.input.materials[0].content, materialText); }
  record.reply();
} });
write(path.join(agentDir, "models.json"), { providers: { local: { api: "openai-completions", apiKey: "synthetic-upgrade-only",
  baseUrl: provider.baseUrl, models: [{ id: "local", name: "Synthetic upgrade loopback", input: ["text"], reasoning: false,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 4096 }] } } });
if (legacy) write(path.join(agentDir, "settings.json"), { defaultProvider: "local", defaultModel: "local", extensions: [], packages: [], skills: [], cacheWarming: "off" });
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const load = relative => jiti.import(path.join(desktopRoot, relative));
const [education, proactivity, preparation, excerpt, artifact, feedback, executionRoute, executionClient, feedbackClient, intake, staging, materialFlow, supervisor, snapshots] = await Promise.all([
  load("app/api/edupi/education/route.ts"), load("app/api/edupi/proactivity/route.ts"), load("app/api/edupi/preparation/route.ts"),
  load("app/api/edupi/material-excerpt/route.ts"), load("app/api/edupi/preparation-artifact/route.ts"), load("app/api/edupi/teacher-feedback/route.ts"),
  load("app/api/edupi/tasks/[taskId]/execution/route.ts"), load("lib/edupi-preparation-execution-client.ts"), load("lib/edupi-teacher-feedback.ts"),
  load("lib/edupi-education-intake.ts"), load("lib/edupi-material-staging.ts"), load("lib/edupi-material-intake-flow.ts"),
  load("lib/edupi-runtime-supervisor.ts"), load("lib/edupi-core-snapshot.ts"),
]);
const headers = { host: "localhost", origin: "http://localhost", "sec-fetch-site": "same-origin", "content-type": "application/json", "x-pi-desktop-token": desktopToken };
const request = (url, body) => new Request(new URL(url, "http://localhost"), { method: body === undefined ? "GET" : "POST", headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const json = async response => ({ status: response.status, body: await response.json() });
const ok = async response => { const value = await json(response); assert.equal(value.status, 200, JSON.stringify(value)); assert.notEqual(value.body.ok, false, JSON.stringify(value)); return value.body; };
const publicRead = () => education.GET().then(ok);
const taskId = `teaching_before_class:timetable:${slot.slot_id}:${lessonDate}`;
const context = { params: Promise.resolve({ taskId }) };
const nativeHeaders = async initial => new Headers({ ...headers, ...Object.fromEntries(new Headers(initial || {})) });
const executionFetcher = (url, init) => { const req = new Request(new URL(url, "http://localhost"), init); return init.method === "POST" ? executionRoute.POST(req, context) : executionRoute.GET(req, context); };
const feedbackFetcher = (url, init) => feedback.POST(new Request(new URL(url, "http://localhost"), init));
const readExecution = revision => executionClient.readPreparationExecution(taskId, revision, undefined, executionFetcher, nativeHeaders);
const report = { test: "edupi-schedule-upgrade-v1", phase, status: "running", temporaryRoot, dataRoot, lessonDate, slot,
  identity: { coreRoot, coreCommit, compatHash: hash(fs.readFileSync(compatFile)), desktopCommit: execFileSync("git", ["-C", desktopRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() },
  realClock: true, externalNetwork: false, externalSend: false, manualTasksCreated: 0, runtimeClosed: false };
const outputFile = legacy ? checkpointFile : `${checkpointFile}.current.json`;
async function ready() {
  const deadline = Date.now() + 30000;
  let data;
  while (Date.now() < deadline) {
    data = await publicRead();
    const candidate = data.workCandidates.find(item => item.taskId === taskId), work = data.workCases.find(item => item.taskId === taskId), task = data.tasks.find(item => item.id === taskId);
    if (candidate && task && work?.currentState === "draft_ready") {
      const run = await readExecution(candidate.revision);
      if (run.state === "draft_ready" && run.source_current && task.deliverables.length > 0 && run.artifact_ids.length === task.deliverables.length) return { data, candidate, work, run };
    }
    if (provider.errors.length || work?.currentState === "failed") break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  report.automaticGeneration = { passed: false, providerErrors: provider.errors, modelPhases: provider.requests.map(item => item.phase),
    candidates: data?.workCandidates, workCases: data?.workCases, executions: fs.existsSync(path.join(outputDir, "calendar_work_execution_state.json")) ? read(path.join(outputDir, "calendar_work_execution_state.json")) : null };
  throw new Error("automatic current-source draft did not become ready; stale rejection alone is incomplete");
}
const feedbackInput = candidate => ({ commandId: `upgrade-feedback-${crypto.randomUUID()}`, sessionId: "synthetic-schedule-upgrade", evidenceLevel: "synthetic",
  domain: "teaching_preparation", scope: { classId: slot.class_id, subject: slot.subject }, signal: "surfaced",
  target: { kind: "work_candidate", targetId: candidate.candidateId }, reviewedRevision: candidate.revision,
  decision: "hold", usefulness: "not_observed", used: false, wouldUseAgain: null, baselineMinutes: null, reviewMinutes: null,
  issueCodes: [], note: "合成升级反馈", evidenceIds: candidate.evidenceIds, occurredAt: new Date().toISOString(), supersedesFeedbackId: null });
try {
  const roots = snapshots.resolveEduPiBridgeRoots(); // Full production manifest/pin/file validation.
  assert.equal(roots.runtime.coreCommit, coreCommit);
  report.identity.desktopComponentManifestHash = roots.runtime.componentManifestHash;
  if (legacy) {
    const imported = await intake.issueEducationIntake({ command_type: "import_timetable", source: { source_id: "synthetic-upgrade-timetable",
      source_kind: "teacher_message", source_hash: hash(JSON.stringify(slot)), evidence_ids: ["synthetic-upgrade-schedule"] }, slots: [slot] });
    assert.equal(imported.receipt.status, "accepted");
    const descriptor = staging.stageMaterialInputs([{ name: "synthetic-upgrade-equations.pdf", mimeType: "application/pdf", bytes: new Uint8Array(Buffer.from(`%PDF-1.4\n${materialText}\n`)) }])[0];
    materialId = `material-${descriptor.staging_id.slice("stg_".length)}`;
    const material = await materialFlow.intakeRecognizedMaterial({ descriptor, title: "一元一次方程合成材料", materialKind: "lesson_note", subject: slot.subject, classId: slot.class_id, recognize: false });
    assert.equal(material.receipts[0].status, "accepted");
    await ok(await excerpt.POST(request("/api/edupi/material-excerpt", { materialId, expectedRevision: 0, content: materialText, decision: "confirm" })));
    await ok(await feedback.POST(request("/api/edupi/teacher-feedback", { action: "bootstrap" })));
    const before = await ok(await proactivity.GET(request("/api/edupi/proactivity")));
    assert.equal(before.activation.enabled, false); assert.equal(before.scopes.find(item => item.classId === slot.class_id && item.subject === slot.subject)?.ready, true);
    const enabled = await ok(await proactivity.POST(request("/api/edupi/proactivity", { enabled: true, classId: slot.class_id, subject: slot.subject, expectedUpdatedAt: before.activation.updatedAt })));
    assert.equal(enabled.activation.enabled, true);
    report.initialScan = enabled.initialScan;
  } else {
    const started = await ok(await preparation.POST(request("/api/edupi/preparation", { action: "ensure" })));
    assert.notEqual(started.state, "error", JSON.stringify(started)); // The same startup/resume scan used by Desktop.
  }
  const host = await supervisor.ensureEduPiRuntime(roots), health = await host.call("health", null);
  assert.equal(health.ok, true); assert.equal(health.result.core_commit, coreCommit);
  const owner = await host.callOwnerControl("owner_read", {});
  assert.equal(owner.ok, true); report.ownerId = owner.result.owner.id; report.rootRef = owner.result.root_ref;
  const activation = read(path.join(stateDir, "edupi-proactivity.json"));
  const grant = owner.result.grants.find(item => item.id === activation.grant_id);
  assert.ok(grant); assert.equal(grant.status, "active"); assert.ok(Date.parse(grant.ends_at) > Date.now(), "the original grant expired; do not extend it for this test");
  report.grant = Object.fromEntries(["id", "version", "status", "scope", "starts_at", "ends_at", "source_ids", "budget"].map(key => [key, grant[key]]));
  if (seed) {
    assert.equal(report.ownerId, seed.ownerId); assert.equal(report.rootRef, seed.rootRef);
    assert.deepEqual(report.grant, seed.grant, "the upgrade must reuse the original grant without renewal or scope changes");
    report.sameOwnerAndRoot = true;
    const data = await publicRead(), candidate = data.workCandidates.find(item => item.taskId === taskId);
    assert.ok(candidate, "same automatic candidate must survive upgrade");
    const oldSource = await host.callOwnerControl("preparation_execution_read", { root_ref: report.rootRef, expected_owner_id: report.ownerId,
      task_id: taskId, expected_task_revision: candidate.revision, expected_source_revision: seed.execution.source_revision });
    assert.equal(oldSource.ok, true, JSON.stringify(oldSource));
    assert.equal(oldSource.result.source_current, false); assert.equal(oldSource.result.state, "stale"); assert.equal(oldSource.result.actions.retry, false);
    report.oldSourceRead = oldSource.result;
    const oldWrite = await json(await executionRoute.POST(request(`/api/edupi/tasks/${encodeURIComponent(taskId)}/execution`, { action: "retry",
      eventId: seed.execution.event_id, attempt: seed.execution.attempt, revision: candidate.revision, sourceRevision: seed.execution.source_revision }), context));
    assert.equal(oldWrite.status, 409); assert.ok(["stale_source", "stale_binding"].includes(oldWrite.body.errorCode)); report.oldExecutionWrite = oldWrite;
    for (const saved of seed.artifacts) {
      const oldRead = await json(await artifact.GET(request(`/api/edupi/preparation-artifact?artifactId=${encodeURIComponent(saved.id)}`)));
      const oldEdit = await json(await artifact.POST(request("/api/edupi/preparation-artifact", { artifactId: saved.id, expectedRevision: saved.revision, content: "SYNTHETIC_OBSOLETE_WRITE_MUST_FAIL" })));
      assert.equal(oldRead.status, 409); assert.equal(oldRead.body.code, "stale_source"); assert.equal(oldEdit.status, 409); assert.equal(oldEdit.body.code, "stale_source");
    }
    report.oldArtifactsRejected = seed.artifacts.length;
    await assert.rejects(feedbackClient.recordTeacherFeedback({ ...seed.feedbackCapture, commandId: `obsolete-feedback-${crypto.randomUUID()}`, occurredAt: new Date().toISOString() }, feedbackFetcher, nativeHeaders), error => error.code === "teacher_feedback_target_stale");
    report.oldFeedbackWriteRejected = true;
    const replay = await feedbackClient.recordTeacherFeedback(seed.feedbackCapture, feedbackFetcher, nativeHeaders);
    assert.equal(replay.replayed, true); assert.equal(replay.feedbackId, seed.feedbackResult.feedbackId); report.historicalFeedbackReplay = replay;
    const feedbackRead = await ok(await feedback.GET(request("/api/edupi/teacher-feedback")));
    const historical = feedbackRead.result.feedback.find(item => item.feedback_id === seed.feedbackResult.feedbackId);
    assert.equal(historical?.source_status, "historical"); report.oldFeedbackHistorical = true;
  }
  const current = await ready(), raw = read(path.join(outputDir, "teacher_review_state.json")).work_candidates.find(item => item.task_id === taskId);
  const boardFile = path.join(outputDir, "task_board_state.json");
  assert.equal((fs.existsSync(boardFile) ? read(boardFile).manual_tasks || [] : []).length, 0, "automatic G1 must not be replaced by a manual task");
  assert.equal(provider.errors.length, 0); assert.deepEqual(provider.requests.map(item => item.phase), ["plan", "draft"]);
  const artifacts = [];
  for (const id of current.run.artifact_ids) {
    const value = await ok(await artifact.GET(request(`/api/edupi/preparation-artifact?artifactId=${encodeURIComponent(id)}`)));
    assert.ok(value.artifact.content); artifacts.push({ id, revision: value.artifact.revision, sha256: hash(value.artifact.content) });
  }
  if (seed) {
    assert.equal(current.candidate.candidateId, seed.candidateId); assert.ok(current.candidate.revision > seed.candidateRevision);
    assert.notEqual(raw.source_semantic_fingerprint, seed.sourceFingerprint); assert.notEqual(raw.source_slot_fingerprint, seed.slotFingerprint);
    assert.notEqual(current.run.source_revision, seed.execution.source_revision); assert.notEqual(current.run.event_id, seed.execution.event_id);
    assert.notEqual(current.run.execution_id, seed.execution.execution_id); assert.equal(artifacts.some(item => seed.artifacts.some(old => old.id === item.id)), false);
  }
  const capture = await feedbackClient.prepareTeacherFeedbackCapture(feedbackInput(current.candidate), feedbackFetcher, nativeHeaders);
  const recorded = await feedbackClient.recordTeacherFeedback(capture, feedbackFetcher, nativeHeaders);
  assert.equal(recorded.current, true); assert.equal(recorded.replayed, false);
  const feedbackRead = await ok(await feedback.GET(request("/api/edupi/teacher-feedback")));
  assert.equal(feedbackRead.result.feedback.find(item => item.feedback_id === recorded.feedbackId)?.source_status, "current");
  if (seed) assert.equal(feedbackRead.result.feedback.find(item => item.feedback_id === seed.feedbackResult.feedbackId)?.source_status, "historical");
  Object.assign(report, { status: legacy ? "seeded" : "passed", materialId, taskId, candidateId: current.candidate.candidateId,
    candidateRevision: current.candidate.revision, sourceFingerprint: raw.source_semantic_fingerprint, slotFingerprint: raw.source_slot_fingerprint,
    execution: current.run, artifacts, feedbackCapture: capture, feedbackResult: recorded, feedbackSummary: feedbackRead.result.summary,
    deliverables: current.data.tasks.find(item => item.id === taskId).deliverables,
    automaticGeneration: { passed: true, modelPhases: provider.requests.map(item => item.phase), artifactCount: artifacts.length },
    activationHash: hash(fs.readFileSync(path.join(stateDir, "edupi-proactivity.json"))), sourceFiles: Object.fromEntries([
      ".edupi/memory/timetable.json", ".edupi/memory/calendar.json", ".edupi/memory/semester.json",
      ...current.data.teacherMaterials.filter(item => item.material_id === materialId).map(item => item.relative_path),
    ].map(relative => [relative, hash(fs.readFileSync(path.join(dataRoot, relative)))])), completedAt: new Date().toISOString() });
} catch (error) {
  report.status = "failed"; report.error = { message: error.message, code: error.code ?? null, stack: error.stack };
  process.exitCode = 1;
} finally {
  await supervisor.closeAllEduPiRuntimes();
  report.runtimeClosed = supervisor.getPendingEduPiRuntime(dataRoot) === null && supervisor.getActiveEduPiRuntime(dataRoot) === null;
  if (!report.runtimeClosed) { report.status = "failed"; report.error = { message: "the test Runtime did not close" }; process.exitCode = 1; }
  await provider.close();
  write(report.status === "failed" ? `${outputFile}.failed.json` : outputFile, report, true);
  console.log(JSON.stringify({ phase, status: report.status, coreCommit, temporaryRoot, checkpoint: report.status === "failed" ? `${outputFile}.failed.json` : outputFile,
    sourceRejected: report.oldSourceRead?.source_current === false, oldFeedbackHistorical: report.oldFeedbackHistorical ?? null,
    automaticGeneration: report.automaticGeneration, runtimeClosed: report.runtimeClosed, error: report.error?.message ?? null }));
}
