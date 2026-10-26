"use client";

import { useState, type ReactNode } from "react";
import type { EducationContract, TeacherTask } from "@/lib/edupi-education-contract";
import { matchesWorkspaceQuery as match, type ReviewTargetRoute } from "@/lib/edupi-domain-navigation";
import { isTaskActionable, taskDisplayTitle, taskKey, taskTypeLabel } from "@/lib/edupi-workbench";
import { isTaskReviewable, workCaseForTask } from "@/lib/edupi-work-case";
import { FACT_KIND_LABELS, factStatusLabel } from "@/lib/edupi-fact-lifecycle-model";
import { EduPiFactActions } from "./EduPiFactActions";
import { compareForegroundDates, isTaskForeground, taskReferenceDate } from "@/lib/edupi-foreground";
import { EduPiListPreview, EduPiPagedRows, useEduPiForegroundPolicy } from "./EduPiForeground";

const TITLES = { tasks: "任务审核", facts: "事实确认", followups: "学生跟进", "followups-history": "跟进历史", observations: "观察确认", memories: "记忆确认", content: "审核内容" };
type ReviewList = keyof typeof TITLES;

export function EduPiReviewBoard({ data, query, onTask, onReviewTarget, onEducation, reviewer, selectedObjectId, onObject }: { data: EducationContract; query: string; onTask: (task: TeacherTask) => void; onReviewTarget: (target: ReviewTargetRoute) => void; onEducation: (data: EducationContract) => void; reviewer: string; selectedObjectId?: string | null; onObject?: (id: string) => void }) {
  const policy = useEduPiForegroundPolicy();
  const [localList, setLocalList] = useState<ReviewList | null>(null);
  const requestedList = selectedObjectId !== undefined ? selectedObjectId?.startsWith("review:list:") ? selectedObjectId.slice("review:list:".length) : null : localList;
  const list = requestedList && requestedList in TITLES ? requestedList as ReviewList : null;
  const openList = (group: ReviewList) => { setLocalList(group); onObject?.(`review:list:${group}`); };
  const today = new Date(`${policy.today}T00:00:00+08:00`);
  const tasks = data.tasks.filter((task) => isTaskForeground(task, policy, data) && isTaskActionable(task, today) && isTaskReviewable(task, workCaseForTask(data, task.id)) && match(`${task.title} ${task.sourceEventName || ""} ${task.student || ""}`, query))
    .sort((left, right) => compareForegroundDates(taskReferenceDate(left, data), taskReferenceDate(right, data), policy.today) || taskKey(left).localeCompare(taskKey(right)));
  const observations = data.observations.filter((item) => (item.teacherReview.state === "pending_review" || item.teacherReview.state === "held") && match(`${item.text} ${item.observationId} ${item.evidenceIds.join(" ")}`, query));
  const memories = data.memoryCandidates.filter((item) => item.teacherReview.state !== "rejected" && (item.teacherReview.state === "pending_review" || item.teacherReview.state === "held") && match(`${item.proposedContent} ${item.candidateId} ${item.tags.join(" ")}`, query));
  const facts = (data.factSpine?.factCandidates || []).filter((item) => (item.status === "candidate" || item.status === "pending_review" || item.status === "held") && match(`${item.value} ${item.predicate} ${item.subjectRef || ""} ${item.topicRef || ""}`, query));
  const followUps = (data.followUps || []).filter(item => match(`${item.title} ${item.internalDraftSummary} ${item.followUpId}`, query));
  const pendingFollowUps = followUps.filter(item => item.teacherReview.state === "pending_review" || item.teacherReview.state === "held");
  const reviewedFollowUps = followUps.filter(item => ["accepted", "modified", "rejected"].includes(item.teacherReview.state));
  const followUpRows = (items: typeof followUps) => items.map(item => <button type="button" key={item.followUpId} onClick={() => onReviewTarget({ kind: "follow_up", id: item.followUpId })}>
    <strong>{item.title}</strong><span>{item.internalDraftSummary}</span>
  </button>);
  const nodes: Record<ReviewList, ReactNode[]> = {
    tasks: tasks.map(task => <button type="button" key={taskKey(task)} onClick={() => onTask(task)}><strong>{taskDisplayTitle(task)}</strong><span>{taskTypeLabel(task)} · {task.dueDate || "日期待确认"}</span></button>),
    facts: facts.map(fact => <article className="edupi-review-fact" key={fact.id}><strong>{fact.value}</strong><span>{FACT_KIND_LABELS[fact.kind]} · {factStatusLabel(fact.status)}</span>{data.factSpine ? <EduPiFactActions fact={fact} spine={data.factSpine} reviewer={reviewer} onEducation={onEducation} /> : null}</article>),
    followups: followUpRows(pendingFollowUps),
    "followups-history": followUpRows(reviewedFollowUps),
    observations: observations.map(item => <button type="button" key={item.observationId} onClick={() => onReviewTarget({ kind: "observation", id: item.observationId })}><strong>{item.text}</strong><span>{item.evidenceIds.length} 条依据</span></button>),
    memories: memories.map(item => <button type="button" key={item.candidateId} onClick={() => onReviewTarget({ kind: "memory_candidate", id: item.candidateId })}><strong>{item.proposedContent}</strong><span>{item.tags.join(" · ") || "记忆候选"}</span></button>),
    content: [],
  };
  nodes.content = [...nodes.observations, ...nodes.memories, ...nodes.followups];
  const preview = (group: ReviewList) => <EduPiListPreview rows={nodes[group]} renderRow={row => row} onShowAll={() => openList(group)} />;
  const groups = (["tasks", "facts", "followups", "observations", "memories"] as const).filter(group => nodes[group].length > 0);
  if (list) return <main className="edupi-module-workspace edupi-review-board-workspace"><header className="edupi-module-heading"><div><button type="button" className="edupi-back-link" onClick={() => { setLocalList(null); onObject?.("review:board"); }}>← 待我确认</button><h1>{TITLES[list]}</h1></div></header><EduPiPagedRows rows={nodes[list]} memoryKey={`review:${list}:${query}`} renderRow={row => row} /></main>;
  return <main className="edupi-module-workspace edupi-review-board-workspace">
    <header className="edupi-module-heading"><div><h1>待我确认</h1><p>{tasks.length + observations.length + memories.length + facts.length + pendingFollowUps.length} 项</p></div>{reviewedFollowUps.length > 0 ? <button type="button" onClick={() => openList("followups-history")}>跟进历史 <span>{reviewedFollowUps.length}</span></button> : null}</header>
    {groups.length > 0 ? <div className="edupi-review-mini-board">
      {groups.map(group => <section key={group}><header><h2>{TITLES[group]}</h2><em>{nodes[group].length}</em></header><div>{preview(group)}</div></section>)}
    </div> : <p className="edupi-module-empty" role="status">{query.trim() ? "未找到待确认事项" : "暂无待确认事项"}</p>}
  </main>;
}
