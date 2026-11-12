import { desktopApiHeaders, fetchDesktopApi } from "./desktop-native";
import { readEduPiProactivity, updateEduPiProactivity, type EduPiProactivityState } from "./edupi-proactivity-client";

export type ReflectionCompletion = {
  factId: string;
  revision: number;
  status: "candidate" | "pending_review" | "held" | "accepted" | "rejected";
  rawText: string;
  completedAt: string;
  sourceBasisHash: string;
  sourceId: string;
  sourceRevision: string;
};

export type ReflectionContentPredicate = "lesson.observation" | "lesson.feedback" | "lesson.statistic" | "lesson.outcome" | "lesson.review";
export type ReflectionContent = {
  factId: string;
  revision: number;
  status: ReflectionCompletion["status"];
  predicate: ReflectionContentPredicate;
  rawText: string;
  sourceBasisHash: string;
  sourceId: string;
  sourceRevision: string;
};

export type ReflectionEntry = {
  classId: string;
  subject: string;
  date: string;
  slotId: string | null;
  lessonId: string | null;
  lessonAt: string | null;
  registrationStatus: "registered" | "unregistered";
  status: "ready" | "held";
  reasonCode: string | null;
  sourceBasisHash: string | null;
  grantVersion: number | null;
  completionSourceIds: string[];
  completion: ReflectionCompletion | null;
  contentSourceIds: string[];
  content: ReflectionContent | null;
};

export type ReflectionList = { enabled: boolean; entries: ReflectionEntry[]; truncated: boolean };
export type ReflectionOperationReceipt = {
  id: string;
  fingerprint: string;
  status: "prepared" | "running" | "committed" | "not_committed" | "unknown";
  terminal: boolean;
};
export type ReflectionRecovery = {
  operation: ReflectionOperationReceipt;
  entry: ReflectionEntry | null;
  code: string | null;
};
export type ReflectionHistoryEntry = {
  lesson_id: string;
  date: string;
  slot_id: string | null;
  term_id: string;
  fact_id: string;
  revision: number;
  status: ReflectionCompletion["status"] | "stale" | "superseded";
  source_id: string;
  source_revision: string;
  observation_id: string;
  raw_text: string;
  completed_at: string;
  created_at: string;
  updated_at: string;
  last_review: { action: "accept" | "reject" | "hold" | "modify" | "delete" | "restore"; reviewed_at: string } | null;
};
export type ReflectionHistory = { entries: ReflectionHistoryEntry[]; nextCursor: string | null; snapshotHash: string };
export type ReflectionContentHistoryEntry = Omit<ReflectionHistoryEntry, "completed_at"> & {
  predicate: ReflectionContentPredicate;
  value: string;
};
export type ReflectionContentHistory = { entries: ReflectionContentHistoryEntry[]; nextCursor: string | null; snapshotHash: string };
export type ReflectionRecoveryScope = Pick<ReflectionEntry, "classId" | "subject">;
export type ReflectionRecoveryKind = "registration" | "completion" | "content";
export type ReflectionAction =
  | { action: "register" }
  | { action: "capture"; sourceId: string; sourceRevision: string; rawText: string; completedAt: string }
  | { action: "review"; decision: "accept" | "reject" | "withdraw" }
  | { action: "contentCapture"; sourceId: string; sourceRevision: string; predicate: ReflectionContentPredicate; rawText: string }
  | { action: "contentReview"; factId: string; expectedFactRevision: number; expectedContentBasisHash: string; decision: "accept" | "reject" };

const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown, max = 160): value is string => typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
const hash = (value: unknown) => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const integer = (value: unknown, minimum = 1) => Number.isSafeInteger(value) && Number(value) >= minimum;
const time = (value: unknown) => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const contentPredicates = ["lesson.observation", "lesson.feedback", "lesson.statistic", "lesson.outcome", "lesson.review"];
const sourceText = (value: unknown): value is string => text(value) && value === value.normalize("NFKC").trim();
const validContentText = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > 4000) return false;
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return normalized.length > 0 && normalized.length <= 4000 && !/[\u0000-\u001f\u007f]/u.test(normalized);
};

export class ReflectionActionError extends Error {
  constructor(message: string, readonly uncertain = false, readonly code?: string,
    readonly operation?: ReflectionOperationReceipt) { super(message); }
}

