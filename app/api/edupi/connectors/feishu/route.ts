import { NextResponse } from "next/server";
import { runCoreProcess } from "@/lib/edupi-core-process-client";
import { resolveEduPiBridgeRoots } from "@/lib/edupi-core-snapshot";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const identity = { protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop", operation: "connector-setup" } as const;

export async function GET() {
  try {
    const roots = resolveEduPiBridgeRoots();
    const response = await runCoreProcess<Record<string, unknown>>({ runtime: roots.runtime, dataRoot: roots.dataRoot, request: { ...identity, request_id: `feishu-manifest-${Date.now().toString(36)}`, connector_id: "feishu", action: "manifest" }, timeoutMs: 5_000 });
    return NextResponse.json(response);
  } catch {
    return NextResponse.json({ ok: false, error: "飞书配置清单不可用" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ ok: false, error: "请求被拒绝" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ ok: false, error: "请求格式无效" }, { status: 415 });
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 4096) return NextResponse.json({ ok: false, error: "请求过大" }, { status: 413 });
  try {
    const body = await request.json() as { appId?: unknown; appSecret?: unknown };
    const appId = typeof body.appId === "string" ? body.appId.trim() : "";
    const appSecret = typeof body.appSecret === "string" ? body.appSecret.trim() : "";
    if (!/^cli_[A-Za-z0-9]{8,64}$/u.test(appId) || appSecret.length < 16 || appSecret.length > 128) return NextResponse.json({ ok: false, error: "App ID 或 App Secret 格式不正确" }, { status: 400 });
    const roots = resolveEduPiBridgeRoots();
    const response = await runCoreProcess<Record<string, unknown>>({ runtime: roots.runtime, dataRoot: roots.dataRoot, request: { ...identity, request_id: `feishu-configure-${Date.now().toString(36)}`, connector_id: "feishu", action: "configure", app_id: appId, app_secret: appSecret }, timeoutMs: 10_000 });
    if (response.ok !== true) return NextResponse.json({ ok: false, error: "连接验证失败，请检查应用信息和网络" }, { status: 400 });
    return NextResponse.json({ ok: true, connectorId: "feishu", status: "configured" });
  } catch {
    return NextResponse.json({ ok: false, error: "连接验证失败，请稍后重试" }, { status: 502 });
  }
}
