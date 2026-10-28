"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import type {
  EducationContract,
  EducationWorkCandidate,
  EducationWorkCandidateDecision,
  TeacherTask,
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
import { summarizeL4Preparation, type L4PreparationSummaryItem } from "@/lib/edupi-l4-preparation";
import { groupWorkCandidates, workCandidateReasonLabel, type WorkCandidateGroups } from "@/lib/edupi-workbench";
import { todayActiveTasks } from "@/lib/edupi-work-case";
import { canRetryFeedbackEligibility, prepareTeacherFeedbackCapture, recordTeacherFeedback, TeacherFeedbackError, type TeacherFeedbackCapture, type TeacherFeedbackDecision, type TeacherFeedbackUsefulness } from "@/lib/edupi-teacher-feedback";
import { isTauriDesktop } from "@/lib/desktop-updater";
import { isCandidateForeground, isForegroundDate, isTaskForeground, shanghaiDate } from "@/lib/edupi-foreground";
import { EduPiListPreview, EduPiPagedRows, useEduPiForegroundPolicy } from "./EduPiForeground";
import { taskDisplayTitle } from "@/lib/edupi-workbench";
import { taskBoardLane } from "@/lib/edupi-task-board";
import type { CalendarItemSelection } from "@/lib/edupi-calendar-model";
import { observeTeacherUsage } from "@/lib/edupi-usage-observation";
import { EduPiUsageArticle, EduPiUsageVisibility } from "./EduPiUsageObservation";

type Props = {
  data: EducationContract;
  onEducation: (data: EducationContract) => void;
  onTaskDetail: (task: TeacherTask) => void;
  selectedObjectId?: string | null;
  onObject?: (id: string) => void;
  onCalendarSelection?: (selection: CalendarItemSelection) => void;
};

type EditorMode = "modify" | "snooze" | "suppress";