const reasonLabels: Record<string, string> = {
  lesson_ambiguous: "同日课次有歧义，请选择具体课次",
  lesson_not_found: "未找到当前课次",
  lesson_not_registered: "请先登记课次",
  scope_unverified: "班级或学期依据不可用",
  permission_denied: "当前授权不包含此来源",
  source_changed: "依据已变化，请刷新",
  source_unavailable: "来源暂不可用",
  completion_source_unavailable: "完课依据暂不可用",
  completion_conflict: "完课记录存在冲突",
  completion_exists: "已有不同的完课记录",
  content_source_unavailable: "课堂内容依据暂不可用",
  content_source_unverified: "课堂内容来源尚未确认，请刷新后重试",
  content_source_capacity: "课堂内容来源已达上限",
  content_limit: "本课课堂内容已达上限",
  scope_mismatch: "课次授权范围已变化，请刷新",
  lesson_unregistered: "请先登记课次",
  content_exists: "已有不同的课堂内容记录",
  invalid_content: "课堂内容或来源无效",
  source_conflict: "来源已用于其他记录",
  invalid_completion: "完课时间或内容无效",
  owner_unavailable: "教师授权暂不可用",
  activation_pending: "课后反思尚未启用",
  history_changed: "历史记录已变化，请重新读取",
  operation_not_prepared: "操作尚未准备，请刷新",
  operation_mismatch: "操作凭据不匹配，请刷新核对",
  operation_not_committed: "操作未提交，请刷新后重试",
  operation_pending: "操作结果尚未确认，请核对记录后再处理",
  reflection_operation_busy: "操作仍在处理中，请稍后核对",
  reflection_operation_unavailable: "操作记录暂不可用，请稍后核对",
};

export function reflectionReason(reason: unknown): string {
  return typeof reason === "string" && reasonLabels[reason] || "当前依据不可用";
}

function parseEntry(value: unknown, date?: string): ReflectionEntry {
  const entry = record(value), completion = record(entry?.completion), content = record(entry?.content);
  if (!entry || !text(entry.classId, 128) || !text(entry.subject, 128)
    || typeof entry.date !== "string" || !/^\d{4}-\d\d-\d\d$/u.test(entry.date) || date && entry.date !== date
    || entry.slotId !== null && !text(entry.slotId)
    || !["registered", "unregistered"].includes(String(entry.registrationStatus))
    || !["ready", "held"].includes(String(entry.status))
    || !Array.isArray(entry.completionSourceIds) || entry.completionSourceIds.length > 128
    || !entry.completionSourceIds.every(id => text(id))
    || !Array.isArray(entry.contentSourceIds) || entry.contentSourceIds.length > 128
    || !entry.contentSourceIds.every(id => sourceText(id))
    || entry.status === "ready" && (!text(entry.lessonId) || !text(entry.slotId) || !time(entry.lessonAt)
      || !hash(entry.sourceBasisHash) || !integer(entry.grantVersion) || entry.reasonCode !== null)
    || entry.status === "held" && (!text(entry.reasonCode) || entry.lessonId !== null || entry.lessonAt !== null
      || entry.sourceBasisHash !== null || entry.grantVersion !== null || entry.completion !== null || entry.content !== null)
    || entry.completion !== null && (!completion || !text(completion.factId) || !integer(completion.revision, 0)
      || !["candidate", "pending_review", "held", "accepted", "rejected"].includes(String(completion.status))
      || typeof completion.rawText !== "string" || !completion.rawText || completion.rawText.length > 4000
      || !time(completion.completedAt) || !hash(completion.sourceBasisHash)
      || !text(completion.sourceId) || !text(completion.sourceRevision))
    || entry.content !== null && (!content || !text(content.factId) || !integer(content.revision, 0)
      || !["candidate", "pending_review", "held", "accepted", "rejected"].includes(String(content.status))
      || !contentPredicates.includes(String(content.predicate)) || !validContentText(content.rawText)
      || !hash(content.sourceBasisHash) || !sourceText(content.sourceId) || !sourceText(content.sourceRevision))) throw new Error("课次信息无效");
  return entry as ReflectionEntry;
}

export function parseReflectionList(value: unknown, date: string): ReflectionList {
  const body = record(value);
  if (body?.ok !== true || body.externalSend !== false || typeof body.enabled !== "boolean" || !Array.isArray(body.entries)
    || body.entries.length > 400 || body.enabled && (body.date !== date || typeof body.truncated !== "boolean")
    || !body.enabled && body.entries.length !== 0) throw new Error("课次信息暂不可用");
  return { enabled: body.enabled, entries: body.entries.map(item => parseEntry(item, date)), truncated: body.truncated === true };
}

