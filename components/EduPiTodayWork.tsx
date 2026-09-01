"use client";

import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import type {
  EducationContract,
  EducationWorkCase,
  EducationWorkCandidate,
  EducationWorkCandidateDecision,
  WorkCandidateReviewCapability,
} from "@/lib/edupi-education-contract";
import {
  getTodayWorkMutationSnapshot,
  isTodayWorkEditorCurrent,
  subscribeTodayWorkMutation,
  submitTodayWorkReview,
  todayWorkErrorMessage,
  todayWorkFailureDisposition,
  TodayWorkReviewError,
} from "@/lib/edupi-today-work";
import { groupWorkCandidates, workCandidateReasonLabel, type WorkCandidateGroups } from "@/lib/edupi-workbench";
import { activeLivingWorkCases, workCaseStateLabel } from "@/lib/edupi-work-case";

type Props = {
  data: EducationContract;
  onEducation: (data: EducationContract) => void;
  onWorkCaseDetail: (workCase: EducationWorkCase) => void;
};

type EditorMode = "modify" | "snooze" | "suppress";

type EditorState = {
  candidateId: string;
  snapshotId: string;
  revision: number;
  mode: EditorMode;
  title: string;
  summary: string;
  dueAt: string;
  snoozeUntil: string;
  suppressionScope: "this_candidate" | "matching_reason" | "next_cycle";
  note: string;
};

type Feedback = { kind: "success" | "error"; text: string } | null;

const STATUS_LABELS: Record<EducationWorkCandidate["status"], string> = {
  pending_review: "待判断",
  held: "已暂缓",
  snoozed: "已安排稍后",
  accepted: "已接受",
  modified: "已调整",
  rejected: "已拒绝",
  suppressed: "已停止提示",
};

const DECISION_LABELS: Record<EducationWorkCandidateDecision, string> = {
  accept: "已接受",
  modify: "已调整",
  reject: "已拒绝",
  hold: "已暂缓",
  snooze: "已安排稍后",
  suppress: "已停止提示",
};

const GROUP_LABELS: Record<keyof WorkCandidateGroups, string> = {
  now: "现在",
  later: "稍后",
  done: "已完成",
};

const SUPPRESSION_SCOPE_LABELS = {
  this_candidate: "只停止这条",
  matching_reason: "停止同类原因",
  next_cycle: "本轮停止",
} as const;

const NEXT_CYCLE_LABELS: Record<string, string> = {
  awaiting_teacher: "等待教师判断",
  closed_accepted: "已接受",
  closed_modified: "已调整",
  closed_rejected: "已拒绝",
  held: "已暂缓",
  snoozed: "已安排稍后",
  suppressed_this_candidate: "停止这条提示",
  suppressed_matching_reason: "停止同类提示",
  suppressed_next_cycle: "本轮停止提示",
  reopened_source_changed: "来源更新，待重审",
  reopened_snooze_expired: "稍后到期，待重审",
};

function isDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function localIsoDate(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function tomorrow(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return localIsoDate(date);
}

function readableDate(value: string | null): string {
  if (!value) return "日期待确认";
  return value;
}

function actionSuccess(decision: EducationWorkCandidateDecision, receiptId: string): string {
  return `✓ ${DECISION_LABELS[decision]} · 回执 ${receiptId}`;
}

function candidateMeta(candidate: EducationWorkCandidate): string {
  if (candidate.status === "snoozed") return `稍后 ${readableDate(candidate.snoozeUntil)}`;
  if (candidate.status === "pending_review") return `截止 ${readableDate(candidate.dueAt)}`;
  return candidate.dueAt ? `截止 ${candidate.dueAt}` : "日期待确认";
}

function startEditor(candidate: EducationWorkCandidate, mode: EditorMode): EditorState {
  return {
    candidateId: candidate.candidateId,
    snapshotId: candidate.snapshotId,
    revision: candidate.revision,
    mode,
    title: candidate.title,
    summary: candidate.summary,
    dueAt: candidate.dueAt || "",
    snoozeUntil: tomorrow(),
    suppressionScope: "this_candidate",
    note: "",
  };
}

function capabilityCopy(capability: WorkCandidateReviewCapability): string | null {
  return capability.enabled ? null : "当前仅可查看，待办审核暂不可用。";
}

export function EduPiTodayWork({ data, onEducation, onWorkCaseDetail }: Props) {
  const groups = groupWorkCandidates(data.workCandidates);
  const livingCases = activeLivingWorkCases(data.workCases);
  const capability = data.capabilities.workCandidateReview;
  const busy = useSyncExternalStore(subscribeTodayWorkMutation, getTodayWorkMutationSnapshot, getTodayWorkMutationSnapshot);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const editorCurrent = isTodayWorkEditorCurrent(editor, data.workCandidates, capability.enabled);

  useEffect(() => {
    if (editor && !editorCurrent) {
      setEditor(null);
      setFeedback({ kind: "error", text: "内容已更新，请重新打开后确认。" });
    }
  }, [editor, editorCurrent]);

  const review = async (
    candidate: EducationWorkCandidate,
    decision: EducationWorkCandidateDecision,
    patch?: Record<string, unknown>,
    note?: string,
  ) => {
    if (busy || !capability.enabled) return;
    setFeedback(null);
    try {
      const result = await submitTodayWorkReview({ candidate, decision, patch, note });
      onEducation(result.data);
      setEditor(null);
      setFeedback({ kind: "success", text: actionSuccess(decision, result.receiptId) });
    } catch (error) {
      if (error instanceof TodayWorkReviewError) {
        if (error.data) onEducation(error.data);
        if (todayWorkFailureDisposition(error.code) === "close") setEditor(null);
        setFeedback({ kind: "error", text: todayWorkErrorMessage(error.code) });
      } else setFeedback({ kind: "error", text: todayWorkErrorMessage("malformed") });
    }
  };

  const openEditor = (candidate: EducationWorkCandidate, mode: EditorMode) => {
    setFeedback(null);
    setEditor(startEditor(candidate, mode));
  };

  const cancelEditor = () => {
    setEditor(null);
    setFeedback(null);
  };

  const submitModify = async (candidate: EducationWorkCandidate) => {
    if (!editor || !editorCurrent || editor.candidateId !== candidate.candidateId) return;
    const title = editor.title.trim();
    const summary = editor.summary.trim();
    if (!title || !summary) {
      setFeedback({ kind: "error", text: "标题和说明不能为空。" });
      return;
    }
    const patch: Record<string, unknown> = {};
    if (title !== candidate.title) patch.title = title;
    if (summary !== candidate.summary) patch.summary = summary;
    if (editor.dueAt !== (candidate.dueAt || "")) patch.dueAt = editor.dueAt ? editor.dueAt : null;
    if (Object.keys(patch).length === 0) {
      setFeedback({ kind: "error", text: "请至少调整一项内容。" });
      return;
    }
    if (Object.hasOwn(patch, "dueAt") && patch.dueAt !== null && !isDateOnly(String(patch.dueAt))) {
      setFeedback({ kind: "error", text: "截止日期格式无效。" });
      return;
    }
    await review(candidate, "modify", patch);
  };

  const submitSnooze = async (candidate: EducationWorkCandidate) => {
    if (!editor || !editorCurrent || editor.candidateId !== candidate.candidateId || !isDateOnly(editor.snoozeUntil) || editor.snoozeUntil <= localIsoDate()) {
      setFeedback({ kind: "error", text: "请选择晚于今天的日期。" });
      return;
    }
    await review(candidate, "snooze", { snoozeUntil: editor.snoozeUntil });
  };

  const submitSuppress = async (candidate: EducationWorkCandidate) => {
    if (!editor || !editorCurrent || editor.candidateId !== candidate.candidateId || !editor.note.trim()) {
      setFeedback({ kind: "error", text: "请填写停止提示的原因。" });
      return;
    }
    await review(candidate, "suppress", { suppressionScope: editor.suppressionScope }, editor.note.trim());
  };

  const renderEditor = (candidate: EducationWorkCandidate) => {
    if (!editor || !editorCurrent || editor.candidateId !== candidate.candidateId) return null;
    if (editor.mode === "modify") {
      return <form className="edupi-today-work__editor" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void submitModify(candidate); }}>
        <div className="edupi-today-work__field"><label htmlFor="edupi-today-work-edit-title">标题</label><input id="edupi-today-work-edit-title" value={editor.title} maxLength={240} disabled={busy} onChange={(event) => setEditor({ ...editor, title: event.target.value })} /></div>
        <div className="edupi-today-work__field"><label htmlFor="edupi-today-work-edit-summary">说明</label><textarea id="edupi-today-work-edit-summary" value={editor.summary} maxLength={2000} rows={2} disabled={busy} onChange={(event) => setEditor({ ...editor, summary: event.target.value })} /></div>
        <div className="edupi-today-work__field"><label htmlFor="edupi-today-work-edit-due">截止日期</label><input id="edupi-today-work-edit-due" type="date" value={editor.dueAt} disabled={busy} onChange={(event) => setEditor({ ...editor, dueAt: event.target.value })} /></div>
        <div className="edupi-today-work__editor-actions"><button type="submit" className="is-primary" disabled={busy}>{busy ? "正在调整…" : "保存调整"}</button><button type="button" disabled={busy} onClick={cancelEditor}>取消</button></div>
      </form>;
    }
    if (editor.mode === "snooze") {
      return <form className="edupi-today-work__editor" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void submitSnooze(candidate); }}>
        <div className="edupi-today-work__field"><label htmlFor="edupi-today-work-snooze-until">稍后日期</label><input id="edupi-today-work-snooze-until" type="date" value={editor.snoozeUntil} min={tomorrow()} disabled={busy} onChange={(event) => setEditor({ ...editor, snoozeUntil: event.target.value })} /></div>
        <div className="edupi-today-work__editor-actions"><button type="submit" className="is-primary" disabled={busy}>{busy ? "正在安排…" : "安排稍后"}</button><button type="button" disabled={busy} onClick={cancelEditor}>取消</button></div>
      </form>;
    }
    return <form className="edupi-today-work__editor" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void submitSuppress(candidate); }}>
      <div className="edupi-today-work__field"><label htmlFor="edupi-today-work-suppression-scope">停止范围</label><select id="edupi-today-work-suppression-scope" value={editor.suppressionScope} disabled={busy} onChange={(event) => setEditor({ ...editor, suppressionScope: event.target.value as EditorState["suppressionScope"] })}>{Object.entries(SUPPRESSION_SCOPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      <div className="edupi-today-work__field"><label htmlFor="edupi-today-work-suppression-note">原因</label><textarea id="edupi-today-work-suppression-note" value={editor.note} maxLength={1000} rows={2} disabled={busy} onChange={(event) => setEditor({ ...editor, note: event.target.value })} /></div>
      <div className="edupi-today-work__editor-actions"><button type="submit" className="is-danger" disabled={busy}>{busy ? "正在停止…" : "停止提示"}</button><button type="button" disabled={busy} onClick={cancelEditor}>取消</button></div>
    </form>;
  };

  const renderCandidate = (candidate: EducationWorkCandidate, actionable: boolean) => {
    const isEditing = editorCurrent && editor?.candidateId === candidate.candidateId;
    return <article className={`edupi-today-work__item is-${candidate.status}`} key={candidate.candidateId}>
      <header className="edupi-today-work__item-header"><div><span>{candidateMeta(candidate)}</span><h4>{candidate.title}</h4></div><strong className={`edupi-today-work__status is-${candidate.status}`}>{STATUS_LABELS[candidate.status]}</strong></header>
      <p className="edupi-today-work__summary">{candidate.summary}</p>
      <div className="edupi-today-work__reason"><span>原因</span>{workCandidateReasonLabel(candidate.reason)}</div>
      <details className="edupi-today-work__details"><summary>来源与依据</summary><dl><div><dt>来源</dt><dd>{candidate.sourceIds.join("、")}</dd></div><div><dt>依据</dt><dd>{candidate.evidenceIds.join("、")}</dd></div><div><dt>下一步</dt><dd>{NEXT_CYCLE_LABELS[candidate.nextCycleState] || candidate.nextCycleState}</dd></div><div><dt>候选 ID</dt><dd>{candidate.candidateId}</dd></div></dl></details>
      {actionable && capability.enabled ? <div className="edupi-today-work__actions">
        <button type="button" className="is-primary" disabled={busy} onClick={() => void review(candidate, "accept")}>接受</button>
        <button type="button" disabled={busy} onClick={() => isEditing && editor?.mode === "modify" ? cancelEditor() : openEditor(candidate, "modify")}>{isEditing && editor?.mode === "modify" ? "收起调整" : "调整"}</button>
        <button type="button" disabled={busy} onClick={() => void review(candidate, "hold")}>暂缓</button>
        <button type="button" disabled={busy} onClick={() => isEditing && editor?.mode === "snooze" ? cancelEditor() : openEditor(candidate, "snooze")}>稍后</button>
        <button type="button" disabled={busy} onClick={() => isEditing && editor?.mode === "suppress" ? cancelEditor() : openEditor(candidate, "suppress")}>停止提示</button>
        <button type="button" className="is-danger" disabled={busy} onClick={() => void review(candidate, "reject")}>拒绝</button>
      </div> : null}
      {isEditing ? renderEditor(candidate) : null}
    </article>;
  };

  const renderGroup = (group: keyof WorkCandidateGroups) => {
    const candidates = groups[group];
    return <section className={`edupi-today-work__group is-${group}`} aria-labelledby={`edupi-today-work-${group}`} key={group}>
      <header><h3 id={`edupi-today-work-${group}`}>{GROUP_LABELS[group]}</h3><span>{candidates.length} 项</span></header>
      <div className="edupi-today-work__items">{candidates.map((candidate) => renderCandidate(candidate, group === "now" || group === "later"))}</div>
      {candidates.length === 0 ? <p className="edupi-today-work__empty">这里暂时没有事项</p> : null}
    </section>;
  };

  const unavailableCopy = capabilityCopy(capability);
  return <section className="edupi-today-work" aria-labelledby="edupi-today-work-title" aria-busy={busy}>
    <header className="edupi-today-work__header"><div><span>教师工作</span><h2 id="edupi-today-work-title">今天要判断</h2></div><span>{data.workCandidates.length} 项 · 教师内部</span></header>
    {livingCases.length > 0 ? <div className="edupi-today-flow" aria-label="EduPi 当前工作流"><header><span>EduPi 流</span><strong>{livingCases.length} 项</strong></header><div>{livingCases.slice(0, 4).map((workCase) => <button type="button" key={workCase.id} onClick={() => onWorkCaseDetail(workCase)}><i className={`edupi-flow-state is-${workCase.currentState}`} aria-hidden="true" /><span><strong>{workCase.title}</strong><small>{workCaseStateLabel(workCase.currentState)}{workCase.dueDate ? ` · ${workCase.dueDate}` : ""}</small></span><em aria-hidden="true">›</em></button>)}</div></div> : null}
    {unavailableCopy ? <p className="edupi-today-work__notice">{unavailableCopy}</p> : null}
    {feedback ? <p className={`edupi-today-work__feedback is-${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"} aria-live="polite">{feedback.text}</p> : null}
    <div className="edupi-today-work__groups">{(["now", "later", "done"] as const).map(renderGroup)}</div>
  </section>;
}
