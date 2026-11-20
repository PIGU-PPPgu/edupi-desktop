import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import lockfile from "proper-lockfile";

export type EduPiTeacherTemplateScope = Readonly<{ class_id: string; subject: string }>;
/** Exact fc89 Core g3Live.teacherTemplates shape. No grantVersion or wildcards. */
export type EduPiTeacherTemplateBinding = Readonly<{
  ownerId: string; grantId: string; scope: EduPiTeacherTemplateScope; templateIds: readonly string[];
}>;
export type EduPiTeacherTemplateConfig = {
  version: 1; dataRootHash: string; updatedAt: string; enabled: boolean;
  binding: EduPiTeacherTemplateBinding | null; grantVersion: number | null;
};
export type EduPiTeacherTemplateConfigInput =
  | { enabled: false; grantVersion?: number }
  | { enabled: true; binding: EduPiTeacherTemplateBinding; grantVersion: number };
export type EduPiTeacherTemplateRoot = { dataRoot: string; stateDir?: string };
export type EduPiTeacherTemplateMutation = EduPiTeacherTemplateRoot & { expectedUpdatedAt: string | null; now?: string };
export type EduPiTeacherTemplateConfigRead = {
  status: "missing" | "ready" | "invalid" | "root_mismatch"; config: EduPiTeacherTemplateConfig | null;
};
export type TeacherTemplateErrorCode = "teacher_template_configuration_unavailable" | "teacher_template_invalid_input"
  | "teacher_template_config_conflict" | "teacher_template_response_invalid" | "teacher_template_grant_denied"
  | "teacher_template_owner_unavailable" | "teacher_template_runtime_upgrade_required";
