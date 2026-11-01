import { NextResponse } from "next/server";
import { readDynamicWorkflowRun } from "@/lib/edupi-dynamic-workflow";
import { isApiRequestAllowed } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "请求无效" }, { status: 403 });
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(sessionId)) return NextResponse.json({ error: "会话 ID 无效" }, { status: 400 });
  try {
    return NextResponse.json({ run: readDynamicWorkflowRun(sessionId) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "工作流状态暂不可用" }, { status: 503 });
  }
}
