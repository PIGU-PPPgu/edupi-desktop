"use client";

import { useEffect, useMemo, useState } from "react";
import type { EducationContract, EducationEntityDeleteKind, TeacherTask } from "@/lib/edupi-education-contract";
import { MATERIAL_CATEGORIES, materialCategory, routePart, type MaterialCategoryId } from "@/lib/edupi-domain-navigation";
import type { MaterialStagingDescriptor } from "@/lib/edupi-material-staging-client";
import { appendTeacherInputSlot } from "@/lib/edupi-teacher-input-slot";
import { taskArtifactFile, taskArtifacts, taskDisplayTitle, taskKey, taskStatusLabel } from "@/lib/edupi-workbench";
import { isTauriDesktop } from "@/lib/desktop-updater";

const PAGE_SIZE = 8;
type MaterialRow = { id: string; title: string; category: Exclude<MaterialCategoryId, "all">; type: string; subject: string; source: string; date: string | null; status: string; summary: string; task: TeacherTask | null; filePath: string | null; deleteKind: "task" | "material" | null };

function shortDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function workspaceFile(workspace: string, relative: string): string {
  const separator = workspace.includes("\\") ? "\\" : "/";
  return relative.startsWith("/") || /^[A-Za-z]:[\\/]/.test(relative) ? relative : `${workspace.replace(/[\\/]$/, "")}${separator}${relative.replace(/^[\\/]+/, "").replace(/[\\/]/g, separator)}`;
}

