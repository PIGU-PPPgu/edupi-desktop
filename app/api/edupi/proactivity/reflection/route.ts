import { NextResponse } from "next/server";
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { isDesktopApiRequestAllowed } from "@/lib/desktop-api-auth";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { readEduPiEducationSnapshot, resolveEduPiBridgeRoots } from "@/lib/edupi-core-snapshot";
import { readEduPiProactivityActivation } from "@/lib/edupi-proactivity-config";
import { ensureEduPiRuntime } from "@/lib/edupi-runtime-supervisor";
import { canStartEduPiCapabilityDrafts } from "@/lib/safe-mode";
import { withEduPiAmbientSessionLock } from "@/lib/edupi-ambient-session-lock";
import { lessonReflectionCompletionSourceId } from "@/lib/edupi-proactivity-control";
import { appendEduPiReflectionIndex, readEduPiReflectionIndex } from "@/lib/edupi-reflection-index";
import { prepareReflectionOperation, runReflectionOperation, resolveReflectionOperation, ReflectionOperationError,
  type ReflectionOperationReceipt, type ReflectionOperationResponse } from "@/lib/edupi-reflection-operation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RecordValue = Record<string, unknown>;
const HASH = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,159}$/u;
const OWNER_ID = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/u;
const CURSOR = /^[A-Za-z0-9_-]{1,512}$/u;
const CONTENT_PREDICATES = ["lesson.observation", "lesson.feedback", "lesson.statistic", "lesson.outcome", "lesson.review"];
type FactKind = "completion" | "content";
const mutationKind = (body: RecordValue): FactKind => body.action === "contentCapture" || body.action === "contentReview" ? "content" : "completion";
const isCapture = (body: RecordValue) => body.action === "capture" || body.action === "contentCapture";
const isReview = (body: RecordValue) => body.action === "review" || body.action === "contentReview";
const contentValue = (value: string) => value.normalize("NFKC").replace(/\s+/gu, " ").trim();
const lessonContentPrefix = (classId: unknown, subject: unknown, lessonId: unknown) =>
  `lesson-content:${createHash("sha256").update(JSON.stringify([classId, subject, lessonId])).digest("hex").slice(0, 24)}:`;
const lessonContentSourceId = (body: RecordValue, lessonId: string) =>
  `${lessonContentPrefix(body.classId, body.subject, lessonId)}${createHash("sha256")
    .update(JSON.stringify([body.predicate, body.rawText])).digest("hex")}`;
const isBoundContentSource = (body: RecordValue, lesson: RecordValue, sourceIds: unknown[]) =>
  body.sourceId === lessonContentSourceId(body, lesson.entity_id as string)
  && contentSources({ class_id: body.classId, subject: body.subject }, lesson, sourceIds).includes(body.sourceId as string);
const validContentText = (value: unknown): value is string => typeof value === "string" && value.length <= 4000
  && contentValue(value).length > 0 && contentValue(value).length <= 4000 && !/[\u0000-\u001f\u007f]/u.test(contentValue(value));
const object = (value: unknown): RecordValue | null => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
const records = (value: unknown): RecordValue[] => Array.isArray(value) ? value.map(object).filter((item): item is RecordValue => item !== null) : [];
const text = (value: unknown, max = 160): value is string => typeof value === "string" && value.length > 0 && value.length <= max && value === value.normalize("NFKC").trim() && !/[\u0000-\u001f\u007f]/u.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && HASH.test(value);
const integer = (value: unknown, minimum = 1): value is number => Number.isSafeInteger(value) && Number(value) >= minimum;
const timestamp = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const dateOnly = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d\d-\d\d$/u.test(value) && timestamp(`${value}T00:00:00.000Z`);
const reply = (body: RecordValue, status = 200) => NextResponse.json({ ...body, externalSend: false }, { status, headers: { "Cache-Control": "no-store" } });

class ReflectionError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); }
}

async function context(mode: "current" | "history" = "current") {
  const historyRead = mode === "history";
  if (!historyRead && !canStartEduPiCapabilityDrafts()) throw new ReflectionError("activation_pending");
  const roots = resolveEduPiBridgeRoots();
  const activation = readEduPiProactivityActivation({ dataRoot: roots.dataRoot.root, domain: "lesson_reflection" });
  const executionBinding = activation.enabled && activation.grantId && activation.ownerId && activation.scope
    ? { ownerId: activation.ownerId, grantId: activation.grantId, scope: activation.scope } : null;
  const selectedBinding = historyRead ? activation.historyBinding ?? executionBinding : executionBinding;
  if (activation.configurationStatus !== "ready" || !selectedBinding) throw new ReflectionError("activation_pending");
  const host = await ensureEduPiRuntime(roots);
  const healthResponse = await host.call("health", null), health = object(healthResponse.result);
  const rootRef = health?.data_root_fingerprint;
  if (healthResponse.ok !== true || !hash(rootRef)
    || !historyRead && object(health?.capabilities)?.g3_processor !== "active") throw new ReflectionError("activation_pending");
  const ownerResponse = await host.callOwnerControl("owner_read", { root_ref: rootRef, expected_owner_id: selectedBinding.ownerId });
  const state = object(ownerResponse.result), owner = object(state?.owner);
  const grant = records(state?.grants).find(item => item.id === selectedBinding.grantId), scope = object(grant?.scope);
  const now = new Date().toISOString();
  if (ownerResponse.ok !== true || state?.root_ref !== rootRef || owner?.root_ref !== rootRef
    || owner.id !== selectedBinding.ownerId || !grant || !integer(grant.version)
    || scope?.class_id !== selectedBinding.scope.classId || scope?.subject !== selectedBinding.scope.subject
    || !Array.isArray(grant.domains) || !grant.domains.includes("lesson_reflection")
    || !Array.isArray(grant.source_ids) || !grant.source_ids.every(item => text(item))) throw new ReflectionError("owner_unavailable");
  if (!historyRead && (grant.status !== "active" || !Array.isArray(grant.actions) || !grant.actions.includes("update")
    || !timestamp(grant.starts_at) || !timestamp(grant.ends_at) || now < grant.starts_at || now >= grant.ends_at))
    throw new ReflectionError("owner_unavailable");
  return { roots, host, rootRef, activation, grant, binding: { root_ref: rootRef, expected_owner_id: selectedBinding.ownerId,
    grant_id: selectedBinding.grantId, class_id: selectedBinding.scope.classId, subject: selectedBinding.scope.subject } };
}

