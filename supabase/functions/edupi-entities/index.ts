import { ApiError, handleOptions, json, readJson, requireWorkspaceAdmin, respondError } from "../_shared/http.ts";
import { CLOUD_SYNC_CONTRACT } from "../_shared/cloud-contract.ts";

const ACTIONS = new Set(["list", "read", "delete", "restore"]);
const KEYS = new Set(["action", "kind", "id", "request_id", "expected_fingerprint", "tombstone_revision", "note"]);

export async function entities(request: Request): Promise<Response> {
  const options = handleOptions(request);
  if (options) return options;
  try {
    if (request.method !== "POST") return json({ code: "method_not_allowed" }, 405);
    const body = await readJson(request, 8 * 1024);
    if (!ACTIONS.has(String(body.action)) || Object.keys(body).some(key => !KEYS.has(key))) {
      throw new ApiError(400, "invalid_request", "对象操作请求无效。");
    }
    const context = await requireWorkspaceAdmin(request);
    const { data, error } = await context.adminDb.rpc("cloud_entity_transition", {
      target_workspace: context.workspaceId, actor_id: context.user.id, entity_request: body,
    });
    if (error) {
      const message = error.message || "";
      if (message.includes("workspace_forbidden")) throw new ApiError(403, "workspace_forbidden", "没有工作区权限。");
      const missing = ["target_not_found", "target_not_deleted"].find(code => message.includes(code));
      if (missing) throw new ApiError(404, missing, "对象已不可用。");
      const conflict = ["idempotency_conflict", "stale_tombstone", "target_changed", "ambiguous_entity"].find(code => message.includes(code));
      if (conflict) throw new ApiError(409, conflict, "对象已改变，请重新打开后核对。");
      if (message.includes("invalid_")) throw new ApiError(400, "invalid_request", "对象操作请求无效。");
      throw new ApiError(503, "entities_unavailable", "对象操作暂不可用。");
    }
    return json({ ...(data as Record<string, unknown>), contract: CLOUD_SYNC_CONTRACT });
  } catch (error) { return respondError(error); }
}
Deno.serve(entities);
