"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import type { CalendarFact, EducationContract, TeacherTask } from "@/lib/edupi-education-contract";
import type { CalendarItemSelection } from "@/lib/edupi-calendar-model";
import type { TeacherContextSnapshot } from "@/lib/edupi-onboarding-types";
import type { TaskSessionBinding } from "@/lib/edupi-task-sessions";
import {
  isUserFacingMemory,
  taskAgentSteps,
  taskArtifacts,
  taskDisplayTitle,
  taskEvidenceRows,
  taskKey,
  taskStatusLabel,
  taskStatusTone,
  taskTypeLabel,
  type TaskStage,
  type WorkbenchView,
} from "@/lib/edupi-workbench";
import { EduPiCalendarWorkspace } from "./EduPiCalendarWorkspace";
import { EduPiStudentWorkspace } from "./EduPiStudentWorkspace";
import { EduPiTodayWork } from "./EduPiTodayWork";
import { EduPiWorkspaceBoard } from "./EduPiWorkspaceBoard";
import type { MaterialStagingDescriptor } from "@/lib/edupi-material-staging-client";
import type { TaskBoardLaneId } from "@/lib/edupi-task-board";

type Props = {
  view: Exclude<WorkbenchView, "chat" | "tasks" | "review">;
  data: EducationContract;
  context: TeacherContextSnapshot | null;
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
  onNavigate: (view: WorkbenchView) => void;
  onUpload: () => void;
  onIntakeMaterial: (item: MaterialStagingDescriptor) => Promise<unknown>;
  onRemoveStagedMaterial: (item: MaterialStagingDescriptor) => Promise<void>;
  onCalendarSelection: (selection: CalendarItemSelection | null) => void;
  onImportCalendar: (event: { eventId: string | null; date: string; endDate: string | null; name: string; type: string; notes: string | null }) => Promise<void>;
  onImportTimetable: (slot: { slotId: string | null; dayOfWeek: number; period: number; subject: string; className: string | null; kind: "class" | "routine"; notes: string | null }) => Promise<void>;
  onOpenContext: () => void;
  onOpenAdmin: () => void;
  onOpenFile: (path: string) => void;
  onStartAgent: (prompt: string) => void;
  onCreateTask: (input: { title: string; dueDate: string | null; note: string | null }) => Promise<void>;
  onMoveTask: (task: TeacherTask, stage: TaskBoardLaneId) => Promise<void>;
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

function growthReviewStateLabel(value: string | null): string | null {
  if (!value) return null;
  const labels: Record<string, string> = { pending_review: "待验证", accepted: "已确认", confirmed: "已确认", rejected: "已拒绝", hold: "已暂缓" };
  return labels[value] || "状态待确认";
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

function WorkItem({ task, agentSession, onClick }: { task: TeacherTask; agentSession: TaskSessionBinding | null; onClick: () => void }) {
  const steps = taskAgentSteps(task);
  const complete = steps.filter((step) => step.state === "done").length;
  const current = steps.find((step) => step.state === "active") || steps.at(-1);
  const currentLabel = agentSession?.status === "running"
    ? "Agent 正在运行"
    : agentSession?.status === "idle"
      ? "继续协作"
      : agentSession?.status === "missing"
        ? "恢复协作"
        : complete === steps.length ? taskStatusLabel(task) : current?.title;
  return (
    <button type="button" className="edupi-work-item" onClick={onClick}>
      <span className={`edupi-work-list__dot is-${taskStatusTone(task)}`} aria-hidden="true" />
      <span className="edupi-work-item__body">
        <span className="edupi-work-item__meta">{taskTypeLabel(task)} · {task.dueDate || "日期待确认"}</span>
        <strong>{taskDisplayTitle(task)}</strong>
        <span className="edupi-work-item__progress"><span style={{ width: `${Math.round((complete / steps.length) * 100)}%` }} /></span>
      </span>
      <span className="edupi-work-item__state"><strong>{currentLabel}</strong><small>{complete}/{steps.length} 步</small></span>
      <span aria-hidden="true">›</span>
    </button>
  );
}

function WorkflowStrip({ current }: { current: "observe" | "prepare" | "review" | "record" }) {
  const steps = [
    { id: "observe", label: "观察" },
    { id: "prepare", label: "准备" },
    { id: "review", label: "审核" },
    { id: "record", label: "留痕" },
  ] as const;
  const currentIndex = steps.findIndex((step) => step.id === current);
  return <ol className="edupi-workflow-strip" aria-label="教师工作闭环">{steps.map((step, index) => <li key={step.id} className={index < currentIndex ? "is-done" : index === currentIndex ? "is-current" : ""}><span>{index < currentIndex ? "✓" : index + 1}</span><strong>{step.label}</strong></li>)}</ol>;
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

function DashboardView({ data, context, runningAgentCount, onEducation, onNavigate, onUpload, onOpenContext, onOpenAdmin, onOpenFile, onStartAgent }: Pick<Props, "data" | "context" | "runningAgentCount" | "onEducation" | "onNavigate" | "onUpload" | "onOpenContext" | "onOpenAdmin" | "onOpenFile" | "onStartAgent">) {
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
        <EduPiTodayWork data={data} onEducation={onEducation} />
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

function TeachingView({ data, context, query, onTask, onNavigate, onUpload, onStartAgent }: Pick<Props, "data" | "context" | "query" | "onTask" | "onNavigate" | "onUpload" | "onStartAgent">) {
  const teachingTasks = data.tasks.filter((task) => (task.trigger === "teaching_adjustment_candidate" || Boolean(task.materialId) || Boolean(task.topic)) && includesQuery(`${task.title} ${task.topic || ""} ${task.sourceEventName || ""}`, query));
  const artifacts = teachingTasks.flatMap((task) => taskArtifacts(task).map((artifact) => ({ task, artifact })));
  const knowledge = data.continuity.subjectKnowledge
    .filter((node) => includesQuery(`${node.subject} ${node.topic} ${node.commonErrors.map((item) => item.description).join(" ")}`, query))
    .sort((left, right) => right.strugglingStudents.length - left.strugglingStudents.length || String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))
    .slice(0, 6);
  const teachingMemories = data.continuity.memories.filter((memory) => memory.category === "teaching" && memory.state === "active" && includesQuery(`${memory.content} ${memory.tags.join(" ")}`, query)).slice(-6).reverse();
  const subject = [context?.subject, context?.grade].filter(Boolean).join(" · ") || "教学上下文待设置";
  const current = teachingTasks.some((task) => task.status === "planned" || task.status === "hold") ? "review" : artifacts.length > 0 ? "record" : knowledge.length > 0 ? "prepare" : "observe";
  const orderedSlots = data.timetable.slice().sort((left, right) => Number(left.day_of_week) - Number(right.day_of_week) || Number(left.period) - Number(right.period));
  const weekday = new Date().getDay() || 7;
  const nextSlot = orderedSlots.find((slot) => Number(slot.day_of_week) >= weekday) || orderedSlots[0];
  const nextSubject = nextSlot ? String(nextSlot.subject || "课程") : context?.subject || "下一课";

  return <main className="edupi-module-workspace edupi-domain-workspace">
    <header className="edupi-module-heading"><div><h1>教学</h1><p>{subject}</p></div><div className="edupi-teaching-heading__actions"><button type="button" onClick={onUpload}>导入教学重点</button><button type="button" className="is-primary" onClick={() => onStartAgent(`请为${nextSubject}${nextSlot?.class_name ? `（${String(nextSlot.class_name)}）` : ""}准备下一节课需要的教学重点、材料清单和课堂检查点，结合现有学情与教育记忆，先给我可审核的候选。`)}>准备下一节课</button></div></header>
    <section className="edupi-teaching-next"><span>下一节课</span><strong>{nextSubject}</strong><p>{nextSlot ? `周${String(nextSlot.day_of_week)} · 第 ${String(nextSlot.period)} 节${nextSlot.class_name ? ` · ${String(nextSlot.class_name)}` : ""}` : "课表待导入"}</p><button type="button" onClick={() => onNavigate("calendar")}>看课程表</button></section>
    <WorkflowStrip current={current} />
        <div className="edupi-workspace-grid">
      <section className="edupi-page-section">
        <SectionHeader title="本轮教学重点" meta={`${knowledge.length} 个知识节点`} />
        <div className="edupi-knowledge-list">{knowledge.map((node) => {
          const primaryError = [...node.commonErrors].sort((left, right) => right.count - left.count)[0];
          const studentsLabel = node.strugglingStudents.length > 0
            ? `${node.strugglingStudents.slice(0, 4).join("、")}${node.strugglingStudents.length > 4 ? `等 ${node.strugglingStudents.length} 人` : ""}`
            : "暂未标记需关注学生";
          return <details className="edupi-knowledge-row edupi-knowledge-disclosure" key={node.id}>
            <summary>
              <div><span>{node.subject}</span><strong>{node.topic}</strong></div>
              <p>{primaryError?.description || "尚未记录共性错因"}</p>
              <small>{studentsLabel}</small>
            </summary>
            <div className="edupi-disclosure-detail">
              <div>
                <strong>共性错因</strong>
                {node.commonErrors.length > 0 ? node.commonErrors.map((error) => <p key={`${node.id}:${error.description}`}>
                  {error.description} · {error.count} 次{error.students.length > 0 ? ` · ${error.students.join("、")}` : ""}
                </p>) : <p>尚未记录共性错因</p>}
              </div>
              <div>
                <strong>学生状态</strong>
                <p>{node.strugglingStudents.length > 0 ? `需继续关注：${node.strugglingStudents.join("、")}` : "暂无需继续关注学生"}</p>
                {node.masteredStudents.length > 0 ? <p>已掌握：{node.masteredStudents.join("、")}</p> : null}
              </div>
              {node.prerequisites.length > 0 ? <p>前置知识：{node.prerequisites.join("、")}</p> : null}
              <footer>
                {node.mastery !== null ? <span>掌握度 {Math.round(node.mastery * 100)}%</span> : null}
                {node.lastTaughtAt ? <span>最近教学 {shortDate(node.lastTaughtAt)}</span> : null}
                {node.lastAssessedAt ? <span>最近评估 {shortDate(node.lastAssessedAt)}</span> : null}
                {node.updatedAt ? <span>更新于 {shortDate(node.updatedAt)}</span> : null}
              </footer>
            </div>
          </details>;
        })}</div>
        {knowledge.length === 0 ? <div className="edupi-module-empty">尚未形成学科知识状态</div> : null}
      </section>
      <section className="edupi-page-section edupi-workstream">
        <SectionHeader title="正在准备" meta={teachingTasks.length ? `${teachingTasks.length} 项` : undefined} action="任务记录" onAction={() => onNavigate("tasks")} />
        <div>{teachingTasks.slice(0, 6).map((task) => <WorkItem key={taskKey(task)} task={task} agentSession={task.id ? data.taskSessions[task.id] ?? null : null} onClick={() => onTask(task, task.status === "planned" || task.status === "hold" ? "review" : "run")} />)}</div>
        {teachingTasks.length === 0 ? <div className="edupi-module-empty">暂无教学准备</div> : null}
      </section>
      <section className="edupi-page-section edupi-workspace-grid__wide">
        <SectionHeader title="教学记忆" meta={`${teachingMemories.length} 条记忆 · ${artifacts.length} 项产物`} action="教育记忆" onAction={() => onNavigate("memory")} />
        <div className="edupi-note-list">{teachingMemories.map((memory) => <details className="edupi-teaching-memory-disclosure" key={memory.id}>
          <summary><strong>{memory.content}</strong><span>{memory.tags.join(" · ") || (memory.updatedAt ? shortDate(memory.updatedAt) : "教学记忆")}</span></summary>
          <div className="edupi-disclosure-detail">
            <p>{memory.tags.length > 0 ? `标签：${memory.tags.join("、")}` : "尚未添加标签"}</p>
            <footer><span>累积 {memory.count} 次</span><span>{memory.createdAt ? `创建于 ${shortDate(memory.createdAt)}` : "创建日期待补"}{memory.updatedAt ? ` · 更新于 ${shortDate(memory.updatedAt)}` : ""}</span></footer>
          </div>
        </details>)}</div>
        {teachingMemories.length === 0 ? <div className="edupi-module-empty">课堂方法会从真实记录中逐步沉淀</div> : null}
      </section>
    </div>
  </main>;
}

function CalendarView({ data, query, onUpload, intakeBusy, calendarSelection, onCalendarSelection, onTaskDetail, onImportCalendar, onImportTimetable }: Pick<Props, "data" | "query" | "onUpload" | "intakeBusy" | "calendarSelection" | "onCalendarSelection" | "onTaskDetail" | "onImportCalendar" | "onImportTimetable">) {
  return <EduPiCalendarWorkspace data={data} query={query} onUpload={onUpload} intakeBusy={intakeBusy} selection={calendarSelection} onSelect={onCalendarSelection} onTaskDetail={onTaskDetail} onImportCalendar={onImportCalendar} onImportTimetable={onImportTimetable} />;
}

const memoryLabels: Record<string, string> = { semester: "学期", class: "班级", teaching: "教学", preferences: "教师偏好", school: "学校" };

function MemoryView({ data, query, selectedObjectId }: Pick<Props, "data" | "query" | "selectedObjectId">) {
  const memories = data.continuity.memories.filter((memory) => isUserFacingMemory(memory) && includesQuery(`${memory.content} ${memory.student || ""} ${memory.tags.join(" ")}`, query));
  const active = memories.filter((memory) => memory.state === "active").sort((left, right) => String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || "")));
  const superseded = memories.filter((memory) => memory.state === "superseded");
  const selected = active.find((memory) => `memory:${memory.id}` === selectedObjectId) || active[0] || null;
  return <main className="edupi-module-workspace edupi-record-workspace">
    <header className="edupi-module-heading"><div><h1>教育记忆</h1><p>{active.length} 条当前事实 · 只在教师工作区使用</p></div></header>
    {selected ? <article className="edupi-record-detail"><header><span>{memoryLabels[selected.category] || selected.category}</span><h2>{selected.content}</h2>{selected.student ? <strong>{selected.student}</strong> : null}</header><div className="edupi-record-detail__metrics"><span>出现 <strong>{selected.count}</strong> 次</span><span>当前事实 <strong>{active.length}</strong></span><span>旧版本 <strong>{superseded.length}</strong></span></div><section><h3>标签</h3><div className="edupi-record-tags">{selected.tags.map((tag) => <span key={tag}>{tag}</span>)}{selected.tags.length === 0 ? <em>无标签</em> : null}</div></section><footer>{selected.createdAt ? <time>创建 {shortDate(selected.createdAt)}</time> : null}{selected.updatedAt ? <time>更新 {shortDate(selected.updatedAt)}</time> : null}</footer></article> : <div className="edupi-module-empty">还没有可展示的长期记忆</div>}
  </main>;
}

function InsightsView({ data, query, selectedObjectId }: Pick<Props, "data" | "query" | "selectedObjectId">) {
  const meaningful = data.continuity.insights.filter((insight) => !insight.content.startsWith("[主题候选]") && (includesQuery(insight.content, query) || insight.evidenceIds.some((evidenceId) => includesQuery(evidenceId, query))));
  const signals = data.continuity.signals.filter((signal) => includesQuery(`${signal.content} ${signal.related.join(" ")}`, query)).sort((left, right) => right.strength - left.strength);
  const selectedInsight = meaningful.find((insight) => `insight:${insight.id}` === selectedObjectId) || (selectedObjectId?.startsWith("signal:") ? null : meaningful[0]) || null;
  const selectedSignal = signals.find((signal) => `signal:${signal.id}` === selectedObjectId) || (!selectedInsight ? signals[0] : null) || null;
  return <main className="edupi-module-workspace edupi-record-workspace">
    <header className="edupi-module-heading"><div><h1>观察与洞察</h1><p>{data.continuity.lastDreamAt ? `上次整理 ${shortDate(data.continuity.lastDreamAt)}` : "尚未运行后台整理"}</p></div></header>
    {selectedInsight ? <article className="edupi-record-detail"><header><span>{selectedInsight.status === "surfaced" ? "已浮出" : "仍在酝酿"}</span><h2>{cleanInsight(selectedInsight.content)}</h2></header><div className="edupi-record-detail__metrics"><span>置信度 <strong>{Math.round(selectedInsight.confidence * 100)}%</strong></span><span>依据 <strong>{selectedInsight.evidenceIds.length}</strong></span><span>状态 <strong>{selectedInsight.status === "surfaced" ? "可查看" : "积累中"}</strong></span></div><section><h3>来源依据</h3><div className="edupi-record-tags">{selectedInsight.evidenceIds.map((id) => <span key={id}>依据 {id.slice(-6)}</span>)}{selectedInsight.evidenceIds.length === 0 ? <em>暂无依据</em> : null}</div></section><footer>{selectedInsight.createdAt ? <time>记录 {shortDate(selectedInsight.createdAt)}</time> : null}{selectedInsight.surfacedAt ? <time>浮出 {shortDate(selectedInsight.surfacedAt)}</time> : null}</footer></article> : selectedSignal ? <article className="edupi-record-detail"><header><span>弱信号</span><h2>{selectedSignal.content}</h2></header><div className="edupi-record-detail__metrics"><span>出现 <strong>{selectedSignal.strength}</strong> 次</span><span>关联 <strong>{selectedSignal.related.length}</strong></span></div><section><h3>关联记录</h3><div className="edupi-record-tags">{selectedSignal.related.map((item) => <span key={item}>{item}</span>)}{selectedSignal.related.length === 0 ? <em>暂无关联</em> : null}</div></section><footer>{selectedSignal.createdAt ? <time>首次 {shortDate(selectedSignal.createdAt)}</time> : null}{selectedSignal.lastSeenAt ? <time>最近 {shortDate(selectedSignal.lastSeenAt)}</time> : null}</footer></article> : <div className="edupi-module-empty">暂无观察记录</div>}
  </main>;
}

function GrowthView({ data, query, selectedObjectId, onOpenFile, onNavigate }: Pick<Props, "data" | "query" | "selectedObjectId" | "onOpenFile" | "onNavigate">) {
  const documents = data.continuity.documents.filter((document) => includesQuery(`${document.title} ${document.excerpt}`, query));
  const themes = data.continuity.themes.filter((theme) => includesQuery(theme.topic, query)).slice(0, 12);
  const confirmedArtifacts = data.tasks.flatMap((task) => taskArtifacts(task).filter((artifact) => artifact.state === "confirmed").map((artifact) => ({ task, artifact })));
  const selectedDocument = documents.find((document) => `document:${document.id}` === selectedObjectId) || (selectedObjectId?.startsWith("theme:") ? null : documents[0]) || null;
  const selectedTheme = themes.find((theme) => `theme:${theme.topic}` === selectedObjectId) || (!selectedDocument ? themes[0] : null) || null;
  return <main className="edupi-module-workspace edupi-record-workspace">
    <header className="edupi-module-heading"><div><h1>成长</h1><p>{documents.length} 份工作沉淀 · {confirmedArtifacts.length} 项确认成果</p></div><button type="button" onClick={() => onNavigate("artifacts")}>教学产物</button></header>
    {selectedDocument ? <article className="edupi-record-detail"><header><span>{({ daily: "日记录", weekly: "周复盘", insight: "洞察", dream: "后台整理" } as Record<string, string>)[selectedDocument.kind] || "记录"}</span><h2>{selectedDocument.title}</h2></header><div className="edupi-record-detail__metrics"><span>沉淀记录 <strong>{documents.length}</strong></span><span>确认成果 <strong>{confirmedArtifacts.length}</strong></span><span>学习候选 <strong>{themes.length}</strong></span></div><section><h3>摘要</h3><p>{selectedDocument.excerpt}</p></section><footer>{selectedDocument.date ? <time>{shortDate(selectedDocument.date)}</time> : null}<button type="button" onClick={() => onOpenFile(workspaceFile(data.workspace, selectedDocument.path))}>打开记录</button></footer></article> : selectedTheme ? <article className="edupi-record-detail"><header><span>{selectedTheme.skillCandidate ? "学习候选" : "持续观察"}</span><h2>{selectedTheme.topic}</h2></header><div className="edupi-record-detail__metrics"><span>出现 <strong>{selectedTheme.occurrences}</strong> 次</span><span>依据 <strong>{selectedTheme.evidenceIds.length}</strong></span><span>状态 <strong>{growthReviewStateLabel(selectedTheme.reviewState) || "观察中"}</strong></span></div><section><h3>来源依据</h3><div className="edupi-record-tags">{selectedTheme.evidenceIds.map((id) => <span key={id}>依据 {id.slice(-6)}</span>)}</div></section><footer>{selectedTheme.firstSeenAt ? <time>首次 {shortDate(selectedTheme.firstSeenAt)}</time> : null}{selectedTheme.lastSeenAt ? <time>最近 {shortDate(selectedTheme.lastSeenAt)}</time> : null}</footer></article> : <div className="edupi-module-empty">暂无成长记录</div>}
  </main>;
}

function MaterialsView({ data, query, stagedMaterials, stagingBusy, stagingMessage, onTask, onUpload, onIntakeMaterial, onRemoveStagedMaterial }: Pick<Props, "data" | "query" | "stagedMaterials" | "stagingBusy" | "stagingMessage" | "onTask" | "onUpload" | "onIntakeMaterial" | "onRemoveStagedMaterial">) {
  const tasks = data.tasks.filter((task) => (task.materialId || task.trigger === "teaching_adjustment_candidate") && includesQuery(`${task.title} ${JSON.stringify(task.evidence)}`, query));
  const accepted = (data.intakeTargets ?? []).filter((target) => target.projectionKind === "material_intake" && target.status === "accepted").slice().reverse();
  const kindLabel = (kind: MaterialStagingDescriptor["kind"]) => kind === "image" ? "图片" : kind === "pdf" ? "PDF" : "Word";
  return <main className="edupi-module-workspace"><header className="edupi-module-heading"><div><h1>材料</h1><p>原始材料、来源与处理状态</p></div><button type="button" disabled={stagingBusy} onClick={onUpload}>{stagingBusy ? "处理中…" : "上传材料"}</button></header><section className="edupi-page-section edupi-staged-materials"><SectionHeader title="安全暂存" meta={`${stagedMaterials.length} 份`} /><div>{stagedMaterials.map((item) => <article key={item.staging_id}><span>{kindLabel(item.kind)}</span><div><strong>{item.original_name}</strong><small>{Math.ceil(item.expected_size_bytes / 1024)} KB · 等待接入</small></div><div className="edupi-staged-materials__actions"><button type="button" disabled={stagingBusy} onClick={() => void onIntakeMaterial(item).catch(() => {})}>{stagingBusy ? "接入中" : "接入 EduPi"}</button><button type="button" disabled={stagingBusy} onClick={() => void onRemoveStagedMaterial(item)}>移除</button></div></article>)}</div>{stagedMaterials.length === 0 ? <div className="edupi-module-empty">暂无暂存材料</div> : null}{stagingMessage ? <p className="edupi-staged-materials__message">{stagingMessage}</p> : null}</section><section className="edupi-evidence-table"><div className="edupi-evidence-table__head"><span>材料 / 任务</span><span>来源</span><span>日期</span><span>状态</span></div>{accepted.map((target) => <div className="edupi-evidence-table__receipt" key={target.targetId}><span><strong>{target.title}</strong><small>{target.summary}</small></span><span>教师上传</span><span>{target.reviewedAt ? shortDate(target.reviewedAt) : "—"}</span><span className="is-confirmed">已接入</span></div>)}{tasks.map((task) => <button type="button" key={taskKey(task)} onClick={() => onTask(task, "evidence")}><span><strong>{taskDisplayTitle(task)}</strong><small>{taskTypeLabel(task)}</small></span><span>{task.sourceEventName || task.sourceEventId || "待核对"}</span><span>{task.sourceEventDate || task.dueDate || "待确认"}</span><span className="is-candidate">{taskEvidenceRows(task).some((row) => row.value === "候选") ? "候选" : "教师事实"}</span></button>)}{tasks.length === 0 && accepted.length === 0 ? <div className="edupi-module-empty">暂无已接入材料</div> : null}</section></main>;
}

function ArtifactsView({ data, query, onTask }: Pick<Props, "data" | "query" | "onTask">) {
  const rows = data.tasks.flatMap((task) => taskArtifacts(task).map((artifact) => ({ task, artifact }))).filter(({ artifact }) => includesQuery(`${artifact.title} ${artifact.summary}`, query));
  return <main className="edupi-module-workspace"><header className="edupi-module-heading"><div><h1>教学产物</h1><p>{rows.length} 项</p></div></header><section className="edupi-artifact-table"><div className="edupi-artifact-table__head"><span>产物</span><span>来源任务</span><span>状态</span></div>{rows.map(({ task, artifact }) => <button type="button" key={artifact.id} onClick={() => onTask(task, "artifact")}><span><strong>{artifact.title}</strong></span><span>{taskDisplayTitle(task)}</span><span className={`is-${artifact.state}`}>{artifact.state === "confirmed" ? "已确认" : "候选"}</span></button>)}{rows.length === 0 ? <div className="edupi-module-empty">暂无教学产物</div> : null}</section></main>;
}

export function EduPiWorkspaceViews(props: Props) {
  if (props.view === "dashboard") return <DashboardView data={props.data} context={props.context} runningAgentCount={props.runningAgentCount} onEducation={props.onEducation} onNavigate={props.onNavigate} onUpload={props.onUpload} onOpenContext={props.onOpenContext} onOpenAdmin={props.onOpenAdmin} onOpenFile={props.onOpenFile} onStartAgent={props.onStartAgent} />;
  if (props.view === "workspace") return <EduPiWorkspaceBoard data={props.data} query={props.query} onTaskDetail={props.onTaskDetail} onCreateTask={props.onCreateTask} onMoveTask={props.onMoveTask} />;
  if (props.view === "teaching") return <TeachingView data={props.data} context={props.context} query={props.query} onTask={props.onTask} onNavigate={props.onNavigate} onUpload={props.onUpload} onStartAgent={props.onStartAgent} />;
  if (props.view === "homeroom" || props.view === "students") return <EduPiStudentWorkspace mode={props.view} data={props.data} context={props.context} query={props.query} selectedStudentId={props.selectedStudentId} onEducation={props.onEducation} onTask={(task) => props.onTask(task, "brief")} />;
  if (props.view === "calendar") return <CalendarView data={props.data} query={props.query} onUpload={props.onUpload} intakeBusy={props.intakeBusy} calendarSelection={props.calendarSelection} onCalendarSelection={props.onCalendarSelection} onTaskDetail={props.onTaskDetail} onImportCalendar={props.onImportCalendar} onImportTimetable={props.onImportTimetable} />;
  if (props.view === "memory") return <MemoryView data={props.data} query={props.query} selectedObjectId={props.selectedObjectId} />;
  if (props.view === "insights") return <InsightsView data={props.data} query={props.query} selectedObjectId={props.selectedObjectId} />;
  if (props.view === "growth") return <GrowthView data={props.data} query={props.query} selectedObjectId={props.selectedObjectId} onOpenFile={props.onOpenFile} onNavigate={props.onNavigate} />;
  if (props.view === "materials") return <MaterialsView data={props.data} query={props.query} stagedMaterials={props.stagedMaterials} stagingBusy={props.stagingBusy} stagingMessage={props.stagingMessage} onTask={props.onTask} onUpload={props.onUpload} onIntakeMaterial={props.onIntakeMaterial} onRemoveStagedMaterial={props.onRemoveStagedMaterial} />;
  return <ArtifactsView data={props.data} query={props.query} onTask={props.onTask} />;
}
