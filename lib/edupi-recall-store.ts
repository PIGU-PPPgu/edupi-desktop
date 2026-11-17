// Private IO shared by the R04 configuration and authorization modules.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import lockfile from "proper-lockfile";

export type RecallRootOptions = { dataRoot: string; stateDir?: string };
export type RecallErrorCode = "recall_storage_unavailable" | "recall_invalid_input" | "recall_config_conflict"
  | "recall_normal_not_approved" | "recall_inactive" | "recall_binding_mismatch" | "recall_intent_conflict"
  | "recall_intent_unavailable" | "recall_budget_binding_changed" | "recall_budget_exhausted"
  | "recall_request_replayed" | "recall_model_dispatch_only" | "recall_intent_ambiguous" | "recall_capacity";

export class EduPiRecallError extends Error {
  constructor(readonly code: RecallErrorCode) { super(code); this.name = "EduPiRecallError"; }
}
export function recallFail(code: RecallErrorCode = "recall_storage_unavailable"): never {
  throw new EduPiRecallError(code);
}
export function snapshotRecallInput<T>(value: T): T {
  try { return structuredClone(value); }
  catch { return recallFail("recall_invalid_input"); }
}
export const recallHash = (value: string): string => `sha256:${crypto.createHash("sha256").update(value, "utf8").digest("hex")}`;
export const recallHashValid = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
export const recallId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_][A-Za-z0-9_.:@/+~=-]{0,159}$/u.test(value);
export const recallTime = (value: unknown): value is string => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export function recallKeys(value: unknown, required: string[], optional: string[] = []): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => required.includes(key) || optional.includes(key)));
}