export function EduPiMaterialsWorkspace({ data, query, selectedObjectId, stagedMaterials, stagingBusy, stagingMessage, onTask, onUpload, onIntakeMaterial, onRemoveStagedMaterial, onOpenFile, onStartAgent, onDeleteEntity }: { data: EducationContract; query: string; selectedObjectId: string | null; stagedMaterials: MaterialStagingDescriptor[]; stagingBusy: boolean; stagingMessage: string | null; onTask: (task: TeacherTask) => void; onUpload: () => void; onIntakeMaterial: (item: MaterialStagingDescriptor) => Promise<unknown>; onRemoveStagedMaterial: (item: MaterialStagingDescriptor) => Promise<void>; onOpenFile: (path: string) => void; onStartAgent: (prompt: string, mode?: "insert" | "replace") => void; onDeleteEntity: (kind: EducationEntityDeleteKind, id: string, label: string) => Promise<boolean> }) {
  const category = routePart(selectedObjectId, "materials", "all") as MaterialCategoryId;
  const categoryLabel = MATERIAL_CATEGORIES.find((item) => item.id === category)?.label || "全部材料";
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<MaterialRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const rows = useMemo<MaterialRow[]>(() => {
    const taskRows = data.tasks.filter((task) => task.materialId || task.trigger === "teaching_adjustment_candidate").map((task) => { const itemCategory = materialCategory({ materialKind: task.materialKind, title: task.title }); return { id: taskKey(task), title: taskDisplayTitle(task), category: itemCategory, type: MATERIAL_CATEGORIES.find((item) => item.id === itemCategory)?.label || "其他", subject: task.topic || "—", source: task.sourceEventName || "教学任务", date: task.sourceEventDate || task.dueDate, status: taskStatusLabel(task), summary: String(task.evidence.sourceSummary || task.evidence.materialKind || "已保留任务证据"), task, filePath: null, deleteKind: "task" as const }; });
    const intakeRows = (data.intakeTargets ?? []).filter((item) => item.projectionKind === "material_intake" && item.status === "accepted").map((item) => ({ id: item.targetId, title: item.title, category: "other" as const, type: "已接入材料", subject: "—", source: "教师上传", date: item.reviewedAt, status: "已接入", summary: item.summary, task: null, filePath: null, deleteKind: "material" as const }));
    const documentRows = data.continuity.documents.map((item) => ({ id: `document:${item.id}`, title: item.title, category: "other" as const, type: item.kind === "daily" ? "每日简报" : item.kind === "weekly" ? "周复盘" : item.kind === "insight" ? "洞察报告" : "后台整理", subject: "—", source: "EduPi 生成", date: item.date, status: "可打开", summary: item.excerpt, task: null, filePath: workspaceFile(data.workspace, item.path), deleteKind: null }));
    const artifactRows = data.tasks.flatMap((task) => { const file = taskArtifactFile(task, data.workspace); if (!file) return []; const artifact = taskArtifacts(task)[0]; return [{ id: `artifact-file:${taskKey(task)}`, title: artifact?.title || taskDisplayTitle(task), category: materialCategory({ materialKind: task.materialKind, title: artifact?.title || task.title }), type: "教学产物", subject: task.topic || "—", source: taskDisplayTitle(task), date: task.reviewedAt || task.dueDate, status: artifact?.state === "confirmed" ? "已确认" : "候选", summary: artifact?.summary || taskDisplayTitle(task), task, filePath: file.path, deleteKind: null }]; });
    const unique = new Map<string, MaterialRow>();
    for (const item of [...documentRows, ...artifactRows, ...taskRows, ...intakeRows]) unique.set(item.filePath || item.id, item);
    return [...unique.values()].filter((item) => category === "all" || item.category === category).filter((item) => !query || `${item.title} ${item.type} ${item.subject} ${item.source} ${item.summary}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")));
  }, [category, data.continuity.documents, data.intakeTargets, data.tasks, data.workspace, query]);
  useEffect(() => { setPage(0); setSelected(null); }, [category, query]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const visible = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const materialSource = data.dataSources.materials;
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
  const deleteSelected = async () => {
    if (!selected?.deleteKind || deleteBusy) return;
    setDeleteBusy(true);
    try {
      const deleted = selected.deleteKind === "task" && selected.task?.id
        ? await onDeleteEntity("task", selected.task.id, selected.title)
        : await onDeleteEntity("material", selected.id, selected.title);
      if (deleted) setSelected(null);
    } catch {
      // The parent workspace owns the visible error message.
    } finally {
      setDeleteBusy(false);
    }
  };
  const openNative = async (mode: "open" | "reveal") => {
    if (!selected?.filePath) return;
    const desktop = await import("@/lib/desktop-native");
    if (mode === "open") await desktop.openPathNative(selected.filePath);
    else await desktop.revealItemInDirNative(selected.filePath);
  };

  return <main className="edupi-module-workspace edupi-database-workspace">
    <header className="edupi-module-heading"><div><span>材料</span><h1>{categoryLabel}</h1><p>{materialSource.present ? "数据已连接" : "材料索引尚未接入"} · {rows.length} 份材料 · {stagedMaterials.length} 份待接入</p></div><button type="button" disabled={stagingBusy} onClick={onUpload}>{stagingBusy ? "处理中…" : "上传材料"}</button></header>
    {stagedMaterials.length > 0 ? <details className="edupi-material-inbox" open><summary>待接入材料 <span>{stagedMaterials.length}</span></summary><div>{stagedMaterials.map((item) => <div key={item.staging_id}><strong>{item.original_name}</strong><span>{Math.ceil(item.expected_size_bytes / 1024)} KB</span><button type="button" disabled={stagingBusy} onClick={() => void onIntakeMaterial(item).catch(() => {})}>接入 EduPi</button><button type="button" disabled={stagingBusy} onClick={() => void onRemoveStagedMaterial(item)}>移除</button></div>)}</div></details> : null}
    {stagingMessage ? <p className="edupi-material-message" role="status">{stagingMessage}</p> : null}
    <section className="edupi-database"><div className="edupi-database__head edupi-material-db-grid"><span>材料</span><span>类型</span><span>学科 / 班级</span><span>来源</span><span>日期</span><span>状态</span></div>{visible.map((item) => <button type="button" className="edupi-database-button-row edupi-material-db-grid" key={item.id} onClick={() => setSelected(item)}><strong>{item.title}</strong><span>{item.type}</span><span>{item.subject}</span><span>{item.source}</span><time>{shortDate(item.date)}</time><span>{item.status}</span></button>)}{visible.length === 0 ? <div className="edupi-database__empty">{materialSource.present || stagedMaterials.length > 0 ? "数据已连接，当前分类暂无材料" : "材料索引尚未接入"}</div> : null}</section>
    <nav className="edupi-database-pagination" aria-label="材料分页"><button type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>上一页</button><span>{page + 1} / {pages}</span><button type="button" disabled={page >= pages - 1} onClick={() => setPage((value) => value + 1)}>下一页</button></nav>
    {selected ? <aside className="edupi-material-drawer" aria-label={`${selected.title}材料详情`}><header><div><span>{selected.type}</span><h2>{selected.title}</h2></div><button type="button" onClick={() => setSelected(null)} aria-label="关闭材料详情">×</button></header><dl><div><dt>状态</dt><dd>{selected.status}</dd></div><div><dt>来源</dt><dd>{selected.source}</dd></div><div><dt>学科 / 班级</dt><dd>{selected.subject}</dd></div><div><dt>日期</dt><dd>{shortDate(selected.date)}</dd></div><div><dt>说明</dt><dd>{selected.summary}</dd></div></dl><footer>{selected.filePath ? <button type="button" onClick={() => onOpenFile(selected.filePath!)}>预览</button> : null}{selected.filePath && isTauriDesktop() ? <><button type="button" onClick={() => void openNative("open")}>打开文件</button><button type="button" onClick={() => void openNative("reveal")}>显示所在文件夹</button></> : null}{selected.task ? <button type="button" onClick={() => onTask(selected.task!)}>关联任务</button> : null}{selected.deleteKind && data.capabilities.entityDelete.enabled && data.capabilities.entityDelete.targetKinds.includes(selected.deleteKind) && (selected.deleteKind !== "task" || selected.task?.id) ? <button type="button" className="is-delete" disabled={deleteBusy} onClick={() => void deleteSelected()}>{deleteBusy ? "删除中…" : "删除材料"}</button> : null}<button type="button" className="is-primary" onClick={openMaterialAgent}>补充 / 修订</button></footer></aside> : null}
  </main>;
}
