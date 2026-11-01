"use client";

import { useContext, useEffect, useMemo, useState } from "react";
import { APP_PREF_KEYS, getPrefBool, setPrefBool } from "@/lib/app-prefs";
import { projectManagedWorkflow, projectWorkflowView, type WorkflowStepStatus } from "@/lib/edupi-workflow-view";
import type { PublicDynamicWorkflowRun } from "@/lib/edupi-dynamic-workflow";
import type { AgentMessage } from "@/lib/types";
import { taskDisplayTitle, taskStatusLabel } from "@/lib/edupi-workbench";
import { workCaseStateLabel } from "@/lib/edupi-work-case";
import { hasCurrentExplicitBoardStage, taskBoardLaneLabel } from "@/lib/edupi-task-board";
import { EduPiTaskRunContext, type EduPiTaskRunInfo } from "./EduPiTaskRunContext";

type Props = {
  running: boolean;
  toolRunning: boolean;
  compacting: boolean;
  activeTools?: string[];
  messages?: readonly AgentMessage[];
  entryIds?: readonly string[];
  sessionId?: string;
};

const EMPTY_MESSAGES: readonly AgentMessage[] = [];
const flowStatus: Record<WorkflowStepStatus, string> = {
  pending: "待运行", running: "运行中", done: "已完成", failed: "有失败", interrupted: "已中断", skipped: "已跳过",
};
const stepStatus: Record<WorkflowStepStatus, string> = {
  pending: "待运行", running: "执行中", done: "已完成", failed: "失败", interrupted: "已中断", skipped: "已跳过",
};

function taskRunStatus({ task, workCase }: EduPiTaskRunInfo): string {
  if (task.boardStage && hasCurrentExplicitBoardStage(task)) return taskBoardLaneLabel(task.boardStage);
  // A previous execution snapshot must not erase a teacher's later decision.
  if (task.status === "hold") return "已暂缓";
  if (task.status === "rejected") return "已拒绝";
  if (task.status === "accepted") return "已接受";
  if (task.status === "modified") return "修改后接受";
  if (workCase?.taskId === task.id) {
    if (workCase.currentState === "draft_ready") return "待你确认";
    if (workCase.currentState === "completed") return "执行完成";
    return workCaseStateLabel(workCase.currentState);
  }
  return taskStatusLabel(task);
}

