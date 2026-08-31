"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import type { CalendarFact, EducationContract, TeacherTask } from "@/lib/edupi-education-contract";
import type { CalendarItemSelection } from "@/lib/edupi-calendar-model";
import type { TeacherContextSnapshot } from "@/lib/edupi-onboarding-types";
import type { TaskSessionBinding } from "@/lib/edupi-task-sessions";
import {
  isUserFacingMemory,
  groupEducationInsights,
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

function TeachingView({ data, context, query, onTask, onNavigate }: Pick<Props, "data" | "context" | "query" | "onTask" | "onNavigate">) {
  const teachingTasks = data.tasks.filter((task) => (task.trigger === "teaching_adjustment_candidate" || Boolean(task.materialId) || Boolean(task.topic)) && includesQuery(`${task.title} ${task.topic || ""} ${task.sourceEventName || ""}`, query));
  const artifacts = teachingTasks.flatMap((task) => taskArtifacts(task).map((artifact) => ({ task, artifact })));
  const knowledge = data.continuity.subjectKnowledge
    .filter((node) => includesQuery(`${node.subject} ${node.topic} ${node.commonErrors.map((item) => item.description).join(" ")}`, query))
    .sort((left, right) => right.strugglingStudents.length - left.strugglingStudents.length || String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))
    .slice(0, 6);
  const teachingMemories = data.continuity.memories.filter((memory) => memory.category === "teaching" && memory.state === "active" && includesQuery(`${memory.content} ${memory.tags.join(" ")}`, query)).slice(-6).reverse();
  const subject = [context?.subject, context?.grade].filter(Boolean).join(" · ") || "教学上下文待设置";
  const current = teachingTasks.some((task) => task.status === "planned" || task.status === "hold") ? "review" : artifacts.length > 0 ? "record" : knowledge.length > 0 ? "prepare" : "observe";

  return <main className="edupi-module-workspace edupi-domain-workspace">
    <header className="edupi-module-heading"><div><h1>教学</h1><p>{subject}</p></div><button type="button" onClick={() => onNavigate("materials")}>打开材料</button></header>
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

function MemoryView({ data, query }: Pick<Props, "data" | "query">) {
  const memories = data.continuity.memories.filter((memory) => isUserFacingMemory(memory) && includesQuery(`${memory.content} ${memory.student || ""} ${memory.tags.join(" ")}`, query));
  const active = memories.filter((memory) => memory.state === "active").sort((left, right) => String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || "")));
  const superseded = memories.filter((memory) => memory.state === "superseded");
  return <main className="edupi-module-workspace edupi-continuity-workspace">
    <header className="edupi-module-heading"><div><h1>教育记忆</h1><p>{active.length} 条当前事实 · 只在教师工作区使用</p></div></header>
    <div className="edupi-memory-groups">{memoryCategoriesFor(active).map(({ category, items }) => <section className="edupi-page-section" key={category}><SectionHeader title={memoryLabels[category] || category} meta={`${items.length} 条`} /><div className="edupi-memory-list">{items.slice(0, 8).map((memory) => <details className="edupi-memory-record-disclosure" key={memory.id}>
      <summary>{memory.student ? <span>{memory.student}</span> : null}<strong>{memory.content}</strong><footer><small>{memory.tags.slice(0, 4).join(" · ") || "长期记忆"}</small><time>{memory.updatedAt || memory.createdAt ? shortDate(memory.updatedAt || memory.createdAt || "") : ""}</time></footer></summary>
      <div className="edupi-disclosure-detail">
        <p>{memory.tags.length > 0 ? `标签：${memory.tags.join("、")}` : "尚未添加标签"}</p>
        <footer><span>累积 {memory.count} 次</span><span>当前事实</span>{memory.createdAt ? <time>创建于 {shortDate(memory.createdAt)}</time> : null}{memory.updatedAt ? <time>更新于 {shortDate(memory.updatedAt)}</time> : null}</footer>
      </div>
    </details>)}</div>{items.length > 8 ? <details className="edupi-memory-more"><summary>再看 {items.length - 8} 条</summary><div>{items.slice(8).map((memory) => <p key={memory.id}>{memory.content}</p>)}</div></details> : null}</section>)}</div>
    {active.length === 0 ? <div className="edupi-module-empty">还没有可展示的长期记忆</div> : null}
    {superseded.length > 0 ? <details className="edupi-superseded-memory"><summary>查看 {superseded.length} 条已更新的旧记忆</summary><div>{superseded.map((memory) => <p key={memory.id}>{memory.content}</p>)}</div></details> : null}
  </main>;
}

function memoryCategoriesFor(memories: EducationContract["continuity"]["memories"]): Array<{ category: string; items: typeof memories }> {
  return ["semester", "class", "teaching", "preferences", "school"].flatMap((category) => {
    const items = memories.filter((memory) => memory.category === category);
    return items.length > 0 ? [{ category, items }] : [];
  });
}

