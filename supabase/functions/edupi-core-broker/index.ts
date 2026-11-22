import {
  ApiError,
  handleOptions,
  json,
  readJson,
  requireWorkspaceAdmin,
  respondError,
} from "../_shared/http.ts";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown, max = 240): string | null {
  return typeof value === "string" && value.trim() && value.length <= max ? value.trim() : null;
}

const FACT_KINDS = new Set(["error_pattern", "progress", "behavior", "general", "safety", "academic", "material", "evidence"]);
const MOBILE_DASHBOARD_CONTRACT = {
  contract_id: "edupi-mobile-dashboard-v1",
  contract_version: "1.0",
  schema_hash: "sha256:454a9b7b092faffd480b5e4c8380553279fe5d7102e9ca4b44cf9d599cd282d8",
} as const;

function rpcError(error: { message?: string } | null, fallbackCode: string, fallbackMessage: string): never {
  const message = error?.message || "";
  if (message.includes("workspace_forbidden")) throw new ApiError(403, "workspace_forbidden", "没有工作区权限");
  if (message.includes("stale_snapshot")) throw new ApiError(409, "stale_snapshot", "云端快照已更新，请刷新后重试");
  if (message.includes("stale_fact")) throw new ApiError(409, "stale_fact", "事实已更新，请刷新后重试");
  if (message.includes("stale_material_metadata")) throw new ApiError(409, "stale_material_metadata", "材料已更新，请刷新后重试");
  if (message.includes("stale_fact_spine")) throw new ApiError(409, "stale_fact_spine", "事实脊柱已更新，请刷新后重试");
  if (message.includes("stale_revision")) throw new ApiError(409, "stale_revision", "对象已更新，请刷新后重试");
  if (message.includes("idempotency_conflict")) throw new ApiError(409, "idempotency_conflict", "请求身份与先前操作冲突");
  if (message.includes("fact_conflict")) throw new ApiError(409, "fact_conflict", "事实与当前记录冲突");
  if (message.includes("task_missing") || message.includes("material_not_found")
    || message.includes("fact_not_found") || message.includes("version_not_found")
    || message.includes("not_found")) {
    throw new ApiError(404, "not_found", "对象不存在");
  }
  if (message.includes("lease_held") || message.includes("runtime_fenced") || message.includes("lease_invalid")) {
    throw new ApiError(409, "runtime_fenced", "Core Runtime 租约已被其他实例占用");
  }
  if (message.includes("invalid_fact_spine")) throw new ApiError(400, "invalid_fact_spine", "事实脊柱请求无效");
  if (message.includes("invalid_fact_request")) throw new ApiError(400, "invalid_fact_request", "事实操作请求无效");
  if (message.includes("invalid_review")) throw new ApiError(400, "invalid_review", "事实审核请求无效");
  if (message.includes("invalid_fact_state")) throw new ApiError(400, "invalid_fact_state", "事实状态无效");
  if (message.includes("invalid_") || message.includes("unsupported_command") || message.includes("stage_unchanged")) {
    throw new ApiError(400, fallbackCode, fallbackMessage);
  }
  throw new ApiError(503, fallbackCode, fallbackMessage);
}

