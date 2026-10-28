"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { isTauriDesktop } from "@/lib/desktop-updater";
import {
  bootstrapScheduleConflictReview,
  captureScheduleDecision,
  readScheduleConflicts,
  resolveScheduleConflict,
  ScheduleConflictError,
  scheduleResolutionMatchesTarget,
  type ScheduleConflict,
  type ScheduleConflictDecision,
  type ScheduleResolution,
  type ScheduleConflictTarget,
  type ScheduleResolutionNotice,
} from "@/lib/edupi-schedule-conflicts";
import { calendarTimeLabel } from "@/lib/edupi-calendar-form-time";

const DECISIONS: Array<{ value: ScheduleConflictDecision; label: string }> = [
  { value: "keep_existing", label: "保留原安排" },
  { value: "replace_with_candidate", label: "采用新安排" },
  { value: "keep_both_distinct", label: "两项分别保留" },
];
const CALENDAR_TYPES: Record<string, string> = { exam: "考试", activity: "活动", meeting: "会议", holiday: "假期", festival: "节日", teaching: "教学节点", custom: "日程" };
const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

function value(item: Record<string, unknown>, key: string): string {
  const raw = key.startsWith("time_interval.")
    ? (item.time_interval && typeof item.time_interval === "object" && !Array.isArray(item.time_interval)
      ? (item.time_interval as Record<string, unknown>)[key.slice("time_interval.".length)] : null)
    : item[key];
  if (key === "confidence") return ({ confirmed: "已确认", teacher_confirmed: "教师确认", inferred: "识别待确认" } as Record<string, string>)[String(raw)] || "未设置";
  if (key === "type") return CALENDAR_TYPES[String(raw)] || (typeof raw === "string" && raw.trim() ? raw : "未设置");
  if (key === "kind") return ({ class: "课程", routine: "固定事务" } as Record<string, string>)[String(raw)] || "未设置";
  if (key === "day_of_week" && typeof raw === "number") return WEEKDAYS[raw - 1] ? `周${WEEKDAYS[raw - 1]}` : "未设置";
  if (key === "time_interval.start" || key === "time_interval.end") return calendarTimeLabel(typeof raw === "string" ? raw : null, typeof item.date === "string" ? item.date : null) || "未设置";
  return typeof raw === "string" && raw.trim() ? raw : typeof raw === "number" ? String(raw) : "未设置";
}

function scheduleLabel(conflict: ScheduleConflict, item: Record<string, unknown>): string {
  if (conflict.kind === "calendar") {
    return [value(item, "date"), value(item, "name")].filter((part) => part !== "未设置").join(" · ");
  }
  return [value(item, "day_of_week"), `第${value(item, "period")}节`, value(item, "subject"), value(item, "class_name")]
    .filter((part) => part !== "未设置").join(" · ");
}

function ScheduleDetails({ conflict, item, title }: { conflict: ScheduleConflict; item: Record<string, unknown>; title: string }) {
  const fields = conflict.kind === "calendar"
    ? [["日期", "date"], ["结束日期", "end_date"], ["开始时间", "time_interval.start"], ["结束时间", "time_interval.end"], ["时区", "time_interval.time_zone"], ["地点", "location"], ["原文日期", "raw_date"], ["事项", "name"], ["类型", "type"], ["来源状态", "confidence"], ["备注", "notes"]]
    : [["星期", "day_of_week"], ["节次", "period"], ["科目", "subject"], ["班级", "class_name"], ["班级 ID", "class_id"], ["类型", "kind"], ["开始时间", "start_time"], ["时区", "time_zone"], ["备注", "notes"]];
  const sourceIds = item.source_ids as string[];
  const visibleSources = sourceIds.filter(id => id !== "desktop-calendar-manual-v1" && !/^desktop-calendar-[a-f0-9]{24}$/.test(id));
  return <div className="edupi-schedule-review__source">
    <strong title={sourceIds.length ? `来源：${sourceIds.join("、")}` : undefined}>{title}</strong>
    <dl>{fields.filter(([, key]) => value(conflict.canonical, key) !== "未设置" || value(conflict.candidate, key) !== "未设置").map(([label, key]) => <div key={key}><dt>{label}</dt><dd>{value(item, key)}</dd></div>)}</dl>
    {visibleSources.length ? <small>来源：{visibleSources.join("、")}</small> : null}
  </div>;
}

