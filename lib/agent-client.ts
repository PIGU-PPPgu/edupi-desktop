// Client-side helper for POST /api/agent/[id].
//
// Every /api/agent/[id] route returns one of:
//   { success: true, data: <result> }
//   { error: string }              (non-2xx)
//
// Call sites previously repeated the same 5-line fetch block 13× in
// hooks/useAgentSession.ts. This helper collapses that down to one line.

import { educationWriteHeaders } from "./edupi-education-client";
export { educationWriteHeaders } from "./edupi-education-client";

export class AgentCommandPendingError extends Error {
  readonly code = "pending_sync";
  constructor() {
    super("已保存，联网后同步。");
    this.name = "AgentCommandPendingError";
  }
}

export async function sendAgentCommand<T = unknown>(
  sessionId: string,
  command: Record<string, unknown>,
  scope?: string | null,
): Promise<T> {
  const res = await fetch(`/api/agent/${encodeURIComponent(sessionId)}`, {
    method: "POST",
    headers: educationWriteHeaders({ "Content-Type": "application/json" }, scope),
    body: JSON.stringify(command),
  });
  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: T;
    error?: string;
    pendingSync?: boolean;
    queued?: boolean;
  };
  if (!res.ok || body.error) {
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  if (body.pendingSync || body.queued) throw new AgentCommandPendingError();
  return body.data as T;
}
