import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { runCoreProcess } from "@/lib/edupi-core-process-client";
import { resolveEduPiBridgeRoots } from "@/lib/edupi-core-snapshot";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

type Registration = { deviceCode: string; expiresAt: number; nextPollAt: number; intervalMs: number };
declare global { var __edupiDingTalkRegistrations: Map<string, Registration> | undefined; }
const registrations = globalThis.__edupiDingTalkRegistrations ??= new Map<string, Registration>();
const REGISTRATION_ORIGIN = "https://oapi.dingtalk.com";
const REGISTRATION_SOURCE = "DING_DWS_CLAW";

async function registrationRequest(path: "/app/registration/init" | "/app/registration/begin" | "/app/registration/poll", data: Record<string, string>) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${REGISTRATION_ORIGIN}${path}`, { method: "POST", redirect: "error", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data), signal: controller.signal });
    const body = await response.json() as Record<string, unknown>;
    if (!response.ok || body.errcode !== 0) throw new Error("registration unavailable");
    return body;
  } finally { clearTimeout(timer); }
}

function allowed(request: Request) { return isApiRequestAllowed(request) && hasJsonContentType(request) && Number(request.headers.get("content-length") || 0) <= 4096; }
function officialVerificationUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("verification URL unavailable");
  const url = new URL(value); const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || (host !== "dingtalk.com" && !host.endsWith(".dingtalk.com"))) throw new Error("verification URL unavailable");
  return url.toString();
}

export async function POST(request: Request) {
  if (!allowed(request)) return NextResponse.json({ ok: false, error: "请求被拒绝" }, { status: 403 });
  try {
    const body = await request.json() as { action?: unknown; registrationId?: unknown };
    if (body.action === "start") {
      const initialized = await registrationRequest("/app/registration/init", { source: REGISTRATION_SOURCE });
      if (typeof initialized.nonce !== "string" || !initialized.nonce.trim()) throw new Error("registration unavailable");
      const begun = await registrationRequest("/app/registration/begin", { nonce: initialized.nonce });
      if (typeof begun.device_code !== "string" || !begun.device_code.trim()) throw new Error("registration unavailable");
      const verificationUrl = officialVerificationUrl(begun.verification_uri_complete);
      const expiresIn = typeof begun.expires_in === "number" ? Math.min(7_200, Math.max(60, begun.expires_in)) : 7_200;
      const interval = typeof begun.interval === "number" ? Math.min(30, Math.max(1, begun.interval)) : 3;
      const registrationId = randomUUID();
      registrations.set(registrationId, { deviceCode: begun.device_code, expiresAt: Date.now() + expiresIn * 1000, nextPollAt: Date.now() + interval * 1000, intervalMs: interval * 1000 });
      return NextResponse.json({ ok: true, status: "authorization_required", registrationId, verificationUrl, expiresIn, permissionMode: "official_template" });
    }
    if (body.action === "poll" && typeof body.registrationId === "string") {
      const registration = registrations.get(body.registrationId);
      if (!registration || registration.expiresAt <= Date.now()) { registrations.delete(body.registrationId); return NextResponse.json({ ok: false, error: "授权已过期，请重新开始" }, { status: 410 }); }
      if (Date.now() < registration.nextPollAt) return NextResponse.json({ ok: true, status: "pending" }, { status: 202 });
      registration.nextPollAt = Date.now() + registration.intervalMs;
      const polled = await registrationRequest("/app/registration/poll", { device_code: registration.deviceCode });
      const status = typeof polled.status === "string" ? polled.status.toUpperCase() : "UNKNOWN";
      if (status === "WAITING") return NextResponse.json({ ok: true, status: "pending" }, { status: 202 });
      if (status === "EXPIRED") { registrations.delete(body.registrationId); return NextResponse.json({ ok: false, error: "授权已过期，请重新开始" }, { status: 410 }); }
      if (status !== "SUCCESS" || typeof polled.client_id !== "string" || typeof polled.client_secret !== "string") { registrations.delete(body.registrationId); return NextResponse.json({ ok: false, error: "钉钉未完成本次授权" }, { status: 400 }); }
      const roots = resolveEduPiBridgeRoots();
      const configured = await runCoreProcess<Record<string, unknown>>({ runtime: roots.runtime, dataRoot: roots.dataRoot, request: { protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop", operation: "connector-setup", request_id: `dingtalk-register-${Date.now().toString(36)}`, connector_id: "dingtalk", action: "configure", client_id: polled.client_id, client_secret: polled.client_secret }, timeoutMs: 10_000 });
      registrations.delete(body.registrationId);
      if (configured.ok !== true || configured.status !== "credentials_verified") return NextResponse.json({ ok: false, error: "应用已创建，但连接验证失败" }, { status: 502 });
      return NextResponse.json({ ok: true, status: "credentials_verified", connectorId: "dingtalk" });
    }
    return NextResponse.json({ ok: false, error: "操作无效" }, { status: 400 });
  } catch { return NextResponse.json({ ok: false, error: "钉钉一键授权暂不可用" }, { status: 502 }); }
}