function InsightsView({ data, query }: Pick<Props, "data" | "query">) {
  const meaningful = data.continuity.insights.filter((insight) => !insight.content.startsWith("[主题候选]") && (includesQuery(insight.content, query) || insight.evidenceIds.some((evidenceId) => includesQuery(evidenceId, query))));
  const surfaced = groupEducationInsights(meaningful.filter((insight) => insight.status === "surfaced")).slice(0, 6);
  const brewing = meaningful.filter((insight) => insight.status === "brewing").slice(-8).reverse();
  const signals = data.continuity.signals.filter((signal) => includesQuery(`${signal.content} ${signal.related.join(" ")}`, query)).sort((left, right) => right.strength - left.strength);
  return <main className="edupi-module-workspace edupi-continuity-workspace">
    <header className="edupi-module-heading"><div><h1>观察与洞察</h1><p>{data.continuity.lastDreamAt ? `上次整理 ${shortDate(data.continuity.lastDreamAt)}` : "尚未运行后台整理"}</p></div></header>
    <div className="edupi-insight-layout">
      <section className="edupi-page-section edupi-insight-main">
        <SectionHeader title="已经浮出" meta={`${surfaced.length} 个主题`} />
        <div className="edupi-insight-list">{surfaced.map((group) => <details className="edupi-insight-disclosure" key={group.topic}>
          <summary><span aria-hidden="true">◌</span><div><small>{group.topic}</small><strong>{cleanInsight(group.insight.content)}</strong><footer><span>{group.insight.evidenceIds.length} 条可追溯依据{group.relatedCount > 1 ? ` · 合并 ${group.relatedCount} 条同主题记录` : ""}</span><time>{group.insight.createdAt ? shortDate(group.insight.createdAt) : ""}</time></footer></div></summary>
          <div className="edupi-disclosure-detail">
            <p>{group.insight.evidenceIds.length > 0 ? `已保留 ${group.insight.evidenceIds.length} 条来源记录` : "暂无可追溯来源记录"}</p>
            <footer><span>置信度 {Math.round(group.insight.confidence * 100)}%</span>{group.relatedCount > 1 ? <span>同主题记录 {group.relatedCount} 条</span> : null}{group.insight.surfacedAt ? <time>浮出于 {shortDate(group.insight.surfacedAt)}</time> : null}</footer>
          </div>
        </details>)}</div>
        {surfaced.length === 0 ? <div className="edupi-module-empty">暂无已浮出的洞察</div> : null}
      </section>
      <aside>
        <section className="edupi-page-section">
          <SectionHeader title="仍在观察" meta={`${signals.length} 个弱信号`} />
          <div className="edupi-signal-list">{signals.map((signal) => <details className="edupi-signal-disclosure" key={signal.id}>
            <summary><strong>{signal.content}</strong><span>出现 {signal.strength} 次{signal.related.length ? ` · ${signal.related.join("、")}` : ""}</span></summary>
            <div className="edupi-disclosure-detail"><p>{signal.related.length > 0 ? `关联记录：${signal.related.join("、")}` : "暂无关联记录"}</p><footer>{signal.createdAt ? <time>首次出现 {shortDate(signal.createdAt)}</time> : null}{signal.lastSeenAt ? <time>最近出现 {shortDate(signal.lastSeenAt)}</time> : null}</footer></div>
          </details>)}</div>
          {signals.length === 0 ? <div className="edupi-module-empty">暂无弱信号</div> : null}
        </section>
        <section className="edupi-page-section">
          <SectionHeader title="尚未浮出" meta={`${brewing.length} 条`} />
          <div className="edupi-brewing-list">{brewing.map((insight) => <details className="edupi-brewing-disclosure" key={insight.id}>
            <summary><strong>{cleanInsight(insight.content)}</strong><span>继续积累证据</span></summary>
            <div className="edupi-disclosure-detail"><p>状态：酝酿中 · 已保留 {insight.evidenceIds.length} 条来源记录</p><footer>{insight.createdAt ? <time>记录于 {shortDate(insight.createdAt)}</time> : null}</footer></div>
          </details>)}</div>
          {brewing.length === 0 ? <div className="edupi-module-empty">暂无酝酿中的判断</div> : null}
        </section>
      </aside>
    </div>
  </main>;
}