type Context = Awaited<ReturnType<typeof context>>;

function validateResult(response: RecordValue, binding: RecordValue, expectedStatus: string, factId?: unknown, kind: FactKind = "completion"): RecordValue {
  if (response.ok !== true) throw new ReflectionError(typeof response.error_code === "string" ? response.error_code : "reflection_unavailable");
  const result = object(response.result);
  if (!result || result.external_send !== false) throw new ReflectionError("invalid_response", 503);
  if (result.status === "held") {
    if (!text(result.reason_code) || result.entity_id !== null || result.occurrence !== null) throw new ReflectionError("invalid_response", 503);
    return result;
  }
  if (result.status === "commit_unknown" || result.status === "committed_unverified") {
    if (result.reason_code !== "source_changed") throw new ReflectionError("invalid_response", 503);
    return result;
  }
  const occurrence = object(result.occurrence);
  if (result.status !== expectedStatus || result.reason_code !== null || !text(result.entity_id) || !ID.test(result.entity_id)
    || !occurrence || occurrence.entity_id !== result.entity_id || occurrence.namespace !== "edupi-timetable-occurrence-v1"
    || occurrence.class_id !== binding.class_id || occurrence.subject !== binding.subject || occurrence.source_event_date !== binding.date
    || binding.slot_id !== undefined && occurrence.slot_id !== binding.slot_id
    || !text(occurrence.slot_id) || !integer(occurrence.slot_revision) || !hash(occurrence.slot_content_hash)
    || !hash(occurrence.source_basis_hash) || !timestamp(occurrence.lesson_at)
    || !text(occurrence.external_id) || !text(occurrence.task_id) || !text(occurrence.term_id) || !text(occurrence.time_zone, 100)
    || !Array.isArray(occurrence.source_ids) || !occurrence.source_ids.length || occurrence.source_ids.length > 128
    || !occurrence.source_ids.every(item => text(item)) || new Set(occurrence.source_ids).size !== occurrence.source_ids.length
    || expectedStatus !== "registered" && !integer(result.grant_version)) throw new ReflectionError("invalid_response", 503);
  if (expectedStatus === "registered" || expectedStatus === "recorded") {
    if (typeof result.replayed !== "boolean") throw new ReflectionError("invalid_response", 503);
  }
  if (Object.hasOwn(result, kind) || factId !== undefined || expectedStatus === "recorded" || expectedStatus === "reviewed") {
    const completion = object(result[kind]);
    if (!completion || !text(completion.fact_id) || !ID.test(completion.fact_id) || factId !== undefined && completion.fact_id !== factId
      || !integer(completion.revision, 0) || !["candidate", "pending_review", "held", "accepted", "rejected"].includes(String(completion.status))
      || !text(completion.source_id) || !text(completion.source_revision) || !text(completion.observation_id)
      || typeof completion.raw_text !== "string" || !completion.raw_text || completion.raw_text.length > 4000
      || kind === "completion" && (!timestamp(completion.completed_at) || !completion.raw_text.includes(completion.completed_at))
      || kind === "content" && (!exactKeys(completion, ["fact_id", "revision", "status", "predicate", "value", "source_id",
        "source_revision", "observation_id", "raw_text", "source_basis_hash"])
        || !ID.test(completion.observation_id) || !CONTENT_PREDICATES.includes(String(completion.predicate)) || !validContentText(completion.raw_text)
        || completion.value !== contentValue(completion.raw_text))
      || !hash(completion.source_basis_hash)) throw new ReflectionError("invalid_response", 503);
  }
  return result;
}

async function read(contextValue: Context, binding: RecordValue, factId?: unknown, kind: FactKind = "completion") {
  return validateResult(await contextValue.host.callOwnerControl(factId === undefined ? "owner_reflection_lesson_read" : `owner_reflection_${kind}_read`,
    { ...binding, ...(factId === undefined ? {} : { fact_id: factId }) }), binding, "ready", factId, kind);
}

function contentSources(binding: RecordValue, result: RecordValue, sourceIds: unknown[]): string[] {
  const occurrence = object(result.occurrence);
  const prefix = lessonContentPrefix(binding.class_id, binding.subject, result.entity_id);
  return result.status !== "ready" || !occurrence ? [] : sourceIds.filter((id): id is string => text(id)
    && id.startsWith(prefix) && /^[a-f0-9]{64}$/u.test(id.slice(prefix.length))
    && !(occurrence.source_ids as unknown[]).includes(id));
}

function reflectionIndexScope(current: Context) {
  if (!process.env.PI_DESKTOP_STATE_DIR) throw new ReflectionError("reflection_index_unavailable", 503);
  return { stateDir: process.env.PI_DESKTOP_STATE_DIR, dataRoot: current.roots.dataRoot.root,
    rootRef: current.rootRef, ownerId: current.binding.expected_owner_id as string, grantId: current.binding.grant_id as string,
    classId: current.binding.class_id as string, subject: current.binding.subject as string };
}

