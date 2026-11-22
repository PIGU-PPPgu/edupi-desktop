import type { AgentMessage, SessionInfo } from "./types";
import { EduPiCloudError, type CloudScope } from "./edupi-cloud-client";
import { cloudScopeKey } from "./edupi-cloud-request-scope";

type ObjectValue = Record<string, unknown>;
export const chatRecord = (value: unknown): ObjectValue =>
  value && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
const invalid = (): never => { throw new EduPiCloudError("invalid_response", "云端会话内容无效。", 502); };
const timestamp = (value: unknown) => {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return invalid();
  return value;
};
export function cloudChatInfo(raw: unknown, scope: CloudScope, messages: ObjectValue[] = []): SessionInfo {
  const session = chatRecord(raw);
  if (session.workspace_id !== scope.workspaceId || typeof session.session_id !== "string") return invalid();
  const first = chatRecord(messages.find(item => item.role === "user")?.message).content;
  return {
    id: session.session_id, path: `cloud:${scope.workspaceId}/${session.session_id}`,
    cwd: `cloud:${scope.workspaceId}`, projectRoot: `cloud:${scope.workspaceId}`,
    cloudScope: cloudScopeKey(scope),
    name: typeof session.title === "string" && session.title ? session.title : undefined,
    created: timestamp(session.created_at), modified: timestamp(session.updated_at),
    messageCount: messages.length || Number(session.message_count || 0),
    firstMessage: typeof first === "string" ? first : typeof session.title === "string" ? session.title : "",
  };
}
export function cloudChatData(response: ObjectValue, scope: CloudScope) {
  if (response.workspace_id !== scope.workspaceId || !Array.isArray(response.messages)) return invalid();
  const rows = response.messages.map(chatRecord);
  const messages: AgentMessage[] = rows.map(row => {
    const message = chatRecord(row.message);
    if (message.role !== "user" && message.role !== "assistant") return invalid();
    if (message.role === "user" && typeof message.content !== "string") return invalid();
    if (message.role === "assistant" && (!Array.isArray(message.content)
      || message.content.some(block => chatRecord(block).type !== "text" || typeof chatRecord(block).text !== "string"))) return invalid();
    return message as unknown as AgentMessage;
  });
  const info = cloudChatInfo(response.session, scope, rows);
  return {
    sessionId: info.id, filePath: info.path, info, cloudScope: cloudScopeKey(scope),
    leafId: rows.at(-1)?.message_id ?? null, tree: [],
    context: {
      messages, entryIds: rows.map(row => String(row.message_id)),
      thinkingLevel: String(chatRecord(response.session).thinking_level || "off"),
      model: chatRecord(response.session).model ?? null,
    },
    requests: response.requests,
  };
}
export function cloudChatAgentState(response: ObjectValue) {
  const requests = Array.isArray(response.requests) ? response.requests.map(chatRecord) : [];
  const active = requests.find(item => ["queued", "claimed", "running"].includes(String(item.status)));
  const session = chatRecord(response.session);
  return {
    running: Boolean(active),
    state: {
      sessionId: session.session_id, isStreaming: Boolean(active), isPromptRunning: Boolean(active),
      isBashRunning: false, isCompacting: false, clientRequestId: active?.request_id ?? null,
      model: session.model ?? null, thinkingLevel: session.thinking_level || "off", accessMode: "approval",
      queuedMessages: { steering: [], followUp: [] }, extensionStatuses: [], extensionWidgets: [],
      cloudStatus: active?.status ?? "idle",
    },
  };
}
