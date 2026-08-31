import { buildEducationContractFromWorkspace } from "./edupi-education-contract";
import { activeBridgeIdentity } from "./edupi-bridge-manifest";
import { readEduPiEducationSnapshot, type CoreEducationSnapshotPayload, type CoreEducationWorkspace } from "./edupi-core-snapshot";
import type { OnboardingChecklistItem, TeacherContextSnapshot, TeacherRole } from "./edupi-onboarding-types";

type SnapshotEntry = { category?: unknown; content?: unknown; state?: unknown; [key: string]: unknown };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function objectArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function preferenceEntries(workspace: CoreEducationWorkspace): SnapshotEntry[] {
  const continuity = record(workspace.continuity);
  return objectArray(continuity.memories)
    .filter((entry) => entry.category === "preferences" && entry.state !== "superseded");
}

function preferenceValue(entries: SnapshotEntry[], labels: string[]): string {
  const entry = entries.find((item) => labels.some((label) => text(item.content).startsWith(`${label}：`)));
  const content = text(entry?.content);
  return content.includes("：") ? content.slice(content.indexOf("：") + 1).trim() : "";
}

function preferenceNumber(entries: SnapshotEntry[], labels: string[]): number | null {
  const value = preferenceValue(entries, labels).match(/-?\d+(?:\.\d+)?/)?.[0];
  return value ? Number(value) : null;
}

function preferenceValues(entries: SnapshotEntry[], labels: string[]): string[] {
  return entries
    .map((entry) => text(entry.content))
    .filter((content) => labels.some((label) => content.startsWith(`${label}：`)))
    .map((content) => content.slice(content.indexOf("：") + 1).trim())
    .filter(Boolean);
}

function roleFromEntries(entries: SnapshotEntry[]): TeacherRole[] {
  const content = entries.map((entry) => text(entry.content)).join(" ");
  const roles: TeacherRole[] = [];
  if (/班主任：是/.test(content)) roles.push("homeroom_teacher");
  if (/科目：|教什么|任课/.test(content)) roles.push("subject_teacher");
  return roles.length > 0 ? roles : ["subject_teacher"];
}

function roleFromCanonical(value: string, subject: string): TeacherRole[] {
  const roles: TeacherRole[] = [];
  if (/班主任|homeroom/i.test(value)) roles.push("homeroom_teacher");
  if (/年级组|年级主任|grade.?group/i.test(value)) roles.push("grade_group");
  if (/教务|管理员|academic.?admin/i.test(value)) roles.push("academic_admin");
  if (/教师|老师|任课|学科|teacher|subject/i.test(value) || subject) roles.push("subject_teacher");
  return roles.length > 0 ? roles : ["subject_teacher"];
}

function listCount(workspace: CoreEducationWorkspace, key: "calendar" | "timetable" | "students"): number {
  return objectArray(workspace[key]).length;
}

function finiteCount(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function sourceSummaryCount(workspace: CoreEducationWorkspace, sourceIds: string[]): number {
  return objectArray(workspace.source_summaries)
    .filter((summary) => sourceIds.includes(text(summary.source_id)))
    .reduce((total, summary) => total + finiteCount(summary.item_count), 0);
}

function checklist({ configured, calendarCount, timetableCount, rosterCount, materialCount }: { configured: boolean; calendarCount: number; timetableCount: number; rosterCount: number; materialCount: number }): OnboardingChecklistItem[] {
  const nextId = !configured ? "identity" : calendarCount === 0 ? "calendar" : timetableCount === 0 ? "timetable" : materialCount === 0 ? "material" : "roster";
  return [
    { id: "identity", label: "告诉 EduPi 你是谁", status: configured ? "complete" : "next", description: "称呼、学科、年级和工作身份" },
    { id: "calendar", label: "导入本学期校历", status: calendarCount > 0 ? "complete" : nextId === "calendar" ? "next" : "optional", description: "考试、放假、会议和学校活动" },
    { id: "timetable", label: "补充课程与周节奏", status: timetableCount > 0 ? "complete" : nextId === "timetable" ? "next" : "optional", description: "让今日工作按真实节奏出现" },
    { id: "roster", label: "导入班级名单（可选）", status: rosterCount > 0 ? "complete" : nextId === "roster" ? "next" : "optional", description: "先有名字即可，不要求完整学生资料" },
    { id: "material", label: "放入第一份真实材料", status: materialCount > 0 ? "complete" : nextId === "material" ? "next" : "optional", description: "作业、错题或课堂记录，先核对再处理" },
  ];
}

export function projectTeacherContextSnapshot(snapshot: {
  workspace: CoreEducationWorkspace;
  payload: CoreEducationSnapshotPayload;
  dataRoot: { root: string };
}): TeacherContextSnapshot {
  const { workspace } = snapshot;
  const education = buildEducationContractFromWorkspace(workspace, {
    workspacePath: snapshot.dataRoot.root,
    snapshotPayload: snapshot.payload,
    supportedCommands: activeBridgeIdentity().contract.supported_commands,
  });
  const canonical = education.teacherContextCandidates[0]?.currentValues || {};
  const hasCanonical = Object.keys(canonical).length > 0;
  const entries = preferenceEntries(workspace);
  const name = hasCanonical ? text(canonical.name) : preferenceValue(entries, ["称呼"]);
  const subject = hasCanonical ? text(canonical.subject) : preferenceValue(entries, ["科目"]);
  const grade = hasCanonical ? text(canonical.grade) : preferenceValue(entries, ["年级"]);
  const role = hasCanonical ? text(canonical.role) : "";
  const className = hasCanonical ? text(canonical.class_name) : "";
  const calendarCount = listCount(workspace, "calendar");
  const timetableCount = listCount(workspace, "timetable");
  const rosterCount = listCount(workspace, "students");
  const materialCount = sourceSummaryCount(workspace, ["material_candidates", "teaching_memory"]);
  const configured = hasCanonical || Boolean(name && subject && grade);
  return {
    name,
    subject,
    grade,
    school: hasCanonical ? "" : preferenceValue(entries, ["学校"]),
    roles: hasCanonical ? roleFromCanonical(role, subject) : roleFromEntries(entries),
    classes: hasCanonical ? (className ? [className] : []) : preferenceValues(entries, ["班级"]),
    classCount: hasCanonical ? null : preferenceNumber(entries, ["带班数量"]),
    studentCount: hasCanonical ? null : preferenceNumber(entries, ["每班学生"]),
    painPoint: hasCanonical ? "" : preferenceValue(entries, ["当前痛点"]),
    configured,
    checklist: checklist({ configured, calendarCount, timetableCount, rosterCount, materialCount }),
    memoryDirectory: ".edupi/memory",
    editable: false,
    editReason: "通过教师复核提案修改",
  };
}

export async function readTeacherContext(): Promise<TeacherContextSnapshot> {
  return projectTeacherContextSnapshot(await readEduPiEducationSnapshot());
}
