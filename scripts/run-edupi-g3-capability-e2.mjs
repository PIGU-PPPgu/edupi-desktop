#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createJiti } from "jiti";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function coreImport(coreRoot, relativePath) {
  return import(pathToFileURL(path.join(coreRoot, relativePath)).href);
}

function projectDesktop(snapshot, dataRoot) {
  const contractModule = createJiti(import.meta.url, { moduleCache: false }).import("../lib/edupi-education-contract.ts");
  return Promise.resolve(contractModule).then((contract) => contract.buildEducationContractFromWorkspace(snapshot.envelope.payload.education_workspace, {
    workspacePath: dataRoot,
    snapshotPayload: snapshot.envelope.payload,
    supportedCommands: snapshot.supported_commands,
  }));
}

export async function runEduPiG3CapabilityE2({ coreRoot = process.env.EDUPI_CORE_ROOT, onReady } = {}) {
  if (typeof coreRoot !== "string" || !path.isAbsolute(coreRoot)) throw new Error("EDUPI_CORE_ROOT is required");
  const runtimeRoot = fs.realpathSync(coreRoot);
  const compat = JSON.parse(fs.readFileSync(path.join(desktopRoot, "contracts", "edupi-core-compat.json"), "utf8"));
  const commit = execFileSync("git", ["-C", runtimeRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assert.equal(commit, compat.core_runtime.core_commit);
  const fixture = JSON.parse(fs.readFileSync(path.join(runtimeRoot, "fixtures", "capability", "safety-education-summary-v1.json"), "utf8"));

  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-g3-paired-")));
  const dataRoot = path.join(parent, "data");
  const home = path.join(dataRoot, ".edupi");
  const memoryDir = path.join(home, "memory");
  const outputDir = path.join(home, "output");
  const lockDir = path.join(home, "locks");
  for (const directory of [memoryDir, outputDir, lockDir]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const keys = ["EDUPI_PROJECT_ROOT", "EDUPI_DATA_ROOT", "EDUPI_HOME", "EDUPI_MEMORY_DIR", "EDUPI_OUTPUT_DIR", "EDUPI_LOCK_DIR", "EDUPI_CORE_COMMIT"];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, { EDUPI_PROJECT_ROOT: dataRoot, EDUPI_DATA_ROOT: dataRoot, EDUPI_HOME: home, EDUPI_MEMORY_DIR: memoryDir, EDUPI_OUTPUT_DIR: outputDir, EDUPI_LOCK_DIR: lockDir, EDUPI_CORE_COMMIT: commit });
  let admission;
  try {
    const rootModule = await coreImport(runtimeRoot, "scripts/core_runtime_root.mjs");
    const admissionModule = await coreImport(runtimeRoot, "scripts/core_runtime_writer_admission.mjs");
    admission = await admissionModule.acquireCoreRuntimeWriterAdmission({ root: rootModule.prepareCoreRuntimeRoot(dataRoot), kind: "legacy_g3_paired_e2", busyTimeoutMs: 250 });
    const scheduler = await coreImport(runtimeRoot, "scripts/g3_capability_scheduler.mjs");
    const safety = await coreImport(runtimeRoot, "scripts/safety_education_summary_capability.mjs");
    const bridge = await coreImport(runtimeRoot, "scripts/edupi_bridge_snapshot.mjs");
    const deadline = "2026-11-03T00:00:00.000Z";
    const scheduled = scheduler.scheduleCapabilityWork({ outputDir, now: "2026-11-01T00:00:00.000Z", deadline_at: deadline, prepare_window_days: 7, case_record: fixture.case, facts: fixture.facts, materials: fixture.materials });
    assert.equal(scheduled.prompt_required, false);
    const unavailable = await scheduler.runDueCapabilityWork({ outputDir, now: "2026-11-01T00:00:01.000Z", adapter: async () => ({ ok: false, error_code: "model_unavailable", retryable: true, external_send: false }) });
    assert.equal(unavailable.work_case.status, "failed");
    assert.equal(unavailable.work_case.retryable, true);
    assert.equal(unavailable.work_case.next_attempt_at, "2026-11-01T00:01:01.000Z");
    const ready = await scheduler.runDueCapabilityWork({ outputDir, now: "2026-11-01T00:01:01.000Z", adapter: safety.deterministicSafetyEducationAdapter });
    assert.equal(ready.work_case.status, "draft_ready");
    const readySnapshot = await bridge.handleSnapshotRequest({ operation: "snapshot", request_id: "g3-paired-ready" });
    const readyDesktop = await projectDesktop(readySnapshot, dataRoot);
    const readyCase = readyDesktop.workCases.find((item) => item.id === ready.work_case.work_case_id);
    assert.equal(readyCase.kind, "capability_package");
    assert.equal(readyCase.currentState, "draft_ready");
    assert.equal(readyCase.artifactIds.length, 2);

    const revisedFacts = fixture.facts.map((fact) => fact.fact_id === "fact-safety-class-meeting" ? { ...fact, revision: 2, value: "开展交通安全主题班会并完成学生反馈" } : fact);
    const revised = scheduler.scheduleCapabilityWork({ outputDir, now: "2026-11-01T00:02:00.000Z", deadline_at: deadline, prepare_window_days: 7, case_record: { ...fixture.case, case_revision: 2 }, facts: revisedFacts, materials: fixture.materials });
    assert.ok(revised.work_case.artifacts.every((item) => item.status === "stale"));
    const rerun = await scheduler.runDueCapabilityWork({ outputDir, now: "2026-11-01T00:03:00.000Z", adapter: safety.deterministicSafetyEducationAdapter });
    assert.equal(rerun.work_case.status, "draft_ready");
    assert.notDeepEqual(rerun.work_case.artifacts.filter((item) => item.status === "current").map((item) => item.artifact_id), readyCase.artifactIds);

    const summary = rerun.work_case.artifacts.find((item) => item.status === "current" && item.key === "summary");
    const summaryFile = path.resolve(dataRoot, ...summary.relative_path.split("/"));
    const reviewed = scheduler.reviewCapabilityWork({
      outputDir,
      now: "2026-11-01T00:04:00.000Z",
      work_case_id: rerun.work_case.work_case_id,
      expected_revision: rerun.work_case.revision,
      decision: "modify",
      reviewer: "teacher-synthetic-1",
      edits: [{ artifact_id: summary.artifact_id, content: `${fs.readFileSync(summaryFile, "utf8")}\n\n教师补充：下次增加学生演示。` }],
    });
    assert.equal(reviewed.work_case.policy_candidates[0].applied, false);
    const reviewedSnapshot = await bridge.handleSnapshotRequest({ operation: "snapshot", request_id: "g3-paired-reviewed" });
    const reviewedDesktop = await projectDesktop(reviewedSnapshot, dataRoot);
    const reviewedCase = reviewedDesktop.workCases.find((item) => item.id === reviewed.work_case.work_case_id);
    const reviewedTask = reviewedDesktop.tasks.find((item) => item.id === reviewedCase.taskId);
    const workbenchModule = await createJiti(import.meta.url, { moduleCache: false }).import("../lib/edupi-workbench.ts");
    assert.equal(reviewedCase.currentState, "modified");
    assert.equal(reviewedCase.artifactIds.length, 2);
    assert.equal(workbenchModule.taskArtifacts(reviewedTask).length, 2, "the existing Desktop artifact consumer must retain reviewed capability outputs");

    const restartedState = scheduler.loadCapabilityWorkState({ outputDir });
    const receiptId = restartedState.cases[0].receipts[0].receipt_id;
    const restartedSnapshot = await bridge.handleSnapshotRequest({ operation: "snapshot", request_id: "g3-paired-restarted" });
    const restartedDesktop = await projectDesktop(restartedSnapshot, dataRoot);
    assert.deepEqual(restartedDesktop.workCases.find((item) => item.id === reviewedCase.id), reviewedCase);
    assert.equal(scheduler.loadCapabilityWorkState({ outputDir }).cases[0].receipts[0].receipt_id, receiptId);

    const result = {
      status: "passed",
      task_id: reviewedCase.taskId,
      work_case_id: reviewedCase.id,
      transition_states: reviewedCase.transitions.map((item) => item.state),
      artifact_ids: [...reviewedCase.artifactIds],
      artifact_consumer_count: 2,
      prompt_required: false,
      model_unavailable_retryable: true,
      source_change_stale: true,
      feedback_receipt_stable: true,
      policy_candidate_applied: false,
      restart_projection_stable: true,
      external_send: false,
    };
    if (onReady !== undefined) {
      if (typeof onReady !== "function") throw new Error("G3 onReady must be a function");
      await admission.release();
      admission = null;
      await onReady({ result, runtimeRoot, dataRoot, parentRoot: parent, home, memoryDir, outputDir, lockDir, commit, compat });
    }
    return result;
  } finally {
    try { await admission?.release(); } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      fs.rmSync(parent, { recursive: true, force: true });
    }
  }
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(await runEduPiG3CapabilityE2(), null, 2)}\n`);
}
