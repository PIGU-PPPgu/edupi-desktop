"use client";

import { useRef, useState, type ChangeEvent } from "react";
import type { EducationContract, TeacherTask } from "@/lib/edupi-education-contract";
import type { TeacherContextSnapshot } from "@/lib/edupi-onboarding-types";
import { studentRecordKey, studentRecordName } from "@/lib/edupi-student-roster-model";
import { taskDisplayTitle, taskKey, taskStatusLabel } from "@/lib/edupi-workbench";

type Props = {
  mode: "homeroom" | "students";
  data: EducationContract;
  context: TeacherContextSnapshot | null;
  query: string;
  selectedStudentId: string | null;
  onEducation: (data: EducationContract) => void;
  onTask: (task: TeacherTask) => void;
};

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function shortDate(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "日期待补";
  const parsed = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(parsed);
}

function csvCell(value: unknown): string {
  const source = String(value ?? "");
  const safe = /^\s*[=+\-@]/.test(source) ? `'${source}` : source;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function download(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exportValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(exportValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !/(?:^id$|_id$|_ids$|hash|path)/i.test(key))
    .map(([key, child]) => [key, exportValue(child)]));
}

function statusLabel(value: unknown): string {
  const labels: Record<string, string> = { active: "观察中", resolved: "已解决", pending: "待观察", in_progress: "观察中", hold: "暂缓", dismissed: "已忽略", closed: "已关闭" };
  return typeof value === "string" ? labels[value.toLowerCase()] || value : "观察中";
}