function entry(binding: RecordValue, result: RecordValue, registrationStatus: string, sourceIds: unknown[]) {
  const occurrence = object(result.occurrence), completion = object(result.completion), content = object(result.content);
  const completionSource = result.status === "ready" && typeof result.entity_id === "string"
    ? lessonReflectionCompletionSourceId({ classId: binding.class_id as string, subject: binding.subject as string }, result.entity_id) : null;
  return { classId: binding.class_id, subject: binding.subject, date: binding.date, slotId: occurrence?.slot_id ?? binding.slot_id ?? null,
    lessonId: result.entity_id, lessonAt: occurrence?.lesson_at ?? null, registrationStatus, status: result.status,
    reasonCode: result.reason_code, sourceBasisHash: occurrence?.source_basis_hash ?? null, grantVersion: result.grant_version ?? null,
    completionSourceIds: completionSource && sourceIds.includes(completionSource) ? [completionSource] : [],
    contentSourceIds: contentSources(binding, result, sourceIds),
    content: content ? { factId: content.fact_id, revision: content.revision, status: content.status,
      predicate: content.predicate, rawText: content.raw_text, sourceBasisHash: content.source_basis_hash,
      sourceId: content.source_id, sourceRevision: content.source_revision } : null,
    completion: completion ? { factId: completion.fact_id, revision: completion.revision, status: completion.status,
      rawText: completion.raw_text, completedAt: completion.completed_at, sourceBasisHash: completion.source_basis_hash,
      sourceId: completion.source_id, sourceRevision: completion.source_revision } : null };
}

function failure(error: unknown) {
  return reply({ ok: false, code: error instanceof ReflectionError || error instanceof ReflectionOperationError ? error.code
    : (error as { code?: string })?.code === "reflection_index_unavailable" ? "reflection_index_unavailable" : "reflection_unavailable", error: "课后反思暂不可用" },
    error instanceof RequestBodyTooLargeError ? 413 : error instanceof SyntaxError ? 400
      : error instanceof ReflectionError || error instanceof ReflectionOperationError ? error.status : 503);
}

export async function GET(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return reply({ ok: false }, 403);
  try {
    const query = new URL(request.url).searchParams;
    if (query.get("history") === "true") return await history(query);
    if ([...query.keys()].some(key => !["date", "slotId", "factId", "content"].includes(key) || query.getAll(key).length !== 1)
      || query.has("content") && query.get("content") !== "true") return reply({ ok: false }, 400);
    const contentOnly = query.get("content") === "true";
    const date = query.get("date") ?? new Date().toISOString().slice(0, 10), slotId = query.get("slotId"), factId = query.get("factId");
    if (!dateOnly(date) || slotId !== null && !text(slotId) || factId !== null && (!text(factId) || !ID.test(factId))) return reply({ ok: false }, 400);
    if (!canStartEduPiCapabilityDrafts()) return reply({ ok: true, enabled: false, entries: [] });
    const roots = resolveEduPiBridgeRoots();
    if (!readEduPiProactivityActivation({ dataRoot: roots.dataRoot.root, domain: "lesson_reflection" }).enabled) return reply({ ok: true, enabled: false, entries: [] });
    const current = await context(), { workspace } = await readEduPiEducationSnapshot({ roots: current.roots });
    const spine = object(workspace.fact_spine);
    if (spine?.projection_kind !== "education_fact_v1" || spine.external_send !== false || !Array.isArray(workspace.timetable)
      || !Array.isArray(spine.entities) || !Array.isArray(spine.accepted_facts) || !Array.isArray(spine.fact_candidates)) throw new ReflectionError("snapshot_unavailable", 503);
    const slots = slotId !== null ? [slotId] : [...new Set(records(workspace.timetable)
      .filter(slot => slot.class_id === current.binding.class_id && slot.subject === current.binding.subject
        && Number(slot.day_of_week) === (new Date(`${date}T12:00:00.000Z`).getUTCDay() || 7))
      .map(slot => slot.slot_id).filter((id): id is string => text(id)))];
    const indexScope = reflectionIndexScope(current);
    const entries = [];
    for (const slot of slots.slice(0, 20)) {
      const binding = { ...current.binding, date, slot_id: slot };
      const lesson = await read(current, binding);
      const registered = records(spine.entities).some(entity => entity.entity_id === lesson.entity_id && entity.entity_kind === "lesson_occurrence" && entity.status === "active");
      const indexed = readEduPiReflectionIndex(indexScope, { date, slotId: slot, ...(lesson.status === "ready" ? { lessonId: lesson.entity_id as string } : {}) });
      const facts = contentOnly ? [] : factId !== null ? [factId] : [...new Set([...records(spine.accepted_facts), ...records(spine.fact_candidates)]
        .filter(fact => fact.entity_id === lesson.entity_id && fact.predicate === "lesson.completed" && fact.subject_ref === current.binding.subject)
        .map(fact => fact.fact_id).filter((id): id is string => text(id) && ID.test(id))
        .concat(indexed.map(item => item.factId)))];
      if (facts.length > 20) throw new ReflectionError("completion_limit", 503);
      if (lesson.status === "ready" && facts.length) {
        for (const fact of facts) entries.push(entry(binding, await read(current, binding, fact), registered ? "registered" : "unregistered", current.grant.source_ids as unknown[]));
      } else entries.push(entry(binding, lesson, registered ? "registered" : "unregistered", current.grant.source_ids as unknown[]));
      if (lesson.status === "ready" && (factId === null || contentOnly)) {
        const contentFacts = contentOnly && factId !== null ? [factId] : await currentContentFacts(current, binding, lesson.entity_id);
        if (contentOnly && contentFacts.length) entries.pop();
        for (const fact of contentFacts) entries.push(entry(binding, await read(current, binding, fact, "content"),
          registered ? "registered" : "unregistered", current.grant.source_ids as unknown[]));
      }
    }
    if (entries.length > 400) throw new ReflectionError("content_limit", 503);
    return reply({ ok: true, enabled: true, date, entries, truncated: slots.length > 20 });
  } catch (error) { return failure(error); }
}

