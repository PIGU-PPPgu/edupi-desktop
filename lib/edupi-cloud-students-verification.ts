import { createHash } from "node:crypto";
import { CloudReadbackConflictError, CloudReadbackError } from "./edupi-cloud-verification.ts";
import {
  normalizeStudentProfileMutationReceipt,
  normalizeStudentProfileVersionHistory,
  sameStudentProfileValues,
  studentProfileValuesFromProjection,
  type StudentProfileVersionHistory,
} from "./edupi-student-profile-versions.ts";

type Row = Record<string, unknown>;
export type CloudStudentRead = (operation: string, body?: Row) => Promise<Row>;
const row = (value: unknown): Row | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
const fail = (): never => { throw new CloudReadbackError(); };
const timestamp = (value: unknown): string => {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return fail();
  return new Date(value).toISOString();
};
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= max
  && !/[\u0000-\u001f\u007f]/u.test(value);

function student(value: unknown): Row {
  const source = row(value);
  if (!source || !text(source.student_id, 240) || !text(source.name, 120)
    || !Object.hasOwn(source, "class_name") || !Number.isInteger(source.revision) || Number(source.revision) < 0
    || !Number.isInteger(source.profile_revision) || Number(source.profile_revision) < 0
    || !Number.isInteger(source.profile_history_count) || Number(source.profile_history_count) < 0
    || Number(source.profile_history_count) > 50 || source.deleted_at !== null
    || !studentProfileValuesFromProjection(source)) return fail();
  timestamp(source.updated_at);
  return source;
}

export function cloudStudentVersionIdentity(value: unknown): { storageId: string; versionId: string; wire: Row } {
  const source = row(value);
  const expectedKeys = ["version_id", "student_id", "revision", "before", "after", "changed_fields", "changed_at", "source_kind", "request_id"];
  const profileKeys = ["class_name", "traits", "parent_notes"];
  if (!source || !text(source.version_id, 160)
    || Object.keys(source).length !== expectedKeys.length || Object.keys(source).some(key => !expectedKeys.includes(key))) return fail();
  for (const value of [source.before, source.after]) {
    const values = row(value);
    if (!values || Object.keys(values).length !== profileKeys.length || Object.keys(values).some(key => !profileKeys.includes(key))) return fail();
  }
  const before = studentProfileValuesFromProjection(source.before);
  const after = studentProfileValuesFromProjection(source.after);
  if (!before || !after) return fail();
  const wireValues = (values: typeof before) => ({
    class_name: values.className, traits: values.traits, parent_notes: values.parentNotes,
  });
  // Cloud IDs identify stored rows. The existing Core UI requires a hash of
  // this exact ordered JSON object; convert explicitly at the cloud boundary.
  const identity = {
    student_id: source.student_id, revision: source.revision,
    before: wireValues(before), after: wireValues(after), changed_at: timestamp(source.changed_at),
    source_kind: source.source_kind, request_id: source.request_id,
  };
  const versionId = `student-profile-${createHash("sha256").update(JSON.stringify(identity)).digest("base64url")}`;
  return { storageId: source.version_id, versionId, wire: { ...source, ...identity, version_id: versionId } };
}

export function normalizeCloudStudentProfileHistory(
  response: Row, workspaceId: string, studentId: string,
): StudentProfileVersionHistory {
  if (response.ok !== true || response.operation !== "students" || response.action !== "history"
    || response.workspace_id !== workspaceId || response.external_send !== false) return fail();
  const current = student(response.student);
  const source = row(response.studentProfileVersions);
  if (current.student_id !== studentId || !source || !Array.isArray(source.versions)) return fail();
  const identities = source.versions.map(cloudStudentVersionIdentity);
  if (new Set(identities.map(item => item.storageId)).size !== identities.length) return fail();
  let history: StudentProfileVersionHistory;
  try {
    history = normalizeStudentProfileVersionHistory({
      ...source, versions: identities.map(item => item.wire),
    }, studentId);
  } catch { return fail(); }
  if (history.studentName !== current.name || history.profileRevision !== current.profile_revision
    || history.profileHistoryCount !== current.profile_history_count) return fail();
  const latest = history.versions.at(-1);
  if (latest && !sameStudentProfileValues(latest.afterValues, studentProfileValuesFromProjection(current)!)) return fail();
  return history;
}

export function normalizeCloudStudentRoster(response: Row, workspaceId: string): Row[] {
  if (response.ok !== true || response.operation !== "students" || response.action !== "list"
    || response.workspace_id !== workspaceId || response.external_send !== false
    || !Array.isArray(response.students) || response.students.length > 500) return fail();
  const students = response.students.map(student);
  if (new Set(students.map(item => item.student_id)).size !== students.length) return fail();
  return students;
}

// Edge responses add a transport contract. Core's receipt parser deliberately
// accepts only the original receipt fields, so remove only that known wrapper.
export function cloudStudentMutationReceipt(value: Row) {
  const receipt = { ...value };
  delete receipt.contract;
  return receipt;
}

