import { NextResponse } from "next/server";
import { isApiRequestAllowed, hasJsonContentType } from "@/lib/request-security";
import { parseJsonWithinLimit } from "@/lib/bounded-form-data";
import { eduPiRecallService, isEduPiRecallReady } from "@/lib/edupi-recall-server";

export const dynamic = "force-dynamic";
const reply = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) return reply({ error: "请求无效" }, 403);
  return reply({ version: 1, enabled: await isEduPiRecallReady() });
}

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request) || !hasJsonContentType(request)) return reply({ error: "请求无效" }, 403);
  try {
    const value = await parseJsonWithinLimit(request, 4096) as Record<string, unknown>;
    if (!value || Array.isArray(value) || Object.keys(value).sort().join(",") !== "receiptId,sessionId,userEntryId"
      || [value.receiptId, value.sessionId, value.userEntryId].some(item => typeof item !== "string" || !item || item.length > 160)) {
      return reply({ error: "操作无效" }, 400);
    }
    return reply(await eduPiRecallService.answerState(value as { sessionId: string; userEntryId: string; receiptId: string }));
  } catch { return reply({ version: 1, status: "held", reasonCode: "source_unavailable" }); }
}
