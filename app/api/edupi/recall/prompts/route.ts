import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { isDesktopApiRequestAllowed } from "@/lib/desktop-api-auth";
import { createEduPiRecallPromptService } from "@/lib/edupi-recall-prompt-server";
import { recallServerError } from "@/lib/edupi-recall-settings-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const service = createEduPiRecallPromptService();
const json = (value: unknown, status = 200) => Response.json(value, {
  status, headers: { "cache-control": "no-store" },
});
const error = (code: string, status: number) => json({ version: 1, status: "held", reasonCode: code, externalSend: false }, status);
export async function GET(request: Request) {
  const unavailable = (reasonCode: string, status: number) =>
    json({ version: 1, status: "unavailable", reasonCode, externalSend: false }, status);
  if (!isDesktopApiRequestAllowed(request)) return unavailable("recall_forbidden", 403);
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].sort().join(",") !== "clientRequestId,sessionId") {
    return unavailable("recall_invalid_input", 400);
  }
  try { return json(await service.inspect(params.get("sessionId")!, params.get("clientRequestId")!)); }
  catch (cause) { const failure = recallServerError(cause); return unavailable(failure.code, failure.status); }
}
export async function POST(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return error("recall_forbidden", 403);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return error("recall_json_required", 415);
  }
  try {
    const value = await service.submit(await parseJsonWithinLimit(request, 32_768));
    return json(value, value.status === "uncertain" ? 202 : value.status === "held" ? 409 : 200);
  } catch (cause) {
    if (cause instanceof RequestBodyTooLargeError) return error("recall_body_too_large", 413);
    const failure = recallServerError(cause); return error(failure.code, failure.status);
  }
}
