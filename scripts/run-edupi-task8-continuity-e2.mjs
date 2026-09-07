#!/usr/bin/env node

/** Paired Task 8 E2: deterministic G1 continuity through the real Desktop broker. */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const DESKTOP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SUPERVISOR_PATH = path.join(DESKTOP_ROOT, "desktop", "core-supervisor.cjs");
const COMPAT_PATH = path.join(DESKTOP_ROOT, "contracts", "edupi-core-compat.json");
const TASK8_HELPER = "scripts/test_core_runtime_task8_daemon.mjs";
const RUNTIME_PATH = "/runtime/v1";
const EXPECTED_TRANSITIONS = Object.freeze(["queued", "running", "failed", "queued", "running", "draft_ready"]);

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export function requireSingleTask8Match(values, predicate, label) {
  const matches = (Array.isArray(values) ? values : []).filter(predicate);
  if (matches.length > 1) {
    throw Object.assign(new Error(`Task 8 expected exactly one ${label}; found ${matches.length}`), { code: "task8_evidence_invalid" });
  }
  return matches[0] ?? null;
}

export function assertExactTask8ArtifactFiles(expectedFiles, actualFiles) {
  const expected = (Array.isArray(expectedFiles) ? expectedFiles : []).map((item) => path.resolve(item));
  const actual = (Array.isArray(actualFiles) ? actualFiles : []).map((item) => path.resolve(item));
  assert.equal(new Set(expected).size, expected.length, "Task 8 expected artifact file set contains duplicates");
  assert.equal(new Set(actual).size, actual.length, "Task 8 actual artifact file set contains duplicates");
  assert.deepEqual([...actual].sort(), [...expected].sort(), "Task 8 artifact file set contains missing or extra files");
}

export function readRuntimeIdentity(coreRoot) {
  const root = fs.realpathSync(coreRoot);
  const compat = JSON.parse(fs.readFileSync(COMPAT_PATH, "utf8"));
  const runtime = compat.core_runtime;
  const head = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" });
  if (head.status !== 0 || head.stdout.trim() !== runtime.core_commit) throw new Error("Task 8 Core commit does not match the Desktop pin");
  const manifestPath = path.join(root, runtime.component_manifest_path);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.component_manifest_hash !== runtime.component_manifest_hash) throw new Error("Task 8 Core manifest does not match the Desktop pin");
  const schema = JSON.parse(fs.readFileSync(path.join(root, "contracts", "edupi-core-runtime-v1-hash.json"), "utf8"));
  const helper = path.join(root, TASK8_HELPER);
  if (!fs.statSync(helper).isFile()) throw new Error("Task 8 Core test helper is unavailable");
  return {
    root,
    coreCommit: runtime.core_commit,
    componentManifestPath: runtime.component_manifest_path,
    componentManifestHash: runtime.component_manifest_hash,
    schemaHash: schema.schema_hash,
    helper,
    supportedCommands: compat.supported_commands,
  };
}

async function choosePort(excluded = []) {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const port = await new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const value = probe.address().port;
        probe.close((error) => error ? reject(error) : resolve(value));
      });
    });
    if (!excluded.includes(port)) return port;
  }
  throw new Error("Task 8 could not allocate a distinct loopback port");
}

