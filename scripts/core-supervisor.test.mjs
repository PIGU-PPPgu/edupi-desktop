import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import test from "node:test";
import { createJiti } from "jiti";

const desktopRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const coreRoot = process.env.EDUPI_CORE_ROOT;
const require = createRequire(import.meta.url);
const supervisorModule = require("../desktop/core-supervisor.cjs");

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
  throw new Error("unable to allocate a distinct test port");
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
        const timer = setTimeout(() => reject(new Error(`supervisor envelope timeout: ${output}`)), timeoutMs);
        const inspect = () => {
          const lines = output.split("\n").filter(Boolean);
          if (!lines[consumed]) return;
          const line = lines[consumed];
          consumed += 1;
          clearTimeout(timer);
          child.stdout.removeListener("data", inspect);
          try {
            resolve(JSON.parse(line));
          } catch (error) {
            reject(error);
          }
        };
        child.stdout.on("data", inspect);
        inspect();
      });
    },
  };
}

async function baseEnvironment({ root, dataRoot, mode = "daemon", marker } = {}) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "contracts/edupi-core-runtime-component-manifest.json"), "utf8"));
  const schema = JSON.parse(fs.readFileSync(path.join(root, "contracts/edupi-core-runtime-v1-hash.json"), "utf8"));
  const clientPort = await choosePort();
  const environment = {
    ...process.env,
    EDUPI_CORE_RELEASE_MODE: mode,
    EDUPI_CORE_ROOT: root,
    EDUPI_DATA_ROOT: dataRoot,
    // Rendezvous capabilities must start with an alphanumeric character;
    // unprefixed base64url is allowed to start with '-' or '_'.
    EDUPI_CORE_CLIENT_TOKEN: `test-${crypto.randomBytes(32).toString("base64url")}`,
    EDUPI_CORE_CLIENT_PORT: String(clientPort),
    EDUPI_CORE_SUPERVISOR_SESSION: `supervisor-test-${process.pid}-${crypto.randomBytes(4).toString("hex")}`,
    EDUPI_CORE_COMMIT: /^[a-f0-9]{40}$/u.test(marker || "") ? marker : execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    EDUPI_CORE_COMPONENT_MANIFEST_HASH: manifest.component_manifest_hash,
    EDUPI_CORE_SCHEMA_HASH: schema.schema_hash,
    PI_WEB_PARENT_PID: String(process.pid),
  };
  if (mode === "daemon") {
    environment.EDUPI_CORE_TOKEN = crypto.randomBytes(32).toString("base64url");
    environment.EDUPI_CORE_PORT = String(await choosePort([clientPort]));
  } else {
    delete environment.EDUPI_CORE_TOKEN;
    delete environment.EDUPI_CORE_PORT;
  }
  return environment;
}

function spawnSupervisor(environment) {
  const child = spawn(process.execPath, [path.join(desktopRoot, "desktop/core-supervisor.cjs")], {
    cwd: desktopRoot,
    env: environment,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const errors = [];
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => errors.push(chunk));
  return { child, errors, reader: createEnvelopeReader(child) };
}

function spawnLiveLock(lockPath, holdMs = 30_000) {
  const script = [
    'const fs = require("node:fs");',
    'const lockPath = process.argv[1];',
    'const holdMs = Number(process.argv[2]);',
    'fs.writeFileSync(lockPath, String(process.pid) + "@" + Date.now() + "@supervisor-parent-loss");',
    'process.stdout.write("locked\\n");',
    'setTimeout(() => { try { fs.unlinkSync(lockPath); } catch {} }, holdMs);',
  ].join("");
  const child = spawn(process.execPath, ["-e", script, lockPath, String(holdMs)], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  return { child, output: () => output };
}

async function waitForLockReady(holder, timeoutMs = 5_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (holder.output().includes("locked\n")) return;
    if (holder.child.exitCode !== null || holder.child.signalCode !== null) throw new Error("lock helper exited before readiness");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("lock helper readiness timeout");
}

function writerAdmissionProbe(root, dataRoot, kind) {
  const probe = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(root, "scripts/test_core_runtime_writer_admission.mjs"), "probe"], {
    cwd: root,
    env: { ...process.env, EDUPI_TEST_WRITER_ROOT: dataRoot, EDUPI_TEST_WRITER_KIND: kind },
    encoding: "utf8",
  });
  assert.equal(probe.status, 0, probe.stderr);
  return JSON.parse(probe.stdout.trim().split("\n")[0]);
}

async function waitForAdmission(root, dataRoot, predicate, timeoutMs = 5_000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = writerAdmissionProbe(root, dataRoot, "legacy_task7_one_shot_probe");
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`writer admission condition timeout: ${JSON.stringify(last)}`);
}

