import { NextResponse } from "next/server";
import { isApiRequestAllowed } from "@/lib/request-security";
import { resolveEduPiBridgeRoots } from "@/lib/edupi-core-snapshot";
import { runCoreProcess } from "@/lib/edupi-core-process-client";

export async function GET(request: Request, { params }: { params: Promise<{ memoryId: string }> }) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "请求无效" }, { status: 403 });
  const { memoryId: id } = await params;
  if (!id || id.length > 160) return NextResponse.json({ error: "记忆标识无效" }, { status: 400 });
  try {
    const roots = resolveEduPiBridgeRoots();
    const result = await runCoreProcess<{ ok: boolean; history: unknown[] }>({ ...roots, timeoutMs: 5000, request: { protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop", request_id: crypto.randomUUID(), operation: "memory-scopes", action: "history", memory_id: id } });
    if (!result.ok) throw new Error();
    return NextResponse.json({ history: result.history });
  } catch { return NextResponse.json({ error: "历史记录暂不可用" }, { status: 503 }); }
}
