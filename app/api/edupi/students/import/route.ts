import { NextResponse } from "next/server";
import { parseFormDataWithinLimit, parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { readEducationContract } from "@/lib/edupi-education-server";
import { parseStudentRosterFile } from "@/lib/edupi-student-roster-file";
import { parseStudentRosterCsv, StudentRosterError, type StudentRosterRow } from "@/lib/edupi-student-roster-model";
import { importStudentRoster } from "@/lib/edupi-student-roster-server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_JSON_BODY_BYTES = 1024 * 1024;
const MAX_FILE_BODY_BYTES = 6 * 1024 * 1024;

type RawRecord = Record<string, unknown>;
const record = (value: unknown): RawRecord | null => value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "请求被拒绝。" }, { status: 403 });
  try {
    let sourceName: string;
    let students: StudentRosterRow[];
    if (hasJsonContentType(request)) {
      const body = record(await parseJsonWithinLimit(request, MAX_JSON_BODY_BYTES));
      if (!body || Object.keys(body).some((key) => !["sourceName", "csv"].includes(key)) || typeof body.csv !== "string" || typeof body.sourceName !== "string" || body.sourceName.length > 240) return NextResponse.json({ error: "学生名单请求无效。" }, { status: 400 });
      sourceName = body.sourceName;
      students = parseStudentRosterCsv(body.csv);
    } else if (request.headers.get("content-type")?.toLocaleLowerCase().startsWith("multipart/form-data;")) {
      const form = await parseFormDataWithinLimit(request, MAX_FILE_BODY_BYTES);
      if ([...form.keys()].some((key) => key !== "file")) return NextResponse.json({ error: "学生名单请求无效。" }, { status: 400 });
      const file = form.get("file");
      if (!(file instanceof File) || !file.name || file.name.length > 240) return NextResponse.json({ error: "请选择名单文件。" }, { status: 400 });
      sourceName = file.name;
      students = parseStudentRosterFile(new Uint8Array(await file.arrayBuffer()), sourceName);
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
