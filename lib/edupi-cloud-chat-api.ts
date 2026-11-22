import { randomUUID, createHash } from "node:crypto";
import { parseJsonWithinLimit } from "./bounded-form-data";
import { createEduPiCloudClient, EduPiCloudError, type CloudScope } from "./edupi-cloud-client";
import { captureEducationWriteScope, cloudScopeKey } from "./edupi-cloud-request-scope";
import { chatRecord, cloudChatData, cloudChatInfo, cloudChatAgentState } from "./edupi-cloud-chat-projection";
import { hasJsonContentType, isApiRequestAllowed } from "./request-security";

type Client = ReturnType<typeof createEduPiCloudClient>;
type ObjectValue = Record<string, unknown>;
type Dependencies = { client?: Client; pump?: (client: Client, scope: CloudScope) => void };
function kick(client: Client, scope: CloudScope) {
  void import("./edupi-cloud-chat-worker").then(module => module.ensureCloudChatWorker(client, scope)).catch(() => {});
}
function prompt(body: ObjectValue) {
  if (!["prompt", "steer", "follow_up", "mobile_prompt"].includes(String(body.type))
    || typeof body.message !== "string" || !body.message.trim() || body.message.length > 64_000
    || body.images !== undefined && (!Array.isArray(body.images) || body.images.length > 0)) {
    throw new EduPiCloudError("invalid_request", "云端对话消息无效；当前仅支持文字。", 400);
  }
  return {
    type: String(body.type), message: body.message,
    clientRequestId: typeof body.clientRequestId === "string" ? body.clientRequestId : undefined,
  };
}
async function enqueue(client: Client, scope: CloudScope, id: string, body: ObjectValue) {
  const command = prompt(body);
  const rid = command.clientRequestId || `cloud-prompt-${randomUUID()}`;
  const result = await client.operationWithOutbox("sessions", {
    action: "enqueue", session_id: id, request_id: rid,
    command: { ...command, clientRequestId: rid },
  }, scope);
  return { success: true, data: null, queued: result.queued, clientRequestId: rid };
}
const escapeHtml = (value: string) => value.replace(/[&<>"']/gu, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
function messageText(value: unknown): string {
  const message = chatRecord(value);
  return typeof message.content === "string" ? message.content : Array.isArray(message.content)
    ? message.content.map(block => String(chatRecord(block).text || "")).join("\n") : "";
}

export async function cloudChatApi(request: Request, parts: string[], dependencies: Dependencies = {}): Promise<Response> {
  const json = (value: unknown, status = 200) => Response.json(value, {
    status, headers: { "Cache-Control": "no-store, private" },
  });
  if (!isApiRequestAllowed(request)) return json({ error: "请求被拒绝。", code: "forbidden" }, 403);
  try {
    const client = dependencies.client || createEduPiCloudClient();
    const selected = request.method === "GET" ? null : await captureEducationWriteScope(request, client);
    if (selected && (selected.mode !== "cloud" || !selected.scope)) {
      throw new EduPiCloudError("scope_changed", "数据模式已改变。", 409);
    }
    const scope = selected?.scope || await client.captureScope();
    const expectedReadScope = request.method === "GET"
      ? request.headers.get("x-edupi-cloud-scope") ?? new URL(request.url).searchParams.get("cloudScope") : null;
    if (expectedReadScope !== null && expectedReadScope !== cloudScopeKey(scope)) {
      throw new EduPiCloudError("scope_changed", "会话工作区已改变，请刷新后重试。", 409);
    }
    const pump = dependencies.pump || kick;
    const [group, id, suffix] = parts;
    if (request.method === "GET") {
      if (group === "sessions" && !id || group === "agent" && id === "running") {
        if (suffix === "events") return cloudRunningEvents(request, client, scope, pump);
        const response = await client.operation("sessions", { action: "list" }, scope);
        pump(client, scope);
        const rows = Array.isArray(response.sessions) ? response.sessions.map(chatRecord) : [];
        const sessions = rows.filter(row => Number(row.message_count) > 0).map(raw => cloudChatInfo(raw, scope));
        return json({ sessions, runningSessionIds: rows.filter(row => row.running === true).map(row => row.session_id) });
      }
      if ((group === "sessions" || group === "agent") && id) {
        if (suffix === "events") return cloudChatEvents(request, client, scope, id, pump);
        const response = await client.operation("sessions", { action: "read", session_id: id }, scope);
        pump(client, scope);
        if (group === "agent" || suffix === "state") return json(cloudChatAgentState(response));
        const data = cloudChatData(response, scope);
        if (chatRecord(response.session).deleted_at) throw new EduPiCloudError("session_not_found", "会话已删除。", 404);
        if (suffix === "context") return json({ context: data.context });
        if (suffix === "export") return new Response(`<!doctype html><meta charset="utf-8"><title>${escapeHtml(data.info.name || "EduPi")}</title>${
          data.context.messages.map(message => `<article><b>${escapeHtml(message.role)}</b><pre>${escapeHtml(messageText(message))}</pre></article>`).join("")
        }`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
        return json(data);
      }
    }
    if (["POST", "PATCH", "DELETE"].includes(request.method) && request.method !== "DELETE" && !hasJsonContentType(request)) {
      return json({ error: "请使用 JSON。", code: "invalid_content_type" }, 415);
    }
    const body = request.method === "DELETE" ? {} : chatRecord(await parseJsonWithinLimit(request, 128 * 1024));
    if (group === "agent" && id === "new" && request.method === "POST") {
      const sourceId = typeof body.clientRequestId === "string" ? body.clientRequestId : randomUUID();
      const sessionId = `cloud-${createHash("sha256").update(JSON.stringify([scope.workspaceId, scope.accountId, sourceId])).digest("hex").slice(0, 40)}`;
      const model = typeof body.provider === "string" && typeof body.modelId === "string"
        ? { provider: body.provider, modelId: body.modelId } : null;
      const created = await client.operationWithOutbox("sessions", {
        action: "create", session_id: sessionId, request_id: `create-${sessionId}`,
        title: "", model, thinking_level: typeof body.thinkingLevel === "string" ? body.thinkingLevel : "off",
      }, scope);
      let result: ObjectValue = { success: true, data: null };
      if (body.type !== "ensure_session") result = await enqueue(client, scope, sessionId, body);
      pump(client, scope);
      const queued = created.queued || result.queued === true;
      return json({ ...result, queued, pendingSync: queued, sessionId, model,
        thinkingLevel: body.thinkingLevel || "off" }, queued ? 202 : 200);
    }
    if (group === "agent" && id && request.method === "POST") {
      if (["prompt", "steer", "follow_up", "mobile_prompt"].includes(String(body.type))) {
        const result = await enqueue(client, scope, id, body);
        pump(client, scope);
        return json({ ...result, pendingSync: result.queued }, result.queued ? 202 : 200);
      }
      if (body.type === "get_state") return json({ success: true, data:
        cloudChatAgentState(await client.operation("sessions", { action: "read", session_id: id }, scope)).state });
      if (["get_tools", "get_commands", "get_extensions"].includes(String(body.type))) return json({ success: true, data: [] });
      if (body.type === "persist_session") return json({ success: true, data: null });
      if (body.type === "set_tools" || body.type === "set_permission_mode") {
        throw new EduPiCloudError("cloud_tools_disabled", "云端对话仅支持文字，本机工具保持关闭。", 409);
      }
      if (body.type === "abort") {
        const result = await client.operationWithOutbox("sessions", { action: "cancel", session_id: id, request_id: `cancel-${randomUUID()}` }, scope);
        return json({ success: !result.queued, data: null, queued: result.queued, pendingSync: result.queued }, result.queued ? 202 : 200);
      }
      if (["set_model", "set_thinking_level"].includes(String(body.type))) {
        const current = await client.operation("sessions", { action: "read", session_id: id }, scope);
        const result = await client.operationWithOutbox("sessions", {
          action: "configure", session_id: id, request_id: `configure-${randomUUID()}`,
          expected_revision: chatRecord(current.session).revision,
          ...(body.type === "set_model" ? { model: { provider: body.provider, modelId: body.modelId } }
            : { thinking_level: body.level }),
        }, scope);
        return json({ success: !result.queued, data: null, queued: result.queued, pendingSync: result.queued }, result.queued ? 202 : 200);
      }
      throw new EduPiCloudError("unsupported_cloud_operation", "此会话操作尚未支持云端。", 409);
    }
    if (group === "sessions" && id && (request.method === "PATCH" || request.method === "DELETE")) {
      const current = request.method === "PATCH" ? await client.operation("sessions", { action: "read", session_id: id }, scope) : null;
      const result = await client.operationWithOutbox("sessions", {
        action: request.method === "PATCH" ? "rename" : "delete", session_id: id,
        request_id: `${request.method.toLowerCase()}-${randomUUID()}`,
        ...(request.method === "PATCH" ? { title: body.name, expected_revision: chatRecord(current?.session).revision } : {}),
      }, scope);
      return json({ ok: !result.queued, queued: result.queued, pendingSync: result.queued }, result.queued ? 202 : 200);
    }
    return json({ error: "云端会话接口不存在。", code: "not_found" }, 404);
  } catch (error) {
    return json({ error: error instanceof EduPiCloudError ? error.message : "云端会话暂不可用。",
      code: error instanceof EduPiCloudError ? error.code : "sessions_unavailable" },
    error instanceof EduPiCloudError ? error.status : 503);
  }
}

function cloudRunningEvents(request: Request, client: Client, scope: CloudScope,
  pump: (client: Client, scope: CloudScope) => void) {
  const encoder = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let timer: ReturnType<typeof setTimeout>;
      stop = () => {
        if (closed) return;
        closed = true; clearTimeout(timer);
        request.signal.removeEventListener("abort", stop);
        try { controller.close(); } catch { /* Consumer cancelled. */ }
      };
      request.signal.addEventListener("abort", stop, { once: true });
      const poll = async () => {
        try {
          const response = await client.operation("sessions", { action: "list" }, scope);
          if (closed) return;
          const rows = Array.isArray(response.sessions) ? response.sessions.map(chatRecord) : [];
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "running",
            runningSessionIds: rows.filter(row => row.running).map(row => row.session_id) })}\n\n`));
          pump(client, scope);
          timer = setTimeout(() => { void poll(); }, 2500);
        } catch { stop(); }
      };
      if (request.signal.aborted) stop(); else void poll();
    }, cancel() { stop(); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" } });
}

export function cloudChatEvents(request: Request, client: Client, scope: CloudScope, id: string,
  pump: (client: Client, scope: CloudScope) => void): Response {
  const query = new URL(request.url).searchParams;
  let cursor = Number(request.headers.get("last-event-id") || query.get("after") || 0);
  if (!Number.isSafeInteger(cursor) || cursor < 0) cursor = 0;
  const encoder = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const send = (value: unknown, eventId?: number) => {
        if (!closed) controller.enqueue(encoder.encode(`${eventId === undefined ? "" : `id: ${eventId}\n`}data: ${JSON.stringify(value)}\n\n`));
      };
      stop = () => {
        if (closed) return;
        closed = true;
        if (timer) clearTimeout(timer);
        request.signal.removeEventListener("abort", stop);
        try { controller.close(); } catch { /* Cancelled by the consumer. */ }
      };
      request.signal.addEventListener("abort", stop, { once: true });
      send({ type: "connected", sessionId: id });
      pump(client, scope);
      const poll = async () => {
        try {
          const response = await client.operation("sessions", { action: "events", session_id: id, after: cursor }, scope);
          if (closed) return;
          if (!Array.isArray(response.events)) throw new Error("invalid events");
          for (const raw of response.events) {
            const row = chatRecord(raw);
            if (!Number.isSafeInteger(row.event_id) || Number(row.event_id) <= cursor) continue;
            cursor = Number(row.event_id);
            send(row.event, cursor);
          }
          if (!closed) timer = setTimeout(() => { void poll(); }, response.events.length === 200 ? 0 : 1000);
        } catch {
          if (!closed) send({ type: "cloud_connection_lost", errorMessage: "云端连接已中断，消息已保留。" });
          stop();
        }
      };
      if (!request.signal.aborted) void poll(); else stop();
    },
    cancel() { stop(); },
  });
  return new Response(stream, { headers: {
    "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-store",
    Connection: "keep-alive", "X-Accel-Buffering": "no",
  } });
}
