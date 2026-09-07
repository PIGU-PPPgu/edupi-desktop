#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runEduPiG3DaemonE2 } from "./run-edupi-g3-daemon-e2.mjs";

const DESKTOP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PORT = 30144;
const PRODUCTION_PORT = 30141;

function boundedLogs(current, chunk) {
  const next = `${current}${String(chunk)}`;
  return next.length > 64 * 1024 ? next.slice(-64 * 1024) : next;
}

function validatePort(value) {
  const port = typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
  if (!Number.isInteger(port) || port < 1 || port > 65_535 || port === PRODUCTION_PORT) throw new Error("G3 visible port is invalid");
  return port;
}

function commonAncestor(paths) {
  let candidate = paths[0];
  while (candidate !== path.dirname(candidate)) {
    if (paths.every((item) => item === candidate || item.startsWith(`${candidate}${path.sep}`))) return candidate;
    candidate = path.dirname(candidate);
  }
  throw new Error("G3 Core and runtime dependencies have no bounded common root");
}

function coreAllowedRoot(runtimeRoot) {
  if (process.env.EDUPI_CORE_ALLOWED_ROOT) return fs.realpathSync(process.env.EDUPI_CORE_ALLOWED_ROOT);
  return commonAncestor([fs.realpathSync(runtimeRoot), fs.realpathSync(path.join(runtimeRoot, "node_modules"))]);
}

