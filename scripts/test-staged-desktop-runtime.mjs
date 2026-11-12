#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stagedReadinessDiagnostic, waitForStagedRuntime } from "./staged-runtime-readiness.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const compat = JSON.parse(fs.readFileSync(path.join(root, "contracts/edupi-core-compat.json"), "utf8"));
const resources = path.resolve(process.env.EDUPI_STAGED_RESOURCES || path.join(root, "src-tauri/resources"));
const stagedServerDir = path.join(resources, "server");
const nodeBinary = process.platform === "darwin"
  ? path.join(resources, "Pi Agent Server.app/Contents/MacOS/node")
  : path.join(resources, "node", process.platform === "win32" ? "node.exe" : "node");
const stagedCoreRoot = path.join(resources, "edupi-core");
const identityOnly = process.env.EDUPI_STAGED_IDENTITY_ONLY === "1";
const headlessBoot = process.env.EDUPI_STAGED_HEADLESS_BOOT === "1";
const statusDiagnostic = process.env.EDUPI_STAGED_STATUS_DIAGNOSTIC === "1";
const sourceAdminE2 = process.env.EDUPI_STAGED_SOURCE_ADMIN_E2 === "1";
const sourceAdminReview = process.env.EDUPI_STAGED_SOURCE_ADMIN_REVIEW || "hold";
if (sourceAdminE2 && !["accept", "modify", "reject", "hold"].includes(sourceAdminReview)) throw new Error("invalid staged admin review decision");
if (identityOnly && headlessBoot) throw new Error("identity-only and headless boot checks are mutually exclusive");
for (const required of [
  stagedServerDir,
  nodeBinary,
  stagedCoreRoot,
  path.join(stagedServerDir, "mobile-gateway.cjs"),
  path.join(stagedServerDir, "node_modules/next/package.json"),
  path.join(stagedServerDir, "node_modules/next/dist/server/lib/start-server.js"),
]) assert.equal(fs.existsSync(required), true, `missing staged resource: ${required}`);
const occurrenceIdentity = compat.contract_identities.find((item) => item.contract_id === "edupi-schedule-occurrence-v1.2");
assert.ok(occurrenceIdentity, "missing schedule occurrence compatibility identity");
const occurrenceSchema = path.join(stagedCoreRoot, occurrenceIdentity.schema_path);
const occurrenceHash = path.join(stagedCoreRoot, "contracts/edupi-schedule-occurrence-v1.2-hash.json");
const runtimeSchemaHash = path.join(stagedCoreRoot, "contracts/edupi-core-runtime-v1-hash.json");
for (const required of [occurrenceSchema, occurrenceHash, runtimeSchemaHash]) assert.equal(fs.existsSync(required), true, `missing staged Core contract: ${required}`);
assert.deepEqual(JSON.parse(fs.readFileSync(occurrenceSchema, "utf8")), JSON.parse(fs.readFileSync(path.join(root, occurrenceIdentity.schema_path), "utf8")));
assert.equal(JSON.parse(fs.readFileSync(occurrenceHash, "utf8")).schema_hash, occurrenceIdentity.schema_hash);
assert.equal(JSON.parse(fs.readFileSync(runtimeSchemaHash, "utf8")).schema_hash, compat.core_runtime.runtime_schema_hash);

const temporaryRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-staged-runtime-")));
const isolatedResources = path.join(temporaryRoot, "staged-resources");
const serverDir = path.join(isolatedResources, "server");
const coreRoot = path.join(isolatedResources, "edupi-core");
const dataRoot = path.join(temporaryRoot, "data");
const stateRoot = path.join(temporaryRoot, "state");
const runtimeDatabase = path.join(dataRoot, ".edupi", "runtime", "core-runtime-v1.sqlite");
let sourceAdminFact = null;
fs.mkdirSync(isolatedResources, { recursive: true });
fs.cpSync(stagedServerDir, serverDir, { recursive: true, verbatimSymlinks: true });
fs.cpSync(stagedCoreRoot, coreRoot, { recursive: true, verbatimSymlinks: true });
for (const directory of [path.join(dataRoot, ".edupi/memory"), path.join(dataRoot, ".edupi/output"), path.join(dataRoot, ".edupi/locks"), stateRoot]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

if (sourceAdminE2) {
  const values = { EDUPI_PROJECT_ROOT: dataRoot, EDUPI_HOME: path.join(dataRoot, ".edupi"),
    EDUPI_MEMORY_DIR: path.join(dataRoot, ".edupi/memory"), EDUPI_OUTPUT_DIR: path.join(dataRoot, ".edupi/output"),
    EDUPI_LOCK_DIR: path.join(dataRoot, ".edupi/locks") };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  let admission, seedFailure;
  try {
    const core = name => import(pathToFileURL(path.join(stagedCoreRoot, "scripts", name)).href);
    const facts = await core("education_fact_store.mjs");
    const { prepareCoreRuntimeRoot } = await core("core_runtime_root.mjs");
    const { acquireCoreRuntimeWriterAdmission } = await core("core_runtime_writer_admission.mjs");
    admission = await acquireCoreRuntimeWriterAdmission({ root: prepareCoreRuntimeRoot(dataRoot), kind: "legacy_desktop_staged_admin_fixture", busyTimeoutMs: 250 });
    const now = new Date().toISOString(), deadline = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const memoryDir = values.EDUPI_MEMORY_DIR;
    const entity = (entity_kind, external_id) => facts.registerEducationEntity({ memoryDir, now,
      entity: { entity_kind, namespace: "desktop-staged-admin", external_id, canonical_name: external_id, aliases: [] } }).entity;
    const classroom = entity("class", "isolated-class"), term = entity("term", "isolated-term"), event = entity("calendar_event", "isolated-event");
    const observation = facts.captureEducationObservation({ memoryDir, now, observation: {
      source_kind: "calendar", source_id: "isolated-calendar-feed", source_revision: "revision-one",
      raw_text: `行政材料截止 ${deadline}`, observed_at: now, actor_ref: "synthetic-calendar",
      entity_ids: [classroom.entity_id, term.entity_id, event.entity_id],
    } }).observation;
    const proposed = facts.proposeEducationFact({ memoryDir, now, fact: {
      entity_id: classroom.entity_id, fact_kind: "evidence", predicate: "admin.deadline",
      value: `行政材料截止 ${deadline}`, confidence: { basis: "explicit", score: 1 },
      source_ids: ["isolated-calendar-feed"], observation_ids: [observation.observation_id],
    } }).fact;
    sourceAdminFact = facts.reviewEducationFact({ memoryDir, now, fact_id: proposed.fact_id, expected_revision: proposed.revision,
      decision: "accept", reviewer: "synthetic-teacher" }).fact;
  } catch (error) {
    seedFailure = error;
  } finally {
    await admission?.release();
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  if (seedFailure) { fs.rmSync(temporaryRoot, { recursive: true, force: true }); throw seedFailure; }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : null;
      server.close(() => port ? resolve(port) : reject(new Error("staged runtime port unavailable")));
    });
  });
}