async function educationFacts(
  body: Record<string, unknown>,
  context: Awaited<ReturnType<typeof requireWorkspaceAdmin>>,
): Promise<Response> {
  const action = text(body.action, 40);
  const requestId = text(body.request_id, 240);
  if (!action) throw new ApiError(400, "invalid_fact_request", "事实操作无效");

  if (action === "list_deleted") {
    const offset = Number.isInteger(body.offset) ? Number(body.offset) : 0;
    const limit = Number.isInteger(body.limit) ? Number(body.limit) : 100;
    if (offset < 0 || limit < 1 || limit > 100) {
      throw new ApiError(400, "invalid_fact_request", "分页参数无效");
    }
    const { data, error, count } = await context.db
      .from("facts")
      .select("*", { count: "exact" })
      .eq("workspace_id", context.workspaceId)
      .eq("status", "deleted")
      .order("updated_at", { ascending: true })
      .range(offset, offset + limit - 1);
    if (error) throw new ApiError(503, "fact_unavailable", "事实回收站暂不可用");
    const facts = (data || []).map((row) => {
      const value = row as Record<string, unknown>;
      const sourceIds = Array.isArray(value.source_ids) ? value.source_ids : [];
      const observationIds = Array.isArray(value.observation_ids) ? value.observation_ids : [];
      return {
        fact_id: value.fact_id,
        entity_id: value.entity_id,
        fact_kind: value.fact_kind,
        predicate: value.predicate,
        value: value.value,
        subject_ref: value.subject_ref ?? null,
        topic_ref: value.topic_ref ?? null,
        source_ids: sourceIds,
        source_count: sourceIds.length,
        observation_ids: observationIds,
        observation_count: observationIds.length,
        restore_conflicts: [],
        restore_conflict_count: 0,
        restore_mode: "direct",
        status: "deleted",
        deleted_previous_status: value.deleted_previous_status || "candidate",
        revision: value.revision,
        deleted_at: value.deleted_at,
        external_send: false,
      };
    });
    const total = count || 0;
    return json({
      ok: true,
      operation: "education-facts",
      request_id: requestId,
      action,
      total,
      offset,
      limit,
      next_offset: offset + facts.length < total ? offset + facts.length : null,
      facts,
      external_send: false,
    });
  }

  if (action === "read_spine") {
    const { data, error } = await context.db
      .from("fact_spine_snapshots")
      .select("revision,state_hash,spine")
      .eq("workspace_id", context.workspaceId)
      .order("revision", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new ApiError(503, "fact_unavailable", "事实脊柱暂不可用");
    return json({
      ok: true,
      operation: "education-facts",
      request_id: requestId,
      action,
      revision: data?.revision ?? 0,
      state_hash: data?.state_hash ?? null,
      spine: data?.spine ?? null,
      external_send: false,
    });
  }

  if (action === "replace_spine") {
    const spine = record(body.spine);
    const expectedStateHash = body.expected_state_hash === null ? null : text(body.expected_state_hash, 160);
    if (!requestId || !spine || spine.external_send !== false) {
      throw new ApiError(400, "invalid_fact_spine", "事实脊柱请求无效");
    }
    const { data, error } = await context.adminDb.rpc("replace_fact_spine", {
      target_workspace: context.workspaceId,
      actor_id: context.user.id,
      request_id_value: requestId,
      expected_state_hash: expectedStateHash,
      next_spine: spine,
    });
    if (error) rpcError(error, "fact_unavailable", "事实脊柱写入失败");
    return json(data);
  }

  if (action === "read") {
    const factId = text(body.fact_id, 160);
    if (!factId) throw new ApiError(400, "invalid_fact_request", "事实身份无效");
    const { data, error } = await context.db
      .from("facts")
      .select("*")
      .eq("workspace_id", context.workspaceId)
      .eq("fact_id", factId)
      .maybeSingle();
    if (error) throw new ApiError(503, "fact_unavailable", "事实暂不可用");
    if (!data) throw new ApiError(404, "fact_not_found", "事实不存在");
    return json({
      ok: true,
      operation: "education-facts",
      request_id: requestId,
      action,
      fact: data,
      external_send: false,
    });
  }

  if (action === "capture") {
    const factId = text(body.fact_id, 160);
    const entityId = text(body.entity_id, 160);
    const factKind = text(body.fact_kind, 40);
    const predicate = text(body.predicate, 160);
    const value = text(body.value, 4000);
    if (!requestId || !factId || !entityId || !factKind || !FACT_KINDS.has(factKind) || !predicate || !value) {
      throw new ApiError(400, "invalid_fact_request", "事实捕获请求无效");
    }
    const { data, error } = await context.adminDb.rpc("capture_education_fact", {
      target_workspace: context.workspaceId,
      actor_id: context.user.id,
      fact_request: body,
    });
    if (error) rpcError(error, "fact_unavailable", "事实写入失败");
    return json(data);
  }

  const { data, error } = await context.adminDb.rpc("mutate_education_fact", {
    target_workspace: context.workspaceId,
    actor_id: context.user.id,
    fact_request: body,
  });
  if (error) rpcError(error, "fact_unavailable", "事实写入失败");
  const result = record(data);
  if (!result) throw new ApiError(503, "fact_unavailable", "事实回执无效");
  delete result.fact_spine;
  return json(result);
}

async function materialMetadata(
  body: Record<string, unknown>,
  context: Awaited<ReturnType<typeof requireWorkspaceAdmin>>,
): Promise<Response> {
  const materialId = text(body.material_id, 160);
  if (!materialId) throw new ApiError(400, "invalid_request", "材料身份无效");

  if (body.operation === "workspace-resources") {
    const { data, error } = await context.db
      .from("material_versions")
      .select("version_id,material_id,revision,before_values,after_values,changed_fields,changed_at,source_kind,request_id")
      .eq("workspace_id", context.workspaceId)
      .eq("material_id", materialId)
      .order("revision", { ascending: true });
    if (error) throw new ApiError(503, "material_unavailable", "材料历史暂不可用");
    const { data: current, error: currentError } = await context.db
      .from("materials")
      .select("metadata_revision,metadata_history_count")
      .eq("workspace_id", context.workspaceId)
      .eq("material_id", materialId)
      .maybeSingle();
    if (currentError) throw new ApiError(503, "material_unavailable", "材料暂不可用");
    return json({
      ok: true,
      operation: "workspace-resources",
      request_id: body.request_id,
      materialMetadataVersions: {
        material_id: materialId,
        revision: current?.metadata_revision || 0,
        history_count: current?.metadata_history_count || 0,
        versions: data || [],
        external_send: false,
      },
    });
  }

  const action = text(body.action, 40);
  if (!action) throw new ApiError(400, "invalid_request", "材料信息操作无效");
  const { data, error } = await context.adminDb.rpc("mutate_material_metadata", {
    target_workspace: context.workspaceId,
    actor_id: context.user.id,
    material_request: body,
  });
  if (error) rpcError(error, "material_unavailable", "材料信息写入失败");
  return json(data);
}

async function classroom(
  body: Record<string, unknown>,
  context: Awaited<ReturnType<typeof requireWorkspaceAdmin>>,
): Promise<Response> {
  const action = text(body.action, 40);
  const domain = text(body.domain, 40);
  if (!action || !domain) throw new ApiError(400, "invalid_request", "班级操作无效");
  if (!["preview", "save", "restore", "publish"].includes(action)) {
    throw new ApiError(400, "invalid_request", "班级操作无效");
  }
  const { data, error } = await context.adminDb.rpc("mutate_classroom_object", {
    target_workspace: context.workspaceId,
    actor_id: context.user.id,
    classroom_request: body,
  });
  if (error) rpcError(error, "classroom_unavailable", "班级方案写入失败");
  return json(data);
}

async function mobileDashboard(
  context: Awaited<ReturnType<typeof requireWorkspaceAdmin>>,
): Promise<Response> {
  const { data, error } = await context.adminDb.rpc("mobile_dashboard_payload", {
    target_workspace: context.workspaceId,
  });
  if (error || !record(data)) {
    console.error("mobile_dashboard_query_failed", error?.message || "invalid_payload");
    throw new ApiError(503, "mobile_dashboard_unavailable", "移动端数据暂不可用");
  }

  return json({
    ok: true,
    operation: "mobile-dashboard",
    contract: MOBILE_DASHBOARD_CONTRACT,
    payload: data,
    external_send: false,
  });
}

async function broker(request: Request): Promise<Response> {
  const body = await readJson(request, 2 * 1024 * 1024);
  const operation = text(body.operation, 64);
  if (!operation) throw new ApiError(400, "invalid_request", "缺少 operation");
  if (operation === "mobile-dashboard") {
    return mobileDashboard(await requireWorkspaceAdmin(request));
  }
  const context = await requireWorkspaceAdmin(request);

  if (operation === "command") {
    const envelope = record(body.envelope);
    if (!envelope) throw new ApiError(400, "invalid_envelope", "command envelope 无效");
    const { data, error } = await context.adminDb.rpc("apply_core_command", {
      target_workspace: context.workspaceId,
      actor_id: context.user.id,
      command_envelope: envelope,
    });
    if (error) rpcError(error, "core_unavailable", "Core command 写入失败");
    return json(data);
  }
  if (operation === "education-facts") return educationFacts(body, context);
  if (operation === "material-metadata" || operation === "workspace-resources") return materialMetadata(body, context);
  if (operation === "classroom") return classroom(body, context);
  if (operation === "snapshot") {
    const { data, error } = await context.adminDb.rpc("refresh_workspace_snapshot", {
      target_workspace: context.workspaceId,
      snapshot_reason: "api_read",
    });
    if (error) rpcError(error, "core_unavailable", "云端快照暂不可用");
    return json({ ok: true, operation: "snapshot", ...data, external_send: false });
  }
  throw new ApiError(400, "invalid_request", "不支持的云端 operation");
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  try {
    if (request.method !== "POST") return json({ error: "method_not_allowed", code: "method_not_allowed" }, 405);
    return await broker(request);
  } catch (error) {
    return respondError(error);
  }
});
