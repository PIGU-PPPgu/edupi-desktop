import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { isDesktopApiRequestAllowed } from "@/lib/desktop-api-auth";
import { hasJsonContentType } from "@/lib/request-security";
import { parseGitHubVerificationOperation } from "@/lib/openconnector-verification-contract";
import {
  GitHubVerificationError, readGitHubVerificationStatus, runGitHubVerificationOperation,
} from "@/lib/openconnector-verification-process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reply(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown) {
  const code = error instanceof GitHubVerificationError ? error.code : "github_verification_unavailable";
  const status = code === "github_verification_busy" ? 429
    : code === "github_verification_unsupported" ? 501
      : code === "github_connection_changed" || code === "github_account_changed" || code === "github_request_conflict" ? 409
        : code === "github_login_required" ? 400 : 503;
  return reply({ ok: false, code }, status);
}

export async function GET(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return reply({ ok: false, code: "desktop_authorization_required" }, 403);
  try {
    return reply({ ok: true, data: await readGitHubVerificationStatus() }, 200);
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return reply({ ok: false, code: "desktop_authorization_required" }, 403);
  if (!hasJsonContentType(request)) return reply({ ok: false, code: "invalid_verification_request" }, 415);
  let operation;
  try {
    operation = parseGitHubVerificationOperation(await parseJsonWithinLimit(request, 1024));
  } catch (error) {
    return reply({ ok: false, code: error instanceof RequestBodyTooLargeError ? "verification_request_too_large" : "invalid_verification_request" }, error instanceof RequestBodyTooLargeError ? 413 : 400);
  }
  if (!operation) return reply({ ok: false, code: "invalid_verification_request" }, 400);
  try {
    return reply({ ok: true, data: await runGitHubVerificationOperation(operation) }, 200);
  } catch (error) { return failure(error); }
}