async function history(query: URLSearchParams) {
  if ([...query.keys()].some(key => !["history", "date", "slotId", "pageSize", "cursor", "content"].includes(key) || query.getAll(key).length !== 1)
    || query.has("content") && query.get("content") !== "true")
    return reply({ ok: false }, 400);
  const date = query.get("date"), slotId = query.get("slotId"), pageSize = query.get("pageSize"), cursor = query.get("cursor");
  if (date !== null && !dateOnly(date) || slotId !== null && !text(slotId)
    || pageSize !== null && (!/^[1-9]\d?$/u.test(pageSize) || Number(pageSize) > 50)
    || cursor !== null && !CURSOR.test(cursor)) return reply({ ok: false }, 400);
  const current = await context("history"), kind = query.get("content") === "true" ? "content" : "completion";
  const result = await readHistory(current, {
    ...(date === null ? {} : { date }), ...(slotId === null ? {} : { slot_id: slotId }),
    ...(pageSize === null ? {} : { page_size: Number(pageSize) }), ...(cursor === null ? {} : { cursor }),
  }, kind);
  if (result.status === "held") return reply({ ok: false, code: result.reason_code, result }, 409);
  return reply({ ok: true, enabled: true, history: true, entries: result.entries,
    nextCursor: result.next_cursor, snapshotHash: result.snapshot_hash, readOnly: true, ...(kind === "content" ? { content: true } : {}) });
}

function exactKeys(value: RecordValue, names: string[]): boolean {
  return Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
}

type HistoryQuery = { date?: string; slot_id?: string; page_size?: number; cursor?: string };
type HistoryEntry = RecordValue & { fact_id: string; completed_at: string; date: string; created_at: string };

function validHistoryEntry(value: unknown, current: Context, query: HistoryQuery, kind: FactKind): value is HistoryEntry {
  const item = object(value);
  if (!item || !exactKeys(item, ["lesson_id", "date", "slot_id", "term_id", "fact_id", "revision", "status", "source_id",
    "source_revision", "observation_id", "raw_text", ...(kind === "content" ? ["predicate", "value"] : ["completed_at"]),
    "created_at", "updated_at", "last_review"])
    || ![item.lesson_id, item.term_id, item.fact_id, item.observation_id].every(value => text(value) && ID.test(value))
    || !dateOnly(item.date) || query.date !== undefined && item.date !== query.date
    || item.slot_id !== null && !text(item.slot_id) || query.slot_id !== undefined && item.slot_id !== query.slot_id
    || !integer(item.revision, 0) || !["candidate", "pending_review", "held", "accepted", "rejected", "stale", "superseded"].includes(String(item.status))
    || !text(item.source_id) || !(current.grant.source_ids as unknown[]).includes(item.source_id) || !text(item.source_revision)
    || typeof item.raw_text !== "string" || !item.raw_text || item.raw_text.length > 4000 || item.raw_text.includes("\0")
    || kind === "completion" && (!timestamp(item.completed_at) || !item.raw_text.includes(item.completed_at))
    || kind === "content" && (!CONTENT_PREDICATES.includes(String(item.predicate)) || !validContentText(item.raw_text)
      || item.value !== contentValue(item.raw_text))
    || !timestamp(item.created_at) || !timestamp(item.updated_at)) return false;
  if (item.last_review === null) return !["accepted", "rejected"].includes(String(item.status));
  const review = object(item.last_review);
  return !!review && exactKeys(review, ["action", "reviewed_at"])
    && ["accept", "reject", "hold", "modify", "delete", "restore"].includes(String(review.action))
    && timestamp(review.reviewed_at);
}

async function readHistory(current: Context, query: HistoryQuery, kind: FactKind = "completion"): Promise<RecordValue> {
  const response = await current.host.callOwnerControl(kind === "content" ? "owner_reflection_content_history_read" : "owner_reflection_history_read",
    { ...current.binding, ...query });
  const result = object(response.result);
  if (response.ok !== true) throw new ReflectionError(typeof response.error_code === "string" ? response.error_code : "reflection_unavailable");
  if (!result || !exactKeys(result, ["status", "reason_code", "entries", "next_cursor", "snapshot_hash", "read_only", "external_send"])
    || result.external_send !== false || result.read_only !== true || !Array.isArray(result.entries)) throw new ReflectionError("invalid_response", 503);
  if (result.status === "held") {
    if (!text(result.reason_code) || result.entries.length || result.next_cursor !== null || result.snapshot_hash !== null)
      throw new ReflectionError("invalid_response", 503);
    return result;
  }
  const entries = result.entries;
  if (result.status !== "ready" || result.reason_code !== null || entries.length > (query.page_size ?? 50)
    || !entries.every(item => validHistoryEntry(item, current, query, kind))
    || new Set(entries.map(item => item.fact_id)).size !== entries.length
    || !hash(result.snapshot_hash)
    || entries.some((item, index) => index > 0 && (kind === "content"
      ? item.date > entries[index - 1].date || item.date === entries[index - 1].date
        && (item.created_at > entries[index - 1].created_at || item.created_at === entries[index - 1].created_at
          && item.fact_id.localeCompare(entries[index - 1].fact_id) < 0)
      : item.completed_at > entries[index - 1].completed_at
        || item.completed_at === entries[index - 1].completed_at && item.fact_id.localeCompare(entries[index - 1].fact_id) < 0))
    || result.next_cursor !== null && (typeof result.next_cursor !== "string" || !CURSOR.test(result.next_cursor)
      || result.next_cursor === query.cursor || !result.entries.length)) throw new ReflectionError("invalid_response", 503);
  if (result.next_cursor !== null) {
    try {
      const cursor = object(JSON.parse(Buffer.from(result.next_cursor as string, "base64url").toString("utf8")));
      if (!cursor || !exactKeys(cursor, ["version", "snapshot_hash", "after"]) || cursor.version !== 1
        || cursor.snapshot_hash !== result.snapshot_hash || cursor.after !== result.entries.at(-1)?.fact_id) throw new Error();
    } catch { throw new ReflectionError("invalid_response", 503); }
  }
  return result;
}

