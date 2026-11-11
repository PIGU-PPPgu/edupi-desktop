"use client";

import { useEffect, useRef, useState } from "react";
import { APP_PREF_KEYS } from "@/lib/app-prefs";
import { readReflection, reflectionReadbackMatches, reflectionReason, reflectionRequest, refreshReflectionSources,
  prepareReflectionOperation, commitReflectionOperation, recoverReflectionOperation, registerReflectionContentSource, verifyReflectionContentSource, ReflectionActionError,
  type ReflectionAction, type ReflectionEntry } from "@/lib/edupi-reflection-client";
import { EduPiReflectionHistory } from "./EduPiReflectionHistory";

const api = { read: readReflection, prepare: prepareReflectionOperation, commit: commitReflectionOperation,
  recover: recoverReflectionOperation, refreshSources: refreshReflectionSources, registerContentSource: registerReflectionContentSource };
type ReflectionApi = Omit<typeof api, "registerContentSource"> & Partial<Pick<typeof api, "registerContentSource">>;
type ReflectionInput = Exclude<ReflectionAction, { action: "contentCapture" }>
  | { action: "contentCapture"; predicate: ContentPredicate; rawText: string };

type OperationIdentity = {
  classId: string;
  subject: string;
  date: string;
  slotId: string;
  lessonId: string;
} & (
  | { action: "register" }
  | { action: "capture"; sourceId: string; sourceRevision: string; completedAt: string; contentHash: string }
  | { action: "review"; factId: string; revision: number; decision: "accept" | "reject" | "withdraw" }
  | { action: "contentCapture"; sourceId: string; sourceRevision: string; predicate: string; contentHash: string }
  | { action: "contentReview"; factId: string; revision: number; expectedContentBasisHash: string; decision: "accept" | "reject" }
);
type PendingOperation = OperationIdentity & ({ version: 1 } | { version: 2; operationId: string; fingerprint: string });

const pendingKey = APP_PREF_KEYS.edupiReflectionPendingOperation;
const storageMessage = "操作结果尚未确认，请核对记录后再处理";

function readPendingOperation(): PendingOperation | null {
  const raw = window.localStorage.getItem(pendingKey);
  if (raw === null) return null;
  if (raw.length > 4096) throw new Error(storageMessage);
  const value = JSON.parse(raw);
  const identifier = (item: unknown) => typeof item === "string" && item.length > 0 && item.length <= 160
    && !/[\u0000-\u001f\u007f]/u.test(item);
  if (!value || ![1, 2].includes(value.version) || !["classId", "subject", "slotId", "lessonId"].every(key => identifier(value[key]))
    || typeof value.date !== "string" || !/^\d{4}-\d\d-\d\d$/u.test(value.date)
    || value.version === 2 && (typeof value.operationId !== "string"
      || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(value.operationId)
      || typeof value.fingerprint !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value.fingerprint))
    || !["register", "capture", "review", "contentCapture", "contentReview"].includes(value.action)
    || value.action === "capture" && (!identifier(value.sourceId) || !identifier(value.sourceRevision)
      || typeof value.contentHash !== "string" || !/^[a-f0-9]{64}$/u.test(value.contentHash)
      || typeof value.completedAt !== "string" || !Number.isFinite(Date.parse(value.completedAt))
      || new Date(value.completedAt).toISOString() !== value.completedAt)
    || value.action === "review" && (!identifier(value.factId) || !Number.isSafeInteger(value.revision)
      || value.revision < 0 || !["accept", "reject", "withdraw"].includes(value.decision))
    || value.action === "contentCapture" && (value.version !== 2 || !identifier(value.sourceId) || !identifier(value.sourceRevision)
      || !Object.hasOwn(contentPredicates, value.predicate) || typeof value.contentHash !== "string" || !/^[a-f0-9]{64}$/u.test(value.contentHash))
    || value.action === "contentReview" && (value.version !== 2 || !identifier(value.factId) || !Number.isSafeInteger(value.revision)
      || value.revision < 0 || !["accept", "reject"].includes(value.decision)
      || typeof value.expectedContentBasisHash !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value.expectedContentBasisHash))) throw new Error(storageMessage);
  return value as PendingOperation;
}

