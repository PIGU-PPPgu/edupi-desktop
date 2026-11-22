import {
  ApiError,
  handleOptions,
  json,
  readJson,
  requestId,
  requireWorkspace,
  respondError,
} from "../_shared/http.ts";

function safeText(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value)
    ? value.trim()
    : null;
}

function validDate(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function localRecord(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.event_id,
    kind: row.kind,
    student_ids: row.student_ids || [],
    student_labels: row.student_labels || [],
    class_name: row.class_name ?? null,
    canonical_topic: row.canonical_topic ?? null,
    topic: row.topic ?? null,
    summary: row.summary,
    observed_on: row.observed_on ?? null,
    recorded_at: row.recorded_at,
    updated_at: row.updated_at,
    revision: row.revision,
    source: row.source,
    history: row.history || [],
    history_count: row.history_count ?? 0,
  };
}

async function getEvents(request: Request): Promise<Response> {
  const { db, workspaceId } = await requireWorkspace(request);
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");
  const student = safeText(params.get("student"), 240);
  if (params.has("student") && !student) throw new ApiError(400, "invalid_request", "student 无效");
  const offset = Number(params.get("offset") || 0);
  const limit = Number(params.get("limit") || 20);
  if (kind !== null && !["learning", "interaction"].includes(kind)) throw new ApiError(400, "invalid_request", "kind 无效");
  if (!Number.isInteger(offset) || offset < 0 || offset > 1_000_000) throw new ApiError(400, "invalid_request", "offset 无效");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ApiError(400, "invalid_request", "limit 无效");
  let studentId = safeText(params.get("student_id"), 160);
  if (params.has("student_id") && !studentId) throw new ApiError(400, "invalid_request", "student_id 无效");
  if (!studentId && student) {
    const { data: matches, error: studentError } = await db
      .from("student_profiles")
      .select("student_id")
      .eq("workspace_id", workspaceId)
      .eq("name", student)
      .is("deleted_at", null)
      .limit(2);
    if (studentError) throw new ApiError(503, "student_events_unavailable", "学生记录暂不可用");
    // A name is only a safe fallback when it identifies exactly one student
    // in this workspace. Ambiguous or absent names return no records.
    if (!matches || matches.length !== 1) {
      return json({ ok: true, records: [], total: 0, record_ids: [], external_send: false });
    }
    studentId = safeText(matches[0].student_id, 160);
    if (!studentId) throw new ApiError(503, "student_events_unavailable", "学生身份无效");
  }
  const { data, error } = await db.rpc("list_student_events", {
    target_workspace: workspaceId,
    p_student_id: studentId,
    p_kind: kind,
    p_offset: offset,
    p_limit: limit,
    p_query: safeText(params.get("query"), 200),
    p_from: params.get("from") || null,
    p_to: params.get("to") || null,
  });
  if (error) throw new ApiError(503, "student_events_unavailable", "学生记录暂不可用");
  const rows = Array.isArray(data) ? data as Record<string, unknown>[] : [];
  const records = rows.map(localRecord);
  return json({
    ok: true,
    records,
    total: Number(rows[0]?.total_count || 0),
    record_ids: records.map((record) => record.id),
    external_send: false,
  });
}

async function mutateEvent(request: Request): Promise<Response> {
  const body = await readJson(request, 16 * 1024);
  const { db, workspaceId } = await requireWorkspace(request);
  const action = body.action;
  if (action === "set_topic_alias") {
    if (Object.keys(body).some((key) => !["action", "alias", "canonical"].includes(key))) throw new ApiError(400, "invalid_request", "请求字段无效");
    const alias = safeText(body.alias, 160);
    const canonical = safeText(body.canonical, 160);
    if (!alias || !canonical) throw new ApiError(400, "invalid_request", "主题别名无效");
    const { data, error } = await db.rpc("mutate_topic_alias", {
      target_workspace: workspaceId,
      p_alias: alias,
      p_canonical: canonical,
    });
    if (error) throw new ApiError(503, "student_events_unavailable", "主题别名暂不可用");
    return json(data || { ok: true, action, alias, canonical, external_send: false });
  }
  if (action !== "update_event" && action !== "delete_event") throw new ApiError(400, "invalid_request", "操作无效");
  if (Object.keys(body).some((key) => !["action", "event_id", "expected_revision", "summary", "topic", "observed_on", "request_id"].includes(key))) {
    throw new ApiError(400, "invalid_request", "请求字段无效");
  }
  const eventId = safeText(body.event_id, 240);
  const expectedRevision = body.expected_revision;
  if (!eventId || !Number.isInteger(expectedRevision) || Number(expectedRevision) < 0) throw new ApiError(400, "invalid_request", "事件身份或 revision 无效");
  const summary = body.summary === undefined ? null : safeText(body.summary, 2000);
  const topic = body.topic === undefined ? null : safeText(body.topic, 240);
  const observedOn = body.observed_on === undefined ? null : body.observed_on;
  if (action === "update_event" && body.summary !== undefined && !summary) throw new ApiError(400, "invalid_request", "summary 无效");
  if (!validDate(observedOn)) throw new ApiError(400, "invalid_request", "observed_on 无效");
  const { data, error } = await db.rpc("mutate_student_event", {
    target_workspace: workspaceId,
    p_event_id: eventId,
    p_expected_revision: expectedRevision,
    p_action: action,
    p_summary: summary,
    p_topic: topic,
    p_observed_on: observedOn,
    p_request_id: requestId(request, body),
  });
  if (error) {
    const message = error.message || "";
    if (message.includes("stale_event")) throw new ApiError(409, "stale_event", "记录已更新，请刷新后重试");
    if (message.includes("event_not_found")) throw new ApiError(404, "event_not_found", "记录不存在或已删除");
    throw new ApiError(503, "student_events_unavailable", "学生记录暂不可用");
  }
  const result = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
  const { data: current, error: readError } = await db
    .from("student_events")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("event_id", eventId)
    .maybeSingle();
  if (readError) throw new ApiError(503, "student_events_unavailable", "学生记录回读失败");
  return json({
    ok: true,
    record: current ? localRecord(current as Record<string, unknown>) : null,
    revision: result.revision ?? current?.revision ?? null,
    replayed: result.replayed === true,
    external_send: false,
  });
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  try {
    if (request.method === "GET") return await getEvents(request);
    if (request.method === "POST") return await mutateEvent(request);
    return json({ error: "method_not_allowed", code: "method_not_allowed" }, 405);
  } catch (error) {
    return respondError(error);
  }
});
