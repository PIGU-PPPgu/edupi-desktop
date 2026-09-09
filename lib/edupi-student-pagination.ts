import { studentRecordKey, studentRecordName } from "./edupi-student-roster-model";

export function studentDirectoryPage(students: Record<string, unknown>[], classFilter: string, query: string, requestedPage: number) {
  const filtered = students.map((student, index) => ({ student, key: studentRecordKey(student, index) }))
    .filter(({ student }) => !classFilter || student.class_name === classFilter)
    .filter(({ student }) => !query || JSON.stringify(student).toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .sort((left, right) => studentRecordName(left.student).localeCompare(studentRecordName(right.student), "zh-CN"));
  const pages = Math.max(1, Math.ceil(filtered.length / 24));
  const page = Math.max(0, Math.min(requestedPage, pages - 1));
  return { filtered, rows: filtered.slice(page * 24, (page + 1) * 24), page, pages };
}