const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;
export const RECALL_CONFIG_FILE = "edupi-recall-config.json";
export const RECALL_LEDGER_FILE = "edupi-recall-authorization.json";
type RecallFile = typeof RECALL_CONFIG_FILE | typeof RECALL_LEDGER_FILE;
type Identity = { dev: number; ino: number };
export type RecallStore = {
  stateDir: string;
  dataRoot: string;
  dataRootHash: string;
  assertCurrent: () => void;
  assertMutation?: () => void;
};
function sameIdentity(left: Identity, right: Identity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}
function privateStat(stat: fs.Stats): boolean {
  return process.platform === "win32" || (stat.mode & 0o077) === 0
    && (typeof process.getuid !== "function" || stat.uid === process.getuid());
}
function directory(root: string | undefined): { root: string; stat: fs.Stats } {
  if (!root || !path.isAbsolute(root)) recallFail();
  const normalized = path.resolve(root);
  const stat = fs.lstatSync(normalized);
  // Checking realpath also rejects symlinks in ancestors, not just the final component.
  if (!stat.isDirectory() || stat.isSymbolicLink() || !privateStat(stat) || fs.realpathSync(normalized) !== normalized) recallFail();
  return { root: normalized, stat };
}
export function openRecallStore(options: RecallRootOptions): RecallStore {
  try {
    const state = directory(options.stateDir ?? process.env.PI_DESKTOP_STATE_DIR);
    const data = directory(options.dataRoot);
    return {
      stateDir: state.root, dataRoot: data.root, dataRootHash: recallHash(data.root),
      assertCurrent() {
        try {
          if (!sameIdentity(state.stat, directory(state.root).stat) || !sameIdentity(data.stat, directory(data.root).stat)) recallFail();
        } catch { recallFail(); }
      },
    };
  } catch { return recallFail(); }
}
function checkedFile(store: RecallStore, name: RecallFile): string {
  store.assertCurrent();
  if (name !== RECALL_CONFIG_FILE && name !== RECALL_LEDGER_FILE) recallFail();
  return path.join(store.stateDir, name);
}
function validFile(stat: fs.Stats, max: number): boolean {
  return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && privateStat(stat) && stat.size >= 2 && stat.size <= max;
}
export function readRecallJson(store: RecallStore, name: RecallFile): unknown | null {
  const file = checkedFile(store, name);
  const max = name === RECALL_CONFIG_FILE ? 16_384 : 16 * 1024 * 1024;
  let descriptor: number | undefined;
  try {
    try { descriptor = fs.openSync(file, fs.constants.O_RDONLY | NOFOLLOW | (fs.constants.O_NONBLOCK ?? 0)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    const before = fs.fstatSync(descriptor);
    if (!validFile(before, max)) recallFail();
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor), current = fs.lstatSync(file);
    if (!validFile(current, max) || !sameIdentity(before, after) || !sameIdentity(before, current)
      || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
      || after.size !== current.size || after.mtimeMs !== current.mtimeMs || after.ctimeMs !== current.ctimeMs
      || fs.realpathSync(file) !== file) recallFail();
    store.assertCurrent();
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    // JSON null is corruption, not the sentinel for a missing ledger.
    if (!value || typeof value !== "object" || Array.isArray(value)) recallFail();
    return value;
  } catch { return recallFail(); }
  finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}
function syncDirectory(root: string): void {
  const descriptor = fs.openSync(root, fs.constants.O_RDONLY | NOFOLLOW | (fs.constants.O_DIRECTORY ?? 0));
  try { fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
}
export function writeRecallJson(store: RecallStore, name: RecallFile, value: unknown): void {
  const file = checkedFile(store, name);
  if (!store.assertMutation) recallFail();
  const temporary = path.join(store.stateDir, `.${name}.${crypto.randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    store.assertMutation();
    // Reject an unsafe existing target before creating even a temporary file.
    readRecallJson(store, name);
    const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
    if (bytes.length > (name === RECALL_CONFIG_FILE ? 16_384 : 16 * 1024 * 1024)) recallFail("recall_capacity");
    descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, 0o600);
    let offset = 0;
    while (offset < bytes.length) {
      const written = fs.writeSync(descriptor, bytes, offset);
      if (written < 1) recallFail();
      offset += written;
    }
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor); descriptor = undefined;
    store.assertMutation();
    readRecallJson(store, name);
    fs.renameSync(temporary, file);
    syncDirectory(store.stateDir);
    if (JSON.stringify(readRecallJson(store, name)) !== JSON.stringify(value)) recallFail();
    store.assertMutation();
  } catch (error) {
    if (error instanceof EduPiRecallError) throw error;
    recallFail();
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { fs.unlinkSync(temporary); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") recallFail(); }
  }
}

/** One root-local interprocess lock serializes config, intents, revocation and budget consumption. */
export async function withRecallMutation<T>(options: RecallRootOptions, operation: (store: RecallStore) => T): Promise<T> {
  const store = openRecallStore(options);
  const lockPath = path.join(store.stateDir, ".edupi-recall-mutation.lock");
  let release: (() => Promise<void>) | undefined, compromised = false;
  try {
    try {
      const existing = fs.lstatSync(lockPath);
      if (!existing.isDirectory() || existing.isSymbolicLink()
        || typeof process.getuid === "function" && existing.uid !== process.getuid()) recallFail();
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    release = await lockfile.lock(store.stateDir, {
      realpath: false, lockfilePath: lockPath, stale: 30_000, update: 5_000,
      retries: { retries: 80, factor: 1.1, minTimeout: 5, maxTimeout: 100 },
      onCompromised: () => { compromised = true; },
    });
    // chmod by a no-follow descriptor: never follow a replaced lock path.
    const lockDescriptor = fs.openSync(lockPath, fs.constants.O_RDONLY | NOFOLLOW | (fs.constants.O_DIRECTORY ?? 0));
    let identity: fs.Stats;
    try {
      identity = fs.fstatSync(lockDescriptor);
      if (!identity.isDirectory()) recallFail();
      fs.fchmodSync(lockDescriptor, 0o700);
    } finally { fs.closeSync(lockDescriptor); }
    const acquiredAt = performance.now();
    store.assertMutation = () => {
      store.assertCurrent();
      const current = fs.lstatSync(lockPath);
      // A synchronous mutation never waits on network IO. Refuse work beyond the stale window.
      if (compromised || performance.now() - acquiredAt >= 25_000 || !current.isDirectory()
        || current.isSymbolicLink() || !privateStat(current) || !sameIdentity(identity, current)) recallFail();
    };
    store.assertMutation();
    const result = operation(store);
    store.assertMutation();
    return result;
  } catch (error) {
    if (error instanceof EduPiRecallError) throw error;
    return recallFail();
  } finally {
    if (release) {
      try { await release(); }
      catch { recallFail(); }
    }
  }
}