async function currentContentFacts(current: Context, binding: RecordValue, lessonId: unknown): Promise<string[]> {
  const facts = new Set<string>();
  let cursor: string | undefined, snapshot: unknown;
  for (let page = 0; page < 10; page++) {
    const result = await readHistory(current, { date: binding.date as string, slot_id: binding.slot_id as string,
      page_size: 50, ...(cursor === undefined ? {} : { cursor }) }, "content");
    if (result.status !== "ready") throw new ReflectionError(String(result.reason_code));
    if (snapshot !== undefined && snapshot !== result.snapshot_hash) throw new ReflectionError("history_changed");
    snapshot = result.snapshot_hash;
    for (const item of records(result.entries)) {
      if (item.lesson_id === lessonId && !["stale", "superseded"].includes(String(item.status))) facts.add(item.fact_id as string);
    }
    if (facts.size > 20) throw new ReflectionError("content_limit", 503);
    if (result.next_cursor === null) return [...facts];
    cursor = result.next_cursor as string;
  }
  throw new ReflectionError("content_limit", 503);
}

function inputBody(value: unknown): RecordValue | null {
  const body = object(value);
  if (!body || !["register", "capture", "review", "contentCapture", "contentReview"].includes(String(body.action))) return null;
  const fields = ["action", "classId", "subject", "date", "expectedSourceBasisHash", "expectedGrantVersion"];
  if (Object.hasOwn(body, "slotId")) fields.push("slotId");
  if (body.action === "capture") fields.push("sourceId", "sourceRevision", "rawText", "completedAt");
  if (body.action === "review") fields.push("factId", "expectedFactRevision", "expectedCompletionBasisHash", "decision");
  if (body.action === "contentCapture") fields.push("sourceId", "sourceRevision", "rawText", "predicate");
  if (body.action === "contentReview") fields.push("factId", "expectedFactRevision", "expectedContentBasisHash", "decision");
  if (Object.keys(body).length !== fields.length || fields.some(key => !Object.hasOwn(body, key))
    || !text(body.classId, 128) || !OWNER_ID.test(body.classId) || !text(body.subject, 128) || !dateOnly(body.date)
    || !hash(body.expectedSourceBasisHash) || !integer(body.expectedGrantVersion) || body.slotId !== undefined && !text(body.slotId)) return null;
  if (body.action === "capture" && (!text(body.sourceId) || !text(body.sourceRevision) || !timestamp(body.completedAt)
    || typeof body.rawText !== "string" || !body.rawText.trim() || body.rawText.length > 4000 || body.rawText.includes("\0")
    || !body.rawText.includes(body.completedAt))) return null;
  if (body.action === "review" && (!text(body.factId) || !ID.test(body.factId) || !integer(body.expectedFactRevision, 0)
    || !hash(body.expectedCompletionBasisHash) || !["accept", "reject", "withdraw"].includes(String(body.decision)))) return null;
  if (body.action === "contentCapture" && (!text(body.sourceId) || !text(body.sourceRevision) || !validContentText(body.rawText)
    || !CONTENT_PREDICATES.includes(String(body.predicate)))) return null;
  if (body.action === "contentReview" && (!text(body.factId) || !ID.test(body.factId) || !integer(body.expectedFactRevision, 0)
    || !hash(body.expectedContentBasisHash) || !["accept", "reject"].includes(String(body.decision)))) return null;
  return body;
}

export async function POST(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return reply({ ok: false }, 403);
  if (!canStartEduPiCapabilityDrafts()) return reply({ ok: false, code: "activation_pending" }, 409);
  try {
    const envelope = object(await parseJsonWithinLimit(request, 20_000));
    if (!envelope) return reply({ ok: false }, 400);
    if (envelope.action === "registerContentSource") return await registerContentSource(envelope);
    const { operationId, operationFingerprint, ...mutation } = envelope;
    const body = inputBody(mutation);
    if (!body) return reply({ ok: false }, 400);
    if (typeof operationId !== "string" || !hash(operationFingerprint)) return reply({ ok: false, code: "operation_not_prepared" }, 409);
    const operationContext = await context();
    if (body.classId !== operationContext.binding.class_id || body.subject !== operationContext.binding.subject) return reply({ ok: false, code: "scope_mismatch" }, 409);
    const outcome = await runReflectionOperation(reflectionIndexScope(operationContext), operationId, operationFingerprint, body, async dispatch => {
      const response = await performMutation(body, dispatch, operationContext);
      const responseBody = await response.json() as RecordValue;
      return { status: response.status, body: responseBody,
        ...(object(responseBody.result)?.status === "held" ? { noCommitConfirmed: true as const } : {}) };
    });
    return operationReply(outcome);
  } catch (error) { return failure(error); }
}

