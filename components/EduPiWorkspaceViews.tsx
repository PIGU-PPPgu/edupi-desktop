"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import type { CalendarFact, EducationContract, EducationEntityDeleteKind, TeacherTask } from "@/lib/edupi-education-contract";
import type { CalendarItemSelection } from "@/lib/edupi-calendar-model";
import type { TeacherContextSnapshot } from "@/lib/edupi-onboarding-types";
import {
  taskArtifacts,
  taskDisplayTitle,
  type TaskStage,
  type WorkbenchView,
} from "@/lib/edupi-workbench";
import { EduPiCalendarWorkspace } from "./EduPiCalendarWorkspace";
import { EduPiInsightDatabase } from "./EduPiInsightDatabase";
import { EduPiGrowthWorkspace } from "./EduPiGrowthWorkspace";
import { EduPiMaterialsWorkspace } from "./EduPiMaterialsWorkspace";
import { EduPiMemoryDatabase } from "./EduPiMemoryDatabase";
import { EduPiStudentWorkspace } from "./EduPiStudentWorkspace";
import { EduPiTeachingWorkspace } from "./EduPiTeachingWorkspace";
import { EduPiTodayWork } from "./EduPiTodayWork";
import { EduPiWorkspaceBoard } from "./EduPiWorkspaceBoard";
import type { MaterialStagingDescriptor } from "@/lib/edupi-material-staging-client";
import type { TaskBoardLaneId } from "@/lib/edupi-task-board";
import type { EducationMemoryScopeProjection } from "@/lib/edupi-memory-scopes";

type Props = {
  view: Exclude<WorkbenchView, "chat" | "tasks" | "review">;
  data: EducationContract;
  context: TeacherContextSnapshot | null;
  memoryScopes: EducationMemoryScopeProjection | null;
  query: string;
  selectedStudentId: string | null;
  selectedObjectId: string | null;
  runningAgentCount: number;
  stagedMaterials: MaterialStagingDescriptor[];
  stagingBusy: boolean;
  intakeBusy: boolean;
  stagingMessage: string | null;
  calendarSelection: CalendarItemSelection | null;
  onTask: (task: TeacherTask, stage?: TaskStage) => void;
  onTaskDetail: (task: TeacherTask) => void;
  onEducation: (data: EducationContract) => void;
  onStudent: (student: Record<string, unknown> | null) => void;
  onObject: (id: string) => void;
  onNavigate: (view: WorkbenchView, objectId?: string) => void;
  onUpload: () => void;
  onIntakeMaterial: (item: MaterialStagingDescriptor) => Promise<unknown>;
  onRemoveStagedMaterial: (item: MaterialStagingDescriptor) => Promise<void>;
  onCalendarSelection: (selection: CalendarItemSelection | null) => void;
  onImportCalendar: (event: { eventId: string | null; date: string; endDate: string | null; name: string; type: string; notes: string | null }) => Promise<void>;
  onImportTimetable: (slot: { slotId: string | null; dayOfWeek: number; period: number; subject: string; className: string | null; kind: "class" | "routine"; notes: string | null }) => Promise<void>;
  onOpenContext: () => void;
  onOpenAdmin: () => void;
  onOpenFile: (path: string) => void;
  onStartAgent: (prompt: string, mode?: "insert" | "replace") => void;
  onCreateTask: (input: { title: string; dueDate: string | null; note: string | null }) => Promise<void>;
  onMoveTask: (task: TeacherTask, stage: TaskBoardLaneId) => Promise<void>;
  onDeleteEntity: (kind: EducationEntityDeleteKind, id: string, label: string) => Promise<boolean>;
};