function verifyImport(body: Row, result: Row) {
  if (!Array.isArray(body.students) || !Array.isArray(result.students) || body.students.length < 1
    || result.imported !== body.students.length || result.students.length !== body.students.length
    || !Number.isInteger(result.created) || Number(result.created) < 0
    || !Number.isInteger(result.updated) || Number(result.updated) < 0
    || Number(result.created) + Number(result.updated) !== result.imported
    || !Number.isInteger(result.total) || Number(result.total) < body.students.length || Number(result.total) > 500) return fail();
  const receipts = result.students.map(student);
  if (new Set(receipts.map(item => item.student_id)).size !== receipts.length) return fail();
  for (let index = 0; index < body.students.length; index++) {
    const expected = row(body.students[index]);
    const actual = receipts[index];
    if (!expected || actual.name !== expected.name || expected.class_name != null && actual.class_name !== expected.class_name
      || !Array.isArray(expected.traits) || !Array.isArray(expected.parent_notes)
      || expected.traits.some(item => !(actual.traits as unknown[]).includes(item))
      || expected.parent_notes.some(item => !(actual.parent_notes as unknown[]).includes(item))) return fail();
  }
  return receipts;
}

export async function verifyCloudStudentWrite(
  body: Row, result: Row, workspaceId: string, read: CloudStudentRead,
): Promise<void> {
  if (result.ok !== true || result.operation !== "students" || result.request_id !== body.request_id
    || result.external_send !== false || result.action !== body.action || typeof result.replayed !== "boolean") return fail();
  if (body.action === "import") {
    const receipts = verifyImport(body, result);
    const actual = normalizeCloudStudentRoster(await read("students", { action: "list", request_id: body.request_id }), workspaceId);
    for (const receipt of receipts) {
      const current = actual.find(item => item.student_id === receipt.student_id);
      if (current && (Number(current.profile_revision) > Number(receipt.profile_revision)
        || Number(current.revision) > Number(receipt.revision)
        || timestamp(current.updated_at) !== timestamp(receipt.updated_at))) throw new CloudReadbackConflictError();
      if (!current || current.name !== receipt.name || current.profile_revision !== receipt.profile_revision
        || current.profile_history_count !== receipt.profile_history_count || current.revision !== receipt.revision
        || timestamp(current.updated_at) !== timestamp(receipt.updated_at)
        || !sameStudentProfileValues(studentProfileValuesFromProjection(current)!, studentProfileValuesFromProjection(receipt)!)) return fail();
    }
    return;
  }
  if (body.action !== "update" && body.action !== "restore") return fail();
  const input = body.action === "update" ? row(body.student) : body;
  const studentId = body.action === "update" ? input?.student_id : body.student_id;
  const studentName = body.action === "update" ? input?.name : body.student_name;
  if (!text(studentId, 240) || !text(studentName, 120) || !text(body.request_id, 160)
    || !Number.isInteger(body.expected_revision)) return fail();
  try {
    normalizeStudentProfileMutationReceipt(cloudStudentMutationReceipt(result), {
      requestId: body.request_id, action: body.action, studentId, studentName,
      expectedRevision: Number(body.expected_revision),
    });
  } catch { return fail(); }
  const response = await read("students", {
    action: "history", request_id: body.request_id, student_id: studentId,
    ...(body.action === "restore" ? { version_id: body.version_id } : {}),
  });
  const current = row(response.student);
  if (current && (Number(current.profile_revision) > Number(result.profile_revision)
    || timestamp(current.updated_at) !== timestamp(result.updated_at))) throw new CloudReadbackConflictError();
  const history = normalizeCloudStudentProfileHistory(response, workspaceId, studentId);
  if (!current || current.name !== studentName || history.profileRevision !== result.profile_revision
    || history.profileHistoryCount !== result.profile_history_count
    || timestamp(current.updated_at) !== timestamp(result.updated_at)) return fail();
  const rawHistory = row(response.studentProfileVersions)!;
  const rawVersions = rawHistory.versions as unknown[];
  const applied = rawVersions.map(row).find(item => item?.version_id === result.version_id);
  if (result.version_id !== null && (!applied || applied.revision !== result.profile_revision
    || applied.request_id !== body.request_id || applied.source_kind !== (body.action === "restore" ? "restore" : "teacher_edit")
    || timestamp(applied.changed_at) !== timestamp(result.updated_at))) return fail();
  const currentValues = studentProfileValuesFromProjection(current)!;
  if (body.action === "update") {
    if (!input || JSON.stringify(currentValues.traits) !== JSON.stringify(input.traits)
      || JSON.stringify(currentValues.parentNotes) !== JSON.stringify(input.parent_notes)
      || input.class_name !== undefined && currentValues.className !== input.class_name) return fail();
    if (result.version_id === null && timestamp(result.updated_at) !== timestamp(body.expected_updated_at)) return fail();
  } else {
    const target = row(response.selected_version)
      || rawVersions.map(row).find(item => item?.version_id === body.version_id);
    if (!target || target.student_id !== studentId || target.version_id !== body.version_id
      || (body.version_side !== "before" && body.version_side !== "after")) return fail();
    const desired = studentProfileValuesFromProjection(target[body.version_side]);
    if (!desired || !sameStudentProfileValues(currentValues, desired)) return fail();
  }
}
