"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EducationEntityDeleteKind } from "@/lib/edupi-education-contract";
import type { EntityDeletionHistory, EntityDeletionRestoreRecord } from "@/lib/edupi-entity-delete";

const PAGE_SIZE = 8;
type RecycleLedger = { deletions: EntityDeletionRestoreRecord[]; history: EntityDeletionHistory[] };
type RecycleProps = {
  activeCount: number;
  historyCount: number;
  countUnavailable?: boolean;
  onLoad: () => Promise<RecycleLedger>;
  onRestore: (kind: EducationEntityDeleteKind, id: string, restoreRequestId: string, label: string) => Promise<void>;
};
type RecycleScope = Pick<RecycleProps, "onLoad" | "onRestore"> & { alive: boolean; read: number; settled: number; mutation: number; restoring: boolean };
type FocusReturn = { scope: RecycleScope; document: Document; from: Element | null; key: string | null; phase: "refresh" | "restoring" | "restored" | "failed"; stop: () => void };
const kindLabels: Record<EducationEntityDeleteKind, string> = {
  calendar: "日程",
  timetable: "课程",
  memory: "记忆",
  student: "学生档案",
  task: "任务",
  material: "材料",
  teaching_priority: "教学重点",
};

function time(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString("zh-CN");
}

function historyLabel(item: EntityDeletionHistory): string {
  return item.targetLabel || item.targetId;
}

function RefreshIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M6.1 8.5A7 7 0 0 1 18.8 7L20 12M4 12l1.2 5A7 7 0 0 0 17.9 15.5" /></svg>;
}

export function deletedHistoryBadgeCount(summaryCount: number, loadedCount: number): number {
  return Math.max(summaryCount, loadedCount);
}