async function registerContentSource(body: RecordValue) {
  if (!exactKeys(body, ["action", "classId", "subject", "date", "slotId", "expectedSourceBasisHash",
    "expectedGrantVersion", "predicate", "rawText"])
    || !text(body.classId, 128) || !OWNER_ID.test(body.classId) || !text(body.subject, 128)
    || !dateOnly(body.date) || !text(body.slotId) || !hash(body.expectedSourceBasisHash)
    || !integer(body.expectedGrantVersion) || !CONTENT_PREDICATES.includes(String(body.predicate))
    || !validContentText(body.rawText)) return reply({ ok: false }, 400);
  const lockId = `reflection-source:${createHash("sha256").update(JSON.stringify([body.classId, body.subject])).digest("hex")}`;
  return withEduPiAmbientSessionLock(lockId, async () => {
    const current = await context();
    if (body.classId !== current.binding.class_id || body.subject !== current.binding.subject)
      return reply({ ok: false, code: "scope_mismatch" }, 409);
    const binding = { ...current.binding, date: body.date, slot_id: body.slotId };
    const lesson = await read(current, binding), occurrence = object(lesson.occurrence);
    if (lesson.status !== "ready" || lesson.grant_version !== body.expectedGrantVersion
      || current.grant.version !== body.expectedGrantVersion || occurrence?.source_basis_hash !== body.expectedSourceBasisHash)
      return reply({ ok: false, code: "source_changed" }, 409);
    const { workspace } = await readEduPiEducationSnapshot({ roots: current.roots });
    const spine = object(workspace.fact_spine);
    const registered = spine?.projection_kind === "education_fact_v1" && spine.external_send === false
      && records(spine.entities).some(entity => entity.entity_id === lesson.entity_id
        && entity.entity_kind === "lesson_occurrence" && entity.status === "active"
        && records(entity.external_refs).some(ref => ref.namespace === occurrence?.namespace
          && ref.external_id === occurrence?.external_id));
    if (!registered) return reply({ ok: false, code: "lesson_unregistered" }, 409);
    const sourceId = lessonContentSourceId(body, lesson.entity_id as string);
    const sources = current.grant.source_ids as string[];
    if (!sources.includes(sourceId)) {
      if (sources.length >= 128) return reply({ ok: false, code: "content_source_capacity" }, 409);
      const spec = Object.fromEntries(["scope", "domains", "actions", "starts_at", "ends_at", "budget"]
        .map(key => [key, current.grant[key]]));
      spec.source_ids = [...sources, sourceId].sort();
      try {
        const updated = await current.host.callOwnerControl("owner_control", {
          command_id: `desktop-reflection-source-${createHash("sha256").update(JSON.stringify([
            current.rootRef, current.binding.expected_owner_id, current.grant.id, current.grant.version, sourceId,
          ])).digest("hex")}`,
          root_ref: current.rootRef, expected_owner_id: current.binding.expected_owner_id, action: "update",
          grant_id: current.binding.grant_id, expected_version: current.grant.version, spec,
        });
        if (updated.ok !== true || object(updated.result)?.grant_version !== Number(current.grant.version) + 1)
          return reply({ ok: false, code: "content_source_unverified" }, 409);
        const after = await context();
        if (!isDeepStrictEqual(after.binding, current.binding) || after.roots.dataRoot.root !== current.roots.dataRoot.root
          || after.grant.version !== Number(current.grant.version) + 1
          || Object.keys(spec).some(key => !isDeepStrictEqual(after.grant[key], spec[key])))
          return reply({ ok: false, code: "content_source_unverified" }, 409);
        const readback = await read(after, binding);
        if (readback.status !== "ready" || readback.entity_id !== lesson.entity_id
          || object(readback.occurrence)?.source_basis_hash !== body.expectedSourceBasisHash
          || readback.grant_version !== after.grant.version)
          return reply({ ok: false, code: "content_source_unverified" }, 409);
        return reply({ ok: true, sourceId, entry: entry(binding, readback, "registered", after.grant.source_ids as string[]),
          readbackConfirmed: true });
      } catch {
        return reply({ ok: false, code: "content_source_unverified" }, 409);
      }
    }
    return reply({ ok: true, sourceId, entry: entry(binding, lesson, "registered", sources), readbackConfirmed: true });
  });
}

function operationReply(outcome: { operation: ReflectionOperationReceipt; response: ReflectionOperationResponse | null }) {
  const { operation, response } = outcome;
  if (operation.status === "committed" && response) return reply({ ...response.body, operation }, response.status);
  return reply({ ...(response?.body ?? {}), ok: false, operation, readbackConfirmed: false,
    code: response?.body.code ?? (operation.status === "not_committed" ? "operation_not_committed" : "operation_pending") }, response?.status ?? 409);
}

export async function PUT(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return reply({ ok: false }, 403);
  try {
    const envelope = object(await parseJsonWithinLimit(request, 20_000));
    if (!envelope || Object.keys(envelope).length !== 2 || typeof envelope.operationId !== "string") return reply({ ok: false }, 400);
    const body = inputBody(envelope.mutation);
    if (!body) return reply({ ok: false }, 400);
    const current = await context();
    if (body.classId !== current.binding.class_id || body.subject !== current.binding.subject) return reply({ ok: false, code: "scope_mismatch" }, 409);
    const operation = await prepareReflectionOperation(reflectionIndexScope(current), envelope.operationId, body);
    return reply({ ok: true, operation });
  } catch (error) { return failure(error); }
}

export async function PATCH(request: Request) {
  if (!isDesktopApiRequestAllowed(request)) return reply({ ok: false }, 403);
  try {
    const body = object(await parseJsonWithinLimit(request, 2000));
    if (!body || Object.keys(body).length !== 2 || typeof body.operationId !== "string" || !hash(body.operationFingerprint)) return reply({ ok: false }, 400);
    const current = await context("history");
    return operationReply(await resolveReflectionOperation(reflectionIndexScope(current), body.operationId, body.operationFingerprint,
      mutation => recoverMutation(current, mutation)));
  } catch (error) { return failure(error); }
}

