import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import {
  EduPiRegistrationError,
  readEduPiRegistration,
  registerEduPi,
} from "@/lib/edupi-registration";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 512;
const ATTEMPT_LIMIT = 8;
const ATTEMPT_WINDOW_MS = 60_000;

type AttemptState = { failures: number; windowStartedAt: number };

declare global {
  var __edupiRegistrationAttempts: AttemptState | undefined;
}

function json(body: unknown, status = 200, headers?: HeadersInit): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

function attempts(now = Date.now()): AttemptState {
  const current = globalThis.__edupiRegistrationAttempts;
  if (!current || now - current.windowStartedAt >= ATTEMPT_WINDOW_MS) {
    const next = { failures: 0, windowStartedAt: now };
    globalThis.__edupiRegistrationAttempts = next;
    return next;
  }
  return current;
}

function invalidBody(reason: string): NextResponse {
  return json({ error: "invalid_registration", reason }, 400);
}

function exactInviteBody(value: unknown): { inviteCode: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || typeof record.inviteCode !== "string") return null;
  if (!record.inviteCode.trim() || record.inviteCode.length > 128) return null;
  return { inviteCode: record.inviteCode };
}

export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) return json({ error: "forbidden" }, 403);
  try {
    return json(readEduPiRegistration());
  } catch {
    return json({
      error: "registration_unavailable",
      reason: "本机注册状态暂不可用。",
    }, 500);
  }
}

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return json({ error: "forbidden" }, 403);
  if (!hasJsonContentType(request)) return json({ error: "json_required" }, 415);

  let body: { inviteCode: string } | null;
  try {
    body = exactInviteBody(await parseJsonWithinLimit(request, MAX_BODY_BYTES));
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json({ error: "request_too_large" }, 413);
    }
    return invalidBody("请求必须是有效的 JSON 对象。");
  }
  if (!body) return invalidBody("仅支持一个有效的 inviteCode 字段。");

  const currentAttempts = attempts();
  if (currentAttempts.failures >= ATTEMPT_LIMIT) {
    return json(
      { error: "too_many_attempts", reason: "尝试次数过多，请一分钟后再试。" },
      429,
      { "Retry-After": "60" },
    );
  }

  try {
    const before = readEduPiRegistration();
    const state = registerEduPi(body.inviteCode);
    globalThis.__edupiRegistrationAttempts = undefined;
    return json(state, before.registered ? 200 : 201);
  } catch (error) {
    if (error instanceof EduPiRegistrationError) {
      if (error.code === "invalid_invite") {
        currentAttempts.failures += 1;
        return json({ error: "invalid_invite", reason: "邀请码不正确。" }, 401);
      }
      if (error.code === "validator_unavailable") {
        return json({ error: "registration_unavailable", reason: "邀请码校验暂不可用。" }, 503);
      }
    }
    return json({ error: "registration_unavailable", reason: "本机注册状态暂不可用。" }, 500);
  }
}
