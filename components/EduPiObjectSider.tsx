"use client";

import { useEffect, useState } from "react";

import type { EducationContract, EducationMemoryCandidate, EducationObservation, TeacherTask } from "@/lib/edupi-education-contract";
import type { CalendarItemSelection } from "@/lib/edupi-calendar-model";
import { isRecognizedTimetableNote } from "@/lib/edupi-recognition-markers";
import { groupTasksByCategory, TASK_CATEGORY_CONFIG } from "@/lib/edupi-task-category";
import { studentRecordKey, studentRecordName } from "@/lib/edupi-student-roster-model";
import type { TeacherContextSnapshot } from "@/lib/edupi-onboarding-types";
import { groupEducationInsights, isTaskActionable, isUserFacingMemory, recordLabel, taskArtifacts, taskDisplayTitle, taskKey, taskStatusLabel, taskStatusTone, taskTypeLabel, type TaskStage, type WorkbenchView } from "@/lib/edupi-workbench";
import { EduPiContentSider } from "./EduPiContentSider";

type Props = {
  view: WorkbenchView;
  data: EducationContract;
  context: TeacherContextSnapshot | null;
  query: string;
  onQuery: (query: string) => void;
  selectedStudentId: string | null;
  onStudent: (student: Record<string, unknown>) => void;
  selectedObjectId: string | null;
  onObject: (id: string) => void;
  selectedTaskKey: string | null;
  onTask: (task: TeacherTask, stage?: TaskStage) => void;
  onReviewTarget?: (target: { kind: "observation" | "memory_candidate"; id: string }) => void;
  selectedCalendarSourceId?: string | null;
  onCalendarItem?: (selection: CalendarItemSelection) => void;
  onUpload: () => void;
  onCollapse: () => void;
};

type C1ObjectTarget =
  | { kind: "observation"; item: EducationObservation; id: string }
  | { kind: "memory_candidate"; item: EducationMemoryCandidate; id: string };

const viewTitles: Record<WorkbenchView, string> = {
  chat: "AI 协作",
  dashboard: "今天",
  workspace: "工作区",
  teaching: "教学",
  homeroom: "班级",
  calendar: "日程",
  memory: "教育记忆",
  insights: "观察与洞察",
  growth: "成长",
  students: "学生档案",
  materials: "材料",
  review: "待我确认",
  tasks: "教学任务",
  artifacts: "教学产物",
};

function match(value: string, query: string): boolean {
  return !query || value.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

function objectStudentDateLabel(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(parsed);
}

function GroupTitle({ children, count }: { children: string; count?: number }) {
  return <div className="edupi-object-group__title"><strong>{children}</strong>{count !== undefined ? <span>{count}</span> : null}</div>;
}

function TaskRow({ task, selected, onClick }: { task: TeacherTask; selected: boolean; onClick: () => void }) {
  return <button type="button" className={`edupi-object-row${selected ? " is-selected" : ""}`} onClick={onClick}><span className={`edupi-object-row__marker is-${taskStatusTone(task)}`} aria-hidden="true" /><span className="edupi-object-row__copy"><strong>{taskDisplayTitle(task)}</strong><small>{task.dueDate || taskTypeLabel(task)}</small></span><em>{taskStatusLabel(task)}</em></button>;
}

function C1ReviewRow({ target, onClick }: { target: C1ObjectTarget; onClick: () => void }) {
  const isObservation = target.kind === "observation";
  const content = isObservation ? target.item.text : target.item.proposedContent;
  const source = isObservation
    ? target.item.provenance.find((entry) => entry.sourceKind === "teacher_message")?.sourceId || "教师消息"
    : target.item.basedOnObservationIds.length > 0 ? `观察 ${target.item.basedOnObservationIds[0]}` : "观察来源待补";
  return <button type="button" className="edupi-object-row edupi-c1-object-row" onClick={onClick} aria-label={`打开${isObservation ? "教师观察" : "记忆候选"}：${content}`}><span className="edupi-object-row__marker is-warning" aria-hidden="true" /><span className="edupi-object-row__copy"><strong>{content}</strong><small>{isObservation ? "教师观察" : "记忆候选"} · {source}</small></span><em>待确认</em></button>;
}

const OBJECT_PAGE_SIZE = 10;
function PageControls({ page, total, onPage }: { page: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / OBJECT_PAGE_SIZE));
  if (pages <= 1) return null;
  return <div className="edupi-object-pagination"><button type="button" disabled={page <= 0} onClick={() => onPage(page - 1)}>上一页</button><span>{page + 1} / {pages}</span><button type="button" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>下一页</button></div>;
}