async function recoverMutation(current: Context, mutation: RecordValue): Promise<ReflectionOperationResponse | null> {
  const body = inputBody(mutation);
  if (!body || body.classId !== current.binding.class_id || body.subject !== current.binding.subject
    || Number(body.expectedGrantVersion) > Number(current.grant.version)) return null;
  const kind = mutationKind(body), expectedFactBasis = kind === "content" ? body.expectedContentBasisHash : body.expectedCompletionBasisHash;
  const binding = { ...current.binding, date: body.date, ...(body.slotId === undefined ? {} : { slot_id: body.slotId }) };
  const lesson = await read(current, binding), occurrence = object(lesson.occurrence);
  if (lesson.status !== "ready" || lesson.grant_version !== current.grant.version
    || !occurrence || occurrence.source_basis_hash !== body.expectedSourceBasisHash
    || !(occurrence.source_ids as unknown[]).every(id => (current.grant.source_ids as unknown[]).includes(id))) return null;
  let readback = lesson;
  let registeredEntity: RecordValue | null = null;
  let historySnapshotHash: unknown;
  const registration = async () => {
    const { workspace } = await readEduPiEducationSnapshot({ roots: current.roots });
    const spine = object(workspace.fact_spine);
    if (spine?.projection_kind !== "education_fact_v1" || spine.external_send !== false) return null;
    return records(spine.entities).find(entity => entity.entity_id === lesson.entity_id
      && entity.entity_kind === "lesson_occurrence" && entity.status === "active"
      && records(entity.external_refs).some(reference => reference.namespace === occurrence.namespace
        && reference.external_id === occurrence.external_id)
      && (body.slotId === undefined || records(entity.external_refs).some(reference => reference.namespace === "edupi-timetable-selection-v1"
        && reference.external_id === occurrence.external_id))) ?? null;
  };
  if (body.action === "register") {
    registeredEntity = await registration();
    if (!registeredEntity) return null;
  } else {
    if (body.action === "capture" && (body.sourceId !== lessonReflectionCompletionSourceId({
      classId: body.classId as string, subject: body.subject as string }, lesson.entity_id as string)
      || !(current.grant.source_ids as unknown[]).includes(body.sourceId))) return null;
    if (body.action === "contentCapture" && !isBoundContentSource(body, lesson, current.grant.source_ids as unknown[])) return null;
    let cursor: string | undefined, persisted: RecordValue | null = null;
    const matches: RecordValue[] = [];
    for (let page = 0; page < 10; page++) {
      const history = await readHistory(current, { date: body.date as string,
        page_size: 50, ...(cursor === undefined ? {} : { cursor }) }, kind);
      if (history.status !== "ready" || historySnapshotHash !== undefined && history.snapshot_hash !== historySnapshotHash) return null;
      historySnapshotHash = history.snapshot_hash;
      matches.push(...records(history.entries).filter(item => item.lesson_id === lesson.entity_id
        && item.term_id === occurrence.term_id && (body.slotId === undefined || item.slot_id === body.slotId)
        && (isCapture(body) ? item.source_id === body.sourceId && item.source_revision === body.sourceRevision
          && item.raw_text === body.rawText && (kind === "content" ? item.predicate === body.predicate
            && item.value === contentValue(body.rawText as string) : item.completed_at === body.completedAt)
          : item.fact_id === body.factId && item.revision === Number(body.expectedFactRevision) + 1
            && item.status === (body.decision === "accept" ? "accepted" : "rejected")
            && object(item.last_review)?.action === (body.decision === "accept" ? "accept" : "reject"))));
      if (history.next_cursor === null) {
        if (matches.length !== 1) return null;
        persisted = matches[0];
        break;
      }
      cursor = history.next_cursor as string;
    }
    if (!persisted) return null;
    const factId = persisted.fact_id;
    readback = await read(current, binding, factId, kind);
    const completion = object(readback[kind]);
    if (readback.status !== "ready" || !completion || completion.fact_id !== factId
      || ["revision", "status", "source_id", "source_revision", "observation_id", "raw_text",
        ...(kind === "content" ? ["predicate", "value"] : ["completed_at"])]
        .some(key => completion[key] !== persisted[key])
      || isCapture(body) && (completion.source_id !== body.sourceId || completion.source_revision !== body.sourceRevision
        || completion.raw_text !== body.rawText || (kind === "content" ? completion.predicate !== body.predicate
          || completion.value !== contentValue(body.rawText as string) : completion.completed_at !== body.completedAt))
      || isReview(body) && (completion.revision !== Number(body.expectedFactRevision) + 1
        || completion.status !== (body.decision === "accept" ? "accepted" : "rejected")
        || completion.source_basis_hash === expectedFactBasis)) return null;
  }
  if (readback.entity_id !== lesson.entity_id || readback.grant_version !== current.grant.version
    || !isDeepStrictEqual(readback.occurrence, occurrence)) return null;
  const finalRead = await read(current, binding, body.action === "register" ? undefined : object(readback[kind])!.fact_id, kind);
  if (!isDeepStrictEqual(finalRead, readback)) return null;
  if (body.action === "register" && !isDeepStrictEqual(await registration(), registeredEntity)) return null;
  if (body.action !== "register") {
    const finalHistory = await readHistory(current, { date: body.date as string, page_size: 50 }, kind);
    if (finalHistory.status !== "ready" || finalHistory.snapshot_hash !== historySnapshotHash) return null;
  }
  const finalContext = await context("history");
  if (!isDeepStrictEqual(finalContext.binding, current.binding) || !isDeepStrictEqual(finalContext.grant, current.grant)
    || finalContext.roots.dataRoot.root !== current.roots.dataRoot.root) return null;
  if (body.action !== "register" && kind === "completion") appendEduPiReflectionIndex(reflectionIndexScope(current), { date: body.date as string,
    slotId: occurrence.slot_id as string, lessonId: lesson.entity_id as string,
    factId: object(readback.completion)!.fact_id as string }, readback);
  const result = { ...readback, status: body.action === "register" ? "registered" : isCapture(body) ? "recorded" : "reviewed",
    ...(isReview(body) ? {} : { replayed: true }) };
  return { status: 200, body: { ok: true, result, readback, readbackConfirmed: true,
    entry: entry(binding, readback, "registered", current.grant.source_ids as unknown[]) } };
}

