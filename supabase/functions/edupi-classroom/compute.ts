import { computeGrades } from "./core/grade.mjs";
import { computeSeating } from "./core/seating.mjs";
import { computeDuty } from "./core/duty.mjs";

type Row = Record<string, unknown>;
const row = (value: unknown): Row | null => value && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
function canonical(value: unknown): unknown {
  return Array.isArray(value) ? value.map(canonical) : row(value)
    ? Object.fromEntries(Object.keys(value as Row).sort().map(key => [key, canonical((value as Row)[key])])) : value;
}
const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** Edge independently verifies host output with the unchanged pinned Core code.
 * Only after this succeeds may a service-role admission be issued. */
export function verifyHostClassroomComputation(body: Row): boolean {
  const computed = row(body.computed);
  if (!computed || computed.core_commit !== "fc89b3bc899a55b0fdad61b8f37e238d950f37c6"
    || !row(computed.source_input) || !Array.isArray(computed.roster) || computed.roster.length > 500
    || !Array.isArray(computed.references) || !row(computed.result)
    || !Array.isArray(computed.issues) || !Array.isArray(computed.unresolved ?? [])
    || (computed.unresolved as unknown[] | undefined)?.length) return false;
  const input = computed.source_input as Row;
  if (typeof input.title !== "string" || !input.title.trim() || input.title.length > 160
    || typeof input.class_name !== "string" || !input.class_name.trim() || input.class_name.length > 160) return false;
  const roster = computed.roster.map(row);
  if (roster.some(item => !item || typeof item.student_id !== "string" || typeof item.class_name !== "string")
    || new Set(roster.map(item => item!.student_id)).size !== roster.length) return false;
  const selected = body.domain === "grades"
    ? Array.isArray(input.rows) ? input.rows.map(item => row(item)?.student_id) : []
    : Array.isArray(input.student_ids) ? input.student_ids : [];
  if (!selected.length || selected.some(id => typeof id !== "string"
    || !roster.some(student => student!.student_id === id && student!.class_name === input.class_name))) return false;
  if (body.action === "save") {
    const source = row(body.source_request), original = structuredClone(row(source?.input));
    if (!original) return false;
    if (body.domain === "grades") {
      if (!Array.isArray(original.rows)) return false;
      for (const rawRow of original.rows) {
        const gradeRow = row(rawRow);
        const student = roster.find(student => student?.student_id === gradeRow?.student_id);
        if (!gradeRow || !student) return false;
        gradeRow.name = student.name;
        gradeRow.class_name = student.class_name;
      }
    }
    if (!same(original, input)) return false;
  }
  const references = computed.references.map(row);
  const context = {
    baseline: references.find(item => item?.id === input.baseline_id),
    exam: references.find(item => item?.id === input.exam_id),
  };
  const compute = ({ grades: computeGrades, seating: computeSeating, duty: computeDuty } as Record<string, unknown>)[String(body.domain)];
  if (typeof compute !== "function") return false;
  try {
    const actual = compute(structuredClone(input), structuredClone(computed.roster), structuredClone(context));
    return row(actual.result) !== null && same(actual.input, computed.input) && same(actual.result, computed.result)
      && same(actual.issues, computed.issues) && !(actual.unresolved?.length)
      && !actual.issues.some((issue: Row) => issue.severity === "error");
  } catch { return false; }
}
