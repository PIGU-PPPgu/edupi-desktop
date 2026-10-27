"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { confirmTeacherContextFieldRestore } from "@/lib/desktop-native";
import type {
  EducationContract,
  EducationTeacherContextCandidate,
  EducationTeacherContextReviewHistory,
  TeacherContextReviewCapability,
} from "@/lib/edupi-education-contract";
import type { TeacherContextSnapshot } from "@/lib/edupi-onboarding-types";
import type { TeacherContextVersion, TeacherContextVersionField, TeacherContextVersionSide } from "@/lib/edupi-teacher-context-versions";
import {
  TEACHER_CONTEXT_FIELDS,
  buildContextPatch,
  buildTeacherContextPrompt,
  contextStatusLabel,
  currentContextValues,
  matchesTeacherContextRefresh,
  proposedContextValues,
  verifyTeacherContextReview,
  type TeacherContextEditorValues,
  type TeacherContextField,
  type TeacherContextReviewDecision,
} from "@/lib/edupi-context-editor-model";

type ReviewResult = {
  receipt: Record<string, unknown>;
  data: EducationContract;
};

type Props = {
  initial?: TeacherContextSnapshot | null;
  candidate?: EducationTeacherContextCandidate | null;
  capability?: TeacherContextReviewCapability | null;
  history?: EducationTeacherContextReviewHistory[];
  reviewer?: string;
  onReviewed?: (result: ReviewResult) => Promise<EducationContract>;
  onAgentRequest?: (prompt: string) => void;
  onBusyChange?: (busy: boolean) => void;
  onClose?: () => void;
};

type ReviewFailureCode = "stale" | "invalid_receipt" | "refresh" | "generic";
type TrustedAfterSnapshot = {
  targetId: string;
  snapshotId: string;
  stateHash: string;
  awaiting: boolean;
};

class ReviewFailure extends Error {
  constructor(public readonly code: ReviewFailureCode, message: string) {
    super(message);
  }
}

const ACTION_LABELS: Record<TeacherContextReviewDecision, string> = {
  accept: "接受",
  modify: "修改",
  reject: "拒绝",
  hold: "暂缓",
};

const BUSY_LABELS: Record<TeacherContextReviewDecision, string> = {
  accept: "正在接受…",
  modify: "正在修改…",
  reject: "正在拒绝…",
  hold: "正在暂缓…",
};
const REVIEW_STATUS_LABELS: Record<string, string> = { accepted: "已接受", modified: "已修改", rejected: "已拒绝", held: "已暂缓", failed: "失败" };

function reviewFailureCode(value: unknown): ReviewFailureCode {
  if (value instanceof ReviewFailure) return value.code;
  if (value instanceof Error && /stale|快照|版本|更新/.test(value.message)) return "stale";
  return "generic";
}

function responseError(value: unknown): ReviewFailure {
  const result = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const code = result.code;
  if (code === "stale_snapshot" || code === "stale_revision") return new ReviewFailure("stale", "内容已更新，请刷新。");
  return new ReviewFailure("generic", "提交失败，请重试。");
}

function isActionable(candidate: EducationTeacherContextCandidate | null | undefined): boolean {
  const state = candidate?.status || candidate?.teacherReview.state;
  return state === "pending_review" || state === "held";
}

function changed(current: string | undefined, proposal: string | undefined): boolean {
  return Boolean(proposal && proposal !== current);
}

