import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const FILE_NAME = "edupi-proactivity.json";
const STOP_FILE_NAME = "edupi-proactivity-stop.json";
const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;
const HASH = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,159}$/u;

export type EduPiProactivityScope = { classId: string; subject: string };
export type EduPiReflectionHistoryBinding = { ownerId: string; grantId: string; scope: EduPiProactivityScope };
export const EDUPI_CAPABILITY_DOMAINS = ["calendar_administration", "lesson_reflection", "parent_communication"] as const;
export type EduPiCapabilityDomain = typeof EDUPI_CAPABILITY_DOMAINS[number];
export type EduPiProactivityDomain = "teaching_preparation" | "student_followup" | EduPiCapabilityDomain;
export function isEduPiCapabilityDomain(domain: string): domain is EduPiCapabilityDomain {
  return (EDUPI_CAPABILITY_DOMAINS as readonly string[]).includes(domain);
}
export type EduPiProactivityActivation = {
  enabled: boolean;
  source: "default" | "desktop_canary" | "environment";
  configurationStatus: "missing" | "ready" | "legacy" | "stop_pending" | "mismatched" | "invalid";
  scope: EduPiProactivityScope | null;
  grantId: string | null;
  ownerId?: string;
  historyBinding?: EduPiReflectionHistoryBinding | null;
  updatedAt: string | null;
};

type StoredConfig = {
  version: 1 | 2 | 3 | 4;
  data_root_hash: string;
  enabled: boolean;
  scope: { class_id: string; subject: string } | null;
  grant_id: string | null;
  updated_at: string;
  owner_id?: string;
  history_binding?: { owner_id: string; grant_id: string; scope: { class_id: string; subject: string } } | null;
};
type StoredStopIntent = {
  version: 1;
  data_root_hash: string;
  scope: { class_id: string; subject: string };
  grant_id: string;
  updated_at: string;
};

export class EduPiProactivityConfigError extends Error {
  readonly code = "proactivity_configuration_unavailable";
  constructor() { super("EduPi proactivity configuration unavailable."); this.name = "EduPiProactivityConfigError"; }
}

function fail(): never { throw new EduPiProactivityConfigError(); }

function fileName(domain: EduPiProactivityDomain, stop = false): string {
  if (domain === "teaching_preparation") return stop ? STOP_FILE_NAME : FILE_NAME;
  if (domain === "student_followup") return stop ? "edupi-student-followup-stop.json" : "edupi-student-followup.json";
  if (isEduPiCapabilityDomain(domain)) return `edupi-${domain.replaceAll("_", "-")}${stop ? "-stop" : ""}.json`;
  return fail();
}

function validSubject(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f]/u.test(value);
}

function validScope(value: unknown): value is StoredConfig["scope"] {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === 2
    && ID.test(String((value as Record<string, unknown>).class_id || ""))
    && validSubject((value as Record<string, unknown>).subject));
}

function exactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key)));
}

function validHistoryBinding(value: unknown): boolean {
  if (value === null) return true;
  if (!exactKeys(value, ["owner_id", "grant_id", "scope"])) return false;
  return typeof value.owner_id === "string" && OWNER_ID.test(value.owner_id)
    && typeof value.grant_id === "string" && ID.test(value.grant_id) && validScope(value.scope);
}

function validPublicHistoryBinding(value: unknown): value is EduPiReflectionHistoryBinding {
  if (!exactKeys(value, ["ownerId", "grantId", "scope"])) return false;
  const scope = value.scope;
  return typeof value.ownerId === "string" && OWNER_ID.test(value.ownerId)
    && typeof value.grantId === "string" && ID.test(value.grantId)
    && exactKeys(scope, ["classId", "subject"])
    && typeof scope.classId === "string" && ID.test(scope.classId) && validSubject(scope.subject);
}

const OWNER_ID = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/u;

