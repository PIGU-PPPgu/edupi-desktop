"use client";

import type { TeacherTask } from "@/lib/edupi-education-contract";
import { taskDisplayTitle, taskKey, taskTypeLabel, type WorkbenchView } from "@/lib/edupi-workbench";

type ArtworkKind = "chat" | "teaching" | "students" | "materials" | "workspace" | "calendar" | "insights";

const services: Array<{ title: string; view: WorkbenchView; art: ArtworkKind }> = [
  { title: "课前准备", view: "teaching", art: "teaching" },
  { title: "学生档案", view: "students", art: "students" },
  { title: "材料整理", view: "materials", art: "materials" },
];
const boards: Array<{ title: string; view: WorkbenchView; art: ArtworkKind }> = [
  { title: "工作区", view: "workspace", art: "workspace" },
  { title: "日程", view: "calendar", art: "calendar" },
  { title: "观察与洞察", view: "insights", art: "insights" },
];

function Arrow() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12" /></svg>;
}

function HomeArtwork({ kind }: { kind: ArtworkKind }) {
  return <span className={`edupi-home-art is-${kind}`} aria-hidden="true">
    <svg viewBox="0 0 120 96" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse className="edupi-home-art__shadow" cx="62" cy="83" rx="38" ry="5" stroke="none" />
      <rect className="edupi-home-art__back" x="35" y="17" width="58" height="58" rx="8" transform="rotate(9 64 46)" stroke="none" />
      <g className="edupi-home-art__paper">
        {kind === "chat" ? <><path d="M28 24h65v43H61L42 80V67H28z" /><path d="M43 38c8-3 22-3 33 0M52 38v17M68 38v13c0 5 2 6 6 4" /></> : kind === "students" ? <><rect x="35" y="16" width="54" height="61" rx="7" /><circle cx="62" cy="36" r="9" /><path d="M47 61c2-9 8-14 15-14s13 5 15 14" /></> : kind === "workspace" ? <><rect x="24" y="21" width="74" height="54" rx="7" /><path d="M48 21v54M74 21v54M32 33h8M56 33h10M82 33h8M32 44h8M56 44h10M82 44h8M56 55h10" /></> : kind === "calendar" ? <><rect x="32" y="22" width="58" height="55" rx="8" /><path d="M46 16v13M76 16v13M32 38h58M45 49h7M65 49h7M45 61h7M65 61h7" /></> : kind === "insights" ? <><rect x="32" y="17" width="58" height="60" rx="7" /><path d="M44 62V35M44 62h35M50 54l10-10 9 5 11-18" /></> : <><rect x="35" y="16" width="54" height="61" rx="7" /><path d="M47 32h30M47 42h30M47 52h20" />{kind === "materials" ? <path d="m74 57 10 10M77 54l10 10" /> : <path d="m70 60 4 4 8-9" />}</>}
      </g>
      <circle className="edupi-home-art__medal" cx="32" cy="65" r="15" />
      <path className="edupi-home-art__spark" d="M32 58v14M25 65h14" />
      <path className="edupi-home-art__accent" d="m100 22 2-5 2 5 5 2-5 2-2 5-2-5-5-2z" stroke="none" />
    </svg>
  </span>;
}

export function EduPiHomeLaunchpad({ tasks, tasksAvailable, scopeLabel, onNavigate, onOpenTask }: {
  tasks: TeacherTask[];
  tasksAvailable: boolean;
  scopeLabel: string;
  onNavigate: (view: WorkbenchView) => void;
  onOpenTask: (task: TeacherTask) => void;
}) {
  return <div className="edupi-home-launchpad">
    <div className="edupi-home-launchpad__top">
      <section className="edupi-home-start" aria-label="快捷开始">
        <HomeArtwork kind="chat" />
        <div><h2>AI 协作</h2>{scopeLabel ? <p>{scopeLabel}</p> : null}</div>
        <button type="button" onClick={() => onNavigate("chat")}>打开对话 <Arrow /></button>
      </section>
      <section className="edupi-home-services" aria-labelledby="edupi-home-services-title">
        <header><h2 id="edupi-home-services-title">常用服务</h2></header>
        <div>{services.map(item => <button type="button" key={item.view} onClick={() => onNavigate(item.view)}><HomeArtwork kind={item.art} /><strong>{item.title}</strong></button>)}</div>
      </section>
    </div>
    <section className="edupi-home-recent" aria-labelledby="edupi-home-recent-title">
      <header><h2 id="edupi-home-recent-title">近期任务</h2><button type="button" onClick={() => onNavigate("workspace")}>全部任务 <Arrow /></button></header>
      {tasks.length ? <ul>{tasks.slice(0, 6).map((task, index) => <li key={taskKey(task)}><button type="button" aria-label={`打开任务：${taskDisplayTitle(task)}`} onClick={() => onOpenTask(task)}><span className={`edupi-home-task-orb is-${index % 3}`} aria-hidden="true"><i /><b /></span><span className="edupi-home-recent__text"><strong>{taskDisplayTitle(task)}</strong><small>{taskTypeLabel(task)}{task.dueDate ? ` · ${task.dueDate.slice(5).replace("-", "/")} 截止` : " · 日期待确认"}</small></span><span className="edupi-home-recent__arrow"><Arrow /></span></button></li>)}</ul> : <p className="edupi-home-recent__empty">{tasksAvailable ? "暂无待处理任务" : "任务暂不可用"}</p>}
    </section>
    <section className="edupi-home-boards" aria-labelledby="edupi-home-boards-title">
      <header><h2 id="edupi-home-boards-title">看板</h2></header>
      <div>{boards.map(item => <button type="button" key={item.view} className={`is-${item.art}`} onClick={() => onNavigate(item.view)}><HomeArtwork kind={item.art} /><strong>{item.title}</strong><span><Arrow /></span></button>)}</div>
    </section>
  </div>;
}
