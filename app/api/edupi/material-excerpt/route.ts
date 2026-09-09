import { NextResponse } from "next/server";
import { readEducationContract } from "@/lib/edupi-education-server";
import { resolveEduPiBridgeRoots } from "@/lib/edupi-core-snapshot";
import { runCoreProcess } from "@/lib/edupi-core-process-client";
import { isApiRequestAllowed, hasJsonContentType } from "@/lib/request-security";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";

export const dynamic = "force-dynamic";
type Excerpt = { material_id: string; revision: number; status: "confirmed" | "withdrawn"; content: string };
const fail = (code: string) => Object.assign(new Error(code), { code });
async function scope(materialId: unknown) {
  if (typeof materialId !== "string" || !materialId.trim() || materialId.length > 160) throw fail("invalid_input");
  const data = await readEducationContract();
  const material = data.teacherMaterials?.find(item => item.material_id === materialId);
  if (!material || material.available === false) throw fail("material_unavailable");
  if (!material.subject?.trim() || !material.class_id?.trim()) throw fail("scope_missing");
  return { materialId, subject: material.subject, classId: material.class_id };
}
async function invoke(action: "read" | "review", input: Record<string, unknown>, signal: AbortSignal) {
  const result = await runCoreProcess<{ ok: boolean; code?: string; excerpt: Excerpt | null }>({ ...resolveEduPiBridgeRoots(), timeoutMs: 10000, signal, request: { protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop", request_id: crypto.randomUUID(), operation: "g1-excerpt", action, input } });
  if (!result.ok) throw fail(result.code || "unavailable");
  return result.excerpt;
}
function errorResponse(error: unknown) {
  if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: "正文不能超过16 KB" }, { status: 400 });
  const code = (error as { code?: string })?.code;
  if (code === "invalid_input" || code === "invalid_review") return NextResponse.json({ error: "正文不能为空且不能超过16 KB，操作参数需完整" }, { status: 400 });
  if (code === "scope_missing") return NextResponse.json({ error: "请先为材料设置学科和班级" }, { status: 409 });
  if (code === "stale_revision" || code === "stale_source") return NextResponse.json({ error: "材料或正文版本已变化，请刷新版本后重新核对", conflict: true }, { status: 409 });
  if (code === "material_unavailable" || code === "source_unavailable") return NextResponse.json({ error: "已接入材料不可用，请检查原文件" }, { status: 404 });
  return NextResponse.json({ error: "正文读取或保存未确认，请重试" }, { status: 503 });
}
export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "请求无效" }, { status: 403 });
  try { const input = await scope(new URL(request.url).searchParams.get("materialId")); return NextResponse.json({ excerpt: await invoke("read", input, request.signal) }); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  if (!isApiRequestAllowed(request) || !hasJsonContentType(request)) return NextResponse.json({ error: "请求无效" }, { status: 403 });
  try {
    const body = await parseJsonWithinLimit(request, 100000) as Record<string, unknown> | null;
    if (!body || Array.isArray(body) || Object.keys(body).some(key => !["materialId", "expectedRevision", "content", "decision"].includes(key)) || !["confirm", "withdraw"].includes(String(body.decision)) || !Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 0 || typeof body.content !== "string" || Buffer.byteLength(body.content) > 16384 || body.decision === "confirm" && !body.content.trim()) throw fail("invalid_input");
    const input = await scope(body.materialId);
    const current = await invoke("read", input, request.signal);
    if ((current?.revision || 0) !== body.expectedRevision) throw fail("stale_revision");
    await invoke("review", { ...input, expectedRevision: body.expectedRevision, content: body.content, decision: body.decision, reviewer: "teacher" }, request.signal);
    const excerpt = await invoke("read", input, request.signal);
    if (!excerpt || excerpt.revision !== Number(body.expectedRevision) + 1 || excerpt.status !== (body.decision === "confirm" ? "confirmed" : "withdrawn") || body.decision === "confirm" && excerpt.content !== body.content) throw fail("stale_revision");
    return NextResponse.json({ excerpt });
  } catch (error) { return errorResponse(error); }
}
