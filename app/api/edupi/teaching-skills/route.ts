import { NextResponse } from "next/server";
import { isApiRequestAllowed, hasJsonContentType } from "@/lib/request-security";
import { parseJsonWithinLimit } from "@/lib/bounded-form-data";
import { resolveEduPiBridgeRoots } from "@/lib/edupi-core-snapshot";
import { runCoreProcess } from "@/lib/edupi-core-process-client";

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request) || !hasJsonContentType(request)) return NextResponse.json({ error: "请求无效" }, { status: 403 });
  try {
    const body = await parseJsonWithinLimit(request, 20000) as Record<string, unknown>;
    if (!body || !["create", "review"].includes(String(body.action)) || Object.keys(body).some(key => !["action", "title", "content", "skill_id", "decision"].includes(key))) return NextResponse.json({ error: "方法操作无效" }, { status: 400 });
    const roots = resolveEduPiBridgeRoots();
    const result = await runCoreProcess<{ ok: boolean }>({ ...roots, timeoutMs: 10000, request: { ...body, protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop", request_id: crypto.randomUUID(), operation: "teaching-skills" } });
    if (!result.ok) throw new Error();
    return NextResponse.json(result);
  } catch { return NextResponse.json({ error: "方法保存失败，请核对内容或刷新重试" }, { status: 503 }); }
}
