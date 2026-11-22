import { createHash, randomUUID } from "node:crypto";
import { createEduPiCloudClient, EduPiCloudError, type CloudScope } from "./edupi-cloud-client";
import {
  buildStudentProfileRestoreRequest, normalizeStudentProfileMutationReceipt, StudentProfileVersionError,
  type StudentProfileMutationReceipt, type StudentProfileVersionSide,
} from "./edupi-student-profile-versions";
import {
  buildStudentProfileUpdateRequest, studentProfileUpdateRequestId,
  type StudentProfileUpdateInput,
} from "./edupi-student-roster-server";
import type { StudentRosterRow } from "./edupi-student-roster-model";
import {
  cloudStudentMutationReceipt, cloudStudentVersionIdentity,
  normalizeCloudStudentProfileHistory, normalizeCloudStudentRoster, verifyCloudStudentWrite,
} from "./edupi-cloud-students-verification";

type Client = ReturnType<typeof createEduPiCloudClient>;
type Row = Record<string, unknown>;
export type CloudStudentContext = { client: Client; scope: CloudScope };
export type CloudStudentRosterReceipt = Row & {
  ok: true; operation: "students"; action: "import"; request_id: string;
  created: number; updated: number; imported: number; total: number; external_send: false;
};
export { normalizeCloudStudentProfileHistory } from "./edupi-cloud-students-verification";
const record = (value: unknown): Row =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
function mutationBody(request: Row): Row {
  const body = { ...request };
  for (const key of ["protocol", "protocol_version", "producer", "operation"]) delete body[key];
  return body;
}
function read(client: Client, scope: CloudScope) {
  return async (_operation: string, body: Row = {}) => client.operation("students", {
    ...body, request_id: body.request_id || `students-read-${randomUUID()}`,
  }, scope);
}
async function write(client: Client, scope: CloudScope, body: Row): Promise<Row> {
  const delivery = await client.operationWithOutbox("students", body, scope);
  if (delivery.queued) {
    const error = new EduPiCloudError("write_queued", "修改已保留，等待云端同步。", 202);
    Object.assign(error, { outboxId: delivery.entry.id });
    throw error;
  }
  return delivery.result;
}

export function cloudStudentRosterRequestId(students: StudentRosterRow[], sourceName: string): string {
  return `student-roster-cloud-${createHash("sha256").update(JSON.stringify({
    source_name: sourceName,
    students: students.map(item => ({
      name: item.name, traits: item.traits, parent_notes: item.parentNotes,
      ...(item.className ? { class_name: item.className } : {}),
    })),
  })).digest("base64url")}`;
}

export async function importCloudStudentRoster(input: {
  students: StudentRosterRow[]; sourceName: string; requestId?: string; signal?: AbortSignal;
}, client = createEduPiCloudClient(), selected?: CloudScope): Promise<CloudStudentRosterReceipt> {
  const scope = selected || await client.captureScope();
  input.signal?.throwIfAborted();
  const body = {
    action: "import", request_id: input.requestId || cloudStudentRosterRequestId(input.students, input.sourceName),
    source_name: input.sourceName,
    students: input.students.map(item => ({
      name: item.name, traits: item.traits, parent_notes: item.parentNotes,
      ...(item.className ? { class_name: item.className } : {}),
    })),
  };
  const result = await write(client, scope, body);
  await verifyCloudStudentWrite(body, result, scope.workspaceId, read(client, scope));
  return result as CloudStudentRosterReceipt;
}

export async function readCloudStudentRoster(client = createEduPiCloudClient(), selected?: CloudScope) {
  const scope = selected || await client.captureScope();
  try {
    return normalizeCloudStudentRoster(await read(client, scope)("students", { action: "list" }), scope.workspaceId);
  } catch (error) {
    if (error instanceof EduPiCloudError) throw error;
    throw new EduPiCloudError("invalid_response", "云端学生名单格式无效。", 502);
  }
}

