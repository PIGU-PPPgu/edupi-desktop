"use client";

import { useCallback, useEffect, useId, useRef, useState, type ComponentType } from "react";
import {
  readReflectionHistory, readReflectionContentHistory,
  type ReflectionHistoryEntry, type ReflectionContentHistoryEntry,
} from "@/lib/edupi-reflection-client";

const api = { read: readReflectionHistory };
const contentApi = { read: readReflectionContentHistory };
type HistoryEntry = ReflectionHistoryEntry | ReflectionContentHistoryEntry;
type HistoryApi<Entry extends HistoryEntry> = {
  read: (cursor?: string, signal?: AbortSignal) => Promise<{
    entries: Entry[]; nextCursor: string | null; snapshotHash: string;
  }>;
};

const statusLabels: Record<string, string> = {
  candidate: "待审核", pending_review: "待审核", held: "待处理", accepted: "已确认",
  rejected: "已撤回或驳回", stale: "已失效", superseded: "已替代",
};
const reviewLabels: Record<string, string> = {
  accept: "确认", reject: "撤回或驳回", hold: "暂缓", modify: "修改", delete: "删除", restore: "恢复",
};
const contentPredicates: Record<ReflectionContentHistoryEntry["predicate"], string> = {
  "lesson.observation": "课堂观察", "lesson.feedback": "课堂反馈", "lesson.statistic": "课堂统计",
  "lesson.outcome": "学习成果", "lesson.review": "教学反思",
};

function displayTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value));
}

function HistoryRow({ entry }: { entry: ReflectionHistoryEntry }) {
  return <li className="edupi-reflection-history__entry">
    <header>
      <strong>{entry.date} · {entry.slot_id ? `课次 ${entry.slot_id}` : "课次未标注"}</strong>
      <span>{statusLabels[entry.status] ?? entry.status}</span>
    </header>
    <p>{entry.raw_text}</p>
    <details>
      <summary>记录详情</summary>
      <dl>
        <div><dt>完课时间</dt><dd><time dateTime={entry.completed_at}>{displayTime(entry.completed_at)}</time></dd></div>
        <div><dt>学期</dt><dd>{entry.term_id}</dd></div>
        <div><dt>课次</dt><dd>{entry.lesson_id}</dd></div>
        <div><dt>证据来源</dt><dd>{entry.source_id}</dd></div>
        <div><dt>来源版本</dt><dd>{entry.source_revision}</dd></div>
        <div><dt>记录版本</dt><dd>{entry.revision}</dd></div>
        <div><dt>更新时间</dt><dd><time dateTime={entry.updated_at}>{displayTime(entry.updated_at)}</time></dd></div>
        {entry.last_review ? <div><dt>最近审核</dt><dd>
          {reviewLabels[entry.last_review.action] ?? entry.last_review.action} ·{" "}
          <time dateTime={entry.last_review.reviewed_at}>{displayTime(entry.last_review.reviewed_at)}</time>
        </dd></div> : null}
      </dl>
    </details>
  </li>;
}

function ContentHistoryRow({ entry }: { entry: ReflectionContentHistoryEntry }) {
  return <li className="edupi-reflection-history__entry">
    <header>
      <strong>{entry.date} · {entry.slot_id ? `课次 ${entry.slot_id}` : "课次未标注"}</strong>
      <span>{statusLabels[entry.status] ?? entry.status}</span>
    </header>
    <strong>{contentPredicates[entry.predicate]}</strong>
    <p>{entry.raw_text}</p>
    <details>
      <summary>记录详情</summary>
      <dl>
        <div><dt>学期</dt><dd>{entry.term_id}</dd></div>
        <div><dt>课次</dt><dd>{entry.lesson_id}</dd></div>
        <div><dt>证据来源</dt><dd>{entry.source_id}</dd></div>
        <div><dt>来源版本</dt><dd>{entry.source_revision}</dd></div>
        <div><dt>记录版本</dt><dd>{entry.revision}</dd></div>
        <div><dt>记录时间</dt><dd><time dateTime={entry.created_at}>{displayTime(entry.created_at)}</time></dd></div>
        <div><dt>更新时间</dt><dd><time dateTime={entry.updated_at}>{displayTime(entry.updated_at)}</time></dd></div>
        {entry.last_review ? <div><dt>最近审核</dt><dd>
          {reviewLabels[entry.last_review.action] ?? entry.last_review.action} ·{" "}
          <time dateTime={entry.last_review.reviewed_at}>{displayTime(entry.last_review.reviewed_at)}</time>
        </dd></div> : null}
      </dl>
    </details>
  </li>;
}

