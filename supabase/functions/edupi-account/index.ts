import {
  ApiError,
  handleOptions,
  json,
  readJson,
  requireUser,
  respondError,
} from "../_shared/http.ts";

function text(value: unknown, max = 240): string | null {
  return typeof value === "string" && value.trim() && value.length <= max ? value.trim() : null;
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  try {
    const context = await requireUser(request);
    if (request.method === "GET") {
      const { data, error } = await context.db
        .from("workspaces")
        .select("id,mode,owner_account_id,created_at,updated_at")
        .order("created_at", { ascending: true });
      if (error) throw new ApiError(503, "account_unavailable", "工作区暂不可用");
      return json({ ok: true, workspaces: data || [], external_send: false });
    }
    if (request.method !== "POST") return json({ error: "method_not_allowed", code: "method_not_allowed" }, 405);
    const body = await readJson(request, 32 * 1024);
    const action = text(body.action, 40);
    if (action === "create_workspace") {
      const requestId = text(body.request_id, 240);
      const mode = body.mode === undefined ? "cloud" : body.mode;
      if (!requestId || (mode !== "cloud" && mode !== "local")) {
        throw new ApiError(400, "invalid_workspace_request", "工作区创建请求无效");
      }
      const { data, error } = await context.db.rpc("create_workspace", {
        p_request_id: requestId,
        p_mode: mode,
      });
      if (error) throw new ApiError(503, "account_unavailable", "工作区创建失败");
      const status = data && typeof data === "object" && !Array.isArray(data) && data.replayed === true ? 200 : 201;
      return json(data, status);
    }
    if (action === "revoke_member") {
      const workspaceId = text(body.workspace_id, 64);
      const targetAccount = text(body.target_account, 64);
      const requestId = text(body.request_id, 240);
      if (!workspaceId || !targetAccount || !requestId) {
        throw new ApiError(400, "invalid_workspace_request", "成员撤销请求无效");
      }
      const { data, error } = await context.db.rpc("revoke_workspace_member", {
        target_workspace: workspaceId,
        target_account: targetAccount,
        p_request_id: requestId,
      });
      if (error) {
        if (error.message?.includes("workspace_forbidden")) {
          throw new ApiError(403, "workspace_forbidden", "没有工作区管理权限");
        }
        throw new ApiError(503, "account_unavailable", "成员撤销失败");
      }
      return json(data);
    }
    throw new ApiError(400, "invalid_workspace_request", "不支持的账户操作");
  } catch (error) {
    return respondError(error);
  }
});
