import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { NextResponse } from "next/server";
import { runCoreProcess } from "@/lib/edupi-core-process-client";
import { resolveEduPiBridgeRoots } from "@/lib/edupi-core-snapshot";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

type Registration = { deviceCode: string; expiresAt: number; nextPollAt: number };
declare global { var __edupiFeishuRegistrations: Map<string, Registration> | undefined; }
const registrations = globalThis.__edupiFeishuRegistrations ??= new Map<string, Registration>();
const REGISTRATION_URL = "https://accounts.feishu.cn/oauth/v1/app/registration";

type Addons = { preset: true; scopes: { tenant: string[]; user: string[] }; events: { items: { tenant: string[] } }; callbacks: { items: string[] } };
function stringList(value: unknown, max: number): string[] { if (!Array.isArray(value) || value.length < 1 || value.length > max || value.some((item) => typeof item !== "string" || !item.trim())) throw new Error("invalid connector manifest"); return value as string[]; }
async function loadRegistrationAddons(): Promise<{ addons: Addons; requestedScopeCount: number }> {
  const roots = resolveEduPiBridgeRoots();
  const response = await runCoreProcess<Record<string, unknown>>({ runtime: roots.runtime, dataRoot: roots.dataRoot, request: { protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop", operation: "connector-setup", request_id: `feishu-manifest-${Date.now().toString(36)}`, connector_id: "feishu", action: "manifest" }, timeoutMs: 5_000 });
  const manifest = response.manifest as Record<string, unknown> | undefined;
  const baseAddons = manifest?.addons as Record<string, unknown> | undefined;
  const scopes = baseAddons?.scopes as Record<string, unknown> | undefined;
  const tenant = stringList(scopes?.tenant, 500); const user = stringList(scopes?.user, 500);
  const events = stringList(manifest?.events, 50); const callbacks = stringList(manifest?.callbacks, 50);
  if (manifest?.permission_mode !== "maximum_requested" || manifest?.requested_scope_count !== tenant.length + user.length) throw new Error("maximum permission manifest unavailable");
  return { addons: { preset: true, scopes: { tenant, user }, events: { items: { tenant: events } }, callbacks: { items: callbacks } }, requestedScopeCount: tenant.length + user.length };
}
function encodeAddons(addons: Addons): string { return gzipSync(Buffer.from(JSON.stringify(addons))).toString("base64url"); }
async function registrationRequest(data: Record<string, string>) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 8_000);
  try { const response = await fetch(REGISTRATION_URL, { method: "POST", redirect: "error", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(data), signal: controller.signal }); return await response.json() as Record<string, unknown>; }
  finally { clearTimeout(timer); }
}
function allowed(request: Request) { return isApiRequestAllowed(request) && hasJsonContentType(request) && Number(request.headers.get("content-length") || 0) <= 4096; }

export async function POST(request: Request) {
  if (!allowed(request)) return NextResponse.json({ ok: false, error: "请求被拒绝" }, { status: 403 });
  try {
    const body = await request.json() as { action?: unknown; registrationId?: unknown };
    if (body.action === "start") {
      const { addons, requestedScopeCount } = await loadRegistrationAddons();
      const begin = await registrationRequest({ action: "begin", archetype: "PersonalAgent", auth_method: "client_secret", request_user_info: "open_id" });
      if (typeof begin.device_code !== "string" || typeof begin.verification_uri_complete !== "string") throw new Error("registration unavailable");
      const registrationId = randomUUID();
      const expiresIn = typeof begin.expires_in === "number" ? Math.min(600, Math.max(60, begin.expires_in)) : 600;
      const url = new URL(begin.verification_uri_complete);
      url.searchParams.set("from", "sdk"); url.searchParams.set("source", "node-sdk/edupi-desktop"); url.searchParams.set("tp", "sdk"); url.searchParams.set("createOnly", "true"); url.searchParams.set("name", "EduPi 教师助手"); url.searchParams.set("desc", "教师的主动教育工作智能体"); url.searchParams.set("addons", encodeAddons(addons));
      registrations.set(registrationId, { deviceCode: begin.device_code, expiresAt: Date.now() + expiresIn * 1000, nextPollAt: Date.now() + 2_000 });
      return NextResponse.json({ ok: true, status: "authorization_required", registrationId, verificationUrl: url.toString(), expiresIn, permissionMode: "maximum_requested", requestedScopeCount });
    }
    if (body.action === "poll" && typeof body.registrationId === "string") {
      const registration = registrations.get(body.registrationId);
      if (!registration || registration.expiresAt <= Date.now()) { registrations.delete(body.registrationId); return NextResponse.json({ ok: false, error: "授权已过期，请重新开始" }, { status: 410 }); }
      if (Date.now() < registration.nextPollAt) return NextResponse.json({ ok: true, status: "pending" }, { status: 202 });
      registration.nextPollAt = Date.now() + 3_000;
      const polled = await registrationRequest({ action: "poll", device_code: registration.deviceCode });
      if (polled.error === "authorization_pending" || polled.error === "slow_down") return NextResponse.json({ ok: true, status: "pending" }, { status: 202 });
      if (typeof polled.client_id !== "string" || typeof polled.client_secret !== "string") { registrations.delete(body.registrationId); return NextResponse.json({ ok: false, error: "授权未完成，请重新开始" }, { status: 400 }); }
      const roots = resolveEduPiBridgeRoots();
      const configured = await runCoreProcess<Record<string, unknown>>({ runtime: roots.runtime, dataRoot: roots.dataRoot, request: { protocol: "edupi-desktop-bridge", protocol_version: 1, producer: "edupi-desktop", operation: "connector-setup", request_id: `feishu-register-${Date.now().toString(36)}`, connector_id: "feishu", action: "configure", app_id: polled.client_id, app_secret: polled.client_secret }, timeoutMs: 10_000 });
      registrations.delete(body.registrationId);
      if (configured.ok !== true) return NextResponse.json({ ok: false, error: "应用已创建，但连接验证失败" }, { status: 502 });
      return NextResponse.json({ ok: true, status: "configured", connectorId: "feishu" });
    }
    return NextResponse.json({ ok: false, error: "操作无效" }, { status: 400 });
  } catch { return NextResponse.json({ ok: false, error: "飞书一键授权暂不可用" }, { status: 502 }); }
}
