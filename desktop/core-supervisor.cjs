"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

const crypto = require("node:crypto");
const http = require("node:http");
const path = require("node:path");
const readline = require("node:readline");
const { spawn } = require("node:child_process");

const MAX_RESTARTS = 3;
const START_TIMEOUT_MS = 10_000;
const READ_TIMEOUT_MS = 5_000;
const MUTATION_TIMEOUT_MS = 15_000;
const TRANSPORT_GRACE_MS = 1_000;
const MAX_PROXY_RESPONSE_TIMEOUT_MS = MUTATION_TIMEOUT_MS + (3 * TRANSPORT_GRACE_MS);
const STOP_TOTAL_MS = 20_000;
const MAX_STDERR_BYTES = 64 * 1024;
const MAX_READY_BYTES = 64 * 1024;
const MAX_BRIDGE_REQUEST_BYTES = 256 * 1024;
const MAX_BRIDGE_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_RUNTIME_REQUEST_BYTES = 589_824;
const MAX_RUNTIME_RESPONSE_BYTES = 4_259_840;
const MAX_PROXY_REQUESTS = 16;
const MAX_PROXY_SOCKETS = 64;
const RUNTIME_PROTOCOL = "edupi-core-runtime";
const RUNTIME_VERSION = 1;
const RUNTIME_PATH = "/runtime/v1";
const BRIDGE_PROTOCOL = "edupi-desktop-bridge";
const BRIDGE_VERSION = 1;
const BRIDGE_PRODUCER = "edupi-desktop";
const BRIDGE_CONTRACT_VERSION = "1.1";
const BRIDGE_READS = new Set(["health", "snapshot"]);
const BRIDGE_CALLS = new Set(["command", "students", "delete"]);
const BROKER_SUPPORTED_OPERATIONS = Object.freeze(["health", "snapshot", "command", "students", "delete"]);
const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::ffff:127.0.0.1"]);