export function EduPiContextEditor({ initial, candidate = null, capability = null, history = [], reviewer = "teacher", onReviewed, onAgentRequest, onBusyChange, onClose }: Props) {
  const editorRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const manualEntryRef = useRef<HTMLButtonElement>(null);
  const modifyEntryRef = useRef<HTMLButtonElement>(null);
  const draftEntryRef = useRef<HTMLButtonElement>(null);
  const focusedFormRef = useRef<"manual" | "modify" | "draft" | null>(null);
  const fieldHistorySummaryRef = useRef<HTMLElement>(null);
  const restoreFocusTargetRef = useRef<HTMLButtonElement | null>(null);
  const trustedAfterSnapshotRef = useRef<TrustedAfterSnapshot | null>(null);
  const currentValues = useMemo(() => currentContextValues(candidate, initial), [candidate, initial]);
  const proposalValues = useMemo(() => proposedContextValues(candidate), [candidate]);
  const [modifyOpen, setModifyOpen] = useState(false);
  const [chatDraftOpen, setChatDraftOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [draft, setDraft] = useState<TeacherContextEditorValues>(proposalValues);
  const [busy, setBusy] = useState(false);
  const [busyDecision, setBusyDecision] = useState<TeacherContextReviewDecision | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldHistoryOpen, setFieldHistoryOpen] = useState(false);
  const [fieldVersions, setFieldVersions] = useState<TeacherContextVersion[] | null>(null);
  const [fieldHistoryError, setFieldHistoryError] = useState<string | null>(null);
  const [restoringField, setRestoringField] = useState<string | null>(null);
  const [restoreFocusRequest, setRestoreFocusRequest] = useState(0);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    setModifyOpen(false);
    setChatDraftOpen(false);
    setDraft(proposalValues);
    const marker = trustedAfterSnapshotRef.current;
    const matchesMarker = Boolean(marker
      && candidate?.contextId === marker.targetId
      && candidate.snapshotId === marker.snapshotId
      && candidate.stateHash === marker.stateHash);
    if (marker && !matchesMarker) {
      trustedAfterSnapshotRef.current = null;
      setFeedback(null);
    } else if (!marker) setFeedback(null);
    setError(null);
  }, [candidate?.contextId, candidate?.snapshotId, candidate?.stateHash, candidate?.revision, candidate?.status, candidate?.teacherReview.state, proposalValues]);

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  useEffect(() => {
    if (busy) return;
    const trigger = restoreFocusTargetRef.current;
    if (!trigger) return;
    restoreFocusTargetRef.current = null;
    const editor = editorRef.current;
    if (!editor?.isConnected) return;
    const target = [fieldHistoryOpen && !trigger.disabled ? trigger : null, fieldHistorySummaryRef.current, headingRef.current]
      .find((element) => element?.isConnected && editor.contains(element));
    target?.focus({ preventScroll: target === trigger });
  }, [busy, fieldHistoryOpen, restoreFocusRequest]);

  useEffect(() => {
    if (!fieldHistoryOpen) return;
    const controller = new AbortController();
    setFieldHistoryError(null);
    setFieldVersions(null);
    fetch("/api/edupi/onboarding/versions", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as { versions?: TeacherContextVersion[]; error?: string };
        if (!response.ok || !Array.isArray(result.versions)) throw new Error(result.error || "字段历史读取失败");
        setFieldVersions(result.versions);
      })
      .catch((reason) => { if (!controller.signal.aborted) setFieldHistoryError(reason instanceof Error ? reason.message : "字段历史读取失败"); });
    return () => controller.abort();
  }, [candidate?.revision, fieldHistoryOpen]);

  useEffect(() => {
    if (!modifyOpen && !chatDraftOpen && !manualOpen) return;
    const cancelDraft = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return;
      event.preventDefault();
      event.stopPropagation();
      setModifyOpen(false);
      setChatDraftOpen(false);
      setManualOpen(false);
      setError(null);
    };
    window.addEventListener("keydown", cancelDraft, true);
    return () => window.removeEventListener("keydown", cancelDraft, true);
  }, [busy, chatDraftOpen, modifyOpen, manualOpen]);

  function updateDraft(field: TeacherContextField, value: string) {
    if (busy) return;
    setDraft((previous) => ({ ...previous, [field]: value }));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (busy) return;
      if (modifyOpen || chatDraftOpen || manualOpen) {
        setModifyOpen(false);
        setChatDraftOpen(false);
        setManualOpen(false);
        setError(null);
        return;
      }
      onClose?.();
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      if (busy) return;
      if (manualOpen) {
        event.preventDefault();
        void saveManual();
      } else if (modifyOpen) {
        event.preventDefault();
        submitModify();
      } else if (chatDraftOpen) {
        event.preventDefault();
        submitDraft();
      }
    }
  }

  async function submit(decision: TeacherContextReviewDecision, patch: TeacherContextEditorValues | null) {
    if (busy || !candidate || !capability?.enabled) return;
    setBusy(true);
    setBusyDecision(decision);
    setFeedback(null);
    setError(null);
    try {
      const response = await fetch("/api/edupi/onboarding", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetId: candidate.contextId,
          expectedSnapshotId: candidate.snapshotId,
          expectedRevision: candidate.revision,
          decision,
          patch,
          note: `教师在 EduPi 中执行：${ACTION_LABELS[decision]}`,
          reviewerId: reviewer,
        }),
      });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok) throw responseError(result);
      const verified = verifyTeacherContextReview(result, {
        targetId: candidate.contextId,
        expectedSnapshotId: candidate.snapshotId,
        expectedStateHash: candidate.stateHash,
        decision,
      });
      if (!verified.ok) throw new ReviewFailure("invalid_receipt", "未收到可信回执，结果未确认。");
      const marker: TrustedAfterSnapshot = {
        targetId: candidate.contextId,
        snapshotId: String(verified.receipt.after_snapshot_id),
        stateHash: String(verified.receipt.after_state_hash),
        awaiting: true,
      };
      trustedAfterSnapshotRef.current = marker;
      let refreshed: EducationContract;
      try {
        refreshed = onReviewed
          ? await onReviewed({ receipt: verified.receipt, data: verified.data as unknown as EducationContract })
          : verified.data as unknown as EducationContract;
      } catch {
        trustedAfterSnapshotRef.current = null;
        throw new ReviewFailure("refresh", "已收到回执，刷新失败。");
      }
      if (trustedAfterSnapshotRef.current !== marker
        || !matchesTeacherContextRefresh(refreshed, {
          targetId: marker.targetId,
          afterSnapshotId: marker.snapshotId,
          afterStateHash: marker.stateHash,
        })) {
        trustedAfterSnapshotRef.current = null;
        throw new ReviewFailure("refresh", "已收到回执，刷新失败。");
      }
      marker.awaiting = false;
      setModifyOpen(false);
      setFeedback(decision === "accept" ? "已接受" : decision === "modify" ? "已修改" : decision === "reject" ? "已拒绝" : "已暂缓");
    } catch (reason) {
      const code = reviewFailureCode(reason);
      setError(code === "stale"
        ? "内容已更新，请刷新。"
        : code === "invalid_receipt"
          ? "未收到可信回执，结果未确认。"
          : code === "refresh"
            ? "已收到回执，刷新失败。"
            : "提交失败，请重试。");
    } finally {
      setBusy(false);
      setBusyDecision(null);
    }
  }

  function submitModify() {
    try {
      const patch = buildContextPatch(draft, proposalValues);
      if (!patch) {
        setError("请至少修改一项。");
        return;
      }
      void submit("modify", patch);
    } catch {
      setError("提交失败，请重试。");
    }
  }

  function startDraft() {
    if (busy || !onAgentRequest) return;
    setDraft(currentValues);
    setModifyOpen(false);
    setChatDraftOpen(true);
    setFeedback(null);
    setError(null);
  }

  function submitDraft() {
    if (busy || !onAgentRequest) return;
    try {
      const prompt = buildTeacherContextPrompt(draft);
      onAgentRequest(prompt);
    } catch {
      setError("请至少填写一项。");
    }
  }

  async function saveManual() {
    if (busy) return;
    const values = buildContextPatch(draft, {});
    if (!values) { setError("请至少填写一项。"); return; }
    setBusy(true); setError(null); setFeedback(null);
    try {
      const response = await fetch("/api/edupi/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      const before = result.candidate as EducationTeacherContextCandidate;
      const verified = verifyTeacherContextReview(result, { targetId: before.contextId, expectedSnapshotId: before.snapshotId, expectedStateHash: before.stateHash, decision: "accept" });
      if (!verified.ok) throw new Error("未收到可信回执，保存未确认。");
      const marker: TrustedAfterSnapshot = {
        targetId: before.contextId,
        snapshotId: String(verified.receipt.after_snapshot_id),
        stateHash: String(verified.receipt.after_state_hash),
        awaiting: true,
      };
      trustedAfterSnapshotRef.current = marker;
      const data = verified.data as unknown as EducationContract;
      let refreshed: EducationContract;
      try {
        refreshed = onReviewed ? await onReviewed({ receipt: verified.receipt, data }) : data;
      } catch {
        trustedAfterSnapshotRef.current = null;
        throw new Error("已收到回执，刷新失败。");
      }
      if (trustedAfterSnapshotRef.current !== marker || !matchesTeacherContextRefresh(refreshed, { targetId: marker.targetId, afterSnapshotId: marker.snapshotId, afterStateHash: marker.stateHash })) {
        trustedAfterSnapshotRef.current = null;
        throw new Error("已收到回执，刷新失败。");
      }
      marker.awaiting = false;
      setManualOpen(false);
      setFeedback("已保存");
      window.dispatchEvent(new Event("edupi-preparation-updated"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存未确认，请重试。");
      window.dispatchEvent(new Event("edupi-preparation-updated"));
    } finally { setBusy(false); }
  }

  async function restoreField(version: TeacherContextVersion, side: TeacherContextVersionSide, fieldKey: TeacherContextVersionField, trigger: HTMLButtonElement) {
    if (busy || !candidate || !capability?.enabled || candidate.sourceIds.length !== 1) return;
    restoreFocusTargetRef.current = trigger;
    setBusy(true);
    try {
      if (isActionable(candidate) && !(await confirmTeacherContextFieldRestore())) return;
      setRestoringField(`${version.versionId}:${side}:${fieldKey}`);
      setFieldHistoryError(null);
      const response = await fetch("/api/edupi/onboarding/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetId: candidate.contextId,
          versionId: version.versionId,
          versionSide: side,
          fieldKey,
          expectedSnapshotId: candidate.snapshotId,
          expectedRevision: candidate.revision,
          expectedSourceId: candidate.sourceIds[0],
        }),
      });
      const result = await response.json() as { receipt?: Record<string, unknown> | null; data?: EducationContract; error?: string; reconciled?: boolean };
      if (!response.ok || !result.data) throw new Error(result.error || "字段恢复失败");
      if (onReviewed) await onReviewed({ receipt: result.receipt || { reconciled: result.reconciled === true }, data: result.data });
      setFieldVersions(null);
      setFeedback(`已恢复${TEACHER_CONTEXT_FIELDS.find((field) => field.key === fieldKey)?.label || fieldKey}`);
      window.dispatchEvent(new Event("edupi-preparation-updated"));
    } catch (reason) {
      setFieldHistoryError(reason instanceof Error ? reason.message : "字段恢复失败");
    } finally {
      setRestoringField(null);
      setBusy(false);
      setRestoreFocusRequest((value) => value + 1);
    }
  }

  const status = contextStatusLabel(candidate, capability, currentValues);
  const actionable = isActionable(candidate);
  const proposalHeading = actionable ? "待确认更新"
    : (candidate?.status || candidate?.teacherReview.state) === "rejected" && Object.keys(proposalValues).length > 0 ? "已拒绝更新" : null;
  const canReview = Boolean(candidate && capability?.enabled && actionable);
  const contextReady = Object.keys(currentValues).length > 0;
  const formMode = manualOpen ? "manual" : modifyOpen && canReview ? "modify" : chatDraftOpen ? "draft" : null;

  useEffect(() => {
    const previousForm = focusedFormRef.current;
    const editor = editorRef.current;
    if (formMode) {
      focusedFormRef.current = formMode;
      if (previousForm === formMode || busy || !editor?.isConnected) return;
      const input = formRef.current?.querySelector<HTMLInputElement>("input:not([disabled])");
      if (input?.isConnected && editor.contains(input)) input.focus({ preventScroll: false });
      return;
    }
    if (!previousForm || busy) return;
    focusedFormRef.current = null;
    if (!editor?.isConnected) return;
    const entry = previousForm === "manual" ? manualEntryRef.current : previousForm === "modify" ? modifyEntryRef.current : draftEntryRef.current;
    const manualEntry = manualEntryRef.current;
    const target = [entry?.disabled ? null : entry, manualEntry?.disabled ? null : manualEntry, headingRef.current]
      .find((element) => element?.isConnected && editor.contains(element));
    target?.focus({ preventScroll: false });
  }, [busy, formMode]);

  return (
    <section ref={editorRef} className="edupi-context-editor" aria-label="教师上下文属性" aria-busy={busy || undefined} onKeyDown={handleKeyDown}>
      <header className="edupi-context-editor__header">
        <div>
          <h2 id="edupi-context-editor-title" ref={headingRef} tabIndex={-1}>教师上下文</h2>
          {candidate ? <div className="edupi-context-editor__meta">教师资料 · {candidate.evidenceIds.length} 条证据 · 不外发</div> : null}
        </div>
        <span className={`edupi-context-editor__status is-${candidate?.status || candidate?.teacherReview.state || (contextReady ? "accepted" : "unconfigured")}`}>{status}</span>
      </header>

      <div className="edupi-context-editor__table-wrap">
        <table className="edupi-context-editor__table">
          <caption className="edupi-visually-hidden">教师上下文当前生效值{proposalHeading ? `与${proposalHeading}` : ""}</caption>
          <thead><tr><th scope="col">字段</th><th scope="col">当前生效</th>{proposalHeading ? <th scope="col">{proposalHeading}</th> : null}</tr></thead>
          <tbody>{TEACHER_CONTEXT_FIELDS.map((field) => {
            const current = currentValues[field.key];
            const proposal = proposalValues[field.key];
            const isChanged = changed(current, proposal);
            return <tr key={field.key}>
              <th scope="row">{field.label}</th>
              <td>{current || <span className="edupi-context-editor__empty">未设置</span>}</td>
              {proposalHeading ? <td>{proposal ? <span className={isChanged ? "edupi-context-editor__proposal is-changed" : "edupi-context-editor__proposal"}>{proposal}{isChanged ? <small>已变更</small> : null}</span> : <span className="edupi-context-editor__empty">—</span>}</td> : null}
            </tr>;
          })}</tbody>
        </table>
      </div>

      {!manualOpen && !modifyOpen && !chatDraftOpen ? <div className="edupi-context-editor__actions" role="group" aria-label="教师资料操作">
        {!manualOpen && !modifyOpen && !chatDraftOpen ? <button ref={manualEntryRef} type="button" className="edupi-entry-secondary" disabled={busy} onClick={() => { setDraft(currentValues); setManualOpen(true); setError(null); }}>手动填写</button> : null}
        {!manualOpen && canReview && !modifyOpen && !chatDraftOpen ? <>
          <button type="button" className="edupi-entry-primary" disabled={busy} onClick={() => void submit("accept", null)}>{busy && busyDecision === "accept" ? BUSY_LABELS.accept : ACTION_LABELS.accept}</button>
          <button ref={modifyEntryRef} type="button" className="edupi-entry-secondary" disabled={busy} onClick={() => { setChatDraftOpen(false); setDraft(proposalValues); setModifyOpen(true); }}>{ACTION_LABELS.modify}</button>
          <button type="button" className="edupi-entry-secondary" disabled={busy} onClick={() => void submit("hold", null)}>{busy && busyDecision === "hold" ? BUSY_LABELS.hold : ACTION_LABELS.hold}</button>
          <button type="button" className="edupi-entry-danger" disabled={busy} onClick={() => void submit("reject", null)}>{busy && busyDecision === "reject" ? BUSY_LABELS.reject : ACTION_LABELS.reject}</button>
        </> : !manualOpen && !modifyOpen && !chatDraftOpen && onAgentRequest ? <button ref={draftEntryRef} type="button" className="edupi-entry-secondary" disabled={busy} onClick={startDraft}>起草更新</button> : null}
      </div> : null}

      {modifyOpen && canReview ? <div ref={formRef} className="edupi-context-editor__modify" aria-label="修改待确认更新">
        <div className="edupi-context-editor__modify-heading"><strong>修改待确认更新</strong><span>只提交非空且有变化的字段</span></div>
        <div className="edupi-context-editor__fields">{TEACHER_CONTEXT_FIELDS.map((field) => <label key={field.key}>{field.label}<input maxLength={120} disabled={busy} value={draft[field.key] || ""} onChange={(event) => updateDraft(field.key, event.target.value)} /></label>)}</div>
        <div className="edupi-context-editor__modify-actions"><button type="button" className="edupi-entry-secondary" disabled={busy} onClick={() => { setModifyOpen(false); setError(null); }}>取消</button><button type="button" className="edupi-entry-primary" disabled={busy} onClick={submitModify}>{busy && busyDecision === "modify" ? BUSY_LABELS.modify : "提交修改"}</button></div>
      </div> : null}

      {chatDraftOpen ? <div ref={formRef} className="edupi-context-editor__modify" aria-label="起草教师上下文更新">
        <div className="edupi-context-editor__modify-heading"><strong>起草更新</strong><span>字段作参考，要求由你填写</span></div>
        <div className="edupi-context-editor__fields">{TEACHER_CONTEXT_FIELDS.map((field) => <label key={field.key}>{field.label}<input maxLength={120} disabled={busy} value={draft[field.key] || ""} onChange={(event) => updateDraft(field.key, event.target.value)} /></label>)}</div>
        <div className="edupi-context-editor__modify-actions"><button type="button" className="edupi-entry-secondary" disabled={busy} onClick={() => { setChatDraftOpen(false); setError(null); }}>取消</button><button type="button" className="edupi-entry-primary" disabled={busy || !onAgentRequest} onClick={submitDraft}>放入对话</button></div>
      </div> : null}

      {manualOpen ? <div ref={formRef} className="edupi-context-editor__modify" aria-label="手动填写教师资料">
        <div className="edupi-context-editor__fields">{TEACHER_CONTEXT_FIELDS.map((field) => <label key={field.key}>{field.label}<input maxLength={120} disabled={busy} value={draft[field.key] || ""} onChange={(event) => updateDraft(field.key, event.target.value)} /></label>)}</div>
        <div className="edupi-context-editor__modify-actions"><button type="button" className="edupi-entry-secondary" disabled={busy} onClick={() => { setManualOpen(false); setError(null); }}>取消</button><button type="button" className="edupi-entry-primary" disabled={busy} onClick={() => void saveManual()}>{busy ? "保存中…" : "保存"}</button></div>
      </div> : null}

      {feedback ? <div className="edupi-context-editor__feedback" role="status" aria-live="polite">{feedback}</div> : null}
      {error ? <div className="edupi-context-editor__error" role="alert">{error}</div> : null}

      <details className="edupi-context-editor__history" onToggle={(event) => setFieldHistoryOpen(event.currentTarget.open)}>
        <summary ref={fieldHistorySummaryRef} tabIndex={0}>字段历史 <span>{fieldVersions?.length ?? ""}</span></summary>
        {fieldHistoryError ? <p className="edupi-context-editor__history-error" role="alert">{fieldHistoryError}</p> : null}
        {fieldVersions === null ? fieldHistoryError ? null : <p className="edupi-context-editor__history-state">正在读取…</p> : fieldVersions.length === 0 ? <p className="edupi-context-editor__history-state">暂无字段版本</p> : <ol>{fieldVersions.slice().reverse().map((version) => <li key={version.versionId}>
          <div className="edupi-context-editor__version-heading"><strong>版本 {version.revision}</strong><time>{new Date(version.reviewedAt).toLocaleString("zh-CN")}</time></div>
          <table className="edupi-context-editor__version-fields" aria-label={`版本 ${version.revision} 的字段变化`}>
            <thead><tr><th scope="col">字段</th><th scope="col">原值</th><th scope="col">改为</th></tr></thead>
            <tbody>{version.changedFields.map((fieldKey) => {
              const label = TEACHER_CONTEXT_FIELDS.find((field) => field.key === fieldKey)?.label || fieldKey;
              const before = version.beforeValues[fieldKey] ?? null;
              const after = version.afterValues[fieldKey] ?? null;
              const current = currentValues[fieldKey] ?? null;
              const disabled = busy || manualOpen || modifyOpen || chatDraftOpen || !candidate || !capability?.enabled || candidate.sourceIds.length !== 1;
              const valueButton = (side: TeacherContextVersionSide, value: string | null) => current === value
                ? <span className="edupi-context-editor__current-value"><span>{value || "未设置"}</span><small>当前</small></span>
                : <button type="button" className="edupi-context-editor__restore-value" disabled={disabled} aria-label={`恢复${label}为${value || "未设置"}`} onClick={(event) => void restoreField(version, side, fieldKey, event.currentTarget)}>{restoringField === `${version.versionId}:${side}:${fieldKey}` ? <span>恢复中…</span> : <><span>{value || "未设置"}</span><small>恢复</small></>}</button>;
              return <tr key={`${version.versionId}:${fieldKey}`}><th scope="row">{label}</th><td>{valueButton("before", before)}</td><td>{valueButton("after", after)}</td></tr>;
            })}</tbody>
          </table>
          {version.note ? <p>{version.note}</p> : null}
        </li>)}</ol>}
      </details>

      {history.length ? <details className="edupi-context-editor__history"><summary tabIndex={0}>操作历史 <span>{history.length}</span></summary><ol>{history.slice(-10).reverse().map((item) => <li key={item.reviewId}><div className="edupi-context-editor__version-heading"><strong>{ACTION_LABELS[item.decision as TeacherContextReviewDecision] || item.decision}</strong><span>{REVIEW_STATUS_LABELS[item.status] || item.status}</span><time>{item.reviewedAt ? new Date(item.reviewedAt).toLocaleString("zh-CN") : "时间未记录"}</time></div>{item.teacherReview.note ? <p>{item.teacherReview.note}</p> : null}</li>)}</ol></details> : null}

      {!contextReady && !candidate ? <span className="edupi-visually-hidden">尚未配置教师上下文</span> : null}
    </section>
  );
}
