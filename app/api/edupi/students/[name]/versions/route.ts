import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { readEducationContract } from "@/lib/edupi-education-server";
import type { EducationContract } from "@/lib/edupi-education-contract";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { createEduPiCloudClient, EduPiCloudError } from "@/lib/edupi-cloud-client";
import { captureEducationWriteScope } from "@/lib/edupi-cloud-request-scope";
import {
  readCloudStudentEducationData, readCloudStudentProfileVersions, restoreCloudStudentProfileVersion,
  type CloudStudentContext,
} from "@/lib/edupi-cloud-students";
import {
  StudentProfileVersionError,
  readStudentProfileVersions,
  restoreStudentProfileVersion,
  sameStudentProfileValues,
  studentProfileRestoreRequestId,
  studentProfileValuesFromProjection,
  type StudentProfileMutationReceipt,
  type StudentProfileVersion,
  type StudentProfileVersionHistory,
  type StudentProfileVersionSide,
  type StudentProfileVersionValues,
} from "@/lib/edupi-student-profile-versions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RestoreBody = {
  studentId: string;
  versionId: string;
  versionSide: StudentProfileVersionSide;
  expectedRevision: number;
};

type CurrentState = {
  data: EducationContract;
  student: Record<string, unknown>;
  values: StudentProfileVersionValues;
  history: StudentProfileVersionHistory;
};

