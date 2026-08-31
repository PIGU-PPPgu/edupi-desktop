import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { readEducationContract } from "@/lib/edupi-education-server";
import { parseStudentRosterCsv, StudentRosterError } from "@/lib/edupi-student-roster-model";
import { importStudentRoster } from "@/lib/edupi-student-roster-server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 1024 * 1024;

type RawRecord = Record<string, unknown>;
const record = (value: unknown): RawRecord | null => value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "请求被拒绝。" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "请使用 JSON。" }, { status: 415 });
  try {
    const body = record(await parseJsonWithinLimit(request, MAX_BODY_BYTES));
    if (!body || Object.keys(body).some((key) => !["sourceName", "csv"].includes(key)) || typeof body.csv !== "string" || typeof body.sourceName !== "string" || body.sourceName.length > 240) {
      return NextResponse.json({ error: "学生名单请求无效。" }, { status: 400 });
    }
    const students = parseStudentRosterCsv(body.csv);
    const result = await importStudentRoster({ students, sourceName: body.sourceName, signal: request.signal });
    return NextResponse.json({ result, data: await readEducationContract() });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: "名单文件过大。" }, { status: 413 });
    if (error instanceof StudentRosterError) return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "学生名单导入失败。" }, { status: 503 });
  }
}