function includesQuery(value: string, query: string): boolean {
  return !query || value.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

function shortDate(value: string): string {
  const date = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function workspaceFile(workspace: string, relativePath: string): string {
  const separator = workspace.includes("\\") ? "\\" : "/";
  return `${workspace.replace(/[\\/]$/, "")}${separator}${relativePath.replace(/[\\/]/g, separator)}`;
}

function cleanInsight(value: string): string {
  return value.replace(/^\[(?:梦境启示|主题候选)\]\s*/, "");
}

function localIsoDate(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function calendarDateLabel(event: CalendarFact): string {
  if (!event.date) return "日期待确认";
  return event.endDate ? `${event.date} — ${event.endDate.slice(5)}` : event.date;
}

function calendarSourceLabel(source: string | null): string {
  if (source === "teacher") return "教师确认";
  if (source === "official_school_calendar") return "学校校历";
  if (source === "inferred") return "待核对";
  return source || "来源待补";
}

const quickPrompts = [
  { label: "整理材料", prompt: "请整理我刚上传的教学材料，保留来源，先列出需要我确认的事实。" },
  { label: "分析学情", prompt: "请根据当前班级与材料，归纳共性问题和需要继续观察的学生情况。" },
  { label: "调整下一课", prompt: "请结合当前任务证据和课程节奏，提出下一课可执行的调整候选。" },
];

function CommandCenter({ runningAgentCount, onStartAgent }: { runningAgentCount: number; onStartAgent: (prompt: string) => void }) {
  const [command, setCommand] = useState("");
  const start = () => {
    const value = command.trim();
    if (!value) return;
    onStartAgent(value);
    setCommand("");
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    start();
  };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      start();
    }
  };

  return (
    <section className="edupi-command-center" aria-labelledby="edupi-command-title">
      <header>
        <span className="edupi-command-center__avatar" aria-hidden="true">π</span>
        <div><span>教师内部</span><h2 id="edupi-command-title">交给 EduPi</h2></div>
        <div className="edupi-command-center__status"><span className="is-runtime"><i aria-hidden="true" />{runningAgentCount > 0 ? `${runningAgentCount} 个 Agent 运行中` : "Agent 就绪"}</span><span className="edupi-command-center__scope">教师内部</span></div>
      </header>
      <form onSubmit={submit}>
        <textarea value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={keyDown} rows={2} placeholder="描述一件教学工作，或把材料拖进来…" aria-label="交给 EduPi 的教学工作" />
        <footer>
          <div>{quickPrompts.map((item) => <button key={item.label} type="button" onClick={() => setCommand(item.prompt)}>{item.label}</button>)}</div>
          <button type="submit" className="is-primary" disabled={!command.trim()}>开始协作 <span aria-hidden="true">↗</span></button>
        </footer>
      </form>
    </section>
  );
}

function SectionHeader({ title, meta, action, onAction }: { title: string; meta?: string; action?: string; onAction?: () => void }) {
  return <header className="edupi-page-section__header"><div><h2>{title}</h2>{meta ? <span>{meta}</span> : null}</div>{action && onAction ? <button type="button" onClick={onAction}>{action}</button> : null}</header>;
}

function DashboardView({ data, context, runningAgentCount, onEducation, onTaskDetail, onNavigate, onUpload, onOpenContext, onOpenAdmin, onOpenFile, onStartAgent }: Pick<Props, "data" | "context" | "runningAgentCount" | "onEducation" | "onTaskDetail" | "onNavigate" | "onUpload" | "onOpenContext" | "onOpenAdmin" | "onOpenFile" | "onStartAgent">) {
  const today = localIsoDate();
  const currentWeek = data.calendar.find((event) => Boolean(event.date && event.date <= today && (event.endDate || event.date) >= today && /第\d+周/.test(event.name)));
  const upcoming = data.calendar.filter((event) => Boolean(event.date && (event.endDate || event.date) >= today && event !== currentWeek)).slice(0, 5);
  const latestBrief = data.continuity.documents.find((document) => document.kind === "daily");
  const latestInsight = data.continuity.insights.filter((insight) => insight.status === "surfaced" && !insight.content.startsWith("[主题候选]")).at(-1);
  const nextSetup = context?.checklist.find((item) => item.status === "next");
  const setupTotal = context?.checklist.length || 5;
  const setupComplete = context?.checklist.filter((item) => item.status === "complete").length || 0;
  const dateLabel = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date());
  const contextLabel = [context?.school, context?.grade, context?.subject].filter(Boolean).join(" · ") || "教育上下文待设置";

  const openSetup = () => {
    if (!nextSetup || nextSetup.id === "identity") return onOpenContext();
    if (nextSetup.id === "calendar" || nextSetup.id === "timetable") return onNavigate("calendar");
    if (nextSetup.id === "roster") return onNavigate("students");
    onUpload();
  };

  return <main className="edupi-module-workspace edupi-dashboard-workspace">
    <header className="edupi-dashboard-heading">
      <div><span>{dateLabel}</span><h1>今天</h1><p>{contextLabel}{currentWeek ? ` · ${currentWeek.name}` : ""}</p></div>
      <div className="edupi-dashboard-heading__actions"><button type="button" onClick={onOpenContext}>教学上下文</button><button type="button" className="is-primary" onClick={onUpload}>上传材料</button></div>
    </header>
    <CommandCenter runningAgentCount={runningAgentCount} onStartAgent={onStartAgent} />
    <section className="edupi-dashboard-readiness" aria-label="EduPi 就绪度"><div><span>EduPi 就绪度 {setupComplete}/{setupTotal}</span><strong>{nextSetup ? `下一步：${nextSetup.label}` : "教育资料已就绪"}</strong></div><div>{nextSetup ? <button type="button" onClick={openSetup}>现在补充</button> : null}<button type="button" onClick={onOpenAdmin}>管理中心</button></div></section>
    <div className="edupi-today-layout">
      <div className="edupi-today-main">
        <section className="edupi-page-section edupi-daily-brief">
          <SectionHeader title="EduPi 已经准备好" meta={latestBrief?.date ? shortDate(latestBrief.date) : undefined} action={latestBrief ? "打开原文" : undefined} onAction={latestBrief ? () => onOpenFile(workspaceFile(data.workspace, latestBrief.path)) : undefined} />
          {latestBrief ? <p>{latestBrief.excerpt}</p> : <div className="edupi-module-empty">今天还没有生成简报</div>}
        </section>
        <EduPiTodayWork data={data} onEducation={onEducation} onWorkCaseDetail={(workCase) => { const task = data.tasks.find((item) => item.id === workCase.taskId); if (task) onTaskDetail(task); }} />
      </div>
      <aside className="edupi-today-side">
        <section className="edupi-page-section edupi-today-dock">
          <SectionHeader title="接下来" action="日程" onAction={() => onNavigate("calendar")} />
          {currentWeek ? <div className="edupi-today-dock__week"><span>当前</span><strong>{currentWeek.name}</strong><small>{calendarDateLabel(currentWeek)}</small></div> : null}
          <div className="edupi-today-dock__events">{upcoming.map((event) => <button type="button" key={event.id || `${event.date}:${event.name}`} onClick={() => onNavigate("calendar")}><time>{event.date?.slice(5).replace("-", "/") || "--/--"}</time><span><strong>{event.name}</strong><small>{event.endDate ? `至 ${event.endDate.slice(5).replace("-", "/")}` : calendarSourceLabel(event.source)}</small></span></button>)}</div>
          {!currentWeek && upcoming.length === 0 ? <button type="button" className="edupi-today-dock__empty" onClick={() => onNavigate("calendar")}>导入校历</button> : null}
        </section>
        <section className="edupi-page-section edupi-attention-note">
          <SectionHeader title="值得留意" action="全部洞察" onAction={() => onNavigate("insights")} />
          {latestInsight ? <button type="button" onClick={() => onNavigate("insights")}><strong>{cleanInsight(latestInsight.content)}</strong><span>{latestInsight.evidenceIds.length} 条依据 · 仍由教师判断</span></button> : <div className="edupi-module-empty">暂无已浮出的洞察</div>}
        </section>
      </aside>
    </div>
  </main>;
}

