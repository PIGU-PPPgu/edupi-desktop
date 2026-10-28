"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";

import type { TeacherTask } from "@/lib/edupi-education-contract";
import { mutateEduPiTeachingMethod, type EduPiTeachingMethodAction, type EduPiTeachingMethodOutcome, type EduPiTeachingSkill, type EduPiTeachingSkillLifecycle } from "@/lib/edupi-platform-client";
import { taskDisplayTitle } from "@/lib/edupi-workbench";

type EditorMode = Extract<EduPiTeachingMethodAction, "create" | "update" | "record_trial" | "validate" | "publish" | "retire">;

type Props = {
  mode: EditorMode;
  method?: EduPiTeachingSkill;
  tasks?: TeacherTask[];
  mutationEnabled?: boolean;
  onSaved: (lifecycle: EduPiTeachingSkillLifecycle, restoreFocus: boolean) => boolean | void;
  onCancel?: (restoreFocus: boolean) => void;
  focusOrigin?: Element | null;
};

const OUTCOME_OPTIONS: Array<{ value: EduPiTeachingMethodOutcome; label: string }> = [
  { value: "helpful", label: "有效" },
  { value: "mixed", label: "部分有效" },
  { value: "not_helpful", label: "未达到预期" },
];

function submitLabel(mode: EditorMode, busy: boolean): string {
  if (busy) return "保存中…";
  if (mode === "create") return "保存方法";
  if (mode === "update") return "保存修订";
  if (mode === "record_trial") return "保存反馈";
  if (mode === "validate") return "验证通过";
  return "停用";
}

