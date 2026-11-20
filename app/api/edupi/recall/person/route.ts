import { NextResponse } from "next/server";
import { isDesktopApiRequestAllowed } from "@/lib/desktop-api-auth";
import { hasJsonContentType } from "@/lib/request-security";
import { parseJsonWithinLimit } from "@/lib/bounded-form-data";
import { eduPiRecallService } from "@/lib/edupi-recall-server";

export const dynamic = "force-dynamic";
const reply = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });

/** No model tool exposes this owner-only, explicit teacher action. */
export async function POST(request: Request) {
  if (!isDesktopApiRequestAllowed(request) || !hasJsonContentType(request)) return reply({ error: "请求无效" }, 403);
  try {
    const value = await parseJsonWithinLimit(request, 4096) as Record<string, unknown>;
    if (!value || Array.isArray(value) || !["read", "confirm"].includes(String(value.action))
      || Object.keys(value).sort().join(",") !== (value.action === "read" ? "action,entryId,personName,sessionId" : "action,entryId,personName,previewId,sessionId")
      || [value.sessionId, value.entryId, value.personName].some(item => typeof item !== "string" || !item || item.length > 160)
      || value.action === "confirm" && (typeof value.previewId !== "string" || !value.previewId || value.previewId.length > 160)) {
      return reply({ error: "操作无效" }, 400);
    }
    return reply(await eduPiRecallService.person(value as { action: "read" | "confirm"; sessionId: string; entryId: string; personName: string; previewId?: string }));
  } catch { return reply({ error: "人物核对暂不可用" }, 503); }
}