function createEnvelopeReader(child) {
  let output = "";
  let consumed = 0;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  return {
    output: () => output,
    next(timeoutMs = 20_000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Task 8 supervisor envelope timeout: ${output}`)), timeoutMs);
        const inspect = () => {
          const line = output.split("\n").filter(Boolean)[consumed];
          if (!line) return;
          consumed += 1;
          clearTimeout(timer);
          child.stdout.removeListener("data", inspect);
          try { resolve(JSON.parse(line)); } catch (error) { reject(error); }
        };
        child.stdout.on("data", inspect);
        inspect();
      });
    },
  };
}

function createWorkspace(runtime) {
  const parentRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-task8-continuity-")));
  const dataRoot = path.join(parentRoot, "data");
  const home = path.join(dataRoot, ".edupi");
  const memoryDir = path.join(home, "memory");
  const outputDir = path.join(home, "output");
  const lockDir = path.join(home, "locks");
  const stateDir = path.join(parentRoot, "desktop-state");
  const testCoreRoot = path.join(parentRoot, "test-core");
  const modeFile = path.join(parentRoot, "harness-mode");
  for (const directory of [memoryDir, outputDir, lockDir, stateDir, path.join(testCoreRoot, "scripts")]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  fs.writeFileSync(modeFile, "model_unavailable\n", "utf8");
  const helperUrl = pathToFileURL(runtime.helper).href;
  fs.writeFileSync(
    path.join(testCoreRoot, "scripts", "core_runtime_daemon.mjs"),
    `import { runTask8ActivatedDaemon } from ${JSON.stringify(helperUrl)};\nawait runTask8ActivatedDaemon({ modeFile: ${JSON.stringify(modeFile)} });\n`,
    "utf8",
  );
  return { parentRoot, dataRoot, home, memoryDir, outputDir, lockDir, stateDir, testCoreRoot, modeFile };
}

function seedFixture(runtime, workspace) {
  const result = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", runtime.helper, "seed"], {
    cwd: runtime.root,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
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
  if (result.status !== 0) throw new Error(`Task 8 fixture seed failed: ${result.stderr}`);
  const lines = result.stdout.trim().split(/\r?\n/u).filter(Boolean);
  if (lines.length !== 1) throw new Error("Task 8 fixture seed returned an invalid frame");
  return JSON.parse(lines[0]);
}

export async function startSupervisor(runtime, workspace, excludedPorts = []) {
  const clientPort = await choosePort(excludedPorts);
  const corePort = await choosePort([...excludedPorts, clientPort]);
  const environment = {
    ...process.env,
    EDUPI_CORE_RELEASE_MODE: "daemon",
    EDUPI_CORE_ROOT: workspace.testCoreRoot,
    EDUPI_DATA_ROOT: workspace.dataRoot,
    EDUPI_CORE_CLIENT_TOKEN: crypto.randomBytes(32).toString("hex"),
    EDUPI_CORE_CLIENT_PORT: String(clientPort),
    EDUPI_CORE_TOKEN: crypto.randomBytes(32).toString("hex"),
    EDUPI_CORE_PORT: String(corePort),
    EDUPI_CORE_SUPERVISOR_SESSION: `task8-supervisor-${crypto.randomBytes(12).toString("hex")}`,
    EDUPI_CORE_COMMIT: runtime.coreCommit,
    EDUPI_CORE_COMPONENT_MANIFEST_HASH: runtime.componentManifestHash,
    EDUPI_CORE_SCHEMA_HASH: runtime.schemaHash,
    PI_DESKTOP_STATE_DIR: workspace.stateDir,
    PI_WEB_PARENT_PID: String(process.pid),
  };
  const child = spawn(process.execPath, [SUPERVISOR_PATH], {
    cwd: DESKTOP_ROOT,
    env: environment,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const reader = createEnvelopeReader(child);
  const proxy = await reader.next();
  if (proxy.status !== "supervisor_ready") throw new Error("Task 8 broker did not become ready");
  const core = await reader.next();
  if (!new Set(["ready", "restarted"]).has(core.status)) throw new Error(`Task 8 Core did not become ready: ${JSON.stringify(core)}`);
  return { child, reader, environment, proxy, core, stderr: () => stderr };
}

export async function stopSupervisor(supervisor) {
  if (!supervisor || supervisor.child.exitCode !== null || supervisor.child.signalCode !== null) return;
  supervisor.child.stdin.write("stop\n");
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Task 8 supervisor stop timeout")), 23_000);
    supervisor.child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export async function captureDesktopClient(runtime, workspace, supervisor) {
  process.env.EDUPI_CORE_RENDEZVOUS_TEST_RESET = "1";
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true, moduleCache: false });
  const rendezvous = await jiti.import("../lib/edupi-core-rendezvous.ts");
  const snapshotClient = await jiti.import("../lib/edupi-core-snapshot.ts");
  const education = await jiti.import("../lib/edupi-education-contract.ts");
  rendezvous.captureEduPiCoreRendezvous({
    EDUPI_CORE_RELEASE_MODE: "daemon",
    EDUPI_CORE_ENDPOINT: supervisor.proxy.endpoint,
    EDUPI_CORE_CLIENT_TOKEN: supervisor.environment.EDUPI_CORE_CLIENT_TOKEN,
    EDUPI_CORE_SUPERVISOR_SESSION: supervisor.environment.EDUPI_CORE_SUPERVISOR_SESSION,
    EDUPI_CORE_SCHEMA_HASH: runtime.schemaHash,
    EDUPI_CORE_COMMIT: runtime.coreCommit,
    EDUPI_CORE_COMPONENT_MANIFEST_HASH: runtime.componentManifestHash,
    EDUPI_CORE_ATTESTATION: `task8-attestation-${crypto.randomBytes(12).toString("hex")}`,
  });
  const runtimeView = {
    root: runtime.root,
    cwd: runtime.root,
    entrypoint: path.join(runtime.root, "scripts", "core_runtime_daemon.mjs"),
    oneShotEntrypoint: path.join(runtime.root, "scripts", "desktop_bridge_port.mjs"),
    componentManifestPath: path.join(runtime.root, runtime.componentManifestPath),
    componentManifestHash: runtime.componentManifestHash,
    coreCommit: runtime.coreCommit,
    validationMode: "external",
  };
  const dataRoot = {
    root: workspace.dataRoot,
    allowedRoot: workspace.parentRoot,
    memoryDir: workspace.memoryDir,
    outputDir: workspace.outputDir,
    lockDir: workspace.lockDir,
  };
  return {
    clear: () => rendezvous.clearEduPiCoreRendezvousForTests(),
    async snapshot(requestId) {
      const snapshot = await snapshotClient.readEduPiEducationSnapshot({
        requestId,
        roots: { runtime: runtimeView, dataRoot },
      });
      const contract = education.buildEducationContractFromWorkspace(snapshot.workspace, {
        workspacePath: workspace.dataRoot,
        snapshotPayload: snapshot.payload,
        supportedCommands: runtime.supportedCommands,
      });
      return { snapshot, contract };
    },
  };
}

async function directRuntimeHealth(runtime, supervisor, requestId) {
  const response = await fetch(`http://127.0.0.1:${supervisor.environment.EDUPI_CORE_PORT}${RUNTIME_PATH}`, {
    method: "POST",
    headers: {
      host: `127.0.0.1:${supervisor.environment.EDUPI_CORE_PORT}`,
      "content-type": "application/json",
      authorization: `Bearer ${supervisor.environment.EDUPI_CORE_TOKEN}`,
    },
    body: JSON.stringify({
      protocol: "edupi-core-runtime",
      protocol_version: 1,
      schema_hash: runtime.schemaHash,
      request_id: requestId,
      operation: "health",
      payload: null,
    }),
  });
  const value = await response.json();
  if (!response.ok || value.ok !== true || value.external_send !== false) throw new Error("Task 8 direct Core health failed");
  return value.result;
}

