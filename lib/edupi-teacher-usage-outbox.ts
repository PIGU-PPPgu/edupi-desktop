import fs from "node:fs";
import path from "node:path";
import { writePrivateFileAtomicSync } from "./atomic-file.ts";
import { teacherUsageCanonical, teacherUsageDigest } from "./edupi-teacher-usage-documents.ts";
import { TeacherUsageError, usageExact, usageHash, usageId, usageObject, usageRevision, usageTime, validTeacherUsageEvent } from "./edupi-teacher-usage-types.ts";

export type UsageOperation = "teacher_usage_record" | "teacher_usage_consent_set" | "teacher_usage_erase_all";
export type UsageEntry = { id: string; operation: UsageOperation; input_digest: string; payload: Record<string, unknown>;
  status: "pending" | "confirmed" | "quarantined"; result: Record<string, unknown> | null; reason: string | null; policy_ref: string | null };
export type UsageOutboxState = { version: 1; root_ref: string; owner_id: string; stopped: boolean; entries: UsageEntry[] };
export type UsageBinding = { rootRef: string; ownerId: string };
export type UsageOutboxOptions = UsageBinding & { stateDir: string; dataRoot: string; maxEvents?: number };
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_COMMANDS = 128;
const MAX_EVENTS = 5000;
const OWNER = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/u;
function invalid(): never { throw new TeacherUsageError("usage_outbox_invalid"); }
function privateDirectory(directory: string, create: boolean, privateMode = true): void {
  if (create && !fs.existsSync(directory)) fs.mkdirSync(directory, { mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || process.platform !== "win32" && ((stat.mode & (privateMode ? 0o077 : 0o022)) !== 0
    || typeof process.getuid === "function" && stat.uid !== process.getuid())) invalid();
}
export function validUsagePayload(operation: UsageOperation, payload: Record<string, unknown>): boolean {
  if (!usageHash(payload.root_ref) || typeof payload.expected_owner_id !== "string" || !OWNER.test(payload.expected_owner_id)) return false;
  const body = Object.fromEntries(Object.entries(payload).filter(([key]) => !["root_ref", "expected_owner_id"].includes(key)));
  if (operation === "teacher_usage_record") {
    const { consent_ref, ...event } = body;
    return usageHash(consent_ref) && validTeacherUsageEvent(event);
  }
  if (!usageId(body.command_id) || !usageRevision(body.expected_revision)) return false;
  if (operation === "teacher_usage_erase_all") return usageExact(body, ["command_id", "expected_revision", "action", "requested_at"])
    && body.action === "erase_all" && usageTime(body.requested_at);
  if (body.action === "revoke") return usageExact(body, ["command_id", "expected_revision", "action", "requested_at"]) && usageTime(body.requested_at);
  return body.action === "accept" && usageExact(body, ["command_id", "expected_revision", "action", "confirmed_at", "privacy_policy_version", "privacy_policy_sha256", "user_agreement_version", "user_agreement_sha256"])
    && usageTime(body.confirmed_at) && [body.privacy_policy_version, body.user_agreement_version].every(value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(value))
    && usageHash(body.privacy_policy_sha256) && usageHash(body.user_agreement_sha256);
}
/** A bounded, private, root/owner-bound local spool. No transport or background scheduler. */
export class TeacherUsageOutbox {
  readonly file: string;
  readonly rootDirectory: string;
  constructor(readonly options: UsageOutboxOptions) {
    if (!path.isAbsolute(options.stateDir) || !path.isAbsolute(options.dataRoot) || !usageHash(options.rootRef) || !OWNER.test(options.ownerId)) invalid();
    privateDirectory(options.stateDir, false, false);
    if (fs.realpathSync(options.stateDir) !== path.resolve(options.stateDir)) invalid();
    const dataRoot = fs.realpathSync(options.dataRoot);
    const directory = path.join(options.stateDir, "edupi-teacher-usage-v1");
    privateDirectory(directory, true);
    this.rootDirectory = path.join(directory, teacherUsageDigest(teacherUsageCanonical([dataRoot, options.rootRef])).slice(7));
    privateDirectory(this.rootDirectory, true);
    const boundDirectory = path.join(this.rootDirectory, teacherUsageDigest(options.ownerId).slice(7));
    privateDirectory(boundDirectory, true);
    this.file = path.join(boundDirectory, "outbox.json");
  }
  read(): UsageOutboxState {
    try {
      const fd = fs.openSync(this.file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      let content: string;
      try {
        const stat = fs.fstatSync(fd);
        if (!stat.isFile() || stat.size > MAX_BYTES || process.platform !== "win32" && ((stat.mode & 0o077) !== 0 || typeof process.getuid === "function" && stat.uid !== process.getuid())) invalid();
        content = fs.readFileSync(fd, "utf8");
      } finally { fs.closeSync(fd); }
      if (Buffer.byteLength(content) > MAX_BYTES) invalid();
      const value: unknown = JSON.parse(content);
      if (!usageExact(value, ["state", "checksum"]) || !usageHash(value.checksum) || teacherUsageDigest(teacherUsageCanonical(value.state)) !== value.checksum) invalid();
      const state = value.state;
      if (!usageExact(state, ["version", "root_ref", "owner_id", "stopped", "entries"]) || state.version !== 1
        || state.root_ref !== this.options.rootRef || state.owner_id !== this.options.ownerId || typeof state.stopped !== "boolean"
        || !Array.isArray(state.entries) || state.entries.length > MAX_EVENTS + MAX_COMMANDS) invalid();
      const ids = new Set<string>();
      for (const entry of state.entries) {
        if (!usageExact(entry, ["id", "operation", "input_digest", "payload", "status", "result", "reason", "policy_ref"])
          || !usageId(entry.id) || ids.has(entry.id) || !usageHash(entry.input_digest)
          || !["teacher_usage_record", "teacher_usage_consent_set", "teacher_usage_erase_all"].includes(String(entry.operation))
          || !["pending", "confirmed", "quarantined"].includes(String(entry.status))
          || !(entry.reason === null || typeof entry.reason === "string" && /^[a-z0-9_]{1,100}$/u.test(entry.reason))
          || !(entry.policy_ref === null || usageHash(entry.policy_ref)) || !(entry.result === null || usageObject(entry.result))
          || !usageObject(entry.payload) || !validUsagePayload(entry.operation as UsageOperation, entry.payload as Record<string, unknown>)
          || (entry.payload as Record<string, unknown>).root_ref !== this.options.rootRef
          || (entry.payload as Record<string, unknown>).expected_owner_id !== this.options.ownerId
          || ((entry.payload as Record<string, unknown>).event_id ?? (entry.payload as Record<string, unknown>).command_id) !== entry.id) invalid();
        ids.add(entry.id);
      }
      return state as UsageOutboxState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, root_ref: this.options.rootRef, owner_id: this.options.ownerId, stopped: false, entries: [] };
      throw new TeacherUsageError("usage_outbox_invalid");
    }
  }
  save(state: UsageOutboxState): void {
    const observations = state.entries.filter(entry => entry.operation === "teacher_usage_record");
    const events = observations.length;
    if (events > (this.options.maxEvents ?? MAX_EVENTS) || state.entries.length - events > MAX_COMMANDS) throw new TeacherUsageError("usage_outbox_capacity");
    const contents = teacherUsageCanonical({ state, checksum: teacherUsageDigest(teacherUsageCanonical(state)) });
    // Reserve room for withdrawal/erasure even when observations fill their quota.
    if (Buffer.byteLength(teacherUsageCanonical(observations)) > MAX_BYTES - 512 * 1024 || Buffer.byteLength(contents) > MAX_BYTES) throw new TeacherUsageError("usage_outbox_capacity");
    if (fs.existsSync(this.file) && fs.lstatSync(this.file).isSymbolicLink()) invalid();
    writePrivateFileAtomicSync(this.file, contents);
    if (process.platform !== "win32") {
      const directory = fs.openSync(path.dirname(this.file), fs.constants.O_RDONLY);
      try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    }
  }
  add(state: UsageOutboxState, entry: UsageEntry): UsageEntry {
    const prior = state.entries.find(item => item.id === entry.id);
    if (prior) {
      if (prior.input_digest !== entry.input_digest || prior.operation !== entry.operation) throw new TeacherUsageError("usage_outbox_conflict");
      return prior;
    }
    const commands = state.entries.filter(item => item.operation !== "teacher_usage_record").length;
    const commandLimit = entry.operation === "teacher_usage_erase_all" ? MAX_COMMANDS
      : entry.payload.action === "revoke" ? MAX_COMMANDS - 1 : MAX_COMMANDS - 2;
    if (entry.operation !== "teacher_usage_record" && commands >= commandLimit) {
      state.stopped = true; this.save(state); throw new TeacherUsageError("usage_outbox_capacity");
    }
    state.entries.push(entry);
    try { this.save(state); }
    catch (error) {
      state.entries.pop();
      if (error instanceof TeacherUsageError && error.code === "usage_outbox_capacity") { state.stopped = true; this.save(state); }
      throw error;
    }
    return entry;
  }
  /** ADR-059 erasure is root-wide, including queues belonging to an earlier owner. */
  eraseOtherOwners(): void {
    for (const name of fs.readdirSync(this.rootDirectory)) {
      if (!/^[a-f0-9]{64}$/u.test(name)) invalid();
      const directory = path.join(this.rootDirectory, name);
      privateDirectory(directory, false);
      if (directory === path.dirname(this.file)) continue;
      for (const file of fs.readdirSync(directory)) {
        if (file !== "outbox.json" && !/^\.outbox\.json-[a-f0-9-]{36}\.tmp$/u.test(file)) invalid();
        const candidate = path.join(directory, file), stat = fs.lstatSync(candidate);
        if (!stat.isFile() || stat.isSymbolicLink() || process.platform !== "win32" && ((stat.mode & 0o077) !== 0 || typeof process.getuid === "function" && stat.uid !== process.getuid())) invalid();
        fs.unlinkSync(candidate);
      }
      fs.rmdirSync(directory);
    }
    if (process.platform !== "win32") {
      const fd = fs.openSync(this.rootDirectory, fs.constants.O_RDONLY);
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
  }
}
const processState = globalThis as typeof globalThis & { __teacherUsageLocks?: Map<string, Promise<unknown>> };
export async function withTeacherUsageLock<T>(key: string, run: () => Promise<T>): Promise<T> {
  const locks = processState.__teacherUsageLocks ??= new Map();
  const prior = locks.get(key) ?? Promise.resolve();
  const task = prior.catch(() => undefined).then(run);
  locks.set(key, task);
  try { return await task; } finally { if (locks.get(key) === task) locks.delete(key); }
}
export function teacherUsageOutboxSummary(state: UsageOutboxState) {
  return { pending: state.entries.filter(entry => entry.status === "pending").length,
    pending_control: state.entries.filter(entry => entry.status === "pending" && entry.operation !== "teacher_usage_record").length,
    confirmed: state.entries.filter(entry => entry.status === "confirmed").length,
    quarantined: state.entries.filter(entry => entry.status === "quarantined").length, stopped: state.stopped };
}