export async function readCloudStudentProfileVersions(
  studentId: string, client = createEduPiCloudClient(), selected?: CloudScope,
) {
  const scope = selected || await client.captureScope();
  return normalizeCloudStudentProfileHistory(
    await read(client, scope)("students", { action: "history", student_id: studentId }), scope.workspaceId, studentId,
  );
}

export async function updateCloudStudentProfile(
  input: StudentProfileUpdateInput & { signal?: AbortSignal }, client = createEduPiCloudClient(), selected?: CloudScope,
): Promise<StudentProfileMutationReceipt> {
  const scope = selected || await client.captureScope();
  input.signal?.throwIfAborted();
  const requestId = studentProfileUpdateRequestId(input);
  const body = mutationBody(buildStudentProfileUpdateRequest(input, requestId));
  const result = await write(client, scope, body);
  const response = await read(client, scope)("students", { action: "history", student_id: input.studentId });
  await verifyCloudStudentWrite(body, result, scope.workspaceId, async () => response);
  const history = normalizeCloudStudentProfileHistory(response, scope.workspaceId, input.studentId);
  const raw = cloudStudentMutationReceipt(result);
  if (raw.version_id !== null) {
    const versions = record(response.studentProfileVersions).versions as unknown[];
    const identity = versions.map(cloudStudentVersionIdentity).find(item => item.storageId === raw.version_id);
    if (!identity || history.profileRevision !== raw.profile_revision) throw new StudentProfileVersionError("invalid_response", "云端档案写入未能核对。");
    raw.version_id = identity.versionId;
  }
  return normalizeStudentProfileMutationReceipt(raw, {
    requestId, action: "update", studentId: input.studentId, studentName: input.name, expectedRevision: input.expectedRevision,
  });
}

export async function restoreCloudStudentProfileVersion(input: {
  studentId: string; studentName: string; versionId: string; versionSide: StudentProfileVersionSide;
  expectedRevision: number; signal?: AbortSignal;
}, client = createEduPiCloudClient(), selected?: CloudScope): Promise<StudentProfileMutationReceipt> {
  const scope = selected || await client.captureScope();
  input.signal?.throwIfAborted();
  const response = await read(client, scope)("students", { action: "history", student_id: input.studentId });
  const history = normalizeCloudStudentProfileHistory(response, scope.workspaceId, input.studentId);
  if (history.studentName !== input.studentName) throw new StudentProfileVersionError("student_not_found", "学生档案不存在。");
  const identities = (record(response.studentProfileVersions).versions as unknown[]).map(cloudStudentVersionIdentity);
  const target = identities.find(item => item.versionId === input.versionId);
  if (!target) throw new StudentProfileVersionError("version_not_found", "这个档案版本已不存在。");
  const body: Row = {
    ...mutationBody(buildStudentProfileRestoreRequest(input)),
    version_id: target.storageId, student_name: input.studentName,
  };
  const result = await write(client, scope, body);
  const after = await read(client, scope)("students", {
    action: "history", student_id: input.studentId, version_id: target.storageId,
  });
  await verifyCloudStudentWrite(body, result, scope.workspaceId, async () => after);
  normalizeCloudStudentProfileHistory(after, scope.workspaceId, input.studentId);
  const identity = (record(after.studentProfileVersions).versions as unknown[]).map(cloudStudentVersionIdentity)
    .find(item => item.storageId === result.version_id);
  if (!identity) throw new StudentProfileVersionError("invalid_response", "云端档案恢复未能核对。");
  return normalizeStudentProfileMutationReceipt({ ...cloudStudentMutationReceipt(result), version_id: identity.versionId }, {
    requestId: String(body.request_id), action: "restore", studentId: input.studentId,
    studentName: input.studentName, expectedRevision: input.expectedRevision,
  });
}

export async function readCloudStudentEducationData(client = createEduPiCloudClient(), selected?: CloudScope) {
  const scope = selected || await client.captureScope();
  const { readCloudEducationWorkspaceBundle } = await import("./edupi-cloud-education");
  const bundle = await readCloudEducationWorkspaceBundle(client, scope);
  bundle.data.students = await readCloudStudentRoster(client, scope);
  return bundle.data;
}
