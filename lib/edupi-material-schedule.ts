import { desktopApiHeaders, isTauriDesktop } from "./desktop-native";
import type { EduPiMaterialScheduleProposal, EduPiMaterialScheduleReadResult } from "./edupi-core-process-client";

export type MaterialScheduleAdoptionReceipt = {
  receiptId: string;
  ownerCommandId: string;
  rootRef: string;
  ownerId: string;
  materialId: string;
  sourceHash: string;
  metadataRevision: number;
  parseFingerprint: string;
  status: "accepted" | "modified";
  appliedIds: string[];
  createdAt: string;
  calendarState: "matching" | "needs_review";
};
export type MaterialScheduleRead = EduPiMaterialScheduleReadResult & {
  adoptionReceipt?: MaterialScheduleAdoptionReceipt | null;
};
export type MaterialScheduleApplyCapture = {
  materialId: string;
  expectedSourceHash: string;
  expectedMetadataRevision: number;
  expectedParseFingerprint: string;
  commandId: string;
  confirm: true;
  confirmSourceText?: true;
};
export type MaterialScheduleApplyResult = {
  version: 1;
  material_id: string;
  parse_fingerprint: string;
  command_id: string;
  receipt_id: string;
  status: "accepted" | "modified" | "held";
  reason_code: string | null;
  applied_ids: string[];
  rejected_ids: string[];
  replayed: boolean;
  automatic_import: false;
  external_send: false;
};
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type RawRecord = Record<string, unknown>;
const URL_PATH = "/api/edupi/material-schedule";
const HASH = /^sha256:[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,159}$/;

export class MaterialScheduleError extends Error {
  constructor(readonly code: string) { super(code); this.name = "MaterialScheduleError"; }
}

function record(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
}

function fail(code = "material_schedule_invalid_response"): never { throw new MaterialScheduleError(code); }

export function materialScheduleRead(value: unknown, materialId?: string): MaterialScheduleRead {
  const raw = record(value), source = record(raw?.source), options = record(raw?.options);
  if (!raw || raw.version !== 1 || raw.read_only !== true || raw.automatic_import !== false || raw.external_send !== false
    || !HASH.test(String(raw.root_ref)) || typeof raw.owner_id !== "string" || !ID.test(raw.owner_id)
    || !source || typeof source.material_id !== "string" || !ID.test(source.material_id)
    || materialId !== undefined && source.material_id !== materialId
    || !HASH.test(String(source.source_hash)) || !Number.isSafeInteger(source.metadata_revision) || Number(source.metadata_revision) < 0
    || typeof source.relative_path !== "string" || !source.relative_path
    || !HASH.test(String(raw.parse_fingerprint)) || !["ready", "partial", "unresolved"].includes(String(raw.status))
    || raw.source_review_required !== undefined && raw.source_review_required !== "image_text"
    || !options || options.max_occurrences !== 200
    || !Array.isArray(raw.events) || raw.events.length > 200 || raw.events.some(value => {
      const event = record(value), interval = record(event?.time_interval);
      return !event || typeof event.event_id !== "string" || !ID.test(event.event_id)
        || typeof event.name !== "string" || !event.name || event.name.length > 240
        || typeof event.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(event.date)
        || event.time_interval !== undefined && (!interval || typeof interval.start !== "string" || typeof interval.end !== "string"
          || typeof interval.time_zone !== "string" || !interval.time_zone || interval.time_zone.length > 100);
    }) || new Set(raw.events.map(value => record(value)?.event_id)).size !== raw.events.length
    || !Array.isArray(raw.issues) || raw.issues.length > 200 || raw.issues.some(value => {
      const issue = record(value); return !issue || typeof issue.code !== "string" || typeof issue.message !== "string" || !issue.message;
    }) || !Array.isArray(raw.evidence) || raw.evidence.length > 1000) fail();
  const read = value as MaterialScheduleRead;
  if (Object.hasOwn(raw, "adoptionReceipt")) materialScheduleAdoptionReceipt(raw.adoptionReceipt, read);
  return read;
}

