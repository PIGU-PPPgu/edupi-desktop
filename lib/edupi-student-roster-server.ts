import { runCoreProcess } from "./edupi-core-process-client";
import { resolveEduPiBridgeRoots } from "./edupi-core-snapshot";
import type { StudentRosterRow } from "./edupi-student-roster-model";

type StudentRosterResponse = {
  ok: boolean;
  operation?: string;
  code?: string;
  created?: number;
  updated?: number;
  imported?: number;
  total?: number;
  external_send?: boolean;
  student_name?: string;
  updated_at?: string;
};

export type StudentProfileUpdateInput = {
  name: string;
  traits: string[];
  parentNotes: string[];
  expectedUpdatedAt: string;
};

export class StudentProfileUpdateError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "StudentProfileUpdateError";
  }
}

export function buildStudentProfileUpdateRequest(input: StudentProfileUpdateInput, requestId: string) {
  return {
    protocol: "edupi-desktop-bridge",
    protocol_version: 1,
    producer: "edupi-desktop",
    operation: "students",
    request_id: requestId,
    action: "update",
    expected_updated_at: input.expectedUpdatedAt,
    student: { name: input.name, traits: input.traits, parent_notes: input.parentNotes },
  } as const;
}

export async function importStudentRoster({ students, sourceName, signal }: { students: StudentRosterRow[]; sourceName: string; signal?: AbortSignal }): Promise<StudentRosterResponse> {
  const roots = resolveEduPiBridgeRoots();
  const requestId = `student-roster-${Date.now().toString(36)}`;
  const response = await runCoreProcess<StudentRosterResponse>({
    runtime: roots.runtime,
    dataRoot: roots.dataRoot,
    timeoutMs: 15_000,
    signal,
    request: {
      protocol: "edupi-desktop-bridge",
      protocol_version: 1,
      producer: "edupi-desktop",
      operation: "students",
      request_id: requestId,
      action: "import",
      source_name: sourceName,
      students: students.map((student) => ({ name: student.name, traits: student.traits, parent_notes: student.parentNotes,...(student.className?{class_name:student.className}:{}) })),
    },
  });
  if (response.ok !== true || response.operation !== "students" || response.external_send !== false || response.imported !== students.length) throw new Error(response.code || "学生名单导入失败。");
  return response;
}

export async function updateStudentProfile({ signal, ...input }: StudentProfileUpdateInput & { signal?: AbortSignal }): Promise<StudentRosterResponse> {
  const roots = resolveEduPiBridgeRoots();
  const requestId = `student-profile-${Date.now().toString(36)}`;
  const response = await runCoreProcess<StudentRosterResponse>({
    runtime: roots.runtime,
    dataRoot: roots.dataRoot,
    timeoutMs: 15_000,
    signal,
    request: buildStudentProfileUpdateRequest(input, requestId),
  });
  if (response.ok !== true) throw new StudentProfileUpdateError(response.code || "unavailable", response.code === "stale_student" ? "学生档案已更新，请刷新后重试。" : response.code === "student_not_found" ? "学生档案不存在。" : "学生档案修改失败。");
  if (response.operation !== "students" || response.external_send !== false || response.updated !== 1 || response.student_name !== input.name || typeof response.updated_at !== "string") {
    throw new StudentProfileUpdateError("invalid_response", "学生档案修改结果无效。");
  }
  return response;
}