function GrowthView({ data, query, onOpenFile, onNavigate }: Pick<Props, "data" | "query" | "onOpenFile" | "onNavigate">) {
  const documents = data.continuity.documents.filter((document) => includesQuery(`${document.title} ${document.excerpt}`, query));
  const themes = data.continuity.themes.filter((theme) => includesQuery(theme.topic, query)).slice(0, 12);
  const confirmedArtifacts = data.tasks.flatMap((task) => taskArtifacts(task).filter((artifact) => artifact.state === "confirmed").map((artifact) => ({ task, artifact })));
  const documentKind: Record<string, string> = { daily: "日", weekly: "周", insight: "察", dream: "整" };
  return <main className="edupi-module-workspace edupi-continuity-workspace">
    <header className="edupi-module-heading"><div><h1>成长</h1><p>从日常工作中留下可复用的证据</p></div></header>
    <div className="edupi-growth-grid">
      <section className="edupi-page-section edupi-growth-documents">
        <SectionHeader title="沉淀记录" meta={`${documents.length} 份`} />
        <div>{documents.map((document) => <button type="button" key={document.id} onClick={() => onOpenFile(workspaceFile(data.workspace, document.path))}><span>{documentKind[document.kind]}</span><div><strong>{document.title}</strong><p>{document.excerpt}</p><small>{document.date ? shortDate(document.date) : document.path}</small></div><em>打开 ›</em></button>)}</div>
        {documents.length === 0 ? <div className="edupi-module-empty">日常简报、周报与反思会在这里形成时间线</div> : null}
      </section>
      <section className="edupi-page-section edupi-growth-themes">
        <SectionHeader title="EduPi 学习候选" meta="不会自动晋级" />
        <div>{themes.map((theme) => {
          const reviewStateLabel = growthReviewStateLabel(theme.reviewState);
          return <details className="edupi-growth-theme-disclosure" key={theme.topic}>
            <summary><div><strong>{theme.topic}</strong><span>在 {theme.occurrences} 次后台整理中出现</span></div><em className={theme.skillCandidate ? "is-candidate" : ""}>{theme.skillCandidate ? theme.reviewState === "pending_review" ? "待验证" : "候选" : "观察中"}</em><small>{theme.evidenceIds.length} 条依据</small></summary>
            <div className="edupi-disclosure-detail"><p>{theme.evidenceIds.length > 0 ? `已保留 ${theme.evidenceIds.length} 条来源依据` : "暂无来源依据"}</p><footer>{reviewStateLabel ? <span>审核状态：{reviewStateLabel}</span> : null}{theme.firstSeenAt ? <time>首次出现 {shortDate(theme.firstSeenAt)}</time> : null}{theme.lastSeenAt ? <time>最近出现 {shortDate(theme.lastSeenAt)}</time> : null}</footer></div>
          </details>;
        })}</div>
        {themes.length === 0 ? <div className="edupi-module-empty">尚未形成学习候选</div> : null}
      </section>
      <section className="edupi-page-section edupi-growth-evidence">
        <SectionHeader title="已确认成果" meta={`${confirmedArtifacts.length} 项`} action="全部产物" onAction={() => onNavigate("artifacts")} />
        <div>{confirmedArtifacts.slice(0, 8).map(({ task, artifact }) => <div key={artifact.id}><strong>{artifact.title}</strong><span>{taskDisplayTitle(task)}</span></div>)}</div>
        {confirmedArtifacts.length === 0 ? <div className="edupi-module-empty">经过教师确认的产物会进入这里</div> : null}
      </section>
    </div>
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
  if (props.view === "teaching") return <TeachingView data={props.data} context={props.context} query={props.query} onTask={props.onTask} onNavigate={props.onNavigate} />;
  if (props.view === "homeroom" || props.view === "students") return <EduPiStudentWorkspace mode={props.view} data={props.data} context={props.context} query={props.query} selectedStudentId={props.selectedStudentId} onEducation={props.onEducation} onTask={(task) => props.onTask(task, "brief")} />;
  if (props.view === "calendar") return <CalendarView data={props.data} query={props.query} onUpload={props.onUpload} intakeBusy={props.intakeBusy} calendarSelection={props.calendarSelection} onCalendarSelection={props.onCalendarSelection} onTaskDetail={props.onTaskDetail} onImportCalendar={props.onImportCalendar} onImportTimetable={props.onImportTimetable} />;
  if (props.view === "memory") return <MemoryView data={props.data} query={props.query} />;
  if (props.view === "insights") return <InsightsView data={props.data} query={props.query} />;
  if (props.view === "growth") return <GrowthView data={props.data} query={props.query} onOpenFile={props.onOpenFile} onNavigate={props.onNavigate} />;
  if (props.view === "materials") return <MaterialsView data={props.data} query={props.query} stagedMaterials={props.stagedMaterials} stagingBusy={props.stagingBusy} stagingMessage={props.stagingMessage} onTask={props.onTask} onUpload={props.onUpload} onIntakeMaterial={props.onIntakeMaterial} onRemoveStagedMaterial={props.onRemoveStagedMaterial} />;
  return <ArtifactsView data={props.data} query={props.query} onTask={props.onTask} />;
}
