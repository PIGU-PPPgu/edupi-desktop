import type { EducationMemoryCategory } from "./edupi-education-contract";

export type TeachingSectionId = "home" | "schedule" | "knowledge" | "tasks" | "memory";
export const TEACHING_SECTIONS: ReadonlyArray<{ id: TeachingSectionId; label: string }> = [
  { id: "home", label: "教学首页" },
  { id: "schedule", label: "课程表" },
  { id: "knowledge", label: "教学重点" },
  { id: "tasks", label: "备课任务" },
  { id: "memory", label: "教学记忆" },
];

export const MEMORY_CATEGORIES: ReadonlyArray<{ id: EducationMemoryCategory; label: string }> = [
  { id: "semester", label: "学期" },
  { id: "class", label: "学生" },
  { id: "teaching", label: "教学" },
  { id: "preferences", label: "教师偏好" },
  { id: "school", label: "学校" },
];

export type InsightCategoryId = "learning" | "class" | "teaching" | "edupi";
export const INSIGHT_CATEGORIES: ReadonlyArray<{ id: InsightCategoryId; label: string }> = [
  { id: "learning", label: "学情观察" },
  { id: "class", label: "班级运行" },
  { id: "teaching", label: "教学改进" },
  { id: "edupi", label: "EduPi 后台" },
];
export type InsightStatusId = "all" | "surfaced" | "brewing" | "signal";
export const INSIGHT_STATUSES: ReadonlyArray<{ id: InsightStatusId; label: string }> = [
  { id: "all", label: "全部" },
  { id: "surfaced", label: "已浮出" },
  { id: "brewing", label: "酝酿中" },
  { id: "signal", label: "弱信号" },
];

export function insightCategory(content: string): InsightCategoryId {
  if (/学生|学习|错因|掌握|成绩|学情/.test(content)) return "learning";
  if (/班级|安全|家长|家校|纪律|活动/.test(content)) return "class";
  if (/教学|课程|课堂|材料|备课|作业/.test(content)) return "teaching";
  return "edupi";
}

export type MaterialCategoryId = "all" | "lesson" | "practice" | "assessment" | "classroom" | "other";
export const MATERIAL_CATEGORIES: ReadonlyArray<{ id: MaterialCategoryId; label: string }> = [
  { id: "all", label: "全部材料" },
  { id: "lesson", label: "教案与课件" },
  { id: "practice", label: "练习与作业" },
  { id: "assessment", label: "测验与评估" },
  { id: "classroom", label: "课堂记录" },
  { id: "other", label: "其他" },
];

export function materialCategory(value: { materialKind?: string | null; title?: string | null }): Exclude<MaterialCategoryId, "all"> {
  const source = `${value.materialKind || ""} ${value.title || ""}`.toLocaleLowerCase();
  if (/lesson|教案|课件|讲义/.test(source)) return "lesson";
  if (/worksheet|practice|练习|作业|习题/.test(source)) return "practice";
  if (/assessment|exam|quiz|测验|考试|评估/.test(source)) return "assessment";
  if (/classroom|课堂|观察记录/.test(source)) return "classroom";
  return "other";
}

export function routePart(value: string | null | undefined, prefix: string, fallback: string): string {
  return value?.startsWith(`${prefix}:`) ? value.slice(prefix.length + 1) : fallback;
}

export function viewKeepsObjectItem(view: string): boolean {
  return view === "teaching" || view === "memory" || view === "insights" || view === "growth" || view === "materials";
}