function ObjectStudentRow({ student, index, selected, onClick }: { student: Record<string, unknown>; index: number; selected: boolean; onClick: () => void }) {
  const name = studentRecordName(student);
  const patterns = Array.isArray(student.error_patterns) ? student.error_patterns : [];
  const trajectory = Array.isArray(student.trajectory) ? student.trajectory : [];
  const latest = patterns.find((item) => item && typeof item === "object") as Record<string, unknown> | undefined;
  return <button type="button" className={`edupi-object-row edupi-object-student${selected ? " is-selected" : ""}`} onClick={onClick}><span className={`edupi-object-student__avatar is-tint-${index % 4}`}>{name.slice(0, 1)}</span><span className="edupi-object-row__copy"><strong>{name}</strong><small>{latest ? recordLabel(latest, ["description", "desc"], "学习观察") : `${patterns.length} 个模式 · ${trajectory.length} 个节点`}</small></span><em>›</em></button>;
}

export function EduPiObjectSider({ view, data, context, query, onQuery, selectedStudentId, onStudent, selectedObjectId, onObject, selectedTaskKey, onTask, onReviewTarget, selectedCalendarSourceId, onCalendarItem, onUpload, onCollapse }: Props) {
  const [objectPage, setObjectPage] = useState(0);
  useEffect(() => setObjectPage(0), [query, view]);
  const tasks = data.tasks.filter((task) => match(`${task.title} ${task.sourceEventName || ""} ${task.student || ""}`, query));
  const pending = tasks.filter((task) => isTaskActionable(task));
  const pendingC1: C1ObjectTarget[] = [
    ...data.observations.filter((item) => (item.teacherReview.state === "pending_review" || item.teacherReview.state === "held") && match(`${item.text} ${item.observationId} ${item.evidenceIds.join(" ")}`, query)).map((item) => ({ kind: "observation" as const, item, id: item.observationId })),
    ...data.memoryCandidates.filter((item) => item.teacherReview.state !== "rejected" && (item.teacherReview.state === "pending_review" || item.teacherReview.state === "held") && match(`${item.proposedContent} ${item.candidateId} ${item.tags.join(" ")}`, query)).map((item) => ({ kind: "memory_candidate" as const, item, id: item.candidateId })),
  ];
  const reviewed = tasks.filter((task) => task.boardStage === "done" || (task.status !== "planned" && task.status !== "hold"));
  const teachingTasks = tasks.filter((task) => task.trigger === "teaching_adjustment_candidate" || Boolean(task.materialId) || Boolean(task.topic));
  const homeroomTasks = tasks.filter((task) => task.trigger === "student_follow_up");
  const materials = tasks.filter((task) => task.materialId || task.trigger === "teaching_adjustment_candidate");
  const intakeMaterials = (data.intakeTargets ?? []).filter((target) => target.projectionKind === "material_intake" && target.status === "accepted").slice().reverse();
  const artifacts = tasks.filter((task) => taskArtifacts(task).length > 0);
  const students = data.students.filter((student) => match(recordLabel(student, ["name", "student_name", "display_name"], ""), query));
  const calendar = data.calendar.filter((event) => match(`${event.name} ${event.date || ""}`, query));
  const memories = data.continuity.memories.filter((memory) => memory.state === "active" && isUserFacingMemory(memory) && match(`${memory.content} ${memory.student || ""} ${memory.tags.join(" ")}`, query));
  const surfacedInsights = groupEducationInsights(data.continuity.insights.filter((insight) => insight.status === "surfaced" && !insight.content.startsWith("[主题候选]") && match(insight.content, query))).slice(0, 6);
  const signals = data.continuity.signals.filter((signal) => match(`${signal.content} ${signal.related.join(" ")}`, query)).sort((left, right) => right.strength - left.strength);
  const documents = data.continuity.documents.filter((document) => match(`${document.title} ${document.excerpt}`, query));
  const themes = data.continuity.themes.filter((theme) => match(theme.topic, query)).slice(0, 8);
  const insightRows = [...surfacedInsights.map((group) => ({ id: `insight:${group.insight.id}`, title: group.topic, detail: group.insight.content.replace(/^\[梦境启示\]\s*/, "") })), ...signals.map((signal) => ({ id: `signal:${signal.id}`, title: signal.content, detail: `出现 ${signal.strength} 次` }))];
  const growthRows = [...documents.map((document) => ({ id: `document:${document.id}`, title: document.title, detail: objectStudentDateLabel(document.date) || document.path })), ...themes.map((theme) => ({ id: `theme:${theme.topic}`, title: theme.topic, detail: `出现 ${theme.occurrences} 次 · ${theme.skillCandidate ? "待验证" : "观察中"}` }))];
  const pageSlice = <T,>(items: T[]) => items.slice(objectPage * OBJECT_PAGE_SIZE, (objectPage + 1) * OBJECT_PAGE_SIZE);
  const tasksByCategory = groupTasksByCategory(tasks);
  const taskRows = (rows: TeacherTask[], stage: TaskStage) => rows.map((task) => <TaskRow key={taskKey(task)} task={task} selected={taskKey(task) === selectedTaskKey} onClick={() => onTask(task, stage)} />);

  return (
    <EduPiContentSider width={244} ariaLabel={`${viewTitles[view]}对象列表`} header={<><div className="edupi-object-sider__header"><div><span>当前模块</span><strong>{viewTitles[view]}</strong></div><button type="button" onClick={onCollapse} aria-label="收起列表">‹</button></div><label className="edupi-object-sider__search"><span aria-hidden="true">⌕</span><input type="search" value={query} onChange={(event) => onQuery(event.target.value)} placeholder={`搜索${viewTitles[view]}`} aria-label={`搜索${viewTitles[view]}`} /></label></>}>
      {view === "dashboard" ? <><section className="edupi-object-group"><GroupTitle count={pending.length}>需要处理</GroupTitle>{taskRows(pending, "review")}{pending.length === 0 ? <div className="edupi-object-empty">暂无待处理事项</div> : null}</section><section className="edupi-object-group"><GroupTitle count={reviewed.length}>最近完成</GroupTitle>{taskRows(reviewed.slice(0, 6), "brief")}</section></> : null}
      {view === "teaching" ? <><section className="edupi-object-group"><GroupTitle count={teachingTasks.length}>教学工作</GroupTitle>{taskRows(teachingTasks, "run")}{teachingTasks.length === 0 ? <div className="edupi-object-empty">暂无教学工作</div> : null}</section><section className="edupi-object-group"><GroupTitle count={data.timetable.length}>本周课程</GroupTitle>{data.timetable.slice(0, 6).map((slot, index) => { const recognized = isRecognizedTimetableNote(slot.notes); return <div className="edupi-object-fact" key={`${String(slot.day_of_week)}:${String(slot.period)}:${index}`}><strong>{recordLabel(slot, ["subject"], "课程")}</strong><span>周{String(slot.day_of_week ?? "-")} · 第 {String(slot.period ?? "-")} 节{recognized ? " · 待确认" : ""}</span></div>; })}</section></> : null}
      {view === "homeroom" ? <><section className="edupi-object-group"><GroupTitle count={homeroomTasks.length}>学生跟进</GroupTitle>{taskRows(homeroomTasks, "run")}{homeroomTasks.length === 0 ? <div className="edupi-object-empty">暂无跟进事项</div> : null}</section><section className="edupi-object-group"><GroupTitle count={students.length}>学生</GroupTitle>{students.map((student, index) => { const id = studentRecordKey(student, index); return <ObjectStudentRow key={id} student={student} index={index} selected={id === selectedStudentId} onClick={() => onStudent(student)} />; })}</section></> : null}
      {view === "tasks" ? <>{TASK_CATEGORY_CONFIG.map((category) => { const rows = tasksByCategory[category.id]; return rows.length > 0 ? <section className="edupi-object-group" key={category.id}><GroupTitle count={rows.length}>{category.label}</GroupTitle>{taskRows(rows, "brief")}</section> : null; })}{tasks.length === 0 ? <div className="edupi-object-empty">暂无匹配任务</div> : null}</> : null}
      {view === "review" ? <><section className="edupi-object-group"><GroupTitle count={pendingC1.length}>观察与记忆</GroupTitle>{pendingC1.map((target) => <C1ReviewRow key={`${target.kind}:${target.id}`} target={target} onClick={() => onReviewTarget?.({ kind: target.kind, id: target.id })} />)}{pendingC1.length === 0 ? <div className="edupi-object-empty">暂无待确认内容</div> : null}</section><section className="edupi-object-group"><GroupTitle count={pending.length}>任务审核</GroupTitle>{taskRows(pending, "review")}{pending.length === 0 ? <div className="edupi-object-empty">暂无待审核任务</div> : null}</section></> : null}
      {view === "students" ? <><section className="edupi-object-group"><GroupTitle>班级</GroupTitle>{(context?.classes?.length ? context.classes : [context?.grade || "年级待设置"]).map((name) => <div className="edupi-object-fact" key={name}><strong>{name}</strong><span>{context?.subject || "学科待设置"}</span></div>)}</section><section className="edupi-object-group"><GroupTitle count={students.length}>学生</GroupTitle>{students.map((student, index) => { const id = studentRecordKey(student, index); return <ObjectStudentRow key={id} student={student} index={index} selected={id === selectedStudentId} onClick={() => onStudent(student)} />; })}{students.length === 0 ? <div className="edupi-object-empty">暂无学生事实</div> : null}</section></> : null}
      {view === "calendar" ? <><section className="edupi-object-group"><GroupTitle count={data.timetable.length}>本周课程</GroupTitle>{data.timetable.map((slot, index) => { const sourceId = recordLabel(slot, ["slot_id", "id"], `timetable:${index}`); const title = recordLabel(slot, ["subject"], "课程"); const detail = `周${String(slot.day_of_week ?? "-")} · 第 ${String(slot.period ?? "-")} 节`; const recognized = isRecognizedTimetableNote(slot.notes); return <button type="button" className={`edupi-object-fact is-interactive${selectedCalendarSourceId === sourceId ? " is-selected" : ""}`} key={sourceId} onClick={() => onCalendarItem?.({ kind: "timetable", sourceId, date: null, title, detail, sourceLabel: recognized ? "材料识别" : "课程表", statusLabel: recognized ? "待确认" : "已确认" })}><strong>{title}</strong><span>{detail}{recognized ? " · 待确认" : ""}</span></button>; })}{data.timetable.length === 0 ? <div className="edupi-object-empty">暂无课程表</div> : null}</section><section className="edupi-object-group"><GroupTitle count={calendar.length}>校历节点</GroupTitle>{calendar.map((event) => { const sourceId = event.id || `calendar:${event.date || "pending"}:${event.name}`; return <button type="button" className={`edupi-object-fact is-interactive${selectedCalendarSourceId === sourceId ? " is-selected" : ""}`} key={sourceId} onClick={() => onCalendarItem?.({ kind: "calendar", sourceId, date: event.date, title: event.name, detail: event.notes, sourceLabel: event.source === "official_school_calendar" ? "学校校历" : event.source === "teacher" ? "教师" : event.source === "inferred" ? "材料识别" : "校历", statusLabel: event.preparationStatus === "read_only" ? "已确认" : "待确认" })}><strong>{event.name}</strong><span>{event.date || "日期待确认"}</span></button>; })}</section></> : null}
      {view === "memory" ? <section className="edupi-object-group"><GroupTitle count={memories.length}>当前记忆</GroupTitle>{pageSlice(memories).map((memory, index) => <button type="button" className={`edupi-object-fact is-interactive${selectedObjectId === `memory:${memory.id}` || (!selectedObjectId && objectPage === 0 && index === 0) ? " is-selected" : ""}`} key={memory.id} onClick={() => onObject(`memory:${memory.id}`)}><strong>{memory.student || ({ semester: "学期", class: "班级", teaching: "教学", preferences: "教师偏好", school: "学校" } as Record<string, string>)[memory.category] || memory.category}</strong><span>{memory.content}</span></button>)}<PageControls page={objectPage} total={memories.length} onPage={setObjectPage} /></section> : null}
      {view === "insights" ? <section className="edupi-object-group"><GroupTitle count={insightRows.length}>观察记录</GroupTitle>{pageSlice(insightRows).map((item, index) => <button type="button" className={`edupi-object-fact is-interactive${selectedObjectId === item.id || (!selectedObjectId && objectPage === 0 && index === 0) ? " is-selected" : ""}`} key={item.id} onClick={() => onObject(item.id)}><strong>{item.title}</strong><span>{item.detail}</span></button>)}<PageControls page={objectPage} total={insightRows.length} onPage={setObjectPage} /></section> : null}
      {view === "growth" ? <section className="edupi-object-group"><GroupTitle count={growthRows.length}>成长记录</GroupTitle>{pageSlice(growthRows).map((item, index) => <button type="button" className={`edupi-object-fact is-interactive${selectedObjectId === item.id || (!selectedObjectId && objectPage === 0 && index === 0) ? " is-selected" : ""}`} key={item.id} onClick={() => onObject(item.id)}><strong>{item.title}</strong><span>{item.detail}</span></button>)}<PageControls page={objectPage} total={growthRows.length} onPage={setObjectPage} /></section> : null}
      {view === "materials" ? <><section className="edupi-object-group"><div className="edupi-object-group__actions"><GroupTitle count={materials.length}>收件箱</GroupTitle><button type="button" onClick={onUpload}>上传</button></div>{taskRows(materials, "evidence")}{materials.length === 0 ? <div className="edupi-object-empty">暂无待处理材料</div> : null}</section><section className="edupi-object-group"><GroupTitle count={intakeMaterials.length}>已接入</GroupTitle>{intakeMaterials.map((target) => <div className="edupi-object-fact" key={target.targetId}><strong>{target.title}</strong><span>{target.reviewedAt ? objectStudentDateLabel(target.reviewedAt) : "已保留来源"}</span></div>)}</section></> : null}
      {view === "artifacts" ? <section className="edupi-object-group"><GroupTitle count={artifacts.reduce((total, task) => total + taskArtifacts(task).length, 0)}>最近产物</GroupTitle>{taskRows(artifacts, "artifact")}{artifacts.length === 0 ? <div className="edupi-object-empty">暂无教学产物</div> : null}</section> : null}
    </EduPiContentSider>
  );
}
