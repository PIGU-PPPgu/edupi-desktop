import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { planOverlaps } from "@/lib/edupi-plan-overlaps";
import type { PlanOverlapAction } from "@/lib/edupi-plan-overlap-types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "请求被拒绝。" }, { status: 403 });
  try { return NextResponse.json(await planOverlaps()); } catch { return NextResponse.json({ version: "", needsScan: true, pairs: 0, suggestions: [], error: "计划检查暂不可用。" }, { status: 503 }); }
}
export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "请求被拒绝。" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "请使用 JSON。" }, { status: 415 });
  try {
    const body = await parseJsonWithinLimit(request, 4096) as Record<string, unknown>;
    if (!body || !["scan", "merge", "keep_separate", "ignore"].includes(String(body.action)) || Object.keys(body).some(key => !["action", "id", "keepId"].includes(key)) || (body.action !== "scan" && (typeof body.id !== "string" || body.id.length !== 64)) || (body.keepId !== undefined && (typeof body.keepId !== "string" || body.keepId.length > 160))) return NextResponse.json({ error: "计划操作无效。" }, { status: 400 });
    return NextResponse.json(await planOverlaps(body as PlanOverlapAction));
  } catch (error) {
    const state = await planOverlaps().catch(() => ({ version: "", needsScan: true, pairs: 0, suggestions: [] }));
    return NextResponse.json({ ...state, error: error instanceof Error ? error.message : "操作未完成，请重试。" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 409 });
  }
}
