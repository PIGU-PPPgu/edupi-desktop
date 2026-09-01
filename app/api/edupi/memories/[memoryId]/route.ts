import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { updateEducationMemory } from "@/lib/edupi-education-server";
import { MemoryUpdateError } from "@/lib/edupi-memory-update";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;
const BODY_KEYS = new Set(["expectedRevision", "content"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function statusFor(code: string): number {
  if (code === "invalid_envelope") return 400;
  if (code === "target_not_found") return 404;
  if (code === "stale_snapshot" || code === "stale_revision") return 409;
  return 503;
}

export async function POST(request: Request, { params }: { params: Promise<{ memoryId: string }> }) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Memory update request rejected", code: "forbidden" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "Use application/json", code: "invalid_content_type" }, { status: 415 });
  try {
    const memoryId = (await params).memoryId;
    if (typeof memoryId !== "string" || !memoryId.trim() || memoryId.length > 160 || /[\u0000-\u001f\u007f]/.test(memoryId)) throw new MemoryUpdateError("invalid_envelope", "memoryId 无效。");
    const body = record(await parseJsonWithinLimit(request, MAX_BODY_BYTES));
    if (!body || Object.keys(body).some((key) => !BODY_KEYS.has(key))
      || !Number.isInteger(body.expectedRevision) || Number(body.expectedRevision) < 0
      || typeof body.content !== "string" || !body.content.trim() || body.content.length > 4000) {
      throw new MemoryUpdateError("invalid_envelope", "记忆修改字段无效。");
    }
    const result = await updateEducationMemory({ memoryId: memoryId.trim(), expectedRevision: Number(body.expectedRevision), content: body.content.trim(), reviewerId: "teacher" });
    return NextResponse.json({ receipt: result.receipt, data: result.data }, { status: 200 });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: "Memory update request is too large", code: "too_large" }, { status: 413 });
    const code = error instanceof MemoryUpdateError ? error.code : "unavailable";
    return NextResponse.json({ error: error instanceof MemoryUpdateError ? error.message : "记忆修改暂不可用", code }, { status: statusFor(code) });
  }
}
