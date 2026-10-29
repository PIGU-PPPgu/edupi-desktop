import { NextResponse } from "next/server";
import { parseFormDataWithinLimit, parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { readEducationContract } from "@/lib/edupi-education-server";
import { classifyStudentRosterFile, parseStudentRosterFile, previewStudentRosterFile } from "@/lib/edupi-student-roster-file";
import { parseStudentRosterCsv, studentRecordName, StudentRosterError, type StudentRosterRow } from "@/lib/edupi-student-roster-model";
import { automaticRosterRequestId, importStudentRoster, manualRosterRequestId } from "@/lib/edupi-student-roster-server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_JSON_BODY_BYTES = 1024 * 1024;
const MAX_FILE_BODY_BYTES = 6 * 1024 * 1024;

type RawRecord = Record<string, unknown>;
const record = (value: unknown): RawRecord | null => value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
type ImportDeps = { importRoster: typeof importStudentRoster; readContract: typeof readEducationContract };
const defaultDeps: ImportDeps = { importRoster: importStudentRoster, readContract: readEducationContract };

export function verifyImportedRosterReadback(students: StudentRosterRow[], data: Awaited<ReturnType<typeof readEducationContract>>): void {
  const actual = Array.isArray(data?.students) ? data.students : [];
  if (!students.every((expected) => {
    const matches = actual.filter((row) => studentRecordName(row) === expected.name
      && (!expected.className || String(row.class_name ?? row.className ?? "").trim() === expected.className));
    if (matches.length !== 1) return false;
    const traits = Array.isArray(matches[0].traits) ? matches[0].traits : [];
    const parentNotes = Array.isArray(matches[0].parent_notes) ? matches[0].parent_notes : [];
    return expected.traits.every((item) => traits.includes(item))
      && expected.parentNotes.every((item) => parentNotes.includes(item));
  })) throw new Error("名单写入状态未确认，请回班级核对。");
}

async function importAndVerify(students: StudentRosterRow[], sourceName: string, requestId: string, signal: AbortSignal | undefined, deps: ImportDeps) {
  const result = await deps.importRoster({ students, sourceName, signal, requestId });
  const data = await deps.readContract();
  verifyImportedRosterReadback(students, data);
  return { result, data, verified: true as const };
}

export async function processManualStudentRoster(csv: string, sourceName: string, signal?: AbortSignal, deps: ImportDeps = defaultDeps) {
  return importAndVerify(parseStudentRosterCsv(csv), sourceName, manualRosterRequestId(csv, sourceName), signal, deps);
}

export async function processAutomaticStudentRoster(
  bytes: Uint8Array,
  sourceName: string,
  signal?: AbortSignal,
  deps: ImportDeps = defaultDeps,
) {
  const classified = classifyStudentRosterFile(bytes, sourceName);
  if (classified.status === "needs_review") return { status: "needs_review" as const, sourceName, sheets: classified.sheets, reason: classified.reason };
  return { status: "imported" as const, ...await importAndVerify(classified.students, sourceName, automaticRosterRequestId(bytes, sourceName), signal, deps) };
}

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "请求被拒绝。" }, { status: 403 });
  try {
    let sourceName: string;
    let students: StudentRosterRow[];
    if (hasJsonContentType(request)) {
      const body = record(await parseJsonWithinLimit(request, MAX_JSON_BODY_BYTES));
      if (!body || Object.keys(body).some((key) => !["sourceName", "csv"].includes(key)) || typeof body.csv !== "string" || typeof body.sourceName !== "string" || body.sourceName.length > 240) return NextResponse.json({ error: "学生名单请求无效。" }, { status: 400 });
      return NextResponse.json(await processManualStudentRoster(body.csv, body.sourceName, request.signal));
    } else if (request.headers.get("content-type")?.toLocaleLowerCase().startsWith("multipart/form-data;")) {
      const form = await parseFormDataWithinLimit(request, MAX_FILE_BODY_BYTES);
      if ([...form.keys()].some((key) => key !== "file")) return NextResponse.json({ error: "学生名单请求无效。" }, { status: 400 });
      const file = form.get("file");
      if (!(file instanceof File) || !file.name || file.name.length > 240) return NextResponse.json({ error: "请选择名单文件。" }, { status: 400 });
      sourceName = file.name;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const action = new URL(request.url).searchParams;
      if (action.get("preview") === "1") return NextResponse.json({ sourceName, sheets: previewStudentRosterFile(bytes, sourceName) });
      if (action.get("auto") === "1") return NextResponse.json(await processAutomaticStudentRoster(bytes, sourceName, request.signal));
      students = parseStudentRosterFile(bytes, sourceName);
    } else {
      return NextResponse.json({ error: "请上传名单文件。" }, { status: 415 });
    }
    const result = await importStudentRoster({ students, sourceName, signal: request.signal });
    return NextResponse.json({ result, data: await readEducationContract() });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: "名单文件过大。" }, { status: 413 });
    if (error instanceof StudentRosterError) return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "学生名单导入失败。" }, { status: 503 });
  }
}
