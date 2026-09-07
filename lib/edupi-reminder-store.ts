import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import lockfile from "proper-lockfile";
import type { EduPiCompletionSnapshot } from "./edupi-completion-monitor";

export type Reminder = { id: string; taskId: string; title: string; kind: "ready" | "failed"; identity: string; createdAt: string; read: boolean; handled: boolean; snoozedUntil: string | null };
type Store = { version: 1; items: Reminder[] };
export async function updateReminderStore(file: string, snapshot: EduPiCompletionSnapshot, action?: { id: string; type: "read" | "handled" | "snooze" }, now = Date.now()): Promise<Store> {
  await mkdir(dirname(file), { recursive: true });
  const release = await lockfile.lock(dirname(file), { lockfilePath: `${file}.lock`, retries: 5 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    let state: Store = { version: 1, items: [] };
    try { state = JSON.parse(await readFile(file, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (state.version !== 1 || !Array.isArray(state.items)) throw new Error("提醒记录无法读取");
    for (const item of Object.values(snapshot)) {
      if (!item.completion || state.items.some(record => record.taskId === item.taskId && record.identity === item.identity)) continue;
      state.items.push({ id: randomUUID(), taskId: item.taskId, title: item.title, kind: item.completion, identity: item.identity, createdAt: new Date(now).toISOString(), read: false, handled: false, snoozedUntil: null });
    }
    if (action) {
      const item = state.items.find(item => item.id === action.id);
      if (!item) throw new Error("提醒不存在");
      if (action.type === "read") item.read = true;
      if (action.type === "handled") { item.handled = true; item.read = true; }
      if (action.type === "snooze") { item.snoozedUntil = new Date(now + 60 * 60_000).toISOString(); item.read = true; }
    }
    for (const item of state.items) if (item.snoozedUntil && Date.parse(item.snoozedUntil) <= now) { item.snoozedUntil = null; if (!item.handled) item.read = false; }
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
    await rename(temporary, file);
    return state;
  } finally { await rm(temporary, { force: true }); await release(); }
}