export async function readReflection(date: string, signal?: AbortSignal): Promise<ReflectionList> {
  const params = new URLSearchParams({ date });
  const response = await fetch(`/api/edupi/proactivity/reflection?${params}`, { cache: "no-store", signal,
    headers: await desktopApiHeaders() });
  const body: unknown = await response.json();
  if (!response.ok) {
    const code = record(body)?.code;
    throw new ReflectionActionError(reflectionReason(code), false, typeof code === "string" ? code : undefined);
  }
  return parseReflectionList(body, date);
}

export type ReflectionContentSourceInput = { predicate: ReflectionContentPredicate; rawText: string };
export type ReflectionContentSource = { sourceId: string; entry: ReflectionEntry };

export async function verifyReflectionContentSource(entry: ReflectionEntry, input: ReflectionContentSourceInput,
  value: unknown): Promise<ReflectionContentSource> {
  try {
    const result = record(value);
    if (!result || Object.keys(result).length !== 2 || !Object.hasOwn(result, "sourceId")
      || !Object.hasOwn(result, "entry")) throw new Error("invalid");
    const saved = parseEntry(result.entry, entry.date);
    const digest = async (value: unknown) => Array.from(new Uint8Array(
      await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)))),
    byte => byte.toString(16).padStart(2, "0")).join("");
    const sourceId = `lesson-content:${(await digest([entry.classId, entry.subject, entry.lessonId])).slice(0, 24)}:${await digest([input.predicate, input.rawText])}`;
    if (result.sourceId !== sourceId || saved.classId !== entry.classId || saved.subject !== entry.subject
      || saved.slotId !== entry.slotId || saved.lessonId !== entry.lessonId || saved.lessonAt !== entry.lessonAt
      || saved.status !== "ready" || saved.registrationStatus !== "registered"
      || saved.sourceBasisHash !== entry.sourceBasisHash || saved.grantVersion === null || entry.grantVersion === null
      || saved.grantVersion < entry.grantVersion || !saved.contentSourceIds.includes(sourceId)
      || !entry.contentSourceIds.every(id => saved.contentSourceIds.includes(id))
      || !entry.completionSourceIds.every(id => saved.completionSourceIds.includes(id))) throw new Error("invalid");
    return { sourceId, entry: saved };
  } catch {
    throw new ReflectionActionError(reflectionReason("content_source_unverified"), false, "content_source_unverified");
  }
}

export async function registerReflectionContentSource(entry: ReflectionEntry, input: ReflectionContentSourceInput,
  signal?: AbortSignal): Promise<ReflectionContentSource> {
  try {
    parseEntry(entry);
    if (entry.status !== "ready" || entry.registrationStatus !== "registered" || entry.content
      || !validDate(entry.date) || !/^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/u.test(entry.classId)
      || !sourceText(entry.subject) || !sourceText(entry.slotId) || !sourceText(entry.lessonId)
      || !record(input) || Object.keys(input).length !== 2
      || !contentPredicates.includes(input.predicate) || !validContentText(input.rawText)) throw new Error("invalid");
  } catch {
    throw new ReflectionActionError("请核对课次和课堂内容", false, "invalid_content");
  }
  let response: Response, body: Record<string, unknown> | null;
  try {
    response = await fetchDesktopApi("/api/edupi/proactivity/reflection", {
      method: "POST", cache: "no-store", signal, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "registerContentSource", classId: entry.classId, subject: entry.subject,
        date: entry.date, slotId: entry.slotId, expectedSourceBasisHash: entry.sourceBasisHash,
        expectedGrantVersion: entry.grantVersion, predicate: input.predicate, rawText: input.rawText }),
    });
    body = record(await response.json());
  } catch {
    throw new ReflectionActionError(reflectionReason("content_source_unverified"), false, "content_source_unverified");
  }
  if (!response.ok || body?.ok !== true) {
    const code = typeof body?.code === "string" ? body.code : "content_source_unverified";
    throw new ReflectionActionError(reflectionReason(code), false, code);
  }
  if (body.externalSend !== false || body.readbackConfirmed !== true || Object.keys(body).length !== 5) {
    throw new ReflectionActionError(reflectionReason("content_source_unverified"), false, "content_source_unverified");
  }
  return verifyReflectionContentSource(entry, input, { sourceId: body.sourceId, entry: body.entry });
}

