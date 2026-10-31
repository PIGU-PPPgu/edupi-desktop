import { studentRecordName } from "./edupi-student-roster-model";

export const UNASSIGNED_CLASS_FILTER = "__edupi_unassigned__";

export type ClassDossierEntry = {
  key: string;
  student: Record<string, unknown>;
  studentName: string;
  className: string;
  title: string;
  note: string;
  date: string | null;
  timestamp: number | null;
  source: string;
};

export type ClassDossier = {
  classes: string[];
  students: Array<Record<string, unknown>>;
  unassignedCount: number;
  recordedStudents: number;
  growth: ClassDossierEntry[];
  concerns: ClassDossierEntry[];
  resolved: ClassDossierEntry[];
  traits: Array<{ text: string; count: number }>;
  updatedAt: string | null;
};

const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const rows = (value: unknown): Array<Record<string, unknown>> => Array.isArray(value)
  ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
const strings = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.map(text).filter(Boolean))] : [];

export function dossierDate(value: unknown): { date: string; timestamp: number } | null {
  const date = text(value);
  if (!/^\d{4}-\d{2}-\d{2}(?:$|T)/u.test(date)) return null;
  const day = date.slice(0, 10);
  const parsedDay = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(parsedDay.getTime()) || parsedDay.toISOString().slice(0, 10) !== day) return null;
  const timestamp = new Date(date.length === 10 ? `${date}T00:00:00Z` : date).getTime();
  return Number.isFinite(timestamp) ? { date, timestamp } : null;
}

export function dossierDateLabel(value: unknown): string {
  const parsed = dossierDate(value);
  return parsed ? parsed.date.slice(0, 10).replaceAll("-", ".") : "日期未记录";
}

/** Snapshot-only aggregation: no identity joins, inferred class membership or model scores. */
export function buildClassDossier(
  students: Array<Record<string, unknown>>,
  classFilter: string,
  contextClasses: readonly string[] = [],
): ClassDossier {
  const classes = [...new Set([...students.map((student) => text(student.class_name)), ...contextClasses.map(text)].filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
  const scoped = students.map((student, index) => ({ student, index })).filter(({ student }) => classFilter === UNASSIGNED_CLASS_FILTER
    ? !text(student.class_name) : !classFilter || text(student.class_name) === classFilter);
  const growth: ClassDossierEntry[] = [];
  const concerns: ClassDossierEntry[] = [];
  const resolved: ClassDossierEntry[] = [];
  const traits = new Map<string, number>();
  let recordedStudents = 0;
  let latest: { date: string; timestamp: number } | null = null;

  for (const { student, index } of scoped) {
    const studentName = studentRecordName(student);
    const className = text(student.class_name);
    const studentKey = text(student.student_id) || text(student.id) || `legacy-row:${index}`;
    const trajectory = rows(student.trajectory).filter((entry) => text(entry.event) || text(entry.note) || text(entry.description));
    const patterns = rows(student.error_patterns).filter((entry) => text(entry.description));
    const studentTraits = strings(student.traits);
    if (trajectory.length || patterns.length || studentTraits.length || strings(student.parent_notes).length) recordedStudents += 1;
    for (const trait of studentTraits) traits.set(trait, (traits.get(trait) ?? 0) + 1);
    const updated = dossierDate(student.updated_at);
    if (updated && (!latest || updated.timestamp > latest.timestamp)) latest = updated;

    trajectory.forEach((entry, entryIndex) => {
      const observed = dossierDate(entry.date);
      growth.push({
        key: `${studentKey}:growth:${entryIndex}`,
        student,
        studentName,
        className,
        title: text(entry.event) || "成长记录",
        note: text(entry.note) || text(entry.description),
        date: observed?.date ?? null,
        timestamp: observed?.timestamp ?? null,
        source: text(entry.source_label) || text(entry.source_name) || "学生档案",
      });
    });
    patterns.forEach((entry, entryIndex) => {
      const observed = dossierDate(entry.last_seen);
      const target = entry.status === "resolved" ? resolved : concerns;
      target.push({
        key: `${studentKey}:${entry.status === "resolved" ? "resolved" : "concern"}:${entryIndex}`,
        student,
        studentName,
        className,
        title: text(entry.description),
        note: text(entry.note),
        date: observed?.date ?? null,
        timestamp: observed?.timestamp ?? null,
        source: "学生档案",
      });
    });
  }

  const byLatest = (left: ClassDossierEntry, right: ClassDossierEntry) => (right.timestamp ?? -Infinity) - (left.timestamp ?? -Infinity);
  return {
    classes,
    students: scoped.map(({ student }) => student),
    unassignedCount: students.filter((student) => !text(student.class_name)).length,
    recordedStudents,
    growth: growth.sort(byLatest),
    concerns: concerns.sort(byLatest),
    resolved: resolved.sort(byLatest),
    traits: [...traits].map(([trait, count]) => ({ text: trait, count })).sort((a, b) => b.count - a.count),
    updatedAt: latest?.date ?? null,
  };
}