function validStored(value: unknown, domain: EduPiProactivityDomain): value is StoredConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const hasHistory = Object.hasOwn(value, "history_binding");
  if (!exactKeys(value, ["version", "data_root_hash", "enabled", "scope", "grant_id", "updated_at",
    ...(Object.hasOwn(value, "owner_id") ? ["owner_id"] : []), ...(hasHistory ? ["history_binding"] : [])])) return false;
  const scope = value.scope;
  const grantId = value.grant_id;
  const historyBinding = value.history_binding as StoredConfig["history_binding"];
  try { return (value.version === 1 || value.version === 2 || value.version === 3 || value.version === 4 && domain === "lesson_reflection")
    && (value.version === 4) === hasHistory && (!hasHistory || validHistoryBinding(historyBinding))
    && HASH.test(String(value.data_root_hash || "")) && typeof value.enabled === "boolean"
    && (value.owner_id === undefined || (value.version === 3 || value.version === 4) && typeof value.owner_id === "string" && OWNER_ID.test(value.owner_id))
    && (scope === null && grantId === null || validScope(scope) && typeof grantId === "string" && ID.test(grantId))
    && (!value.enabled || scope !== null)
    && (value.version !== 4 || !value.enabled || value.owner_id === historyBinding?.owner_id
      && value.grant_id === historyBinding?.grant_id && scope?.class_id === historyBinding?.scope.class_id
      && scope?.subject === historyBinding?.scope.subject)
    && typeof value.updated_at === "string" && new Date(value.updated_at).toISOString() === value.updated_at;
  } catch { return false; }
}

function validStopIntent(value: unknown): value is StoredStopIntent {
  if (!exactKeys(value, ["version", "data_root_hash", "scope", "grant_id", "updated_at"])) return false;
  try {
    return value.version === 1 && HASH.test(String(value.data_root_hash || "")) && value.scope !== null && validScope(value.scope)
      && typeof value.grant_id === "string" && ID.test(value.grant_id)
      && typeof value.updated_at === "string" && new Date(value.updated_at).toISOString() === value.updated_at;
  } catch { return false; }
}

function secureRoot(stateDir: string | undefined): string {
  if (!stateDir || !path.isAbsolute(stateDir)) fail();
  const before = fs.lstatSync(stateDir);
  if (!before.isDirectory() || before.isSymbolicLink()) fail();
  const root = fs.realpathSync(stateDir);
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || process.platform !== "win32" && ((stat.mode & 0o022) !== 0
    || typeof process.getuid === "function" && stat.uid !== process.getuid())) fail();
  return root;
}

function syncStateDirectory(root: string): void {
  const directory = fs.openSync(root, fs.constants.O_RDONLY | NOFOLLOW | (fs.constants.O_DIRECTORY ?? 0));
  try {
    if (!fs.fstatSync(directory).isDirectory()) fail();
    fs.fsyncSync(directory);
  } finally { fs.closeSync(directory); }
}

function dataRootHash(dataRoot: string): string {
  if (!path.isAbsolute(dataRoot)) fail();
  const root = fs.realpathSync(dataRoot);
  if (!fs.lstatSync(root).isDirectory()) fail();
  return `sha256:${crypto.createHash("sha256").update(root, "utf8").digest("hex")}`;
}

function readStored(stateDir: string | undefined, domain: EduPiProactivityDomain): { status: "missing" | "ready" | "invalid"; value: StoredConfig | null } {
  if (!stateDir) return { status: "missing", value: null };
  let root: string;
  try { root = secureRoot(stateDir); } catch { return { status: "invalid", value: null }; }
  const file = path.join(root, fileName(domain));
  let descriptor: number | undefined;
  try {
    try { descriptor = fs.openSync(file, fs.constants.O_RDONLY | NOFOLLOW); }
    catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT" ? { status: "missing", value: null } : { status: "invalid", value: null }; }
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.nlink !== 1 || before.size < 2 || before.size > 4096
      || process.platform !== "win32" && ((before.mode & 0o077) !== 0
        || typeof process.getuid === "function" && before.uid !== process.getuid())) return { status: "invalid", value: null };
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || fs.realpathSync(file) !== file) {
      return { status: "invalid", value: null };
    }
    let parsed: unknown;
    try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { return { status: "invalid", value: null }; }
    return validStored(parsed, domain) ? { status: "ready", value: parsed } : { status: "invalid", value: null };
  } catch { return { status: "invalid", value: null }; }
  finally { if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch { /* read-only cleanup */ } }
}

