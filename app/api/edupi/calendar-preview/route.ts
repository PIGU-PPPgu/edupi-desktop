import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { isDesktopApiRequestAllowed } from "@/lib/desktop-api-auth";
import { hasJsonContentType } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return NextResponse.json({ error: "请求无效" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "请使用 JSON" }, { status: 415 });
  try {
    const body = await parseJsonWithinLimit(request, 1024);
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "请求字段无效", code: "invalid_envelope" }, { status: 400 });
    const input = body as Record<string, unknown>;
    if (Object.keys(input).length !== 1 || typeof input.stagingId !== "string" || !/^stg_[a-f0-9]{32}$/u.test(input.stagingId)) {
      return NextResponse.json({ error: "请求字段无效", code: "invalid_envelope" }, { status: 400 });
    }
    return NextResponse.json({ error: "请先接收材料，再读取安排提案。", code: "file_schedule_update_unavailable" }, { status: 409 });
  } catch (error) {
    return NextResponse.json({ error: "请求无效", code: error instanceof RequestBodyTooLargeError ? "too_large" : "invalid_envelope" },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
  }
}