function fail(code) {
  const error = new Error("Core supervisor unavailable");
  error.code = code;
  return error;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function required(environment, name) {
  const value = environment[name];
  if (typeof value !== "string" || value.length === 0) throw fail("invalid_configuration");
  return value;
}

function requiredMatch(environment, name, pattern) {
  const value = required(environment, name);
  if (!pattern.test(value)) throw fail("invalid_configuration");
  return value;
}

function positivePort(value) {
  if (!/^\d+$/u.test(value)) throw fail("invalid_configuration");
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw fail("invalid_configuration");
  return port;
}

function absoluteDirectoryValue(environment, name) {
  const value = required(environment, name);
  if (!path.isAbsolute(value) || path.resolve(value) !== value) throw fail("invalid_configuration");
  return value;
}

function expectedConfiguration(environment = process.env) {
  const mode = required(environment, "EDUPI_CORE_RELEASE_MODE");
  if (mode !== "daemon" && mode !== "one-shot") throw fail("invalid_configuration");
  const parentPidValue = required(environment, "PI_WEB_PARENT_PID");
  if (!/^[1-9]\d*$/u.test(parentPidValue) || !Number.isSafeInteger(Number(parentPidValue))) throw fail("invalid_configuration");
  const root = absoluteDirectoryValue(environment, "EDUPI_CORE_ROOT");
  const dataRoot = absoluteDirectoryValue(environment, "EDUPI_DATA_ROOT");
  const config = {
    mode,
    root,
    dataRoot,
    clientToken: requiredMatch(environment, "EDUPI_CORE_CLIENT_TOKEN", /^[A-Za-z0-9_-]{16,512}$/u),
    clientPort: positivePort(required(environment, "EDUPI_CORE_CLIENT_PORT")),
    supervisorSessionId: requiredMatch(environment, "EDUPI_CORE_SUPERVISOR_SESSION", /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{7,127}$/u),
    coreCommit: requiredMatch(environment, "EDUPI_CORE_COMMIT", /^[A-Fa-f0-9]{40}$/u),
    componentManifestHash: requiredMatch(environment, "EDUPI_CORE_COMPONENT_MANIFEST_HASH", /^sha256:[a-f0-9]{64}$/u),
    schemaHash: requiredMatch(environment, "EDUPI_CORE_SCHEMA_HASH", /^sha256:[a-f0-9]{64}$/u),
    parentPid: Number(parentPidValue),
    stateDir: typeof environment.PI_DESKTOP_STATE_DIR === "string" && path.isAbsolute(environment.PI_DESKTOP_STATE_DIR)
      ? path.resolve(environment.PI_DESKTOP_STATE_DIR)
      : null,
    entrypoint: path.join(root, "scripts", "core_runtime_daemon.mjs"),
    oneShotEntrypoint: path.join(root, "scripts", "desktop_bridge_port.mjs"),
  };
  if (mode === "daemon") {
    config.coreToken = requiredMatch(environment, "EDUPI_CORE_TOKEN", /^[A-Za-z0-9_-]{16,512}$/u);
    config.corePort = positivePort(required(environment, "EDUPI_CORE_PORT"));
  }
  return Object.freeze(config);
}

function coreChildEnvironment(config) {
  return {
    PATH: process.env.PATH,
    LANG: process.env.LANG || "en_US.UTF-8",
    LC_ALL: process.env.LC_ALL || "en_US.UTF-8",
    TZ: process.env.TZ || "Asia/Shanghai",
    NODE_ENV: process.env.NODE_ENV || "production",
    EDUPI_DATA_ROOT: config.dataRoot,
    EDUPI_PROJECT_ROOT: config.dataRoot,
    EDUPI_HOME: path.join(config.dataRoot, ".edupi"),
    EDUPI_MEMORY_DIR: path.join(config.dataRoot, ".edupi", "memory"),
    EDUPI_OUTPUT_DIR: path.join(config.dataRoot, ".edupi", "output"),
    EDUPI_LOCK_DIR: path.join(config.dataRoot, ".edupi", "locks"),
    EDUPI_CORE_TOKEN: config.coreToken,
    EDUPI_CORE_SUPERVISOR_SESSION: config.supervisorSessionId,
    EDUPI_CORE_PORT: String(config.corePort),
    EDUPI_CORE_COMMIT: config.coreCommit,
    EDUPI_CORE_COMPONENT_MANIFEST_HASH: config.componentManifestHash,
    EDUPI_CORE_PARENT_PID: String(process.pid),
  };
}

function oneShotEnvironment(config) {
  return {
    PATH: process.env.PATH,
    LANG: process.env.LANG || "en_US.UTF-8",
    LC_ALL: process.env.LC_ALL || "en_US.UTF-8",
    TZ: process.env.TZ || "Asia/Shanghai",
    NODE_ENV: process.env.NODE_ENV || "production",
    EDUPI_PROJECT_ROOT: config.dataRoot,
    EDUPI_HOME: path.join(config.dataRoot, ".edupi"),
    EDUPI_MEMORY_DIR: path.join(config.dataRoot, ".edupi", "memory"),
    EDUPI_OUTPUT_DIR: path.join(config.dataRoot, ".edupi", "output"),
    EDUPI_LOCK_DIR: path.join(config.dataRoot, ".edupi", "locks"),
    EDUPI_CORE_COMMIT: config.coreCommit,
    EDUPI_CORE_PARENT_PID: String(process.pid),
    ...(config.stateDir ? { PI_DESKTOP_STATE_DIR: config.stateDir } : {}),
  };
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function tokenDigest(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest();
}

function sameToken(expected, provided) {
  if (typeof provided !== "string" || !provided.startsWith("Bearer ")) return false;
  return crypto.timingSafeEqual(tokenDigest(expected), tokenDigest(provided.slice(7)));
}

async function readFetchBody(response, maxBytes, controller) {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && (!/^\d+$/u.test(contentLength) || Number(contentLength) > maxBytes)) throw fail("runtime_output_limit");
  if (!response.body) throw fail("runtime_invalid_response");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        controller?.abort();
        throw fail("runtime_output_limit");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (contentLength !== null && Number(contentLength) !== total) throw fail("runtime_output_limit");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw fail("runtime_invalid_response");
  }
}

