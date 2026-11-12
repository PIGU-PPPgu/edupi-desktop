import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

export type EduPiReflectionIndexScope = {
  stateDir: string;
  dataRoot: string;
  rootRef: string;
  ownerId: string;
  grantId: string;
  classId: string;
  subject: string;
};

export type EduPiReflectionIndexEntry = {
  date: string;
  slotId: string;
  lessonId: string;
  factId: string;
};

export type EduPiReflectionIndexQuery = {
  date: string;
  slotId?: string;
  lessonId?: string;
};

type StoredIndex = { version: 1; scopeHash: string; entries: EduPiReflectionIndexEntry[] };
const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;
const MAX_BYTES = 1_048_576;
const MAX_ENTRIES = 2000;
const ID = /^[A-Za-z0-9_][A-Za-z0-9._:@/+~-]{0,159}$/u;
const HASH = /^sha256:[a-f0-9]{64}$/u;
const LOCK_STALE_MS = 30_000;
const LOCK_OWNER = /^([1-9]\d{0,9})\.([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\.owner$/u;
type IndexLock = { path: string; identity: fs.Stats; owner: string };

function fail(): never {
  throw Object.assign(new Error("Reflection index unavailable"), { code: "reflection_index_unavailable" });
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function keys(value: unknown, names: string[]): value is Record<string, unknown> {
  return object(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 160
    && value === value.normalize("NFKC").trim() && !/[\u0000-\u001f\u007f]/u.test(value);
}

function dateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validEntry(value: unknown): value is EduPiReflectionIndexEntry {
  return keys(value, ["date", "slotId", "lessonId", "factId"]) && dateOnly(value.date)
    && text(value.slotId) && text(value.lessonId) && ID.test(value.lessonId)
    && text(value.factId) && ID.test(value.factId);
}

function safeStat(stat: fs.Stats, privateMode: boolean): boolean {
  return process.platform === "win32" || (stat.mode & (privateMode ? 0o077 : 0o022)) === 0
    && (typeof process.getuid !== "function" || stat.uid === process.getuid());
}

function directory(input: string, privateMode: boolean): string {
  if (typeof input !== "string" || !path.isAbsolute(input)) fail();
  const stat = fs.lstatSync(input);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !safeStat(stat, privateMode)) fail();
  return fs.realpathSync(input);
}

function location(scope: EduPiReflectionIndexScope) {
  if (!object(scope) || !text(scope.ownerId) || !ID.test(scope.ownerId) || !text(scope.grantId) || !ID.test(scope.grantId)
    || !text(scope.classId) || !ID.test(scope.classId) || !text(scope.subject)
    || typeof scope.rootRef !== "string" || !HASH.test(scope.rootRef)) fail();
  const state = directory(scope.stateDir, false);
  const data = directory(scope.dataRoot, false);
  const scopeHash = `sha256:${createHash("sha256").update(JSON.stringify([
    state, data, scope.rootRef, scope.ownerId, scope.grantId, scope.classId, scope.subject,
  ])).digest("hex")}`;
  const root = path.join(state, "edupi-reflection-index");
  return { root, file: path.join(root, `${scopeHash.slice(7)}.json`), scopeHash };
}

function readStored(target: ReturnType<typeof location>): StoredIndex {
  const empty: StoredIndex = { version: 1, scopeHash: target.scopeHash, entries: [] };
  try { directory(target.root, true); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty; throw error; }
  let descriptor: number;
  try { descriptor = fs.openSync(target.file, fs.constants.O_RDONLY | NOFOLLOW | (fs.constants.O_NONBLOCK ?? 0)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty; throw error; }
  try {
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.nlink !== 1 || !safeStat(before, true) || before.size < 2 || before.size > MAX_BYTES) fail();
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    const current = fs.lstatSync(target.file);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
      || current.ino !== after.ino || current.dev !== after.dev || current.isSymbolicLink()) fail();
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!keys(value, ["version", "scopeHash", "entries"]) || value.version !== 1 || value.scopeHash !== target.scopeHash
      || !Array.isArray(value.entries) || value.entries.length > MAX_ENTRIES || !value.entries.every(validEntry)
      || new Set(value.entries.map(entry => entry.factId)).size !== value.entries.length) fail();
    return value as StoredIndex;
  } finally { fs.closeSync(descriptor); }
}

export function readEduPiReflectionIndex(scope: EduPiReflectionIndexScope, query: EduPiReflectionIndexQuery): EduPiReflectionIndexEntry[] {
  try {
    if (!object(query) || !dateOnly(query.date) || query.slotId !== undefined && !text(query.slotId)
      || query.lessonId !== undefined && (!text(query.lessonId) || !ID.test(query.lessonId))
      || Object.keys(query).some(key => !["date", "slotId", "lessonId"].includes(key))) fail();
    return readStored(location(scope)).entries.filter(entry => entry.date === query.date
      && (query.slotId === undefined || entry.slotId === query.slotId)
      && (query.lessonId === undefined || entry.lessonId === query.lessonId));
  } catch { fail(); }
}

function verified(scope: EduPiReflectionIndexScope, entry: EduPiReflectionIndexEntry, readback: unknown): boolean {
  if (!object(readback) || readback.status !== "ready" || readback.external_send !== false
    || readback.entity_id !== entry.lessonId || !object(readback.occurrence) || !object(readback.completion)) return false;
  const occurrence = readback.occurrence;
  return occurrence.entity_id === entry.lessonId && occurrence.class_id === scope.classId
    && occurrence.subject === scope.subject && occurrence.source_event_date === entry.date
    && occurrence.slot_id === entry.slotId && readback.completion.fact_id === entry.factId;
}

function lockDirectory(lockPath: string, expected?: fs.Stats): fs.Stats {
  const current = fs.lstatSync(lockPath);
  if (!current.isDirectory() || current.isSymbolicLink() || !safeStat(current, true)
    || expected && (current.dev !== expected.dev || current.ino !== expected.ino)) fail();
  return current;
}

function reclaimLock(lockPath: string): void {
  const identity = lockDirectory(lockPath);
  if (Date.now() - identity.mtimeMs < LOCK_STALE_MS) fail();
  const contents = fs.readdirSync(lockPath);
  // A creator can pause between mkdir and writing its owner file. Reclaiming an
  // empty directory would let that creator resume inside a replacement lock.
  if (contents.length !== 1) fail();
  const owner = contents[0];
  const match = LOCK_OWNER.exec(owner);
  const pid = match ? Number(match[1]) : 0;
  if (!Number.isSafeInteger(pid) || pid < 1 || pid > 2_147_483_647) fail();
  const ownerPath = path.join(lockPath, owner);
  const descriptor = fs.openSync(ownerPath, fs.constants.O_RDONLY | NOFOLLOW | (fs.constants.O_NONBLOCK ?? 0));
  try {
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.size !== 0 || before.nlink !== 1 || !safeStat(before, true)) fail();
    try { process.kill(pid, 0); fail(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    const current = fs.lstatSync(ownerPath);
    if (current.isSymbolicLink() || current.dev !== before.dev || current.ino !== before.ino
      || current.ctimeMs !== before.ctimeMs || current.nlink !== 1 || !safeStat(current, true)) fail();
    const directory = lockDirectory(lockPath, identity);
    if (directory.mtimeMs !== identity.mtimeMs || directory.ctimeMs !== identity.ctimeMs) fail();
    fs.unlinkSync(ownerPath);
  } finally { fs.closeSync(descriptor); }
  lockDirectory(lockPath, identity);
  fs.rmdirSync(lockPath);
}

function acquireLock(lockPath: string): IndexLock {
  try { fs.mkdirSync(lockPath, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    reclaimLock(lockPath);
    fs.mkdirSync(lockPath, { mode: 0o700 });
  }
  const identity = lockDirectory(lockPath);
  const owner = `${process.pid}.${randomUUID()}.owner`;
  const descriptor = fs.openSync(path.join(lockPath, owner),
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, 0o600);
  fs.closeSync(descriptor);
  lockDirectory(lockPath, identity);
  return { path: lockPath, identity, owner };
}

function assertLock(lock: IndexLock): void {
  lockDirectory(lock.path, lock.identity);
  const owner = fs.lstatSync(path.join(lock.path, lock.owner));
  if (!owner.isFile() || owner.isSymbolicLink() || owner.nlink !== 1 || owner.size !== 0 || !safeStat(owner, true)) fail();
}

function releaseLock(lock: IndexLock): void {
  assertLock(lock);
  fs.unlinkSync(path.join(lock.path, lock.owner));
  lockDirectory(lock.path, lock.identity);
  fs.rmdirSync(lock.path);
}

export function appendEduPiReflectionIndex(
  scope: EduPiReflectionIndexScope,
  entry: EduPiReflectionIndexEntry,
  authoritativeReadback: unknown,
): void {
  let temporary: string | undefined;
  let lock: IndexLock | undefined;
  let descriptor: number | undefined;
  try {
    if (!validEntry(entry) || !verified(scope, entry, authoritativeReadback)) fail();
    const target = location(scope);
    try { fs.mkdirSync(target.root, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    directory(target.root, true);
    lock = acquireLock(`${target.file}.lock`);
    const stored = readStored(target);
    const existing = stored.entries.find(item => item.factId === entry.factId);
    if (existing) {
      if (existing.date !== entry.date || existing.slotId !== entry.slotId || existing.lessonId !== entry.lessonId) fail();
      return;
    }
    if (stored.entries.length >= MAX_ENTRIES) fail();
    stored.entries.push({ date: entry.date, slotId: entry.slotId, lessonId: entry.lessonId, factId: entry.factId });
    const bytes = Buffer.from(`${JSON.stringify(stored)}\n`, "utf8");
    if (bytes.length > MAX_BYTES) fail();
    temporary = `${target.file}.${randomUUID()}.tmp`;
    descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    directory(target.root, true);
    readStored(target);
    assertLock(lock);
    fs.renameSync(temporary, target.file);
    temporary = undefined;
    const directoryDescriptor = fs.openSync(target.root, fs.constants.O_RDONLY | NOFOLLOW | (fs.constants.O_DIRECTORY ?? 0));
    try { fs.fsyncSync(directoryDescriptor); } finally { fs.closeSync(directoryDescriptor); }
    if (JSON.stringify(readStored(target)) !== JSON.stringify(stored)) fail();
  } catch { fail(); }
  finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (temporary !== undefined) fs.unlinkSync(temporary);
    if (lock !== undefined) releaseLock(lock);
  }
}
