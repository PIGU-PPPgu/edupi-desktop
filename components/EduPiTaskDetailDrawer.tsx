"use client";

import { useState } from "react";
import type { EducationWorkCase, TeacherTask } from "@/lib/edupi-education-contract";
import { parseTeacherRecurringMaterials, preparationDeliverables } from "@/lib/edupi-teacher-task-form";
import { usePanelDismiss } from "@/hooks/usePanelDismiss";
import { taskPreparedArtifacts } from "@/lib/edupi-task-artifacts";
import { taskWorkStatusLabel, workCaseTransitionLabel } from "@/lib/edupi-work-case";
import {
  taskDisplayTitle,
  taskEvidenceRows,
  taskSourceLabel,
  taskStatusLabel,
  taskStatusTone,
} from "@/lib/edupi-workbench";
import type { GeneratedArtifact } from "@/lib/edupi-generated-artifacts";
import { EduPiIconButton } from "./EduPiActionIcon";
import { EduPiTaskArtifacts } from "./EduPiTaskArtifacts";

type Props = {
  task: TeacherTask;
  workCase: EducationWorkCase | null;
  files?: GeneratedArtifact[];
  workspace: string;
  onClose: () => void;
  onOpenFile: (path: string) => void;
  onOpenTask: (task: TeacherTask) => void;
  onOpenAgent: (task: TeacherTask) => void;
  onDelete: (task: TeacherTask) => void;
  onRecurringStage?: (task: TeacherTask, stage: "done" | "progress") => Promise<void>;
  onUpdateRecurring?: (task: TeacherTask, patch: { title: string; dueDate: string; deliverables: string[] }) => Promise<void>;
  deleteBusy?: boolean;
  agentBusy?: boolean;
  agentError?: string | null;
  docked?: boolean;
  unavailable?: boolean;
  artifactsUnavailable?: boolean;
  onReview?: () => void;
};