export function materialScheduleAdoptionReceipt(value: unknown, read: MaterialScheduleRead): MaterialScheduleAdoptionReceipt | null {
  if (value === null) return null;
  const item = record(value), ids = new Set(read.events.map(event => event.event_id));
  if (!item || typeof item.receiptId !== "string" || !ID.test(item.receiptId)
    || typeof item.ownerCommandId !== "string" || !ID.test(item.ownerCommandId)
    || item.rootRef !== read.root_ref || item.ownerId !== read.owner_id || item.materialId !== read.source.material_id
    || item.sourceHash !== read.source.source_hash || item.metadataRevision !== read.source.metadata_revision
    || item.parseFingerprint !== read.parse_fingerprint || !["accepted", "modified"].includes(String(item.status))
    || !["matching", "needs_review"].includes(String(item.calendarState))
    || typeof item.createdAt !== "string" || item.createdAt.length > 40 || !Number.isFinite(Date.parse(item.createdAt))
    || ids.size !== read.events.length || ids.size === 0 || !Array.isArray(item.appliedIds)
    || item.appliedIds.length !== ids.size || new Set(item.appliedIds).size !== ids.size
    || item.appliedIds.some(id => typeof id !== "string" || !ids.has(id))) fail();
  return value as MaterialScheduleAdoptionReceipt;
}

export function materialScheduleCanApply(read: MaterialScheduleRead): boolean {
  return !read.adoptionReceipt && read.status === "ready" && read.issues.length === 0 && read.events.length > 0;
}

export function materialScheduleUploadProposal(value: unknown): EduPiMaterialScheduleProposal {
  const raw = record(value);
  if (!raw || raw.read_only !== true || raw.automatic_import !== false || raw.external_send !== false
    || typeof raw.material_id !== "string" || !raw.material_id || raw.material_id.length > 160) fail();
  if (raw.status === "unavailable") {
    if (raw.read_result !== null || typeof raw.reason_code !== "string") fail();
  } else {
    const read = materialScheduleRead(raw.read_result, raw.material_id);
    if (raw.status === "proposed" ? raw.reason_code !== null || read.status !== "ready" || read.issues.length !== 0 || read.events.length === 0
      : raw.status !== "held" || raw.reason_code !== "material_schedule_unresolved") fail();
  }
  return value as EduPiMaterialScheduleProposal;
}

export function captureMaterialScheduleApply(value: MaterialScheduleRead, commandId = `desktop-material-schedule-${globalThis.crypto.randomUUID()}`,
  confirmSourceText?: true): MaterialScheduleApplyCapture {
  const read = materialScheduleRead(value);
  if (!ID.test(commandId)) fail("material_schedule_invalid");
  if (!materialScheduleCanApply(read)) fail("material_schedule_unresolved");
  if (read.source_review_required === "image_text" && confirmSourceText !== true) fail("material_schedule_unresolved");
  return { materialId: read.source.material_id, expectedSourceHash: read.source.source_hash,
    expectedMetadataRevision: read.source.metadata_revision, expectedParseFingerprint: read.parse_fingerprint, commandId, confirm: true,
    ...(read.source_review_required === "image_text" ? { confirmSourceText: true } : {}) };
}

async function responseBody(response: Response): Promise<RawRecord> {
  try { return record(await response.json()) || {}; } catch { return {}; }
}

function responseError(body: RawRecord): never {
  fail(typeof body.errorCode === "string" ? body.errorCode : "material_schedule_unavailable");
}

async function requestHeaders(provider: typeof desktopApiHeaders, initial?: HeadersInit): Promise<Headers> {
  try { return await provider(initial); }
  catch (error) {
    if (provider === desktopApiHeaders && !isTauriDesktop()) fail("forbidden");
    throw error;
  }
}

