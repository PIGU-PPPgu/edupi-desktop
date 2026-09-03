import { NextResponse } from "next/server";
import { runCoreProcess } from "@/lib/edupi-core-process-client";
import { resolveEduPiBridgeRoots } from "@/lib/edupi-core-snapshot";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

const identity = { protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop", operation: "connector-setup", connector_id: "dingtalk" } as const;
export async function GET() { try { const roots = resolveEduPiBridgeRoots(); return NextResponse.json(await runCoreProcess({ runtime: roots.runtime, dataRoot: roots.dataRoot, request: { ...identity, request_id: `dingtalk-manifest-${Date.now().toString(36)}`, action: "manifest" }, timeoutMs: 5_000 })); } catch { return NextResponse.json({ ok: false, error: "钉钉配置清单不可用" }, { status: 503 }); } }
export async function POST(request: Request) {
  if (!isApiRequestAllowed(request) || !hasJsonContentType(request)) return NextResponse.json({ ok: false, error: "请求被拒绝" }, { status: 403 });
  try {
    const body = await request.json() as { clientId?: unknown; clientSecret?: unknown };
    const clientId = typeof body.clientId === "string" ? body.clientId.trim() : ""; const clientSecret = typeof body.clientSecret === "string" ? body.clientSecret.trim() : "";
    if (!/^[A-Za-z0-9_-]{8,128}$/u.test(clientId) || clientSecret.length < 16 || clientSecret.length > 128) return NextResponse.json({ ok: false, error: "Client ID 或 Client Secret 格式不正确" }, { status: 400 });
    const roots = resolveEduPiBridgeRoots();
    const result = await runCoreProcess<Record<string, unknown>>({ runtime: roots.runtime, dataRoot: roots.dataRoot, request: { ...identity, request_id: `dingtalk-configure-${Date.now().toString(36)}`, action: "configure", client_id: clientId, client_secret: clientSecret }, timeoutMs: 10_000 });
    return result.ok === true ? NextResponse.json({ ok: true, status: "credentials_verified" }) : NextResponse.json({ ok: false, error: "钉钉连接验证失败" }, { status: 400 });
  } catch { return NextResponse.json({ ok: false, error: "钉钉连接验证失败" }, { status: 502 }); }
}