async function contentHash(rawText: string): Promise<string> {
  const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawText));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function operationIdentity(entry: ReflectionEntry, action: ReflectionAction): Promise<OperationIdentity> {
  if (!entry.slotId || !entry.lessonId) throw new Error(storageMessage);
  const base = { classId: entry.classId, subject: entry.subject, date: entry.date,
    slotId: entry.slotId, lessonId: entry.lessonId };
  if (action.action === "capture") return { ...base, action: action.action, sourceId: action.sourceId,
    sourceRevision: action.sourceRevision, completedAt: action.completedAt, contentHash: await contentHash(action.rawText) };
  if (action.action === "review") {
    if (!entry.completion) throw new Error(storageMessage);
    return { ...base, action: action.action, factId: entry.completion.factId, revision: entry.completion.revision, decision: action.decision };
  }
  if (action.action === "contentCapture") return { ...base, action: action.action, sourceId: action.sourceId,
    sourceRevision: action.sourceRevision, predicate: action.predicate, contentHash: await contentHash(action.rawText) };
  if (action.action === "contentReview") return { ...base, action: action.action, factId: action.factId,
    revision: action.expectedFactRevision, expectedContentBasisHash: action.expectedContentBasisHash, decision: action.decision };
  return { ...base, action: action.action };
}

function persistPendingOperation(pending: PendingOperation): void {
  if (readPendingOperation()) throw new Error("操作结果尚未确认，请核对记录后再处理");
  const raw = JSON.stringify(pending);
  window.localStorage.setItem(pendingKey, raw);
  if (window.localStorage.getItem(pendingKey) !== raw) throw new Error(storageMessage);
}

function clearPendingOperation(pending: PendingOperation): void {
  if (JSON.stringify(readPendingOperation()) !== JSON.stringify(pending)) throw new Error(storageMessage);
  window.localStorage.removeItem(pendingKey);
  if (window.localStorage.getItem(pendingKey) !== null) throw new Error(storageMessage);
}

async function operationMatches(pending: OperationIdentity, entries: ReflectionEntry[]): Promise<boolean> {
  for (const saved of entries) {
    if (saved.classId !== pending.classId || saved.subject !== pending.subject
      || saved.date !== pending.date || saved.slotId !== pending.slotId || saved.lessonId !== pending.lessonId
      || saved.status !== "ready" || saved.registrationStatus !== "registered") continue;
    if (pending.action === "register") return true;
    if (pending.action === "contentCapture" || pending.action === "contentReview") {
      const content = saved.content;
      if (!content) continue;
      if (pending.action === "contentCapture") {
        if (content.sourceId === pending.sourceId && content.sourceRevision === pending.sourceRevision
          && content.predicate === pending.predicate && await contentHash(content.rawText) === pending.contentHash) return true;
      } else if (content.factId === pending.factId && content.revision === pending.revision + 1
        && content.sourceBasisHash !== pending.expectedContentBasisHash
        && content.status === (pending.decision === "accept" ? "accepted" : "rejected")) return true;
      continue;
    }
    const completion = saved.completion;
    if (!completion) continue;
    if (pending.action === "capture") {
      if (completion.sourceId === pending.sourceId && completion.sourceRevision === pending.sourceRevision
        && completion.completedAt === pending.completedAt && await contentHash(completion.rawText) === pending.contentHash) return true;
    } else if (completion.factId === pending.factId && completion.revision === pending.revision + 1
      && completion.status === (pending.decision === "accept" ? "accepted" : "rejected")) return true;
  }
  return false;
}

const completionLabels: Record<string, string> = {
  candidate: "待审核", pending_review: "待审核", held: "待处理", accepted: "已确认", rejected: "已撤回或驳回",
};
const contentPredicates = {
  "lesson.observation": "课堂观察",
  "lesson.feedback": "课堂反馈",
  "lesson.statistic": "课堂统计",
  "lesson.outcome": "学习成果",
  "lesson.review": "教学反思",
};
type ContentPredicate = keyof typeof contentPredicates;
const contentLabels: Record<string, string> = {
  candidate: "待审核", pending_review: "待审核", held: "待处理", accepted: "内容已接受", rejected: "内容已驳回",
};

