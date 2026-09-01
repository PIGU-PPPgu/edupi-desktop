import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { deleteEducationEntity } from "@/lib/edupi-education-server";
import { ENTITY_DELETE_KINDS, EntityDeleteError, type EntityDeleteKind } from "@/lib/edupi-entity-delete";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4 * 1024;
const BODY_KEYS = new Set(["note"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function statusFor(code: string): number {
  if (code === "invalid_request") return 400;
  if (code === "target_not_found") return 404;
  if (code === "stale_snapshot") return 409;
  return 503;
}

export async function DELETE(request: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "删除请求被拒绝。", code: "forbidden" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "请使用 JSON。", code: "invalid_content_type" }, { status: 415 });
  try {
    const { kind, id } = await params;
    const body = record(await parseJsonWithinLimit(request, MAX_BODY_BYTES));
    const note = body?.note;
    if (!ENTITY_DELETE_KINDS.includes(kind as EntityDeleteKind)
      || typeof id !== "string" || !id.trim() || id.length > 160 || /[\u0000-\u001f\u007f]/u.test(id)
      || !body || Object.keys(body).some((key) => !BODY_KEYS.has(key))
      || (note !== null && note !== undefined && (typeof note !== "string" || !note.trim() || note.length > 1000))) {
      throw new EntityDeleteError("invalid_request", "删除字段无效。");
    }
    const result = await deleteEducationEntity({ kind: kind as EntityDeleteKind, id: id.trim(), note: typeof note === "string" ? note.trim() : null, signal: request.signal });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: "删除请求过大。", code: "too_large" }, { status: 413 });
    const code = error instanceof EntityDeleteError ? error.code : "unavailable";
    return NextResponse.json({ error: error instanceof Error ? error.message : "删除暂不可用。", code }, { status: statusFor(code) });
  }
}
