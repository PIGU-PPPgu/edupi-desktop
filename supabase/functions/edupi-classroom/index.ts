import {
  ApiError,
  handleOptions,
  json,
  readJson,
  requestId,
  requireWorkspaceAdmin,
  respondError,
} from "../_shared/http.ts";

const DOMAINS = new Set(["grades", "seating", "duty"]);
const ACTIONS = new Set(["roster", "list", "read", "preview", "save", "restore", "publish"]);

function text(value: unknown, max = 240): string | null {
  return typeof value === "string" && value.trim() && value.length <= max ? value.trim() : null;
}

async function classroom(request: Request): Promise<Response> {
  const body = await readJson(request, 2 * 1024 * 1024);
  const { db, adminDb, workspaceId, user } = await requireWorkspaceAdmin(request);
  if (!DOMAINS.has(String(body.domain)) || !ACTIONS.has(String(body.action))) {
    throw new ApiError(400, "invalid_request", "班级操作无效");
  }
  const domain = String(body.domain);
  const action = String(body.action);
  const requestIdValue = requestId(request, body);
  if (action === "roster") {
    const { data, error } = await db.from("student_profiles")
      .select("student_id,name,class_name,profile")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .order("class_name", { ascending: true })
      .order("name", { ascending: true });
    if (error) throw new ApiError(503, "classroom_unavailable", "班级名单暂不可用");
    return json({ ok: true, operation: "classroom", request_id: requestIdValue, external_send: false, students: data || [] });
  }
  if (action === "list") {
    const { data, error } = await db.from("classroom_objects")
      .select("object_id,domain,revision,updated_at,input,task_id")
      .eq("workspace_id", workspaceId)
      .eq("domain", domain)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false });
    if (error) throw new ApiError(503, "classroom_unavailable", "班级方案暂不可用");
    const records = (data || []).map((record) => {
      const input = record.input && typeof record.input === "object" ? record.input as Record<string, unknown> : {};
      return {
        id: record.object_id,
        domain: record.domain,
        title: typeof input.title === "string" ? input.title : record.object_id,
        class_name: typeof input.class_name === "string" ? input.class_name : "",
        revision: record.revision,
        updated_at: record.updated_at,
        date: typeof input.date === "string" ? input.date : null,
        mode: typeof input.mode === "string" ? input.mode : null,
        task_id: record.task_id,
      };
    });
    return json({ ok: true, operation: "classroom", request_id: requestIdValue, external_send: false, records });
  }
  const id = text(body.id, 240);
  if (!id) throw new ApiError(400, "invalid_request", "id 无效");
  if (action === "read") {
    const { data, error } = await db.from("classroom_objects")
      .select("object_id,domain,revision,created_at,updated_at,input,result,issues,versions,task_id,publication")
      .eq("workspace_id", workspaceId)
      .eq("object_id", id)
      .eq("domain", domain)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new ApiError(503, "classroom_unavailable", "班级方案暂不可用");
    if (!data) throw new ApiError(404, "not_found", "方案不存在");
    return json({ ok: true, operation: "classroom", request_id: requestIdValue, external_send: false, record: {
      id: data.object_id,
      domain: data.domain,
      revision: data.revision,
      created_at: data.created_at,
      updated_at: data.updated_at,
      input: data.input,
      result: data.result,
      issues: data.issues,
      versions: data.versions,
      task_id: data.task_id,
      publication: data.publication,
    } });
  }
  const { data, error } = await adminDb.rpc("mutate_classroom_object", {
    target_workspace: workspaceId,
    actor_id: user.id,
    classroom_request: {
      ...body,
      request_id: requestIdValue,
    },
  });
  if (error) {
    const message = error.message || "";
    if (message.includes("stale_revision")) throw new ApiError(409, "stale_revision", "方案已更新，请重新打开");
    if (message.includes("not_found") || message.includes("version_not_found")) throw new ApiError(404, "not_found", "方案不存在");
    if (message.includes("invalid_")) throw new ApiError(400, "invalid_request", "班级操作无效");
    throw new ApiError(503, "classroom_unavailable", "班级方案暂不可用");
  }
  return json(data);
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  try {
    if (request.method !== "POST") return json({ error: "method_not_allowed", code: "method_not_allowed" }, 405);
    return await classroom(request);
  } catch (error) {
    return respondError(error);
  }
});
