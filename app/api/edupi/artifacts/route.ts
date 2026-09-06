import { NextResponse } from "next/server";
import { generatedArtifactsRequest, recoverSessionArtifacts } from "@/lib/edupi-generated-artifacts";
import { resolveSessionPath, readSessionHeader } from "@/lib/session-reader";
import { isApiRequestAllowed, hasJsonContentType } from "@/lib/request-security";
import { parseJsonWithinLimit } from "@/lib/bounded-form-data";

export const dynamic = "force-dynamic";
export async function GET() {
  try { return NextResponse.json(await generatedArtifactsRequest("list")); }
  catch { return NextResponse.json({ error: "生成文件索引暂不可用" }, { status: 503 }); }
}

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "需要 JSON 请求" }, { status: 415 });
  try {
    const body = await parseJsonWithinLimit(request, 4096) as { sessionId?: unknown };
    if (typeof body?.sessionId !== "string" || body.sessionId.length > 160) return NextResponse.json({ error: "会话无效" }, { status: 400 });
    const file = await resolveSessionPath(body.sessionId);
    const header = file ? readSessionHeader(file) : null;
    if (!file || !header?.cwd) return NextResponse.json({ error: "会话未找到" }, { status: 404 });
    return NextResponse.json(await recoverSessionArtifacts(file, header.cwd, body.sessionId));
  } catch { return NextResponse.json({ error: "文件同步失败，请重试" }, { status: 503 }); }
}