function readExecution(workspace, taskId) {
  const file = path.join(workspace.outputDir, "calendar_work_execution_state.json");
  if (!fs.existsSync(file)) return null;
  const state = JSON.parse(fs.readFileSync(file, "utf8"));
  return requireSingleTask8Match(state.executions, (execution) => execution?.task_id === taskId, "execution");
}

async function waitForProjection(client, workspace, taskId, predicate, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() <= deadline) {
    try {
      const projected = await client.snapshot(`task8-${label}-${Date.now().toString(36)}`);
      const workCase = requireSingleTask8Match(projected.contract.workCases, (item) => item?.taskId === taskId, "work case");
      const task = requireSingleTask8Match(projected.contract.tasks, (item) => item?.id === taskId, "task");
      const execution = readExecution(workspace, taskId);
      last = { ...projected, workCase, task, execution };
      if (predicate(last)) return last;
    } catch (error) {
      if (error?.code === "task8_evidence_invalid") throw error;
      // Core restart windows are observed as unavailable and retried.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Task 8 ${label} projection timeout: ${JSON.stringify({ state: last?.workCase?.currentState, execution: last?.execution?.status })}`);
}

function regularFilesUnder(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) throw Object.assign(new Error("Task 8 artifact tree contains a symlink"), { code: "task8_evidence_invalid" });
      if (stat.isDirectory()) visit(target);
      else if (stat.isFile()) files.push(target);
      else throw Object.assign(new Error("Task 8 artifact tree contains a non-file entry"), { code: "task8_evidence_invalid" });
    }
  };
  visit(directory);
  return files;
}

