"use client";

import { useState } from "react";
import { EduPiTeachingMethodEditor } from "./EduPiTeachingMethodEditor";

import type { EducationContract, TeacherTask } from "@/lib/edupi-education-contract";
import { routePart } from "@/lib/edupi-domain-navigation";
import type { EduPiTeachingSkillLifecycle } from "@/lib/edupi-platform-client";
import { confirmedTaskArtifacts, taskDisplayTitle } from "@/lib/edupi-workbench";

function shortDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

const SKILL_STATE_LABELS: Record<string, string> = { draft: "草稿", trial: "试用中", validated: "已验证", published: "已发布", retired: "已停用" };

export function EduPiGrowthWorkspace({ data, teachingSkills, query, selectedObjectId, onOpenFile, onTask, onStartAgent }: { data: EducationContract; teachingSkills: EduPiTeachingSkillLifecycle; query: string; selectedObjectId: string | null; onOpenFile: (path: string) => void; onTask: (task: TeacherTask) => void; onStartAgent: (prompt: string, mode?: "insert" | "replace") => void }) {
  const category = routePart(selectedObjectId, "growth", "teacher");
  const [creating, setCreating] = useState(false);
  const documents = data.continuity.documents.filter((item) => item.kind === "weekly" && (!query || `${item.title} ${item.excerpt}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
  const artifacts = confirmedTaskArtifacts(data.tasks, query);
  const skills = teachingSkills.skills.filter((item) => !query || `${item.title} ${item.lifecycleState} ${item.evidenceIds.join(" ")}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const growthSource = data.dataSources.growth;
  const workspaceFile = (relative: string) => {
    const separator = data.workspace.includes("\\") ? "\\" : "/";
    return `${data.workspace.replace(/[\\/]$/, "")}${separator}${relative.replace(/^[\\/]+/, "").replace(/[\\/]/g, separator)}`;
  };

  return <main className="edupi-module-workspace edupi-database-workspace">
    <header className="edupi-module-heading"><div><h1>{category === "teacher" ? "教师专业成长" : "EduPi 能力成长"}</h1><p>{category === "teacher" ? growthSource.present ? "教学复盘与已确认成果" : "教师成长数据尚未接入" : teachingSkills.status === "unavailable" ? "教学能力生命周期尚未接入" : "教学能力生命周期已连接"}</p></div>{category === "teacher" || teachingSkills.mutationEnabled ? <button type="button" onClick={() => category === "teacher" ? onStartAgent("请根据我填写的课堂经历整理教学复盘，保存到 .edupi/output/weekly/，不要编造课堂效果。\n\n本次教学与效果（在这里填写）：", "replace") : setCreating(value => !value)}>{category === "teacher" ? "记录复盘" : "新增教学方法"}</button> : null}</header>
    {category !== "teacher" && !teachingSkills.mutationEnabled ? <p>当前教学方法不可编辑。</p> : null}
    {creating && teachingSkills.mutationEnabled && category !== "teacher" ? <EduPiTeachingMethodEditor mutationEnabled={teachingSkills.mutationEnabled} onSaved={() => setCreating(false)} /> : null}
    {category === "teacher" ? <section className="edupi-database"><div className="edupi-database__head edupi-growth-db-grid"><span>类型</span><span>内容</span><span>来源</span><span>日期</span><span>动作</span></div>{documents.map((item) => <div className="edupi-database-static-row edupi-growth-db-grid" key={item.id}><span>{item.kind === "weekly" ? "周复盘" : "专业反思"}</span><strong>{item.title}</strong><span>工作沉淀</span><time>{shortDate(item.date)}</time><button type="button" onClick={() => onOpenFile(workspaceFile(item.path))}>打开</button></div>)}{artifacts.map(({ task, artifact }) => <div className="edupi-database-static-row edupi-growth-db-grid" key={artifact.id}><span>确认成果</span><strong>{artifact.title}</strong><span>{taskDisplayTitle(task)}</span><time>{task.reviewedAt ? shortDate(task.reviewedAt) : "—"}</time><button type="button" onClick={() => onTask(task)}>查看</button></div>)}{documents.length + artifacts.length === 0 ? <div className="edupi-database__empty">{growthSource.present ? "数据已连接，暂无专业成长记录" : "教师成长数据尚未接入"}</div> : null}</section> : <section className="edupi-database"><div className="edupi-database__head edupi-edupi-growth-db-grid"><span>教学能力</span><span>状态</span><span>试用</span><span>依据</span><span>最近更新</span></div>{skills.map((item) => <details className="edupi-database-row" key={item.skillId}><summary className="edupi-edupi-growth-db-grid"><strong>{item.title}</strong><span>{SKILL_STATE_LABELS[item.lifecycleState] || item.lifecycleState}</span><span>{item.trialCount}</span><span>{item.evidenceIds.length}</span><time>{shortDate(item.updatedAt)}</time></summary><div className="edupi-database-row__detail">{teachingSkills.mutationEnabled && item.lifecycleState !== "retired" ? <button className="native-button" onClick={() => onStartAgent(`请使用 try_teaching_method 试用教学方法 ${item.skillId}。\n\n本次教学任务（在这里填写）：`, "replace")}>试用此方法</button> : null}<details open><summary>方法正文</summary><pre style={{ whiteSpace: "pre-wrap", font: "inherit" }}>{item.details?.content || "正文暂不可用"}</pre>{item.details?.truncated ? <p>正文已截断，可打开完整文件。</p> : null}</details><details><summary>教师批准</summary><p>{item.details?.approval ? `${item.details.approval.status === "accepted" ? "已批准" : "未批准"} · ${shortDate(item.details.approval.at)}` : "暂无批准记录"}</p>{item.details?.approval?.feedback ? <p>{item.details.approval.feedback}</p> : null}</details><details><summary>试用记录</summary>{item.details?.trials.length ? item.details.trials.map((trial, index) => <div key={index}><p>{shortDate(trial.at)} · {trial.outcome}</p>{trial.prompt ? <p>{trial.prompt}</p> : null}{trial.evidence.map((evidence, index) => <p key={index}>{evidence}</p>)}</div>) : <p>暂无试用明细</p>}</details><details><summary>评估</summary>{item.details?.evaluation ? <div><p>{item.details.evaluation.eligible ? "符合晋级条件" : "未达到晋级条件"} · {shortDate(item.details.evaluation.at)}</p><p>基线 {item.details.evaluation.baseline ?? "—"} · 候选 {item.details.evaluation.candidate ?? "—"} · 留出集 {item.details.evaluation.heldout ?? "—"}</p></div> : <p>暂无评估记录</p>}</details>{item.details?.files.map(file => <button type="button" className="native-button" key={file.relativePath} onClick={() => onOpenFile(workspaceFile(file.relativePath))}>{file.label}</button>)}<div><span>能力 ID</span><strong>{item.skillId}</strong></div><div><span>复用状态</span><strong>{item.canReuse ? "可复用" : "继续验证"}</strong></div><div><span>证据</span><strong>{item.evidenceIds.length ? `${item.evidenceIds.length} 条已保留` : "尚无证据"}</strong></div>{teachingSkills.mutationEnabled && ["draft", "trial"].includes(item.lifecycleState) ? <details><summary>填写使用反馈</summary><EduPiTeachingMethodEditor mutationEnabled={teachingSkills.mutationEnabled} skillId={item.skillId} onSaved={() => {}} /></details> : null}</div></details>)}{skills.length === 0 ? <div className="edupi-database__empty">{teachingSkills.status === "unavailable" ? "教学能力生命周期尚未接入" : "数据已连接，暂无 EduPi 能力成长记录"}</div> : null}</section>}
  </main>;
}
