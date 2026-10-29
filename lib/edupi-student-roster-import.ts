import { readEducationContract } from "./edupi-education-server";
import { classifyStudentRosterFile } from "./edupi-student-roster-file";
import { parseStudentRosterCsv, studentRecordName, type StudentRosterRow } from "./edupi-student-roster-model";
import { automaticRosterRequestId, importStudentRoster, manualRosterRequestId } from "./edupi-student-roster-server";

type ImportDeps = { importRoster: typeof importStudentRoster; readContract: typeof readEducationContract };
const defaultDeps: ImportDeps = { importRoster: importStudentRoster, readContract: readEducationContract };

export function verifyImportedRosterReadback(students: StudentRosterRow[], data: Awaited<ReturnType<typeof readEducationContract>>): void {
  const actual = Array.isArray(data?.students) ? data.students : [];
  if (!students.every((expected) => {
    const matches = actual.filter((row) => studentRecordName(row) === expected.name
      && (!expected.className || String(row.class_name ?? row.className ?? "").trim() === expected.className));
    if (matches.length !== 1) return false;
    const traits = Array.isArray(matches[0].traits) ? matches[0].traits : [];
    const parentNotes = Array.isArray(matches[0].parent_notes) ? matches[0].parent_notes : [];
    return expected.traits.every((item) => traits.includes(item))
      && expected.parentNotes.every((item) => parentNotes.includes(item));
  })) throw new Error("名单写入状态未确认，请回班级核对。");
}

async function importAndVerify(students: StudentRosterRow[], sourceName: string, requestId: string, signal: AbortSignal | undefined, deps: ImportDeps) {
  const result = await deps.importRoster({ students, sourceName, signal, requestId });
  const data = await deps.readContract();
  verifyImportedRosterReadback(students, data);
  return { result, data, verified: true as const };
}

export async function processManualStudentRoster(csv: string, sourceName: string, signal?: AbortSignal, deps: ImportDeps = defaultDeps) {
  return importAndVerify(parseStudentRosterCsv(csv), sourceName, manualRosterRequestId(csv, sourceName), signal, deps);
}

export async function processAutomaticStudentRoster(
  bytes: Uint8Array,
  sourceName: string,
  signal?: AbortSignal,
  deps: ImportDeps = defaultDeps,
) {
  const classified = classifyStudentRosterFile(bytes, sourceName);
  if (classified.status === "needs_review") return { status: "needs_review" as const, sourceName, sheets: classified.sheets, reason: classified.reason };
  return { status: "imported" as const, ...await importAndVerify(classified.students, sourceName, automaticRosterRequestId(bytes, sourceName), signal, deps) };
}
