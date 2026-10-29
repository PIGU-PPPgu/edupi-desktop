"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EduPiMaterialScheduleProposal as UploadProposal } from "@/lib/edupi-core-process-client";
import { applyMaterialSchedule, captureMaterialScheduleApply, materialScheduleCanApply, materialScheduleErrorMessage,
  readMaterialSchedule, type MaterialScheduleApplyResult, type MaterialScheduleRead } from "@/lib/edupi-material-schedule";
import { calendarTimeLabel } from "@/lib/edupi-calendar-form-time";
import { EduPiPagination } from "./EduPiActionIcon";
import { confirmMaterialScheduleNative } from "@/lib/desktop-native";
import { materialSourceIssueMessage } from "@/lib/edupi-docx-chapter-suggestion";

type Props = {
  materialId: string;
  metadataRevision?: number;
  initialProposal?: UploadProposal;
  onApplied?: (result: MaterialScheduleApplyResult) => void;
  onBusyChange?: (busy: boolean) => void;
  lockOpenDuringApply?: boolean;
  onPreview?: () => void;
};
const PAGE_SIZE = 10;
type ProposalScope = { key: string; materialId: string; metadataRevision?: number };

function isParentCatchUp(value: MaterialScheduleRead | null, previous: ProposalScope, next: ProposalScope): value is MaterialScheduleRead {
  return previous.materialId === next.materialId && next.metadataRevision !== undefined
    && (previous.metadataRevision === undefined || previous.metadataRevision < next.metadataRevision)
    && value?.source.material_id === next.materialId && value.source.metadata_revision === next.metadataRevision;
}

function sameProof(left: MaterialScheduleRead, right: MaterialScheduleRead): boolean {
  return left.root_ref === right.root_ref && left.owner_id === right.owner_id && left.source.material_id === right.source.material_id
    && left.source.source_hash === right.source.source_hash && left.source.metadata_revision === right.source.metadata_revision
    && left.parse_fingerprint === right.parse_fingerprint;
}