const cursorPattern = /^[A-Za-z0-9_-]{1,512}$/u;
const operationIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const historyIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,159}$/u;

function validDate(value: unknown): boolean {
  return typeof value === "string" && /^\d{4}-\d\d-\d\d$/u.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

function validHistoryEntry(value: unknown): value is ReflectionHistoryEntry {
  const item = record(value), review = record(item?.last_review);
  return !!item && [item.lesson_id, item.term_id, item.fact_id, item.observation_id]
    .every(value => text(value) && historyIdPattern.test(value))
    && validDate(item.date) && (item.slot_id === null || text(item.slot_id))
    && integer(item.revision, 0)
    && ["candidate", "pending_review", "held", "accepted", "rejected", "stale", "superseded"].includes(String(item.status))
    && text(item.source_id) && text(item.source_revision)
    && typeof item.raw_text === "string" && item.raw_text.length > 0 && item.raw_text.length <= 4000
    && !item.raw_text.includes("\0") && time(item.completed_at) && item.raw_text.includes(item.completed_at as string)
    && time(item.created_at) && time(item.updated_at)
    && (item.last_review === null ? !["accepted", "rejected"].includes(String(item.status))
      : !!review && ["accept", "reject", "hold", "modify", "delete", "restore"].includes(String(review.action))
        && time(review.reviewed_at));
}

export function parseReflectionHistory(value: unknown, cursor?: string): ReflectionHistory {
  const body = record(value);
  if (body?.ok !== true || body.externalSend !== false || body.enabled !== true || body.history !== true
    || body.readOnly !== true || !Array.isArray(body.entries) || body.entries.length > 50
    || !body.entries.every(validHistoryEntry) || !hash(body.snapshotHash)
    || new Set(body.entries.map(item => item.fact_id)).size !== body.entries.length
    || body.entries.some((item, index, entries) => index > 0 && (item.completed_at > entries[index - 1].completed_at
      || item.completed_at === entries[index - 1].completed_at && item.fact_id.localeCompare(entries[index - 1].fact_id) < 0))
    || body.nextCursor !== null && (typeof body.nextCursor !== "string" || !cursorPattern.test(body.nextCursor)
      || body.nextCursor === cursor || body.entries.length === 0)) {
    throw new ReflectionActionError("历史记录暂不可用", false, "invalid_response");
  }
  return { entries: body.entries as ReflectionHistoryEntry[], nextCursor: body.nextCursor as string | null,
    snapshotHash: body.snapshotHash as string };
}

export async function readReflectionHistory(cursor?: string, signal?: AbortSignal): Promise<ReflectionHistory> {
  if (cursor !== undefined && !cursorPattern.test(cursor)) throw new ReflectionActionError("历史记录游标无效", false, "invalid_cursor");
  const params = new URLSearchParams({ history: "true", ...(cursor === undefined ? {} : { cursor }) });
  const response = await fetch(`/api/edupi/proactivity/reflection?${params}`, { cache: "no-store", signal,
    headers: await desktopApiHeaders() });
  const body: unknown = await response.json();
  if (!response.ok || record(body)?.ok !== true) {
    const code = record(body)?.code;
    throw new ReflectionActionError(reflectionReason(code), false, typeof code === "string" ? code : undefined);
  }
  return parseReflectionHistory(body, cursor);
}

const contentHistoryKeys = ["lesson_id", "date", "slot_id", "term_id", "fact_id", "revision", "status",
  "source_id", "source_revision", "observation_id", "raw_text", "created_at", "updated_at",
  "last_review", "predicate", "value"];

function validContentHistoryEntry(value: unknown): value is ReflectionContentHistoryEntry {
  const item = record(value), review = record(item?.last_review);
  if (!item || Object.keys(item).length !== contentHistoryKeys.length
    || !contentHistoryKeys.every(key => Object.hasOwn(item, key))) return false;
  return [item.lesson_id, item.term_id, item.fact_id, item.observation_id]
    .every(value => text(value) && historyIdPattern.test(value))
    && validDate(item.date) && (item.slot_id === null || text(item.slot_id))
    && integer(item.revision, 0)
    && ["candidate", "pending_review", "held", "accepted", "rejected", "stale", "superseded"].includes(String(item.status))
    && text(item.source_id) && text(item.source_revision)
    && contentPredicates.includes(String(item.predicate)) && validContentText(item.raw_text)
    && item.value === item.raw_text.normalize("NFKC").replace(/\s+/gu, " ").trim()
    && time(item.created_at) && time(item.updated_at)
    && (item.last_review === null ? !["accepted", "rejected"].includes(String(item.status))
      : !!review && Object.keys(review).length === 2 && Object.hasOwn(review, "action")
        && Object.hasOwn(review, "reviewed_at")
        && ["accept", "reject", "hold", "modify", "delete", "restore"].includes(String(review.action))
        && time(review.reviewed_at));
}

export function parseReflectionContentHistory(value: unknown, cursor?: string): ReflectionContentHistory {
  const body = record(value);
  if (body?.ok !== true || body.externalSend !== false || body.enabled !== true || body.history !== true
    || body.content !== true || body.readOnly !== true || !Array.isArray(body.entries) || body.entries.length > 50
    || !body.entries.every(validContentHistoryEntry) || !hash(body.snapshotHash)
    || new Set(body.entries.map(item => item.fact_id)).size !== body.entries.length
    || body.entries.some((item, index, entries) => index > 0 && (item.date > entries[index - 1].date
      || item.date === entries[index - 1].date && (item.created_at > entries[index - 1].created_at
        || item.created_at === entries[index - 1].created_at && item.fact_id.localeCompare(entries[index - 1].fact_id) < 0)))
    || body.nextCursor !== null && (typeof body.nextCursor !== "string" || !cursorPattern.test(body.nextCursor)
      || body.nextCursor === cursor || body.entries.length === 0)) {
    throw new ReflectionActionError("课堂内容历史暂不可用", false, "invalid_response");
  }
  return { entries: body.entries as ReflectionContentHistoryEntry[], nextCursor: body.nextCursor as string | null,
    snapshotHash: body.snapshotHash as string };
}

export async function readReflectionContentHistory(cursor?: string, signal?: AbortSignal): Promise<ReflectionContentHistory> {
  if (cursor !== undefined && !cursorPattern.test(cursor)) throw new ReflectionActionError("历史记录游标无效", false, "invalid_cursor");
  const params = new URLSearchParams({ history: "true", content: "true", ...(cursor === undefined ? {} : { cursor }) });
  const response = await fetch(`/api/edupi/proactivity/reflection?${params}`, { cache: "no-store", signal,
    headers: await desktopApiHeaders() });
  const body: unknown = await response.json();
  if (!response.ok || record(body)?.ok !== true) {
    const code = record(body)?.code;
    throw new ReflectionActionError(reflectionReason(code), false, typeof code === "string" ? code : undefined);
  }
  return parseReflectionContentHistory(body, cursor);
}

export async function verifyReflectionRecoveryHistory(entry: ReflectionEntry, kind: ReflectionRecoveryKind,
  signal?: AbortSignal): Promise<boolean> {
  parseEntry(entry);
  if (entry.status !== "ready" || entry.registrationStatus !== "registered" || !entry.slotId || !entry.lessonId
    || !["registration", "completion", "content"].includes(kind)
    || kind === "completion" && !entry.completion || kind === "content" && !entry.content) {
    throw new ReflectionActionError("操作回执无效，请核对记录", true, "invalid_response");
  }
  let cursor: string | undefined, snapshot: string | undefined;
  const cursors = new Set<string>();
  for (let page = 0; page < 10; page++) {
    const query = new URLSearchParams({ history: "true", classId: entry.classId, subject: entry.subject,
      date: entry.date, slotId: entry.slotId, pageSize: "50",
      ...(kind === "content" ? { content: "true" } : {}), ...(cursor ? { cursor } : {}) });
    const response = await fetch(`/api/edupi/proactivity/reflection?${query}`, { cache: "no-store", signal,
      headers: await desktopApiHeaders() });
    const body = record(await response.json());
    if (!response.ok || body?.ok !== true || body.classId !== entry.classId || body.subject !== entry.subject) {
      const code = typeof body?.code === "string" ? body.code : "invalid_response";
      throw new ReflectionActionError(reflectionReason(code), true, code);
    }
    const history = kind === "content" ? parseReflectionContentHistory(body, cursor) : parseReflectionHistory(body, cursor);
    if (snapshot !== undefined && snapshot !== history.snapshotHash) {
      throw new ReflectionActionError(reflectionReason("history_changed"), true, "history_changed");
    }
    snapshot = history.snapshotHash;
    // Registration has no fact yet. Its terminal receipt already proves the
    // persisted registration; this read verifies the receipt's historical scope.
    if (kind === "registration") return true;
    const expected = kind === "content" ? entry.content! : entry.completion!;
    if (history.entries.some(item => item.lesson_id === entry.lessonId && item.date === entry.date
      && item.slot_id === entry.slotId && item.fact_id === expected.factId
      && item.revision === expected.revision && item.status === expected.status
      && item.raw_text === expected.rawText && item.source_id === expected.sourceId
      && item.source_revision === expected.sourceRevision
      && (kind === "content" ? "predicate" in item && item.predicate === entry.content!.predicate
        : "completed_at" in item && item.completed_at === entry.completion!.completedAt))) return true;
    if (history.nextCursor === null) return false;
    if (cursors.has(history.nextCursor)) {
      throw new ReflectionActionError("历史记录游标无效，请重新读取", true, "invalid_response");
    }
    cursors.add(history.nextCursor);
    cursor = history.nextCursor;
  }
  throw new ReflectionActionError("历史记录核对未完成，请重新读取", true, "history_limit");
}

export function reflectionReadbackMatches(entry: ReflectionEntry, action: ReflectionAction, entries: ReflectionEntry[]): boolean {
  return entries.some(saved => {
    if (saved.classId !== entry.classId || saved.subject !== entry.subject || saved.date !== entry.date
      || saved.slotId !== entry.slotId || saved.lessonId !== entry.lessonId || saved.status !== "ready"
      || saved.registrationStatus !== "registered") return false;
    if (action.action === "register") return true;
    if (action.action === "contentCapture") {
      const content = saved.content;
      return !!content && content.rawText === action.rawText && content.predicate === action.predicate
        && content.sourceId === action.sourceId && content.sourceRevision === action.sourceRevision;
    }
    if (action.action === "contentReview") {
      const content = saved.content;
      return !!content && content.factId === action.factId && content.revision === action.expectedFactRevision + 1
        && content.sourceBasisHash !== action.expectedContentBasisHash
        && content.status === (action.decision === "accept" ? "accepted" : "rejected");
    }
    const completion = saved.completion;
    if (!completion) return false;
    if (action.action === "capture") return completion.rawText === action.rawText && completion.completedAt === action.completedAt
      && completion.sourceId === action.sourceId && completion.sourceRevision === action.sourceRevision;
    return completion.factId === entry.completion?.factId && completion.revision === entry.completion.revision + 1
      && completion.status === (action.decision === "accept" ? "accepted" : "rejected");
  });
}

export async function refreshReflectionSources(entry: ReflectionEntry, signal?: AbortSignal): Promise<ReflectionList> {
  const matchesScope = (state: EduPiProactivityState) => state.limits.domain === "lesson_reflection"
    && state.activation.enabled && state.activation.configurationStatus === "ready"
    && state.activation.scope?.classId === entry.classId && state.activation.scope.subject === entry.subject
    && state.grant?.status === "active";
  const state = await readEduPiProactivity(signal, "lesson_reflection");
  if (entry.registrationStatus !== "registered" || entry.status !== "ready" || !matchesScope(state)) {
    throw new ReflectionActionError("课后反思授权已变化，请刷新");
  }
  const next = await updateEduPiProactivity({ enabled: true, classId: entry.classId, subject: entry.subject,
    expectedUpdatedAt: state.activation.updatedAt, domain: "lesson_reflection" }, signal);
  if (!matchesScope(next)) throw new ReflectionActionError("课后反思授权已变化，请刷新");
  const result = await readReflection(entry.date, signal);
  if (!result.enabled || !reflectionReadbackMatches(entry, { action: "register" }, result.entries)) {
    throw new ReflectionActionError("课次依据已变化，请刷新");
  }
  return result;
}

export function reflectionRequest(entry: ReflectionEntry, action: ReflectionAction) {
  if (entry.status !== "ready" || !entry.slotId || !entry.sourceBasisHash || !entry.grantVersion) throw new Error("课次依据已变化，请刷新");
  const base = { classId: entry.classId, subject: entry.subject, date: entry.date, slotId: entry.slotId,
    expectedSourceBasisHash: entry.sourceBasisHash, expectedGrantVersion: entry.grantVersion };
  if (action.action === "register") {
    if (entry.registrationStatus !== "unregistered") throw new Error("课次已登记");
    return { ...base, action: action.action };
  }
  if (action.action === "capture") {
    if (entry.registrationStatus !== "registered" || entry.completion || !entry.completionSourceIds.includes(action.sourceId)
      || !text(action.sourceRevision) || !time(action.completedAt) || !action.rawText.trim()
      || action.rawText.length > 4000 || !action.rawText.includes(action.completedAt)) throw new Error("请核对完课内容和来源");
    return { ...base, ...action };
  }
  if (action.action === "contentCapture") {
    if (entry.registrationStatus !== "registered" || entry.content || !entry.contentSourceIds.includes(action.sourceId)
      || !sourceText(action.sourceRevision) || !contentPredicates.includes(action.predicate) || !validContentText(action.rawText)) {
      throw new Error("请核对课堂内容和来源");
    }
    return { ...base, ...action };
  }
  if (action.action === "contentReview") {
    const content = entry.content;
    if (entry.registrationStatus !== "registered" || !content || content.factId !== action.factId
      || content.revision !== action.expectedFactRevision || content.sourceBasisHash !== action.expectedContentBasisHash
      || !["candidate", "pending_review", "held"].includes(content.status)
      || !["accept", "reject"].includes(action.decision)) throw new Error("课堂内容已变化，请刷新");
    return { ...base, ...action };
  }
  const completion = entry.completion;
  if (!completion || action.decision === "withdraw" && completion.status !== "accepted"
    || action.decision !== "withdraw" && !["candidate", "pending_review", "held"].includes(completion.status)) throw new Error("完课记录已变化，请刷新");
  return { ...base, action: action.action, factId: completion.factId, expectedFactRevision: completion.revision,
    expectedCompletionBasisHash: completion.sourceBasisHash, decision: action.decision };
}

function parseOperation(value: unknown, id: string, fingerprint?: string): ReflectionOperationReceipt {
  const operation = record(value);
  if (!operation || operation.id !== id || !operationIdPattern.test(id) || !hash(operation.fingerprint)
    || fingerprint !== undefined && operation.fingerprint !== fingerprint
    || !["prepared", "running", "committed", "not_committed", "unknown"].includes(String(operation.status))
    || operation.terminal !== ["committed", "not_committed"].includes(String(operation.status))) {
    throw new Error("操作回执无效");
  }
  return operation as ReflectionOperationReceipt;
}

async function operationRequest(method: "PUT" | "POST" | "PATCH", input: unknown, signal?: AbortSignal) {
  try {
    const response = await fetchDesktopApi("/api/edupi/proactivity/reflection", { method, cache: "no-store", signal,
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    return { response, body: record(await response.json()) };
  } catch {
    throw new ReflectionActionError(method === "PUT" ? "操作准备失败，请重试" : "操作结果未知，请核对记录后再处理",
      method !== "PUT", "reflection_unavailable");
  }
}

export async function prepareReflection(entry: ReflectionEntry, action: ReflectionAction, operationId: string,
  signal?: AbortSignal): Promise<ReflectionOperationReceipt> {
  return prepareReflectionOperation(operationId, reflectionRequest(entry, action), signal);
}

export type ReflectionMutation = ReturnType<typeof reflectionRequest>;

export async function prepareReflectionOperation(operationId: string, mutation: ReflectionMutation,
  signal?: AbortSignal): Promise<ReflectionOperationReceipt> {
  if (!operationIdPattern.test(operationId)) throw new ReflectionActionError("操作编号无效", false, "invalid_operation");
  const { response, body } = await operationRequest("PUT", { operationId, mutation }, signal);
  if (!response.ok || body?.ok !== true) {
    const code = body?.code;
    throw new ReflectionActionError(reflectionReason(code), false, typeof code === "string" ? code : undefined);
  }
  try {
    if (body.externalSend !== false) throw new Error("invalid");
    return parseOperation(body.operation, operationId);
  } catch {
    throw new ReflectionActionError("操作准备回执无效，请重试", false, "invalid_response");
  }
}

function operationOutcome(response: Response, body: Record<string, unknown> | null,
  expected: ReflectionOperationReceipt): ReflectionRecovery {
  const result = record(body?.result);
  const reason = body?.code ?? result?.reason_code;
  const code = typeof reason === "string" ? reason : null;
  let operation: ReflectionOperationReceipt;
  try { operation = parseOperation(body?.operation, expected.id, expected.fingerprint); }
  catch {
    throw new ReflectionActionError(reflectionReason(code), true, code ?? "invalid_response", expected);
  }
  if (body?.externalSend !== false) throw new ReflectionActionError("操作回执无效，请核对记录", true, code ?? "invalid_response", operation);
  if (operation.status !== "committed") {
    if (body.ok !== false || body.readbackConfirmed !== false) {
      throw new ReflectionActionError("操作回执无效，请核对记录", true, "invalid_response", operation);
    }
    return { operation, entry: null, code };
  }
  try {
    if (!response.ok || body.ok !== true || body.readbackConfirmed !== true
      || result?.status === "commit_unknown" || result?.status === "committed_unverified") throw new Error("invalid");
    const saved = parseEntry(body.entry);
    if (saved.status !== "ready" || saved.registrationStatus !== "registered") throw new Error("invalid");
    return { operation, entry: saved, code };
  } catch {
    throw new ReflectionActionError("操作已提交，但回读未确认，请核对记录", true, code ?? "invalid_response", operation);
  }
}

export async function commitReflection(entry: ReflectionEntry, action: ReflectionAction, operation: ReflectionOperationReceipt,
  signal?: AbortSignal): Promise<ReflectionEntry> {
  const input = reflectionRequest(entry, action);
  try {
    parseOperation(operation, operation.id, operation.fingerprint);
    if (operation.status !== "prepared") throw new Error("invalid");
  } catch {
    throw new ReflectionActionError("请先核对操作回执", true, "operation_not_prepared", operation);
  }
  const outcome = await commitReflectionOperation(operation.id, operation.fingerprint, input, signal);
  if (!outcome.entry) throw new ReflectionActionError(reflectionReason(outcome.code),
    outcome.operation.status !== "not_committed", outcome.code ?? undefined, outcome.operation);
  if (!reflectionReadbackMatches(entry, action, [outcome.entry])) {
    throw new ReflectionActionError("操作回读尚未确认，请核对记录", true, "invalid_response", outcome.operation);
  }
  return outcome.entry;
}

export async function recoverReflection(operation: ReflectionOperationReceipt, signal?: AbortSignal): Promise<ReflectionRecovery> {
  try { parseOperation(operation, operation.id, operation.fingerprint); }
  catch { throw new ReflectionActionError("操作凭据无效，请核对记录", true, "invalid_operation"); }
  return recoverReflectionOperation(operation.id, operation.fingerprint, signal);
}

function operationIdentity(id: string, fingerprint: string): ReflectionOperationReceipt {
  if (!operationIdPattern.test(id) || !hash(fingerprint)) {
    throw new ReflectionActionError("操作凭据无效，请核对记录", true, "invalid_operation");
  }
  return { id, fingerprint, status: "prepared", terminal: false };
}

export async function commitReflectionOperation(operationId: string, fingerprint: string, mutation: ReflectionMutation,
  signal?: AbortSignal): Promise<ReflectionRecovery> {
  const operation = operationIdentity(operationId, fingerprint);
  const { response, body } = await operationRequest("POST",
    { ...mutation, operationId, operationFingerprint: fingerprint }, signal);
  return operationOutcome(response, body, operation);
}

export async function recoverReflectionOperation(operationId: string, fingerprint: string,
  signal?: AbortSignal, scope?: ReflectionRecoveryScope): Promise<ReflectionRecovery> {
  const operation = operationIdentity(operationId, fingerprint);
  if (scope && (!sourceText(scope.classId) || !/^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/u.test(scope.classId)
    || !sourceText(scope.subject) || Object.keys(scope).length !== 2)) {
    throw new ReflectionActionError(reflectionReason("scope_mismatch"), true, "scope_mismatch");
  }
  const { response, body } = await operationRequest("PATCH", { operationId, operationFingerprint: fingerprint,
    ...(scope ? { classId: scope.classId, subject: scope.subject } : {}) }, signal);
  return operationOutcome(response, body, operation);
}

export async function updateReflection(entry: ReflectionEntry, action: ReflectionAction, operation?: ReflectionOperationReceipt,
  signal?: AbortSignal): Promise<ReflectionEntry> {
  if (!operation) throw new ReflectionActionError("操作尚未准备，请刷新", false, "operation_not_prepared");
  return commitReflection(entry, action, operation, signal);
}