export async function readMaterialSchedule(materialId: string, fetcher: Fetcher = fetch, headersProvider: typeof desktopApiHeaders = desktopApiHeaders, signal?: AbortSignal): Promise<MaterialScheduleRead> {
  if (!ID.test(materialId)) fail("material_schedule_invalid");
  const response = await fetcher(`${URL_PATH}?materialId=${encodeURIComponent(materialId)}`, {
    method: "GET", headers: await requestHeaders(headersProvider), cache: "no-store", signal,
  });
  const body = await responseBody(response);
  if (!response.ok || body.ok !== true || body.externalSend !== false) responseError(body);
  const observed = materialScheduleRead(body.result, materialId);
  return Object.hasOwn(body, "adoptionReceipt")
    ? { ...observed, adoptionReceipt: materialScheduleAdoptionReceipt(body.adoptionReceipt, observed) }
    : observed;
}

export async function bootstrapMaterialScheduleOwner(materialId: string, fetcher: Fetcher = fetch,
  headersProvider: typeof desktopApiHeaders = desktopApiHeaders): Promise<{ rootRef: string; ownerId: string; created: boolean }> {
  if (!ID.test(materialId)) fail("material_schedule_invalid");
  const response = await fetcher(URL_PATH, { method: "POST",
    headers: await requestHeaders(headersProvider, { "content-type": "application/json" }),
    body: JSON.stringify({ action: "bootstrap_owner", materialId, confirm: true }) });
  const body = await responseBody(response);
  if (!response.ok || body.ok !== true || body.externalSend !== false) responseError(body);
  const result = record(body.result);
  if (!result || typeof result.rootRef !== "string" || !HASH.test(result.rootRef)
    || typeof result.ownerId !== "string" || !ID.test(result.ownerId)
    || typeof result.created !== "boolean") fail();
  return result as { rootRef: string; ownerId: string; created: boolean };
}

export async function applyMaterialSchedule(capture: MaterialScheduleApplyCapture, fetcher: Fetcher = fetch, headersProvider: typeof desktopApiHeaders = desktopApiHeaders): Promise<MaterialScheduleApplyResult> {
  if (!ID.test(capture.materialId) || !ID.test(capture.commandId) || !HASH.test(capture.expectedSourceHash)
    || !HASH.test(capture.expectedParseFingerprint) || !Number.isSafeInteger(capture.expectedMetadataRevision)
    || capture.expectedMetadataRevision < 0 || capture.confirm !== true
    || capture.confirmSourceText !== undefined && capture.confirmSourceText !== true) fail("material_schedule_invalid");
  const response = await fetcher(URL_PATH, { method: "POST", headers: await requestHeaders(headersProvider, { "content-type": "application/json" }),
    body: JSON.stringify({ action: "apply", ...capture }) });
  const body = await responseBody(response);
  if (!response.ok || body.ok !== true || body.externalSend !== false) responseError(body);
  const result = record(body.result);
  if (!result || result.version !== 1 || result.material_id !== capture.materialId || result.command_id !== capture.commandId
    || result.parse_fingerprint !== capture.expectedParseFingerprint || typeof result.receipt_id !== "string" || !ID.test(result.receipt_id)
    || !["accepted", "modified", "held"].includes(String(result.status)) || typeof result.replayed !== "boolean"
    || result.automatic_import !== false || result.external_send !== false
    || !Array.isArray(result.applied_ids) || result.applied_ids.length > 200 || result.applied_ids.some(value => typeof value !== "string" || !ID.test(value))
    || !Array.isArray(result.rejected_ids) || result.rejected_ids.length > 200 || result.rejected_ids.some(value => typeof value !== "string" || !ID.test(value))) fail();
  return body.result as MaterialScheduleApplyResult;
}

export function materialScheduleErrorMessage(error: unknown): string {
  const code = error instanceof MaterialScheduleError ? error.code : "material_schedule_unavailable";
  if (code === "forbidden") return "请在桌面应用中核对安排";
  if (code === "owner_uninitialized") return "本机身份尚未建立";
  if (code.startsWith("owner_") || code === "permission_denied") return "教师身份暂不可用";
  if (code === "material_schedule_stale" || code === "material_schedule_command_conflict") return "材料已变化，请重新读取";
  if (code === "material_schedule_source_unavailable") return "材料来源暂不可用";
  if (code === "material_schedule_unresolved") return "安排待核对";
  return "安排读取未确认，请重试";
}