function validateRuntimeEnvelope(config, request, value) {
  const keys = ["error_code", "external_send", "ok", "operation", "protocol", "protocol_version", "request_id", "result", "schema_hash"];
  if (!hasExactKeys(value, keys)
    || value.protocol !== RUNTIME_PROTOCOL
    || value.protocol_version !== RUNTIME_VERSION
    || value.schema_hash !== config.schemaHash
    || value.request_id !== request.request_id
    || value.operation !== request.operation
    || value.external_send !== false) throw fail("runtime_identity");
  if (value.ok === true) {
    if (value.error_code !== null || !isPlainObject(value.result)) throw fail("runtime_identity");
  } else if (value.ok === false) {
    if (value.result !== null || typeof value.error_code !== "string") throw fail("runtime_identity");
  } else {
    throw fail("runtime_identity");
  }
  return value;
}

async function fetchCoreRuntime(config, request, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  timer.unref?.();
  try {
    const response = await fetch(`http://127.0.0.1:${config.corePort}${RUNTIME_PATH}`, {
      method: "POST",
      headers: {
        host: `127.0.0.1:${config.corePort}`,
        "content-type": "application/json",
        authorization: `Bearer ${config.coreToken}`,
      },
      body: JSON.stringify(request),
      redirect: "error",
      signal: controller.signal,
    });
    const text = await readFetchBody(response, MAX_RUNTIME_RESPONSE_BYTES, controller);
    if (!response.ok) throw fail("runtime_unavailable");
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      throw fail("runtime_invalid_response");
    }
    return validateRuntimeEnvelope(config, request, value);
  } catch (error) {
    if (error?.code) throw error;
    throw fail(controller.signal.aborted ? "runtime_timeout" : "runtime_unavailable");
  } finally {
    clearTimeout(timer);
  }
}

async function requestCore(config, operation, timeoutMs) {
  const request = {
    protocol: RUNTIME_PROTOCOL,
    protocol_version: RUNTIME_VERSION,
    schema_hash: config.schemaHash,
    request_id: `supervisor-${operation}-${crypto.randomBytes(8).toString("hex")}`,
    operation,
    payload: null,
  };
  const response = await fetchCoreRuntime(config, request, timeoutMs);
  if (!response.ok) throw fail(response.error_code || "runtime_error");
  return response.result;
}

function validateCoreReadiness(config, value) {
  const keys = ["component_manifest_hash", "contract_version", "core_commit", "data_root_fingerprint", "endpoint", "external_send", "fencing_generation", "host", "instance_nonce", "port", "protocol", "protocol_version", "schema_hash", "supervisor_session_id"];
  if (!hasExactKeys(value, keys)
    || value.endpoint !== `http://127.0.0.1:${config.corePort}${RUNTIME_PATH}`
    || value.host !== "127.0.0.1"
    || value.port !== config.corePort
    || value.protocol !== RUNTIME_PROTOCOL
    || value.protocol_version !== RUNTIME_VERSION
    || value.contract_version !== "1.0"
    || value.schema_hash !== config.schemaHash
    || value.supervisor_session_id !== config.supervisorSessionId
    || value.core_commit !== config.coreCommit
    || value.component_manifest_hash !== config.componentManifestHash
    || value.external_send !== false
    || typeof value.instance_nonce !== "string"
    || value.instance_nonce.length < 8
    || !/^sha256:[a-f0-9]{64}$/u.test(value.data_root_fingerprint)
    || !Number.isSafeInteger(value.fencing_generation)
    || value.fencing_generation < 1) throw fail("runtime_identity");
  return value;
}

function validateHealthAgainstReadiness(_config, readiness, health) {
  if (health.lifecycle !== "ready"
    || health.supervisor_session_id !== readiness.supervisor_session_id
    || health.instance_nonce !== readiness.instance_nonce
    || health.core_commit !== readiness.core_commit
    || health.component_manifest_hash !== readiness.component_manifest_hash
    || health.data_root_fingerprint !== readiness.data_root_fingerprint
    || health.fencing_generation !== readiness.fencing_generation) throw fail("runtime_identity");
  return health;
}