export type ScheduleConflictReviewRequest = { id: number; target: ScheduleConflictTarget; focus?: boolean };

function resolutionNotice(conflict: ScheduleConflict): ScheduleResolutionNotice {
  return { kind: conflict.kind, canonicalId: conflict.canonicalId, occurrenceRef: typeof conflict.candidate.source_occurrence_ref === "string" ? conflict.candidate.source_occurrence_ref : null, evidenceIds: conflict.candidate.evidence_ids as string[] };
}

async function readPage(signal: AbortSignal, after?: string) {
  return readScheduleConflicts((url, init) => fetch(url, { ...init, signal }), undefined, after);
}

export function EduPiScheduleConflictReview({ enabled, request, scopeKey = "" }: { enabled: boolean; request?: ScheduleConflictReviewRequest | null; scopeKey?: string }) {
  const [native, setNative] = useState(false);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ScheduleConflict[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [decision, setDecision] = useState<ScheduleConflictDecision | "">("");
  const [pending, setPending] = useState<{ capture: ScheduleResolution; conflict: ScheduleConflict } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const decisionName = useId();
  const rootRef = useRef<HTMLElement>(null);
  const mounted = useRef(true);
  const operation = useRef<{ kind: "read" | "resolve"; controller: AbortController | null; requestId?: number } | null>(null);
  const pendingRef = useRef(pending); pendingRef.current = pending;
  const handledRequest = useRef<number | null>(null);
  const interruptedRequest = useRef<number | null>(null);
  const focusRequest = useRef<{ from: Element | null; document: Document; target: "decision" | "list" | "trigger" | "refresh" | "more"; stop: () => void } | null>(null);
  const stopFocus = useCallback(() => { focusRequest.current?.stop(); focusRequest.current = null; }, []);
  const startFocus = useCallback((target: NonNullable<typeof focusRequest.current>["target"], allowOutside = false) => {
    stopFocus();
    const root = rootRef.current;
    if (!root?.isConnected) return;
    const document = root.ownerDocument, from = document.activeElement;
    if (!allowOutside && !root.contains(from) && from !== document.body && from !== document.documentElement) return;
    const preserveMovedFocus = (event: FocusEvent) => {
      if (event.target !== from && event.target !== document.body && event.target !== document.documentElement) stopFocus();
    };
    document.addEventListener("focusin", preserveMovedFocus);
    focusRequest.current = { from, document, target, stop: () => document.removeEventListener("focusin", preserveMovedFocus) };
  }, [stopFocus]);

  useEffect(() => { setNative(isTauriDesktop()); }, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; operation.current?.controller?.abort(); operation.current = null; stopFocus(); };
  }, [stopFocus]);
  useEffect(() => {
    stopFocus();
    if (operation.current?.kind === "read" || !enabled) {
      if (operation.current?.requestId !== undefined && operation.current.requestId === handledRequest.current) { interruptedRequest.current = operation.current.requestId; handledRequest.current = null; }
      operation.current?.controller?.abort(); operation.current = null;
      setBusy(false); setOpen(false);
    }
  }, [scopeKey, request?.id, enabled, stopFocus]);
  useEffect(() => {
    if (busy) return;
    const focus = focusRequest.current, root = rootRef.current;
    if (!focus || !root?.isConnected || root.ownerDocument !== focus.document) { stopFocus(); return; }
    const active = focus.document.activeElement;
    if (active !== focus.from && active !== focus.document.body && active !== focus.document.documentElement) { stopFocus(); return; }
    const selector = { decision: "[data-schedule-decision]", list: "[data-schedule-conflict]", trigger: "[data-schedule-review-trigger]", refresh: "[data-schedule-refresh]", more: "[data-schedule-more]" }[focus.target];
    const target = root.querySelector<HTMLButtonElement | HTMLInputElement>(selector) || root.querySelector<HTMLButtonElement>("[data-schedule-review-trigger]");
    stopFocus();
    if (target?.isConnected && !target.disabled && root.contains(target)) target.focus({ preventScroll: false });
  }, [busy, open, selectedId, items, error, pending, focusTick, stopFocus]);

  const openReview = useCallback(async (target?: ScheduleConflictTarget, automatic?: ScheduleConflictReviewRequest) => {
    if (!mounted.current || operation.current) return;
    setOpen(true); setMessage(null);
    if (automatic?.focus === false) stopFocus(); else startFocus("list", Boolean(automatic));
    if (pendingRef.current) { if (focusRequest.current) focusRequest.current.target = "trigger"; setFocusTick(value => value + 1); return; }
    const active = { kind: "read" as const, controller: new AbortController(), requestId: automatic?.id };
    operation.current = active;
    setBusy(true); setError(null);
    try {
      let result;
      try { result = await readPage(active.controller.signal); }
      catch (cause) {
        if (!(cause instanceof ScheduleConflictError) || cause.code !== "owner_uninitialized") throw cause;
        await bootstrapScheduleConflictReview((url, init) => fetch(url, { ...init, signal: active.controller.signal }));
        result = await readPage(active.controller.signal);
      }
      if (!mounted.current || operation.current !== active) return;
      const matches = target ? result.conflicts.filter(item => scheduleResolutionMatchesTarget(target, resolutionNotice(item))) : [];
      const selected = matches.length === 1 ? matches[0].conflictId : null;
      setItems(result.conflicts); setCursor(result.nextCursor); setSelectedId(selected); setDecision("");
      if (selected && focusRequest.current) focusRequest.current.target = "decision";
    } catch (cause) {
      if (!mounted.current || operation.current !== active || active.controller.signal.aborted) return;
      setError(cause instanceof ScheduleConflictError && cause.code === "owner_control_credential_unavailable"
        ? "授权状态需要恢复，原数据未更改。" : "待核对安排暂不可用，请重试。");
      if (focusRequest.current) focusRequest.current.target = "refresh";
    } finally {
      if (mounted.current && operation.current === active) { operation.current = null; setBusy(false); setFocusTick(value => value + 1); }
    }
  }, [startFocus, stopFocus]);
  useEffect(() => {
    if (!native || !enabled || busy || pending || !request || handledRequest.current === request.id) return;
    handledRequest.current = request.id;
    void openReview(request.target, interruptedRequest.current === request.id ? { ...request, focus: false } : request);
  }, [native, enabled, busy, pending, request, openReview]);

  const decide = async (resolution: NonNullable<typeof pending>) => {
    if (operation.current) return;
    const active = { kind: "resolve" as const, controller: null as AbortController | null };
    operation.current = active;
    startFocus("list");
    setBusy(true);
    setPending(resolution);
    setError(null); setMessage(null);
    try {
      await resolveScheduleConflict(resolution.capture);
    } catch (cause) {
      if (!mounted.current || operation.current !== active) return;
      if (cause instanceof ScheduleConflictError && ["schedule_conflict_stale", "schedule_conflict_source_deleted", "schedule_conflict_replay_mismatch"].includes(cause.code)) {
        setPending(null);
        setSelectedId(null);
        setItems([]);
        setCursor(null);
        setError("来源或决定已变化，请刷新待核对安排。");
        if (focusRequest.current) focusRequest.current.target = "refresh";
      } else { setError("处理结果尚未确认，请用原决定重试。"); if (focusRequest.current) focusRequest.current.target = "trigger"; }
      operation.current = null; setBusy(false); setFocusTick(value => value + 1);
      return;
    }
    window.dispatchEvent(new CustomEvent("edupi-education-refresh", { detail: { scheduleResolution: resolutionNotice(resolution.conflict) } }));
    if (!mounted.current || operation.current !== active) return;
    setPending(null);
    setSelectedId(null);
    setDecision("");
    setMessage("已核对");
    setItems(current => current.filter(item => item.conflictId !== resolution.capture.conflictId));
    active.controller = new AbortController();
    try {
      const result = await readPage(active.controller.signal);
      if (mounted.current && operation.current === active) { setItems(result.conflicts); setCursor(result.nextCursor); }
    } catch {
      if (mounted.current && operation.current === active) { setError("决定已记录，待核对列表更新失败，请刷新。"); if (focusRequest.current) focusRequest.current.target = "refresh"; }
    } finally {
      if (mounted.current && operation.current === active) { operation.current = null; setBusy(false); setFocusTick(value => value + 1); }
    }
  };

  const more = async () => {
    if (!cursor || operation.current || pending) return;
    const active = { kind: "read" as const, controller: new AbortController() };
    operation.current = active; startFocus("more"); setBusy(true); setError(null);
    try {
      const result = await readPage(active.controller.signal, cursor);
      if (mounted.current && operation.current === active) { setItems(current => [...current, ...result.conflicts.filter(item => !current.some(row => row.conflictId === item.conflictId))]); setCursor(result.nextCursor); }
    } catch {
      if (mounted.current && operation.current === active && !active.controller.signal.aborted) setError("更多安排暂不可用，请重试。");
    } finally {
      if (mounted.current && operation.current === active) { operation.current = null; setBusy(false); setFocusTick(value => value + 1); }
    }
  };
  if (!native || !enabled) return null;
  const selected = items.find((item) => item.conflictId === selectedId);
  const sameOccurrence = selected?.kind === "calendar" && typeof selected.canonical.source_occurrence_ref === "string"
    && selected.canonical.source_occurrence_ref === selected.candidate.source_occurrence_ref;
  return <section ref={rootRef} className="edupi-schedule-review" aria-label="待核对安排" aria-busy={busy}>
    <header>
      <strong>待核对安排{open && !error && !busy ? ` · ${items.length}` : ""}</strong>
      <button type="button" data-schedule-review-trigger disabled={busy} onClick={() => { if (open) { stopFocus(); setOpen(false); } else void openReview(); }}>{open ? "收起" : "核对安排"}</button>
    </header>
    {message ? <p role="status">{message}</p> : null}
    {error ? <p role="alert">{error}{!pending ? <button type="button" data-schedule-refresh disabled={busy} onClick={() => void openReview(request?.target)}>刷新</button> : null}</p> : null}
    {open ? <>
      {items.length === 0 ? error || busy ? null : <p>没有待核对安排</p> : <div className="edupi-schedule-review__list">{items.map((item) => <button type="button" data-schedule-conflict={item.conflictId} key={item.conflictId} className={selectedId === item.conflictId ? "is-selected" : ""} disabled={busy || Boolean(pending)} onClick={() => { startFocus("decision"); setSelectedId(item.conflictId); setDecision(""); setError(null); }} aria-expanded={selectedId === item.conflictId}>
        <span>{item.kind === "calendar" ? "校历" : "课表"}</span><strong>{scheduleLabel(item, item.canonical)}</strong>
      </button>)}</div>}
      {selected && !pending ? <div className="edupi-schedule-review__detail">
        <ScheduleDetails conflict={selected} item={selected.canonical} title="原安排" />
        <ScheduleDetails conflict={selected} item={selected.candidate} title="新安排" />
        <div className="edupi-schedule-review__actions"><fieldset className="edupi-schedule-review__choices" disabled={busy}><legend>处理方式</legend>{DECISIONS.filter((option) => option.value !== "keep_both_distinct" || !sameOccurrence && selected.canonicalId !== selected.candidate.source_item_id).map((option) => <label key={option.value}><input type="radio" data-schedule-decision name={decisionName} value={option.value} checked={decision === option.value} disabled={busy} onChange={(event) => { if (event.target.checked) setDecision(option.value); }} /><span>{option.label}</span></label>)}</fieldset><button type="button" className="is-primary" disabled={!decision || busy} onClick={() => { if (decision) void decide({ capture: captureScheduleDecision(selected, decision), conflict: selected }); }}>确认处理</button></div>
      </div> : null}
      {pending ? <div className="edupi-schedule-review__actions"><span>处理结果待核对</span><button type="button" disabled={busy} onClick={() => void decide(pending)}>重试原决定</button></div> : null}
      {cursor ? <button type="button" data-schedule-more disabled={busy || Boolean(pending)} onClick={() => void more()}>更多</button> : null}
    </> : null}
  </section>;
}
