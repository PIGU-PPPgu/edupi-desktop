import { randomUUID } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import lockfile from "proper-lockfile";
import { bindTaskSessionRecord, normalizeTaskSessionStore, type TaskSessionStore } from "./edupi-task-sessions";

const EMPTY_STORE: TaskSessionStore = { schema_version: 1, bindings: [] };

async function readExisting(filePath: string): Promise<TaskSessionStore> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.schema_version !== 1 || !Array.isArray(parsed.bindings)) {
      throw new Error("schema_version 或 bindings 无效");
    }
    const normalized = normalizeTaskSessionStore(parsed);
    if (normalized.bindings.length !== parsed.bindings.length) throw new Error("binding 记录无效、重复或冲突");
    return normalized;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return EMPTY_STORE;
    throw new Error(`任务会话索引损坏，拒绝覆盖：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function ensureStoreFile(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  try {
    await writeFile(filePath, `${JSON.stringify(EMPTY_STORE, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  await chmod(filePath, 0o600).catch(() => {});
}

export async function readTaskSessionFile(filePath: string): Promise<TaskSessionStore> {
  return readExisting(filePath);
}

export async function bindTaskSessionFile(
  filePath: string,
  input: { taskId: string; sessionId: string; now?: string },
): Promise<TaskSessionStore> {
  await ensureStoreFile(filePath);
  const release = await lockfile.lock(filePath, {
    realpath: false,
    stale: 30_000,
    retries: { retries: 8, factor: 1.4, minTimeout: 10, maxTimeout: 120 },
  });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const current = await readExisting(filePath);
    const next = bindTaskSessionRecord(current, input);
    if (next === current) return current;
    await copyFile(filePath, `${filePath}.bak`);
    await writeFile(temporary, `${JSON.stringify({ ...next, updated_at: input.now || new Date().toISOString() }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, filePath);
    await chmod(filePath, 0o600).catch(() => {});
    return next;
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
    await release();
  }
}