function artifactEvidence(workspace, execution) {
  const artifacts = execution.artifacts.map((artifact) => {
    const file = path.resolve(workspace.dataRoot, ...artifact.relative_path.split("/"));
    assert.equal(isInside(workspace.outputDir, file), true);
    const bytes = fs.readFileSync(file);
    assert.equal(sha256(bytes), artifact.sha256);
    const body = bytes.toString("utf8");
    assert.match(body, new RegExp(`artifact_id: ${artifact.artifact_id}`));
    assert.match(body, /status: candidate_only/u);
    return {
      artifact_id: artifact.artifact_id,
      relative_path: artifact.relative_path,
      sha256: artifact.sha256,
      revision: artifact.revision,
    };
  });
  assert.equal(new Set(artifacts.map((item) => item.artifact_id)).size, artifacts.length, "Task 8 artifact IDs must be unique");
  assert.equal(new Set(artifacts.map((item) => item.relative_path)).size, artifacts.length, "Task 8 artifact paths must be unique");
  const artifactRoot = path.join(workspace.outputDir, "calendar-work-artifacts");
  const expectedFiles = artifacts.map((item) => path.resolve(workspace.dataRoot, ...item.relative_path.split("/")));
  assertExactTask8ArtifactFiles(expectedFiles, regularFilesUnder(artifactRoot));
  return artifacts;
}

function continuityIdentity(projected, artifacts) {
  return {
    event_id: projected.execution.runtime_binding.event_id,
    task_id: projected.task.id,
    work_case_id: projected.workCase.id,
    current_state: projected.workCase.currentState,
    transition_ids: projected.workCase.transitions.map((item) => item.id),
    transition_states: projected.workCase.transitions.map((item) => item.state),
    artifact_ids: projected.workCase.artifactIds,
    execution_id: projected.execution.execution_id,
    execution_attempt: projected.execution.attempt,
    receipt_id: projected.execution.runtime_binding.receipt_id,
    source_revision: projected.execution.runtime_binding.source_revision,
    artifacts,
  };
}