async function stopSupervisor(child) {
  if (child.exitCode !== null || child.signalCode !== null) return { code: child.exitCode, signal: child.signalCode };
  child.stdin.write("stop\n");
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("supervisor stop timeout")), 23_000);
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function installClientCapability(environment, endpoint) {
  process.env.EDUPI_CORE_RENDEZVOUS_TEST_RESET = "1";
  const jiti = createJiti(import.meta.url);
  const rendezvous = await jiti.import("../lib/edupi-core-rendezvous.ts");
  const client = await jiti.import("../lib/edupi-core-process-client.ts");
  const snapshotClient = await jiti.import("../lib/edupi-core-snapshot.ts");
  const roots = await jiti.import("../lib/edupi-core-root.ts");
  rendezvous.captureEduPiCoreRendezvous({
    EDUPI_CORE_RELEASE_MODE: environment.EDUPI_CORE_RELEASE_MODE,
    EDUPI_CORE_ENDPOINT: endpoint,
    EDUPI_CORE_CLIENT_TOKEN: environment.EDUPI_CORE_CLIENT_TOKEN,
    EDUPI_CORE_SUPERVISOR_SESSION: environment.EDUPI_CORE_SUPERVISOR_SESSION,
    EDUPI_CORE_SCHEMA_HASH: environment.EDUPI_CORE_SCHEMA_HASH,
    EDUPI_CORE_COMMIT: environment.EDUPI_CORE_COMMIT,
    EDUPI_CORE_COMPONENT_MANIFEST_HASH: environment.EDUPI_CORE_COMPONENT_MANIFEST_HASH,
    EDUPI_CORE_ATTESTATION: "test-client-attestation-12345678",
  });
  const runtime = roots.resolveEduPiCoreRoot({
    configuredRoot: environment.EDUPI_CORE_ROOT,
    allowedRoot: process.env.EDUPI_CORE_ALLOWED_ROOT || path.dirname(environment.EDUPI_CORE_ROOT),
    runtimeIdentity: {
      core_commit: environment.EDUPI_CORE_COMMIT,
      component_manifest_path: "contracts/edupi-core-runtime-component-manifest.json",
      component_manifest_hash: environment.EDUPI_CORE_COMPONENT_MANIFEST_HASH,
    },
  });
  const dataRoot = roots.resolveEduPiDataRoot({
    configuredRoot: environment.EDUPI_DATA_ROOT,
    allowedRoot: path.dirname(environment.EDUPI_DATA_ROOT),
  });
  return { client, dataRoot, rendezvous, runtime, snapshotClient };
}

async function installSyntheticClientCapability(environment, endpoint) {
  process.env.EDUPI_CORE_RENDEZVOUS_TEST_RESET = "1";
  const jiti = createJiti(import.meta.url);
  const rendezvous = await jiti.import("../lib/edupi-core-rendezvous.ts");
  const client = await jiti.import("../lib/edupi-core-process-client.ts");
  rendezvous.captureEduPiCoreRendezvous({
    EDUPI_CORE_RELEASE_MODE: environment.EDUPI_CORE_RELEASE_MODE,
    EDUPI_CORE_ENDPOINT: endpoint,
    EDUPI_CORE_CLIENT_TOKEN: environment.EDUPI_CORE_CLIENT_TOKEN,
    EDUPI_CORE_SUPERVISOR_SESSION: environment.EDUPI_CORE_SUPERVISOR_SESSION,
    EDUPI_CORE_SCHEMA_HASH: environment.EDUPI_CORE_SCHEMA_HASH,
    EDUPI_CORE_COMMIT: environment.EDUPI_CORE_COMMIT,
    EDUPI_CORE_COMPONENT_MANIFEST_HASH: environment.EDUPI_CORE_COMPONENT_MANIFEST_HASH,
    EDUPI_CORE_ATTESTATION: "synthetic-client-attestation-12345678",
  });
  return {
    client,
    rendezvous,
    runtime: {
      coreCommit: environment.EDUPI_CORE_COMMIT,
      componentManifestHash: environment.EDUPI_CORE_COMPONENT_MANIFEST_HASH,
    },
    dataRoot: { root: environment.EDUPI_DATA_ROOT },
  };
}