function parseBridgeCapabilityRequest(config, value) {
  if (!hasExactKeys(value, ["operation", "payload", "protocol", "protocol_version", "request_id", "schema_hash"])
    || value.protocol !== RUNTIME_PROTOCOL
    || value.protocol_version !== RUNTIME_VERSION
    || value.schema_hash !== config.schemaHash
    || typeof value.request_id !== "string"
    || value.request_id.length < 1
    || value.request_id.length > 128) throw fail("invalid_request");
  const allowed = value.operation === "bridge_read" ? BRIDGE_READS : value.operation === "bridge_call" ? BRIDGE_CALLS : null;
  if (!allowed) throw fail("unsupported_operation");
  if (!hasExactKeys(value.payload, ["bridge_frame"])
    || typeof value.payload.bridge_frame !== "string"
    || Buffer.byteLength(value.payload.bridge_frame, "utf8") > MAX_BRIDGE_REQUEST_BYTES) throw fail("invalid_request");
  let bridge;
  try {
    bridge = JSON.parse(value.payload.bridge_frame);
  } catch {
    throw fail("invalid_bridge_frame");
  }
  if (!isPlainObject(bridge)
    || bridge.protocol !== BRIDGE_PROTOCOL
    || bridge.protocol_version !== BRIDGE_VERSION
    || bridge.producer !== BRIDGE_PRODUCER
    || typeof bridge.request_id !== "string"
    || bridge.request_id.length < 1
    || bridge.request_id !== value.request_id
    || !allowed.has(bridge.operation)) throw fail("invalid_bridge_frame");
  return { runtime: value, bridge };
}

function runtimeBridgeSuccess(config, request, bridgeResponse) {
  const bridgeFrame = `${JSON.stringify(bridgeResponse)}\n`;
  if (Buffer.byteLength(bridgeFrame, "utf8") > MAX_BRIDGE_RESPONSE_BYTES) throw fail("runtime_output_limit");
  return {
    protocol: RUNTIME_PROTOCOL,
    protocol_version: RUNTIME_VERSION,
    schema_hash: config.schemaHash,
    request_id: request.request_id,
    operation: request.operation,
    ok: true,
    result: { bridge_contract_version: BRIDGE_CONTRACT_VERSION, bridge_frame: bridgeFrame },
    error_code: null,
    external_send: false,
  };
}

function restrictBrokerHealthResponse(parsed, bridgeResponse) {
  if (parsed.bridge.operation !== "health") return bridgeResponse;
  const keys = ["contract_version", "fixture_manifest_hash", "ok", "operation", "request_id", "schema_hash", "status", "supported_commands", "supported_operations", "supported_projections"];
  if (!hasExactKeys(bridgeResponse, keys)
    || bridgeResponse.ok !== true
    || bridgeResponse.operation !== "health"
    || bridgeResponse.request_id !== parsed.runtime.request_id
    || !Array.isArray(bridgeResponse.supported_operations)) throw fail("runtime_identity");
  return { ...bridgeResponse, supported_operations: [...BROKER_SUPPORTED_OPERATIONS] };
}

function restrictBrokerRuntimeHealth(config, parsed, runtimeResponse) {
  if (parsed.bridge.operation !== "health" || runtimeResponse.ok !== true) return runtimeResponse;
  const result = runtimeResponse.result;
  if (!hasExactKeys(result, ["bridge_contract_version", "bridge_frame"])
    || result.bridge_contract_version !== BRIDGE_CONTRACT_VERSION
    || typeof result.bridge_frame !== "string"
    || Buffer.byteLength(result.bridge_frame, "utf8") > MAX_BRIDGE_RESPONSE_BYTES
    || !result.bridge_frame.endsWith("\n")
    || result.bridge_frame.indexOf("\n") !== result.bridge_frame.length - 1) throw fail("runtime_identity");
  let bridgeResponse;
  try {
    bridgeResponse = JSON.parse(result.bridge_frame.slice(0, -1));
  } catch {
    throw fail("runtime_identity");
  }
  return runtimeBridgeSuccess(config, parsed.runtime, restrictBrokerHealthResponse(parsed, bridgeResponse));
}