const port = await freePort();
const child = spawn(nodeBinary, [path.join(serverDir, "desktop-server.cjs")], {
  cwd: serverDir,
  env: {
    ...process.env,
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    EDUPI_PROJECT_ROOT: dataRoot,
    EDUPI_DATA_ROOT: dataRoot,
    EDUPI_DATA_ALLOWED_ROOT: temporaryRoot,
    EDUPI_CORE_ROOT: coreRoot,
    EDUPI_CORE_ALLOWED_ROOT: isolatedResources,
    EDUPI_CORE_VALIDATION_MODE: "bundled",
    PI_DESKTOP_STATE_DIR: stateRoot,
    PI_DESKTOP_API_TOKEN: "staged-runtime-token-012345678901234567890123456789",
    PI_DESKTOP_INSTANCE_ID: sourceAdminE2 ? "a".repeat(64) : "staged-core-instance",
    PI_WEB_PARENT_PID: String(process.pid),
    PI_OFFLINE: "1",
    ...(sourceAdminE2 ? { EDUPI_DESKTOP_ISOLATED_CANARY: "1" } : {}),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
child.stdout.on("data", (chunk) => { logs += chunk.toString("utf8"); });
child.stderr.on("data", (chunk) => { logs += chunk.toString("utf8"); });
const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
const baseUrl = `http://127.0.0.1:${port}`;

async function stop() {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

try {
  const deadline = Date.now() + (statusDiagnostic ? 60_000 : headlessBoot ? 20_000 : 45_000);
  const readiness = await waitForStagedRuntime({
    deadline, identityOnly, headlessBoot,
    ...(statusDiagnostic ? { statusRequestTimeoutMs: 45_000, maxStatusAttempts: 1 } : {}),
    runtimeDatabaseExists: () => fs.existsSync(runtimeDatabase),
    readIdentity: timeout => fetch(`${baseUrl}/api/desktop/identity`, { signal: AbortSignal.timeout(timeout) }),
    readStatus: timeout => fetch(`${baseUrl}/api/edupi/status?summary=1`, { signal: AbortSignal.timeout(timeout) }),
    serverExited: () => {
      if (child.exitCode !== null) throw new Error(`staged server exited: ${logs.slice(-4000)}`);
    },
  });
  const { identityReady, status, runtimeStoreSeenBeforeStatus } = readiness;
  if (statusDiagnostic) console.log(`staged status diagnostic: ${stagedReadinessDiagnostic(readiness)}`);
  assert.equal(identityReady, true, `staged server identity did not become ready: ${stagedReadinessDiagnostic(readiness)} ${logs.slice(-4000)}`);
  if (identityOnly) {
    console.log(JSON.stringify({ status: "passed", identityOnly: true }, null, 2));
  } else {
    if (headlessBoot) assert.equal(runtimeStoreSeenBeforeStatus, true, `Core did not start before any education API request: ${logs.slice(-4000)}`);
    assert.ok(status, `staged server did not become ready: ${stagedReadinessDiagnostic(readiness)} ${logs.slice(-4000)}`);
    assert.equal(status.compatibility.actual.coreCommit, compat.core_runtime.core_commit);
    assert.equal(status.compatibility.actual.componentManifestHash, compat.core_runtime.component_manifest_hash);
    assert.equal(status.core.runtimeComponentManifestHash, compat.core_runtime.runtime_component_manifest_hash);
    assert.equal(status.compatibility.actual.supportedCommands.includes("review_follow_up"), true);
    assert.equal(status.core.status, "ready");
    assert.equal(status.projection.status, "ready");
    assert.equal(status.core.capabilities.g1_processor, "activation_pending");
    assert.equal(status.core.capabilities.g2_processor, "activation_pending");
    assert.equal(status.core.capabilities.g3_processor, "activation_pending");
    assert.equal(status.externalSend, false);
    const timetableSources = await fetch(`${baseUrl}/api/edupi/timetable-sources`, { signal: AbortSignal.timeout(10_000) });
    assert.equal(timetableSources.status, 200);
    assert.equal(timetableSources.headers.get("cache-control"), "no-store");
    assert.deepEqual((await timetableSources.json()).sources, []);
    if (process.env.EDUPI_STAGED_RECURRING_E2 === "1") {
      const headers = { "content-type": "application/json", origin: baseUrl, "sec-fetch-site": "same-origin" };
      const write = async (method, route, body) => {
        const response = await fetch(`${baseUrl}${route}`, { method, headers, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
        const result = await response.json();
        assert.equal(response.ok, true, `${method} ${route}: ${JSON.stringify(result)}`);
        return result;
      };
      const readTask = async (taskId) => {
        const response = await fetch(`${baseUrl}/api/edupi/education`, { signal: AbortSignal.timeout(10_000) });
        assert.equal(response.status, 200);
        const data = await response.json();
        return data.tasks.find((task) => task.id === taskId);
      };
      const firstDate = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
      const lastDate = new Date(Date.now() + 35 * 86_400_000).toISOString().slice(0, 10);
      const created = await write("POST", "/api/edupi/tasks", { clientRequestId: "11111111-1111-4111-8111-111111111111",
        title: "隔离周报", dueDate: firstDate, note: null, recurrence: { kind: "teacher_internal_materials", cadence: "weekly",
          untilDate: lastDate, leadDays: 2, deliverables: ["内部周报"] } });
      const taskId = created.taskId;
      assert.equal(created.receipt.status, "accepted");
      let task = await readTask(taskId);
      assert.equal(task.recurrence.cadence, "weekly");
      assert.equal(task.boardStage, "todo");
      assert.equal(task.externalSend, false);
      await write("POST", `/api/edupi/tasks/${encodeURIComponent(taskId)}/review`, { decision: "modify", expectedRevision: task.revision,
        patch: { title: "隔离每周内部周报", dueDate: firstDate, deliverables: ["内部周报", "资料清单"] }, note: null });
      task = await readTask(taskId);
      assert.equal(task.boardStage, "todo", "definition review must keep the active template visible");
      assert.deepEqual(task.recurrence.deliverables, ["内部周报", "资料清单"]);
      await write("PATCH", `/api/edupi/tasks/${encodeURIComponent(taskId)}`, { stage: "done", expectedRevision: task.boardRevision, note: null });
      task = await readTask(taskId);
      assert.equal(task.boardStage, "done");
      await write("PATCH", `/api/edupi/tasks/${encodeURIComponent(taskId)}`, { stage: "progress", expectedRevision: task.boardRevision, note: null });
      task = await readTask(taskId);
      assert.equal(task.boardStage, "progress");
      await write("POST", `/api/edupi/tasks/${encodeURIComponent(taskId)}/review`, { decision: "hold", expectedRevision: task.revision, note: null });
      task = await readTask(taskId);
      assert.equal(task.status, "hold");
      await write("POST", `/api/edupi/tasks/${encodeURIComponent(taskId)}/review`, { decision: "accept", expectedRevision: task.revision, note: null });
      task = await readTask(taskId);
      assert.equal(task.status, "accepted");
      assert.equal(task.boardStage, "progress");
      const monthlyStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 15)).toISOString().slice(0, 10);
      const monthlyEnd = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 3, 15)).toISOString().slice(0, 10);
      const monthly = await write("POST", "/api/edupi/tasks", { clientRequestId: "22222222-2222-4222-8222-222222222222",
        title: "隔离月度内部材料", dueDate: monthlyStart, note: null,
        recurrence: { kind: "teacher_internal_materials", cadence: "monthly",
          untilDate: monthlyEnd, leadDays: 3, deliverables: ["月度资料清单"] } });
      const monthlyTask = await readTask(monthly.taskId);
      assert.equal(monthlyTask.recurrence.cadence, "monthly");
      assert.equal(monthlyTask.recurrence.untilDate, monthlyEnd);
      assert.equal(monthlyTask.externalSend, false);
      console.log(JSON.stringify({ recurringTemplate: "passed", taskId, recurrence: task.recurrence.cadence,
        boardStage: task.boardStage, monthlyTaskId: monthly.taskId, monthlyCadence: monthlyTask.recurrence.cadence,
        externalSend: task.externalSend }));
    }
    if (sourceAdminE2) {
      assert.ok(sourceAdminFact?.fact_id, "the isolated calendar Fact must be accepted before startup");
      const headers = { "content-type": "application/json", origin: baseUrl, "sec-fetch-site": "same-origin",
        "x-pi-desktop-token": "staged-runtime-token-012345678901234567890123456789" };
      const adminState = await fetch(`${baseUrl}/api/edupi/proactivity?domain=calendar_administration`, { headers, signal: AbortSignal.timeout(20_000) });
      assert.equal(adminState.status, 200);
      const before = await adminState.json();
      const scope = before.scopes.find(item => item.ready && item.subject === "administration");
      if (!scope) {
        const projection = await (await fetch(`${baseUrl}/api/edupi/education`, { signal: AbortSignal.timeout(15_000) })).json();
        throw new Error(`expected accepted admin scope: ${JSON.stringify({ scopes: before.scopes,
          facts: projection.factSpine?.acceptedFacts?.length, observations: projection.factSpine?.observations?.length,
          entities: projection.factSpine?.entities?.map(item => [item.id, item.kind, item.status]),
          fact: projection.factSpine?.acceptedFacts?.[0], observation: projection.factSpine?.observations?.[0] })}`);
      }
      const mutate = async (route, body) => {
        const response = await fetch(`${baseUrl}${route}`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
        const result = await response.json();
        assert.equal(response.ok, true, `${route}: ${JSON.stringify(result)}`);
        return result;
      };
      const enabled = await mutate("/api/edupi/proactivity", { domain: "calendar_administration", enabled: true,
        classId: scope.classId, subject: scope.subject, expectedUpdatedAt: before.activation.updatedAt });
      assert.equal(enabled.activation.enabled, true);
      let bundle = null, administrativeTask = null, workCase = null;
      const readyDeadline = Date.now() + 35_000;
      while (Date.now() < readyDeadline) {
        const response = await fetch(`${baseUrl}/api/edupi/workspace`, { signal: AbortSignal.timeout(15_000) });
        if (response.ok) {
          bundle = await response.json();
          administrativeTask = bundle.data.tasks.find(item => item.trigger === "capability_package"
            && item.evidence.rule === "capability:calendar_administration_evidence_package" && item.contentStatus === "draft_ready");
          workCase = bundle.data.workCases.find(item => item.taskId === administrativeTask?.id && item.currentState === "draft_ready");
          if (administrativeTask && workCase?.artifactIds.length === 3
            && workCase.artifactIds.every(id => bundle.data.generatedArtifacts.some(file => file.task_id === administrativeTask.id
              && file.artifact_id === id && file.available === true))) break;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (!administrativeTask || workCase?.artifactIds.length !== 3) {
        const latest = await (await fetch(`${baseUrl}/api/edupi/proactivity?domain=calendar_administration`, { headers,
          signal: AbortSignal.timeout(15_000) })).json();
        const readJson = name => { try { return JSON.parse(fs.readFileSync(path.join(dataRoot, ".edupi/output", name), "utf8")); } catch { return null; } };
        const work = readJson("capability_work_state.json"), planning = readJson("ambient-planning-v1.json");
        throw new Error(`source admin draft unavailable: ${JSON.stringify({ activation: latest.activation,
          grant: latest.grant, capabilities: latest.capabilities, tasks: bundle?.data?.tasks?.map(item => [item.id, item.trigger, item.contentStatus]),
          work: work?.cases?.map(item => [item.case_id, item.status, item.error_code]),
          goals: planning?.goals?.map(item => [item.id, item.status]) })}`);
      }
      assert.equal(administrativeTask.externalSend, false);
      const reminders = await fetch(`${baseUrl}/api/edupi/reminders`, { signal: AbortSignal.timeout(15_000) });
      assert.equal(reminders.status, 200);
      const reminderState = await reminders.json();
      if (!reminderState.items.some(item => item.taskId === administrativeTask.id
        && item.kind === "ready" && item.nativeSource === "core_g3")) throw new Error(`source admin reminder missing: ${JSON.stringify({
        task: [administrativeTask.id, administrativeTask.status, administrativeTask.contentStatus, administrativeTask.sourceEventId,
          administrativeTask.evidence.rule, administrativeTask.scope, administrativeTask.requiresTeacherReview],
        workCase: [workCase.id, workCase.kind, workCase.triggerId, workCase.currentState, workCase.artifactIds],
        files: bundle.data.generatedArtifacts.filter(file => file.task_id === administrativeTask.id)
          .map(file => [file.artifact_id, file.available]),
        reminders: reminderState.items.map(item => [item.taskId, item.kind, item.nativeSource]),
      })}`);
      const claimed = await mutate("/api/edupi/reminders", { id: "*", type: "claim_notifications" });
      const claim = claimed.notifications.find(item => item.taskId === administrativeTask.id);
      assert.ok(claim && claimed.nativeNotificationIds.includes(claim.id), "a current admin grant must authorize one native claim");
      await mutate("/api/edupi/reminders", { id: claim.id, type: "release_notification",
        attemptId: claim.notificationAttemptId, attemptedAt: claim.notificationAttemptedAt });
      const reviewNote = sourceAdminReview === "modify" ? "教师补充说明"
        : sourceAdminReview === "hold" || sourceAdminReview === "reject" ? "隔离审核原因" : null;
      const reviewed = await mutate(`/api/edupi/tasks/${encodeURIComponent(administrativeTask.id)}/review`, {
        decision: sourceAdminReview, expectedRevision: administrativeTask.revision, note: reviewNote,
        ...(sourceAdminReview === "modify" ? { patch: { title: administrativeTask.title, dueDate: administrativeTask.dueDate,
          deliverables: administrativeTask.deliverables } } : {}),
      });
      const expectedStatus = { accept: "accepted", modify: "modified", reject: "rejected", hold: "held" }[sourceAdminReview];
      assert.equal(reviewed.receipt.status, expectedStatus);
      const reviewedWorkspace = (await (await fetch(`${baseUrl}/api/edupi/workspace`, { signal: AbortSignal.timeout(15_000) })).json()).data;
      const reviewedTask = reviewedWorkspace.tasks.find(item => item.id === administrativeTask.id);
      assert.equal(reviewedTask?.status, sourceAdminReview === "hold" ? "hold" : expectedStatus);
      await mutate(`/api/edupi/facts/${encodeURIComponent(sourceAdminFact.fact_id)}`, {
        action: "delete", expectedRevision: sourceAdminFact.revision, reviewer: "synthetic-teacher",
      });
      const deletedDeadline = Date.now() + 75_000;
      let sourceWithdrawn = false;
      while (Date.now() < deletedDeadline) {
        const response = await fetch(`${baseUrl}/api/edupi/workspace`, { signal: AbortSignal.timeout(15_000) });
        if (response.ok) {
          const current = (await response.json()).data;
          sourceWithdrawn = !current.tasks.some(item => item.id === administrativeTask.id)
            && !current.workCases.some(item => item.taskId === administrativeTask.id);
          if (sourceWithdrawn) break;
        }
        await new Promise(resolve => setTimeout(resolve, 1_000));
      }
      assert.equal(sourceWithdrawn, true, "deleting the accepted calendar Fact must withdraw its task and work case");
      const afterDelete = await mutate("/api/edupi/reminders", { id: "*", type: "claim_notifications" });
      assert.deepEqual(afterDelete.nativeNotificationIds, []);
      const stopped = await mutate("/api/edupi/proactivity", { domain: "calendar_administration", enabled: false,
        classId: null, subject: null, expectedUpdatedAt: enabled.activation.updatedAt });
      assert.equal(stopped.activation.enabled, false);
      const afterStop = await mutate("/api/edupi/reminders", { id: "*", type: "claim_notifications" });
      assert.deepEqual(afterStop.nativeNotificationIds, [], "stopping admin must block native claims even if its draft remains visible");
      console.log(JSON.stringify({ sourceAdmin: "passed", taskId: administrativeTask.id,
        artifactCount: workCase.artifactIds.length, review: sourceAdminReview,
        sourceWithdrawn, nativeBlockedAfterStop: true, externalSend: false }));
    }
    console.log(JSON.stringify({ status: "passed", headlessBoot, coreCommit: status.compatibility.actual.coreCommit, coreStatus: status.core.status,
      projectionStatus: status.projection.status, occurrenceContract: occurrenceIdentity.contract_version,
      proactivity: status.proactivity.status,
      processors: { g1: status.core.capabilities.g1_processor, g2: status.core.capabilities.g2_processor, sharedCapability: status.core.capabilities.g3_processor },
      externalSend: status.externalSend }, null, 2));
  }
} finally {
  await stop();
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
