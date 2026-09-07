"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("node:path");

function firstConfigured(environment, names) {
  return names.map((name) => environment[name]).find((value) => typeof value === "string" && value) ?? "";
}

function resolveConfiguredRoot(value) {
  return value ? path.resolve(value) : "";
}

const CORE_RENDEZVOUS_KEYS = [
  "EDUPI_CORE_RELEASE_MODE",
  "EDUPI_CORE_ENDPOINT",
  "EDUPI_CORE_CLIENT_TOKEN",
  "EDUPI_CORE_TOKEN",
  "EDUPI_CORE_SUPERVISOR_SESSION",
  "EDUPI_CORE_SCHEMA_HASH",
  "EDUPI_CORE_COMMIT",
  "EDUPI_CORE_COMPONENT_MANIFEST_HASH",
  "EDUPI_CORE_DATA_ROOT_FINGERPRINT",
  "EDUPI_CORE_INSTANCE_NONCE",
  "EDUPI_CORE_FENCING_GENERATION",
  "EDUPI_CORE_ATTESTATION",
];

function captureCoreRendezvousUnsafe(environment = process.env) {
  const mode = (environment.EDUPI_CORE_RELEASE_MODE || "").trim();
  if (!mode && !environment.EDUPI_CORE_ATTESTATION) return null;
  if (mode !== "daemon" && mode !== "one-shot") throw new Error("Core supervisor unavailable");
  if (environment.EDUPI_CORE_TOKEN) throw new Error("Core supervisor unavailable");
  const hash = (value) => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value) ? value : (() => { throw new Error("Core supervisor unavailable"); })();
  const opaque = (value) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{7,511}$/.test(value) ? value : (() => { throw new Error("Core supervisor unavailable"); })();
  const commit = (value) => typeof value === "string" && /^[a-f0-9]{40}$/i.test(value) ? value : (() => { throw new Error("Core supervisor unavailable"); })();
  const rendezvous = {
    mode,
    endpoint: (() => {
      let endpoint;
      try { endpoint = new URL(environment.EDUPI_CORE_ENDPOINT); } catch { throw new Error("Core supervisor unavailable"); }
      if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" || endpoint.pathname !== "/runtime/v1" || endpoint.search || endpoint.hash) throw new Error("Core supervisor unavailable");
      return environment.EDUPI_CORE_ENDPOINT;
    })(),
    capability_token: opaque(environment.EDUPI_CORE_CLIENT_TOKEN),
    supervisor_session_id: opaque(environment.EDUPI_CORE_SUPERVISOR_SESSION),
    schema_hash: hash(environment.EDUPI_CORE_SCHEMA_HASH),
    core_commit: commit(environment.EDUPI_CORE_COMMIT),
    component_manifest_hash: hash(environment.EDUPI_CORE_COMPONENT_MANIFEST_HASH),
    attestation: opaque(environment.EDUPI_CORE_ATTESTATION),
  };
  const retained = { ...rendezvous };
  delete retained.attestation;
  Object.defineProperty(globalThis, Symbol.for("edupi.core.bridge-capability.v1"), { configurable: false, enumerable: false, value: Object.freeze(retained), writable: false });
  for (const key of CORE_RENDEZVOUS_KEYS) delete environment[key];
  return rendezvous;
}

function captureCoreRendezvous(environment = process.env) {
  try {
    return captureCoreRendezvousUnsafe(environment);
  } finally {
    for (const key of CORE_RENDEZVOUS_KEYS) delete environment[key];
  }
}

function resolveEduPiLaunchRoots(environment = process.env) {
  const dataRoot = resolveConfiguredRoot(
    firstConfigured(environment, ["EDUPI_DATA_ROOT", "EDUPI_PROJECT_ROOT", "EDUPI_WORKSPACE"]),
  );
  const coreRoot = resolveConfiguredRoot(
    firstConfigured(environment, ["EDUPI_CORE_ROOT", "EDUPI_PROJECT_ROOT", "EDUPI_WORKSPACE"]) || dataRoot,
  );
  return {
    PI_DESKTOP_STATE_DIR: resolveConfiguredRoot(environment.PI_DESKTOP_STATE_DIR || ""),
    EDUPI_PROJECT_ROOT: dataRoot,
    EDUPI_DATA_ROOT: dataRoot,
    EDUPI_CORE_ROOT: coreRoot,
    EDUPI_CORE_ALLOWED_ROOT: resolveConfiguredRoot(
      environment.EDUPI_CORE_ALLOWED_ROOT || (coreRoot ? path.dirname(coreRoot) : ""),
    ),
    EDUPI_DATA_ALLOWED_ROOT: resolveConfiguredRoot(
      environment.EDUPI_DATA_ALLOWED_ROOT || (dataRoot ? path.dirname(dataRoot) : ""),
    ),
  };
}

if (require.main === module) {
  Object.assign(process.env, resolveEduPiLaunchRoots());
  captureCoreRendezvous();

  const expectedParentPid = Number.parseInt(process.env.PI_WEB_PARENT_PID ?? "", 10);

  // EduPi is installed next to this desktop bundle in development and can be
  // selected explicitly by the packaged app. Never infer a secret or channel
  // credential here; only pass the project/data roots used by the read-only
  // teacher workspace and the Pi runtime.

  // A normal App quit is handled by the Rust shell. This small watchdog also
  // prevents the local server from becoming orphaned if the GUI process crashes
  // or is force-terminated by macOS.
  const parentWatchdog = setInterval(() => {
    if (!Number.isInteger(expectedParentPid) || process.ppid === 1) {
      process.exit(0);
    }

    try {
      process.kill(expectedParentPid, 0);
    } catch {
      process.exit(0);
    }
  }, 1_000);
  parentWatchdog.unref();

  // The standalone Next.js entrypoint is CommonJS.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("./server.js");
}

module.exports = { resolveEduPiLaunchRoots, captureCoreRendezvous };