type EditorState = {
  workspace: object;
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

type Feedback = { kind: "success" | "error"; text: string; action?: "refresh" } | null;
type ReviewRetry = {
  candidate: EducationWorkCandidate;
  decision: EducationWorkCandidateDecision;
  patch?: Record<string, unknown>;
  note?: string;
};
type Submission = { workspace: object; candidateId: string; decision: EducationWorkCandidateDecision } | null;
type RatedUsefulness = Exclude<TeacherFeedbackUsefulness, "not_observed">;
type PendingFeedback = { candidate: EducationWorkCandidate; task: TeacherTask; decision: EducationWorkCandidateDecision; note?: string };
export type TeacherValueAssessment = { used: boolean; wouldUseAgain: boolean | null; baselineMinutes: number | null; reviewMinutes: number | null; note: string | null };
export type TeacherValueDraft = { usefulness: RatedUsefulness | ""; used: boolean; wouldUseAgain: "" | "yes" | "no"; baselineMinutes: string; reviewMinutes: string; note: string };

const EMPTY_TEACHER_VALUE: TeacherValueDraft = { usefulness: "", used: false, wouldUseAgain: "", baselineMinutes: "", reviewMinutes: "", note: "" };

const USEFULNESS_OPTIONS: Array<{ value: RatedUsefulness; label: string }> = [
  { value: "very_useful", label: "非常有帮助" },
  { value: "useful", label: "有帮助" },
  { value: "partial", label: "部分有帮助" },
  { value: "not_useful", label: "无帮助" },
  { value: "incorrect", label: "内容有误" },
  { value: "unsafe", label: "不安全" },
];

function feedbackDecision(decision: EducationWorkCandidateDecision): TeacherFeedbackDecision {
  if (decision === "suppress") return "withdraw";
  if (decision === "snooze") return "hold";
  return decision;
}

export function feedbackCaptureFor(candidate: EducationWorkCandidate, task: TeacherTask | null, decision: EducationWorkCandidateDecision, usefulness: RatedUsefulness, note?: string, occurredAt = new Date().toISOString(), assessment?: TeacherValueAssessment): TeacherFeedbackCapture | null {
  if (task?.trigger !== "teaching_before_class" || candidate.evidenceIds.length === 0 && candidate.sourceIds.length === 0) return null;
  return {
    commandId: `desktop-feedback-${globalThis.crypto.randomUUID()}`,
    sessionId: "desktop-today",
    domain: "teaching_preparation",
    scope: null,
    target: { kind: "work_candidate", targetId: candidate.candidateId },
    reviewedRevision: candidate.revision,
    decision: feedbackDecision(decision),
    usefulness,
    used: assessment?.used === true && (decision === "accept" || decision === "modify"),
    wouldUseAgain: assessment?.wouldUseAgain ?? null,
    baselineMinutes: assessment?.baselineMinutes ?? null,
    reviewMinutes: assessment?.reviewMinutes ?? null,
    issueCodes: usefulness === "unsafe" ? ["safety"] : usefulness === "incorrect" ? ["incorrect_content"] : [],
    note: assessment?.note || note || null,
    evidenceIds: candidate.evidenceIds.length > 0 ? candidate.evidenceIds : candidate.sourceIds,
    occurredAt,
  };
}

export function EduPiTeacherValueForm({ draft, allowUsed, busy, onChange, onSubmit, onCancel }: {
  draft: TeacherValueDraft;
  allowUsed: boolean;
  busy: boolean;
  onChange: (next: TeacherValueDraft) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return <form className="edupi-today-work__rating" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
    <label><span>有用性</span><select aria-label="有用性" value={draft.usefulness} disabled={busy} onChange={(event) => onChange({ ...draft, usefulness: event.target.value as TeacherValueDraft["usefulness"] })}>
      <option value="">选择评价</option>
      {USEFULNESS_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
    </select></label>
    {allowUsed ? <label className="is-check"><input type="checkbox" checked={draft.used} disabled={busy} onChange={(event) => onChange({ ...draft, used: event.target.checked })} /><span>实际使用</span></label> : null}
    <label><span>下次会再用</span><select aria-label="下次会再用" value={draft.wouldUseAgain} disabled={busy} onChange={(event) => onChange({ ...draft, wouldUseAgain: event.target.value as TeacherValueDraft["wouldUseAgain"] })}><option value="">未填写</option><option value="yes">会</option><option value="no">不会</option></select></label>
    <div className="edupi-today-work__rating-times">
      <label><span>原来预计分钟</span><input type="number" min="1" max="1440" step="1" inputMode="numeric" value={draft.baselineMinutes} disabled={busy} onChange={(event) => onChange({ ...draft, baselineMinutes: event.target.value })} /></label>
      <label><span>本次投入分钟</span><input type="number" min="1" max="1440" step="1" inputMode="numeric" value={draft.reviewMinutes} disabled={busy} onChange={(event) => onChange({ ...draft, reviewMinutes: event.target.value })} /></label>
    </div>
    <label className="is-wide"><span>补充说明</span><textarea rows={2} maxLength={2000} value={draft.note} disabled={busy} onChange={(event) => onChange({ ...draft, note: event.target.value })} /></label>
    <div className="edupi-today-work__rating-actions"><button type="submit" disabled={!draft.usefulness || busy}>{busy ? "记录中…" : "记录评价"}</button><button type="button" disabled={busy} onClick={onCancel}>取消</button></div>
  </form>;
}

export function teacherFeedbackRetryMessage(error: unknown, retrying = false): string {
  if (error instanceof TeacherFeedbackError && error.code === "owner_control_credential_unavailable") {
    return "授权状态需要恢复；本次评价尚未写入，可在恢复后重试。";
  }
  return retrying ? "反馈记录仍未成功，请稍后重试。" : "决定已记录；评价未能记录，请重试。";
}

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

const DECISION_EFFECTS: Record<EducationWorkCandidateDecision, string> = {
  accept: "移到“已记录”，关闭本次待判断。",
  modify: "按新内容记录，并移到“已记录”。",
  reject: "关闭这条事项，并移到“已记录”。",
  hold: "移到“稍后处理”，保留待后续判断。",
  snooze: "移到“稍后处理”，到指定日期重新进入待你决定。",
  suppress: "按选择的范围停止提示，并移到“已记录”。",
};

const ACTION_TITLES: Record<EducationWorkCandidateDecision, string> = {
  accept: "接受：关闭本次待判断，移到已记录",
  modify: "调整：修改标题、说明或截止日期后记录",
  reject: "拒绝：关闭这条事项并保留拒绝记录",
  hold: "暂缓：移到稍后处理，之后可以继续判断",
  snooze: "稍后：选择日期，到期后重新进入待你决定",
  suppress: "停止提示：选择停止范围并填写原因",
};

const GROUP_LABELS: Record<keyof WorkCandidateGroups, string> = {
  now: "待你决定",
  later: "稍后处理",
  done: "已记录",
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

const L4_GROUP_LABELS: Array<{ key: "ready" | "running" | "attention"; title: string }> = [
  { key: "ready", title: "已准备好" },
  { key: "running", title: "自动进行" },
  { key: "attention", title: "需要判断" },
];

function isDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function localIsoDate(date = new Date()): string {
  return shanghaiDate(date)!;
}

function tomorrow(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return localIsoDate(date);
}

function readableDate(value: string | null): string {
  if (!value) return "日期待确认";
  if (isDateOnly(value)) return value.replaceAll("-", "/");
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "日期待确认" : new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}

function actionSuccess(decision: EducationWorkCandidateDecision): string {
  return `✓ ${DECISION_LABELS[decision]}：${DECISION_EFFECTS[decision]}`;
}

function submittingLabel(decision: EducationWorkCandidateDecision): string {
  return decision === "accept" ? "正在接受…"
    : decision === "hold" ? "正在暂缓…"
      : decision === "reject" ? "正在拒绝…"
        : "正在提交…";
}

function candidateMeta(candidate: EducationWorkCandidate): string {
  if (candidate.status === "snoozed") return `稍后 ${readableDate(candidate.snoozeUntil)}`;
  if (candidate.status === "pending_review") return `截止 ${readableDate(candidate.dueAt)}`;
  return candidate.dueAt ? `截止 ${readableDate(candidate.dueAt)}` : "日期待确认";
}

function startEditor(candidate: EducationWorkCandidate, mode: EditorMode, workspace: object): EditorState {
  return {
    workspace,
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

export function EduPiTodayWork({ data, onEducation, onTaskDetail, selectedObjectId, onObject, onCalendarSelection }: Props) {
  const policy = useEduPiForegroundPolicy();
  const groups = groupWorkCandidates(data.workCandidates, policy.today, { ...policy, ...data });
  const history = data.workCandidates.filter(candidate => !isCandidateForeground(candidate, policy, data));
  const candidateByTask = new Map(data.workCandidates.map(candidate => [candidate.taskId, candidate]));
  const historyTasks = data.tasks.filter(task => !isTaskForeground(task, policy, data) && (!task.id || !candidateByTask.has(task.id)));
  const staleHolidayTasks = data.tasks.filter(task => {
    const source = data.calendar.find(event => event.id && event.id === task.sourceEventId);
    const holiday = /festival|holiday/.test(task.trigger || "") || /festival|holiday/.test(String(task.evidence.source_event_type || source?.type || ""));
    return task.id && holiday && !policy.dismissedStaleTaskIds?.includes(task.id)
      && taskBoardLane(task, data.taskSessions[task.id], candidateByTask.get(task.id)) !== "done"
      && !isTaskForeground(task, policy, data);
  });
  const dismissStaleWork = () => policy.onDismissStaleTasks?.(staleHolidayTasks.map(task => task.id!));
  const [localList, setLocalList] = useState<string | null>(null);
  const listGroup = (selectedObjectId || localList || "").replace(/^today:list:/, "");
  const openList = (group: string) => onObject ? onObject(`today:list:${group}`) : setLocalList(`today:list:${group}`);
  const activeTasks = useMemo(() => todayActiveTasks(data, policy), [data, policy]);
  const taskById = useMemo(() => new Map(data.tasks.filter((task) => task.id).map((task) => [task.id!, task])), [data.tasks]);
  const capability = data.capabilities.workCandidateReview;
  const busy = useSyncExternalStore(subscribeTodayWorkMutation, getTodayWorkMutationSnapshot, getTodayWorkMutationSnapshot);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [changingDecisionId, setChangingDecisionId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [feedbackReady, setFeedbackReady] = useState(false);
  const [pendingFeedback, setPendingFeedback] = useState<PendingFeedback | null>(null);
  const [eligibilityRetry, setEligibilityRetry] = useState<PendingFeedback | null>(null);
  const [eligibilityBusy, setEligibilityBusy] = useState(false);
  const [ratingOpen, setRatingOpen] = useState(false);
  const [valueDraft, setValueDraft] = useState<TeacherValueDraft>(EMPTY_TEACHER_VALUE);
  const [feedbackRetry, setFeedbackRetry] = useState<TeacherFeedbackCapture | null>(null);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const feedbackReviewSequence = useRef(0);
  const [retryReview, setRetryReview] = useState<ReviewRetry | null>(null);
  const [submittedReview, setSubmission] = useState<Submission>(null);
  const workspace = useMemo(() => ({ root: data.workspace }), [data.workspace]);
  const workspaceRef = useRef<typeof workspace | null>(workspace);
  workspaceRef.current = workspace;
  const reviewGeneration = useRef(0);
  const currentReview = useRef<{ workspace: typeof workspace; generation: number } | null>(null);
  const submission = submittedReview?.workspace === workspace ? submittedReview : null;
  const rootRef = useRef<HTMLElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const actionLock = useRef(false);
  const scope = useMemo(() => ({ workspace: data.workspace, listGroup }), [data.workspace, listGroup]);
  const [focusGeneration, setFocusGeneration] = useState(0);
  const focusRequest = useRef<{
    scope: object; candidateId: string; target: "editor" | "action" | "result" | "retry";
    action?: string; group?: string; ready: boolean; stop: () => void;
  } | null>(null);
  const clearFocus = useCallback(() => { focusRequest.current?.stop(); focusRequest.current = null; }, []);
  useLayoutEffect(() => {
    workspaceRef.current = workspace;
    actionLock.current = false;
    currentReview.current = null;
    feedbackReviewSequence.current += 1;
    clearFocus();
    setEditor(null);
    setSubmission(null);
    setChangingDecisionId(null);
    setFeedback(null);
    setPendingFeedback(null);
    setEligibilityRetry(null);
    setEligibilityBusy(false);
    setRatingOpen(false);
    setValueDraft(EMPTY_TEACHER_VALUE);
    setFeedbackRetry(null);
    setFeedbackBusy(false);
    setRetryReview(null);
    return () => { if (workspaceRef.current === workspace) workspaceRef.current = null; };
  }, [workspace, clearFocus]);
  const candidateHeading = useCallback((id: string) => Array.from(rootRef.current?.querySelectorAll<HTMLElement>("[data-today-work-candidate]") ?? [])
    .find(element => element.dataset.todayWorkCandidate === id), []);
  const rememberFocus = (candidateId: string, target: NonNullable<typeof focusRequest.current>["target"], action?: string, ready = true) => {
    clearFocus();
    const root = rootRef.current, document = root?.ownerDocument;
    const card = candidateHeading(candidateId)?.closest("article");
    if (!root || !document || document.hidden || !card
      || !(card.contains(document.activeElement) || document.activeElement === document.body || document.activeElement === document.documentElement)) return null;
    const from = document.activeElement;
    const request: NonNullable<typeof focusRequest.current> = { scope, candidateId, target, action, ready, stop: () => {} };
    const moved = (event: Event) => {
      if (event.type === "focusin" && event.target !== from && event.target !== document.body && event.target !== document.documentElement
        || event.type === "pointerdown" && !card.contains(event.target as Node)) clearFocus();
    };
    const hidden = () => { if (document.hidden) clearFocus(); };
    document.addEventListener("focusin", moved);
    document.addEventListener("pointerdown", moved);
    document.addEventListener("visibilitychange", hidden);
    request.stop = () => { document.removeEventListener("focusin", moved); document.removeEventListener("pointerdown", moved); document.removeEventListener("visibilitychange", hidden); };
    focusRequest.current = request;
    return request;
  };
  useLayoutEffect(() => () => clearFocus(), [scope, clearFocus]);
  useLayoutEffect(() => {
    const request = focusRequest.current, root = rootRef.current;
    if (!request || !request.ready || busy || submission) return;
    if (request.scope !== scope || !root?.isConnected || root.ownerDocument.hidden || root.closest("[hidden], [inert]")) { clearFocus(); return; }
    const card = candidateHeading(request.candidateId)?.closest("article");
    const action = card?.querySelectorAll<HTMLButtonElement>("[data-today-work-action]");
    const target = request.target === "editor" ? formRef.current?.querySelector<HTMLElement>("[data-autofocus]")
      : request.target === "retry" && formRef.current ? formRef.current.querySelector<HTMLButtonElement>('button[type="submit"]')
        : request.target === "action" || request.target === "retry" ? Array.from(action ?? []).find(button => button.dataset.todayWorkAction === request.action)
          : card?.querySelector<HTMLElement>("[data-today-work-change]") ?? card?.querySelector<HTMLElement>("h4")
            ?? root.querySelector<HTMLElement>(`#edupi-today-work-${request.group}, h1`);
    clearFocus();
    if (target && !target.matches(":disabled") && target.isConnected) {
      if (/^H[1-6]$/.test(target.tagName)) target.tabIndex = -1;
      (request.target === "editor" ? formRef.current : target)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
      target.focus({ preventScroll: true });
    }
  }, [busy, submission, editor, data, scope, focusGeneration, clearFocus, candidateHeading]);
  const editorCurrent = editor?.workspace === workspace && isTodayWorkEditorCurrent(editor, data.workCandidates, capability.enabled);
  const l4Summary = useMemo(() => {
    if (!data.l4Preparation) return summarizeL4Preparation(null);
    const opportunities = data.l4Preparation.opportunities.filter(opportunity => {
      const work = data.workCases.find(item => item.id === opportunity.workCaseId);
      const task = work ? data.tasks.find(item => item.id === work.taskId) : null;
      return task ? isTaskForeground(task, policy, data) : isForegroundDate(shanghaiDate(opportunity.validUntil), policy);
    });
    return summarizeL4Preparation({ ...data.l4Preparation, opportunities });
  }, [data, policy]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/edupi/status?summary=1", { cache: "no-store", signal: controller.signal })
      .then(async (response) => response.ok ? await response.json() as { proactivity?: { teacherFeedback?: boolean } } : null)
      .then((value) => { if (!controller.signal.aborted) setFeedbackReady(isTauriDesktop() && value?.proactivity?.teacherFeedback === true); })
      .catch(() => { if (!controller.signal.aborted) setFeedbackReady(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (editor && editor.workspace === workspace && !editorCurrent) {
      setEditor(null);
      setFeedback({ kind: "error", text: "内容已更新，本次没有写入；请刷新待办后重新决定。", action: "refresh" });
    }
  }, [editor, editorCurrent, workspace]);

  const checkFeedbackEligibility = async (pending: PendingFeedback, sequence: number, retry = false) => {
    if (workspaceRef.current !== workspace) return;
    const capture = feedbackCaptureFor(pending.candidate, pending.task, pending.decision, "useful");
    if (!capture) return;
    try {
      await prepareTeacherFeedbackCapture(capture);
      if (workspaceRef.current !== workspace || feedbackReviewSequence.current !== sequence) return;
      setPendingFeedback(pending);
      setEligibilityRetry(null);
      setFeedback({ kind: "success", text: actionSuccess(pending.decision) });
    } catch (error) {
      if (workspaceRef.current !== workspace || feedbackReviewSequence.current !== sequence) return;
      if (canRetryFeedbackEligibility(error)) {
        setEligibilityRetry(pending);
        setFeedback({ kind: "error", text: "决定已记录；评价暂不可用，请重试。" });
      } else if (retry) {
        setEligibilityRetry(null);
        setFeedback({ kind: "error", text: "决定已记录；评价依据已更新。" });
      }
    }
  };

  const review = async (
    candidate: EducationWorkCandidate,
    decision: EducationWorkCandidateDecision,
    patch?: Record<string, unknown>,
    note?: string,
  ) => {
    if (workspaceRef.current !== workspace || busy || actionLock.current || !capability.enabled) return;
    actionLock.current = true;
    const request = { workspace, generation: ++reviewGeneration.current };
    currentReview.current = request;
    const requestCurrent = () => workspaceRef.current === workspace && currentReview.current === request;
    const focus = rememberFocus(candidate.candidateId, "result", decision, false);
    const reviewSequence = ++feedbackReviewSequence.current;
    setFeedback(null);
    setPendingFeedback(null);
    setEligibilityRetry(null);
    setEligibilityBusy(false);
    setRetryReview(null);
    setSubmission({ workspace, candidateId: candidate.candidateId, decision });
    try {
      const result = await submitTodayWorkReview({ candidate, decision, patch, note });
      if (!requestCurrent()) return;
      if (result.data.workspace !== workspace.root) throw new TodayWorkReviewError("stale_snapshot", todayWorkErrorMessage("stale_snapshot"));
      onEducation(result.data);
      setEditor(null);
      setChangingDecisionId(null);
      const task = taskById.get(candidate.taskId);
      const reviewed = result.data.workCandidates.find((item) => item.candidateId === candidate.candidateId);
      if (focus) focus.group = reviewed?.status === "held" || reviewed?.status === "snoozed" ? "later" : "done";
      setPendingFeedback(null);
      setRatingOpen(false);
      setValueDraft(EMPTY_TEACHER_VALUE);
      setFeedbackRetry(null);
      setFeedback({ kind: "success", text: actionSuccess(decision) });
      if (feedbackReady && task && reviewed && feedbackCaptureFor(reviewed, task, decision, "useful")) {
        void checkFeedbackEligibility({ candidate: reviewed, task, decision, note }, reviewSequence);
      }
    } catch (error) {
      if (!requestCurrent()) return;
      if (error instanceof TodayWorkReviewError) {
        if (error.data?.workspace === workspace.root) onEducation(error.data);
        const disposition = todayWorkFailureDisposition(error.code);
        if (focus) focus.target = disposition === "close" ? "result" : "retry";
        if (disposition === "close") setEditor(null);
        setFeedback({ kind: "error", text: todayWorkErrorMessage(error.code), action: disposition === "close" ? "refresh" : undefined });
        if (disposition === "preserve") setRetryReview({ candidate, decision, patch, note });
      } else { if (focus) focus.target = "retry"; setFeedback({ kind: "error", text: todayWorkErrorMessage("malformed") }); }
    } finally {
      if (requestCurrent()) {
        actionLock.current = false;
        currentReview.current = null;
        if (focus) focus.ready = true;
        setFocusGeneration(value => value + 1);
        setSubmission(null);
      }
    }
  };

  const retryFeedbackEligibility = async () => {
    if (workspaceRef.current !== workspace || !eligibilityRetry || eligibilityBusy) return;
    const sequence = feedbackReviewSequence.current;
    setEligibilityBusy(true);
    try {
      await checkFeedbackEligibility(eligibilityRetry, sequence, true);
    } finally {
      if (workspaceRef.current === workspace && feedbackReviewSequence.current === sequence) setEligibilityBusy(false);
    }
  };

  const submitTeacherRating = async () => {
    if (workspaceRef.current !== workspace || !pendingFeedback || !valueDraft.usefulness || feedbackBusy) return;
    const baselineText = valueDraft.baselineMinutes.trim();
    const reviewText = valueDraft.reviewMinutes.trim();
    const baselineMinutes = baselineText ? Number(baselineText) : null;
    const reviewMinutes = reviewText ? Number(reviewText) : null;
    if ((baselineMinutes === null) !== (reviewMinutes === null)
      || baselineMinutes !== null && (!Number.isFinite(baselineMinutes) || baselineMinutes <= 0 || baselineMinutes > 1440)
      || reviewMinutes !== null && (!Number.isFinite(reviewMinutes) || reviewMinutes <= 0 || reviewMinutes > 1440)) {
      setFeedback({ kind: "error", text: "请同时填写 1–1440 分钟的预计与实际投入。" });
      return;
    }
    const assessment: TeacherValueAssessment = {
      used: valueDraft.used,
      wouldUseAgain: valueDraft.wouldUseAgain === "" ? null : valueDraft.wouldUseAgain === "yes",
      baselineMinutes,
      reviewMinutes,
      note: valueDraft.note.trim() || null,
    };
    const capture = feedbackCaptureFor(pendingFeedback.candidate, pendingFeedback.task, pendingFeedback.decision,
      valueDraft.usefulness, pendingFeedback.note, new Date().toISOString(), assessment);
    if (!capture) return;
    setPendingFeedback(null);
    setRatingOpen(false);
    setFeedbackRetry(capture);
    setFeedbackBusy(true);
    try {
      const bound = await prepareTeacherFeedbackCapture(capture);
      if (workspaceRef.current !== workspace) return;
      setFeedbackRetry(bound);
      await recordTeacherFeedback(bound);
      if (workspaceRef.current !== workspace) return;
      setFeedbackRetry(null);
      setValueDraft(EMPTY_TEACHER_VALUE);
      setFeedback({ kind: "success", text: "评价已记录。" });
    } catch (error) {
      if (workspaceRef.current !== workspace) return;
      if (!canRetryFeedbackEligibility(error)) {
        setFeedbackRetry(null);
        setFeedback({ kind: "error", text: "评价目标已变化，请刷新待办。", action: "refresh" });
      } else setFeedback({ kind: "error", text: teacherFeedbackRetryMessage(error) });
    } finally {
      if (workspaceRef.current === workspace) setFeedbackBusy(false);
    }
  };

  const retryTeacherFeedback = async () => {
    if (workspaceRef.current !== workspace || !feedbackRetry || feedbackBusy) return;
    setFeedbackBusy(true);
    try {
      const bound = feedbackRetry.target.expectedRevision === undefined ? await prepareTeacherFeedbackCapture(feedbackRetry) : feedbackRetry;
      if (workspaceRef.current !== workspace) return;
      setFeedbackRetry(bound);
      await recordTeacherFeedback(bound);
      if (workspaceRef.current !== workspace) return;
      setFeedbackRetry(null);
      setFeedback({ kind: "success", text: "反馈已记录。" });
    } catch (error) {
      if (workspaceRef.current !== workspace) return;
      if (!canRetryFeedbackEligibility(error)) {
        setFeedbackRetry(null);
        setFeedback({ kind: "error", text: "评价目标已变化，请刷新待办。", action: "refresh" });
      } else setFeedback({ kind: "error", text: teacherFeedbackRetryMessage(error, true) });
    } finally {
      if (workspaceRef.current === workspace) setFeedbackBusy(false);
    }
  };

  const refreshEducation = () => {
    if (workspaceRef.current !== workspace) return;
    feedbackReviewSequence.current += 1;
    setFeedback(null);
    setPendingFeedback(null);
    setEligibilityRetry(null);
    setEligibilityBusy(false);
    setRetryReview(null);
    window.dispatchEvent(new Event("edupi-education-refresh"));
  };

  const openEditor = (candidate: EducationWorkCandidate, mode: EditorMode) => {
    if (workspaceRef.current !== workspace || busy || actionLock.current) return;
    rememberFocus(candidate.candidateId, "editor");
    setFeedback(null);
    setRetryReview(null);
    setEditor(startEditor(candidate, mode, workspace));
    if (isTauriDesktop()) void observeTeacherUsage({ target: { kind: "work_candidate", targetId: candidate.candidateId, expectedRevision: candidate.revision }, action: "review_started", surface: "today", once: true });
  };

  const cancelEditor = () => {
    if (workspaceRef.current !== workspace || busy || actionLock.current) return;
    if (editor) rememberFocus(editor.candidateId, "action", editor.mode);
    const candidate = data.workCandidates.find(item => item.candidateId === editor?.candidateId);
    if (candidate && isTauriDesktop()) void observeTeacherUsage({ target: { kind: "work_candidate", targetId: candidate.candidateId, expectedRevision: candidate.revision }, action: "review_dismissed", surface: "today" });
    setEditor(null);
    setFeedback(null);
    setRetryReview(null);
  };

  const editorKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === "Escape" && !event.defaultPrevented && !event.nativeEvent.isComposing && !busy && !actionLock.current) {
      event.preventDefault(); event.stopPropagation(); cancelEditor();
    }
  };

  const submitModify = async (candidate: EducationWorkCandidate) => {
    if (workspaceRef.current !== workspace || !editor || !editorCurrent || editor.candidateId !== candidate.candidateId) return;
    const title = editor.title.trim();
    const summary = editor.summary.trim();
    if (!title || !summary) {
      setFeedback({ kind: "error", text: "标题和说明不能为空。" });
      setRetryReview(null);
      return;
    }
    const patch: Record<string, unknown> = {};
    if (title !== candidate.title) patch.title = title;
    if (summary !== candidate.summary) patch.summary = summary;
    if (editor.dueAt !== (candidate.dueAt || "")) patch.dueAt = editor.dueAt ? editor.dueAt : null;
    if (Object.keys(patch).length === 0) {
      setFeedback({ kind: "error", text: "请至少调整一项内容。" });
      setRetryReview(null);
      return;
    }
    if (Object.hasOwn(patch, "dueAt") && patch.dueAt !== null && !isDateOnly(String(patch.dueAt))) {
      setFeedback({ kind: "error", text: "截止日期格式无效。" });
      setRetryReview(null);
      return;
    }
    await review(candidate, "modify", patch);
  };

  const submitSnooze = async (candidate: EducationWorkCandidate) => {
    if (workspaceRef.current !== workspace) return;
    if (!editor || !editorCurrent || editor.candidateId !== candidate.candidateId || !isDateOnly(editor.snoozeUntil) || editor.snoozeUntil <= localIsoDate()) {
      setFeedback({ kind: "error", text: "请选择晚于今天的日期。" });
      setRetryReview(null);
      return;
    }
    await review(candidate, "snooze", { snoozeUntil: editor.snoozeUntil });
  };

  const submitSuppress = async (candidate: EducationWorkCandidate) => {
    if (workspaceRef.current !== workspace) return;
    if (!editor || !editorCurrent || editor.candidateId !== candidate.candidateId || !editor.note.trim()) {
      setFeedback({ kind: "error", text: "请填写停止提示的原因。" });
      setRetryReview(null);
      return;
    }
    await review(candidate, "suppress", { suppressionScope: editor.suppressionScope }, editor.note.trim());
  };

  const renderEditor = (candidate: EducationWorkCandidate) => {
    if (!editor || !editorCurrent || editor.candidateId !== candidate.candidateId) return null;
    return <form ref={formRef} className="edupi-today-work__editor" aria-label={editor.mode === "modify" ? "调整工作" : editor.mode === "snooze" ? "安排稍后" : "停止提示"} aria-busy={busy || Boolean(submission)} onKeyDown={editorKeyDown}
      onSubmit={event => { event.preventDefault(); if (editor.mode === "modify") void submitModify(candidate); else if (editor.mode === "snooze") void submitSnooze(candidate); else void submitSuppress(candidate); }}>
      {editor.mode === "modify" ? <>
        <div className="edupi-today-work__field"><label htmlFor="edupi-today-work-edit-title">标题</label><input data-autofocus id="edupi-today-work-edit-title" value={editor.title} maxLength={240} disabled={busy} onChange={(event) => setEditor({ ...editor, title: event.target.value })} /></div>
        <div className="edupi-today-work__field"><label htmlFor="edupi-today-work-edit-summary">说明</label><textarea id="edupi-today-work-edit-summary" value={editor.summary} maxLength={2000} rows={2} disabled={busy} onChange={(event) => setEditor({ ...editor, summary: event.target.value })} /></div>
        <div className="edupi-today-work__field"><label htmlFor="edupi-today-work-edit-due">截止日期</label><input id="edupi-today-work-edit-due" type="date" value={editor.dueAt} disabled={busy} onChange={(event) => setEditor({ ...editor, dueAt: event.target.value })} /></div>
      </> : editor.mode === "snooze" ? <div className="edupi-today-work__field"><label htmlFor="edupi-today-work-snooze-until">稍后日期</label><input data-autofocus id="edupi-today-work-snooze-until" type="date" value={editor.snoozeUntil} min={tomorrow()} disabled={busy} onChange={(event) => setEditor({ ...editor, snoozeUntil: event.target.value })} /></div> : <>
      <div className="edupi-today-work__field"><label htmlFor="edupi-today-work-suppression-scope">停止范围</label><select data-autofocus id="edupi-today-work-suppression-scope" value={editor.suppressionScope} disabled={busy} onChange={(event) => setEditor({ ...editor, suppressionScope: event.target.value as EditorState["suppressionScope"] })}>{Object.entries(SUPPRESSION_SCOPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      <div className="edupi-today-work__field"><label htmlFor="edupi-today-work-suppression-note">原因</label><textarea id="edupi-today-work-suppression-note" value={editor.note} maxLength={1000} rows={2} disabled={busy} onChange={(event) => setEditor({ ...editor, note: event.target.value })} /></div>
      </>}
      <div className="edupi-today-work__editor-actions"><button type="button" disabled={busy} onClick={cancelEditor}>取消</button><button type="submit" className={editor.mode === "suppress" ? "is-danger is-primary" : "is-primary"} disabled={busy}>{busy ? "正在提交…" : editor.mode === "modify" ? "保存调整" : editor.mode === "snooze" ? "安排稍后" : "停止提示"}</button></div>
    </form>;
  };

  const renderCandidate = (candidate: EducationWorkCandidate, actionable: boolean) => {
    const task = taskById.get(candidate.taskId) || null;
    const referenceLabels = (ids: string[], kind: "来源" | "依据") => {
      const labels = ids.map(id => {
        const sourceTask = data.tasks.find(item => item.id === id);
        return data.calendar.find(item => item.id === id || sourceTask?.sourceEventId && item.id === sourceTask.sourceEventId)?.name
          || sourceTask?.sourceEventName || sourceTask?.title || data.teacherMaterials?.find(item => item.material_id === id)?.title
          || data.continuity.documents.find(item => item.id === id)?.title || null;
      });
      const unresolved = labels.filter(label => !label).length;
      return [...labels.filter((label): label is string => Boolean(label)), ...(unresolved ? [`${unresolved} 项${kind}待核对`] : [])].join("、") || `${kind}待核对`;
    };
    const isEditing = editorCurrent && editor?.candidateId === candidate.candidateId;
    const decisionRecorded = candidate.status !== "pending_review";
    const changingDecision = changingDecisionId === candidate.candidateId;
    const showActions = actionable && (!decisionRecorded || changingDecision);
    const submittingCandidate = submission?.candidateId === candidate.candidateId;
    return <EduPiUsageArticle target={actionable ? { kind: "work_candidate", targetId: candidate.candidateId, expectedRevision: candidate.revision } : null} action="opportunity_visible" surface="today" className={`edupi-today-work__item is-${candidate.status}`} key={candidate.candidateId}>
      <header data-today-work-candidate={candidate.candidateId} className="edupi-today-work__item-header"><div><span title={(candidate.status === "snoozed" ? candidate.snoozeUntil : candidate.dueAt) || undefined}>{candidateMeta(candidate)}</span><h4>{task ? <button type="button" className="edupi-today-work__item-title" disabled={busy} onClick={() => onTaskDetail(task)} aria-label={`打开任务：${candidate.title}`}>{candidate.title}<span aria-hidden="true">›</span></button> : candidate.title}</h4></div><strong className={`edupi-today-work__status is-${candidate.status}`}>{STATUS_LABELS[candidate.status]}</strong></header>
      <p className="edupi-today-work__summary">{candidate.summary}</p>
      <div className="edupi-today-work__reason"><span>原因</span>{workCandidateReasonLabel(candidate.reason)}</div>
      <details className="edupi-today-work__details"><summary>来源与依据</summary><dl><div><dt>来源</dt><dd>{referenceLabels(candidate.sourceIds, "来源")}</dd></div><div><dt>依据</dt><dd>{referenceLabels(candidate.evidenceIds, "依据")}</dd></div><div><dt>下一步</dt><dd>{NEXT_CYCLE_LABELS[candidate.nextCycleState] || "待核对"}</dd></div></dl></details>
      {decisionRecorded && !changingDecision ? <div className={`edupi-today-work__decision is-${candidate.status}`} role="status"><span>{STATUS_LABELS[candidate.status]}{candidate.teacherReview.reviewedAt ? <> · <time dateTime={candidate.teacherReview.reviewedAt} title={candidate.teacherReview.reviewedAt}>{readableDate(candidate.teacherReview.reviewedAt)}</time></> : null}</span>{capability.enabled ? <button data-today-work-change type="button" disabled={busy} onClick={() => setChangingDecisionId(candidate.candidateId)}>修改决定</button> : null}</div> : null}
      {showActions && capability.enabled && !isEditing ? <div className="edupi-today-work__actions">
        <button data-today-work-action="accept" type="button" className="is-primary" title={ACTION_TITLES.accept} disabled={busy} onClick={() => void review(candidate, "accept")}>{submittingCandidate && submission?.decision === "accept" ? submittingLabel("accept") : "接受"}</button>
        <button data-today-work-action="modify" type="button" title={ACTION_TITLES.modify} disabled={busy} onClick={() => openEditor(candidate, "modify")}>调整</button>
        <button data-today-work-action="hold" type="button" title={ACTION_TITLES.hold} disabled={busy} onClick={() => void review(candidate, "hold")}>{submittingCandidate && submission?.decision === "hold" ? submittingLabel("hold") : "暂缓"}</button>
        <button data-today-work-action="snooze" type="button" title={ACTION_TITLES.snooze} disabled={busy} onClick={() => openEditor(candidate, "snooze")}>稍后</button>
        <button data-today-work-action="suppress" type="button" title={ACTION_TITLES.suppress} disabled={busy} onClick={() => openEditor(candidate, "suppress")}>停止提示</button>
        <button data-today-work-action="reject" type="button" className="is-danger" title={ACTION_TITLES.reject} disabled={busy} onClick={() => void review(candidate, "reject")}>{submittingCandidate && submission?.decision === "reject" ? submittingLabel("reject") : "拒绝"}</button>
      </div> : null}
      {isEditing ? renderEditor(candidate) : null}
    </EduPiUsageArticle>;
  };

  const renderGroup = (group: keyof WorkCandidateGroups) => {
    const candidates = groups[group];
    if (candidates.length === 0) return null;
    return <section className={`edupi-today-work__group is-${group}`} aria-labelledby={`edupi-today-work-${group}`} key={group}>
      <header><div><h3 id={`edupi-today-work-${group}`} tabIndex={-1}>{GROUP_LABELS[group]}</h3></div><span>{candidates.length} 项</span></header>
      <div className="edupi-today-work__items"><EduPiListPreview rows={candidates} renderRow={candidate => renderCandidate(candidate, true)} onShowAll={() => openList(group)} /></div>
    </section>;
  };

  const renderL4Group = (group: (typeof L4_GROUP_LABELS)[number], items: L4PreparationSummaryItem[]) => items.length === 0 ? null : (
    <section className={`edupi-today-l4__group is-${group.key}`} aria-label={group.title} key={group.key}>
      <header><h4>{group.title}</h4><span>{items.length} 项</span></header>
      <div className="edupi-today-l4__items">
        <EduPiListPreview rows={items} onShowAll={() => openList(`l4-${group.key}`)} renderRow={item => (
          <article className="edupi-today-l4__item" key={item.workCaseId}>
            <strong>{item.statusLabel}</strong>
            <p>{item.title}</p>
          </article>
        )} />
      </div>
    </section>
  );

  const unavailableCopy = capabilityCopy(capability);
  const renderActiveTask = ({ task, title, dueDate, state, stateLabel }: (typeof activeTasks)[number]) => <button type="button" key={task.id} onClick={() => onTaskDetail(task)}><i className={`edupi-flow-state is-${state}`} aria-hidden="true" /><span><strong>{title}</strong><small>{stateLabel}{dueDate ? ` · ${dueDate}` : ""}</small></span><em aria-hidden="true">›</em></button>;
  const renderHistorical = (candidate: EducationWorkCandidate) => <div key={candidate.candidateId}>
    {renderCandidate(candidate, false)}
    <div className="edupi-foreground-controls">{policy.onPinTask ? <button type="button" onClick={() => policy.onPinTask!(candidate.taskId, true)}>保留显示</button> : null}{capability.enabled ? <button type="button" disabled={busy} onClick={() => openEditor(candidate, "snooze")}>改期</button> : null}</div>
  </div>;
  const renderHistoricalTask = (task: TeacherTask) => {
    const source = data.calendar.find(event => event.id && event.id === task.sourceEventId);
    return <div className="edupi-task-history-row" key={task.id || task.title}>
      <button type="button" onClick={() => onTaskDetail(task)}><strong>{taskDisplayTitle(task)}</strong><small>{task.sourceEventDate || task.dueDate || "日期待确认"}</small></button>
      <div className="edupi-foreground-controls">{task.id && policy.onPinTask ? <button type="button" onClick={() => policy.onPinTask!(task.id!, true)}>保留显示</button> : null}
        {source?.id && onCalendarSelection ? <button type="button" disabled={!data.capabilities.calendar.enabled} title={!data.capabilities.calendar.enabled ? data.capabilities.calendar.reason : undefined} onClick={() => onCalendarSelection({ kind: "calendar", sourceId: source.id, date: source.date, title: source.name, detail: source.notes, sourceLabel: "校历", statusLabel: source.preparationStatus === "read_only" ? "已确认" : "待确认", editRequested: true })}>改期</button> : null}
      </div>
    </div>;
  };
  const isCandidateList = listGroup === "now" || listGroup === "later" || listGroup === "done";
  const l4List = L4_GROUP_LABELS.find(group => listGroup === `l4-${group.key}`);
  if (isCandidateList || listGroup === "history" || listGroup === "active" || l4List) return <section ref={rootRef} className="edupi-today-work">
    <header className="edupi-module-heading"><div><button type="button" className="edupi-back-link" onClick={() => onObject ? onObject("today:home") : setLocalList(null)}>← 首页</button><h1>{isCandidateList ? GROUP_LABELS[listGroup] : listGroup === "history" ? "工作历史" : listGroup === "active" ? "正在进行" : l4List?.title}</h1></div></header>
    {feedback ? <p role={feedback.kind === "error" ? "alert" : "status"}>{feedback.text}</p> : null}
    {isCandidateList ? <EduPiPagedRows rows={groups[listGroup]} memoryKey={`today:${listGroup}`} renderRow={candidate => renderCandidate(candidate, true)} />
      : listGroup === "history" ? <EduPiPagedRows rows={[...history.map(candidate => ({ candidate, task: null })), ...historyTasks.map(task => ({ candidate: null, task }))]} memoryKey="today:history" renderRow={row => row.candidate ? renderHistorical(row.candidate) : renderHistoricalTask(row.task!)} />
        : listGroup === "active" ? <EduPiPagedRows rows={activeTasks} memoryKey="today:active" renderRow={renderActiveTask} />
          : l4List ? <EduPiPagedRows rows={l4Summary[l4List.key]} memoryKey={`today:${listGroup}`} renderRow={item => <article key={item.workCaseId}><strong>{item.title}</strong><p>{item.statusLabel}</p></article>} /> : null}
  </section>;
  return <section ref={rootRef} className="edupi-today-work" aria-labelledby="edupi-today-work-title" aria-busy={busy}>
    <header className="edupi-today-work__header"><div><h2 id="edupi-today-work-title">工作判断</h2></div><button type="button" onClick={() => openList("history")}>历史 <span>{history.length + historyTasks.length}</span></button></header>
    {staleHolidayTasks.length > 0 ? <div className="edupi-stale-work-question" role="status"><span>有 {staleHolidayTasks.length} 项旧节日工作还需要吗？</span><div><button type="button" onClick={() => { dismissStaleWork(); openList("history"); }}>查看</button><button type="button" onClick={dismissStaleWork}>先收起</button></div></div> : null}
    {activeTasks.length > 0 ? <div className="edupi-today-flow" aria-label="正在进行的任务"><header><span>正在进行</span><strong>{activeTasks.length} 项</strong></header><div><EduPiListPreview rows={activeTasks} renderRow={renderActiveTask} onShowAll={() => openList("active")} /></div></div> : null}
    {unavailableCopy ? <p className="edupi-today-work__notice">{unavailableCopy}</p> : null}
    {data.l4Preparation && l4Summary.ready.length + l4Summary.running.length + l4Summary.attention.length > 0 ? (
      <section className="edupi-today-l4" aria-labelledby="edupi-today-l4-title">
        <header><div><h3 id="edupi-today-l4-title">自动准备</h3></div><span>{data.l4Preparation.goals.length} 个目标</span></header>
        <div className="edupi-today-l4__groups">
          {L4_GROUP_LABELS.map(({ key, title }) => renderL4Group({ key, title }, l4Summary[key]))}
        </div>
      </section>
    ) : null}
    {feedback ? <div className={`edupi-today-work__feedback is-${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"} aria-live="polite">
      <span>{feedback.text}</span>
      {feedbackRetry ? <button type="button" disabled={feedbackBusy} onClick={() => void retryTeacherFeedback()}>{feedbackBusy ? "记录中…" : "重试记录"}</button>
        : eligibilityRetry ? <button type="button" disabled={eligibilityBusy} onClick={() => void retryFeedbackEligibility()}>{eligibilityBusy ? "核对中…" : "重试评价"}</button>
        : feedback.kind === "error" && retryReview ? <button type="button" disabled={busy} onClick={() => void review(retryReview.candidate, retryReview.decision, retryReview.patch, retryReview.note)}>重试</button>
          : feedback.action === "refresh" ? <button type="button" disabled={busy} onClick={refreshEducation}>刷新待办</button>
            : pendingFeedback && !ratingOpen ? <button type="button" onClick={() => { setValueDraft(EMPTY_TEACHER_VALUE); setRatingOpen(true); }}>评价</button> : null}
      {pendingFeedback && ratingOpen ? <EduPiUsageVisibility target={{ kind: "work_candidate", targetId: pendingFeedback.candidate.candidateId, expectedRevision: pendingFeedback.candidate.revision }} action="feedback_form_opened" surface="today"><EduPiTeacherValueForm
        draft={valueDraft}
        allowUsed={pendingFeedback.decision === "accept" || pendingFeedback.decision === "modify"}
        busy={feedbackBusy}
        onChange={setValueDraft}
        onSubmit={() => void submitTeacherRating()}
        onCancel={() => { setRatingOpen(false); setValueDraft(EMPTY_TEACHER_VALUE); }}
      /></EduPiUsageVisibility> : null}
    </div> : null}
    <div className="edupi-today-work__groups">{(["now", "later", "done"] as const).map(renderGroup)}</div>
    {groups.now.length + groups.later.length + groups.done.length === 0 && activeTasks.length === 0 && l4Summary.ready.length + l4Summary.running.length + l4Summary.attention.length === 0 ? <p className="edupi-today-work__empty">暂无需判断的工作</p> : null}
  </section>;
}
