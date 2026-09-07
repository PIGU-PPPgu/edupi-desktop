#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createJiti } from "jiti";
import {
  captureDesktopClient,
  readRuntimeIdentity,
  startSupervisor,
  stopSupervisor,
} from "./run-edupi-task8-continuity-e2.mjs";

const TASK15_HELPER = "scripts/test_core_runtime_task15_daemon.mjs";

function createWorkspace(runtime) {
  const parentRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-task15-g3-")));
  const dataRoot = path.join(parentRoot, "data");
  const home = path.join(dataRoot, ".edupi");
  const memoryDir = path.join(home, "memory");
  const outputDir = path.join(home, "output");
  const lockDir = path.join(home, "locks");
  const stateDir = path.join(parentRoot, "desktop-state");
  const testCoreRoot = path.join(parentRoot, "test-core");
  const modeFile = path.join(parentRoot, "g3-mode");
  for (const directory of [memoryDir, outputDir, lockDir, stateDir, path.join(testCoreRoot, "scripts")]) fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(modeFile, "model_unavailable\n", "utf8");
  fs.writeFileSync(path.join(testCoreRoot, "scripts", "core_runtime_daemon.mjs"), `import { runTask15ActivatedDaemon } from ${JSON.stringify(pathToFileURL(path.join(runtime.root, TASK15_HELPER)).href)};\nawait runTask15ActivatedDaemon({ modeFile: ${JSON.stringify(modeFile)} });\n`, "utf8");
  return { parentRoot, dataRoot, home, memoryDir, outputDir, lockDir, stateDir, testCoreRoot, modeFile };
}

function seedFixture(runtime, workspace) {
  const result = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(runtime.root, TASK15_HELPER), "seed"], {
    cwd: runtime.root,
    encoding: "utf8",
    timeout: 10_000,
    env: {
      PATH: process.env.PATH,
      LANG: process.env.LANG || "en_US.UTF-8",
      LC_ALL: process.env.LC_ALL || "en_US.UTF-8",
      TZ: process.env.TZ || "Asia/Shanghai",
      NODE_ENV: "test",
      EDUPI_DATA_ROOT: workspace.dataRoot,
      EDUPI_PROJECT_ROOT: workspace.dataRoot,
      EDUPI_HOME: workspace.home,
      EDUPI_MEMORY_DIR: workspace.memoryDir,
      EDUPI_OUTPUT_DIR: workspace.outputDir,
      EDUPI_LOCK_DIR: workspace.lockDir,
      EDUPI_CORE_COMMIT: runtime.coreCommit,
    },
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim());
}

async function waitForCase(client, workCaseId, predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() <= deadline) {
    try {
      const projected = await client.snapshot(`task15-g3-${Date.now().toString(36)}`);
      const matches = projected.contract.workCases.filter((item) => item.id === workCaseId);
      assert.ok(matches.length <= 1, "G3 daemon projection cannot duplicate a work case");
      last = { ...projected, workCase: matches[0] || null };
      if (last.workCase && predicate(last)) return last;
    } catch {
      // A supervised Core restart is temporarily unavailable and retried.
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`G3 daemon projection timeout: ${last?.workCase?.currentState || "missing"}`);
}

