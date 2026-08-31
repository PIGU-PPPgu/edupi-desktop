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
};

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
      students: students.map((student) => ({ name: student.name, traits: student.traits, parent_notes: student.parentNotes })),
    },
  });
  if (response.ok !== true || response.operation !== "students" || response.external_send !== false || response.imported !== students.length) throw new Error(response.code || "学生名单导入失败。");
  return response;
}
