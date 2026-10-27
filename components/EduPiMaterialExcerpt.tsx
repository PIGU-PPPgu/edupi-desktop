"use client";
import { useEffect, useRef, useState } from "react";
import { EduPiDocxSourceSelection } from "./EduPiDocxSourceSelection";
import type { EduPiMaterialLessonProposal } from "@/lib/edupi-core-process-client";

type Excerpt = { revision: number; status: "confirmed" | "withdrawn"; content: string; source_kind?: "docx_parsed_fragment" | "teacher_curated" };
type ExcerptAction = "refresh" | "confirm" | "withdraw";
export function EduPiMaterialExcerpt({ materialId, onPreview, canSelectDocx = false, chapterProposal, metadataRevision, available = true }: {
  materialId: string; onPreview?: () => void; canSelectDocx?: boolean; chapterProposal?: EduPiMaterialLessonProposal;
  metadataRevision?: number; available?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [excerpt, setExcerpt] = useState<Excerpt | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [focusGeneration, setFocusGeneration] = useState(0);
  const initialized = useRef(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const refreshRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const withdrawRef = useRef<HTMLButtonElement>(null);
  const focusRequest = useRef<{ materialId: string; action: ExcerptAction; from: Element | null } | null>(null);
  useEffect(() => () => { focusRequest.current = null; }, [materialId]);
  useEffect(() => {
    const request = focusRequest.current;
    if (!request) return;
    const details = detailsRef.current;
    if (request.materialId !== materialId || !details?.isConnected || !available) { focusRequest.current = null; return; }
    const document = details.ownerDocument;
    if (busy && details.open) {
      const preserveMovedFocus = (event: FocusEvent) => {
        if (event.target !== request.from && event.target !== document.body && event.target !== document.documentElement) focusRequest.current = null;
      };
      document.addEventListener("focusin", preserveMovedFocus);
      return () => document.removeEventListener("focusin", preserveMovedFocus);
    }
    focusRequest.current = null;
    const active = document.activeElement;
    if (active !== request.from && active !== document.body && active !== document.documentElement) return;
    const preferred = request.action === "refresh" ? refreshRef.current : request.action === "withdraw" ? withdrawRef.current : confirmRef.current;
    const targets = details.open ? [preferred, confirmRef.current, refreshRef.current] : [summaryRef.current];
    const target = targets.find(element => element?.isConnected && details.contains(element) && !("disabled" in element && element.disabled));
    target?.focus({ preventScroll: false });
  }, [busy, materialId, open, available, focusGeneration]);
  const rememberFocus = (action: ExcerptAction, trigger: HTMLButtonElement) => {
    const document = trigger.ownerDocument;
    const active = document.activeElement;
    focusRequest.current = detailsRef.current?.contains(active) || active === document.body || active === document.documentElement
      ? { materialId, action, from: active } : null;
  };
  useEffect(() => {
    if (!open || !available) return;
    const controller = new AbortController();
    setBusy(true); setLoaded(false); setError("");
    void fetch(`/api/edupi/material-excerpt?materialId=${encodeURIComponent(materialId)}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "读取失败");
      if (controller.signal.aborted) return;
      setExcerpt(result.excerpt); setLoaded(true); setConflict(false);
      if (!initialized.current) { setContent(result.excerpt?.content || ""); initialized.current = true; }
    }).catch(reason => { if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : "读取失败"); setLoaded(false); } }).finally(() => { if (!controller.signal.aborted) { setBusy(false); setFocusGeneration(value => value + 1); } });
    return () => controller.abort();
  }, [open, materialId, metadataRevision, available, refresh]);
  const save = async (decision: "confirm" | "withdraw", trigger: HTMLButtonElement) => {
    rememberFocus(decision, trigger);
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/edupi/material-excerpt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ materialId, expectedRevision: excerpt?.revision || 0, content, decision }) });
      const result = await response.json();
      if (!response.ok) { setConflict(result.conflict === true); throw new Error(result.error || "保存未确认"); }
      setExcerpt(result.excerpt); setConflict(false);
      window.dispatchEvent(new Event("edupi-preparation-updated"));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "保存未确认"); }
    finally { setBusy(false); setFocusGeneration(value => value + 1); }
  };
  const oversized = new TextEncoder().encode(content).length > 16384;
  return <details ref={detailsRef} className="edupi-material-excerpt" onToggle={event => setOpen(event.currentTarget.open)}><summary ref={summaryRef}>用于备课</summary><div className="edupi-material-excerpt__body">
    {onPreview ? <button type="button" onClick={onPreview}>预览原材料</button> : null}
    <label>核对正文<textarea aria-label="备课材料正文" rows={8} value={content} disabled={busy || !loaded} onChange={event => setContent(event.target.value)} /></label>
    {excerpt ? <p role="status">{excerpt.status === "confirmed" ? "已确认" : "已撤回"}{excerpt.source_kind === "docx_parsed_fragment" ? " · 原文片段" : ""} · 版本 {excerpt.revision}</p> : null}
    {loaded && content !== (excerpt?.content || "") ? <p role="status">当前输入未保存</p> : null}
    {canSelectDocx && loaded && available ? <EduPiDocxSourceSelection materialId={materialId} expectedRevision={excerpt?.revision || 0}
      chapterProposal={chapterProposal} metadataRevision={metadataRevision} available={available} onSettled={confirmed => {
      if (confirmed) initialized.current = false;
      setRefresh(value => value + 1); window.dispatchEvent(new Event("edupi-preparation-updated"));
    }} /> : null}
    {error ? <p role="alert">{error}</p> : null}{oversized ? <p role="alert">正文不能超过16 KB</p> : null}
    <button ref={refreshRef} type="button" disabled={busy} onClick={event => { rememberFocus("refresh", event.currentTarget); setRefresh(value => value + 1); }}>刷新版本</button>
    <button ref={confirmRef} type="button" disabled={busy || !loaded || conflict || oversized || !content.trim()} onClick={event => void save("confirm", event.currentTarget)}>{busy ? "处理中…" : "确认正文"}</button>
    {excerpt?.status === "confirmed" ? <button ref={withdrawRef} type="button" disabled={busy || !loaded || conflict} onClick={event => void save("withdraw", event.currentTarget)}>撤回确认</button> : null}
  </div></details>;
}
