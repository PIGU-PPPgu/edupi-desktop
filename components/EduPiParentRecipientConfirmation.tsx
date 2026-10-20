"use client";
import { useEffect, useRef, useState } from "react";
import { readParentRecipientEntries, confirmParentRecipientEntry, type ParentRecipientEntry } from "@/lib/edupi-parent-recipient-client";
export function EduPiParentRecipientConfirmationView({ entries, busy, message, onConfirm }: { entries: ParentRecipientEntry[]; busy: string | null; message: string | null; onConfirm: (entry: ParentRecipientEntry) => void }) {
  return <details className="edupi-proactivity-execution"><summary>收件人确认</summary>
    {entries.length === 0 ? <p>暂无待确认事项</p> : <ul>{entries.map(entry => <li key={`${entry.sessionId}:${entry.clientRequestId}`}>
      {entry.candidate && entry.status === "ready" ? <><span>{entry.candidate.student.label} → {entry.candidate.recipient.label} · {entry.candidate.term.label}</span>
        <button type="button" disabled={Boolean(busy)} onClick={() => onConfirm(entry)}>{busy === entry.clientRequestId ? "确认中…" : "确认收件人"}</button></>
        : <span>{entry.status === "held" ? "来源待核对" : "需要补充学生、收件人或时间"}</span>}
    </li>)}</ul>}{message ? <p role="status">{message}</p> : null}
  </details>;
}
export function EduPiParentRecipientConfirmation() {
  const [entries, setEntries] = useState<ParentRecipientEntry[]>([]), [busy, setBusy] = useState<string | null>(null), [message, setMessage] = useState<string | null>(null);
  const commands = useRef(new Map<string, string>()), active = useRef(true), busyRef = useRef(false);
  const refresh = async () => { try { const next = await readParentRecipientEntries(); if (active.current) setEntries(next); }
    catch { if (active.current) setMessage("收件人确认暂不可用"); } };
  useEffect(() => {
    active.current = true; void refresh();
    const onRefresh = () => { if (!busyRef.current) void refresh(); }, interval = window.setInterval(onRefresh, 30_000);
    window.addEventListener("focus", onRefresh); window.addEventListener("edupi-education-refresh", onRefresh);
    return () => { active.current = false; window.clearInterval(interval); window.removeEventListener("focus", onRefresh); window.removeEventListener("edupi-education-refresh", onRefresh); };
  }, []);
  const confirm = async (entry: ParentRecipientEntry) => {
    if (busyRef.current) return;
    const key = `${entry.sessionId}:${entry.clientRequestId}:${entry.candidate?.source_fingerprint}`;
    const commandId = commands.current.get(key) ?? `recipient-${crypto.randomUUID()}`; commands.current.set(key, commandId);
    busyRef.current = true; setBusy(entry.clientRequestId); setMessage(null);
    try { await confirmParentRecipientEntry(entry, commandId); await refresh(); window.dispatchEvent(new Event("edupi-education-refresh")); if (active.current) setMessage("收件人已确认"); }
    catch (error) { if (active.current) setMessage(error instanceof Error ? error.message : "确认尚未完成，请重试"); }
    finally { busyRef.current = false; if (active.current) setBusy(null); }
  };
  return <EduPiParentRecipientConfirmationView entries={entries} busy={busy} message={message} onConfirm={entry => void confirm(entry)} />;
}