function HistoryPages<Entry extends HistoryEntry>({ service, Row }: {
  service: HistoryApi<Entry>; Row: ComponentType<{ entry: Entry }>;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const snapshot = useRef<string | null>(null);

  const load = useCallback(async (cursor?: string) => {
    if (activeRequest.current) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true); setError(null); setNotice(null);
    if (!cursor) {
      setEntries([]); setNextCursor(null); snapshot.current = null;
    }
    let pageCursor = cursor;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const page = await service.read(pageCursor, controller.signal);
          if (controller.signal.aborted) return;
          if (pageCursor && snapshot.current !== page.snapshotHash) {
            throw Object.assign(new Error("历史记录已变化"), { code: "history_changed" });
          }
          snapshot.current = page.snapshotHash;
          setEntries(previous => pageCursor ? [...previous, ...page.entries] : page.entries);
          setNextCursor(page.nextCursor);
          return;
        } catch (failure) {
          if (controller.signal.aborted) return;
          if (failure instanceof Error && "code" in failure && failure.code === "history_changed") {
            setEntries([]); setNextCursor(null); snapshot.current = null; pageCursor = undefined;
            if (attempt === 0) {
              setNotice("历史记录已变化，正在重新读取");
              continue;
            }
            throw new Error("历史记录仍在变化，请重试");
          }
          throw failure;
        }
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "历史记录暂不可用");
    } finally {
      if (!controller.signal.aborted) {
        activeRequest.current = null;
        setLoading(false);
        setNotice(null);
      }
    }
  }, [service]);

  useEffect(() => {
    void load();
    return () => {
      activeRequest.current?.abort();
      activeRequest.current = null;
    };
  }, [load]);

  return <div className="edupi-reflection-history__content" aria-busy={loading}>
    {entries.length ? <ol>{entries.map(entry => <Row key={entry.fact_id} entry={entry} />)}</ol> : null}
    {loading ? <p role="status">{notice ?? "正在读取历史记录"}</p> : null}
    {error ? <div className="edupi-reflection-history__error">
      <p role="alert">{error}</p>
      <button type="button" onClick={() => void load(nextCursor ?? undefined)}>重试</button>
    </div> : null}
    {!loading && !error && entries.length === 0 ? <p role="status">暂无历史记录</p> : null}
    {nextCursor && !error ? <button type="button" disabled={loading}
      onClick={() => void load(nextCursor)}>加载更多</button> : null}
  </div>;
}

function HistorySection<Entry extends HistoryEntry>({ label, service, refreshKey, Row }: {
  label: string; service: HistoryApi<Entry>; refreshKey: number; Row: ComponentType<{ entry: Entry }>;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return <section className="edupi-reflection-history">
    <button type="button" className="edupi-reflection-history__toggle" aria-expanded={open}
      aria-controls={panelId} onClick={() => setOpen(value => !value)}>
      <span>{label}</span><span aria-hidden="true">{open ? "−" : "+"}</span>
    </button>
    <div id={panelId} hidden={!open}>{open ? <HistoryPages key={refreshKey} service={service} Row={Row} /> : null}</div>
  </section>;
}

export function EduPiReflectionHistory({ service = api, contentService = contentApi, refreshKey = 0 }: {
  service?: HistoryApi<ReflectionHistoryEntry>;
  contentService?: HistoryApi<ReflectionContentHistoryEntry>;
  refreshKey?: number;
}) {
  return <>
    <HistorySection label="历史记录" service={service} refreshKey={refreshKey} Row={HistoryRow} />
    <HistorySection label="课堂内容历史" service={contentService} refreshKey={refreshKey} Row={ContentHistoryRow} />
  </>;
}
