import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const { buildEducationContractFromWorkspace } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-education-contract.ts");
const workspace = { tasks: [], calendar: [], timetable: [], students: [], continuity: {}, source_summaries: [] };
const coreRoot = process.env.EDUPI_CORE_ROOT;

test("enables native task review only when both pinned and snapshot capabilities contain review_task", () => {
  const commands = ["review_observation", "review_task"];
  const enabled = buildEducationContractFromWorkspace(workspace, { workspacePath: "/tmp/edupi", supportedCommands: commands, snapshotPayload: { capabilities: { supported_commands: commands } } });
  assert.equal(enabled.capabilities.taskReview.enabled, true);
  assert.equal(enabled.capabilities.taskReview.mode, "canonical_safe_store");

  const missingManifest = buildEducationContractFromWorkspace(workspace, { workspacePath: "/tmp/edupi", supportedCommands: ["review_observation"], snapshotPayload: { capabilities: { supported_commands: commands } } });
  assert.equal(missingManifest.capabilities.taskReview.enabled, false);
  const missingSnapshot = buildEducationContractFromWorkspace(workspace, { workspacePath: "/tmp/edupi", supportedCommands: commands, snapshotPayload: { capabilities: { supported_commands: ["review_observation"] } } });
  assert.equal(missingSnapshot.capabilities.taskReview.enabled, false);
});

test("projects Core intake commands as writable capabilities instead of stale read-only flags", () => {
  const commands = ["review_observation", "review_memory_candidate", "review_teacher_context", "review_work_candidate", "review_follow_up", "review_task", "import_calendar", "import_timetable", "intake_material", "create_task", "move_task_stage", "update_memory"];
  const data = buildEducationContractFromWorkspace(workspace, {
    workspacePath: "/tmp/edupi",
    supportedCommands: commands,
    snapshotPayload: { capabilities: { supported_commands: commands } },
  });
  for (const capability of [data.capabilities.calendar, data.capabilities.timetable, data.capabilities.materialIntake]) {
    assert.equal(capability.enabled, true);
    assert.equal(capability.mode, "canonical_safe_store");
  }

  const stale = buildEducationContractFromWorkspace(workspace, {
    workspacePath: "/tmp/edupi",
    supportedCommands: commands,
    snapshotPayload: { capabilities: { supported_commands: commands.slice(0, -1) } },
  });
  assert.equal(stale.capabilities.calendar.enabled, false);
  assert.equal(stale.capabilities.timetable.enabled, false);
  assert.equal(stale.capabilities.materialIntake.enabled, false);
});

