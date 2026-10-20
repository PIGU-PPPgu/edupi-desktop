import { NextResponse } from "next/server";
import { isDesktopApiRequestAllowed } from "@/lib/desktop-api-auth";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { resolveEduPiBridgeRoots } from "@/lib/edupi-core-snapshot";
import { readEduPiProactivityActivation } from "@/lib/edupi-proactivity-config";
import { listEduPiPromptOutbox, readEduPiPromptOutbox } from "@/lib/edupi-prompt-outbox";
import { ensureEduPiRuntime } from "@/lib/edupi-runtime-supervisor";
import { canStartEduPiCapabilityDrafts } from "@/lib/safe-mode";
import { withEduPiAmbientSessionLock } from "@/lib/edupi-ambient-session-lock";
import { parseParentRecipientEntries } from "@/lib/edupi-parent-recipient-client";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json({ ...body, externalSend: false }, { status, headers: { "Cache-Control": "no-store" } });
function source(dataRoot: string, sessionId: string, clientRequestId: string, owner?: { ownerId: string; grantVersion: number }) {
  const activation = readEduPiProactivityActivation({ dataRoot, domain: "parent_communication" });
  if (!canStartEduPiCapabilityDrafts() || !activation.enabled || !activation.grantId || !activation.scope) throw new Error("activation_pending");
  const saved = readEduPiPromptOutbox(sessionId, clientRequestId, { dataRoot });
  const binding = saved?.bindings.find(item => item.domain === "parent_communication");
  if (saved?.stage !== "pi_accepted" || !binding?.captured || !binding.registration || binding.grantId !== activation.grantId
    || activation.ownerId && activation.ownerId !== binding.ownerId
    || owner && (binding.ownerId !== owner.ownerId || binding.grantVersion !== owner.grantVersion)) return null;
  return { binding, occurredAt: saved.occurredAt };
}
async function context() {
  const roots = resolveEduPiBridgeRoots(), host = await ensureEduPiRuntime(roots);
  const health = object(object(await host.call("health", null))?.result), capabilities = object(health?.capabilities);
  if (typeof health?.data_root_fingerprint !== "string" || capabilities?.g3_processor !== "active") throw new Error("activation_pending");
  const rootRef = health.data_root_fingerprint;
  const activation = readEduPiProactivityActivation({ dataRoot: roots.dataRoot.root, domain: "parent_communication" });
  const ownerRead = await host.callOwnerControl("owner_read", { root_ref: rootRef }), ownerState = object(ownerRead.result), owner = object(ownerState?.owner);
  const grant = Array.isArray(ownerState?.grants) ? ownerState.grants.map(object).find(item => item?.id === activation.grantId) : null;
  if (ownerRead.ok !== true || typeof owner?.id !== "string" || !grant || grant.status !== "active" || !Number.isSafeInteger(grant.version)) throw new Error("owner_unavailable");
  return { roots, host, rootRef, owner: { ownerId: owner.id, grantVersion: Number(grant.version) } };
}
export async function GET(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return reply({ ok: false }, 403);
  if (!canStartEduPiCapabilityDrafts()) return reply({ ok: true, entries: [] });
  try {
    const roots = resolveEduPiBridgeRoots(), activation = readEduPiProactivityActivation({ dataRoot: roots.dataRoot.root, domain: "parent_communication" });
    if (!activation.enabled) return reply({ ok: true, entries: [] });
    const { host, rootRef, owner } = await context();
    const entries = [];
    for (const item of listEduPiPromptOutbox({ dataRoot: roots.dataRoot.root }).filter(item => item.stage === "pi_accepted"
      && item.domains.some(binding => binding.domain === "parent_communication" && binding.captured)).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 10_000)) {
      if (entries.length >= 20) break;
      const current = source(roots.dataRoot.root, item.sessionId, item.clientRequestId, owner);
      if (!current) continue;
      const { binding, occurredAt } = current;
      const response = await host.callOwnerControl("owner_parent_recipient_read", { root_ref: rootRef, expected_owner_id: binding.ownerId, message_ref: binding.messageRef });
      if (response.ok !== true) {
        if (response.error_code === "activation_pending") continue;
        throw new Error("recipient_read_unavailable");
      }
      const result = object(response.result);
      if (!result || result.fact_write !== false || result.external_send !== false) throw new Error("invalid_response");
      if (result.status === "confirmed" || result.reason === "permission_denied" || result.reason === "invalid_candidate") continue;
      entries.push({ sessionId: item.sessionId, clientRequestId: item.clientRequestId, occurredAt, status: result.status, reason: result.reason, candidate: result.candidate });
    }
    parseParentRecipientEntries({ ok: true, entries, externalSend: false });
    return reply({ ok: true, entries });
  } catch { return reply({ ok: false, error: "收件人确认暂不可用" }, 503); }
}
export async function POST(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return reply({ ok: false }, 403);
  if (!canStartEduPiCapabilityDrafts()) return reply({ ok: false }, 409);
  try {
    const body = object(await parseJsonWithinLimit(request, 4096));
    const fields = ["sessionId", "clientRequestId", "commandId", "expectedGrantVersion", "expectedSourceFingerprint", "studentId", "recipientId", "termRef"];
    if (!body || Object.keys(body).length !== fields.length || fields.some(key => !Object.hasOwn(body, key))
      || fields.filter(key => key !== "expectedGrantVersion").some(key => typeof body[key] !== "string" || !body[key] || String(body[key]).length > 255)
      || !Number.isSafeInteger(body.expectedGrantVersion) || Number(body.expectedGrantVersion) < 1) return reply({ ok: false }, 400);
    const sessionId = String(body.sessionId), clientRequestId = String(body.clientRequestId);
    return await withEduPiAmbientSessionLock(sessionId, async () => {
      const { roots, host, rootRef, owner } = await context(), current = source(roots.dataRoot.root, sessionId, clientRequestId, owner);
      if (!current) return reply({ ok: false, code: "source_unavailable" }, 409);
      const { binding } = current;
      const input = { root_ref: rootRef, expected_owner_id: binding.ownerId, message_ref: binding.messageRef };
      const result = await host.callOwnerControl("owner_parent_recipient_confirm", { ...input, command_id: body.commandId,
        expected_grant_version: body.expectedGrantVersion, expected_source_fingerprint: body.expectedSourceFingerprint,
        student_id: body.studentId, recipient_id: body.recipientId, term_ref: body.termRef });
      if (result.ok !== true) return reply({ ok: false, code: result.error_code }, 409);
      const confirmed = object(result.result), readback = object((await host.callOwnerControl("owner_parent_recipient_read", input)).result), proof = object(readback?.candidate);
      if (confirmed?.fact_write !== true || confirmed.external_send !== false || readback?.status !== "confirmed"
        || proof?.confirmed_fact_id !== confirmed.fact_id) throw new Error("readback_unavailable");
      return reply({ ok: true, result: confirmed, readbackConfirmed: true });
    });
  } catch (error) { return reply({ ok: false, error: "收件人确认暂不可用" }, error instanceof RequestBodyTooLargeError ? 413 : 503); }
}
