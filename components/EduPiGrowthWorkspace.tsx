"use client";

import type { EducationContract, TeacherTask } from "@/lib/edupi-education-contract";
import { growthReviewStateLabel, routePart } from "@/lib/edupi-domain-navigation";
import { taskArtifacts, taskDisplayTitle } from "@/lib/edupi-workbench";

function shortDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function EduPiGrowthWorkspace({ data, query, selectedObjectId, onOpenFile, onTask }: { data: EducationContract; query: string; selectedObjectId: string | null; onOpenFile: (path: string) => void; onTask: (task: TeacherTask) => void }) {
  const category = routePart(selectedObjectId, "growth", "teacher");
  const documents = data.continuity.documents.filter((item) => !query || `${item.title} ${item.excerpt}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const artifacts = data.tasks.flatMap((task) => taskArtifacts(task).filter((artifact) => artifact.state === "confirmed").map((artifact) => ({ task, artifact }))).filter((item) => !query || `${item.artifact.title} ${item.artifact.summary}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const themes = data.continuity.themes.filter((item) => !query || item.topic.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const workspaceFile = (relative: string) => {
    const separator = data.workspace.includes("\\") ? "\\" : "/";
    return `${data.workspace.replace(/[\\/]$/, "")}${separator}${relative.replace(/^[\\/]+/, "").replace(/[\\/]/g, separator)}`;
  };

  return <main className="edupi-module-workspace edupi-database-workspace">
    <header className="edupi-module-heading"><div><span>成长 / {category === "teacher" ? "教师专业成长" : "EduPi 能力成长"}</span><h1>{category === "teacher" ? "教师专业成长" : "EduPi 能力成长"}</h1><p>{category === "teacher" ? "沉淀教师在教学中的过程证据与可复用成果" : "记录 EduPi 从真实工作中形成的主题与能力候选"}</p></div></header>
    {category === "teacher" ? <section className="edupi-database"><div className="edupi-database__head edupi-growth-db-grid"><span>类型</span><span>内容</span><span>来源</span><span>日期</span><span>动作</span></div>{documents.map((item) => <div className="edupi-database-static-row edupi-growth-db-grid" key={item.id}><span>{item.kind === "weekly" ? "周复盘" : item.kind === "daily" ? "日记录" : "专业反思"}</span><strong>{item.title}</strong><span>工作沉淀</span><time>{shortDate(item.date)}</time><button type="button" onClick={() => onOpenFile(workspaceFile(item.path))}>打开</button></div>)}{artifacts.map(({ task, artifact }) => <div className="edupi-database-static-row edupi-growth-db-grid" key={artifact.id}><span>确认成果</span><strong>{artifact.title}</strong><span>{taskDisplayTitle(task)}</span><time>{task.reviewedAt ? shortDate(task.reviewedAt) : "—"}</time><button type="button" onClick={() => onTask(task)}>查看</button></div>)}{documents.length + artifacts.length === 0 ? <div className="edupi-database__empty">暂无专业成长记录</div> : null}</section> : <section className="edupi-database"><div className="edupi-database__head edupi-edupi-growth-db-grid"><span>学习主题</span><span>状态</span><span>出现次数</span><span>依据</span><span>最近时间</span></div>{themes.map((item) => <details className="edupi-database-row" key={item.topic}><summary className="edupi-edupi-growth-db-grid"><strong>{item.topic}</strong><span>{item.skillCandidate ? growthReviewStateLabel(item.reviewState) : "持续观察"}</span><span>{item.occurrences}</span><span>{item.evidenceIds.length}</span><time>{shortDate(item.lastSeenAt)}</time></summary><div className="edupi-database-row__detail"><div><span>首次出现</span><strong>{shortDate(item.firstSeenAt)}</strong></div><div><span>审核状态</span><strong>{growthReviewStateLabel(item.reviewState)}</strong></div><div><span>用途</span><strong>用于改进 EduPi 的工作方式</strong></div></div></details>)}{themes.length === 0 ? <div className="edupi-database__empty">暂无 EduPi 能力成长记录</div> : null}</section>}
  </main>;
}