export class EduPiTeacherTemplateError extends Error {
  constructor(readonly code: TeacherTemplateErrorCode) { super(code); this.name = "EduPiTeacherTemplateError"; }
}
export function teacherTemplateFail(code: TeacherTemplateErrorCode = "teacher_template_configuration_unavailable"): never {
  throw new EduPiTeacherTemplateError(code);
}
export const EDUPI_TEACHER_TEMPLATE_CONFIG_FILE = "edupi-teacher-templates.json";
const LOCK_FILE = ".edupi-teacher-template-mutation.lock";
const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;
const OWNER_ID = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/u;
export const teacherTemplateId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,159}$/u.test(value);
export const teacherTemplateTime = (value: unknown): value is string => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export const teacherTemplateHash = (value: string): string => `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
export function teacherTemplateKeys(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const keys = Reflect.ownKeys(value);
  return required.every(key => keys.includes(key)) && keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === "string" && [...required, ...optional].includes(key)
      && descriptor?.enumerable && Object.hasOwn(descriptor, "value");
  });
}
export function validTeacherTemplateScope(value: unknown): value is EduPiTeacherTemplateScope {
  return teacherTemplateKeys(value, ["class_id", "subject"])
    && typeof value.class_id === "string" && OWNER_ID.test(value.class_id)
    && typeof value.subject === "string" && value.subject.length > 0 && value.subject.length <= 128
    && value.subject.trim() === value.subject && !/[\u0000-\u001f\u007f]/u.test(value.subject);
}
export function validTeacherTemplateIds(value: unknown): value is readonly string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length < 1 || value.length > 40 || Reflect.ownKeys(value).length !== value.length + 1) return false;
  const ids: string[] = [];
  for (let index = 0; index < value.length; index++) {
    const slot = Object.getOwnPropertyDescriptor(value, index);
    if (!slot?.enumerable || !Object.hasOwn(slot, "value") || !teacherTemplateId(slot.value) || ids.includes(slot.value)) return false;
    ids.push(slot.value);
  }
  return true;
}
export function parseEduPiTeacherTemplateBinding(value: unknown): EduPiTeacherTemplateBinding | null {
  if (!teacherTemplateKeys(value, ["ownerId", "grantId", "scope", "templateIds"])
    || typeof value.ownerId !== "string" || !OWNER_ID.test(value.ownerId)
    || typeof value.grantId !== "string" || !OWNER_ID.test(value.grantId)
    || !validTeacherTemplateScope(value.scope) || !validTeacherTemplateIds(value.templateIds)) return null;
  return Object.freeze({ ownerId: value.ownerId, grantId: value.grantId,
    scope: Object.freeze({ ...value.scope }), templateIds: Object.freeze([...value.templateIds]) });
}
function validStored(value: unknown): value is EduPiTeacherTemplateConfig {
  return teacherTemplateKeys(value, ["version", "dataRootHash", "updatedAt", "enabled", "binding", "grantVersion"])
    && value.version === 1 && typeof value.dataRootHash === "string" && /^sha256:[a-f0-9]{64}$/u.test(value.dataRootHash)
    && teacherTemplateTime(value.updatedAt) && typeof value.enabled === "boolean"
    && (value.binding === null && value.grantVersion === null && value.enabled === false
      || parseEduPiTeacherTemplateBinding(value.binding) !== null && Number.isSafeInteger(value.grantVersion) && Number(value.grantVersion) >= 1);
}
type Store = { stateDir: string; dataRootHash: string; assertCurrent(): void };
function privateStat(stat: fs.Stats): boolean {
  return process.platform === "win32" || (stat.mode & 0o077) === 0
    && (typeof process.getuid !== "function" || stat.uid === process.getuid());
}
function directory(value: string | undefined): { root: string; stat: fs.Stats } {
  if (!value || !path.isAbsolute(value)) teacherTemplateFail();
  const root = path.resolve(value), stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !privateStat(stat) || fs.realpathSync(root) !== root) teacherTemplateFail();
  return { root, stat };
}
function sameIdentity(left: fs.Stats, right: fs.Stats): boolean { return left.dev === right.dev && left.ino === right.ino; }
function openStore(options: EduPiTeacherTemplateRoot): Store {
  try {
    const state = directory(options.stateDir ?? process.env.PI_DESKTOP_STATE_DIR), data = directory(options.dataRoot);
    return { stateDir: state.root, dataRootHash: teacherTemplateHash(data.root), assertCurrent() {
      try {
        if (!sameIdentity(state.stat, directory(state.root).stat) || !sameIdentity(data.stat, directory(data.root).stat)) teacherTemplateFail();
      } catch { teacherTemplateFail(); }
    } };
  } catch { return teacherTemplateFail(); }
}
function readStored(store: Store): unknown | undefined {
  store.assertCurrent();
  const file = path.join(store.stateDir, EDUPI_TEACHER_TEMPLATE_CONFIG_FILE);
  let descriptor: number | undefined;
  const valid = (stat: fs.Stats) => stat.isFile() && stat.nlink === 1 && privateStat(stat) && stat.size >= 2 && stat.size <= 16_384;
  try {
    try { descriptor = fs.openSync(file, fs.constants.O_RDONLY | NOFOLLOW | (fs.constants.O_NONBLOCK ?? 0)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
    const before = fs.fstatSync(descriptor);
    if (!valid(before)) teacherTemplateFail();
    const bytes = fs.readFileSync(descriptor), after = fs.fstatSync(descriptor), current = fs.lstatSync(file);
    if (!valid(current) || !sameIdentity(before, after) || !sameIdentity(before, current)
      || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
      || after.size !== current.size || after.mtimeMs !== current.mtimeMs || after.ctimeMs !== current.ctimeMs
      || fs.realpathSync(file) !== file) teacherTemplateFail();
    store.assertCurrent();
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch { return teacherTemplateFail(); }
  finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}
function currentConfig(store: Store): EduPiTeacherTemplateConfig | null {
  const value = readStored(store);
  if (value === undefined) return null;
  if (!validStored(value) || value.dataRootHash !== store.dataRootHash) teacherTemplateFail();
  return value;
}
export function readEduPiTeacherTemplateConfig(options: EduPiTeacherTemplateRoot): EduPiTeacherTemplateConfigRead {
  if (!(options.stateDir ?? process.env.PI_DESKTOP_STATE_DIR)) return { status: "missing", config: null };
  try {
    const store = openStore(options), value = readStored(store);
    if (value === undefined) return { status: "missing", config: null };
    if (!validStored(value)) return { status: "invalid", config: null };
    if (value.dataRootHash !== store.dataRootHash) return { status: "root_mismatch", config: null };
    return { status: "ready", config: value };
  } catch { return { status: "invalid", config: null }; }
}
/** A selection snapshot, never proof that the current Core grant allows execution. */
export function readEduPiTeacherTemplateBinding(options: EduPiTeacherTemplateRoot): EduPiTeacherTemplateBinding | null {
  const { config } = readEduPiTeacherTemplateConfig(options);
  return config?.enabled ? parseEduPiTeacherTemplateBinding(config.binding) : null;
}
/** Retain the explicit selection on stop so Core can independently prove read-only history. */
export function readEduPiTeacherTemplateHistoryBinding(options: EduPiTeacherTemplateRoot): EduPiTeacherTemplateBinding | null {
  return parseEduPiTeacherTemplateBinding(readEduPiTeacherTemplateConfig(options).config?.binding);
}
function writeStored(store: Store, value: EduPiTeacherTemplateConfig, assertLocked: () => void): void {
  const file = path.join(store.stateDir, EDUPI_TEACHER_TEMPLATE_CONFIG_FILE);
  const temporary = path.join(store.stateDir, `.${EDUPI_TEACHER_TEMPLATE_CONFIG_FILE}.${crypto.randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    assertLocked(); readStored(store);
    const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
    if (bytes.length > 16_384) teacherTemplateFail("teacher_template_invalid_input");
    descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, 0o600);
    for (let offset = 0; offset < bytes.length;) {
      const written = fs.writeSync(descriptor, bytes, offset);
      if (written < 1) teacherTemplateFail();
      offset += written;
    }
    fs.fsyncSync(descriptor); fs.closeSync(descriptor); descriptor = undefined;
    assertLocked(); readStored(store);
    fs.renameSync(temporary, file);
    const directoryDescriptor = fs.openSync(store.stateDir, fs.constants.O_RDONLY | NOFOLLOW | (fs.constants.O_DIRECTORY ?? 0));
    try { fs.fsyncSync(directoryDescriptor); } finally { fs.closeSync(directoryDescriptor); }
    if (JSON.stringify(readStored(store)) !== JSON.stringify(value)) teacherTemplateFail();
    assertLocked();
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { fs.unlinkSync(temporary); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") teacherTemplateFail(); }
  }
}
function snapshotInput(input: EduPiTeacherTemplateConfigInput): EduPiTeacherTemplateConfigInput {
  if (teacherTemplateKeys(input, ["enabled"], ["grantVersion"]) && input.enabled === false) {
    if (Object.hasOwn(input, "grantVersion") && (!Number.isSafeInteger(input.grantVersion) || Number(input.grantVersion) < 1)) {
      teacherTemplateFail("teacher_template_invalid_input");
    }
    return { enabled: false, ...(input.grantVersion === undefined ? {} : { grantVersion: input.grantVersion }) };
  }
  if (!teacherTemplateKeys(input, ["enabled", "binding", "grantVersion"]) || input.enabled !== true
    || !Number.isSafeInteger(input.grantVersion) || input.grantVersion < 1) teacherTemplateFail("teacher_template_invalid_input");
  const binding = parseEduPiTeacherTemplateBinding(input.binding);
  if (!binding) teacherTemplateFail("teacher_template_invalid_input");
  return { enabled: true, binding, grantVersion: input.grantVersion };
}
/** Internal service transaction: Core control CAS and the private config CAS share this root-local lock. */
export async function mutateEduPiTeacherTemplateConfig(options: EduPiTeacherTemplateMutation,
  prepare: (current: EduPiTeacherTemplateConfig | null) => Promise<EduPiTeacherTemplateConfigInput>): Promise<EduPiTeacherTemplateConfig> {
  options = { ...options };
  if (!Object.hasOwn(options, "expectedUpdatedAt") || options.expectedUpdatedAt !== null && !teacherTemplateTime(options.expectedUpdatedAt)
    || options.now !== undefined && !teacherTemplateTime(options.now)) teacherTemplateFail("teacher_template_invalid_input");
  const store = openStore(options), lockPath = path.join(store.stateDir, LOCK_FILE);
  let release: (() => Promise<void>) | undefined, compromised = false;
  try {
    try {
      const stat = fs.lstatSync(lockPath);
      if (!stat.isDirectory() || stat.isSymbolicLink() || typeof process.getuid === "function" && stat.uid !== process.getuid()) teacherTemplateFail();
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    release = await lockfile.lock(store.stateDir, { realpath: false, lockfilePath: lockPath, stale: 30_000, update: 5_000,
      retries: { retries: 80, factor: 1.1, minTimeout: 5, maxTimeout: 100 }, onCompromised: () => { compromised = true; } });
    const descriptor = fs.openSync(lockPath, fs.constants.O_RDONLY | NOFOLLOW | (fs.constants.O_DIRECTORY ?? 0));
    let identity: fs.Stats;
    try { identity = fs.fstatSync(descriptor); fs.fchmodSync(descriptor, 0o700); } finally { fs.closeSync(descriptor); }
    const assertLocked = () => {
      store.assertCurrent();
      const stat = fs.lstatSync(lockPath);
      if (compromised || !stat.isDirectory() || stat.isSymbolicLink() || !privateStat(stat) || !sameIdentity(identity, stat)) teacherTemplateFail();
    };
    assertLocked();
    const previous = currentConfig(store);
    if ((previous?.updatedAt ?? null) !== options.expectedUpdatedAt) teacherTemplateFail("teacher_template_config_conflict");
    const input = snapshotInput(await prepare(previous));
    assertLocked();
    const current = currentConfig(store);
    if ((current?.updatedAt ?? null) !== options.expectedUpdatedAt) teacherTemplateFail("teacher_template_config_conflict");
    const now = options.now ?? new Date().toISOString();
    const updatedAt = new Date(Math.max(Date.parse(now), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString();
    const next: EduPiTeacherTemplateConfig = { version: 1, dataRootHash: store.dataRootHash, updatedAt, enabled: input.enabled,
      binding: input.enabled ? input.binding : previous?.binding ?? null,
      grantVersion: input.enabled ? input.grantVersion : input.grantVersion ?? previous?.grantVersion ?? null };
    if (!validStored(next)) teacherTemplateFail("teacher_template_invalid_input");
    writeStored(store, next, assertLocked);
    return next;
  } catch (error) {
    if (error instanceof EduPiTeacherTemplateError) throw error;
    return teacherTemplateFail();
  } finally { if (release) try { await release(); } catch { teacherTemplateFail(); } }
}
export async function writeEduPiTeacherTemplateConfig(input: EduPiTeacherTemplateConfigInput,
  options: EduPiTeacherTemplateMutation): Promise<EduPiTeacherTemplateConfig> {
  const snapshot = snapshotInput(input);
  return mutateEduPiTeacherTemplateConfig(options, async () => snapshot);
}