function ReflectionContent({ entry, disabled, run }: {
  entry: ReflectionEntry;
  disabled: boolean;
  run: (entry: ReflectionEntry, action: ReflectionInput) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [rawText, setRawText] = useState("");
  const [predicate, setPredicate] = useState<ContentPredicate>("lesson.observation");
  const [error, setError] = useState<string | null>(null);
  const content = entry.content;
  const capture = async () => {
    if (!rawText.trim() || rawText.length > 4000) {
      setError("请填写课堂内容"); return;
    }
    setError(null);
    if (await run(entry, { action: "contentCapture", predicate, rawText })) {
      setRawText(""); setEditing(false);
    }
  };
  if (content) return <div className="edupi-reflection-completion" aria-label="课堂内容">
    <strong>{contentPredicates[content.predicate]}</strong>
    <p>{content.rawText}</p><span>{contentLabels[content.status]}</span>
    {["candidate", "pending_review", "held"].includes(content.status) ? <div className="edupi-reflection-actions">
      <button type="button" disabled={disabled} onClick={() => run(entry, { action: "contentReview",
        factId: content.factId, expectedFactRevision: content.revision,
        expectedContentBasisHash: content.sourceBasisHash, decision: "accept" })}>接受内容</button>
      <button type="button" disabled={disabled} onClick={() => run(entry, { action: "contentReview",
        factId: content.factId, expectedFactRevision: content.revision,
        expectedContentBasisHash: content.sourceBasisHash, decision: "reject" })}>驳回内容</button>
    </div> : null}
  </div>;
  if (!editing) return <div className="edupi-reflection-actions">
    <button type="button" disabled={disabled} onClick={() => setEditing(true)}>添加课堂内容</button>
  </div>;
  return <div className="edupi-reflection-form" aria-label="课堂内容记录">
    <label>内容类型<select value={predicate} disabled={disabled} onChange={event => setPredicate(event.target.value as ContentPredicate)}>
      {Object.entries(contentPredicates).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select></label>
    <label>课堂内容<textarea rows={3} maxLength={4000} value={rawText} disabled={disabled} onChange={event => setRawText(event.target.value)} /></label>
    {error ? <p role="alert">{error}</p> : null}
    <div className="edupi-reflection-actions">
      <button type="button" disabled={disabled} onClick={capture}>提交课堂内容</button>
      <button type="button" disabled={disabled} onClick={() => { setEditing(false); setError(null); }}>收起</button>
    </div>
  </div>;
}

function displayTime(value: string | null) {
  if (!value) return "课次时间不可用";
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function ReflectionRow({ entry, busy, locked, run, refreshSources }: {
  entry: ReflectionEntry;
  busy: boolean;
  locked: boolean;
  run: (entry: ReflectionEntry, action: ReflectionInput) => Promise<boolean>;
  refreshSources: (entry: ReflectionEntry) => Promise<void>;
}) {
  const [sourceId, setSourceId] = useState("");
  const [sourceRevision, setSourceRevision] = useState("1");
  const [completedAt, setCompletedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const completedAtInput = useRef<HTMLInputElement>(null);
  const completion = entry.completion;
  const disabled = busy || locked;
  const capture = async () => {
    let isoTime: string;
    try { isoTime = new Date(completedAtInput.current?.value || completedAt).toISOString(); }
    catch { setFormError("请选择完课时间"); return; }
    const rawText = `${notes.trim()}\n${isoTime}`;
    if (!notes.trim() || rawText.length > 4000 || !sourceId || !sourceRevision.trim()) {
      setFormError("请填写完课内容并选择来源"); return;
    }
    setFormError(null);
    const saved = await run(entry, { action: "capture", sourceId, sourceRevision: sourceRevision.trim(), rawText, completedAt: isoTime });
    if (saved) { setNotes(""); setCompletedAt(""); setSourceId(""); if (completedAtInput.current) completedAtInput.current.value = ""; }
  };
  return <li className="edupi-reflection-row">
    <div className="edupi-reflection-row-heading">
      <strong>{entry.subject} · {displayTime(entry.lessonAt)}</strong>
      <span>{entry.slotId ? `课次 ${entry.slotId}` : "课次不可用"}</span>
      <span>{entry.status === "held" ? reflectionReason(entry.reasonCode) : entry.registrationStatus === "registered" ? "已登记" : "待登记"}</span>
    </div>
    {entry.status === "ready" && entry.registrationStatus === "unregistered" ? <div className="edupi-reflection-actions">
      <button type="button" disabled={disabled} onClick={() => run(entry, { action: "register" })}>登记课次</button>
    </div> : null}
    {entry.status === "ready" && entry.registrationStatus === "registered" && !completion ? <div className="edupi-reflection-form">
      <label>完课时间<input type="datetime-local" ref={completedAtInput} defaultValue="" disabled={disabled} onChange={event => setCompletedAt(event.target.value)} /></label>
      <label>完课内容<textarea rows={2} maxLength={3974} value={notes} disabled={disabled} onChange={event => setNotes(event.target.value)} /></label>
      <label>证据来源<select value={sourceId} disabled={disabled} onChange={event => setSourceId(event.target.value)}>
        <option value="">选择来源</option>{entry.completionSourceIds.map(id => <option value={id} key={id}>{id}</option>)}
      </select></label>
      <label>来源版本<input value={sourceRevision} maxLength={160} disabled={disabled} onChange={event => setSourceRevision(event.target.value)} /></label>
      {entry.completionSourceIds.length === 0 ? <div>
        <p role="status">当前授权没有可用的完课来源</p>
        <button type="button" disabled={disabled} onClick={() => void refreshSources(entry)}>刷新来源</button>
      </div> : null}
      {formError ? <p role="alert">{formError}</p> : null}
      <div className="edupi-reflection-actions"><button type="button" disabled={disabled || entry.completionSourceIds.length === 0} onClick={() => capture()}>记录完课</button></div>
    </div> : null}
    {completion ? <div className="edupi-reflection-completion">
      <p>{completion.rawText}</p><span>{completionLabels[completion.status]}</span>
      <div className="edupi-reflection-actions">
        {["candidate", "pending_review", "held"].includes(completion.status) ? <>
          <button type="button" disabled={disabled} onClick={() => run(entry, { action: "review", decision: "accept" })}>确认完课</button>
          <button type="button" disabled={disabled} onClick={() => run(entry, { action: "review", decision: "reject" })}>驳回</button>
        </> : null}
        {completion.status === "accepted" ? <button type="button" disabled={disabled}
          onClick={() => run(entry, { action: "review", decision: "withdraw" })}>撤回确认</button> : null}
      </div>
    </div> : null}
    {entry.status === "ready" && entry.registrationStatus === "registered"
      ? <ReflectionContent entry={entry} disabled={disabled} run={run} /> : null}
  </li>;
}

export function EduPiLessonReflection({ today, query, service = api }: { today: string; query: string; service?: ReflectionApi }) {
  const [date, setDate] = useState(today);
  const [entries, setEntries] = useState<ReflectionEntry[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const scopeRef = useRef(0);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; scopeRef.current += 1; }; }, []);

  useEffect(() => {
    const controller = new AbortController();
    let readCompleted = false;
    setLoading(true);
    setMessage(null);
    void (async () => {
      const pending = readPendingOperation();
      setUncertain(Boolean(pending));
      const result = await service.read(date, controller.signal);
      if (controller.signal.aborted) return;
      readCompleted = true;
      setEnabled(result.enabled); setEntries(result.entries); setTruncated(result.truncated); setNeedsRefresh(false);
      if (pending?.version === 2) {
        const outcome = await service.recover(pending.operationId, pending.fingerprint, controller.signal);
        if (controller.signal.aborted) return;
        if (outcome.operation.id !== pending.operationId || outcome.operation.fingerprint !== pending.fingerprint) {
          throw new Error("操作回执不匹配，请核对记录");
        }
        if (outcome.operation.status === "committed" && outcome.operation.terminal && outcome.entry
          && await operationMatches(pending, [outcome.entry])) {
          const readback = pending.date === date ? await service.read(date, controller.signal)
            : await service.read(pending.date, controller.signal);
          if (controller.signal.aborted) return;
          if (readback.enabled && await operationMatches(pending, readback.entries)) {
            clearPendingOperation(pending);
            setUncertain(false);
            setMessage("已核对操作结果");
            setHistoryRefresh(value => value + 1);
            if (pending.date === date) {
              setEnabled(readback.enabled); setEntries(readback.entries); setTruncated(readback.truncated);
            }
          }
        } else if (outcome.operation.status === "not_committed" && outcome.operation.terminal) {
          clearPendingOperation(pending);
          setUncertain(false);
          setMessage("操作未提交，请核对后重试");
        }
      }
    })().catch(error => {
      if (!controller.signal.aborted) {
        setUncertain(true);
        if (!readCompleted) { setEnabled(false); setEntries([]); setTruncated(false); }
        setMessage(error instanceof Error && error.message !== storageMessage ? error.message : storageMessage);
      }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [date, refresh, service]);

  const run = async (entry: ReflectionEntry, requestedAction: ReflectionInput) => {
    if (busyRef.current || loading || uncertain || needsRefresh) return false;
    busyRef.current = true; setBusy(true); setMessage(null);
    const scope = scopeRef.current;
    const active = () => mountedRef.current && scopeRef.current === scope;
    let pending: PendingOperation | null = null;
    try {
      try { if (readPendingOperation()) throw new Error(storageMessage); }
      catch { throw new ReflectionActionError(storageMessage, true); }
      let action: ReflectionAction;
      if (requestedAction.action === "contentCapture") {
        if (!service.registerContentSource) throw new Error("课堂内容来源登记暂不可用");
        const input = { predicate: requestedAction.predicate, rawText: requestedAction.rawText };
        const result = await service.registerContentSource(entry, input);
        if (!active()) return false;
        const registered = await verifyReflectionContentSource(entry, input, result);
        if (!active()) return false;
        entry = registered.entry;
        action = { ...requestedAction, sourceId: registered.sourceId, sourceRevision: "1" };
      } else action = requestedAction;
      const mutation = reflectionRequest(entry, action);
      const identity = await operationIdentity(entry, action);
      if (!active()) return false;
      const operationId = window.crypto.randomUUID();
      const prepared = await service.prepare(operationId, mutation);
      if (!active()) return false;
      if (prepared.id !== operationId || prepared.status !== "prepared" || prepared.terminal
        || !/^sha256:[a-f0-9]{64}$/u.test(prepared.fingerprint)) throw new Error("操作准备回执无效，请刷新核对");
      pending = { version: 2, ...identity, operationId, fingerprint: prepared.fingerprint };
      try { persistPendingOperation(pending); }
      catch { throw new ReflectionActionError(storageMessage, true); }
      const outcome = await service.commit(operationId, prepared.fingerprint, mutation);
      if (!active() || JSON.stringify(readPendingOperation()) !== JSON.stringify(pending)) return false;
      if (outcome.operation.id === operationId && outcome.operation.fingerprint === prepared.fingerprint
        && outcome.operation.status === "not_committed" && outcome.operation.terminal) {
        clearPendingOperation(pending);
        pending = null;
        setUncertain(false);
        setNeedsRefresh(true);
        setMessage(reflectionReason(outcome.code));
        return false;
      }
      if (outcome.operation.id !== operationId || outcome.operation.fingerprint !== prepared.fingerprint
        || outcome.operation.status !== "committed" || !outcome.operation.terminal || !outcome.entry
        || !reflectionReadbackMatches(entry, action, [outcome.entry]) || !await operationMatches(pending, [outcome.entry])) {
        throw new ReflectionActionError("操作回读尚未确认，请刷新核对", true);
      }
      if (!active() || JSON.stringify(readPendingOperation()) !== JSON.stringify(pending)) return false;
      const readback = await service.read(entry.date);
      if (!active() || JSON.stringify(readPendingOperation()) !== JSON.stringify(pending)) return false;
      if (!readback.enabled || !await operationMatches(pending, readback.entries)) {
        throw new ReflectionActionError("操作回读尚未确认，请刷新核对", true);
      }
      if (!active() || JSON.stringify(readPendingOperation()) !== JSON.stringify(pending)) return false;
      clearPendingOperation(pending);
      pending = null;
      const saved = outcome.entry;
      setEnabled(readback.enabled); setEntries(readback.entries); setTruncated(readback.truncated);
      setHistoryRefresh(value => value + 1);
      if (action.action === "register") {
        try {
          const result = await service.refreshSources(saved);
          if (!active()) return false;
          setEnabled(result.enabled); setEntries(result.entries); setTruncated(result.truncated);
        } catch {
          if (!active()) return false;
          setNeedsRefresh(true);
          setMessage("课次已登记，来源刷新失败，请刷新");
          window.dispatchEvent(new Event("edupi-education-refresh"));
          return true;
        }
      }
      setMessage(action.action === "register" ? "课次已登记"
        : action.action === "capture" || action.action === "contentCapture" ? "已记录，等待确认"
          : action.action === "contentReview" ? action.decision === "accept" ? "内容已接受" : "内容已驳回"
            : action.decision === "accept" ? "完课已确认" : "已更新完课记录");
      window.dispatchEvent(new Event("edupi-education-refresh"));
      return true;
    } catch (error) {
      if (!active()) return false;
      try { setUncertain(Boolean(readPendingOperation())); }
      catch { setUncertain(true); }
      if (!pending && error instanceof ReflectionActionError && !error.uncertain) setNeedsRefresh(false);
      setMessage(error instanceof ReflectionActionError && error.uncertain ? storageMessage
        : error instanceof Error ? error.message : "操作暂不可用");
      return false;
    } finally { busyRef.current = false; if (mountedRef.current) setBusy(false); }
  };
  const refreshSources = async (entry: ReflectionEntry) => {
    if (busyRef.current || loading || uncertain || needsRefresh) return;
    busyRef.current = true; setBusy(true); setMessage(null);
    try {
      if (readPendingOperation()) { setUncertain(true); throw new Error("操作结果尚未确认，请核对记录后再处理"); }
      const result = await service.refreshSources(entry);
      setEnabled(result.enabled); setEntries(result.entries); setTruncated(result.truncated);
      window.dispatchEvent(new Event("edupi-education-refresh"));
    } catch (error) {
      setNeedsRefresh(true);
      setMessage(error instanceof Error ? error.message : "来源暂不可用");
    } finally { busyRef.current = false; setBusy(false); }
  };
  const search = query.trim().toLocaleLowerCase();
  const visible = entries.filter(entry => `${entry.classId} ${entry.subject} ${entry.slotId ?? ""} ${entry.completion?.rawText ?? ""} ${entry.content?.rawText ?? ""}`.toLocaleLowerCase().includes(search));
  return <section className="edupi-lesson-reflection" aria-labelledby="edupi-reflection-title">
    <header><h2 id="edupi-reflection-title">课后反思</h2><div>
      <label>日期<input type="date" value={date} disabled={busy} onChange={event => { if (event.target.value && event.target.value !== date) { scopeRef.current += 1; setDate(event.target.value); } }} /></label>
      <button type="button" disabled={busy || loading} onClick={() => setRefresh(value => value + 1)}>刷新</button>
    </div></header>
    {loading ? <p role="status">加载课次中…</p> : message && !enabled ? null : !enabled ? <p>课后反思未启用</p>
      : visible.length === 0 ? <p>{search ? "未找到相关课次" : "当天没有可用课次"}</p>
        : <ul>{visible.map((entry, index) => <ReflectionRow key={`${entry.date}:${entry.slotId}:${entry.completion?.factId ?? "lesson"}:${index}`}
          entry={entry} busy={busy} locked={uncertain || needsRefresh} run={run} refreshSources={refreshSources} />)}</ul>}
    {truncated ? <p role="status">当天课次较多，当前仅显示前 20 个</p> : null}
    {uncertain ? <p role="alert">操作结果尚未确认，请核对记录后再处理</p> : null}
    {message ? <p role={uncertain ? "alert" : "status"}>{message}</p> : null}
    <EduPiReflectionHistory refreshKey={historyRefresh} />
  </section>;
}
