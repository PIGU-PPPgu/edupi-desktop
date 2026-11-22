import { ApiError, handleOptions, json, readJson, requireWorkspaceAdmin, respondError } from "../_shared/http.ts";
import { verifyHostClassroomComputation } from "./compute.ts";

type Row = Record<string, unknown>;
type Database = { rpc(name: string, args: Row): PromiseLike<{ data: unknown; error: { message?: string } | null }> };
type Dependencies = { context(request: Request): Promise<{ adminDb: Database; workspaceId: string; user: { id: string } }> };
const domains = new Set(["grades", "seating", "duty"]);
const reads = new Set(["roster", "list", "read"]);
const writes = new Set(["save", "restore", "publish"]);
const text = (value: unknown, max: number) => typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);

export async function handleClassroomRequest(request: Request, deps: Dependencies = { context: requireWorkspaceAdmin }): Promise<Response> {
  const options = handleOptions(request);
  if (options) return options;
  try {
    if (request.method !== "POST") throw new ApiError(405, "method_not_allowed", "请求方式无效");
    const body = await readJson(request, 2 * 1024 * 1024);
    if (!domains.has(String(body.domain)) || !reads.has(String(body.action)) && !writes.has(String(body.action))
      || !text(body.request_id, 240)
      || Object.keys(body).some(key => !["domain", "action", "id", "expected_revision", "revision", "input", "request_id", "computed", "source_request"].includes(key))
      || request.headers.has("idempotency-key") && request.headers.get("idempotency-key") !== body.request_id) {
      throw new ApiError(400, body.action === "preview" ? "host_compute_required" : "invalid_request", "请通过已连接 Core 的主机计算班级方案。");
    }
    if (writes.has(String(body.action)) && (!text(body.id, 120) || !Number.isSafeInteger(body.expected_revision)
      || Number(body.expected_revision) < 0 || !body.computed || !body.source_request)) {
      throw new ApiError(400, "compute_required", "保存前必须由主机完成计算。");
    }
    const { adminDb, workspaceId, user } = await deps.context(request);
    if (writes.has(String(body.action))) {
      if (!verifyHostClassroomComputation(body)) throw new ApiError(400, "compute_required", "计算结果与固定 Core 引擎不一致，未保存方案。");
      const admission = await adminDb.rpc("admit_classroom_computation", {
        target_workspace: workspaceId, actor_id: user.id, classroom_request: body,
      });
      if (admission.error) {
        if (admission.error.message?.includes("workspace_forbidden")) throw new ApiError(403, "workspace_forbidden", "没有工作区权限。");
        if (admission.error.message?.includes("idempotency_conflict")) throw new ApiError(409, "idempotency_conflict", "同一请求的账号或内容不同，原请求已保留。");
        if (admission.error.message?.includes("invalid_request")) throw new ApiError(400, "invalid_request", "班级请求身份无效。");
        throw new ApiError(503, "classroom_unavailable", "云端计算准入暂不可用，原请求已保留。");
      }
    }
    const { data, error } = await adminDb.rpc(reads.has(String(body.action)) ? "cloud_classroom_read" : "mutate_classroom_object", {
      target_workspace: workspaceId, actor_id: user.id, classroom_request: body,
    });
    if (error) {
      const code = error.message || "";
      if (code.includes("workspace_forbidden")) throw new ApiError(403, "workspace_forbidden", "没有工作区权限。");
      const conflict = ["stale_revision", "stale_roster", "stale_reference", "idempotency_conflict", "restore_changed", "task_conflict", "linked_identity", "already_published"].find(item => code.includes(item));
      if (conflict) throw new ApiError(409, conflict, "方案、名单或关联任务已变化，原请求已保留，请核对。");
      if (code.includes("not_found")) throw new ApiError(404, "not_found", "方案或历史版本不存在。");
      if (code.includes("invalid_") || code.includes("compute_required")) throw new ApiError(400, "compute_required", "班级计算或学生身份未通过核对。");
      throw new ApiError(503, "classroom_unavailable", "班级方案暂不可用。");
    }
    return json(data);
  } catch (error) { return respondError(error); }
}
if (import.meta.main) Deno.serve(request => handleClassroomRequest(request));