test("a real pinned Core capability review reads back once without inventing rollback and preserves current feedback revision", { skip: !coreRoot }, async t => {
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const review = await jiti.import("./edupi-task-review.ts");
  const { activeBridgeIdentity } = await jiti.import("./edupi-bridge-manifest.ts");
  const feedback = await jiti.import("./edupi-capability-feedback.ts");
  const identity = activeBridgeIdentity();
  assert.equal(execFileSync("git", ["-C", coreRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), identity.runtime.core_commit);
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-capability-task-review-")));
  const home = path.join(root, ".edupi"), outputDir = path.join(home, "output");
  const environment = { EDUPI_PROJECT_ROOT: root, EDUPI_DATA_ROOT: root, EDUPI_HOME: home, EDUPI_OUTPUT_DIR: outputDir,
    EDUPI_MEMORY_DIR: path.join(home, "memory"), EDUPI_LOCK_DIR: path.join(home, "locks"), EDUPI_CORE_COMMIT: identity.runtime.core_commit };
  const previous = new Map(Object.keys(environment).map(key => [key, process.env[key]]));
  let admission;
  t.after(async () => {
    try { await admission?.release(); } finally {
      for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  for (const directory of [outputDir, environment.EDUPI_MEMORY_DIR, environment.EDUPI_LOCK_DIR]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  Object.assign(process.env, environment);
  const from = name => import(pathToFileURL(path.join(coreRoot, "scripts", name)).href);
  const scheduler = await from("g3_capability_scheduler.mjs");
  const bridge = await from("edupi_bridge_snapshot.mjs");
  const command = await from("edupi_bridge_command.mjs");
  const { acquireCoreRuntimeWriterAdmission } = await from("core_runtime_writer_admission.mjs");
  const { prepareCoreRuntimeRoot } = await from("core_runtime_root.mjs");
  admission = await acquireCoreRuntimeWriterAdmission({ root: prepareCoreRuntimeRoot(root), kind: "legacy_desktop_capability_task_review_test", busyTimeoutMs: 250 });
  const caseRecord = { case_id: "isolated-admin-review", case_revision: 1, term_ref: "isolated-term", class_ref: "isolated-class", reason: "隔离行政材料包审核回归" };
  const scheduled = scheduler.scheduleCapabilityWork({ outputDir, now: "2026-09-20T00:00:00.000Z", deadline_at: "2026-12-01T00:00:00.000Z", prepare_window_days: 90,
    capability_id: scheduler.CALENDAR_ADMINISTRATION_CAPABILITY_ID, case_record: caseRecord,
    facts: [{ fact_id: "isolated-admin-deadline", revision: 0, fact_kind: "evidence", entity_id: "isolated-class", predicate: "admin.deadline", value: "2026-12-01提交",
      term_ref: "isolated-term", class_ref: "isolated-class", occurred_on: "2026-09-20", source_ids: ["isolated-deadline-source"] }], materials: [] });
  assert.equal(scheduled.work_case.status, "queued");
  assert.equal((await scheduler.runDueCapabilityWork({ outputDir, now: "2026-09-20T00:01:00.000Z" })).work_case.status, "draft_ready");
  let snapshotCount = 0, dispatches = 0, response, sent;
  const snapshot = async () => {
    const value = await bridge.handleSnapshotRequest({ operation: "snapshot", request_id: `isolated-review-snapshot-${++snapshotCount}` });
    assert.equal(value.ok, true, JSON.stringify(value));
    return value.envelope.payload;
  };
  const before = await snapshot(), initial = before.education_workspace.tasks.find(task => task.source_event_id === caseRecord.case_id);
  assert.ok(initial);
  const roots = { runtime: {}, dataRoot: {} };
  const input = { taskId: initial.task_id, expectedRevision: initial.revision, decision: "accept", reviewerId: "teacher",
    note: "仅隔离测试，核对行政材料", issuedAt: "2026-09-20T00:02:00.000Z" };
  const result = await review.issueTaskReview(input, {
    supportedCommands: identity.contract.supported_commands,
    readSnapshot: async () => ({ payload: before, roots }),
    dispatch: async envelope => {
      dispatches++;
      sent = envelope;
      response = await command.handleCommandRequest({ operation: "command", request_id: envelope.request_id, envelope });
      const stored = scheduler.loadCapabilityWorkState({ outputDir }).cases.find(row => row.work_case_id === scheduled.work_case.work_case_id);
      t.diagnostic(`Core status=${stored.status}, revision=${stored.revision}, reviews=${stored.receipts.length}, rollback=${JSON.stringify(response.receipt?.payload?.rollback)}`);
      return response;
    },
    refreshSnapshot: snapshot,
  });
  assert.equal(dispatches, 1);
  assert.equal(result.task.status, "accepted");
  assert.equal(result.task.revision, initial.revision + 1);
  assert.equal(result.task.review_history.length, 1);
  assert.equal(result.task.review_history[0].review_id, result.receipt.receipt_id);
  assert.deepEqual(result.receipt.rollback, { available: false, rollback_id: null, expires_at: null });
  const reread = await snapshot();
  assert.deepEqual(reread.education_workspace.tasks.find(task => task.task_id === initial.task_id), result.task);
  const data = buildEducationContractFromWorkspace(result.data.education_workspace, { workspacePath: root, supportedCommands: identity.contract.supported_commands, snapshotPayload: result.data });
  const binding = feedback.capabilityFeedbackBinding(data.tasks.find(task => task.id === initial.task_id), data.workCases.find(workCase => workCase.taskId === initial.task_id));
  assert.equal(binding.revision, result.task.revision);
  assert.equal(binding.status, "accepted");
  const currentFeedback = { session_id: "desktop-capability-feedback", current: true, source_status: "current",
    target: { kind: "capability_work", target_id: binding.workCaseId, revision: binding.revision } };
  assert.equal(feedback.currentCapabilityFeedback([currentFeedback], binding), currentFeedback);
  assert.equal(feedback.currentCapabilityFeedback([{ ...currentFeedback, target: { ...currentFeedback.target, revision: initial.revision } }], binding), null);
  await assert.rejects(review.issueTaskReview(input, {
    supportedCommands: identity.contract.supported_commands,
    readSnapshot: async () => ({ payload: reread, roots }),
    dispatch: async () => { dispatches++; throw new Error("must not redispatch a stale UI revision"); },
  }), { code: "stale_revision" });
  assert.equal(dispatches, 1);
  assert.equal(scheduler.loadCapabilityWorkState({ outputDir }).cases[0].receipts.length, 1);
  assert.throws(() => review.buildTaskReviewCommandEnvelope({ ...input, decision: "rollback", expectedRevision: result.task.revision, payload: reread }), { code: "invalid_envelope" });
  for (const mutate of [
    value => { value.receipt.payload.rollback.available = true; value.receipt.payload.rollback.rollback_id = result.receipt.receipt_id; },
    value => { value.receipt.payload.rollback.rollback_id = "forged-review"; },
    value => { value.receipt.payload.rollback.expires_at = "2026-12-01T00:00:00.000Z"; },
    value => { value.receipt.payload.receipt_id = "forged-receipt"; value.receipt.message_id = "forged-receipt"; },
  ]) {
    await assert.rejects(review.issueTaskReview(input, {
      supportedCommands: identity.contract.supported_commands,
      readSnapshot: async () => ({ payload: before, roots }),
      dispatch: async envelope => {
        const forged = structuredClone(response);
        forged.request_id = envelope.request_id;
        forged.receipt.request_id = envelope.request_id;
        forged.receipt.payload.request_id = envelope.request_id;
        forged.receipt.payload.command_id = envelope.message_id;
        mutate(forged);
        return forged;
      },
      refreshSnapshot: async () => result.data,
    }), { code: "invalid_envelope" });
  }
  assert.equal(sent.command.task_id, initial.task_id);
});
