import { NextResponse } from "next/server";
import { isDesktopApiRequestAllowed } from "@/lib/desktop-api-auth";
import { hasJsonContentType } from "@/lib/request-security";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { resolveEduPiBridgeRoots } from "@/lib/edupi-core-snapshot";
import { ensureEduPiRuntime } from "@/lib/edupi-runtime-supervisor";
import { createTeacherUsageService, validateTeacherUsageRequest } from "@/lib/edupi-teacher-usage-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 8 * 1024;
function failure(error: unknown) {
  const rawCode = error && typeof error === "object" && "code" in error ? error.code : null;
  const code = error instanceof RequestBodyTooLargeError ? "usage_body_too_large"
    : typeof rawCode === "string" && /^[a-z0-9_]{1,100}$/u.test(rawCode) ? rawCode : "teacher_usage_unavailable";
  const status = code === "usage_body_too_large" ? 413 : code === "teacher_usage_invalid_request" ? 400
    : /consent|conflict|stale|documents|uninitialized|capacity/u.test(code) ? 409 : 503;
  return NextResponse.json({ ok: false, errorCode: code, externalSend: false }, { status });
}
async function service() {
  const roots = resolveEduPiBridgeRoots();
  const host = await ensureEduPiRuntime(roots);
  return createTeacherUsageService({ host, dataRoot: roots.dataRoot.root, stateDir: process.env.PI_DESKTOP_STATE_DIR || "" });
}
export async function GET(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return NextResponse.json({ ok: false, externalSend: false }, { status: 403 });
  try {
    const url = new URL(request.url);
    if ([...url.searchParams.keys()].some(key => key !== "documents") || url.searchParams.has("documents") && url.searchParams.get("documents") !== "1") return failure({ code: "teacher_usage_invalid_request" });
    return NextResponse.json({ ok: true, ...await (await service()).read(url.searchParams.get("documents") === "1") });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  if (!isDesktopApiRequestAllowed(request) || !hasJsonContentType(request)) return NextResponse.json({ ok: false, externalSend: false }, { status: 403 });
  try {
    const body = validateTeacherUsageRequest(await parseJsonWithinLimit(request, MAX_BODY_BYTES));
    return NextResponse.json({ ok: true, result: await (await service()).perform(body), externalSend: false });
  } catch (error) { return failure(error); }
}
