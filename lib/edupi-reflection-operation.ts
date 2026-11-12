import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { EduPiReflectionIndexScope } from "./edupi-reflection-index";

type JsonObject = Record<string, unknown>;
export type ReflectionOperationResponse = { status: number; body: JsonObject; noCommitConfirmed?: true };
export type ReflectionOperationReceipt = {
  id: string;
  fingerprint: string;
  status: "prepared" | "running" | "committed" | "not_committed" | "unknown";
  terminal: boolean;
};
type StoredOperation = {
  version: 1;
  scopeHash: string;
  receipt: ReflectionOperationReceipt;
  mutation: JsonObject;
  dispatched: boolean;
  response: ReflectionOperationResponse | null;
};
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const HASH = /^sha256:[a-f0-9]{64}$/u;
const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;
const MAX_RECORDS = 1024;
// The 20 KB request is stored with result + readback (each with up to 128
// 160-unit source IDs) and an entry projection. JSON can use six bytes per
// UTF-16 unit; the combined bounded fields can exceed 256 KiB.
const MAX_BYTES = 512 * 1024;

export class ReflectionOperationError extends Error {
  constructor(readonly code: string, readonly status = 503) { super(code); }
}

function fail(code = "reflection_operation_unavailable", status = 503): never {
  throw new ReflectionOperationError(code, status);
}

function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function refused(response: ReflectionOperationResponse | null): boolean {
  const result = response?.body.result;
  return response?.noCommitConfirmed === true && response.body.ok === false && object(result)
    && result.status === "held" && typeof result.reason_code === "string" && !!result.reason_code
    && result.entity_id === null && result.occurrence === null && result.external_send === false;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  const result = JSON.stringify(value);
  if (result === undefined) fail("invalid_operation", 400);
  return result;
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function safe(stat: fs.Stats, privateMode: boolean): boolean {
  return process.platform === "win32" || (stat.mode & (privateMode ? 0o077 : 0o022)) === 0
    && (typeof process.getuid !== "function" || stat.uid === process.getuid());
}

function directory(input: string, privateMode: boolean): string {
  if (typeof input !== "string" || !path.isAbsolute(input)) fail();
  const stat = fs.lstatSync(input);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !safe(stat, privateMode)) fail();
  return fs.realpathSync(input);
}

