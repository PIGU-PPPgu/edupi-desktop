import { NextResponse } from "next/server";
import { runCoreProcess } from "@/lib/edupi-core-process-client";
import { resolveEduPiBridgeRoots } from "@/lib/edupi-core-snapshot";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request) || !hasJsonContentType(request) || Number(request.headers.get("content-length") || 0) > 1024) return NextResponse.json({ ok: false, error: "请求被拒绝" }, { status: 403 });
  try {
    const body = await request.json() as { action?: unknown };
    if (body.action !== "ensure") return NextResponse.json({ ok: false, error: "操作无效" }, { status: 400 });
    const roots = resolveEduPiBridgeRoots();
    const result = await runCoreProcess<Record<string, unknown>>({ runtime: roots.runtime, dataRoot: roots.dataRoot, request: { protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop", operation: "connector-setup", request_id: `dingtalk-runtime-${Date.now().toString(36)}`, connector_id: "dingtalk", action: "start_runtime" }, timeoutMs: 8_000 });
    return NextResponse.json(result, { status: result.ok === true ? 200 : result.status === "not_configured" ? 409 : 503 });
  } catch { return NextResponse.json({ ok: false, error: "钉钉运行时启动失败" }, { status: 503 }); }
}