export function EduPiTeachingMethodEditor({ mode, method, tasks = [], mutationEnabled = false, onSaved, onCancel, focusOrigin }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const scopeRef = useRef({ alive: true, submitting: false, stop: () => {} });
  const failureFocusRef = useRef(false);
  const [title, setTitle] = useState(method?.title || "");
  const [content, setContent] = useState(method?.details?.content || "");
  const eligibleTasks = useMemo(() => tasks.filter((task) => Boolean(task.id)
    && task.status !== "rejected" && task.status !== "hold"
    && (task.trigger === "teacher_created" || task.status === "accepted" || task.status === "modified")), [tasks]);
  const [taskId, setTaskId] = useState(eligibleTasks[0]?.id || "");
  const [outcome, setOutcome] = useState<EduPiTeachingMethodOutcome>("helpful");
  const [feedback, setFeedback] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const revision = method?.revision;
  const editable = mutationEnabled && (mode === "create" || Boolean(method && revision !== null && revision !== undefined));
  const canSave = editable && (mode === "create" || mode === "update" ? Boolean(title.trim() && content.trim())
    : mode === "record_trial" ? Boolean(eligibleTasks.some(task => task.id === taskId) && feedback.trim())
      : mode === "validate" ? Boolean(feedback.trim()) : mode === "retire" ? Boolean(reason.trim()) : true);

  useLayoutEffect(() => {
    const scope = scopeRef.current;
    scope.alive = true;
    const form = formRef.current;
    const document = form?.ownerDocument;
    if (form && document && !document.hidden && !form.closest("[hidden], [inert], details:not([open])")
      && (document.activeElement === focusOrigin || document.activeElement === document.body || document.activeElement === document.documentElement)) {
      form.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
      form.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
    }
    return () => { scope.alive = false; scope.stop(); };
  }, [focusOrigin]);

  const mayReturnFocus = () => {
    const form = formRef.current;
    const document = form?.ownerDocument;
    return Boolean(form?.isConnected && document && !document.hidden
      && !form.closest("[hidden], [inert], details:not([open])")
      && (form.contains(document.activeElement) || document.activeElement === document.body || document.activeElement === document.documentElement));
  };

  const cancel = () => {
    if (!scopeRef.current.submitting) onCancel?.(mayReturnFocus());
  };

  useLayoutEffect(() => {
    if (busy || !failureFocusRef.current) return;
    failureFocusRef.current = false;
    if (mayReturnFocus()) formRef.current?.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus({ preventScroll: true });
  }, [busy, error]);

  const save = async (decision: "accepted" | "rejected" = "accepted") => {
    const scope = scopeRef.current;
    if (!canSave || !scope.alive || scope.submitting) return;
    scope.submitting = true;
    const form = formRef.current;
    const document = form?.ownerDocument;
    let restoreFocus = mayReturnFocus();
    const moved = (event: Event) => {
      if (!form?.contains(event.target as Node) && (event.type === "pointerdown" || event.target !== document?.body && event.target !== document?.documentElement)) restoreFocus = false;
    };
    const hidden = () => { if (document?.hidden) restoreFocus = false; };
    document?.addEventListener("focusin", moved);
    document?.addEventListener("pointerdown", moved);
    document?.addEventListener("visibilitychange", hidden);
    scope.stop = () => {
      document?.removeEventListener("focusin", moved);
      document?.removeEventListener("pointerdown", moved);
      document?.removeEventListener("visibilitychange", hidden);
    };
    failureFocusRef.current = false;
    setBusy(true);
    setError("");
    try {
      let next: EduPiTeachingSkillLifecycle;
      if (mode === "create") next = await mutateEduPiTeachingMethod({ action: mode, title, content });
      else {
        if (!method || revision === null || revision === undefined) throw new Error("此方法来自旧版本，只能查看");
        if (mode === "update") next = await mutateEduPiTeachingMethod({ action: mode, methodId: method.skillId, expectedRevision: revision, title, content });
        else if (mode === "record_trial") next = await mutateEduPiTeachingMethod({ action: mode, methodId: method.skillId, expectedRevision: revision, taskId, outcome, feedback });
        else if (mode === "validate") next = await mutateEduPiTeachingMethod({ action: mode, methodId: method.skillId, expectedRevision: revision, decision, feedback });
        else if (mode === "publish") next = await mutateEduPiTeachingMethod({ action: mode, methodId: method.skillId, expectedRevision: revision });
        else next = await mutateEduPiTeachingMethod({ action: mode, methodId: method.skillId, expectedRevision: revision, reason });
      }
      if (!scope.alive || !form?.isConnected) return;
      if (onSaved(next, restoreFocus && mayReturnFocus()) === false) {
        setError("方法已有更新，请关闭后重试。");
        return;
      }
      window.dispatchEvent(new Event("edupi-preparation-updated"));
    } catch (error) {
      if (scope.alive && form?.isConnected) {
        failureFocusRef.current = restoreFocus && mayReturnFocus();
        setError(error instanceof Error ? error.message : "教学方法操作失败");
      }
    } finally {
      scope.stop();
      scope.submitting = false;
      if (scope.alive && form?.isConnected) setBusy(false);
    }
  };

  if (!mutationEnabled) return <p>当前教学方法不可编辑。</p>;
  if (mode !== "create" && (!method || revision === null || revision === undefined)) return <p>旧方法保留为历史记录。</p>;

  return <form ref={formRef} className="edupi-method-editor" aria-label={mode === "create" ? "新增教学方法" : `${method?.title} · ${mode === "update" ? "修订" : mode === "record_trial" ? "记录试用" : mode === "validate" ? "验证" : mode === "publish" ? "发布" : "停用"}`} aria-busy={busy}
    onSubmit={(event) => { event.preventDefault(); void save(); }}
    onKeyDown={(event) => { if (onCancel && event.key === "Escape" && !event.defaultPrevented && !event.nativeEvent.isComposing && !scopeRef.current.submitting) { event.preventDefault(); event.stopPropagation(); cancel(); } }}>
    <fieldset disabled={busy}>
    {mode === "publish" ? <p>发布后，匹配的后续备课会采用这个方法。</p> : null}
    {mode === "create" || mode === "update" ? <>
      <label>方法名称<input data-autofocus value={title} maxLength={240} required onChange={(event) => setTitle(event.target.value)} /></label>
      <label>具体做法<textarea value={content} required maxLength={12000} rows={5} onChange={(event) => setContent(event.target.value)} /></label>
      {mode === "update" && content !== method?.details?.content ? <p>保存后需要重新试用和验证。</p> : null}
    </> : null}
    {mode === "record_trial" ? <>
      <label>教学任务<select data-autofocus value={taskId} required onChange={(event) => setTaskId(event.target.value)}><option value="" disabled>选择实际教学任务</option>{eligibleTasks.map((task) => <option key={task.id} value={task.id || ""}>{taskDisplayTitle(task)}</option>)}</select></label>
      <label>实际效果<select value={outcome} onChange={(event) => setOutcome(event.target.value as EduPiTeachingMethodOutcome)}>{OUTCOME_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <label>课堂反馈<textarea value={feedback} required maxLength={4000} rows={4} onChange={(event) => setFeedback(event.target.value)} /></label>
      {eligibleTasks.length === 0 ? <p role="alert">暂无可关联的教学任务</p> : null}
    </> : null}
    {mode === "validate" ? <label>验证意见<textarea data-autofocus value={feedback} required maxLength={4000} rows={4} onChange={(event) => setFeedback(event.target.value)} /></label> : null}
    {mode === "retire" ? <label>停用原因<textarea data-autofocus value={reason} required maxLength={1000} rows={3} onChange={(event) => setReason(event.target.value)} /></label> : null}
    {error ? <p role="alert">{error}</p> : null}
    <div className="edupi-method-editor__actions">
      {onCancel ? <button data-autofocus={mode === "publish" || undefined} type="button" disabled={busy} onClick={cancel}>取消</button> : null}
      {mode === "validate" ? <button type="button" disabled={busy || !feedback.trim()} onClick={() => void save("rejected")}>不再使用</button> : null}
      <button data-autofocus={mode === "publish" && !onCancel || undefined} type="submit" className="is-primary" disabled={busy || !canSave}>
        {mode === "publish" ? busy ? "发布中…" : "发布" : submitLabel(mode, busy)}
      </button>
    </div>
    </fieldset>
  </form>;
}