export async function runTask8ContinuityE2({ coreRoot = process.env.EDUPI_CORE_ROOT, onReady } = {}) {
  if (typeof coreRoot !== "string" || !path.isAbsolute(coreRoot)) throw new Error("EDUPI_CORE_ROOT is required for Task 8 E2");
  const runtime = readRuntimeIdentity(coreRoot);
  const workspace = createWorkspace(runtime);
  const fixture = seedFixture(runtime, workspace);
  let firstSupervisor = null;
  let secondSupervisor = null;
  let client = null;
  try {
    firstSupervisor = await startSupervisor(runtime, workspace);
    client = await captureDesktopClient(runtime, workspace, firstSupervisor);
    const firstHealth = await directRuntimeHealth(runtime, firstSupervisor, "task8-health-model-unavailable");
    assert.equal(firstHealth.capabilities.event_intake, "active");
    assert.equal(firstHealth.capabilities.internal_timer, "active");
    assert.equal(firstHealth.capabilities.g1_processor, "active");
    assert.equal(firstHealth.capabilities.channel_connected, false);

    const unavailable = await waitForProjection(
      client,
      workspace,
      fixture.task_id,
      (value) => value.workCase?.currentState === "failed"
        && value.execution?.status === "failed"
        && value.execution?.failure_code === "model_unavailable",
      "model-unavailable",
    );
    assert.deepEqual(unavailable.workCase.artifactIds, []);
    assert.deepEqual(unavailable.execution.artifacts, []);
    const unavailableHealth = await directRuntimeHealth(runtime, firstSupervisor, "task8-health-retryable");
    assert.equal(unavailableHealth.queue.queued, 1);
    assert.equal(unavailableHealth.queue.completed, 0);

    fs.writeFileSync(workspace.modeFile, "success\n", "utf8");
    process.kill(firstSupervisor.core.child_pid, "SIGKILL");
    const recoveredCore = await firstSupervisor.reader.next();
    assert.equal(recoveredCore.status, "restarted");
    assert.ok(recoveredCore.fencing_generation > firstSupervisor.core.fencing_generation);
    const ready = await waitForProjection(
      client,
      workspace,
      fixture.task_id,
      (value) => value.workCase?.currentState === "draft_ready"
        && value.execution?.status === "draft_ready"
        && value.workCase.artifactIds.length === fixture.deliverables.length,
      "draft-ready",
    );
    assert.equal(ready.contract.externalSend, false);
    assert.equal(ready.workCase.externalSend, false);
    assert.equal(ready.task.externalSend, false);
    assert.equal(ready.workCase.kind, "teaching_before_class");
    assert.deepEqual(ready.workCase.transitions.map((item) => item.state), EXPECTED_TRANSITIONS);
    assert.equal(ready.execution.attempt, 2);
    assert.equal(ready.execution.runtime_binding.source_revision, fixture.source_revision);
    assert.match(ready.execution.runtime_binding.receipt_id, /^runtime_receipt_[0-9a-f]{32}$/u);
    const artifacts = artifactEvidence(workspace, ready.execution);
    assert.equal(artifacts.length, fixture.deliverables.length);
    const stableIdentity = continuityIdentity(ready, artifacts);
    assert.equal(stableIdentity.event_id, fixture.event_id);

    process.kill(recoveredCore.child_pid, "SIGKILL");
    const replayCore = await firstSupervisor.reader.next();
    assert.equal(replayCore.status, "restarted");
    assert.ok(replayCore.fencing_generation > recoveredCore.fencing_generation);
    const replay = await waitForProjection(
      client,
      workspace,
      fixture.task_id,
      (value) => value.workCase?.currentState === "draft_ready" && value.execution?.status === "draft_ready",
      "core-replay",
    );
    assert.deepEqual(continuityIdentity(replay, artifactEvidence(workspace, replay.execution)), stableIdentity);

    client.clear();
    client = null;
    await stopSupervisor(firstSupervisor);
    firstSupervisor = null;

    secondSupervisor = await startSupervisor(runtime, workspace);
    assert.notEqual(secondSupervisor.environment.EDUPI_CORE_SUPERVISOR_SESSION, recoveredCore.supervisor_session_id);
    client = await captureDesktopClient(runtime, workspace, secondSupervisor);
    const desktopRestart = await waitForProjection(
      client,
      workspace,
      fixture.task_id,
      (value) => value.workCase?.currentState === "draft_ready" && value.execution?.status === "draft_ready",
      "desktop-restart",
    );
    assert.deepEqual(continuityIdentity(desktopRestart, artifactEvidence(workspace, desktopRestart.execution)), stableIdentity);
    const finalHealth = await directRuntimeHealth(runtime, secondSupervisor, "task8-health-final");
    assert.equal(finalHealth.capabilities.channel_connected, false);
    assert.equal(finalHealth.queue.completed, 1);
    assert.equal(finalHealth.queue.queued, 0);

    const result = {
      status: "passed",
      event_id: stableIdentity.event_id,
      task_id: fixture.task_id,
      work_case_id: stableIdentity.work_case_id,
      transition_states: stableIdentity.transition_states,
      execution_id: stableIdentity.execution_id,
      execution_attempt: stableIdentity.execution_attempt,
      receipt_id: stableIdentity.receipt_id,
      artifact_ids: stableIdentity.artifact_ids,
      artifact_hashes: stableIdentity.artifacts.map((item) => item.sha256),
      model_unavailable_retryable: true,
      core_restart_replay_stable: true,
      desktop_restart_replay_stable: true,
      chat_runtime_started: false,
      channel_connected: false,
      external_send: false,
    };
    if (onReady !== undefined) {
      if (typeof onReady !== "function") throw new Error("Task 8 onReady must be a function");
      await onReady({ result, runtime, workspace, supervisor: secondSupervisor });
    }
    return result;
  } finally {
    try { client?.clear(); } catch {}
    for (const supervisor of [secondSupervisor, firstSupervisor]) {
      try { await stopSupervisor(supervisor); } catch {
        if (supervisor?.child.exitCode === null && supervisor?.child.signalCode === null) supervisor.child.kill("SIGKILL");
      }
    }
    fs.rmSync(workspace.parentRoot, { recursive: true, force: true });
  }
}

