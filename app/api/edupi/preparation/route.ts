import { NextResponse } from "next/server";
import { preparationStatus, startPreparation, ensurePreparation } from "@/lib/edupi-preparation-runtime";
import { isApiRequestAllowed, hasJsonContentType } from "@/lib/request-security";
import { parseJsonWithinLimit } from "@/lib/bounded-form-data";

export const dynamic = "force-dynamic";
export async function GET() { return NextResponse.json(preparationStatus()); }
export async function POST(request: Request) {
  if (!isApiRequestAllowed(request) || !hasJsonContentType(request)) return NextResponse.json({ error: "请求无效" }, { status: 403 });
  try {
    const body = await parseJsonWithinLimit(request, 1024) as { action?: string } | null;
    if (!body || !["ensure", "run"].includes(body.action || "") || Object.keys(body).length !== 1) return NextResponse.json({ error: "操作无效" }, { status: 400 });
    return NextResponse.json(body.action === "ensure" ? ensurePreparation() : startPreparation());
  } catch { return NextResponse.json({ state: "error", error: "教育工作区暂不可用" }, { status: 503 }); }
}