function startDesktop({ runtime, workspace, supervisor }, port) {
  const nextBin = path.join(DESKTOP_ROOT, "node_modules", "next", "dist", "bin", "next");
  if (!fs.statSync(nextBin).isFile()) throw new Error("G3 Next binary is unavailable");
  const environment = {
    ...process.env,
    NODE_ENV: "development",
    NEXT_TELEMETRY_DISABLED: "1",
    EDUPI_PROJECT_ROOT: workspace.dataRoot,
    EDUPI_DATA_ROOT: workspace.dataRoot,
    EDUPI_DATA_ALLOWED_ROOT: workspace.parentRoot,
    EDUPI_HOME: workspace.home,
    EDUPI_MEMORY_DIR: workspace.memoryDir,
    EDUPI_OUTPUT_DIR: workspace.outputDir,
    EDUPI_LOCK_DIR: workspace.lockDir,
    EDUPI_CORE_ROOT: runtime.root,
    EDUPI_CORE_ALLOWED_ROOT: coreAllowedRoot(runtime.root),
    EDUPI_CORE_VALIDATION_MODE: "external",
    EDUPI_CORE_RELEASE_MODE: "daemon",
    EDUPI_CORE_ENDPOINT: supervisor.proxy.endpoint,
    EDUPI_CORE_CLIENT_TOKEN: supervisor.environment.EDUPI_CORE_CLIENT_TOKEN,
    EDUPI_CORE_SUPERVISOR_SESSION: supervisor.environment.EDUPI_CORE_SUPERVISOR_SESSION,
    EDUPI_CORE_SCHEMA_HASH: runtime.schemaHash,
    EDUPI_CORE_COMMIT: runtime.coreCommit,
    EDUPI_CORE_COMPONENT_MANIFEST_HASH: runtime.componentManifestHash,
    EDUPI_CORE_ATTESTATION: `g3-visible-${crypto.randomBytes(12).toString("hex")}`,
    PI_DESKTOP_STATE_DIR: workspace.stateDir,
  };
  delete environment.EDUPI_CORE_TOKEN;
  delete environment.EDUPI_CORE_PORT;
  const child = spawn(process.execPath, [nextBin, "dev", "--webpack", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: DESKTOP_ROOT,
    env: environment,
    detached: process.platform !== "win32",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { logs = boundedLogs(logs, chunk); });
  child.stderr.on("data", (chunk) => { logs = boundedLogs(logs, chunk); });
  return { child, baseUrl: `http://127.0.0.1:${port}`, logs: () => logs };
}

async function stopDesktop(server) {
  if (!server || server.child.exitCode !== null || server.child.signalCode !== null) return;
  if (process.platform === "win32") server.child.kill("SIGTERM");
  else process.kill(-server.child.pid, "SIGTERM");
  const stopped = await Promise.race([
    new Promise((resolve) => server.child.once("close", () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]);
  if (!stopped) {
    if (process.platform === "win32") server.child.kill("SIGKILL");
    else process.kill(-server.child.pid, "SIGKILL");
    await new Promise((resolve) => server.child.once("close", resolve));
  }
}

async function waitForDesktop(server, result, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last = "not ready";
  while (Date.now() <= deadline) {
    if (server.child.exitCode !== null || server.child.signalCode !== null) throw new Error(`G3 Desktop exited before readiness: ${server.logs()}`);
    try {
      const [statusResponse, workspaceResponse, runningResponse] = await Promise.all([
        fetch(`${server.baseUrl}/api/edupi/status`),
        fetch(`${server.baseUrl}/api/edupi/workspace`),
        fetch(`${server.baseUrl}/api/agent/running`),
      ]);
      const [status, workspace, running] = await Promise.all([statusResponse.json(), workspaceResponse.json(), runningResponse.json()]);
      const workCase = workspace?.data?.workCases?.find((item) => item.id === result.work_case_id);
      const task = workspace?.data?.tasks?.find((item) => item.id === result.task_id);
      if (statusResponse.ok && workspaceResponse.ok && runningResponse.ok && status?.core?.status === "ready"
        && workCase?.currentState === "modified" && workCase.artifacts?.length === 2 && task?.reviewHistory?.length === 1
        && Array.isArray(running?.runningSessionIds) && running.runningSessionIds.length === 0 && workspace?.data?.externalSend === false) {
        return { status, workspace, running, workCase, task };
      }
      last = JSON.stringify({ core: status?.core?.status, reason: status?.core?.reason, workCase: workCase?.currentState, artifacts: workCase?.artifacts?.length, history: task?.reviewHistory?.length });
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`G3 Desktop readiness timeout: ${last}; logs: ${server.logs()}`);
}

export async function serveEduPiG3VisibleCheckpoint({ coreRoot = process.env.EDUPI_CORE_ROOT, port = DEFAULT_PORT } = {}) {
  const validatedPort = validatePort(port);
  return runEduPiG3DaemonE2({
    coreRoot,
    onReady: async (context) => {
      let server = null;
      try {
        server = startDesktop(context, validatedPort);
        const ready = await waitForDesktop(server, context.result);
        const url = `${server.baseUrl}/?edupi=1&module=tasks&task=${encodeURIComponent(context.result.task_id)}&stage=artifact&inspector=1`;
        process.stdout.write(`${JSON.stringify({ status: "ready", url, task_id: context.result.task_id, work_case_id: context.result.work_case_id, transition_states: ready.workCase.transitions.map((item) => item.state), artifact_ids: ready.workCase.artifactIds, active_chat_sessions: ready.running.runningSessionIds.length, external_send: false })}\n`);
        await Promise.race([
          new Promise((resolve) => { process.once("SIGINT", resolve); process.once("SIGTERM", resolve); }),
          new Promise((_, reject) => server.child.once("close", (code, signal) => reject(new Error(`G3 Desktop exited (${code ?? signal ?? "unknown"}): ${server.logs()}`)))),
        ]);
      } finally {
        await stopDesktop(server).catch(() => {});
      }
    },
  });
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  const portArgument = process.argv.slice(2).find((item) => item.startsWith("--port="));
  const unknown = process.argv.slice(2).filter((item) => !item.startsWith("--port="));
  if (unknown.length > 0) throw new Error(`Unknown G3 visible argument: ${unknown[0]}`);
  await serveEduPiG3VisibleCheckpoint({ port: portArgument ? portArgument.slice("--port=".length) : DEFAULT_PORT });
}
