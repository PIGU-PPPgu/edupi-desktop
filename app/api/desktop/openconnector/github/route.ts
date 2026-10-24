import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { isDesktopApiRequestAllowed } from "@/lib/desktop-api-auth";
import { hasJsonContentType } from "@/lib/request-security";
import { parseGitHubOAuthOperation } from "@/lib/openconnector-github-contract";
import { GitHubManagerError, readGitHubOAuthStatus, runGitHubOAuthOperation } from "@/lib/openconnector-github-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reply(body: unknown, status: number) { return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } }); }
function failure(error: unknown) {
  const code = error instanceof GitHubManagerError ? error.code : "github_oauth_unavailable";
  const status = code === "github_acceptance_disabled" ? 403 : code === "github_oauth_busy" ? 429 : code === "github_oauth_unsupported" ? 501
    : ["github_connection_changed", "github_account_changed", "github_authorization_required", "github_refresh_token_required", "github_oauth_connection_required", "github_authorization_changed", "github_request_conflict", "github_draft_changed", "github_write_already_started"].includes(code) ? 409
      : code === "github_client_required" ? 400 : 503;
  return reply({ ok: false, code }, status);
}
export async function GET(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return reply({ ok: false, code: "desktop_authorization_required" }, 403);
  try { return reply({ ok: true, data: await readGitHubOAuthStatus() }, 200); } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return reply({ ok: false, code: "desktop_authorization_required" }, 403);
  if (!hasJsonContentType(request)) return reply({ ok: false, code: "invalid_github_request" }, 415);
  let operation;
  try { operation = parseGitHubOAuthOperation(await parseJsonWithinLimit(request, 4096)); }
  catch (error) { return reply({ ok: false, code: error instanceof RequestBodyTooLargeError ? "github_request_too_large" : "invalid_github_request" }, error instanceof RequestBodyTooLargeError ? 413 : 400); }
  if (!operation) return reply({ ok: false, code: "invalid_github_request" }, 400);
  try { return reply({ ok: true, data: await runGitHubOAuthOperation(operation) }, 200); } catch (error) { return failure(error); }
}