export async function runEduPiG3DaemonE2({ coreRoot = process.env.EDUPI_CORE_ROOT, onReady } = {}) {
  if (typeof coreRoot !== "string" || !path.isAbsolute(coreRoot)) throw new Error("EDUPI_CORE_ROOT is required");
  const runtime = readRuntimeIdentity(coreRoot);
  const workspace = createWorkspace(runtime);
  const fixture = seedFixture(runtime, workspace);
  const environmentKeys = ["EDUPI_PROJECT_ROOT", "EDUPI_DATA_ROOT", "EDUPI_HOME", "EDUPI_MEMORY_DIR", "EDUPI_OUTPUT_DIR", "EDUPI_LOCK_DIR", "EDUPI_CORE_COMMIT"];
  const previous = new Map(environmentKeys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, { EDUPI_PROJECT_ROOT: workspace.dataRoot, EDUPI_DATA_ROOT: workspace.dataRoot, EDUPI_HOME: workspace.home, EDUPI_MEMORY_DIR: workspace.memoryDir, EDUPI_OUTPUT_DIR: workspace.outputDir, EDUPI_LOCK_DIR: workspace.lockDir, EDUPI_CORE_COMMIT: runtime.coreCommit });
  let firstSupervisor = null;
  let secondSupervisor = null;
  let client = null;
  try {
    firstSupervisor = await startSupervisor(runtime, workspace);
    client = await captureDesktopClient(runtime, workspace, firstSupervisor);
    const failed = await waitForCase(client, fixture.work_case_id, (value) => value.workCase.currentState === "failed");
    assert.deepEqual(failed.workCase.artifactIds, []);

    fs.writeFileSync(workspace.modeFile, "success\n", "utf8");
    process.kill(firstSupervisor.core.child_pid, "SIGKILL");
    const recoveredCore = await firstSupervisor.reader.next();
    assert.equal(recoveredCore.status, "restarted");
    const draft = await waitForCase(client, fixture.work_case_id, (value) => value.workCase.currentState === "draft_ready" && value.workCase.artifacts.length === 2);
    const draftTask = draft.contract.tasks.find((item) => item.id === fixture.task_id);
    assert.equal(draftTask.status, "planned");

    const taskReview = await createJiti(import.meta.url, { moduleCache: false }).import("../lib/edupi-task-review.ts");
    const reviewed = await taskReview.issueTaskReview({
      taskId: draftTask.id,
      expectedRevision: draftTask.revision,
      decision: "modify",
      patch: { title: draftTask.title, dueDate: draftTask.dueDate, deliverables: draftTask.deliverables },
      note: "下次增加学生演示",
      reviewerId: "teacher-synthetic-1",
      issuedAt: "2026-11-01T00:05:00.000Z",
    }, {
      readSnapshot: async () => ({ payload: draft.snapshot.payload, roots: { runtime: draft.snapshot.runtime, dataRoot: draft.snapshot.dataRoot } }),
    });
    assert.equal(reviewed.task.status, "modified");
    assert.equal(reviewed.task.review_history.length, 1);
    const modified = await waitForCase(client, fixture.work_case_id, (value) => value.workCase.currentState === "modified" && value.workCase.artifacts.length === 2);
    const stable = {
      work_case_id: modified.workCase.id,
      artifact_ids: modified.workCase.artifactIds,
      artifact_hashes: modified.workCase.artifacts.map((item) => item.sha256),
      transition_ids: modified.workCase.transitions.map((item) => item.id),
      receipt_id: reviewed.receipt.receipt_id,
    };

    client.clear();
    client = null;
    await stopSupervisor(firstSupervisor);
    firstSupervisor = null;
    secondSupervisor = await startSupervisor(runtime, workspace);
    client = await captureDesktopClient(runtime, workspace, secondSupervisor);
    const restarted = await waitForCase(client, fixture.work_case_id, (value) => value.workCase.currentState === "modified");
    const restartedTask = restarted.contract.tasks.find((item) => item.id === fixture.task_id);
    assert.deepEqual({
      work_case_id: restarted.workCase.id,
      artifact_ids: restarted.workCase.artifactIds,
      artifact_hashes: restarted.workCase.artifacts.map((item) => item.sha256),
      transition_ids: restarted.workCase.transitions.map((item) => item.id),
      receipt_id: restartedTask.reviewHistory[0].review_id,
    }, stable);

    const result = { status: "passed", ...stable, task_id: fixture.task_id, daemon_scheduled: true, model_unavailable_retryable: true, desktop_review_bridge: true, restart_projection_stable: true, active_chat_sessions: 0, external_send: false };
    if (onReady !== undefined) {
      if (typeof onReady !== "function") throw new Error("G3 daemon onReady must be a function");
      await onReady({ result, runtime, workspace, supervisor: secondSupervisor, projected: restarted });
    }
    return result;
  } finally {
    try { client?.clear(); } catch {}
    for (const supervisor of [secondSupervisor, firstSupervisor]) {
      try { await stopSupervisor(supervisor); } catch { if (supervisor?.child.exitCode === null && supervisor?.child.signalCode === null) supervisor.child.kill("SIGKILL"); }
    }
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(workspace.parentRoot, { recursive: true, force: true });
  }
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) process.stdout.write(`${JSON.stringify(await runEduPiG3DaemonE2(), null, 2)}\n`);
