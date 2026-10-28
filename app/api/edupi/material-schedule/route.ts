import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { isDesktopApiRequestAllowed } from "@/lib/desktop-api-auth";
import { readEduPiEducationSnapshot, resolveEduPiBridgeRoots } from "@/lib/edupi-core-snapshot";
import { readMaterialMetadataHistory } from "@/lib/edupi-material-metadata";
import { ensureEduPiRuntime } from "@/lib/edupi-runtime-supervisor";
import { hasJsonContentType } from "@/lib/request-security";
import type { MaterialScheduleAdoptionReceipt } from "@/lib/edupi-material-schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RawRecord = Record<string, unknown>;
const HASH = /^sha256:[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,159}$/;
const APPLY_KEYS = ["action", "materialId", "expectedSourceHash", "expectedMetadataRevision", "expectedParseFingerprint", "commandId", "confirm"];
const record = (value: unknown): RawRecord | null => value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
const rows = (value: unknown): RawRecord[] => Array.isArray(value) ? value.flatMap(value => record(value) ? [record(value)!] : []) : [];
function fail(code: string): never { throw Object.assign(new Error(code), { code }); }

function errorResponse(code: string, status: number) {
  return NextResponse.json({ ok: false, errorCode: code, externalSend: false }, { status });
}

function statusFor(code: string): number {
  if (code === "material_schedule_invalid") return 400;
  if (["material_schedule_stale", "material_schedule_unresolved", "material_schedule_source_unavailable", "material_schedule_command_conflict", "owner_uninitialized"].includes(code)) return 409;
  if (["owner_identity_mismatch", "owner_control_required", "permission_denied"].includes(code)) return 403;
  return 503;
}

function caught(error: unknown) {
  const code = record(error)?.code;
  return errorResponse(typeof code === "string" ? code : "material_schedule_unavailable", statusFor(String(code)));
}

async function runtimeContext(signal: AbortSignal) {
  const roots = resolveEduPiBridgeRoots();
  const host = await ensureEduPiRuntime(roots);
  const health = await host.call("health", null, signal);
  const rootRef = record(health.result)?.data_root_fingerprint;
  if (health.ok !== true || typeof rootRef !== "string" || !HASH.test(rootRef)) fail("material_schedule_unavailable");
  const authorization = await host.callOwnerControl("owner_read", {}, signal);
  if (authorization.ok !== true) fail(String(authorization.error_code || "material_schedule_unavailable"));
  const value = record(authorization.result), owner = record(value?.owner);
  if (!owner || typeof owner.id !== "string" || value?.root_ref !== rootRef) fail("owner_uninitialized");
  return { roots, host, rootRef, ownerId: owner.id };
}

async function currentProof(context: Awaited<ReturnType<typeof runtimeContext>>, materialId: string, signal: AbortSignal) {
  const [snapshot, metadata] = await Promise.all([
    readEduPiEducationSnapshot({ roots: context.roots, signal, scheduleOccurrenceVersion: "1.2" }), readMaterialMetadataHistory(materialId, signal),
  ]);
  const targets = new Set(rows(snapshot.payload.receipts).filter(receipt => receipt.command_type === "intake_material"
    && receipt.receipt_phase === "mutation" && ["accepted", "modified"].includes(String(receipt.status))
    && Array.isArray(receipt.applied_ids) && receipt.applied_ids.includes(materialId)
    && record(receipt.target)?.target_kind === "material_intake").map(receipt => record(receipt.target)?.target_id));
  const current = rows(snapshot.payload.review_targets).filter(target => target.projection_kind === "material_intake"
    && targets.has(record(target.target)?.target_id));
  if (current.length !== 1 || typeof current[0].source_hash !== "string" || !HASH.test(current[0].source_hash)
    || metadata.materialId !== materialId || !Number.isSafeInteger(metadata.revision) || metadata.revision < 0) fail("material_schedule_source_unavailable");
  return { proof: { expected_source_hash: current[0].source_hash, expected_metadata_revision: metadata.revision }, snapshot };
}

