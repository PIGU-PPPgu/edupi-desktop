import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { DESKTOP_API_TOKEN_ENV } from "@/lib/desktop-api";
import { isDesktopApiRequestAllowed } from "@/lib/desktop-api-auth";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { AccountError, parseAction } from "@/lib/edupi-account-protocol";
import { createAccountService } from "@/lib/edupi-account-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private", Pragma: "no-cache" };

function allowed(request: Request): boolean {
  if (!isApiRequestAllowed(request)) return false;
  try {
    const hostname = new URL(`http://${request.headers.get("host")}`).hostname;
    if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) return false;
    return !process.env[DESKTOP_API_TOKEN_ENV] || isDesktopApiRequestAllowed(request);
  } catch { return false; }
}
function failure(error: unknown) {
  if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: "账号请求过大。", code: "request_limit" }, { status: 413, headers });
  if (error instanceof SyntaxError) return NextResponse.json({ error: "账号请求格式无效。", code: "invalid_request" }, { status: 400, headers });
  return NextResponse.json({ error: error instanceof AccountError ? error.message : "账号操作暂不可用，请稍后重试。",
    code: error instanceof AccountError ? error.code : "account_unavailable" },
  { status: error instanceof AccountError ? error.status : 503, headers });
}
export async function GET(request: Request) {
  if (!allowed(request)) return NextResponse.json({ error: "请求被拒绝。" }, { status: 403, headers });
  try { return NextResponse.json(await createAccountService().status(), { headers }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  if (!allowed(request)) return NextResponse.json({ error: "请求被拒绝。" }, { status: 403, headers });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "请使用 JSON 请求。" }, { status: 415, headers });
  try {
    const action = parseAction(await parseJsonWithinLimit(request, 2048));
    return NextResponse.json(await createAccountService().act(action, request.signal), { headers });
  } catch (error) { return failure(error); }
}