export function EduPiMaterialScheduleProposal({ materialId, metadataRevision, initialProposal, onApplied, onBusyChange, lockOpenDuringApply = false, onPreview }: Props) {
  const [current, setCurrent] = useState<MaterialScheduleRead | null>(null);
  const [currentSequence, setCurrentSequence] = useState<number | null>(null);
  const [applied, setApplied] = useState<{ scope: string; proof: MaterialScheduleRead; result: MaterialScheduleApplyResult } | null>(null);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const [imageTextConfirmed, setImageTextConfirmed] = useState(false);
  const [focusGeneration, setFocusGeneration] = useState(0);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const reloadRef = useRef<HTMLButtonElement>(null);
  const adoptRef = useRef<HTMLButtonElement>(null);
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const expanded = useRef(false);
  const adoptionInFlight = useRef(false);
  const applyInFlight = useRef(false);
  const scope = JSON.stringify([materialId, metadataRevision ?? null]);
  const previousScope = useRef<ProposalScope>({ key: scope, materialId, metadataRevision });
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const focusRequest = useRef<{ scope: string; sequence: number; action: "read" | "adopt"; from: Element | null } | null>(null);
  const rememberFocus = useCallback((action: "read" | "adopt", revision: number, trigger?: HTMLButtonElement) => {
    const root = detailsRef.current;
    if (!root || !trigger) { focusRequest.current = null; return; }
    const document = root.ownerDocument, from = document.activeElement;
    focusRequest.current = root.contains(from) || from === document.body || from === document.documentElement
      ? { scope, sequence: revision, action, from } : null;
  }, [scope]);
  useEffect(() => {
    const request = focusRequest.current;
    if (!request) return;
    const root = detailsRef.current;
    if (request.scope !== scope || request.sequence !== sequence.current || !root?.isConnected || !root.open) { focusRequest.current = null; return; }
    const document = root.ownerDocument;
    if (busy || applying) {
      const preserveMovedFocus = (event: FocusEvent) => {
        if (event.target !== request.from && event.target !== document.body && event.target !== document.documentElement) focusRequest.current = null;
      };
      document.addEventListener("focusin", preserveMovedFocus);
      return () => document.removeEventListener("focusin", preserveMovedFocus);
    }
    focusRequest.current = null;
    const active = document.activeElement;
    if (active !== request.from && active !== document.body && active !== document.documentElement) return;
    const target = request.action === "adopt" && adoptRef.current && !adoptRef.current.disabled ? adoptRef.current : reloadRef.current;
    if (target?.isConnected && !target.disabled && root.contains(target)) target.focus({ preventScroll: false });
  }, [busy, applying, focusGeneration, scope]);

  const load = useCallback(async (trigger?: HTMLButtonElement) => {
    controller.current?.abort();
    const revision = ++sequence.current;
    const request = new AbortController();
    controller.current = request;
    rememberFocus("read", revision, trigger);
    setBusy(true); onBusyChange?.(true); setCurrentSequence(null); setError(""); setImageTextConfirmed(false);
    try {
      const observed = await readMaterialSchedule(materialId, undefined, undefined, request.signal);
      if (activeScope.current !== scope || sequence.current !== revision || request.signal.aborted) return;
      setCurrent(observed); setCurrentSequence(revision); setPage(0);
      setApplied(value => value && sameProof(value.proof, observed) ? value : null);
    } catch (error) {
      if (activeScope.current === scope && sequence.current === revision && !request.signal.aborted) setError(materialScheduleErrorMessage(error));
    } finally {
      if (activeScope.current === scope && sequence.current === revision) { setBusy(false); onBusyChange?.(false); setFocusGeneration(value => value + 1); }
    }
  }, [materialId, scope, rememberFocus, onBusyChange]);
  useEffect(() => {
    controller.current?.abort(); sequence.current += 1; focusRequest.current = null;
    const previous = previousScope.current, next = { key: scope, materialId, metadataRevision };
    previousScope.current = next;
    // A parent projection catching up to this exact verified version does not erase its write history.
    setCurrent(value => isParentCatchUp(value, previous, next) ? value : null);
    setApplied(value => value?.scope === previous.key && isParentCatchUp(value.proof, previous, next) ? { ...value, scope } : null);
    setCurrentSequence(null); setError(""); setPage(0); setImageTextConfirmed(false);
    if (expanded.current) void load();
    return () => { controller.current?.abort(); sequence.current += 1; focusRequest.current = null; };
  }, [load, materialId, metadataRevision, scope]);

  const catchingUp = isParentCatchUp(current, previousScope.current, { key: scope, materialId, metadataRevision });
  const scopedCurrent = (previousScope.current.key === scope || catchingUp) && current?.source.material_id === materialId
    && (metadataRevision === undefined || current.source.metadata_revision >= metadataRevision) ? current : null;
  const localApplied = applied && (applied.scope === scope || catchingUp && applied.scope === previousScope.current.key)
    && scopedCurrent && sameProof(applied.proof, scopedCurrent) ? applied.result : null;
  const receipt = scopedCurrent?.adoptionReceipt || null;
  const adoptedCount = receipt?.appliedIds.length ?? (localApplied && localApplied.status !== "held" ? localApplied.applied_ids.length : null);
  const currentProof = scopedCurrent && previousScope.current.key === scope && currentSequence === sequence.current && expanded.current ? scopedCurrent : null;
  const initial = initialProposal?.material_id === materialId ? initialProposal : null;
  const shown = scopedCurrent || initial?.read_result || null;
  const label = busy ? "读取中…" : receipt?.calendarState === "needs_review" ? "待核对" : adoptedCount !== null ? "已采用"
    : localApplied?.status === "held" || error ? "待核对" : currentProof ? materialScheduleCanApply(currentProof) ? "待确认" : "待核对"
      : initial ? { proposed: "待确认", held: "待核对", unavailable: "暂不可用" }[initial.status] : "未读取";
  const lines = shown ? [
    ...shown.issues.map((issue, index) => ({ id: `issue-${index}`, text: materialSourceIssueMessage(issue) })),
    ...shown.events.map(event => ({ id: event.event_id, text: [event.date, event.end_date && event.end_date !== event.date ? `至 ${event.end_date}` : "",
      event.name, event.time_interval ? `${calendarTimeLabel(event.time_interval.start, event.date)}—${calendarTimeLabel(event.time_interval.end, event.end_date || event.date)} ${event.time_interval.time_zone}` : "", event.location].filter(Boolean).join(" · ") })),
  ] : [];
  const pages = Math.max(1, Math.ceil(lines.length / PAGE_SIZE));
  const visible = lines.slice(Math.min(page, pages - 1) * PAGE_SIZE, (Math.min(page, pages - 1) + 1) * PAGE_SIZE);
  const sourceReviewRequired = scopedCurrent?.source_review_required === "image_text";
  const sourceReviewed = !sourceReviewRequired || imageTextConfirmed;
  const adopt = async (trigger?: HTMLButtonElement) => {
    if (!currentProof || !materialScheduleCanApply(currentProof) || !sourceReviewed || adoptedCount !== null || busy || adoptionInFlight.current) return;
    const revision = sequence.current;
    const capture = captureMaterialScheduleApply(currentProof, undefined, sourceReviewRequired && imageTextConfirmed ? true : undefined);
    rememberFocus("adopt", revision, trigger);
    adoptionInFlight.current = true;
    setApplying(true); setError("");
    onBusyChange?.(true);
    try {
      if (!await confirmMaterialScheduleNative(currentProof.events.length)) return;
      if (activeScope.current !== scope || sequence.current !== revision || controller.current?.signal.aborted) return;
      applyInFlight.current = true;
      const result = await applyMaterialSchedule(capture);
      if (activeScope.current === scope && sequence.current === revision) { setApplied({ scope, proof: currentProof, result }); onApplied?.(result); }
    } catch (error) {
      if (activeScope.current === scope && sequence.current === revision) { setCurrentSequence(null); setError(materialScheduleErrorMessage(error)); }
    } finally {
      applyInFlight.current = false; adoptionInFlight.current = false; setApplying(false);
      if (activeScope.current === scope && sequence.current === revision) { onBusyChange?.(false); setFocusGeneration(value => value + 1); }
    }
  };

  return <details ref={detailsRef} className="edupi-material-inbox" onToggle={event => {
    if (lockOpenDuringApply && applyInFlight.current) { if (!event.currentTarget.open) event.currentTarget.open = true; return; }
    expanded.current = event.currentTarget.open;
    if (expanded.current) void load();
    else { controller.current?.abort(); sequence.current += 1; focusRequest.current = null; setCurrentSequence(null); setBusy(false); onBusyChange?.(false); setImageTextConfirmed(false); }
    }}>
    <summary onClick={event => { if (lockOpenDuringApply && applyInFlight.current) event.preventDefault(); }}>安排提案 <span>{label}</span></summary>
    <div className="edupi-material-pairing__current">
    {!scopedCurrent && initial?.read_result ? <small>上传时提案</small> : null}
    {lines.length ? <ul>{visible.map(line => <li key={line.id}>{line.text}</li>)}</ul> : null}
    {pages > 1 ? <EduPiPagination label="安排提案分页" page={page} pages={pages} previousDisabled={page === 0} nextDisabled={page >= pages - 1}
      onPrevious={() => setPage(value => value - 1)} onNext={() => setPage(value => value + 1)}/> : null}
    {adoptedCount !== null ? <p role="status">{adoptedCount ? `已采用 ${adoptedCount} 项安排` : "已采用"}{receipt?.calendarState === "needs_review" ? "，日程待核对" : ""}</p>
      : localApplied?.status === "held" ? <p role="status">安排待核对</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {sourceReviewRequired ? <label><input type="checkbox" checked={imageTextConfirmed} disabled={busy || applying}
      onChange={event => setImageTextConfirmed(event.target.checked)} />已核对图片正文</label> : null}
    <div className="edupi-material-inbox__row">
      {onPreview ? <button type="button" onClick={onPreview}>预览原材料</button> : null}
      <button ref={reloadRef} type="button" disabled={busy || applying} onClick={event => void load(event?.currentTarget)}>重新读取</button>
      <button ref={adoptRef} type="button" disabled={!currentProof || !materialScheduleCanApply(currentProof) || !sourceReviewed || busy || applying || adoptedCount !== null}
        onClick={event => void adopt(event?.currentTarget)}>{applying ? "采用中…" : "确认采用"}</button>
    </div>
    </div>
  </details>;
}
