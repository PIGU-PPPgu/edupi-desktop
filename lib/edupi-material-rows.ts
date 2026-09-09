import type { EducationContract, TeacherTask } from "./edupi-education-contract";
import { MATERIAL_CATEGORIES, materialCategory, type MaterialCategoryId } from "./edupi-domain-navigation";
import { taskArtifactFile, taskArtifacts, taskDisplayTitle, taskKey, taskStatusLabel } from "./edupi-workbench";
export type MaterialRow = { id: string; title: string; category: Exclude<MaterialCategoryId, "all">; type: string; subject: string; source: string; date: string | null; status: string; summary: string; task: TeacherTask | null; filePath: string | null; deleteKind: "task" | "material" | "generated" | null };

function workspaceFile(workspace: string, relative: string): string {
  const separator = workspace.includes("\\") ? "\\" : "/";
  return relative.startsWith("/") || /^[A-Za-z]:[\\/]/.test(relative) ? relative : `${workspace.replace(/[\\/]$/, "")}${separator}${relative.replace(/^[\\/]+/, "").replace(/[\\/]/g, separator)}`;
}

export function buildMaterialRows(data: EducationContract, query = ""): MaterialRow[] {
  const generated = data.generatedArtifacts || [];
    const taskRows = data.tasks.filter((task) => task.materialId || task.trigger === "teaching_adjustment_candidate").map((task) => { const itemCategory = materialCategory({ materialKind: task.materialKind, title: task.title }); return { id: taskKey(task), title: taskDisplayTitle(task), category: itemCategory, type: MATERIAL_CATEGORIES.find((item) => item.id === itemCategory)?.label || "其他", subject: task.topic || "—", source: task.sourceEventName || "教学任务", date: task.sourceEventDate || task.dueDate, status: taskStatusLabel(task), summary: String(task.evidence.sourceSummary || task.evidence.materialKind || "已保留任务证据"), task, filePath: null, deleteKind: "task" as const }; });
    const intakeRows: MaterialRow[] = (data.teacherMaterials ?? []).map(source => {
      const receipt = data.intakeReceipts?.find(item => item.commandType === "intake_material" && item.appliedIds.includes(source.material_id));
      const target = receipt?.target ? data.intakeTargets?.find(item => item.targetId === receipt.target?.targetId) : undefined;
      return { id: source.material_id, title: source.title, category: materialCategory({ title: source.title, materialKind: source.kind }), type: "已接入材料", subject: [source.subject, source.class_id].filter(Boolean).join(" · ") || "—", source: "教师上传", date: target?.reviewedAt || receipt?.createdAt || null, status: source.available === false ? "文件已移动或删除" : "已接入", summary: target?.summary || source.title, task: null, filePath: source.relative_path && source.available !== false ? workspaceFile(data.workspace, source.relative_path) : null, deleteKind: "material" };
    });
    const documentRows = data.continuity.documents.map((item) => ({ id: `document:${item.id}`, title: item.title, category: "other" as const, type: item.kind === "daily" ? "每日简报" : item.kind === "weekly" ? "周复盘" : item.kind === "insight" ? "洞察报告" : "后台整理", subject: "—", source: "EduPi 生成", date: item.date, status: "可打开", summary: item.excerpt, task: null, filePath: workspaceFile(data.workspace, item.path), deleteKind: null }));
    const artifactRows = data.tasks.flatMap((task) => { const file = taskArtifactFile(task, data.workspace); if (!file) return []; const artifact = taskArtifacts(task)[0]; return [{ id: `artifact-file:${taskKey(task)}`, title: artifact?.title || taskDisplayTitle(task), category: materialCategory({ materialKind: task.materialKind, title: artifact?.title || task.title }), type: "教学产物", subject: task.topic || "—", source: taskDisplayTitle(task), date: task.reviewedAt || task.dueDate, status: artifact?.state === "confirmed" ? "已确认" : "候选", summary: artifact?.summary || taskDisplayTitle(task), task, filePath: file.path, deleteKind: null }]; });
    const unique = new Map<string, MaterialRow>();
    const generatedRows: MaterialRow[] = generated.map((item) => ({ id: item.artifact_id, title: item.title, category: materialCategory({ title: item.title }), type: item.origin === "preparation" ? "课前准备" : "对话生成", subject: "—", source: item.origin === "preparation" ? "EduPi 备课" : "EduPi 对话", date: item.updated_at, status: item.available === false ? "文件已移动或删除" : item.origin === "preparation" ? (data.tasks.some(task => task.id === item.task_id && ["accepted","modified"].includes(task.status)) ? "已确认" : "候选") : "已生成", summary: item.title, task: data.tasks.find((task) => task.id === item.task_id) || null, filePath: item.available === false ? null : workspaceFile(data.workspace, item.relative_path), deleteKind: item.origin === "preparation" ? null : "generated" }));
    for (const item of [...documentRows, ...artifactRows, ...taskRows, ...intakeRows, ...generatedRows]) unique.set(item.filePath || item.id, item);
    return [...unique.values()].filter((item) => !query || `${item.title} ${item.type} ${item.subject} ${item.source} ${item.summary}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")));
}

export function materialUploadScope(context: { subject?: string; classes?: string[] } | null | undefined) {
  const classes = [...new Set((context?.classes || []).map(value => value.trim()).filter(Boolean))];
  return { subject: context?.subject?.trim() || null, classId: classes.length === 1 ? classes[0] : null };
}
