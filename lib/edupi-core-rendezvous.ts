const CORE_RENDEZVOUS_KEYS = [
  "EDUPI_CORE_RELEASE_MODE",
  "EDUPI_CORE_ENDPOINT",
  "EDUPI_CORE_CLIENT_TOKEN",
  // Raw Core authority is never valid in the Next process. Scrub it if a
  // misconfigured launcher accidentally supplies it.
  "EDUPI_CORE_TOKEN",
  "EDUPI_CORE_SUPERVISOR_SESSION",
  "EDUPI_CORE_SCHEMA_HASH",
  "EDUPI_CORE_COMMIT",
  "EDUPI_CORE_COMPONENT_MANIFEST_HASH",
  "EDUPI_CORE_DATA_ROOT_FINGERPRINT",
  "EDUPI_CORE_INSTANCE_NONCE",
  "EDUPI_CORE_FENCING_GENERATION",
  "EDUPI_CORE_ATTESTATION",
] as const;

export type EduPiCoreReleaseMode = "daemon" | "one-shot";

/**
 * A narrow broker capability, not the Core daemon credential. The broker
 * accepts only bridge health/snapshot/command/students/delete operations.
 */
export type EduPiCoreRendezvous = Readonly<{
  mode: EduPiCoreReleaseMode;
  endpoint: string;
  capability_token: string;
  supervisor_session_id: string;
  schema_hash: string;
  core_commit: string;
  component_manifest_hash: string;
}>;

const RENDEZVOUS_KEY = Symbol.for("edupi.core.bridge-capability.v1");
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/iu;
const OPAQUE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{7,511}$/u;
const TEST_RESET_ENABLED = process.env.EDUPI_CORE_RENDEZVOUS_TEST_RESET === "1";
delete process.env.EDUPI_CORE_RENDEZVOUS_TEST_RESET;

function unavailable(message: string): Error {
  return Object.assign(new Error(message), { code: "supervisor_unavailable" });
}

function requireOpaque(value: unknown, label: string): string {
  if (typeof value !== "string" || !OPAQUE_PATTERN.test(value)) throw unavailable(`${label} is unavailable`);
  return value;
}

function requireHash(value: unknown, label: string): string {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) throw unavailable(`${label} is unavailable`);
  return value;
}

function requireCommit(value: unknown): string {
  if (typeof value !== "string" || !COMMIT_PATTERN.test(value)) throw unavailable("Core commit is unavailable");
  return value;
}

function requireEndpoint(value: unknown): string {
  if (typeof value !== "string") throw unavailable("Core supervisor endpoint is unavailable");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw unavailable("Core supervisor endpoint is unavailable");
  }
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" || parsed.pathname !== "/runtime/v1" || parsed.search || parsed.hash) {
    throw unavailable("Core supervisor endpoint is unavailable");
  }
  const port = Number(parsed.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw unavailable("Core supervisor endpoint is unavailable");
  return value;
}

function currentRendezvous(): EduPiCoreRendezvous | undefined {
  return (globalThis as typeof globalThis & { [RENDEZVOUS_KEY]?: EduPiCoreRendezvous })[RENDEZVOUS_KEY];
}

export function captureEduPiCoreRendezvous(environment: NodeJS.ProcessEnv = process.env): EduPiCoreRendezvous | null {
  try {
    const mode = (environment.EDUPI_CORE_RELEASE_MODE || "").trim();
    const attestation = environment.EDUPI_CORE_ATTESTATION;
    if (!mode && !attestation) return currentRendezvous() ?? null;
    if (mode !== "daemon" && mode !== "one-shot") throw unavailable("Core release mode is invalid");
    if (environment.EDUPI_CORE_TOKEN) throw unavailable("Raw Core authority is not valid in the Next process");
    requireOpaque(attestation, "Core attestation");
    const rendezvous = Object.freeze({
      mode,
      endpoint: requireEndpoint(environment.EDUPI_CORE_ENDPOINT),
      capability_token: requireOpaque(environment.EDUPI_CORE_CLIENT_TOKEN, "Core bridge capability"),
      supervisor_session_id: requireOpaque(environment.EDUPI_CORE_SUPERVISOR_SESSION, "Core supervisor session"),
      schema_hash: requireHash(environment.EDUPI_CORE_SCHEMA_HASH, "Core schema identity"),
      core_commit: requireCommit(environment.EDUPI_CORE_COMMIT),
      component_manifest_hash: requireHash(environment.EDUPI_CORE_COMPONENT_MANIFEST_HASH, "Core manifest identity"),
    });
    const existing = currentRendezvous();
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(rendezvous)) throw unavailable("Core rendezvous was already captured");
      return existing;
    }
    Object.defineProperty(globalThis, RENDEZVOUS_KEY, {
      configurable: TEST_RESET_ENABLED,
      enumerable: false,
      value: rendezvous,
      writable: false,
    });
    return rendezvous;
  } finally {
    for (const key of CORE_RENDEZVOUS_KEYS) delete environment[key];
  }
}

export function getEduPiCoreRendezvous(): EduPiCoreRendezvous | null {
  return currentRendezvous() ?? null;
}

export function clearEduPiCoreRendezvousForTests(): void {
  if (!TEST_RESET_ENABLED) throw new Error("Core rendezvous reset is test-only");
  delete (globalThis as typeof globalThis & { [RENDEZVOUS_KEY]?: EduPiCoreRendezvous })[RENDEZVOUS_KEY];
}