function waitForChildExit(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return Promise.race([
    new Promise((resolve) => child.once("close", () => resolve(true))),
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), Math.max(1, timeoutMs));
      timer.unref?.();
    }),
  ]);
}

function killChild(child) {
  if (child && child.exitCode === null && child.signalCode === null && !child.killed) child.kill("SIGKILL");
}

function runOneShot(config, bridgeRequest, timeoutMs, activeChildren) {
  const input = JSON.stringify(bridgeRequest);
  if (Buffer.byteLength(input, "utf8") > MAX_BRIDGE_REQUEST_BYTES) return Promise.reject(fail("invalid_request"));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [config.oneShotEntrypoint], {
      cwd: config.root,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: oneShotEnvironment(config),
    });
    activeChildren.add(child);
    const stdout = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let terminalError = null;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      terminalError = terminalError || fail("runtime_timeout");
      killChild(child);
    }, timeoutMs);
    timer.unref?.();
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > MAX_BRIDGE_RESPONSE_BYTES) {
        terminalError = terminalError || fail("runtime_output_limit");
        killChild(child);
      } else stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > MAX_STDERR_BYTES) {
        terminalError = terminalError || fail("runtime_output_limit");
        killChild(child);
      }
    });
    child.stdin.on("error", () => {
      terminalError = terminalError || fail("runtime_unavailable");
      killChild(child);
    });
    child.once("error", () => {
      terminalError = terminalError || fail("runtime_unavailable");
    });
    child.once("close", (code) => {
      activeChildren.delete(child);
      if (settled) return;
      if (terminalError) return finish(terminalError);
      if (code !== 0) return finish(fail("runtime_unavailable"));
      let text;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(stdout));
      } catch {
        return finish(fail("runtime_invalid_response"));
      }
      if (!text.endsWith("\n") || text.indexOf("\n") !== text.length - 1) return finish(fail("runtime_invalid_response"));
      try {
        finish(null, JSON.parse(text.slice(0, -1)));
      } catch {
        finish(fail("runtime_invalid_response"));
      }
    });
    child.stdin.end(input);
  });
}

function readIncomingBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value);
    };
    request.on("data", (chunk) => {
      total += chunk.byteLength;
      if (total > maxBytes) finish(fail("request_oversized"));
      else chunks.push(chunk);
    });
    request.on("end", () => {
      if (settled) return;
      let text;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
      } catch {
        return finish(fail("invalid_request"));
      }
      finish(null, text);
    });
    request.on("aborted", () => finish(fail("request_aborted")));
    request.on("error", () => finish(fail("invalid_request")));
  });
}

function writeJson(response, status, value) {
  if (response.writableEnded || response.destroyed) return;
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    connection: "close",
  });
  response.end(body);
}

function proxyStatus(code) {
  if (code === "invalid_auth") return 401;
  if (code === "invalid_method") return 405;
  if (code === "request_oversized") return 413;
  if (code === "concurrency_limit") return 429;
  if (["service_unavailable", "stopping", "runtime_timeout", "runtime_unavailable"].includes(code)) return 503;
  return 400;
}

class CoreSupervisor {
  constructor(config) {
    this.config = config;
    this.state = config.mode === "daemon" ? "starting" : "running";
    this.child = null;
    this.proxyServer = null;
    this.proxySockets = new Set();
    this.proxyRequests = 0;
    this.proxyAccepting = true;
    this.stopping = false;
    this.stopPromise = null;
    this.recoveryPromise = null;
    this.recoveryRequested = false;
    this.hasBeenReady = false;
    this.failureEmitted = false;
    this.activeOneShots = new Set();
    this.oneShotTail = Promise.resolve();
  }

  proxyEndpoint() {
    return `http://127.0.0.1:${this.config.clientPort}${RUNTIME_PATH}`;
  }