async function performMutation(body: RecordValue, dispatch: () => void, operationContext: Context) {
  try {
    const kind = mutationKind(body), expectedFactBasis = kind === "content" ? body.expectedContentBasisHash : body.expectedCompletionBasisHash;
    const lockId = `reflection:${createHash("sha256").update(JSON.stringify([body.classId, body.subject, body.date, body.slotId ?? null])).digest("hex")}`;
    return await withEduPiAmbientSessionLock(lockId, async () => {
      const current = await context();
      if (!isDeepStrictEqual(current.binding, operationContext.binding) || current.roots.dataRoot.root !== operationContext.roots.dataRoot.root)
        return reply({ ok: false, code: "source_changed" }, 409);
      if (body.classId !== current.binding.class_id || body.subject !== current.binding.subject) return reply({ ok: false, code: "scope_mismatch" }, 409);
      const binding = { ...current.binding, date: body.date, ...(body.slotId === undefined ? {} : { slot_id: body.slotId }) };
      const before = await read(current, binding, isReview(body) ? body.factId : undefined, kind), occurrence = object(before.occurrence);
      if (before.status !== "ready") return reply({ ok: false, result: before, readbackConfirmed: false }, 409);
      if (before.grant_version !== body.expectedGrantVersion || occurrence?.source_basis_hash !== body.expectedSourceBasisHash
        || isReview(body) && (object(before[kind])?.revision !== body.expectedFactRevision
          || object(before[kind])?.source_basis_hash !== expectedFactBasis)) return reply({ ok: false, code: "source_changed" }, 409);
      if (body.action === "capture" && (!(current.grant.source_ids as unknown[]).includes(body.sourceId)
        || body.sourceId !== lessonReflectionCompletionSourceId({ classId: body.classId as string, subject: body.subject as string }, before.entity_id as string)
        || (occurrence?.source_ids as unknown[]).includes(body.sourceId))) return reply({ ok: false, code: "permission_denied" }, 409);
      if (body.action === "contentCapture" && !isBoundContentSource(body, before, current.grant.source_ids as unknown[]))
        return reply({ ok: false, code: "permission_denied" }, 409);
      const operation = body.action === "register" ? "owner_reflection_lesson_register"
        : `owner_reflection_${kind}_${isCapture(body) ? "capture" : "review"}`;
      const payload = { ...binding, expected_source_basis_hash: body.expectedSourceBasisHash, expected_grant_version: body.expectedGrantVersion,
        ...(body.action === "capture" ? { source_id: body.sourceId, source_revision: body.sourceRevision, raw_text: body.rawText, completed_at: body.completedAt } : {}),
        ...(body.action === "review" ? { fact_id: body.factId, expected_fact_revision: body.expectedFactRevision,
          expected_completion_basis_hash: body.expectedCompletionBasisHash, decision: body.decision } : {}),
        ...(body.action === "contentCapture" ? { source_id: body.sourceId, source_revision: body.sourceRevision,
          raw_text: body.rawText, predicate: body.predicate } : {}),
        ...(body.action === "contentReview" ? { fact_id: body.factId, expected_fact_revision: body.expectedFactRevision,
          expected_content_basis_hash: body.expectedContentBasisHash, decision: body.decision } : {}) };
      if (body.action === "review") {
        try {
          appendEduPiReflectionIndex(reflectionIndexScope(current), { date: body.date as string,
            slotId: occurrence!.slot_id as string, lessonId: before.entity_id as string,
            factId: body.factId as string }, before);
        } catch { return reply({ ok: false, code: "reflection_index_unavailable" }, 503); }
      }
      let result: RecordValue;
      try {
        dispatch();
        result = validateResult(await current.host.callOwnerControl(operation, payload), binding,
          body.action === "register" ? "registered" : isCapture(body) ? "recorded" : "reviewed",
          isReview(body) ? body.factId : undefined, kind);
      } catch (error) {
        if (error instanceof ReflectionError && error.status === 409) throw error;
        result = { status: "commit_unknown", reason_code: "source_changed", entity_id: before.entity_id, occurrence: before.occurrence,
          ...(body.action === "register" ? {} : { fact_id: isReview(body) ? body.factId : null }), external_send: false };
      }
      if (result.status === "held") return reply({ ok: false, result, readbackConfirmed: false }, 409);
      const completion = object(result[kind]), factId = completion?.fact_id ?? result.fact_id;
      let readback: RecordValue | null = null;
      try { if (body.action === "register" || typeof factId === "string") readback = await read(current, binding, body.action === "register" ? undefined : factId, kind); } catch { readback = null; }
      const uncertain = result.status === "commit_unknown" || result.status === "committed_unverified";
      let registrationVerified = body.action !== "register";
      if (body.action === "register" && !uncertain && readback?.status === "ready") {
        try {
          const { workspace } = await readEduPiEducationSnapshot({ roots: current.roots });
          const spine = object(workspace.fact_spine);
          registrationVerified = spine?.projection_kind === "education_fact_v1" && spine.external_send === false
            && records(spine.entities).some(entity => entity.entity_id === result.entity_id
              && entity.entity_kind === "lesson_occurrence" && entity.status === "active"
              && records(entity.external_refs).some(reference => reference.namespace === occurrence?.namespace && reference.external_id === occurrence?.external_id));
        } catch { registrationVerified = false; }
      }
      const completionMatches = body.action === "register" || completion && isDeepStrictEqual(readback?.[kind], completion)
        && (!isReview(body) || completion.status === (body.decision === "accept" ? "accepted" : "rejected")
          && typeof completion.revision === "number" && completion.revision > (object(before[kind])?.revision as number))
        && (!isCapture(body) || completion.source_id === body.sourceId && completion.source_revision === body.sourceRevision
          && completion.raw_text === body.rawText && (kind === "content" ? completion.predicate === body.predicate
            && completion.value === contentValue(body.rawText as string) : completion.completed_at === body.completedAt));
      const verified = !uncertain && readback?.status === "ready" && readback.entity_id === result.entity_id
        && readback.grant_version === body.expectedGrantVersion && isDeepStrictEqual(readback.occurrence, result.occurrence)
        && result.entity_id === before.entity_id && isDeepStrictEqual(result.occurrence, before.occurrence)
        && registrationVerified && completionMatches;
      if (!verified) {
        const pending = uncertain ? result : { status: "committed_unverified", reason_code: "source_changed", entity_id: result.entity_id,
          occurrence: result.occurrence, ...(body.action === "register" ? {} : { fact_id: factId ?? null }), external_send: false };
        return reply({ ok: false, result: pending, readback, readbackConfirmed: false }, 409);
      }
      if (typeof factId === "string" && (body.action === "capture" || body.action === "review")) {
        try {
          appendEduPiReflectionIndex(reflectionIndexScope(current), { date: body.date as string,
            slotId: object(readback!.occurrence)!.slot_id as string, lessonId: readback!.entity_id as string,
            factId }, readback);
        } catch {
          return reply({ ok: false, code: "reflection_index_unavailable", result: { status: "committed_unverified",
            reason_code: "reflection_index_unavailable", fact_id: factId, entity_id: result.entity_id,
            occurrence: result.occurrence, external_send: false }, readback, readbackConfirmed: false }, 503);
        }
      }
      return reply({ ok: true, result, readback, readbackConfirmed: true,
        entry: entry(binding, readback!, "registered", current.grant.source_ids as unknown[]) });
    });
  } catch (error) { return failure(error); }
}
