export type TaskSessionStatus = "running" | "idle" | "missing";

export type StoredTaskSessionBinding = {
  task_id: string;
  session_id: string;
  bound_at: string;
};

export type TaskSessionStore = {
  schema_version: 1;
  bindings: StoredTaskSessionBinding[];
};

export type TaskSessionBinding = {
  taskId: string;
  sessionId: string;
  boundAt: string;
  status: TaskSessionStatus;
};

type ProjectionContext = {
  taskIds: ReadonlySet<string>;
  knownSessionIds: ReadonlySet<string>;
  runningSessionIds: ReadonlySet<string>;
};

const ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

function safeId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 240 && ID_PATTERN.test(value) ? value : null;
}

function safeTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizeTaskSessionStore(value: unknown): TaskSessionStore {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const source = Array.isArray(raw.bindings) ? raw.bindings : [];
  const byTask = new Map<string, StoredTaskSessionBinding>();
  const claimedSessions = new Set<string>();

  for (const item of source) {
    const record = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
    const taskId = safeId(record.task_id);
    const sessionId = safeId(record.session_id);
    const boundAt = safeTimestamp(record.bound_at);
    if (!taskId || !sessionId || !boundAt || byTask.has(taskId) || claimedSessions.has(sessionId)) continue;
    byTask.set(taskId, { task_id: taskId, session_id: sessionId, bound_at: boundAt });
    claimedSessions.add(sessionId);
  }

  return { schema_version: 1, bindings: [...byTask.values()] };
}

export function bindTaskSessionRecord(
  value: unknown,
  input: { taskId: string; sessionId: string; now?: string },
): TaskSessionStore {
  const taskId = safeId(input.taskId);
  const sessionId = safeId(input.sessionId);
  const now = safeTimestamp(input.now || new Date().toISOString());
  if (!taskId) throw new Error("taskId 无效或为空");
  if (!sessionId) throw new Error("sessionId 无效或为空");
  if (!now) throw new Error("绑定时间无效");

  const current = normalizeTaskSessionStore(value);
  const conflict = current.bindings.find((binding) => binding.session_id === sessionId && binding.task_id !== taskId);
  if (conflict) throw new Error(`Session ${sessionId} 已经绑定到其他教学任务`);
  const existing = current.bindings.find((binding) => binding.task_id === taskId);
  if (existing?.session_id === sessionId) return current;

  return {
    schema_version: 1,
    bindings: [
      ...current.bindings.filter((binding) => binding.task_id !== taskId),
      { task_id: taskId, session_id: sessionId, bound_at: now },
    ].sort((left, right) => left.task_id.localeCompare(right.task_id)),
  };
}

export function projectTaskSessionBindings(value: unknown, context: ProjectionContext): Record<string, TaskSessionBinding> {
  const projected: Record<string, TaskSessionBinding> = {};
  for (const binding of normalizeTaskSessionStore(value).bindings) {
    if (!context.taskIds.has(binding.task_id)) continue;
    const status: TaskSessionStatus = context.runningSessionIds.has(binding.session_id)
      ? "running"
      : context.knownSessionIds.has(binding.session_id)
        ? "idle"
        : "missing";
    projected[binding.task_id] = {
      taskId: binding.task_id,
      sessionId: binding.session_id,
      boundAt: binding.bound_at,
      status,
    };
  }
  return projected;
}
