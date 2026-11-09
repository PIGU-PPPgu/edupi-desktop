"use client";

import { useEffect, useRef, useState } from "react";
import {
  comparableParentQuestionConfirmation,
  readParentQuestionRecipientEntries,
  refreshParentQuestionSources,
  updateParentQuestionRecipient,
  type ParentQuestionRecipientEntry,
} from "@/lib/edupi-parent-question-recipient-client";

const api = { read: readParentQuestionRecipientEntries, update: updateParentQuestionRecipient, refresh: refreshParentQuestionSources };
type ConfirmationApi = typeof api;

function RecipientConfirmationRow({ entry, busy, onUpdate }: {
  entry: ParentQuestionRecipientEntry;
  busy: boolean;
  onUpdate: (action: "confirm" | "cancel", confirmationText?: string) => void;
}) {
  const [confirmationText, setConfirmationText] = useState("");
  const needsConfirmation = entry.status === "needs_confirmation";
  const matches = Boolean(confirmationText.trim()) && confirmationText.length <= 500
    && comparableParentQuestionConfirmation(confirmationText) === comparableParentQuestionConfirmation(entry.candidate.confirmation_text);
  return <li>
    <p>{entry.candidate.confirmation_text}</p>
    {needsConfirmation ? <label>
      <span>输入以上内容确认收件人</span>
      <textarea value={confirmationText} maxLength={500} rows={2} disabled={busy} autoComplete="off"
        onChange={event => setConfirmationText(event.target.value)} />
    </label> : null}
    <span>{needsConfirmation ? "待确认" : entry.status === "confirmed" ? "已确认" : "依据已变化"}</span>
    <button type="button" disabled={busy || needsConfirmation && !matches} onClick={() => {
      if (busy || needsConfirmation && !matches) return;
      onUpdate(needsConfirmation ? "confirm" : "cancel", needsConfirmation ? confirmationText : undefined);
    }}>
      {needsConfirmation ? "确认收件人" : "撤销确认"}
    </button>
  </li>;
}

export function EduPiParentQuestionConfirmation({ query, service = api }: { query: string; service?: ConfirmationApi }) {
  const [entries, setEntries] = useState<ParentQuestionRecipientEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    busyRef.current = false;
    setBusy(false);
    setLoading(true);
    setEntries([]);
    setMessage(null);
    service.read(controller.signal).then(result => {
      if (request.current === controller && !controller.signal.aborted) setEntries(result);
    }).catch(error => {
      if (request.current === controller && !controller.signal.aborted) setMessage(error instanceof Error ? error.message : "家长问题确认暂不可用");
    }).finally(() => {
      if (request.current === controller && !controller.signal.aborted) setLoading(false);
    });
    return () => { request.current?.abort(); };
  }, [service]);

  const run = async (operation: () => Promise<void>) => {
    if (busyRef.current || loading || !request.current || request.current.signal.aborted) return;
    request.current.abort();
    const controller = new AbortController();
    request.current = controller;
    busyRef.current = true;
    setBusy(true);
    setLoading(true);
    setEntries([]);
    setMessage(null);
    let failure: string | null = null;
    try {
      await operation();
    } catch (error) {
      failure = error instanceof Error ? error.message : "操作尚未完成，请重试";
    }
    if (controller.signal.aborted || request.current !== controller) return;
    try {
      const result = await service.read(controller.signal);
      if (request.current === controller && !controller.signal.aborted) setEntries(result);
    } catch (error) {
      failure = failure ? `${failure}；列表读取失败` : error instanceof Error ? error.message : "列表读取失败";
    }
    if (request.current === controller && !controller.signal.aborted) {
      setMessage(failure);
      setBusy(false);
      setLoading(false);
      busyRef.current = false;
    }
  };

  const visible = entries.filter(entry => entry.candidate.confirmation_text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <section className="edupi-parent-question-confirmation" aria-labelledby="parent-question-title">
    <header><h2 id="parent-question-title">家长问题收件人</h2><button type="button" disabled={busy || loading} onClick={() => void run(service.refresh)}>刷新来源</button></header>
    {loading ? <p role="status">加载中…</p> : visible.length === 0 ? <p>{query.trim() ? "未找到相关事项" : "暂无确认事项"}</p> : <ul>
      {visible.map(entry => <RecipientConfirmationRow key={JSON.stringify([query, entry])} entry={entry} busy={busy}
        onUpdate={(action, confirmationText) => void run(() => service.update(entry, action, confirmationText))} />)}
    </ul>}
    {message ? <p role="alert">{message}</p> : null}
  </section>;
}