function adoptionReceipt(
  value: unknown,
  context: Awaited<ReturnType<typeof runtimeContext>>,
  current: Awaited<ReturnType<typeof currentProof>>,
): MaterialScheduleAdoptionReceipt | null {
  const observed = record(value), source = record(observed?.source);
  if (!observed || observed.root_ref !== context.rootRef || observed.owner_id !== context.ownerId
    || !source || source.source_hash !== current.proof.expected_source_hash || source.metadata_revision !== current.proof.expected_metadata_revision
    || typeof source.material_id !== "string" || !ID.test(source.material_id)
    || typeof observed.parse_fingerprint !== "string" || !HASH.test(observed.parse_fingerprint)) fail("material_schedule_unavailable");
  const events = rows(observed.events), ids = new Set(events.map(event => event.event_id));
  if (events.length === 0 || events.length > 200 || events.length !== ids.size || events.some(event => typeof event.event_id !== "string" || !ID.test(event.event_id))) return null;
  const receipts = rows(current.snapshot.payload.receipts);
  for (let index = receipts.length - 1; index >= 0; index -= 1) {
    const item = receipts[index], target = record(item.target);
    if (item.command_type !== "import_calendar" || item.receipt_phase !== "mutation" || !["accepted", "modified"].includes(String(item.status))
      || target?.target_kind !== "calendar_import" || target.command_type !== "import_calendar" || item.external_send !== false
      || !Array.isArray(item.evidence_ids) || !item.evidence_ids.includes(source.material_id) || !item.evidence_ids.includes(observed.parse_fingerprint)
      || !Array.isArray(item.applied_ids) || item.applied_ids.length !== ids.size || new Set(item.applied_ids).size !== ids.size
      || item.applied_ids.some(id => typeof id !== "string" || !ids.has(id))
      || !Array.isArray(item.rejected_ids) || item.rejected_ids.length !== 0
      || typeof item.receipt_id !== "string" || !ID.test(item.receipt_id) || typeof item.command_id !== "string" || !ID.test(item.command_id)
      || typeof item.created_at !== "string" || item.created_at.length > 40 || !Number.isFinite(Date.parse(item.created_at))) continue;
    const calendar = rows(current.snapshot.occurrenceProjection?.events);
    const matching = events.every(event => {
      const found = calendar.filter(entry => entry.event_id === event.event_id);
      if (found.length !== 1) return false;
      const entry = found[0];
      if (entry.date_status !== undefined && entry.date_status !== "explicit") return false;
      if (["date", "end_date", "name", "type", "notes", "location"].some(key => (entry[key] ?? null) !== (event[key] ?? null))) return false;
      const saved = record(entry.time_interval), parsed = record(event.time_interval);
      return !saved && !parsed || Boolean(saved && parsed && ["start", "end", "time_zone"].every(key => saved[key] === parsed[key]));
    });
    return { receiptId: item.receipt_id, ownerCommandId: item.command_id, rootRef: context.rootRef, ownerId: context.ownerId,
      materialId: source.material_id, sourceHash: current.proof.expected_source_hash, metadataRevision: current.proof.expected_metadata_revision,
      parseFingerprint: observed.parse_fingerprint, status: item.status as "accepted" | "modified", appliedIds: [...item.applied_ids] as string[],
      createdAt: item.created_at, calendarState: matching ? "matching" : "needs_review" };
  }
  // The Owner's bounded receipt window cannot prove that a missing receipt never existed.
  return null;
}

async function read(context: Awaited<ReturnType<typeof runtimeContext>>, materialId: string, proof: { expected_source_hash: string; expected_metadata_revision: number }, signal: AbortSignal) {
  const response = await context.host.callOwnerControl("material_schedule_read", {
    root_ref: context.rootRef, expected_owner_id: context.ownerId, material_id: materialId, ...proof,
  }, signal);
  if (response.ok !== true) fail(String(response.error_code || "material_schedule_unavailable"));
  return response.result;
}

export async function GET(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return errorResponse("forbidden", 403);
  const params = new URL(request.url).searchParams, materialId = params.get("materialId");
  if ([...params.keys()].some(key => key !== "materialId") || params.getAll("materialId").length !== 1 || !materialId || !ID.test(materialId)) return errorResponse("material_schedule_invalid", 400);
  try {
    const context = await runtimeContext(request.signal);
    const current = await currentProof(context, materialId, request.signal);
    const result = await read(context, materialId, current.proof, request.signal);
    if (record(record(result)?.source)?.material_id !== materialId) fail("material_schedule_unavailable");
    return NextResponse.json({ ok: true, result, adoptionReceipt: adoptionReceipt(result, context, current), externalSend: false }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return caught(error); }
}

export async function POST(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return errorResponse("forbidden", 403);
  if (!hasJsonContentType(request)) return errorResponse("material_schedule_invalid", 415);
  try {
    const body = record(await parseJsonWithinLimit(request, 4 * 1024));
    if (!body || Object.keys(body).some(key => ![...APPLY_KEYS, "confirmSourceText"].includes(key))
      || !APPLY_KEYS.every(key => Object.hasOwn(body, key))
      || Object.hasOwn(body, "confirmSourceText") && body.confirmSourceText !== true
      || body.action !== "apply" || body.confirm !== true || typeof body.materialId !== "string" || !ID.test(body.materialId)
      || typeof body.commandId !== "string" || !ID.test(body.commandId)
      || typeof body.expectedSourceHash !== "string" || !HASH.test(body.expectedSourceHash)
      || typeof body.expectedParseFingerprint !== "string" || !HASH.test(body.expectedParseFingerprint)
      || !Number.isSafeInteger(body.expectedMetadataRevision) || Number(body.expectedMetadataRevision) < 0) return errorResponse("material_schedule_invalid", 400);
    const context = await runtimeContext(request.signal);
    const proof = { expected_source_hash: body.expectedSourceHash, expected_metadata_revision: Number(body.expectedMetadataRevision) };
    const observed = record(await read(context, body.materialId, proof, request.signal));
    if (!observed || observed.status !== "ready" || !Array.isArray(observed.issues) || observed.issues.length
      || !Array.isArray(observed.events) || !observed.events.length
      || observed.source_review_required !== undefined && observed.source_review_required !== "image_text"
      || observed.source_review_required === "image_text" && body.confirmSourceText !== true) fail("material_schedule_unresolved");
    if (observed.parse_fingerprint !== body.expectedParseFingerprint) fail("material_schedule_stale");
    const response = await context.host.callOwnerControl("material_schedule_apply", {
      root_ref: context.rootRef, expected_owner_id: context.ownerId, material_id: body.materialId, ...proof,
      command_id: body.commandId, expected_parse_fingerprint: body.expectedParseFingerprint, confirm: true,
      ...(body.confirmSourceText === true ? { confirm_source_text: true } : {}),
    }, request.signal);
    if (response.ok !== true) fail(String(response.error_code || "material_schedule_unavailable"));
    return NextResponse.json({ ok: true, result: response.result, externalSend: false });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return errorResponse("material_schedule_invalid", 413);
    return caught(error);
  }
}
