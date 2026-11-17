import { NextResponse } from "next/server";
import { parseJsonWithinLimit } from "@/lib/bounded-form-data";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { classroomService, ClassroomError } from "@/lib/edupi-classroom-server";
import type { ClassroomRequest } from "@/lib/edupi-classroom-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "请求被拒绝。" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "请使用 JSON 请求。" }, { status: 415 });
  try {
    const body = await parseJsonWithinLimit(request, 2 * 1024 * 1024) as ClassroomRequest;
    if (!body || typeof body !== "object" || !["grades", "seating", "duty"].includes(body.domain)
      || !["roster", "list", "read", "preview", "save", "restore", "publish"].includes(body.action)
      || Object.keys(body).some(key => !["domain", "action", "id", "expected_revision", "revision", "input", "request_id"].includes(key))) {
      return NextResponse.json({ error: "班级操作无效。" }, { status: 400 });
    }
    return NextResponse.json(await classroomService(body, request.signal));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "操作失败。", code: error instanceof ClassroomError ? error.code : "unavailable" },
      { status: error instanceof ClassroomError ? error.code === "stale_revision" ? 409 : 400 : 503 });
  }
}
