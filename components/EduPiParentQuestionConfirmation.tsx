"use client";

import { useEffect, useRef, useState } from "react";
import {
  readParentQuestionRecipientEntries,
  refreshParentQuestionSources,
  updateParentQuestionRecipient,
  type ParentQuestionRecipientEntry,
} from "@/lib/edupi-parent-question-recipient-client";

const api = { read: readParentQuestionRecipientEntries, update: updateParentQuestionRecipient, refresh: refreshParentQuestionSources };
type ConfirmationApi = typeof api;

export function EduPiParentQuestionConfirmation({ query, service = api }: { query: string; service?: ConfirmationApi }) {
  const [entries, setEntries] = useState<ParentQuestionRecipientEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const active = useRef(false);
  const busyRef = useRef(false);

  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    service.read(controller.signal).then(result => {
      if (active.current && !controller.signal.aborted) setEntries(result);
    }).catch(error => {
      if (active.current && !controller.signal.aborted) setMessage(error instanceof Error ? error.message : "家长问题确认暂不可用");
    }).finally(() => {
      if (active.current && !controller.signal.aborted) setLoading(false);
    });
    return () => { active.current = false; controller.abort(); };
  }, [service]);

  const run = async (operation: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    let failure: string | null = null;
    try {
      await operation();
    } catch (error) {
      failure = error instanceof Error ? error.message : "操作尚未完成，请重试";
    }
    try {
      const result = await service.read();
      if (active.current) setEntries(result);
    } catch (error) {
      failure = failure ? `${failure}；列表读取失败` : error instanceof Error ? error.message : "列表读取失败";
    }
    if (active.current) {
      setMessage(failure);
      setBusy(false);
    }
    busyRef.current = false;
  };

  const visible = entries.filter(entry => entry.candidate.confirmation_text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <section className="edupi-parent-question-confirmation" aria-labelledby="parent-question-title">
    <header><h2 id="parent-question-title">家长问题收件人</h2><button type="button" disabled={busy || loading} onClick={() => void run(service.refresh)}>刷新来源</button></header>
    {loading ? <p role="status">加载中…</p> : visible.length === 0 ? <p>{query.trim() ? "未找到相关事项" : "暂无确认事项"}</p> : <ul>
      {visible.map(entry => <li key={`${entry.questionFactId}:${entry.questionRevision}:${entry.messageGeneration}:${entry.candidate.source_basis_hash}`}>
        <p>{entry.candidate.confirmation_text}</p>
        <span>{entry.status === "needs_confirmation" ? "待确认" : entry.status === "confirmed" ? "已确认" : "依据已变化"}</span>
        <button type="button" disabled={busy} onClick={() => void run(() => service.update(entry, entry.status === "needs_confirmation" ? "confirm" : "cancel"))}>
          {entry.status === "needs_confirmation" ? "确认收件人" : "撤销确认"}
        </button>
      </li>)}
    </ul>}
    {message ? <p role="alert">{message}</p> : null}
  </section>;
}