export function EduPiDeletedEntities({
  activeCount,
  historyCount,
  countUnavailable = false,
  onLoad,
  onRestore,
}: RecycleProps) {
  const scopeRef = useRef<RecycleScope>({ onLoad, onRestore, alive: true, read: 0, settled: 0, mutation: 0, restoring: false });
  if (scopeRef.current.onLoad !== onLoad || scopeRef.current.onRestore !== onRestore) {
    scopeRef.current.alive = false;
    scopeRef.current = { onLoad, onRestore, alive: true, read: 0, settled: 0, mutation: 0, restoring: false };
  }
  const scope = scopeRef.current;
  const [snapshot, setSnapshot] = useState<{ scope: RecycleScope; ledger: RecycleLedger } | null>(null);
  const ledger = snapshot?.scope === scope ? snapshot.ledger : null;
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focusGeneration, setFocusGeneration] = useState(0);
  const rootRef = useRef<HTMLElement>(null);
  const refreshRef = useRef<HTMLButtonElement>(null);
  const focusReturnRef = useRef<FocusReturn | null>(null);
  const ordered = useMemo(() => (ledger?.deletions ?? []).slice().sort((left, right) => right.deletedAt.localeCompare(left.deletedAt)), [ledger]);
  const pages = Math.max(1, Math.ceil(ordered.length / PAGE_SIZE));
  const visible = ordered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const recentHistory = useMemo(() => (ledger?.history ?? []).slice().sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)).slice(0, 50), [ledger]);
  const visibleHistoryCount = deletedHistoryBadgeCount(historyCount, ledger?.history.length ?? 0);
  const visibleActiveCount = Math.max(activeCount, ledger?.deletions.length ?? 0);
  useEffect(() => setPage((current) => Math.min(current, pages - 1)), [pages]);

  const clearFocusReturn = useCallback((request = focusReturnRef.current) => {
    request?.stop();
    if (focusReturnRef.current === request) focusReturnRef.current = null;
  }, []);
  const load = useCallback(async () => {
    if (!scope.alive || scopeRef.current !== scope) return;
    const generation = ++scope.read;
    const current = () => scope.alive && scopeRef.current === scope && scope.read === generation;
    setLoading(true);
    setError(null);
    try { const next = await scope.onLoad(); if (current()) setSnapshot({ scope, ledger: next }); }
    catch (cause) { if (current()) { setSnapshot(null); setError(cause instanceof Error ? cause.message : "删除记录读取失败"); } }
    finally { if (current()) { scope.settled = generation; setLoading(false); setFocusGeneration(value => value + 1); } }
  }, [scope]);

  useEffect(() => {
    scope.alive = true;
    setBusy(null);
    void load();
    return () => { scope.alive = false; if (focusReturnRef.current?.scope === scope) clearFocusReturn(); };
  }, [scope, load, clearFocusReturn]);
  useEffect(() => {
    const request = focusReturnRef.current;
    if (!request) return;
    const root = rootRef.current;
    if (request.scope !== scope || !scope.alive || !root?.isConnected || root.ownerDocument !== request.document) { clearFocusReturn(request); return; }
    if (busy || loading || request.phase === "restoring" || scope.read !== scope.settled) return;
    clearFocusReturn(request);
    const active = request.document.activeElement;
    if (active !== request.from && active !== request.document.body && active !== request.document.documentElement) return;
    const retry = request.phase === "failed" ? [...root.querySelectorAll<HTMLButtonElement>("[data-recycle-restore]")]
      .find(button => button.dataset.recycleRestore === request.key && !button.disabled) : null;
    const target = retry || refreshRef.current;
    if (target?.isConnected && !target.disabled && root.contains(target)) target.focus({ preventScroll: false });
  }, [busy, loading, snapshot, scope, focusGeneration, clearFocusReturn]);
  const rememberFocus = (trigger: HTMLButtonElement, key: string | null): FocusReturn => {
    clearFocusReturn();
    const document = trigger.ownerDocument;
    const request: FocusReturn = { scope, document, from: document.activeElement, key, phase: key ? "restoring" : "refresh", stop: () => {} };
    const moved = (event: FocusEvent) => {
      if (event.target !== request.from && event.target !== document.body && event.target !== document.documentElement) clearFocusReturn(request);
    };
    request.stop = () => document.removeEventListener("focusin", moved);
    focusReturnRef.current = request;
    document.addEventListener("focusin", moved);
    return request;
  };
  const refresh = (trigger: HTMLButtonElement) => {
    if (!scope.alive || scopeRef.current !== scope || loading || busy || scope.restoring || scope.read !== scope.settled) return;
    rememberFocus(trigger, null);
    void load();
  };

  const restore = async (item: EntityDeletionRestoreRecord, trigger: HTMLButtonElement) => {
    const key = `${item.kind}:${item.id}`;
    if (!scope.alive || scopeRef.current !== scope || busy || loading || scope.restoring) return;
    scope.restoring = true;
    const mutation = ++scope.mutation;
    const current = () => scope.alive && scopeRef.current === scope && scope.mutation === mutation;
    const request = rememberFocus(trigger, key);
    let restored = false;
    setBusy(key);
    setError(null);
    try {
      await scope.onRestore(item.kind, item.id, item.restoreRequestId, item.label || kindLabels[item.kind]);
      if (current()) { restored = true; await load(); }
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : "恢复失败");
    } finally {
      if (current()) { scope.restoring = false; request.phase = restored ? "restored" : "failed"; setBusy(null); setFocusGeneration(value => value + 1); }
    }
  };

  return <section ref={rootRef} className="edupi-admin-recycle" aria-label="回收站">
    <div className="edupi-admin-recycle__toolbar">
      <span>{countUnavailable && !ledger ? "数量暂不可用" : `${visibleActiveCount} 项可恢复`}</span>
      <button ref={refreshRef} type="button" disabled={loading || Boolean(busy)} onClick={event => refresh(event.currentTarget)} aria-label="刷新回收站" title="刷新回收站"><RefreshIcon /></button>
    </div>
    {error ? <p className="edupi-admin-recycle__message" role="alert">{error}</p> : null}
    {loading ? <div className="edupi-admin-recycle__empty" role="status">正在读取…</div> : visible.length > 0 ? <ol className="edupi-admin-recycle__list">{visible.map((item) => {
      const key = `${item.kind}:${item.id}`;
      return <li key={key}><div><strong>{item.label || kindLabels[item.kind]}</strong><span>{kindLabels[item.kind]} · {time(item.deletedAt)}</span>{item.note ? <p>{item.note}</p> : null}<details><summary>技术详情</summary><code>{item.id}</code></details></div><button type="button" data-recycle-restore={key} disabled={Boolean(busy)} onClick={event => void restore(item, event.currentTarget)}>{busy === key ? "恢复中…" : "恢复"}</button></li>;
    })}</ol> : !error ? <div className="edupi-admin-recycle__empty">当前没有可恢复项目</div> : null}
    {pages > 1 ? <nav className="edupi-admin-recycle__pagination" aria-label="回收站分页"><button type="button" aria-label="上一页" disabled={page === 0 || Boolean(busy)} onClick={() => { clearFocusReturn(); setPage((value) => value - 1); }}>‹</button><span>{page + 1} / {pages}</span><button type="button" aria-label="下一页" disabled={page >= pages - 1 || Boolean(busy)} onClick={() => { clearFocusReturn(); setPage((value) => value + 1); }}>›</button></nav> : null}
    {recentHistory.length > 0 ? <details className="edupi-admin-recycle__history"><summary>操作记录 <span>{visibleHistoryCount}</span></summary><ol>{recentHistory.map((item) => <li key={item.historyId}><div><strong>{item.action === "delete" ? "删除" : "恢复"} · {historyLabel(item)}</strong><span>{kindLabels[item.kind]} · 记录版本 {item.tombstoneRevision}</span></div><time>{time(item.occurredAt)}</time>{item.note ? <p>{item.note}</p> : null}</li>)}</ol></details> : null}
  </section>;
}
