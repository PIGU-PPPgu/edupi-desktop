import { NextResponse } from "next/server";
import { parseFormDataWithinLimit } from "@/lib/bounded-form-data";
import { isApiRequestAllowed } from "@/lib/request-security";
import { previewStudentRosterFile } from "@/lib/edupi-student-roster-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "请求被拒绝。" }, { status: 403 });
  try {
    const form = await parseFormDataWithinLimit(request, 6 * 1024 * 1024);
    const file = form.get("file");
    if (!(file instanceof File) || [...form.keys()].some(key => key !== "file")) return NextResponse.json({ error: "请选择成绩文件。" }, { status: 400 });
    return NextResponse.json({ source_name: file.name, sheets: previewStudentRosterFile(new Uint8Array(await file.arrayBuffer()), file.name) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "成绩文件无法读取。" }, { status: 400 });
  }
}