function CalendarView({ data, query, onUpload, intakeBusy, calendarSelection, onCalendarSelection, onTaskDetail, onImportCalendar, onImportTimetable, onDeleteEntity }: Pick<Props, "data" | "query" | "onUpload" | "intakeBusy" | "calendarSelection" | "onCalendarSelection" | "onTaskDetail" | "onImportCalendar" | "onImportTimetable" | "onDeleteEntity">) {
  return <EduPiCalendarWorkspace data={data} query={query} onUpload={onUpload} intakeBusy={intakeBusy} selection={calendarSelection} onSelect={onCalendarSelection} onTaskDetail={onTaskDetail} onImportCalendar={onImportCalendar} onImportTimetable={onImportTimetable} onDeleteEntity={onDeleteEntity} />;
}

function ArtifactsView({ data, query, onTask }: Pick<Props, "data" | "query" | "onTask">) {
  const rows = data.tasks.flatMap((task) => taskArtifacts(task).map((artifact) => ({ task, artifact }))).filter(({ artifact }) => includesQuery(`${artifact.title} ${artifact.summary}`, query));
  return <main className="edupi-module-workspace"><header className="edupi-module-heading"><div><h1>教学产物</h1><p>{rows.length} 项</p></div></header><section className="edupi-artifact-table"><div className="edupi-artifact-table__head"><span>产物</span><span>来源任务</span><span>状态</span></div>{rows.map(({ task, artifact }) => <button type="button" key={artifact.id} onClick={() => onTask(task, "artifact")}><span><strong>{artifact.title}</strong></span><span>{taskDisplayTitle(task)}</span><span className={`is-${artifact.state}`}>{artifact.state === "confirmed" ? "已确认" : "候选"}</span></button>)}{rows.length === 0 ? <div className="edupi-module-empty">暂无教学产物</div> : null}</section></main>;
}

