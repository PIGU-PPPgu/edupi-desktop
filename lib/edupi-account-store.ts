import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import lockfile from "proper-lockfile";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { accountFail, record } from "./edupi-account-protocol";
import type { AccountChallenge, EduPiAccount } from "./edupi-account-types";

export type PrivateSession = {
  id: string; accessToken: string; refreshToken: string | null; expiresAt: string; account: EduPiAccount;
};
export type PrivateChallenge = AccountChallenge & {
  challengeId: string | null; deviceCode: string | null; verifier: string; interval: number;
  expectedAccountId: string | null; baseSessionId: string | null; pollingAt: number | null;
  authorizationCode?: string;
};
export type PrivateAccountState = {
  version: 1; issuer: string; clientId: string; installationId: string; generation: number;
  session: PrivateSession | null; pending: PrivateChallenge | null;
};
const FILE = "account-private.json";
const MAX_BYTES = 1024 * 1024;
const nofollow = fs.constants.O_NOFOLLOW ?? 0;

function privateDirectory(stateDir?: string): string {
  const selected = stateDir || path.join(getAgentDir(), "edupi-desktop");
  if (!path.isAbsolute(selected)) accountFail("storage_unavailable", "账号凭据存储不可用。", 503);
  // Only a newly created default directory is initialized. Existing permissions
  // are checked, never silently relaxed or rewritten.
  if (!stateDir && !fs.existsSync(selected)) fs.mkdirSync(selected, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(selected);
  if (!stat.isDirectory() || stat.isSymbolicLink() || process.platform !== "win32"
    && ((stat.mode & 0o022) !== 0 || typeof process.getuid === "function" && stat.uid !== process.getuid())) {
    accountFail("storage_unavailable", "账号凭据目录权限无效。", 503);
  }
  const base = fs.realpathSync(selected), directory = path.join(base, "account");
  try { fs.mkdirSync(directory, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const child = fs.lstatSync(directory);
  if (!child.isDirectory() || child.isSymbolicLink() || process.platform !== "win32"
    && ((child.mode & 0o077) !== 0 || typeof process.getuid === "function" && child.uid !== process.getuid())) accountFail("storage_unavailable", "账号凭据目录权限无效。", 503);
  return directory;
}

function empty(issuer: string, clientId: string): PrivateAccountState {
  return { version: 1, issuer, clientId, installationId: randomUUID(), generation: 0, session: null, pending: null };
}
function read(directory: string, issuer: string, clientId: string): PrivateAccountState {
  const file = path.join(directory, FILE);
  let fd: number;
  try { fd = fs.openSync(file, fs.constants.O_RDONLY | nofollow); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty(issuer, clientId);
    return accountFail("storage_unavailable", "账号凭据无法读取。", 503);
  }
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.size > MAX_BYTES || process.platform !== "win32"
      && ((before.mode & 0o077) !== 0 || typeof process.getuid === "function" && before.uid !== process.getuid())) accountFail("storage_unavailable", "账号凭据文件权限无效。", 503);
    const value: unknown = JSON.parse(fs.readFileSync(fd, "utf8"));
    if (!record(value) || value.version !== 1 || typeof value.installationId !== "string" || !Number.isSafeInteger(value.generation)
      || !("session" in value) || !("pending" in value)) accountFail("storage_unavailable", "账号凭据格式无效。", 503);
    if (value.issuer !== issuer || value.clientId !== clientId) accountFail("issuer_changed", "账号服务配置已改变，请先恢复原配置并退出账号。", 409);
    if (value.session !== null && (!record(value.session) || !record(value.session.account) || typeof value.session.accessToken !== "string" || typeof value.session.id !== "string"
      || typeof value.session.expiresAt !== "string" || !Number.isFinite(Date.parse(value.session.expiresAt)))) accountFail("storage_unavailable", "账号登录记录无效。", 503);
    if (value.pending !== null && (!record(value.pending) || typeof value.pending.flowId !== "string" || typeof value.pending.verifier !== "string"
      || typeof value.pending.expiresAt !== "string" || !Number.isFinite(Date.parse(value.pending.expiresAt)))) accountFail("storage_unavailable", "账号扫码记录无效。", 503);
    return value as unknown as PrivateAccountState;
  } catch (error) {
    if (error instanceof SyntaxError) return accountFail("storage_unavailable", "账号凭据格式无效。", 503);
    throw error;
  } finally { fs.closeSync(fd); }
}

/** Short local transactions only; remote calls never hold the file lock. */
export async function accountTransaction<T>(issuer: string, clientId: string, stateDir: string | undefined,
  change: (state: PrivateAccountState) => { result: T; write?: boolean }): Promise<T> {
  const directory = privateDirectory(stateDir);
  let compromised = false;
  const release = await lockfile.lock(path.join(directory, FILE), {
    realpath: false, retries: { retries: 30, minTimeout: 15, maxTimeout: 100 }, stale: 10_000,
    onCompromised: () => { compromised = true; },
  });
  try {
    if (compromised) accountFail("storage_unavailable", "账号凭据正被其他进程修改。", 503);
    const state = read(directory, issuer, clientId);
    const changed = change(state);
    if (compromised) accountFail("storage_unavailable", "账号凭据正被其他进程修改。", 503);
    if (changed.write) {
      const bytes = JSON.stringify(state);
      if (Buffer.byteLength(bytes) > MAX_BYTES) accountFail("storage_unavailable", "账号凭据超过存储上限。", 503);
      writePrivateFileAtomicSync(path.join(directory, FILE), bytes);
      const fd = fs.openSync(directory, fs.constants.O_RDONLY | nofollow);
      try { if (process.platform !== "win32") fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
    return changed.result;
  } finally { await release(); }
}