export function EduPiRuntimeFlow({ running, toolRunning, compacting, activeTools = [], messages = EMPTY_MESSAGES, entryIds = [], sessionId }: Props) {
  const context = useContext(EduPiTaskRunContext);
  const info = sessionId && context?.sessionId === sessionId ? context : null;
  const busy = running || toolRunning || compacting;
  const observedGraph = useMemo(() => projectWorkflowView(messages, busy, activeTools), [messages, busy, activeTools]);
  const currentEntryId = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index--) if (messages[index].role === "user") return entryIds[index];
    return undefined;
  }, [messages, entryIds]);
  const [managedRun, setManagedRun] = useState<PublicDynamicWorkflowRun | null>(null);
  useEffect(() => { setManagedRun(null); }, [sessionId]);
  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/edupi/workflows?sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json() as { run?: PublicDynamicWorkflowRun | null };
        if (active) setManagedRun(body.run ?? null);
      } catch { /* The observed Pi activity remains available offline. */ }
    };
    void refresh();
    const timer = busy ? setInterval(() => { void refresh(); }, 2000) : null;
    return () => { active = false; if (timer) clearInterval(timer); };
  }, [sessionId, busy]);
  const graph = managedRun && managedRun.sourceEntryId === currentEntryId ? projectManagedWorkflow(managedRun) : observedGraph;
  const finalSkipped = graph?.managed && graph.status === "done" ? graph.phases.reduce((count, phase) => count + phase.steps.filter(step => step.status === "skipped").length, 0) : 0;
  const finalFailed = graph?.managed && graph.status === "done" ? graph.phases.reduce((count, phase) => count + phase.steps.filter(step => step.status === "failed").length, 0) : 0;
  const graphCount = graph && (finalSkipped || finalFailed)
    ? `${graph.completed} 完成${finalFailed ? ` · ${finalFailed} 失败` : ""}${finalSkipped ? ` · ${finalSkipped} 跳过` : ""}`
    : graph ? `${graph.completed}/${graph.total} 项` : "";
  const [expanded, setExpanded] = useState(true);
  const [openPhase, setOpenPhase] = useState<string | null>(null);
  useEffect(() => { setExpanded(getPrefBool(APP_PREF_KEYS.edupiWorkflowExpanded, true)); }, []);
  if (!info && !busy && !graph) return null;

  const activity = compacting ? "整理对话" : activeTools.length || toolRunning ? "正在执行" : info ? "正在协作" : "处理中";
  const activityDetail = busy && !compacting && activeTools.length ? `执行工具：${activeTools.join("、")}` : undefined;
  const workflowView = graph || !info && busy ? <section className={`edupi-workflow-view${graph?.managed ? " is-managed" : ""}`} aria-label="执行流程">
      <div className="edupi-workflow-view__header">
        {graph ? <button type="button" className="edupi-workflow-view__toggle" aria-expanded={expanded} onClick={() => {
          setExpanded(value => { setPrefBool(APP_PREF_KEYS.edupiWorkflowExpanded, !value); return !value; });
        }}>
          <span className={`edupi-workflow-view__lamp is-${graph.status}`} aria-hidden="true" />
          <strong>{graph.title}</strong><span className="edupi-workflow-view__status">{flowStatus[graph.status]}</span>
          <span className="edupi-workflow-view__count">{graphCount}</span>
          <span className="edupi-workflow-view__chevron" aria-hidden="true">⌄</span>
        </button> : <div className="edupi-workflow-view__quiet" role="status">
          <span className="edupi-workflow-view__lamp is-running" aria-hidden="true" /><span>{activity}</span>
        </div>}
      </div>
      {graph && expanded ? <div className="edupi-workflow-view__scroll">
        <ol className="edupi-workflow-view__timeline" aria-label="本轮执行阶段">
          {graph.phases.map((phase) => <li key={phase.id} className={`edupi-workflow-view__phase is-${phase.status}`}>
            <div className="edupi-workflow-view__station"><span className="edupi-workflow-view__node" aria-hidden="true" />
              <strong>{phase.name}</strong><span>{stepStatus[phase.status]}</span></div>
            <ul className="edupi-workflow-view__steps">
              {phase.steps.slice(0, openPhase === phase.id ? undefined : 5).map((step, index) => <li key={step.id}
                className={`edupi-workflow-view__step is-${step.status}`} title={step.toolName}>
                <span className={`edupi-workflow-view__step-mark${graph.managed ? ` is-agent tone-${index % 6}` : ""}`} aria-hidden="true">{graph.managed ? Array.from(step.name)[0] : null}</span>
                <span className="edupi-workflow-view__step-name">{step.name}</span>
                <span className="edupi-workflow-view__step-state">{stepStatus[step.status]}</span>
              </li>)}
            </ul>
            {phase.steps.length > 5 ? <button type="button" className="edupi-workflow-view__more"
              aria-expanded={openPhase === phase.id} onClick={() => setOpenPhase(value => value === phase.id ? null : phase.id)}>
              {openPhase === phase.id ? "收起" : `还有 ${phase.steps.length - 5} 项`}
            </button> : null}
          </li>)}
        </ol>
        {graph.hiddenSteps > 0 ? <span className="edupi-workflow-view__older">较早 {graph.hiddenSteps} 项未显示</span> : null}
      </div> : null}
    </section> : null;
  if (!info) return workflowView;

  const status = busy ? activity : info.unavailable ? "任务状态暂不可用" : taskRunStatus(info);
  const filesUnavailable = info.unavailable || info.artifactsUnavailable;
  return <>
    {workflowView}
    <button
      type="button"
      className={`edupi-task-run-card${busy ? " edupi-runtime-flow" : ""}`}
      data-task-id={info.task.id || undefined}
      onClick={info.onOpen}
    >
      <svg className="edupi-task-run-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>
      <span className="edupi-task-run-card__body">
        <strong className="edupi-task-run-card__title">{taskDisplayTitle(info.task) || info.task.title}</strong>
        <span className="edupi-task-run-card__meta" role="status">
          <span className="edupi-task-run-card__status" title={activityDetail}>{status}</span>
          {busy && info.unavailable ? <span>任务状态暂不可用</span> : null}
          <span>{filesUnavailable ? "文件列表暂不可用" : `${info.artifacts.length} 份文件`}</span>
        </span>
      </span>
      <svg className="edupi-task-run-card__chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg>
    </button>
  </>;
}