const BODY_KEYS = new Set(["studentId", "versionId", "versionSide", "expectedRevision"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function validName(value: unknown): string | null {
  const name = text(value, 120);
  return name && !/[\u0000-\u001f\u007f]/u.test(name) ? name : null;
}

function parseBody(value: unknown): RestoreBody | null {
  const source = record(value);
  if (!source || Object.keys(source).length !== BODY_KEYS.size || Object.keys(source).some((key) => !BODY_KEYS.has(key))) return null;
  const studentId = text(source.studentId, 240);
  const versionId = text(source.versionId, 160);
  if (!studentId || !versionId || (source.versionSide !== "before" && source.versionSide !== "after")
    || !Number.isInteger(source.expectedRevision) || Number(source.expectedRevision) < 0) return null;
  return { studentId, versionId, versionSide: source.versionSide, expectedRevision: Number(source.expectedRevision) };
}

function errorResponse(code: string, status: number, error: string) {
  return NextResponse.json({ error, code }, { status });
}

function mapError(error: StudentProfileVersionError) {
  if (error.code === "invalid_request") return errorResponse(error.code, 400, error.message);
  if (error.code === "student_not_found" || error.code === "version_not_found") return errorResponse(error.code, 404, error.message);
  if (error.code === "student_deleted") return errorResponse(error.code, 410, error.message);
  if (["version_already_current", "stale_student", "idempotency_conflict"].includes(error.code)) return errorResponse(error.code, 409, error.message);
  if (error.code === "invalid_response") return errorResponse(error.code, 502, error.message);
  return errorResponse(error.code, 503, error.message);
}

function studentFor(data: EducationContract, name: string, studentId: string): Record<string, unknown> | null {
  const matches = data.students.filter((student) => student.student_id === studentId && student.name === name);
  return matches.length === 1 ? matches[0] : null;
}

function revisionFor(student: Record<string, unknown>): number | null {
  return Number.isInteger(student.profile_revision) && Number(student.profile_revision) >= 0 ? Number(student.profile_revision) : null;
}

function versionFor(history: StudentProfileVersionHistory, versionId: string): StudentProfileVersion | null {
  const matches = history.versions.filter((version) => version.versionId === versionId);
  return matches.length === 1 ? matches[0] : null;
}

function desiredValues(version: StudentProfileVersion, side: StudentProfileVersionSide): StudentProfileVersionValues {
  return side === "before" ? version.beforeValues : version.afterValues;
}

async function readCurrentState(name: string, studentId: string, cloud?: CloudStudentContext): Promise<CurrentState | null> {
  const [data, history] = await Promise.all(cloud ? [
    readCloudStudentEducationData(cloud.client, cloud.scope),
    readCloudStudentProfileVersions(studentId, cloud.client, cloud.scope),
  ] : [readEducationContract(), readStudentProfileVersions(studentId, undefined, true)]);
  const student = studentFor(data, name, studentId);
  const values = studentProfileValuesFromProjection(student);
  if (!student || !values || history.studentName !== name || revisionFor(student) !== history.profileRevision
    || student.profile_history_count !== history.profileHistoryCount) return null;
  return { data, student, values, history };
}

function isOwnedRestore(state: CurrentState, body: RestoreBody, requestId: string, desired: StudentProfileVersionValues): boolean {
  if (state.history.profileRevision !== body.expectedRevision + 1 || !sameStudentProfileValues(state.values, desired)) return false;
  const applied = state.history.versions.find((version) => version.revision === body.expectedRevision + 1);
  return Boolean(applied && applied.sourceKind === "restore" && applied.requestId === requestId && sameStudentProfileValues(applied.afterValues, desired));
}

function verifiesReceipt(state: CurrentState, receipt: StudentProfileMutationReceipt, desired: StudentProfileVersionValues): boolean {
  if (state.history.profileRevision !== receipt.profileRevision || state.history.profileHistoryCount !== receipt.profileHistoryCount
    || !sameStudentProfileValues(state.values, desired)) return false;
  if (state.history.profileHistoryCount === 0) return true;
  const applied = state.history.versions.at(-1);
  return Boolean(applied && applied.revision === receipt.profileRevision && applied.versionId === receipt.versionId
    && applied.sourceKind === "restore" && applied.requestId === receipt.requestId && sameStudentProfileValues(applied.afterValues, desired));
}

export async function GET(request: Request, { params }: { params: Promise<{ name: string }> }) {
  if (!isApiRequestAllowed(request)) return errorResponse("forbidden", 403, "学生档案历史请求被拒绝");
  const name = validName((await params).name);
  const studentId = text(new URL(request.url).searchParams.get("studentId"), 240);
  if (!name || !studentId) return errorResponse("invalid_request", 400, "学生身份无效");
  try {
    const client = createEduPiCloudClient();
    const history = (await client.state()).mode === "cloud"
      ? await readCloudStudentProfileVersions(studentId, client, await client.captureScope())
      : await readStudentProfileVersions(studentId, request.signal, true);
    if (history.studentName !== name) return errorResponse("student_not_found", 404, "学生档案不存在");
    return NextResponse.json({ history });
  } catch (error) {
    if (error instanceof EduPiCloudError) return errorResponse(error.code, error.status, error.message);
    return error instanceof StudentProfileVersionError ? mapError(error) : errorResponse("unavailable", 503, "学生档案历史暂不可用");
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ name: string }> }) {
  if (!isApiRequestAllowed(request)) return errorResponse("forbidden", 403, "学生档案恢复请求被拒绝");
  if (!hasJsonContentType(request)) return errorResponse("invalid_content_type", 415, "请使用 JSON");
  const name = validName((await params).name);
  let body: RestoreBody | null = null;
  try { body = parseBody(await parseJsonWithinLimit(request, 4000)); }
  catch (error) {
    if (error instanceof RequestBodyTooLargeError) return errorResponse("too_large", 413, "学生档案恢复请求过大");
  }
  if (!name || !body) return errorResponse("invalid_request", 400, "学生档案恢复请求无效");

  try {
    const client = createEduPiCloudClient();
    const selected = await captureEducationWriteScope(request, client);
    const cloud = selected.mode === "cloud" ? { client, scope: selected.scope! } : undefined;
    const initial = await readCurrentState(name, body.studentId, cloud);
    if (!initial) return errorResponse("stale_student", 409, "学生档案已更新，请刷新后重试");
    const requestId = studentProfileRestoreRequestId(body);
    const owned = initial.history.versions.find(version => version.revision === body.expectedRevision + 1
      && version.sourceKind === "restore" && version.requestId === requestId);
    if (owned && isOwnedRestore(initial, body, requestId, owned.afterValues)) {
      return NextResponse.json({ result: null, data: initial.data, history: initial.history, reconciled: true });
    }
    const version = versionFor(initial.history, body.versionId);
    if (!version) return errorResponse("version_not_found", 404, "这个档案版本已不存在");
    const desired = desiredValues(version, body.versionSide);
    if (initial.history.profileRevision !== body.expectedRevision) return errorResponse("stale_student", 409, "学生档案已更新，请刷新后重试");
    if (sameStudentProfileValues(initial.values, desired)) return errorResponse("version_already_current", 409, "当前档案已经是这个版本");

    let receipt: StudentProfileMutationReceipt;
    try {
      receipt = cloud
        ? await restoreCloudStudentProfileVersion({ ...body, studentName: name, signal: request.signal }, cloud.client, cloud.scope)
        : await restoreStudentProfileVersion({ ...body, studentName: name, signal: request.signal, localOnly: true });
    } catch (error) {
      const reconciled = await readCurrentState(name, body.studentId, cloud).catch(() => null);
      if (reconciled && isOwnedRestore(reconciled, body, requestId, desired)) {
        return NextResponse.json({ result: null, data: reconciled.data, history: reconciled.history, reconciled: true });
      }
      throw error;
    }
    const verified = await readCurrentState(name, body.studentId, cloud);
    if (!verified || !verifiesReceipt(verified, receipt, desired)) return errorResponse("invalid_response", 502, "恢复结果未能与 Core 对账");
    return NextResponse.json({ result: receipt, data: verified.data, history: verified.history, reconciled: false });
  } catch (error) {
    if (error instanceof EduPiCloudError) {
      if (error.code === "write_queued") return NextResponse.json({
        queued: true, outboxId: "outboxId" in error ? error.outboxId : null, result: null, data: null, history: null,
      }, { status: 202 });
      return errorResponse(error.code, error.status, error.message);
    }
    return error instanceof StudentProfileVersionError ? mapError(error) : errorResponse("unavailable", 503, "学生档案恢复暂不可用");
  }
}