function nonempty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function flowTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function RecurringTaskControls({ task, onStage, onUpdate }: { task: TeacherTask; onStage: NonNullable<Props["onRecurringStage"]>; onUpdate: NonNullable<Props["onUpdateRecurring"]> }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(task.title);
  const [dueDate, setDueDate] = useState(task.dueDate || "");
  const [deliverables, setDeliverables] = useState(task.deliverables.join("\n"));
  const items = preparationDeliverables(deliverables);
  const validation = parseTeacherRecurringMaterials(task.recurrence && { ...task.recurrence, deliverables: items.items }, dueDate || null, false);
  const paused = task.boardStage === "done";
  const unchanged = title.trim() === task.title && dueDate === task.dueDate
    && JSON.stringify(items.items) === JSON.stringify(task.deliverables);
  async function changeStage() {
    setBusy(true); setError(null);
    try { await onStage(task, paused ? "progress" : "done"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败"); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!validation.value || items.error || !title.trim()) return;
    setBusy(true); setError(null);
    try { await onUpdate(task, { title: title.trim(), dueDate, deliverables: items.items }); setEditing(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "修改失败"); }
    finally { setBusy(false); }
  }
  return <section className="edupi-task-detail-section" aria-label="周期材料">
    <header><h3>周期材料</h3><span>{paused ? "已暂停" : "已启用"}</span></header>
    {editing ? <div className="edupi-task-board-create__source">
      <label><span>任务</span><input className="native-input" maxLength={240} value={title} onChange={event => setTitle(event.target.value)} disabled={busy} /></label>
      <label><span>下期日期</span><input className="native-input" type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} disabled={busy} /></label>
      <label><span>产物</span><textarea className="native-input" rows={3} value={deliverables} onChange={event => setDeliverables(event.target.value)} disabled={busy} /></label>
      {items.error || validation.error ? <p role="alert">{items.error || validation.error}</p> : null}
      <div className="edupi-task-board-create__actions"><button type="button" className="native-button" disabled={busy} onClick={() => { setTitle(task.title); setDueDate(task.dueDate || ""); setDeliverables(task.deliverables.join("\n")); setEditing(false); setError(null); }}>取消</button><button type="button" className="native-button native-button-primary" disabled={busy || unchanged || !title.trim() || !validation.value || Boolean(items.error)} onClick={() => void save()}>保存</button></div>
    </div> : <div className="edupi-task-board-create__actions"><button type="button" className="native-button" disabled={busy} onClick={() => setEditing(true)}>修改</button><button type="button" className="native-button" disabled={busy} onClick={() => void changeStage()}>{paused ? "恢复" : "暂停"}</button></div>}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}

export function EduPiTaskDetailDrawer({ task, workCase, files = [], workspace, onClose, onOpenFile, onOpenTask, onOpenAgent, onDelete, onRecurringStage, onUpdateRecurring, deleteBusy = false, agentBusy = false, agentError = null, docked = false, unavailable = false, artifactsUnavailable = false, onReview }: Props) {
  const drawerRef = usePanelDismiss<HTMLElement>(onClose, docked);
  const title = taskDisplayTitle(task);
  const source = taskSourceLabel(task);
  const status = taskStatusLabel(task);
  const statusTone = taskStatusTone(task);
  const matchedCase = workCase?.taskId === task.id ? workCase : null;
  const preparedFiles = taskPreparedArtifacts(task, matchedCase, files, workspace);
  const plans = preparedFiles.length ? [] : task.deliverables;
  const evidenceRows = taskEvidenceRows(task);
  const evidence = evidenceRows.filter(({ label }) => label !== "来源路径" && label !== "产物文件" && label !== "文件校验");
  const latestReview = [...task.reviewHistory].reverse().find((entry) => nonempty(entry.note ?? entry.review_note) || nonempty(entry.reviewer ?? entry.reviewer_id) || nonempty(entry.reviewed_at));
  const reviewTime = task.reviewedAt || nonempty(latestReview?.reviewed_at);
  const reviewer = task.reviewer || nonempty(latestReview?.reviewer ?? latestReview?.reviewer_id);
  const feedbackRows = [
    ["意见", task.reviewNote || nonempty(latestReview?.note ?? latestReview?.review_note)],
    ["审核人", reviewer === "teacher" ? "教师" : reviewer],
    ["时间", reviewTime ? flowTime(reviewTime) : null],
  ].flatMap(([label, value]) => value ? [{ label, value }] : []);
  const flowTransitions = matchedCase ? matchedCase.transitions.slice(-12) : [];
  const flowStatus = taskWorkStatusLabel(task, matchedCase);
  return (
    <div className={`edupi-task-detail-layer${docked ? " is-docked" : ""}`} onMouseDown={(event) => { if (!docked && event.target === event.currentTarget) onClose(); }}>
      <aside ref={drawerRef} className="edupi-task-detail-drawer" data-task-id={task.id ?? undefined} role={docked ? "complementary" : "dialog"} aria-modal={docked ? undefined : true} aria-labelledby="edupi-task-detail-title" tabIndex={-1}>
        <header className="edupi-task-detail-drawer__header">
          <div><h2 id="edupi-task-detail-title">{title}</h2></div>
          <EduPiIconButton data-autofocus type="button" icon="close" label="关闭任务详情" className="edupi-task-detail-drawer__close" onClick={onClose}/>
        </header>
        <div className="edupi-task-detail-drawer__body">
          <section className="edupi-task-detail-summary" aria-label="任务概览">
            <span className={`edupi-task-detail-status is-${unavailable ? "warning" : statusTone}`}>{unavailable ? "任务状态暂不可用" : status}</span>
            <dl>
              <div><dt>截止</dt><dd>{task.dueDate || "日期待确认"}</dd></div>
              {task.recurrence ? <div><dt>周期</dt><dd>{task.recurrence.cadence === "weekly" ? "每周" : "每月"} · 提前 {task.recurrence.leadDays} 天 · 至 {task.recurrence.untilDate}</dd></div> : null}
              {task.sourceEventDate ? <div><dt>事件日期</dt><dd>{task.sourceEventDate}</dd></div> : null}
              <div><dt>来源</dt><dd>{source}</dd></div>
            </dl>
          </section>

          {task.recurrence && onRecurringStage && onUpdateRecurring && !unavailable ? <RecurringTaskControls key={`${task.id}:${task.revision}:${task.boardRevision}`} task={task} onStage={onRecurringStage} onUpdate={onUpdateRecurring} /> : null}

          <section className="edupi-task-detail-section" aria-labelledby="edupi-task-detail-ready">
            <header><h3 id="edupi-task-detail-ready">产物</h3>{!artifactsUnavailable && !unavailable ? <span>{preparedFiles.length} 份文件</span> : null}</header>
            <EduPiTaskArtifacts artifacts={preparedFiles} onOpenFile={onOpenFile} unavailable={artifactsUnavailable || unavailable} />
            {plans.length > 0 ? <div className="edupi-task-detail-plans"><strong>计划交付</strong><ul>{plans.map((plan) => <li key={plan}>{plan}</li>)}</ul></div> : null}
          </section>

          <section className="edupi-task-detail-section edupi-task-flow" aria-labelledby="edupi-task-detail-flow">
            <header><h3 id="edupi-task-detail-flow">执行记录</h3>{!unavailable ? <span>{flowStatus}</span> : null}</header>
            {flowTransitions.length > 0 ? <ol>{flowTransitions.map((transition) => <li className={`is-${transition.state}`} key={transition.id}><i className={`edupi-flow-state is-${transition.state}`} aria-hidden="true" /><div><strong>{workCaseTransitionLabel(transition)}</strong><small>{transition.sourceKind === "teacher_review" ? "教师判断" : "EduPi 执行"}</small></div><time>{flowTime(transition.occurredAt)}</time></li>)}</ol> : <p className="edupi-task-detail-empty">{unavailable ? "执行记录暂不可用" : "暂无执行记录"}</p>}
          </section>

          <details className="edupi-task-detail-section edupi-task-detail-evidence-section">
            <summary>依据</summary>
            {evidence.length > 0 ? <dl className="edupi-task-detail-evidence">{evidence.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl> : <p className="edupi-task-detail-empty">暂无可展示依据</p>}
          </details>
          {feedbackRows.length > 0 ? <section className="edupi-task-detail-section" aria-labelledby="edupi-task-detail-feedback">
            <header><h3 id="edupi-task-detail-feedback">教师反馈</h3></header>
            <dl className="edupi-task-detail-feedback">{feedbackRows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
          </section> : null}
        </div>
        {agentError ? <p className="edupi-task-detail-handoff-error" role="alert">{agentError}</p> : null}
        <footer className="edupi-task-detail-drawer__footer"><EduPiIconButton type="button" icon="delete" label={deleteBusy ? "正在删除任务" : "删除任务"} className="is-delete" busy={deleteBusy} disabled={deleteBusy || !task.id} onClick={() => onDelete(task)}/><button type="button" onClick={() => onOpenTask(task)}>进入任务</button>{onReview ? <button type="button" className="is-primary" onClick={onReview}>审核草稿</button> : <button type="button" className="is-primary" disabled={agentBusy} onClick={() => onOpenAgent(task)}>{agentBusy ? "正在准备" : "继续协作"}</button>}</footer>
      </aside>
    </div>
  );
}
