import {
  ApiError, handleOptions, json, readJson, requireWorkspaceAdmin, respondError,
} from "../_shared/http.ts";
import { CLOUD_SYNC_CONTRACT } from "../_shared/cloud-contract.ts";

type Row = Record<string, unknown>;
type Database = {
  rpc(name: string, args: Row): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};
type Dependencies = {
  context(request: Request): Promise<{
    db: Database; adminDb: Database; workspaceId: string; user: { id: string };
  }>;
};
const defaultDeps: Dependencies = { context: requireWorkspaceAdmin };
const READS = new Set(["list", "read", "history"]);
const WRITES = new Set(["import", "update", "restore"]);
const record = (value: unknown): Row | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= max
  && !/[\u0000-\u001f\u007f]/u.test(value);
const keys = (value: Row, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
const list = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length <= 500 && value.every(item => text(item, 4096));
const time = (value: unknown): value is string => text(value, 64) && Number.isFinite(Date.parse(value));
function invalid(): never { throw new ApiError(400, "invalid_request", "学生档案请求无效"); }
function readback(conflict = false): never {
  throw new ApiError(conflict ? 409 : 502, conflict ? "readback_conflict" : "readback_failed",
    conflict ? "学生档案已更新，请刷新后核对" : "学生档案写入尚未通过回读核对");
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  const source = record(value);
  return source ? Object.fromEntries(Object.keys(source).sort().map(key => [key, canonical(source[key])])) : value;
}
const same = (left: unknown, right: unknown) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

function validate(body: Row, request: Request) {
  if (!text(body.request_id, 160) || typeof body.action !== "string"
    || !READS.has(body.action) && !WRITES.has(body.action)
    || request.headers.has("idempotency-key") && request.headers.get("idempotency-key") !== body.request_id) invalid();
  if (READS.has(body.action)) {
    if (!keys(body, ["action", "request_id", "student_id", "version_id"])
      || body.action === "list" && (body.student_id !== undefined || body.version_id !== undefined)
      || body.action !== "list" && !text(body.student_id, 240)
      || body.version_id !== undefined && (body.action !== "history" || !text(body.version_id, 160))) invalid();
    return;
  }
  if (body.action === "import") {
    if (!keys(body, ["action", "request_id", "source_name", "students"]) || !text(body.source_name, 240)
      || !Array.isArray(body.students) || body.students.length < 1 || body.students.length > 500) invalid();
    for (const raw of body.students) {
      const student = record(raw);
      if (!student || !keys(student, ["name", "class_name", "traits", "parent_notes"])
        || !text(student.name, 120) || !list(student.traits) || !list(student.parent_notes)
        || student.class_name !== undefined && !text(student.class_name, 120)) invalid();
    }
    return;
  }
  if (!Number.isInteger(body.expected_revision) || Number(body.expected_revision) < 0
    || Number(body.expected_revision) > 2147483646) invalid();
  if (body.action === "update") {
    const student = record(body.student);
    if (!keys(body, ["action", "request_id", "student", "expected_revision", "expected_updated_at"])
      || !time(body.expected_updated_at) || !student
      || !keys(student, ["student_id", "name", "class_name", "traits", "parent_notes"])
      || !text(student.student_id, 240) || !text(student.name, 120) || !list(student.traits) || !list(student.parent_notes)
      || student.class_name !== undefined && student.class_name !== null && !text(student.class_name, 120)) invalid();
    return;
  }
  if (!keys(body, ["action", "request_id", "student_id", "student_name", "version_id", "version_side", "expected_revision", "expected_updated_at"])
    || !text(body.student_id, 240) || !text(body.student_name, 120) || !text(body.version_id, 160)
    || body.version_side !== "before" && body.version_side !== "after"
    || body.expected_updated_at !== undefined && !time(body.expected_updated_at)) invalid();
}

function rpcError(error: { message?: string }): never {
  const code = error.message || "";
  const errors: Record<string, [number, string]> = {
    workspace_forbidden: [403, "没有工作区权限"],
    student_not_found: [404, "学生档案不存在"],
    version_not_found: [404, "这个档案版本已不存在"],
    student_deleted: [410, "学生档案已删除"],
    stale_student: [409, "学生档案已更新，请刷新后重试"],
    ambiguous_student: [409, "同名学生身份不明确，请核对班级"],
    idempotency_conflict: [409, "相同请求 ID 的内容不同"],
    version_already_current: [409, "当前档案已经是这个版本"],
    invalid_state: [409, "学生档案数据需要修复"],
    invalid_request: [400, "学生档案请求无效"],
    too_many_students: [400, "一次最多保存 500 名学生"],
  };
  const match = errors[code];
  if (match) throw new ApiError(match[0], code, match[1]);
  throw new ApiError(503, "students_unavailable", "学生档案暂不可用");
}

function verifyRead(response: Row | null, body: Row, workspaceId: string): asserts response is Row {
  if (!response || response.ok !== true || response.operation !== "students" || response.action !== body.action
    || response.request_id !== body.request_id || response.workspace_id !== workspaceId || response.external_send !== false) readback();
  if (body.action === "list") {
    if (!Array.isArray(response.students) || response.students.length > 500) readback();
    const ids = new Set();
    for (const raw of response.students) {
      const student = record(raw);
      if (!student || !text(student.student_id, 240) || !text(student.name, 120)
        || student.deleted_at !== null || ids.has(student.student_id)) readback();
      ids.add(student.student_id);
    }
  } else {
    const student = record(response.student);
    if (!student || student.student_id !== body.student_id || student.deleted_at !== null) readback();
    if (body.action === "history") {
      const history = record(response.studentProfileVersions);
      if (!history || history.student_id !== body.student_id || history.student_name !== student.name
        || history.profile_revision !== student.profile_revision || history.profile_history_count !== student.profile_history_count
        || !Array.isArray(history.versions) || history.versions.length !== history.profile_history_count) readback();
    }
  }
}

function verifyWrite(body: Row, result: Row | null, read: Row) {
  if (!result || result.ok !== true || result.operation !== "students" || result.request_id !== body.request_id
    || result.action !== body.action || result.external_send !== false || typeof result.replayed !== "boolean") readback();
  if (body.action === "import") {
    const expected = body.students as Row[];
    if (result.imported !== expected.length || !Array.isArray(result.students)
      || result.students.length !== expected.length || Number(result.created) + Number(result.updated) !== expected.length) readback();
    const actual = (read.students as unknown[]).map(record);
    const ids = new Set();
    for (let index = 0; index < expected.length; index++) {
      const receipt = record(result.students[index]);
      const current = actual.find(item => item?.student_id === receipt?.student_id);
      if (current && receipt && (Number(current.profile_revision) > Number(receipt.profile_revision)
        || time(current.updated_at) && time(receipt.updated_at) && Date.parse(current.updated_at) !== Date.parse(receipt.updated_at))) readback(true);
      if (!receipt || !current || receipt.name !== expected[index].name
        || expected[index].class_name !== undefined && receipt.class_name !== expected[index].class_name
        || ids.has(receipt.student_id) || !same(current, receipt)
        || !list(receipt.traits) || !list(receipt.parent_notes)
        || (expected[index].traits as string[]).some(item => !(receipt.traits as string[]).includes(item))
        || (expected[index].parent_notes as string[]).some(item => !(receipt.parent_notes as string[]).includes(item))) readback();
      ids.add(receipt.student_id);
    }
    return;
  }
  const current = record(read.student);
  const input = record(body.student);
  const id = body.action === "update" ? input?.student_id : body.student_id;
  const name = body.action === "update" ? input?.name : body.student_name;
  if (current && (Number(current.profile_revision) > Number(result.profile_revision)
    || time(current.updated_at) && time(result.updated_at) && Date.parse(current.updated_at) !== Date.parse(result.updated_at))) readback(true);
  if (!current || result.student_id !== id || result.student_name !== name || current.name !== name
    || current.profile_revision !== result.profile_revision || current.profile_history_count !== result.profile_history_count
    || !time(result.updated_at) || !time(current.updated_at)
    || Date.parse(current.updated_at) !== Date.parse(result.updated_at)
    || result.updated !== 1 || result.profile_revision !== Number(body.expected_revision) + (result.version_id === null ? 0 : 1)
    || body.action === "restore" && result.version_id === null) readback();
  const history = record(read.studentProfileVersions)!;
  const versions = (history.versions as unknown[]).map(record);
  const applied = versions.find(item => item?.version_id === result.version_id);
  if (result.version_id !== null && (!applied || applied.student_id !== id || applied.request_id !== body.request_id
    || applied.revision !== result.profile_revision || applied.source_kind !== (body.action === "restore" ? "restore" : "teacher_edit"))) readback();
  const values = { class_name: current.class_name, traits: current.traits, parent_notes: current.parent_notes };
  if (body.action === "update") {
    if (!input || !same(input.traits, current.traits) || !same(input.parent_notes, current.parent_notes)
      || input.class_name !== undefined && input.class_name !== current.class_name) readback();
  } else {
    const target = record(read.selected_version) || versions.find(item => item?.version_id === body.version_id);
    if (!target || target.student_id !== id || target.version_id !== body.version_id || !same(values, target[String(body.version_side)])) readback();
  }
}

export async function handleStudentsRequest(request: Request, deps: Dependencies = defaultDeps): Promise<Response> {
  const options = handleOptions(request);
  if (options) return options;
  try {
    if (request.method !== "POST") return json({ error: "method_not_allowed", code: "method_not_allowed" }, 405);
    const body = await readJson(request, 256 * 1024);
    validate(body, request);
    const { db, adminDb, workspaceId, user } = await deps.context(request);
    if (READS.has(String(body.action))) {
      const { data, error } = await db.rpc("read_students", { target_workspace: workspaceId, students_request: body });
      if (error) rpcError(error);
      const response = record(data);
      verifyRead(response, body, workspaceId);
      return json({ ...response, contract: CLOUD_SYNC_CONTRACT });
    }
    const { data, error } = await adminDb.rpc("mutate_students", {
      target_workspace: workspaceId, actor_id: user.id, students_request: body,
    });
    if (error) rpcError(error);
    const input = record(body.student);
    const readBody = {
      request_id: body.request_id, action: body.action === "import" ? "list" : "history",
      ...(body.action === "import" ? {} : { student_id: body.action === "update" ? input?.student_id : body.student_id }),
      ...(body.action === "restore" ? { version_id: body.version_id } : {}),
    };
    const { data: actual, error: readError } = await db.rpc("read_students", {
      target_workspace: workspaceId, students_request: readBody,
    });
    if (readError) rpcError(readError);
    const actualResponse = record(actual);
    verifyRead(actualResponse, readBody, workspaceId);
    verifyWrite(body, record(data), actualResponse);
    return json({ ...record(data), contract: CLOUD_SYNC_CONTRACT });
  } catch (error) {
    return respondError(error);
  }
}

if (import.meta.main) Deno.serve(request => handleStudentsRequest(request));
