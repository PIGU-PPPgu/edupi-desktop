import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { isDesktopApiRequestAllowed } from "@/lib/desktop-api-auth";
import { createEduPiRecallSettingsService, recallServerError } from "@/lib/edupi-recall-settings-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const service = createEduPiRecallSettingsService();
const json = (value: unknown, status = 200) => Response.json(value, {
  status, headers: { "cache-control": "no-store" },
});
const error = (code: string, status: number) => json({ version: 1, status: "rejected", reasonCode: code }, status);
export async function GET(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return error("recall_forbidden", 403);
  try { return json(await service.get()); }
  catch (cause) { const failure = recallServerError(cause); return error(failure.code, failure.status); }
}
export async function POST(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return error("recall_forbidden", 403);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return error("recall_json_required", 415);
  }
  try { return json(await service.update(await parseJsonWithinLimit(request, 4096))); }
  catch (cause) {
    if (cause instanceof RequestBodyTooLargeError) return error("recall_body_too_large", 413);
    const failure = recallServerError(cause); return error(failure.code, failure.status);
  }
}
