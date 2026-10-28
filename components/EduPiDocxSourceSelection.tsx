"use client";
import { useEffect, useRef, useState } from "react";
import type { EduPiMaterialLessonProposal } from "@/lib/edupi-core-process-client";
import { currentDocxChapter, currentMaterialSourcePreview, materialSourceIssueMessage, resolveDocxChapterSelection, type DocxSourcePreview, type DocxSourceSpan } from "@/lib/edupi-docx-chapter-suggestion";
export type { DocxSourcePreview } from "@/lib/edupi-docx-chapter-suggestion";

export function selectableDocxSource(preview: DocxSourcePreview) {
  return preview.blocks.flatMap(block => block.cells?.length ? block.cells : [block]).filter(item => item.text.trim());
}

export function selectedDocxSpans(preview: DocxSourcePreview, selected: ReadonlySet<string>): DocxSourceSpan[] {
  return selectableDocxSource(preview).filter(item => selected.has(item.path)).map(item => ({ path: item.path, start: 0, end: item.text.length }));
}

type View = { key: string; version: number; preview: DocxSourcePreview; suggestion?: { spans: DocxSourceSpan[]; parts: string[]; content: string } };
export function EduPiDocxSourceSelection({ materialId, expectedRevision, metadataRevision, available = true, active = true, chapterProposal, onActionStart, onSettled }: {
  materialId: string; expectedRevision: number; metadataRevision?: number; available?: boolean;
  active?: boolean; chapterProposal?: EduPiMaterialLessonProposal;
  onActionStart?: (action: "read" | "confirm", trigger?: HTMLButtonElement) => void;
  onSettled: (confirmed: boolean, error?: string) => void;
}) {
  const key = JSON.stringify([materialId, expectedRevision, metadataRevision, available, chapterProposal]);
  const scope = useRef({ key, alive: true, version: 0, controller: null as AbortController | null });
  if (scope.current.key !== key) {
    scope.current.alive = false; scope.current.controller?.abort();
    scope.current = { key, alive: true, version: 0, controller: null };
  }
  const renderScope = scope.current;
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const readRef = useRef<HTMLButtonElement>(null);
  const suggestionRef = useRef<HTMLButtonElement>(null);
  const focusRequest = useRef<{ scope: typeof renderScope; action: "read" | "more" | "confirm"; from: Element | null; trigger: HTMLButtonElement; index: number } | null>(null);
  useEffect(() => { const current = scope.current; current.alive = true;
    return () => { current.alive = false; current.controller?.abort(); current.controller = null; current.version++;
      if (focusRequest.current?.scope === current) focusRequest.current = null; }; }, [key]);
  const [view, setView] = useState<View | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [visibleCount, setVisibleCount] = useState(40);
  const [imageTextConfirmed, setImageTextConfirmed] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const currentView = view?.key === key ? view : null;
  const preview = currentView?.preview;
  const candidates = preview ? selectableDocxSource(preview) : [];
  const spans = currentView?.suggestion?.spans ?? (preview ? selectedDocxSpans(preview, selected) : []);
  const selectedText = currentView?.suggestion?.content ?? candidates.filter(item => selected.has(item.path)).map(item => item.text).join("\n");
  const tooLarge = spans.length > 20 || new TextEncoder().encode(selectedText).length > 16_384;
  const busy = busyKey === key, message = error?.key === key ? error.message : "";
  const chapterReady = currentDocxChapter(chapterProposal, materialId, metadataRevision, available);
  const sourceReviewRequired = preview?.source_review_required === "image_text";
  useEffect(() => {
    const request = focusRequest.current;
    if (!request) return;
    const root = rootRef.current;
    if (!active || !root?.isConnected || scope.current !== request.scope || !request.scope.alive || root.closest("details")?.open === false) { focusRequest.current = null; return; }
    const document = root.ownerDocument;
    if (busy) {
      const preserveMovedFocus = (event: FocusEvent) => {
        if (event.target !== request.from && event.target !== document.body && event.target !== document.documentElement) focusRequest.current = null;
      };
      document.addEventListener("focusin", preserveMovedFocus);
      return () => document.removeEventListener("focusin", preserveMovedFocus);
    }
    focusRequest.current = null;
    const focused = document.activeElement;
    if (focused !== request.from && focused !== document.body && focused !== document.documentElement) return;
    const piece = request.action === "more" ? listRef.current?.querySelectorAll<HTMLElement>("[data-docx-source-piece]")[request.index]
      : request.action === "read" && preview?.status === "ready" ? listRef.current?.querySelector<HTMLElement>("[data-docx-source-piece]") : null;
    const targets = [piece, request.trigger, readRef.current, suggestionRef.current];
    const target = targets.find(element => element?.isConnected && root.contains(element) && !("disabled" in element && element.disabled));
    target?.focus({ preventScroll: false });
  }, [active, busy, currentView, key, message, preview?.status, visibleCount]);
  const rememberFocus = (action: "read" | "more" | "confirm", trigger?: HTMLButtonElement, index = 0) => {
    const document = trigger?.ownerDocument;
    const focused = document?.activeElement || null;
    focusRequest.current = trigger && document && (rootRef.current?.contains(focused) || focused === document.body || focused === document.documentElement)
      ? { scope: renderScope, action, from: focused, trigger, index } : null;
  };
  const read = async (suggested = false, trigger?: HTMLButtonElement) => {
    const current = renderScope;
    if (scope.current !== current || !current.alive || current.controller || !available || suggested && !chapterReady) return;
    const version = ++current.version;
    const controller = new AbortController(); current.controller = controller;
    const isCurrent = () => scope.current === current && current.alive && !controller.signal.aborted;
    rememberFocus("read", trigger); onActionStart?.("read", trigger);
    setBusyKey(key); setError(null); setView(null); setSelected(new Set()); setVisibleCount(40); setImageTextConfirmed(false);
    try {
      const response = await fetch(`/api/edupi/material-excerpt/source?materialId=${encodeURIComponent(materialId)}`, { cache: "no-store", signal: controller.signal });
      const result = await response.json();
      if (!isCurrent()) return;
      if (!response.ok) throw new Error(result.error || "原文读取失败");
      if (!currentMaterialSourcePreview(result.preview, materialId)) throw new Error("原文读取未核实，请重试");
      const suggestion = suggested ? await resolveDocxChapterSelection(result.preview, chapterProposal, materialId, metadataRevision, available) : undefined;
      if (suggested && isCurrent()) {
        // The parent projection may predate a server-side metadata edit. The
        // preview basis fences parsing and later CAS races, not this UI cache.
        const projection = await fetch("/api/edupi/education", { cache: "no-store", signal: controller.signal });
        const data = await projection.json();
        if (!isCurrent()) return;
        const materials = Array.isArray(data.teacherMaterials) ? data.teacherMaterials.filter((item: { material_id?: unknown } | null) => item?.material_id === materialId) : [];
        if (!projection.ok || materials.length !== 1 || materials[0].available === false || materials[0].metadata_revision !== metadataRevision) {
          throw new Error("材料信息已变化，请重新核对");
        }
      }
      if (isCurrent()) setView({ key, version, preview: structuredClone(result.preview), suggestion });
    } catch (reason) { if (isCurrent()) setError({ key, message: reason instanceof Error ? reason.message : "原文读取失败" }); }
    finally { if (isCurrent()) { current.controller = null; setBusyKey(null); } }
  };
  const confirm = async (trigger?: HTMLButtonElement) => {
    const current = renderScope;
    if (scope.current !== current || !current.alive || current.controller || !available || !preview
      || currentView?.version !== current.version || preview.status !== "ready" || !spans.length || tooLarge
      || sourceReviewRequired && !imageTextConfirmed) return;
    const controller = new AbortController(); current.controller = controller;
    const isCurrent = () => scope.current === current && current.alive && !controller.signal.aborted;
    if (onActionStart) { focusRequest.current = null; onActionStart("confirm", trigger); }
    else rememberFocus("confirm", trigger);
    setBusyKey(key); setError(null);
    let confirmed = false;
    let failure: string | undefined;
    try {
      const response = await fetch("/api/edupi/material-excerpt/source", { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ materialId, expectedRevision, expectedBasisHash: preview.basis_hash, sourceSpans: spans,
          ...(sourceReviewRequired && imageTextConfirmed ? { confirmSourceText: true } : {}) }) });
      const result = await response.json();
      if (!isCurrent()) return;
      if (!response.ok) throw new Error(result.error || "确认未完成");
      confirmed = true;
    } catch (reason) { if (isCurrent()) { failure = reason instanceof Error ? reason.message : "确认未完成"; setError({ key, message: failure }); } }
    finally { if (isCurrent()) { current.controller = null; current.version++; setView(null); setSelected(new Set()); setImageTextConfirmed(false); setBusyKey(null); onSettled(confirmed, failure); } }
  };
  const location = (path: string) => {
    const block = preview?.blocks.find(block => block.path === path), region = block?.region;
    return block?.page && region ? `第${block.page}页 · 像素区域 ${region.left},${region.top} ${region.width}×${region.height}` : path;
  };
  return <div ref={rootRef} className="edupi-docx-source">
    {chapterReady ? <button ref={suggestionRef} type="button" className="native-button" disabled={busy} onClick={event => read(true, event?.currentTarget)}>查看建议</button> : null}
    {!chapterReady || message ? <button ref={readRef} type="button" className="native-button" disabled={busy || !available} onClick={event => read(false, event?.currentTarget)}>{busy ? "处理中…" : "从原文选取"}</button> : null}
    {message ? <p role="alert">{message}</p> : null}
    {preview?.status === "held" ? <p role="status">{preview.issues.map(materialSourceIssueMessage).join("；")}</p> : null}
    {preview?.status === "ready" ? <>
      <div ref={listRef} role="group" aria-label="选择原文片段" className="edupi-docx-source__list">{currentView?.suggestion
        ? currentView.suggestion.parts.map((text, index) => <p key={index} title={location(spans[index].path)} data-docx-source-piece={spans[index].path} tabIndex={-1}>{text}</p>)
        : candidates.slice(0, visibleCount).map(item => <label key={item.path}>
        <input type="checkbox" data-docx-source-piece={item.path} checked={selected.has(item.path)} disabled={busy} onChange={event => setSelected(current => {
          const next = new Set(current); if (event.target.checked) next.add(item.path); else next.delete(item.path); return next;
        })} /><span title={location(item.path)}>{item.text}</span>
      </label>)}</div>
      {!currentView?.suggestion && candidates.length > visibleCount ? <button type="button" className="native-button" disabled={busy} onClick={event => { rememberFocus("more", event?.currentTarget, visibleCount); setVisibleCount(value => value + 40); }}>查看更多</button> : null}
      {tooLarge ? <p role="alert">最多选20处，合计不超过16 KB</p> : null}
      {sourceReviewRequired ? <label><input type="checkbox" checked={imageTextConfirmed} disabled={busy}
        onChange={event => setImageTextConfirmed(event.target.checked)} />已核对图片正文</label> : null}
      <button type="button" className="native-button" disabled={busy || !spans.length || tooLarge || sourceReviewRequired && !imageTextConfirmed} onClick={event => confirm(event?.currentTarget)}>确认选中内容</button>
    </> : null}
  </div>;
}