export function EduPiWorkspaceViews(props: Props) {
  if (props.view === "dashboard") return <DashboardView data={props.data} context={props.context} runningAgentCount={props.runningAgentCount} onEducation={props.onEducation} onTaskDetail={props.onTaskDetail} onNavigate={props.onNavigate} onUpload={props.onUpload} onOpenContext={props.onOpenContext} onOpenAdmin={props.onOpenAdmin} onOpenFile={props.onOpenFile} onStartAgent={props.onStartAgent} />;
  if (props.view === "workspace") return <EduPiWorkspaceBoard data={props.data} query={props.query} onTaskDetail={props.onTaskDetail} onCreateTask={props.onCreateTask} onMoveTask={props.onMoveTask} />;
  if (props.view === "teaching") return <EduPiTeachingWorkspace data={props.data} context={props.context} query={props.query} selectedObjectId={props.selectedObjectId} onObject={props.onObject} onTask={(task) => props.onTask(task, "brief")} onNavigate={props.onNavigate} onStartAgent={props.onStartAgent} onCalendarSelection={props.onCalendarSelection} />;
  if (props.view === "homeroom" || props.view === "students") return <EduPiStudentWorkspace mode={props.view} data={props.data} context={props.context} query={props.query} selectedStudentId={props.selectedStudentId} onStudent={props.onStudent} onEducation={props.onEducation} onTask={(task) => props.onTask(task, "brief")} onStartAgent={props.onStartAgent} onDeleteEntity={props.onDeleteEntity} />;
  if (props.view === "calendar") return <CalendarView data={props.data} query={props.query} onUpload={props.onUpload} intakeBusy={props.intakeBusy} calendarSelection={props.calendarSelection} onCalendarSelection={props.onCalendarSelection} onTaskDetail={props.onTaskDetail} onImportCalendar={props.onImportCalendar} onImportTimetable={props.onImportTimetable} onDeleteEntity={props.onDeleteEntity} />;
  if (props.view === "memory") return <EduPiMemoryDatabase data={props.data} memoryScopes={props.memoryScopes} query={props.query} selectedObjectId={props.selectedObjectId} onEducation={props.onEducation} onStartAgent={props.onStartAgent} onDeleteEntity={props.onDeleteEntity} />;
  if (props.view === "insights") return <EduPiInsightDatabase data={props.data} query={props.query} selectedObjectId={props.selectedObjectId} />;
  if (props.view === "growth") return <EduPiGrowthWorkspace data={props.data} query={props.query} selectedObjectId={props.selectedObjectId} onOpenFile={props.onOpenFile} onTask={(task) => props.onTask(task, "artifact")} />;
  if (props.view === "materials") return <EduPiMaterialsWorkspace data={props.data} query={props.query} selectedObjectId={props.selectedObjectId} stagedMaterials={props.stagedMaterials} stagingBusy={props.stagingBusy} stagingMessage={props.stagingMessage} onTask={(task) => props.onTask(task, "evidence")} onUpload={props.onUpload} onIntakeMaterial={props.onIntakeMaterial} onRemoveStagedMaterial={props.onRemoveStagedMaterial} onStartAgent={props.onStartAgent} onDeleteEntity={props.onDeleteEntity} />;
  return <ArtifactsView data={props.data} query={props.query} onTask={props.onTask} />;
}
