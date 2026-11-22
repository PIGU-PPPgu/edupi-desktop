import { educationWriteHeaders } from "./edupi-education-client";
import type { SessionInfo } from "./types";

export async function mutateSession(
  session: SessionInfo,
  change: { name: string } | null,
  fetcher: typeof fetch = fetch,
): Promise<"applied" | "pending"> {
  if (session.cwd.startsWith("cloud:") && !session.cloudScope) {
    throw new Error("请刷新对话列表后再操作。");
  }
  const response = await fetcher(`/api/sessions/${encodeURIComponent(session.id)}`, {
    method: change ? "PATCH" : "DELETE",
    headers: educationWriteHeaders(change ? { "Content-Type": "application/json" } : {}, session.cloudScope ?? "local"),
    ...(change ? { body: JSON.stringify(change) } : {}),
  });
  const result = await response.json().catch(() => ({})) as {
    ok?: boolean; queued?: boolean; pendingSync?: boolean; error?: string;
  };
  if (!response.ok || result.error) throw new Error(result.error || `操作失败（HTTP ${response.status}）。`);
  if (result.pendingSync || result.queued) return "pending";
  if (result.ok !== true || response.status === 202) throw new Error("操作结果尚未确认，请刷新后核对。");
  return "applied";
}