function boundedLogs(current, chunk) {
  const next = `${current}${String(chunk)}`;
  return next.length > 64 * 1024 ? next.slice(-64 * 1024) : next;
}

function startDesktopDev({ runtime, workspace, supervisor, port }) {
  if (!Number.isInteger(port) || port < 1 || port > 65_535 || port === 30141) throw new Error("Task 8 visible port is invalid");
  const nextBin = path.join(DESKTOP_ROOT, "node_modules", "next", "dist", "bin", "next");
  if (!fs.statSync(nextBin).isFile()) throw new Error("Task 8 Next binary is unavailable");
  const coreAllowedRoot = process.env.EDUPI_CORE_ALLOWED_ROOT || path.dirname(runtime.root);
  const child = spawn(process.execPath, [nextBin, "dev", "--webpack", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: DESKTOP_ROOT,
    detached: process.platform !== "win32",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      PATH: process.env.PATH,
      LANG: process.env.LANG || "en_US.UTF-8",
      LC_ALL: process.env.LC_ALL || "en_US.UTF-8",
      TZ: process.env.TZ || "Asia/Shanghai",
      NODE_ENV: "development",
      NEXT_TELEMETRY_DISABLED: "1",
      EDUPI_PROJECT_ROOT: workspace.dataRoot,
      EDUPI_DATA_ROOT: workspace.dataRoot,
      EDUPI_DATA_ALLOWED_ROOT: workspace.parentRoot,
      EDUPI_CORE_ROOT: runtime.root,
      EDUPI_CORE_ALLOWED_ROOT: coreAllowedRoot,
      EDUPI_CORE_VALIDATION_MODE: "external",
      EDUPI_CORE_RELEASE_MODE: "daemon",
      EDUPI_CORE_ENDPOINT: supervisor.proxy.endpoint,
      EDUPI_CORE_CLIENT_TOKEN: supervisor.environment.EDUPI_CORE_CLIENT_TOKEN,
      EDUPI_CORE_SUPERVISOR_SESSION: supervisor.environment.EDUPI_CORE_SUPERVISOR_SESSION,
      EDUPI_CORE_SCHEMA_HASH: runtime.schemaHash,
      EDUPI_CORE_COMMIT: runtime.coreCommit,
      EDUPI_CORE_COMPONENT_MANIFEST_HASH: runtime.componentManifestHash,
      EDUPI_CORE_ATTESTATION: `task8-visible-${crypto.randomBytes(12).toString("hex")}`,
      PI_DESKTOP_STATE_DIR: workspace.stateDir,
    },
  });
  let logs = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { logs = boundedLogs(logs, chunk); });
  child.stderr.on("data", (chunk) => { logs = boundedLogs(logs, chunk); });
  return { child, logs: () => logs, baseUrl: `http://127.0.0.1:${port}` };
}

