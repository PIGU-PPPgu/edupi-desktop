import {
  ApiError,
  handleOptions,
  json,
  readJson,
  requireWorkspaceAdmin,
  respondError,
} from "../_shared/http.ts";

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  try {
    if (request.method !== "POST") return json({ error: "method_not_allowed", code: "method_not_allowed" }, 405);
    const body = await readJson(request, 64 * 1024);
    if (body.operation !== "runtime") {
      throw new ApiError(400, "invalid_runtime_request", "operation 必须是 runtime");
    }
    const context = await requireWorkspaceAdmin(request);
    const { data, error } = await context.adminDb.rpc("runtime_transition", {
      target_workspace: context.workspaceId,
      actor_id: context.user.id,
      runtime_request: body,
    });
    if (error) {
      const message = error.message || "";
      if (message.includes("workspace_forbidden")) {
        throw new ApiError(403, "workspace_forbidden", "没有工作区权限");
      }
      if (message.includes("runtime_fenced") || message.includes("lease_held") || message.includes("lease_invalid")) {
        throw new ApiError(409, "runtime_fenced", "Core Runtime 租约或 fencing generation 无效");
      }
      if (message.includes("invalid_")) {
        throw new ApiError(400, "invalid_runtime_request", "Core Runtime 请求无效");
      }
      throw new ApiError(503, "runtime_unavailable", "Core Runtime 暂不可用");
    }
    return json(data);
  } catch (error) {
    return respondError(error);
  }
});
