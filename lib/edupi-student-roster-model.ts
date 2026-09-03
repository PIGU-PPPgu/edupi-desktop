export type StudentRosterRow = { name: string; traits: string[]; parentNotes: string[] };

export class StudentRosterError extends Error {
  constructor(public readonly code: "invalid_csv" | "missing_name" | "duplicate_name" | "too_many_students" | "too_large", message: string) {
    super(message);
    this.name = "StudentRosterError";
  }
}

function csvRows(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
      continue;
    }
    if (character === '"' && field.length === 0) quoted = true;
    else if (character === ",") { row.push(field.trim()); field = ""; }
    else if (character === "\n") { row.push(field.trim()); rows.push(row); row = []; field = ""; }
    else if (character !== "\r") field += character;
  }
  if (quoted) throw new StudentRosterError("invalid_csv", "CSV 引号没有闭合。");
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows.filter((items) => items.some(Boolean));
}

function headerKey(value: string): "name" | "traits" | "parentNotes" | null {
  const key = value.trim().toLocaleLowerCase().replace(/[\s_-]+/g, "");
  if (["姓名", "学生姓名", "学生", "name", "studentname"].includes(key)) return "name";
  if (["特征", "特点", "性格特征", "traits", "tags"].includes(key)) return "traits";
  if (["家长备注", "家校备注", "家长沟通", "parentnotes", "notes"].includes(key)) return "parentNotes";
  return null;
}

function list(value: string | undefined): string[] {
  if (!value) return [];
  const items = [...new Set(value.split(/[、;；|]/).map((item) => item.trim()).filter(Boolean))].slice(0, 50);
  if (items.some((item) => item.length > 240)) throw new StudentRosterError("too_large", "单项学生资料不能超过 240 字。");
  return items;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export function parseStudentRosterRows(sourceRows: unknown[][]): StudentRosterRow[] {
  if (!Array.isArray(sourceRows) || sourceRows.length < 2) throw new StudentRosterError("invalid_csv", "名单至少需要表头和一名学生。");
  const rows = sourceRows.map((row) => Array.isArray(row) ? row.map(cellText) : []);
  const headerIndex = rows.slice(0, 20).findIndex((row) => row.map(headerKey).includes("name"));
  if (headerIndex < 0) throw new StudentRosterError("missing_name", "名单需要“姓名”列。");
  const columns = rows[headerIndex].map(headerKey);
  const nameIndex = columns.indexOf("name");
  const traitsIndex = columns.indexOf("traits");
  const parentNotesIndex = columns.indexOf("parentNotes");
  const students = rows.slice(headerIndex + 1).filter((row) => row.some(Boolean)).map((row) => ({
    name: (row[nameIndex] || "").trim(),
    traits: traitsIndex >= 0 ? list(row[traitsIndex]) : [],
    parentNotes: parentNotesIndex >= 0 ? list(row[parentNotesIndex]) : [],
  }));
  if (students.length === 0 || students.some((student) => !student.name || student.name.length > 120)) throw new StudentRosterError("missing_name", "学生姓名不能为空且不能超过 120 字。");
  if (students.length > 500) throw new StudentRosterError("too_many_students", "一次最多导入 500 名学生。");
  if (new Set(students.map((student) => student.name)).size !== students.length) throw new StudentRosterError("duplicate_name", "名单中存在重复姓名，请先合并。");
  const corePayloadBytes = new TextEncoder().encode(JSON.stringify(students.map((student) => ({ name: student.name, traits: student.traits, parent_notes: student.parentNotes })))).byteLength;
  if (corePayloadBytes > 200 * 1024) throw new StudentRosterError("too_large", "名单内容过大，请拆分后导入。");
  return students;
}

export function parseStudentRosterCsv(source: string): StudentRosterRow[] {
  if (typeof source !== "string" || !source.trim()) throw new StudentRosterError("invalid_csv", "CSV 内容为空。");
  return parseStudentRosterRows(csvRows(source.replace(/^\uFEFF/, "")));
}

export function studentRecordKey(student: Record<string, unknown>, index = 0): string {
  for (const key of ["name", "student_name", "display_name", "student_id", "id"]) {
    const value = student[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return `student-${index}`;
}

export function studentRecordName(student: Record<string, unknown>): string {
  for (const key of ["name", "student_name", "display_name"]) {
    const value = student[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "未命名学生";
}