async function waitForDesktopReady(server, taskId, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last = "Desktop not ready";
  while (Date.now() <= deadline) {
    if (server.child.exitCode !== null || server.child.signalCode !== null) throw new Error(`Task 8 Desktop exited before readiness: ${server.logs()}`);
    try {
      const [statusResponse, workspaceResponse, runningResponse] = await Promise.all([
        fetch(`${server.baseUrl}/api/edupi/status`),
        fetch(`${server.baseUrl}/api/edupi/workspace`),
        fetch(`${server.baseUrl}/api/agent/running`),
      ]);
      const [status, bundle, running] = await Promise.all([statusResponse.json(), workspaceResponse.json(), runningResponse.json()]);
      const workCase = bundle?.data?.workCases?.find((item) => item.taskId === taskId);
      if (statusResponse.ok && workspaceResponse.ok && runningResponse.ok
        && status?.core?.status === "ready"
        && workCase?.currentState === "draft_ready"
        && workCase.artifactIds?.length === 4
        && Array.isArray(running?.runningSessionIds)
        && running.runningSessionIds.length === 0
        && bundle?.data?.externalSend === false) {
        return { status, bundle, workCase, running };
      }
      last = JSON.stringify({ status: status?.core?.status, workCase: workCase?.currentState, running: running?.runningSessionIds });
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Task 8 Desktop readiness timeout: ${last}; logs: ${server.logs()}`);
}

async function stopDesktopDev(server) {
  if (!server || server.child.exitCode !== null || server.child.signalCode !== null) return;
  if (process.platform === "win32") server.child.kill("SIGTERM");
  else process.kill(-server.child.pid, "SIGTERM");
  const exited = await Promise.race([
    new Promise((resolve) => server.child.once("close", () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]);
  if (!exited) {
    if (process.platform === "win32") server.child.kill("SIGKILL");
    else process.kill(-server.child.pid, "SIGKILL");
    await new Promise((resolve) => server.child.once("close", resolve));
  }
}

export async function serveTask8VisibleCheckpoint({ coreRoot = process.env.EDUPI_CORE_ROOT, port = 30143 } = {}) {
  let server = null;
  return runTask8ContinuityE2({
    coreRoot,
    onReady: async ({ result, runtime, workspace, supervisor }) => {
      server = startDesktopDev({ runtime, workspace, supervisor, port });
      const ready = await waitForDesktopReady(server, result.task_id);
      process.stdout.write(`${JSON.stringify({
        status: "ready",
        url: `${server.baseUrl}/?edupi=1&module=tasks`,
        task_id: result.task_id,
        work_case_id: result.work_case_id,
        transition_states: ready.workCase.transitions.map((item) => item.state),
        artifact_ids: ready.workCase.artifactIds,
        active_chat_sessions: ready.running.runningSessionIds.length,
        external_send: false,
      })}\n`);
      await new Promise((resolve) => {
        process.once("SIGINT", resolve);
        process.once("SIGTERM", resolve);
      });
      await stopDesktopDev(server);
      server = null;
    },
  }).finally(async () => {
    await stopDesktopDev(server).catch(() => {});
  });
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const serve = args.includes("--serve");
  const portArgument = args.find((item) => item.startsWith("--port="));
  const port = portArgument ? Number(portArgument.slice("--port=".length)) : 30143;
  const unknown = args.filter((item) => item !== "--serve" && !item.startsWith("--port="));
  if (unknown.length > 0) throw new Error(`Unknown Task 8 argument: ${unknown[0]}`);
  const result = serve
    ? await serveTask8VisibleCheckpoint({ port })
    : await runTask8ContinuityE2();
  if (!serve) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
