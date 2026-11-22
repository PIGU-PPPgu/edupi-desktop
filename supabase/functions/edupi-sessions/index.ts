import { ApiError, handleOptions, json, readJson, requireWorkspaceAdmin, respondError } from "../_shared/http.ts";
import { CLOUD_SYNC_CONTRACT } from "../_shared/cloud-contract.ts";

const ACTIONS = new Set(["list", "create", "read", "rename", "delete", "enqueue",
  "events", "claim", "running", "append", "complete", "recover", "fail", "configure", "cancel"]);
const KEYS = new Set(["action", "session_id", "request_id", "title", "model",
  "thinking_level", "command", "after", "runtime", "events", "message", "uncertain", "error_code", "expected_revision"]);
const text = (value: unknown, max: number) =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);

export async function sessions(request: Request): Promise<Response> {
  const options = handleOptions(request);
  if (options) return options;
  try {
    if (request.method !== "POST") return json({ code: "method_not_allowed" }, 405);
    const body = await readJson(request, 1024 * 1024);
    if (!ACTIONS.has(String(body.action)) || Object.keys(body).some(key => !KEYS.has(key))
      || body.session_id !== undefined && !text(body.session_id, 160)
      || body.request_id !== undefined && !text(body.request_id, 160)
      || body.after !== undefined && (!Number.isSafeInteger(body.after) || Number(body.after) < 0)) {
      throw new ApiError(400, "invalid_request", "云端会话请求无效。");
    }
    const context = await requireWorkspaceAdmin(request);
    const { data, error } = await context.adminDb.rpc("cloud_chat_transition", {
      target_workspace: context.workspaceId,
      actor_id: context.user.id,
      chat_request: body,
    });
    if (error) {
      const message = error.message || "";
      if (message.includes("workspace_forbidden")) throw new ApiError(403, "workspace_forbidden", "没有工作区权限。");
      if (message.includes("session_not_found")) throw new ApiError(404, "session_not_found", "云端会话不存在。");
      if (["runtime_fenced", "idempotency_conflict", "chat_request_changed"].some(code => message.includes(code))) {
        throw new ApiError(409, message.includes("runtime_fenced") ? "runtime_fenced"
          : message.includes("idempotency_conflict") ? "idempotency_conflict" : "chat_request_changed", "会话状态已改变，记录已保留。");
      }
      if (message.includes("invalid_")) throw new ApiError(400, "invalid_request", "云端会话请求无效。");
      throw new ApiError(503, "sessions_unavailable", "云端会话暂不可用。");
    }
    return json({ ...(data as Record<string, unknown>), contract: CLOUD_SYNC_CONTRACT });
  } catch (error) { return respondError(error); }
}
Deno.serve(sessions);