function target(scope: EduPiReflectionIndexScope) {
  if (!scope || !HASH.test(scope.rootRef) || [scope.ownerId, scope.grantId, scope.classId, scope.subject]
    .some(value => typeof value !== "string" || !value || value.length > 160 || /[\u0000-\u001f\u007f]/u.test(value))) fail();
  const state = directory(scope.stateDir, false), data = directory(scope.dataRoot, false);
  const scopeHash = digest([state, data, scope.rootRef, scope.ownerId, scope.grantId, scope.classId, scope.subject]);
  const root = path.join(state, "edupi-reflection-operations");
  try { fs.mkdirSync(root, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  directory(root, true);
  const scopedRoot = path.join(root, scopeHash.slice(7));
  try { fs.mkdirSync(scopedRoot, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  directory(scopedRoot, true);
  return { root: scopedRoot, scopeHash };
}

function identity(input: unknown, fingerprint?: unknown): asserts input is string {
  if (typeof input !== "string" || !UUID.test(input)
    || fingerprint !== undefined && (typeof fingerprint !== "string" || !HASH.test(fingerprint))) fail("invalid_operation", 400);
}

function read(targetValue: ReturnType<typeof target>, id: string): StoredOperation | null {
  const file = path.join(targetValue.root, `${id}.json`);
  let descriptor: number;
  try { descriptor = fs.openSync(file, fs.constants.O_RDONLY | NOFOLLOW | (fs.constants.O_NONBLOCK ?? 0)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  try {
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.nlink !== 1 || !safe(before, true) || before.size < 2 || before.size > MAX_BYTES) fail();
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor), current = fs.lstatSync(file);
    if (before.ino !== after.ino || before.dev !== after.dev || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
      || current.ino !== after.ino || current.dev !== after.dev || current.isSymbolicLink()) fail();
    const stored = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as StoredOperation;
    if (!object(stored) || stored.version !== 1 || stored.scopeHash !== targetValue.scopeHash
      || !object(stored.receipt) || stored.receipt.id !== id || !HASH.test(stored.receipt.fingerprint)
      || !["prepared", "running", "committed", "not_committed", "unknown"].includes(stored.receipt.status)
      || stored.receipt.terminal !== ["committed", "not_committed"].includes(stored.receipt.status)
      || typeof stored.dispatched !== "boolean" || !object(stored.mutation)
      || digest([targetValue.scopeHash, stored.mutation]) !== stored.receipt.fingerprint
      || stored.response !== null && (!object(stored.response) || !Number.isInteger(stored.response.status)
        || stored.response.status < 200 || stored.response.status > 599 || !object(stored.response.body))
      || stored.receipt.status === "committed" && (!stored.dispatched || stored.response?.body.readbackConfirmed !== true
        || stored.response.body.ok !== true || stored.response.status < 200 || stored.response.status >= 300)
      || stored.receipt.status === "prepared" && (stored.dispatched || stored.response !== null)
      || stored.receipt.status === "running" && stored.response !== null
      || stored.receipt.status === "unknown" && !stored.dispatched
      || stored.receipt.status === "not_committed" && stored.dispatched && !refused(stored.response)) fail();
    return stored;
  } finally { fs.closeSync(descriptor); }
}

function persist(targetValue: ReturnType<typeof target>, stored: StoredOperation): void {
  const bytes = Buffer.from(`${JSON.stringify(stored)}\n`);
  if (bytes.length > MAX_BYTES) fail("reflection_operation_capacity");
  const temporary = path.join(targetValue.root, `${stored.receipt.id}.${randomUUID()}.tmp`);
  const descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, 0o600);
  try {
    try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); }
    finally { fs.closeSync(descriptor); }
    directory(targetValue.root, true);
    fs.renameSync(temporary, path.join(targetValue.root, `${stored.receipt.id}.json`));
    const rootDescriptor = fs.openSync(targetValue.root, fs.constants.O_RDONLY | NOFOLLOW | (fs.constants.O_DIRECTORY ?? 0));
    try { fs.fsyncSync(rootDescriptor); } finally { fs.closeSync(rootDescriptor); }
  } finally {
    try { fs.unlinkSync(temporary); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
}

function lock(targetValue: ReturnType<typeof target>): () => void {
  const lockPath = path.join(targetValue.root, "writer.lock");
  const temporary = path.join(targetValue.root, `${process.pid}.${randomUUID()}.lock`);
  const owner = `${process.pid}.${randomUUID()}.owner`;
  fs.mkdirSync(temporary, { mode: 0o700 });
  let moved = false;
  try {
    fs.closeSync(fs.openSync(path.join(temporary, owner), fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | NOFOLLOW, 0o600));
    try { fs.renameSync(temporary, lockPath); }
    catch (error) {
      if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      directory(lockPath, true);
      const occupants = fs.readdirSync(lockPath);
      const match = occupants.length === 1 ? /^([1-9]\d*)\.([a-f0-9-]+)\.owner$/u.exec(occupants[0]) : null;
      if (!match || !UUID.test(match[2])) fail();
      const pid = Number(match[1]);
      if (!Number.isSafeInteger(pid) || pid > 2_147_483_647) fail();
      try { process.kill(pid, 0); fail("reflection_operation_busy", 409); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
      const occupant = path.join(lockPath, occupants[0]), stat = fs.lstatSync(occupant);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== 0 || stat.nlink !== 1 || !safe(stat, true)) fail();
      fs.unlinkSync(occupant);
      fs.rmdirSync(lockPath);
      fs.renameSync(temporary, lockPath);
    }
    moved = true;
    const held = fs.lstatSync(lockPath);
    return () => {
      let current: fs.Stats;
      try { current = fs.lstatSync(lockPath); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
      if (current.dev !== held.dev || current.ino !== held.ino) return;
      fs.unlinkSync(path.join(lockPath, owner));
      try { fs.rmdirSync(lockPath); }
      catch (error) {
        if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
        try {
          const replacement = fs.lstatSync(lockPath);
          if (replacement.dev === held.dev && replacement.ino === held.ino) throw error;
        } catch (recheck) { if ((recheck as NodeJS.ErrnoException).code !== "ENOENT") throw recheck; }
      }
    };
  } finally {
    if (!moved) {
      try { fs.unlinkSync(path.join(temporary, owner)); } catch {}
      fs.rmdirSync(temporary);
    }
  }
}

async function exclusive<Result>(scope: EduPiReflectionIndexScope, callback: (value: ReturnType<typeof target>) => Promise<Result>): Promise<Result> {
  try {
    const targetValue = target(scope), release = lock(targetValue);
    try { return await callback(targetValue); }
    finally { release(); }
  } catch (error) {
    if (error instanceof ReflectionOperationError) throw error;
    fail();
  }
}

export async function prepareReflectionOperation(scope: EduPiReflectionIndexScope, id: string, mutation: JsonObject): Promise<ReflectionOperationReceipt> {
  identity(id);
  if (!object(mutation) || Buffer.byteLength(canonical(mutation)) > 20_000) fail("invalid_operation", 400);
  return exclusive(scope, async targetValue => {
    const fingerprint = digest([targetValue.scopeHash, mutation]);
    const existing = read(targetValue, id);
    if (existing) {
      if (existing.receipt.fingerprint !== fingerprint) fail("operation_mismatch", 409);
      return existing.receipt;
    }
    if (fs.readdirSync(targetValue.root).length >= MAX_RECORDS) fail("reflection_operation_capacity");
    const receipt: ReflectionOperationReceipt = { id, fingerprint, status: "prepared", terminal: false };
    persist(targetValue, { version: 1, scopeHash: targetValue.scopeHash, receipt, mutation, dispatched: false, response: null });
    return receipt;
  });
}

function result(stored: StoredOperation) {
  return { operation: stored.receipt, response: stored.response };
}

export async function runReflectionOperation(
  scope: EduPiReflectionIndexScope, id: string, fingerprint: string, mutation: JsonObject,
  execute: (dispatch: () => void) => Promise<ReflectionOperationResponse>,
) {
  identity(id, fingerprint);
  return exclusive(scope, async targetValue => {
    const stored = read(targetValue, id);
    if (!stored) fail("operation_not_prepared", 409);
    if (stored.receipt.fingerprint !== fingerprint || digest([targetValue.scopeHash, mutation]) !== fingerprint) fail("operation_mismatch", 409);
    if (stored.receipt.status !== "prepared") return result(stored);
    stored.receipt = { ...stored.receipt, status: "running", terminal: false };
    persist(targetValue, stored);
    const dispatch = () => {
      if (stored.dispatched) fail("operation_already_dispatched", 409);
      stored.dispatched = true;
      persist(targetValue, stored);
    };
    try { stored.response = await execute(dispatch); }
    catch {
      stored.response = { status: 503, body: { ok: false, code: "reflection_unavailable", readbackConfirmed: false } };
    }
    const committed = stored.response.body.ok === true && stored.response.body.readbackConfirmed === true
      && stored.response.status >= 200 && stored.response.status < 300;
    const notCommitted = !stored.dispatched || refused(stored.response);
    stored.receipt = { ...stored.receipt,
      status: notCommitted ? "not_committed" : committed ? "committed" : "unknown",
      terminal: notCommitted || committed };
    persist(targetValue, stored);
    return result(stored);
  });
}

export async function resolveReflectionOperation(
  scope: EduPiReflectionIndexScope, id: string, fingerprint: string,
  reconcile?: (mutation: JsonObject) => Promise<ReflectionOperationResponse | null>,
) {
  identity(id, fingerprint);
  return exclusive(scope, async targetValue => {
    const stored = read(targetValue, id);
    if (!stored) fail("operation_not_prepared", 409);
    if (stored.receipt.fingerprint !== fingerprint) fail("operation_mismatch", 409);
    if (!stored.receipt.terminal) {
      stored.receipt = { ...stored.receipt, status: stored.dispatched ? "unknown" : "not_committed", terminal: !stored.dispatched };
      persist(targetValue, stored);
      if (stored.dispatched && reconcile) {
        let confirmed: ReflectionOperationResponse | null = null;
        try { confirmed = await reconcile(structuredClone(stored.mutation)); } catch {}
        if (confirmed?.body.ok === true && confirmed.body.readbackConfirmed === true
          && Number.isInteger(confirmed.status) && confirmed.status >= 200 && confirmed.status < 300) {
          stored.response = confirmed;
          stored.receipt = { ...stored.receipt, status: "committed", terminal: true };
          persist(targetValue, stored);
        }
      }
    }
    return result(stored);
  });
}