function readStopIntent(stateDir: string | undefined, dataRoot: string, domain: EduPiProactivityDomain): StoredStopIntent | null {
  if (!stateDir) return null;
  const root = secureRoot(stateDir);
  const file = path.join(root, fileName(domain, true));
  let descriptor: number | undefined;
  try {
    try { descriptor = fs.openSync(file, fs.constants.O_RDONLY | NOFOLLOW); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.nlink !== 1 || before.size < 2 || before.size > 4096
      || process.platform !== "win32" && ((before.mode & 0o077) !== 0
        || typeof process.getuid === "function" && before.uid !== process.getuid())) fail();
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || fs.realpathSync(file) !== file) fail();
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!validStopIntent(parsed) || parsed.data_root_hash !== dataRootHash(dataRoot)) fail();
    return parsed;
  } catch { return fail(); }
  finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}

export function writeEduPiProactivityStopIntent(input: { scope: EduPiProactivityScope; grantId: string },
  { stateDir = process.env.PI_DESKTOP_STATE_DIR, dataRoot, now = new Date().toISOString(), domain = "teaching_preparation" }:
    { stateDir?: string; dataRoot: string; now?: string; domain?: EduPiProactivityDomain }): void {
  const root = secureRoot(stateDir);
  const existing = readStopIntent(root, dataRoot, domain);
  if (existing && (existing.grant_id !== input.grantId || existing.scope.class_id !== input.scope.classId
    || existing.scope.subject !== input.scope.subject)) fail();
  const value: StoredStopIntent = { version: 1, data_root_hash: dataRootHash(dataRoot),
    scope: { class_id: input.scope.classId, subject: input.scope.subject }, grant_id: input.grantId, updated_at: now };
  if (!validStopIntent(value)) fail();
  const file = path.join(root, fileName(domain, true));
  const temporary = path.join(root, `.${fileName(domain, true)}.${crypto.randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, 0o600);
    const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
    if (fs.writeSync(descriptor, bytes) !== bytes.length) fail();
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor); descriptor = undefined;
    fs.renameSync(temporary, file);
    if (process.platform !== "win32") fs.chmodSync(file, 0o600);
    syncStateDirectory(root);
    if (JSON.stringify(readStopIntent(root, dataRoot, domain)) !== JSON.stringify(value)) fail();
  } catch { fail(); }
  finally {
    if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch { /* cleanup */ }
    try { fs.unlinkSync(temporary); } catch { /* owned temporary remains visible */ }
  }
}

export function clearEduPiProactivityStopIntent({ stateDir = process.env.PI_DESKTOP_STATE_DIR, dataRoot, grantId, domain = "teaching_preparation" }:
  { stateDir?: string; dataRoot: string; grantId: string; domain?: EduPiProactivityDomain }): void {
  const root = secureRoot(stateDir);
  const existing = readStopIntent(root, dataRoot, domain);
  if (!existing) return;
  if (existing.grant_id !== grantId) fail();
  try {
    fs.unlinkSync(path.join(root, fileName(domain, true)));
    syncStateDirectory(root);
    if (readStopIntent(root, dataRoot, domain) !== null) fail();
  } catch { fail(); }
}

function publicActivation(value: StoredConfig, source: EduPiProactivityActivation["source"]): EduPiProactivityActivation {
  return {
    enabled: value.enabled,
    source,
    configurationStatus: "ready",
    scope: value.scope ? { classId: value.scope.class_id, subject: value.scope.subject } : null,
    grantId: value.grant_id,
    ...(value.owner_id ? { ownerId: value.owner_id } : {}),
    ...(value.version === 4 ? { historyBinding: value.history_binding ? {
      ownerId: value.history_binding.owner_id, grantId: value.history_binding.grant_id,
      scope: { classId: value.history_binding.scope.class_id, subject: value.history_binding.scope.subject },
    } : null } : {}),
    updatedAt: value.updated_at,
  };
}

export function readEduPiProactivityActivation({
  stateDir = process.env.PI_DESKTOP_STATE_DIR,
  dataRoot,
  env = process.env,
  domain = "teaching_preparation",
}: { stateDir?: string; dataRoot: string; env?: Record<string, string | undefined>; domain?: EduPiProactivityDomain }): EduPiProactivityActivation {
  const stop = readStopIntent(stateDir, dataRoot, domain);
  if (stop) return { enabled: false, source: "desktop_canary", configurationStatus: "stop_pending",
    scope: { classId: stop.scope.class_id, subject: stop.scope.subject }, grantId: stop.grant_id,
    updatedAt: stop.updated_at };
  const stored = readStored(stateDir, domain);
  let rootHash: string | null = null;
  try { rootHash = dataRootHash(dataRoot); } catch { /* fail closed below */ }
  const matches = stored.status === "ready" && stored.value?.data_root_hash === rootHash;
  const base: EduPiProactivityActivation = matches && stored.value
    ? stored.value.version === 1
      ? { ...publicActivation(stored.value, "desktop_canary"), enabled: false, configurationStatus: "legacy" }
      : publicActivation(stored.value, "desktop_canary")
    : { enabled: false, source: "default", configurationStatus: stored.status === "ready" ? "mismatched" : stored.status,
      scope: null, grantId: null, updatedAt: null };
  return domain === "teaching_preparation" && env.EDUPI_AMBIENT_PLANNING === "1" ? { ...base, enabled: true, source: "environment" } : base;
}

export function writeEduPiProactivityConfig(
  input: { enabled: boolean; scope: EduPiProactivityScope | null; grantId: string | null; ownerId?: string;
    historyBinding?: EduPiReflectionHistoryBinding | null },
  { stateDir = process.env.PI_DESKTOP_STATE_DIR, dataRoot, now = new Date().toISOString(), domain = "teaching_preparation" }:
    { stateDir?: string; dataRoot: string; now?: string; domain?: EduPiProactivityDomain },
): EduPiProactivityActivation {
  let canonicalNow: string;
  try { canonicalNow = new Date(now).toISOString(); } catch { fail(); }
  if (typeof input.enabled !== "boolean" || canonicalNow !== now || input.enabled && input.scope === null
    || (input.scope === null) !== (input.grantId === null)
    || input.scope !== null && (!ID.test(input.scope.classId) || !validSubject(input.scope.subject))
    || input.grantId !== null && !ID.test(input.grantId)
    || domain !== "lesson_reflection" && input.historyBinding !== undefined
    || input.historyBinding !== undefined && input.historyBinding !== null && !validPublicHistoryBinding(input.historyBinding)) fail();
  const root = secureRoot(stateDir);
  let historyBinding: EduPiReflectionHistoryBinding | null = null;
  if (domain === "lesson_reflection") {
    if (input.historyBinding !== undefined) historyBinding = input.historyBinding;
    else if (input.enabled && input.ownerId && input.grantId && input.scope) {
      historyBinding = { ownerId: input.ownerId, grantId: input.grantId, scope: input.scope };
    } else if (!input.enabled) {
      const previous = readStored(root, domain);
      if (previous.status === "invalid") fail();
      if (previous.value?.data_root_hash === dataRootHash(dataRoot) && previous.value.version === 4) {
        historyBinding = publicActivation(previous.value, "desktop_canary").historyBinding ?? null;
      }
    }
  }
  const value: StoredConfig = {
    version: domain === "lesson_reflection" ? 4 : isEduPiCapabilityDomain(domain) ? 3 : 2,
    data_root_hash: dataRootHash(dataRoot),
    enabled: input.enabled,
    scope: input.scope ? { class_id: input.scope.classId, subject: input.scope.subject.trim() } : null,
    grant_id: input.grantId,
    updated_at: canonicalNow,
    ...(input.ownerId ? { owner_id: input.ownerId } : {}),
    ...(domain === "lesson_reflection" ? { history_binding: historyBinding ? {
      owner_id: historyBinding.ownerId, grant_id: historyBinding.grantId,
      scope: { class_id: historyBinding.scope.classId, subject: historyBinding.scope.subject.trim() },
    } : null } : {}),
  };
  if (!validStored(value, domain)) fail();
  const file = path.join(root, fileName(domain));
  const temporary = path.join(root, `.${fileName(domain)}.${crypto.randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, 0o600);
    const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    if (fs.writeSync(descriptor, bytes) !== bytes.length) fail();
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor); descriptor = undefined;
    try {
      const target = fs.lstatSync(file);
      if (!target.isFile() || target.isSymbolicLink() || target.nlink !== 1) fail();
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    fs.renameSync(temporary, file);
    if (process.platform !== "win32") fs.chmodSync(file, 0o600);
    syncStateDirectory(root);
    const committed = readStored(root, domain);
    if (committed.status !== "ready" || JSON.stringify(committed.value) !== JSON.stringify(value)) fail();
  } catch { fail(); }
  finally {
    if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch { /* cleanup */ }
    try { fs.unlinkSync(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") { /* owned temp remains visible */ } }
  }
  return publicActivation(value, "desktop_canary");
}
