"use client";

import { useEffect, useMemo, useState } from "react";
import type { EducationContract, TeacherTask } from "@/lib/edupi-education-contract";
import { MATERIAL_CATEGORIES, materialCategory, routePart, type MaterialCategoryId } from "@/lib/edupi-domain-navigation";
import type { MaterialStagingDescriptor } from "@/lib/edupi-material-staging-client";
import { appendTeacherInputSlot } from "@/lib/edupi-teacher-input-slot";
import { taskDisplayTitle, taskKey, taskStatusLabel } from "@/lib/edupi-workbench";

const PAGE_SIZE = 8;
type MaterialRow = { id: string; title: string; category: Exclude<MaterialCategoryId, "all">; type: string; subject: string; source: string; date: string | null; status: string; summary: string; task: TeacherTask | null };

function shortDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function EduPiMaterialsWorkspace({ data, query, selectedObjectId, stagedMaterials, stagingBusy, stagingMessage, onTask, onUpload, onIntakeMaterial, onRemoveStagedMaterial, onStartAgent }: { data: EducationContract; query: string; selectedObjectId: string | null; stagedMaterials: MaterialStagingDescriptor[]; stagingBusy: boolean; stagingMessage: string | null; onTask: (task: TeacherTask) => void; onUpload: () => void; onIntakeMaterial: (item: MaterialStagingDescriptor) => Promise<unknown>; onRemoveStagedMaterial: (item: MaterialStagingDescriptor) => Promise<void>; onStartAgent: (prompt: string, mode?: "insert" | "replace") => void }) {
  const category = routePart(selectedObjectId, "materials", "all") as MaterialCategoryId;
  const categoryLabel = MATERIAL_CATEGORIES.find((item) => item.id === category)?.label || "全部材料";
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<MaterialRow | null>(null);
  const rows = useMemo<MaterialRow[]>(() => {
    const taskRows = data.tasks.filter((task) => task.materialId || task.trigger === "teaching_adjustment_candidate").map((task) => { const itemCategory = materialCategory({ materialKind: task.materialKind, title: task.title }); return { id: taskKey(task), title: taskDisplayTitle(task), category: itemCategory, type: MATERIAL_CATEGORIES.find((item) => item.id === itemCategory)?.label || "其他", subject: task.topic || "—", source: task.sourceEventName || "教学任务", date: task.sourceEventDate || task.dueDate, status: taskStatusLabel(task), summary: String(task.evidence.sourceSummary || task.evidence.materialKind || "已保留任务证据"), task }; });
    const intakeRows = (data.intakeTargets ?? []).filter((item) => item.projectionKind === "material_intake" && item.status === "accepted").map((item) => ({ id: item.targetId, title: item.title, category: "other" as const, type: "已接入材料", subject: "—", source: "教师上传", date: item.reviewedAt, status: "已接入", summary: item.summary, task: null }));
    return [...taskRows, ...intakeRows].filter((item) => category === "all" || item.category === category).filter((item) => !query || `${item.title} ${item.type} ${item.subject} ${item.source} ${item.summary}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")));
  }, [category, data.intakeTargets, data.tasks, query]);
  useEffect(() => { setPage(0); setSelected(null); }, [category, query]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const visible = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const openMaterialAgent = () => {
    if (!selected) return;
    const prompt = appendTeacherInputSlot([
      `请补充或修订这份材料的信息：${selected.title}`,
      `当前说明：${selected.summary}`,
      `来源：${selected.source}`,
      "请保留原始来源，根据我的要求整理修改候选，待我确认后写回。",
    ].join("\n"), "我要补充或修改的信息（在这里输入或口述）：");
    onStartAgent(prompt, "replace");
  };

  return <main className="edupi-module-workspace edupi-database-workspace">
    <header className="edupi-module-heading"><div><span>材料</span><h1>{categoryLabel}</h1><p>{rows.length} 份材料 · {stagedMaterials.length} 份待接入</p></div><button type="button" disabled={stagingBusy} onClick={onUpload}>{stagingBusy ? "处理中…" : "上传材料"}</button></header>
    {stagedMaterials.length > 0 ? <details className="edupi-material-inbox" open><summary>待接入材料 <span>{stagedMaterials.length}</span></summary><div>{stagedMaterials.map((item) => <div key={item.staging_id}><strong>{item.original_name}</strong><span>{Math.ceil(item.expected_size_bytes / 1024)} KB</span><button type="button" disabled={stagingBusy} onClick={() => void onIntakeMaterial(item).catch(() => {})}>接入 EduPi</button><button type="button" disabled={stagingBusy} onClick={() => void onRemoveStagedMaterial(item)}>移除</button></div>)}</div></details> : null}
    {stagingMessage ? <p className="edupi-material-message" role="status">{stagingMessage}</p> : null}
    <section className="edupi-database"><div className="edupi-database__head edupi-material-db-grid"><span>材料</span><span>类型</span><span>学科 / 班级</span><span>来源</span><span>日期</span><span>状态</span></div>{visible.map((item) => <button type="button" className="edupi-database-button-row edupi-material-db-grid" key={item.id} onClick={() => setSelected(item)}><strong>{item.title}</strong><span>{item.type}</span><span>{item.subject}</span><span>{item.source}</span><time>{shortDate(item.date)}</time><span>{item.status}</span></button>)}{visible.length === 0 ? <div className="edupi-database__empty">当前分类暂无材料</div> : null}</section>
    <nav className="edupi-database-pagination" aria-label="材料分页"><button type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>上一页</button><span>{page + 1} / {pages}</span><button type="button" disabled={page >= pages - 1} onClick={() => setPage((value) => value + 1)}>下一页</button></nav>
    {selected ? <aside className="edupi-material-drawer" aria-label={`${selected.title}材料详情`}><header><div><span>{selected.type}</span><h2>{selected.title}</h2></div><button type="button" onClick={() => setSelected(null)} aria-label="关闭材料详情">×</button></header><dl><div><dt>状态</dt><dd>{selected.status}</dd></div><div><dt>来源</dt><dd>{selected.source}</dd></div><div><dt>学科 / 班级</dt><dd>{selected.subject}</dd></div><div><dt>日期</dt><dd>{shortDate(selected.date)}</dd></div><div><dt>说明</dt><dd>{selected.summary}</dd></div></dl><footer>{selected.task ? <button type="button" onClick={() => onTask(selected.task!)}>打开关联任务</button> : null}<button type="button" className="is-primary" onClick={openMaterialAgent}>补充 / 修订</button></footer></aside> : null}
  </main>;
}