export function EduPiStudentWorkspace({ mode, data, context, query, selectedStudentId, onEducation, onTask }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const students = data.students.filter((student) => !query || JSON.stringify(student).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const selected = students.find((student, index) => studentRecordKey(student, index) === selectedStudentId) || (mode === "students" ? students[0] : null) || null;
  const selectedName = selected ? studentRecordName(selected) : null;
  const patterns = selected ? records(selected.error_patterns) : [];
  const trajectory = selected ? records(selected.trajectory) : [];
  const traits = selected && Array.isArray(selected.traits) ? selected.traits.filter((item): item is string => typeof item === "string") : [];
  const parentNotes = selected && Array.isArray(selected.parent_notes) ? selected.parent_notes : [];
  const familyContacts = selectedName ? data.continuity.familyContacts.filter((contact) => contact.student === selectedName) : [];
  const tasks = selectedName ? data.tasks.filter((task) => task.student === selectedName || task.sourceEventName?.includes(selectedName)) : [];
  const classes = context?.classes?.length ? context.classes.join(" · ") : context?.grade || "班级待设置";
  const classPatternCount = students.reduce((total, student) => total + (Array.isArray(student.error_patterns) ? student.error_patterns.filter((item) => !item || typeof item !== "object" || (item as Record<string, unknown>).status !== "resolved").length : 0), 0);
  const classTaskCount = data.tasks.filter((task) => task.trigger === "student_follow_up" && task.boardStage !== "done").length;

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/edupi/students/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceName: file.name, csv: await file.text() }) });
      const result = await response.json() as { error?: string; data?: EducationContract; result?: { imported?: number; created?: number; updated?: number } };
      if (!response.ok || !result.data) throw new Error(result.error || "学生名单导入失败。");
      onEducation(result.data);
      setMessage({ tone: "success", text: `已导入 ${result.result?.imported ?? 0} 名学生` });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "学生名单导入失败。" });
    } finally {
      setBusy(false);
    }
  };

  const exportCurrent = () => {
    const payload = selected || data.students;
    const name = selectedName ? `${selectedName}-学生档案.json` : "班级学生档案.json";
    download(`${JSON.stringify({ exported_at: new Date().toISOString(), students: exportValue(Array.isArray(payload) ? payload : [payload]) }, null, 2)}\n`, name, "application/json;charset=utf-8");
  };
  const exportTimeline = () => {
    if (!selected || !selectedName) return;
    const rows = trajectory.map((item) => [item.date || "", item.event || "", item.note || item.description || ""]);
    download(`\uFEFF${[["日期", "事件", "备注"], ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`, `${selectedName}-成长轨迹.csv`, "text/csv;charset=utf-8");
  };

  return <main className="edupi-module-workspace edupi-student-workspace">
    <header className="edupi-module-heading edupi-student-heading"><div><h1>{mode === "homeroom" ? "班级" : "学生档案"}</h1><p>{classes} · {data.students.length} 名学生</p></div><div className="edupi-student-heading__actions"><button type="button" onClick={() => inputRef.current?.click()} disabled={busy}>{busy ? "导入中…" : "导入名单"}</button><button type="button" onClick={exportCurrent} disabled={!selected}>导出档案</button><button type="button" onClick={exportTimeline} disabled={!selected}>导出轨迹</button></div><input ref={inputRef} type="file" accept=".csv,text/csv" hidden onChange={importFile} /></header>
    {message ? <p className={`edupi-student-message is-${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>{message.text}</p> : null}
    {selected && selectedName ? <div className="edupi-student-profile">
      <section className="edupi-student-profile__identity"><span>{selectedName.slice(0, 1)}</span><div><h2>{selectedName}</h2><p>{traits.join(" · ") || "学生档案"}</p></div><time>{shortDate(selected.updated_at)}</time></section>
      <section className="edupi-student-profile__metrics" aria-label={`${selectedName}档案概览`}><div><strong>{patterns.length}</strong><span>学习模式</span></div><div><strong>{trajectory.length}</strong><span>成长节点</span></div><div><strong>{parentNotes.length + familyContacts.length}</strong><span>家校记录</span></div><div><strong>{tasks.length}</strong><span>相关任务</span></div></section>
      <div className="edupi-student-profile__grid">
        <section><header><h3>学习模式</h3><span>{patterns.length}</span></header>{patterns.map((pattern, index) => <article key={`${selectedName}:pattern:${index}`}><div><strong>{text(pattern.description ?? pattern.desc) || "学习观察"}</strong><span>{statusLabel(pattern.status)}</span></div><p>{pattern.count ? `出现 ${String(pattern.count)} 次` : "已记录"}{pattern.last_seen ? ` · ${shortDate(pattern.last_seen)}` : ""}</p></article>)}{patterns.length === 0 ? <p className="edupi-student-profile__empty">暂无学习模式</p> : null}</section>
        <section><header><h3>成长轨迹</h3><span>{trajectory.length}</span></header>{trajectory.slice().reverse().map((item, index) => <article key={`${selectedName}:trajectory:${index}`}><time>{shortDate(item.date)}</time><div><strong>{text(item.event) || "成长记录"}</strong><p>{text(item.note ?? item.description) || ""}</p></div></article>)}{trajectory.length === 0 ? <p className="edupi-student-profile__empty">暂无成长节点</p> : null}</section>
        <section><header><h3>家校记录</h3><span>{parentNotes.length + familyContacts.length}</span></header>{parentNotes.map((note, index) => <article key={`${selectedName}:parent:${index}`}><strong>{typeof note === "string" ? note : text((note as Record<string, unknown>).note) || "家校记录"}</strong></article>)}{familyContacts.map((contact) => <article key={contact.id}><div><strong>{contact.name}</strong><span>{contact.relationship || "家长"}</span></div><p>{contact.lastTopic || contact.lastOutcome || "已记录联系"}</p></article>)}{parentNotes.length + familyContacts.length === 0 ? <p className="edupi-student-profile__empty">暂无家校记录</p> : null}</section>
        <section><header><h3>相关任务</h3><span>{tasks.length}</span></header>{tasks.map((task) => <button type="button" key={taskKey(task)} onClick={() => onTask(task)}><strong>{taskDisplayTitle(task)}</strong><span>{taskStatusLabel(task)}</span></button>)}{tasks.length === 0 ? <p className="edupi-student-profile__empty">暂无跟进任务</p> : null}</section>
      </div>
    </div> : mode === "homeroom" && students.length > 0 ? <section className="edupi-class-summary"><header><span>班级概览</span><h2>{classes}</h2></header><div><span><strong>{students.length}</strong>名学生</span><span><strong>{classPatternCount}</strong>项观察</span><span><strong>{classTaskCount}</strong>项跟进</span><span><strong>{data.continuity.familyContacts.length}</strong>个家庭</span></div><p>从左侧选择学生查看档案</p></section> : <section className="edupi-page-section edupi-student-empty"><strong>暂无学生档案</strong><button type="button" onClick={() => inputRef.current?.click()}>导入名单</button></section>}
  </main>;
}