  async startProxy() {
    const server = http.createServer({ maxHeaderSize: 16 * 1024 }, (request, response) => {
      void this.handleProxyRequest(request, response);
    });
    server.maxHeadersCount = 64;
    server.maxConnections = MAX_PROXY_SOCKETS;
    server.headersTimeout = 5_000;
    server.requestTimeout = READ_TIMEOUT_MS;
    server.timeout = MAX_PROXY_RESPONSE_TIMEOUT_MS;
    server.keepAliveTimeout = 1_000;
    server.on("connection", (socket) => {
      this.proxySockets.add(socket);
      socket.on("close", () => this.proxySockets.delete(socket));
      if (this.proxySockets.size > MAX_PROXY_SOCKETS) socket.destroy();
    });
    server.on("clientError", (_error, socket) => {
      if (socket.writable && !socket.destroyed) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    });
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.removeListener("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.removeListener("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen({ host: "127.0.0.1", port: this.config.clientPort });
    });
    this.proxyServer = server;
    server.on("error", () => {
      if (!this.stopping) void this.stop();
    });
  }

  async start() {
    await this.startProxy();
    emit({
      status: "supervisor_ready",
      mode: this.config.mode,
      endpoint: this.proxyEndpoint(),
      protocol: RUNTIME_PROTOCOL,
      protocol_version: RUNTIME_VERSION,
      schema_hash: this.config.schemaHash,
      supervisor_session_id: this.config.supervisorSessionId,
      core_commit: this.config.coreCommit,
      component_manifest_hash: this.config.componentManifestHash,
      external_send: false,
    });
    if (this.config.mode === "daemon") this.scheduleRecovery();
  }

  async handleProxyRequest(request, response) {
    let code = "internal_error";
    if (this.proxyRequests >= MAX_PROXY_REQUESTS) {
      writeJson(response, 429, { error_code: "concurrency_limit" });
      return;
    }
    this.proxyRequests += 1;
    try {
      if (!this.proxyAccepting || this.stopping) throw fail("stopping");
      if (request.method !== "POST") throw fail("invalid_method");
      if (request.url !== RUNTIME_PATH) throw fail("invalid_path");
      if (!LOOPBACK_ADDRESSES.has(request.socket.remoteAddress || "")) throw fail("invalid_host");
      if (request.headers.host !== `127.0.0.1:${this.config.clientPort}`) throw fail("invalid_host");
      if (!sameToken(this.config.clientToken, request.headers.authorization)) throw fail("invalid_auth");
      if (request.headers.origin !== undefined) throw fail("invalid_origin");
      if ((request.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase() !== "application/json") throw fail("invalid_content_type");
      const contentLength = request.headers["content-length"];
      if (contentLength !== undefined && (typeof contentLength !== "string" || !/^\d+$/u.test(contentLength) || Number(contentLength) > MAX_RUNTIME_REQUEST_BYTES)) throw fail("request_oversized");
      const text = await readIncomingBody(request, MAX_RUNTIME_REQUEST_BYTES);
      if (contentLength !== undefined && Buffer.byteLength(text, "utf8") !== Number(contentLength)) throw fail("invalid_request");
      let value;
      try {
        value = JSON.parse(text);
      } catch {
        throw fail("invalid_request");
      }
      const parsed = parseBridgeCapabilityRequest(this.config, value);
      let runtimeResponse;
      if (this.config.mode === "daemon") {
        if (this.state !== "running" || !this.child) throw fail("service_unavailable");
        runtimeResponse = restrictBrokerRuntimeHealth(this.config, parsed, await fetchCoreRuntime(
          this.config,
          parsed.runtime,
          (parsed.runtime.operation === "bridge_call" ? MUTATION_TIMEOUT_MS : READ_TIMEOUT_MS) + TRANSPORT_GRACE_MS,
        ));
      } else {
        const run = async () => {
          if (this.stopping) throw fail("stopping");
          const bridgeResponse = await runOneShot(
            this.config,
            parsed.bridge,
            parsed.runtime.operation === "bridge_call" ? MUTATION_TIMEOUT_MS : READ_TIMEOUT_MS,
            this.activeOneShots,
          );
          return runtimeBridgeSuccess(
            this.config,
            parsed.runtime,
            restrictBrokerHealthResponse(parsed, bridgeResponse),
          );
        };
        const queued = this.oneShotTail.then(run, run);
        this.oneShotTail = queued.then(() => undefined, () => undefined);
        runtimeResponse = await queued;
      }
      writeJson(response, 200, runtimeResponse);
      return;
    } catch (error) {
      code = typeof error?.code === "string" ? error.code : "internal_error";
    } finally {
      this.proxyRequests -= 1;
    }
    writeJson(response, proxyStatus(code), { error_code: code });
  }

  async startChild() {
    if (this.stopping) throw fail("stopping");
    const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", this.config.entrypoint], {
      cwd: this.config.root,
      env: coreChildEnvironment(this.config),
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;
    this.state = "starting";
    let readinessSettled = false;
    let buffered = "";
    let stderrBytes = 0;
    let readinessResolve;
    let readinessReject;
    const readiness = new Promise((resolve, reject) => {
      readinessResolve = resolve;
      readinessReject = reject;
    });
    const timeout = setTimeout(() => {
      if (!readinessSettled) {
        readinessSettled = true;
        readinessReject(fail("startup_timeout"));
      }
    }, START_TIMEOUT_MS);
    timeout.unref?.();
    const closePromise = new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (readinessSettled) return;
      buffered += chunk;
      if (Buffer.byteLength(buffered, "utf8") > MAX_READY_BYTES) {
        readinessSettled = true;
        clearTimeout(timeout);
        readinessReject(fail("runtime_output_limit"));
        killChild(child);
        return;
      }
      const newline = buffered.indexOf("\n");
      if (newline < 0) return;
      if (newline !== buffered.length - 1) {
        readinessSettled = true;
        clearTimeout(timeout);
        readinessReject(fail("runtime_identity"));
        killChild(child);
        return;
      }
      try {
        const value = validateCoreReadiness(this.config, JSON.parse(buffered.slice(0, -1)));
        readinessSettled = true;
        clearTimeout(timeout);
        readinessResolve(value);
      } catch (error) {
        readinessSettled = true;
        clearTimeout(timeout);
        readinessReject(error);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > MAX_STDERR_BYTES) {
        if (!readinessSettled) {
          readinessSettled = true;
          clearTimeout(timeout);
          readinessReject(fail("runtime_output_limit"));
        }
        killChild(child);
      }
    });
    void closePromise.then(({ code, signal }) => {
      if (!readinessSettled) {
        readinessSettled = true;
        clearTimeout(timeout);
        readinessReject(fail("startup_exit"));
        return;
      }
      if (!this.stopping && this.child === child && this.state === "running") {
        this.child = null;
        this.state = "starting";
        this.scheduleRecovery(code, signal);
      }
    });
    try {
      const ready = await readiness;
      const health = await requestCore(this.config, "health", READ_TIMEOUT_MS);
      validateHealthAgainstReadiness(this.config, ready, health);
      if (this.stopping || this.child !== child || child.exitCode !== null || child.signalCode !== null) throw fail("startup_exit");
      this.state = "running";
      emit({
        status: this.hasBeenReady ? "restarted" : "ready",
        child_pid: child.pid,
        endpoint: this.proxyEndpoint(),
        protocol: RUNTIME_PROTOCOL,
        protocol_version: RUNTIME_VERSION,
        schema_hash: ready.schema_hash,
        supervisor_session_id: ready.supervisor_session_id,
        core_commit: ready.core_commit,
        component_manifest_hash: ready.component_manifest_hash,
        data_root_fingerprint: ready.data_root_fingerprint,
        instance_nonce: ready.instance_nonce,
        fencing_generation: ready.fencing_generation,
        external_send: false,
      });
      this.hasBeenReady = true;
      return ready;
    } catch (error) {
      if (this.child === child) this.child = null;
      killChild(child);
      await closePromise;
      throw error;
    }
  }

  scheduleRecovery() {
    if (this.stopping) return this.recoveryPromise;
    if (this.recoveryPromise) {
      this.recoveryRequested = true;
      return this.recoveryPromise;
    }
    this.recoveryRequested = false;
    const recovery = (async () => {
      let failures = 0;
      while (!this.stopping) {
        try {
          await this.startChild();
          return;
        } catch {
          failures += 1;
          if (this.stopping) return;
          if (failures > MAX_RESTARTS) {
            this.state = "failed";
            if (!this.failureEmitted) {
              this.failureEmitted = true;
              emit({ status: "failed", code: "restart_limit", external_send: false });
            }
            return;
          }
          await new Promise((resolve) => {
            const timer = setTimeout(resolve, Math.min(1_000, 100 * 2 ** (failures - 1)));
            timer.unref?.();
          });
        }
      }
    })();
    const tracked = recovery.finally(() => {
      if (this.recoveryPromise !== tracked) return;
      this.recoveryPromise = null;
      if (this.recoveryRequested && !this.stopping && !this.child) {
        this.recoveryRequested = false;
        this.scheduleRecovery();
      }
    });
    this.recoveryPromise = tracked;
    return this.recoveryPromise;
  }

  closeProxy() {
    this.proxyAccepting = false;
    if (!this.proxyServer?.listening) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      this.proxyServer.close(finish);
      this.proxyServer.closeIdleConnections?.();
      const timer = setTimeout(() => {
        for (const socket of this.proxySockets) socket.destroy();
        finish();
      }, STOP_TOTAL_MS);
      timer.unref?.();
    });
  }

  async stop() {
    if (this.stopPromise) return this.stopPromise;
    const wasRunning = this.state === "running" && this.config.mode === "daemon";
    this.stopping = true;
    this.state = "stopping";
    this.proxyAccepting = false;
    const deadline = Date.now() + STOP_TOTAL_MS;
    this.stopPromise = (async () => {
      const proxyClose = this.closeProxy();
      const child = this.child;
      if (child) {
        if (wasRunning) {
          const drainBudget = Math.min(MUTATION_TIMEOUT_MS + 1_000, Math.max(1, deadline - Date.now()));
          try {
            await requestCore(this.config, "begin_drain", drainBudget);
          } catch {}
          if (child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
            try {
              await requestCore(this.config, "shutdown", Math.max(1, deadline - Date.now()));
            } catch {}
          }
        } else {
          killChild(child);
        }
        if (!await waitForChildExit(child, Math.max(1, deadline - Date.now()))) {
          killChild(child);
          await waitForChildExit(child, 1_000);
        }
        if (this.child === child) this.child = null;
      }
      await Promise.race([
        this.oneShotTail,
        new Promise((resolve) => setTimeout(resolve, Math.max(1, deadline - Date.now()))),
      ]);
      for (const active of this.activeOneShots) killChild(active);
      await Promise.all([...this.activeOneShots].map((active) => waitForChildExit(active, 1_000)));
      await Promise.race([
        proxyClose,
        new Promise((resolve) => setTimeout(resolve, Math.max(1, deadline - Date.now()))),
      ]);
      for (const socket of this.proxySockets) socket.destroy();
      this.state = "stopped";
    })();
    return this.stopPromise;
  }
}

async function main() {
  let supervisor;
  try {
    supervisor = new CoreSupervisor(expectedConfiguration());
    const parentPid = supervisor.config.parentPid;
    const stopForParent = () => void supervisor.stop().then(() => process.exit(0), () => process.exit(1));
    const parentWatchdog = setInterval(() => {
      if (process.ppid !== parentPid) stopForParent();
      else {
        try {
          process.kill(parentPid, 0);
        } catch {
          stopForParent();
        }
      }
    }, 250);
    parentWatchdog.unref?.();
    process.on("SIGINT", stopForParent);
    process.on("SIGTERM", stopForParent);
    const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    input.on("line", (line) => {
      if (line.trim() === "stop") stopForParent();
    });
    input.on("close", stopForParent);
    await supervisor.start();
  } catch {
    emit({ status: "failed", code: "supervisor_unavailable", external_send: false });
    if (supervisor) await supervisor.stop().catch(() => {});
    process.exit(1);
  }
}

if (require.main === module) void main();

module.exports = {
  CoreSupervisor,
  expectedConfiguration,
  fetchCoreRuntime,
  parseBridgeCapabilityRequest,
  readFetchBody,
  requestCore,
  validateCoreReadiness,
};