async function readRealStatusRoute(environment) {
  const keys = [
    "EDUPI_CORE_ROOT",
    "EDUPI_CORE_ALLOWED_ROOT",
    "EDUPI_CORE_VALIDATION_MODE",
    "EDUPI_DATA_ROOT",
    "EDUPI_DATA_ALLOWED_ROOT",
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    EDUPI_CORE_ROOT: environment.EDUPI_CORE_ROOT,
    EDUPI_CORE_ALLOWED_ROOT: process.env.EDUPI_CORE_ALLOWED_ROOT || path.dirname(environment.EDUPI_CORE_ROOT),
    EDUPI_CORE_VALIDATION_MODE: "external",
    EDUPI_DATA_ROOT: environment.EDUPI_DATA_ROOT,
    EDUPI_DATA_ALLOWED_ROOT: path.dirname(environment.EDUPI_DATA_ROOT),
  });
  try {
    const route = await createJiti(import.meta.url, { tsconfigPaths: true }).import("../app/api/edupi/status/route.ts");
    const response = await route.GET();
    return { response, body: await response.json() };
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("daemon broker starts before Core, reconnects clients, and releases authority after supervisor loss", { skip: !coreRoot }, async () => {
  const root = fs.realpathSync(coreRoot);
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-core-supervisor-")));
  const dataRoot = path.join(temporary, "data");
  for (const directory of ["memory", "output", "locks"]) {
    fs.mkdirSync(path.join(dataRoot, ".edupi", directory), { recursive: true });
  }
  const environment = await baseEnvironment({ root, dataRoot });
  const { child, errors, reader } = spawnSupervisor(environment);
  let rendezvous;
  try {
    const proxyReady = await reader.next();
    assert.equal(proxyReady.status, "supervisor_ready");
    assert.equal(proxyReady.endpoint, `http://127.0.0.1:${environment.EDUPI_CORE_CLIENT_PORT}/runtime/v1`);
    assert.equal(proxyReady.mode, "daemon");
    assert.equal(JSON.stringify(proxyReady).includes(environment.EDUPI_CORE_TOKEN), false);
    assert.equal(JSON.stringify(proxyReady).includes(environment.EDUPI_CORE_CLIENT_TOKEN), false);
    assert.equal(JSON.stringify(proxyReady).includes(dataRoot), false);

    // The recovery/control surface exists before a Core instance is declared
    // ready. Depending on scheduler timing it returns unavailable or succeeds,
    // but it never blocks Tauri/Next startup on Core readiness.
    const beforeReady = await fetch(proxyReady.endpoint, {
      method: "POST",
      headers: {
        host: `127.0.0.1:${environment.EDUPI_CORE_CLIENT_PORT}`,
        "content-type": "application/json",
        authorization: `Bearer ${environment.EDUPI_CORE_CLIENT_TOKEN}`,
      },
      body: JSON.stringify({
        protocol: "edupi-core-runtime",
        protocol_version: 1,
        schema_hash: environment.EDUPI_CORE_SCHEMA_HASH,
        request_id: "before-core-ready",
        operation: "bridge_read",
        payload: { bridge_frame: JSON.stringify({ protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop", operation: "health", request_id: "before-core-ready" }) },
      }),
    });
    assert.ok([200, 503].includes(beforeReady.status));
    await beforeReady.arrayBuffer();

    const first = await reader.next();
    assert.equal(first.status, "ready");
    assert.equal(first.endpoint, proxyReady.endpoint);
    assert.equal(first.component_manifest_hash, environment.EDUPI_CORE_COMPONENT_MANIFEST_HASH);
    rendezvous = await installClientCapability(environment, proxyReady.endpoint);
    const health = await rendezvous.client.callEduPiCore({ operation: "health", requestId: "supervisor-client-health", runtime: rendezvous.runtime, dataRoot: rendezvous.dataRoot });
    assert.equal(health.ok, true);
    assert.deepEqual(health.supported_operations, ["health", "snapshot", "command", "students", "delete"]);
    const validatedHealth = await rendezvous.snapshotClient.readEduPiCoreHealth({
      requestId: "supervisor-validated-health",
      roots: { runtime: rendezvous.runtime, dataRoot: rendezvous.dataRoot },
    });
    assert.equal(validatedHealth.health.status, "ready");
    const statusRoute = await readRealStatusRoute(environment);
    assert.equal(statusRoute.response.status, 200);
    assert.equal(statusRoute.body.core.status, "ready");
    const snapshot = await rendezvous.client.callEduPiCore({ operation: "snapshot", requestId: "supervisor-client-snapshot", runtime: rendezvous.runtime, dataRoot: rendezvous.dataRoot });
    assert.equal(snapshot.ok, true);
    const students = await rendezvous.client.runCoreProcess({
      runtime: rendezvous.runtime,
      dataRoot: rendezvous.dataRoot,
      timeoutMs: 15_000,
      request: {
        protocol: "edupi-desktop-bridge",
        protocol_version: 1,
        producer: "edupi-desktop",
        operation: "students",
        request_id: "supervisor-client-students",
        action: "import",
        source_name: "supervisor.csv",
        students: [{ name: "监督学生", traits: [], parent_notes: [] }],
      },
    });
    assert.equal(students.ok, true, JSON.stringify(students));

    process.kill(first.child_pid, "SIGKILL");
    const restarted = await reader.next();
    assert.equal(restarted.status, "restarted");
    assert.equal(restarted.endpoint, first.endpoint);
    assert.equal(restarted.supervisor_session_id, first.supervisor_session_id);
    assert.notEqual(restarted.instance_nonce, first.instance_nonce);
    assert.ok(restarted.fencing_generation > first.fencing_generation);
    process.kill(restarted.child_pid, "SIGKILL");
    const restartedAgain = await reader.next();
    assert.equal(restartedAgain.status, "restarted");
    assert.equal(restartedAgain.endpoint, restarted.endpoint);
    assert.equal(restartedAgain.supervisor_session_id, restarted.supervisor_session_id);
    assert.notEqual(restartedAgain.instance_nonce, restarted.instance_nonce);
    assert.ok(restartedAgain.fencing_generation > restarted.fencing_generation);
    const restartedHealth = await rendezvous.client.callEduPiCore({ operation: "health", requestId: "supervisor-client-health-restarted", runtime: rendezvous.runtime, dataRoot: rendezvous.dataRoot });
    assert.equal(restartedHealth.ok, true);

    child.stdin.write("stop\n");
    process.kill(restartedAgain.child_pid, "SIGKILL");
    const exit = await new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
    assert.equal(exit.code, 0);
    assert.equal(reader.output().split("\n").filter((line) => line.includes('"status":"restarted"')).length, 2);
    assert.equal(errors.join("").includes(environment.EDUPI_CORE_TOKEN), false);
    assert.equal(errors.join("").includes(dataRoot), false);

    if (rendezvous) {
      rendezvous.rendezvous.clearEduPiCoreRendezvousForTests();
      rendezvous = null;
    }
    const orphanEnvironment = await baseEnvironment({ root, dataRoot });
    const orphan = spawnSupervisor(orphanEnvironment);
    const orphanProxy = await orphan.reader.next();
    assert.equal(orphanProxy.status, "supervisor_ready");
    const orphanReady = await orphan.reader.next();
    assert.equal(orphanReady.status, "ready");
    orphan.child.kill("SIGKILL");
    await new Promise((resolve) => orphan.child.once("close", resolve));
    let reacquired = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const probe = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(root, "scripts/test_core_runtime_writer_admission.mjs"), "probe"], {
        cwd: root,
        env: { ...process.env, EDUPI_TEST_WRITER_ROOT: dataRoot, EDUPI_TEST_WRITER_KIND: "legacy_supervisor_loss_probe" },
        encoding: "utf8",
      });
      if (probe.status === 0 && JSON.parse(probe.stdout.trim().split("\n")[0]).status === "acquired") {
        await new Promise((resolve) => setTimeout(resolve, 400));
        const confirmation = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(root, "scripts/test_core_runtime_writer_admission.mjs"), "probe"], {
          cwd: root,
          env: { ...process.env, EDUPI_TEST_WRITER_ROOT: dataRoot, EDUPI_TEST_WRITER_KIND: "legacy_supervisor_loss_confirm" },
          encoding: "utf8",
        });
        if (confirmation.status === 0 && JSON.parse(confirmation.stdout.trim().split("\n")[0]).status === "acquired") {
          reacquired = true;
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(reacquired, true);
  } finally {
    try { rendezvous?.rendezvous.clearEduPiCoreRendezvousForTests(); } catch {}
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("supervisor loss in the pre-ready startup window leaves no writer", { skip: !coreRoot }, async () => {
  const root = fs.realpathSync(coreRoot);
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-core-pre-ready-loss-")));
  const dataRoot = path.join(temporary, "data");
  for (const directory of ["memory", "output", "locks"]) {
    fs.mkdirSync(path.join(dataRoot, ".edupi", directory), { recursive: true });
  }
  const environment = await baseEnvironment({ root, dataRoot });
  const { child, reader } = spawnSupervisor(environment);
  try {
    assert.equal((await reader.next()).status, "supervisor_ready");
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("close", resolve));
    let reacquired = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const probe = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(root, "scripts/test_core_runtime_writer_admission.mjs"), "probe"], {
        cwd: root,
        env: { ...process.env, EDUPI_TEST_WRITER_ROOT: dataRoot, EDUPI_TEST_WRITER_KIND: "legacy_pre_ready_parent_loss" },
        encoding: "utf8",
      });
      if (probe.status === 0 && JSON.parse(probe.stdout.trim().split("\n")[0]).status === "acquired") {
        await new Promise((resolve) => setTimeout(resolve, 400));
        const confirmation = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(root, "scripts/test_core_runtime_writer_admission.mjs"), "probe"], {
          cwd: root,
          env: { ...process.env, EDUPI_TEST_WRITER_ROOT: dataRoot, EDUPI_TEST_WRITER_KIND: "legacy_pre_ready_parent_loss_confirm" },
          encoding: "utf8",
        });
        if (confirmation.status === 0 && JSON.parse(confirmation.stdout.trim().split("\n")[0]).status === "acquired") {
          reacquired = true;
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(reacquired, true);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("one-shot rollback remains brokered and never starts a resident Core", { skip: !coreRoot }, async () => {
  const root = fs.realpathSync(coreRoot);
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-one-shot-broker-")));
  const dataRoot = path.join(temporary, "data");
  for (const directory of ["memory", "output", "locks"]) {
    fs.mkdirSync(path.join(dataRoot, ".edupi", directory), { recursive: true });
  }
  const environment = await baseEnvironment({ root, dataRoot, mode: "one-shot" });
  const { child, reader } = spawnSupervisor(environment);
  let capability;
  try {
    const ready = await reader.next();
    assert.equal(ready.status, "supervisor_ready");
    assert.equal(ready.mode, "one-shot");
    const forbiddenRuntime = await fetch(ready.endpoint, {
      method: "POST",
      headers: {
        host: `127.0.0.1:${environment.EDUPI_CORE_CLIENT_PORT}`,
        "content-type": "application/json",
        authorization: `Bearer ${environment.EDUPI_CORE_CLIENT_TOKEN}`,
      },
      body: JSON.stringify({
        protocol: "edupi-core-runtime",
        protocol_version: 1,
        schema_hash: environment.EDUPI_CORE_SCHEMA_HASH,
        request_id: "forbidden-shutdown",
        operation: "shutdown",
        payload: null,
      }),
    });
    assert.equal(forbiddenRuntime.status, 400);
    assert.equal((await forbiddenRuntime.json()).error_code, "unsupported_operation");
    const forbiddenBridge = await fetch(ready.endpoint, {
      method: "POST",
      headers: {
        host: `127.0.0.1:${environment.EDUPI_CORE_CLIENT_PORT}`,
        "content-type": "application/json",
        authorization: `Bearer ${environment.EDUPI_CORE_CLIENT_TOKEN}`,
      },
      body: JSON.stringify({
        protocol: "edupi-core-runtime",
        protocol_version: 1,
        schema_hash: environment.EDUPI_CORE_SCHEMA_HASH,
        request_id: "forbidden-connector",
        operation: "bridge_call",
        payload: {
          bridge_frame: JSON.stringify({
            protocol: "edupi-desktop-bridge",
            protocol_version: 1,
            producer: "edupi-desktop",
            operation: "connector-setup",
            request_id: "forbidden-connector",
            action: "configure",
          }),
        },
      }),
    });
    assert.equal(forbiddenBridge.status, 400);
    assert.equal((await forbiddenBridge.json()).error_code, "invalid_bridge_frame");
    capability = await installClientCapability(environment, ready.endpoint);
    const health = await capability.client.callEduPiCore({ operation: "health", requestId: "one-shot-health", runtime: capability.runtime, dataRoot: capability.dataRoot });
    assert.equal(health.ok, true);
    assert.deepEqual(health.supported_operations, ["health", "snapshot", "command", "students", "delete"]);
    const students = await capability.client.runCoreProcess({
      runtime: capability.runtime,
      dataRoot: capability.dataRoot,
      timeoutMs: 15_000,
      request: {
        protocol: "edupi-desktop-bridge",
        protocol_version: 1,
        producer: "edupi-desktop",
        operation: "students",
        request_id: "one-shot-students",
        action: "import",
        source_name: "rollback.csv",
        students: [{ name: "回滚学生", traits: [], parent_notes: [] }],
      },
    });
    assert.equal(students.ok, true);
    assert.equal(reader.output().split("\n").filter(Boolean).length, 1, "one-shot mode must not emit a resident Core identity");
    assert.equal((await stopSupervisor(child)).code, 0);
  } finally {
    try { capability?.rendezvous.clearEduPiCoreRendezvousForTests(); } catch {}
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("broker loss during an active one-shot mutation promptly releases writer admission", { skip: !coreRoot }, async () => {
  const root = fs.realpathSync(coreRoot);
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-one-shot-parent-loss-")));
  const dataRoot = path.join(temporary, "data");
  for (const directory of ["memory", "output", "locks"]) {
    fs.mkdirSync(path.join(dataRoot, ".edupi", directory), { recursive: true });
  }
  const lock = spawnLiveLock(path.join(dataRoot, ".edupi", "locks", "student_roster.lock"));
  const environment = await baseEnvironment({ root, dataRoot, mode: "one-shot" });
  const { child, reader } = spawnSupervisor(environment);
  let pendingRequest = Promise.resolve();
  try {
    await waitForLockReady(lock);
    const ready = await reader.next();
    assert.equal(ready.status, "supervisor_ready");
    pendingRequest = fetch(ready.endpoint, {
      method: "POST",
      headers: {
        host: `127.0.0.1:${environment.EDUPI_CORE_CLIENT_PORT}`,
        "content-type": "application/json",
        authorization: `Bearer ${environment.EDUPI_CORE_CLIENT_TOKEN}`,
      },
      body: JSON.stringify({
        protocol: "edupi-core-runtime",
        protocol_version: 1,
        schema_hash: environment.EDUPI_CORE_SCHEMA_HASH,
        request_id: "one-shot-parent-loss-students",
        operation: "bridge_call",
        payload: {
          bridge_frame: JSON.stringify({
            protocol: "edupi-desktop-bridge",
            protocol_version: 1,
            producer: "edupi-desktop",
            operation: "students",
            request_id: "one-shot-parent-loss-students",
            action: "import",
            source_name: "parent-loss.csv",
            students: [{ name: "父进程失联学生", traits: [], parent_notes: [] }],
          }),
        },
      }),
    }).then(async (response) => ({ status: response.status, body: await response.text() }), (error) => ({ error }));

    await waitForAdmission(root, dataRoot, (value) => value.status === "error" && value.code === "writer_admission_unavailable");
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("close", resolve));
    const reacquired = await waitForAdmission(root, dataRoot, (value) => value.status === "acquired", 3_000);
    assert.equal(reacquired.status, "acquired");
    const confirmation = writerAdmissionProbe(root, dataRoot, "legacy_task7_one_shot_confirm");
    assert.equal(confirmation.status, "acquired");
    const requestOutcome = await pendingRequest;
    assert.ok("error" in requestOutcome || requestOutcome.status !== 200, "broker loss must not report one-shot success");
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    if (lock.child.exitCode === null && lock.child.signalCode === null) lock.child.kill("SIGKILL");
    await pendingRequest.catch(() => {});
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("broker stays available when Core never reaches initial readiness", async () => {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-core-initial-failure-")));
  const root = path.join(temporary, "core");
  const dataRoot = path.join(temporary, "data");
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.writeFileSync(path.join(root, "scripts", "core_runtime_daemon.mjs"), "process.exit(1);\n");
  const clientPort = await choosePort();
  const environment = {
    ...process.env,
    EDUPI_CORE_RELEASE_MODE: "daemon",
    EDUPI_CORE_ROOT: root,
    EDUPI_DATA_ROOT: dataRoot,
    EDUPI_CORE_CLIENT_TOKEN: "initial-failure-capability-12345678",
    EDUPI_CORE_CLIENT_PORT: String(clientPort),
    EDUPI_CORE_TOKEN: "initial-failure-core-token-12345678",
    EDUPI_CORE_PORT: String(await choosePort([clientPort])),
    EDUPI_CORE_SUPERVISOR_SESSION: "initial-failure-session-12345678",
    EDUPI_CORE_COMMIT: "a".repeat(40),
    EDUPI_CORE_COMPONENT_MANIFEST_HASH: `sha256:${"2".repeat(64)}`,
    EDUPI_CORE_SCHEMA_HASH: `sha256:${"1".repeat(64)}`,
    PI_WEB_PARENT_PID: String(process.pid),
  };
  const { child, reader } = spawnSupervisor(environment);
  try {
    const proxyReady = await reader.next(2_000);
    assert.equal(proxyReady.status, "supervisor_ready");
    const failed = await reader.next(5_000);
    assert.deepEqual(failed, { status: "failed", code: "restart_limit", external_send: false });
    const response = await fetch(proxyReady.endpoint, {
      method: "POST",
      headers: {
        host: `127.0.0.1:${environment.EDUPI_CORE_CLIENT_PORT}`,
        "content-type": "application/json",
        authorization: `Bearer ${environment.EDUPI_CORE_CLIENT_TOKEN}`,
      },
      body: JSON.stringify({
        protocol: "edupi-core-runtime", protocol_version: 1,
        schema_hash: environment.EDUPI_CORE_SCHEMA_HASH, request_id: "initial-failure-health",
        operation: "bridge_read",
        payload: { bridge_frame: JSON.stringify({ protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop", operation: "health", request_id: "initial-failure-health" }) },
      }),
    });
    assert.equal(response.status, 503);
    assert.equal((await stopSupervisor(child)).code, 0);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("bounded failed Core restarts leave the broker available without hanging", async () => {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-core-supervisor-fail-")));
  const root = path.join(temporary, "core");
  const dataRoot = path.join(temporary, "data");
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(dataRoot, { recursive: true });
  const manifest = {
    component_manifest_hash: `sha256:${"3".repeat(64)}`,
  };
  fs.mkdirSync(path.join(root, "contracts"), { recursive: true });
  fs.writeFileSync(path.join(root, "contracts", "edupi-core-runtime-component-manifest.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(root, "contracts", "edupi-core-runtime-v1-hash.json"), JSON.stringify({ schema_hash: `sha256:${"1".repeat(64)}` }));
  const marker = path.join(temporary, "started");
  fs.writeFileSync(path.join(root, "scripts", "core_runtime_daemon.mjs"), `
    import fs from "node:fs";
    import http from "node:http";
    const marker = ${JSON.stringify(marker)};
    const port = Number(process.env.EDUPI_CORE_PORT);
    if (fs.existsSync(marker)) process.exit(1);
    fs.writeFileSync(marker, "1");
    const ready = {
      endpoint: "http://127.0.0.1:" + port + "/runtime/v1",
      host: "127.0.0.1", port, protocol: "edupi-core-runtime",
      protocol_version: 1, contract_version: "1.0",
      schema_hash: process.env.EDUPI_CORE_SCHEMA_HASH || ${JSON.stringify(`sha256:${"1".repeat(64)}`)},
      supervisor_session_id: process.env.EDUPI_CORE_SUPERVISOR_SESSION,
      core_commit: process.env.EDUPI_CORE_COMMIT,
      component_manifest_hash: process.env.EDUPI_CORE_COMPONENT_MANIFEST_HASH,
      data_root_fingerprint: ${JSON.stringify(`sha256:${"2".repeat(64)}`)},
      instance_nonce: "instance-fake-12345678", fencing_generation: 1, external_send: false,
    };
    console.log(JSON.stringify(ready));
    http.createServer(async (request, response) => {
      let incoming = ""; for await (const chunk of request) incoming += chunk;
      const frame = JSON.parse(incoming);
      const body = JSON.stringify({
        protocol: ready.protocol, protocol_version: 1, schema_hash: ready.schema_hash,
        request_id: frame.request_id, operation: frame.operation, ok: true,
        result: {
          lifecycle: "ready", supervisor_session_id: ready.supervisor_session_id,
          instance_nonce: ready.instance_nonce, core_commit: ready.core_commit,
          component_manifest_hash: ready.component_manifest_hash,
          data_root_fingerprint: ready.data_root_fingerprint,
          fencing_generation: 1,
        },
        error_code: null, external_send: false,
      });
      response.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
      response.end(body);
    }).listen(port, "127.0.0.1");
  `);
  const clientPort = await choosePort();
  const environment = {
    ...process.env,
    EDUPI_CORE_RELEASE_MODE: "daemon",
    EDUPI_CORE_ROOT: root,
    EDUPI_DATA_ROOT: dataRoot,
    EDUPI_CORE_CLIENT_TOKEN: "fake-client-capability-12345678",
    EDUPI_CORE_CLIENT_PORT: String(clientPort),
    EDUPI_CORE_TOKEN: "fake-core-token-12345678",
    EDUPI_CORE_PORT: String(await choosePort([clientPort])),
    EDUPI_CORE_SUPERVISOR_SESSION: "fake-session-12345678",
    EDUPI_CORE_COMMIT: "a".repeat(40),
    EDUPI_CORE_COMPONENT_MANIFEST_HASH: manifest.component_manifest_hash,
    EDUPI_CORE_SCHEMA_HASH: `sha256:${"1".repeat(64)}`,
    PI_WEB_PARENT_PID: String(process.pid),
  };
  const { child, reader } = spawnSupervisor(environment);
  try {
    assert.equal((await reader.next()).status, "supervisor_ready");
    const ready = await reader.next();
    assert.equal(ready.status, "ready");
    process.kill(ready.child_pid, "SIGKILL");
    const failed = await reader.next(10_000);
    assert.deepEqual(failed, { status: "failed", code: "restart_limit", external_send: false });
    const unavailable = await fetch(`http://127.0.0.1:${environment.EDUPI_CORE_CLIENT_PORT}/runtime/v1`, {
      method: "POST",
      headers: {
        host: `127.0.0.1:${environment.EDUPI_CORE_CLIENT_PORT}`,
        "content-type": "application/json",
        authorization: `Bearer ${environment.EDUPI_CORE_CLIENT_TOKEN}`,
      },
      body: JSON.stringify({
        protocol: "edupi-core-runtime", protocol_version: 1,
        schema_hash: environment.EDUPI_CORE_SCHEMA_HASH, request_id: "failed-health",
        operation: "bridge_read",
        payload: { bridge_frame: JSON.stringify({ protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop", operation: "health", request_id: "failed-health" }) },
      }),
    });
    assert.equal(unavailable.status, 503);
    assert.equal((await stopSupervisor(child)).code, 0);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("near-deadline Core failure crosses both broker transports without becoming a client timeout", async () => {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-core-near-deadline-")));
  const root = path.join(temporary, "core");
  const dataRoot = path.join(temporary, "data");
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "contracts"), { recursive: true });
  fs.mkdirSync(dataRoot, { recursive: true });
  const manifestHash = `sha256:${"3".repeat(64)}`;
  const schemaHash = `sha256:${"1".repeat(64)}`;
  fs.writeFileSync(path.join(root, "contracts", "edupi-core-runtime-component-manifest.json"), JSON.stringify({ component_manifest_hash: manifestHash }));
  fs.writeFileSync(path.join(root, "contracts", "edupi-core-runtime-v1-hash.json"), JSON.stringify({ schema_hash: schemaHash }));
  fs.writeFileSync(path.join(root, "scripts", "core_runtime_daemon.mjs"), `
    import http from "node:http";
    const port = Number(process.env.EDUPI_CORE_PORT);
    const ready = {
      endpoint: "http://127.0.0.1:" + port + "/runtime/v1",
      host: "127.0.0.1", port, protocol: "edupi-core-runtime",
      protocol_version: 1, contract_version: "1.0",
      schema_hash: process.env.EDUPI_CORE_SCHEMA_HASH || ${JSON.stringify(schemaHash)},
      supervisor_session_id: process.env.EDUPI_CORE_SUPERVISOR_SESSION,
      core_commit: process.env.EDUPI_CORE_COMMIT,
      component_manifest_hash: process.env.EDUPI_CORE_COMPONENT_MANIFEST_HASH,
      data_root_fingerprint: ${JSON.stringify(`sha256:${"2".repeat(64)}`)},
      instance_nonce: "near-deadline-instance-12345678",
      fencing_generation: 1,
      external_send: false,
    };
    let server;
    server = http.createServer(async (request, response) => {
      let incoming = "";
      for await (const chunk of request) incoming += chunk;
      const frame = JSON.parse(incoming);
      let ok = true;
      let result;
      let errorCode = null;
      let shutdown = false;
      if (frame.operation === "health") {
        result = {
          lifecycle: "ready",
          supervisor_session_id: ready.supervisor_session_id,
          instance_nonce: ready.instance_nonce,
          core_commit: ready.core_commit,
          component_manifest_hash: ready.component_manifest_hash,
          data_root_fingerprint: ready.data_root_fingerprint,
          fencing_generation: ready.fencing_generation,
        };
      } else if (frame.operation === "bridge_call") {
        await new Promise((resolve) => setTimeout(resolve, 15_050));
        ok = false;
        result = null;
        errorCode = "bridge_timeout";
      } else if (frame.operation === "begin_drain") {
        result = { lifecycle: "draining" };
      } else if (frame.operation === "shutdown") {
        result = { status: "stopping" };
        shutdown = true;
      } else {
        ok = false;
        result = null;
        errorCode = "unsupported_operation";
      }
      const body = JSON.stringify({
        protocol: ready.protocol,
        protocol_version: ready.protocol_version,
        schema_hash: ready.schema_hash,
        request_id: frame.request_id,
        operation: frame.operation,
        ok,
        result,
        error_code: errorCode,
        external_send: false,
      });
      if (shutdown) response.once("finish", () => server.close(() => process.exit(0)));
      response.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(body), connection: "close" });
      response.end(body);
    });
    server.listen(port, "127.0.0.1", () => console.log(JSON.stringify(ready)));
  `);
  const environment = await baseEnvironment({ root, dataRoot, marker: "a".repeat(40) });
  const { child, reader } = spawnSupervisor(environment);
  let capability;
  try {
    const proxy = await reader.next();
    assert.equal(proxy.status, "supervisor_ready");
    assert.equal((await reader.next()).status, "ready");
    capability = await installSyntheticClientCapability(environment, proxy.endpoint);
    const startedAt = Date.now();
    await assert.rejects(
      capability.client.callEduPiCore({
        operation: "command",
        requestId: "near-deadline-bridge-timeout",
        runtime: capability.runtime,
        dataRoot: capability.dataRoot,
        envelope: {},
      }),
      (error) => error?.code === "bridge_timeout",
    );
    const elapsedMs = Date.now() - startedAt;
    assert.ok(elapsedMs >= 15_000, `near-deadline response arrived too early: ${elapsedMs}ms`);
    assert.ok(elapsedMs < 17_000, `near-deadline response was cut off by an outer timeout: ${elapsedMs}ms`);
    assert.equal((await stopSupervisor(child)).code, 0);
  } finally {
    try { capability?.rendezvous.clearEduPiCoreRendezvousForTests(); } catch {}
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("Core response reader is streaming-bounded and identity-strict", async () => {
  let mode = "oversized";
  const server = http.createServer((request, response) => {
    if (mode === "oversized") {
      response.writeHead(200, { "content-type": "application/json", connection: "close" });
      const chunk = Buffer.alloc(64 * 1024, "x");
      for (let index = 0; index < 70; index += 1) response.write(chunk);
      response.end();
      return;
    }
    const body = JSON.stringify({
      protocol: "edupi-core-runtime", protocol_version: 1,
      schema_hash: `sha256:${"1".repeat(64)}`, request_id: "wrong-request",
      operation: "health", ok: true, external_send: false, result: {}, error_code: null,
    });
    response.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
    response.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const config = { corePort: server.address().port, coreToken: "reader-token-12345678", schemaHash: `sha256:${"1".repeat(64)}` };
  try {
    await assert.rejects(supervisorModule.requestCore(config, "health", 5_000), (error) => error?.code === "runtime_output_limit");
    mode = "identity";
    await assert.rejects(supervisorModule.requestCore(config, "health", 5_000), (error) => error?.code === "runtime_identity");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
