import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import lockfile from "proper-lockfile";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file.ts";

export type EduPiCloudMode = "local" | "cloud";
export type EduPiCloudSession = {
  id: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string;
  user: { id: string; email: string | null };
};
export type EduPiCloudOutboxEntry = {
  id: string;
  issuer: string;
  accountId: string;
  workspaceId: string;
  fingerprint: string;
  operation: string;
  body: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  lastError: string | null;
  status: "pending" | "conflict" | "failed";
};
export type EduPiCloudState = {
  version: 2;
  installationId: string;
  issuer: string | null;
  generation: number;
  mode: EduPiCloudMode;
  workspaceId: string | null;
  session: EduPiCloudSession | null;
  outbox: EduPiCloudOutboxEntry[];
  completed: Array<{ entry: EduPiCloudOutboxEntry; result: Record<string, unknown> }>;
  cursors: Record<string, { snapshotId: string; stateHash: string; readAt: string }>;
};

const FILE = "cloud-private.json";
const MAX_BYTES = 4 * 1024 * 1024;
const nofollow = fs.constants.O_NOFOLLOW ?? 0;

function directory(stateDir: string | undefined, create: boolean): string | null {
  const selected = stateDir?.trim() || path.join(getAgentDir(), "edupi-desktop");
  if (!path.isAbsolute(selected)) throw new Error("云端配置目录必须是绝对路径");
  if (!fs.existsSync(selected)) {
    if (!create) return null;
    fs.mkdirSync(selected, { recursive: true, mode: 0o700 });
  }
  const selectedStat = fs.lstatSync(selected);
  if (!selectedStat.isDirectory() || selectedStat.isSymbolicLink()
    || process.platform !== "win32" && ((selectedStat.mode & 0o022) !== 0
      || typeof process.getuid === "function" && selectedStat.uid !== process.getuid())) {
    throw new Error("云端配置目录权限无效");
  }
  const base = fs.realpathSync(selected);
  const cloud = path.join(base, "cloud");
  if (!fs.existsSync(cloud)) {
    if (!create) return null;
    fs.mkdirSync(cloud, { mode: 0o700 });
  }
  const stat = fs.lstatSync(cloud);
  if (!stat.isDirectory() || stat.isSymbolicLink()
    || process.platform !== "win32" && ((stat.mode & 0o077) !== 0
      || typeof process.getuid === "function" && stat.uid !== process.getuid())) {
    throw new Error("云端配置目录权限无效");
  }
  return cloud;
}

function empty(): EduPiCloudState {
  return { version: 2, installationId: randomUUID(), issuer: null, generation: 0,
    mode: "local", workspaceId: null, session: null, outbox: [], completed: [], cursors: {} };
}

const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const text = (value: unknown, max = 240): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;

function read(file: string): EduPiCloudState {
  let fd: number;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | nofollow);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty();
    throw new Error("云端配置无法读取");
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_BYTES
      || process.platform !== "win32" && ((stat.mode & 0o077) !== 0
        || typeof process.getuid === "function" && stat.uid !== process.getuid())) {
      throw new Error("云端配置权限无效");
    }
    const value: unknown = JSON.parse(fs.readFileSync(fd, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("云端配置格式无效");
    const state = value as Record<string, unknown>;
    // The unpublished v1 prototype had no issuer/account/workspace binding.
    // Keep its bytes intact and require explicit recovery; never replay it.
    if (state.version !== 2 || !text(state.installationId)
      || state.issuer !== null && !text(state.issuer, 2048)
      || !Number.isSafeInteger(state.generation) || Number(state.generation) < 0
      || !["local", "cloud"].includes(String(state.mode))
      || state.workspaceId !== null && typeof state.workspaceId !== "string"
      || !Array.isArray(state.outbox)) {
      throw new Error("云端配置格式无效");
    }
    if (state.session !== null) {
      const session = state.session;
      if (!object(session) || !text(session.id) || !object(session.user) || !text(session.user.id)
        || session.user.email !== null && !text(session.user.email, 320)
        || typeof session.accessToken !== "string" || session.accessToken.length > 16384
        || session.refreshToken !== null && !text(session.refreshToken, 16384)
        || typeof session.expiresAt !== "string" || !Number.isFinite(Date.parse(session.expiresAt))) {
        throw new Error("云端登录记录无效");
      }
    }
    if (!Array.isArray(state.completed) || !object(state.cursors)) throw new Error("云端同步记录无效");
    for (const saved of state.completed) {
      if (!object(saved) || !object(saved.entry) || !object(saved.result)) throw new Error("云端同步回执无效");
    }
    for (const entry of [...state.outbox, ...state.completed.map(saved => saved.entry)]) {
      if (!object(entry) || !text(entry.id) || !text(entry.issuer, 2048) || !text(entry.accountId)
        || !text(entry.workspaceId) || !text(entry.fingerprint) || !text(entry.operation)
        || !object(entry.body) || !Number.isSafeInteger(entry.attempts) || Number(entry.attempts) < 0
        || !text(entry.createdAt) || !Number.isFinite(Date.parse(entry.createdAt))
        || !["pending", "conflict", "failed"].includes(String(entry.status))
        || entry.lastError !== null && !text(entry.lastError)) {
        throw new Error("待同步记录格式无效");
      }
    }
    for (const cursor of Object.values(state.cursors)) {
      if (!object(cursor) || !text(cursor.snapshotId) || !text(cursor.stateHash)
        || !text(cursor.readAt) || !Number.isFinite(Date.parse(cursor.readAt))) throw new Error("云端同步游标无效");
    }
    return value as EduPiCloudState;
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("云端配置格式无效");
    throw error;
  } finally {
    fs.closeSync(fd);
  }
}

export async function cloudStateTransaction<T>(
  stateDir: string | undefined,
  change: (state: EduPiCloudState) => { result: T; write?: boolean },
): Promise<T> {
  const dir = directory(stateDir, true)!;
  const file = path.join(dir, FILE);
  let compromised = false;
  const release = await lockfile.lock(file, {
    realpath: false,
    retries: { retries: 30, minTimeout: 15, maxTimeout: 100 },
    stale: 10_000,
    onCompromised: () => { compromised = true; },
  });
  try {
    if (compromised) throw new Error("云端配置正被其他进程修改");
    const state = read(file);
    const changed = change(state);
    if (compromised) throw new Error("云端配置正被其他进程修改");
    if (changed.write) {
      const bytes = JSON.stringify(state);
      if (Buffer.byteLength(bytes) > MAX_BYTES) throw new Error("云端配置超过存储上限");
      writePrivateFileAtomicSync(file, bytes);
    }
    return changed.result;
  } finally {
    await release();
  }
}

export function readCloudStateSync(stateDir?: string): EduPiCloudState {
  const dir = directory(stateDir, false);
  return dir ? read(path.join(dir, FILE)) : empty();
}

export async function readCloudState(stateDir?: string): Promise<EduPiCloudState> {
  return readCloudStateSync(stateDir);
}
