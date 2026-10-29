export type StudentRosterRow = { name: string; traits: string[]; parentNotes: string[]; className?:string };

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

export type StudentRosterField = "name" | "traits" | "parentNotes" | "className";
const ROSTER_FOOTER_LABEL = /^(?:合计|总计|小计|共计|汇总|统计|总数|人数|备注|说明|班主任|任课教师|制表人|填表人|审核人|签名|姓名|学生姓名)(?=$|[\s:：()（）\[\]【】,，;；·•\-—0-9０-９])/u;

export function isStudentRosterSummaryLabel(value: string): boolean {
  const name = value.trim();
  const compact = name.replace(/\s+/gu, "");
  return ROSTER_FOOTER_LABEL.test(name) || ROSTER_FOOTER_LABEL.test(compact)
    || /^共[0-9０-９]+[人名]$/u.test(compact) || /^[0-9０-９]+$/u.test(compact);
}
const ROSTER_FIELDS: readonly StudentRosterField[] = ["name", "traits", "parentNotes", "className"];
const IGNORED_HEADER_LABELS = new Set(["学号", "序号", "编号", "id", "index"]);
const normalizeHeader = (value: string) => value.trim().toLocaleLowerCase().replace(/[\s_-]+/g, "");

function headerKey(value: string): StudentRosterField | null {
  const key = normalizeHeader(value);
  if (["姓名", "学生姓名", "学生", "name", "studentname"].includes(key)) return "name";
  if (["特征", "特点", "性格特征", "traits", "tags"].includes(key)) return "traits";
  if (["家长备注", "家校备注", "家长沟通", "parentnotes", "notes"].includes(key)) return "parentNotes";
  if (["班级","班级名称","class","classname"].includes(key)) return "className";
  return null;
}

/** Shared exact-header mapping for preview and safe automatic import. */
export function detectStudentRosterHeaderColumns(headers: readonly string[]): number[] {
  const fields = headers.map(headerKey);
  return ROSTER_FIELDS.map((field) => fields.indexOf(field));
}

export function detectStudentRosterMapping(sourceRows: readonly (readonly unknown[])[]): { header: number; columns: number[]; confident: boolean } {
  const candidates = sourceRows.slice(0, 20).map((row, index) => ({
    index,
    fields: row.map((value) => headerKey(String(value ?? ""))),
  })).filter(({ fields }) => fields.includes("name"));
  const selected = candidates[0];
  const fields = selected?.fields ?? sourceRows[0]?.map((value) => headerKey(String(value ?? ""))) ?? [];
  const headerValues = sourceRows[selected?.index ?? 0] ?? [];
  return {
    header: selected?.index ?? 0,
    columns: detectStudentRosterHeaderColumns(headerValues.map((value) => String(value ?? ""))),
    confident: candidates.length === 1
      && ROSTER_FIELDS.every((field) => fields.filter((value) => value === field).length <= 1)
      && headerValues.every((value, index) => fields[index] !== null || !String(value ?? "").trim() || IGNORED_HEADER_LABELS.has(normalizeHeader(String(value)))),
  };
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
  const mapping = detectStudentRosterMapping(rows);
  if (mapping.columns[0] < 0) throw new StudentRosterError("missing_name", "名单需要“姓名”列。");
  const headerIndex = mapping.header;
  const [nameIndex, traitsIndex, parentNotesIndex, classIndex] = mapping.columns;
  const students = rows.slice(headerIndex + 1).filter((row) => row.some(Boolean)).map((row) => ({
    name: (row[nameIndex] || "").trim(),
    traits: traitsIndex >= 0 ? list(row[traitsIndex]) : [],
    parentNotes: parentNotesIndex >= 0 ? list(row[parentNotesIndex]) : [],
    ...(classIndex>=0&&row[classIndex]?{className:row[classIndex].trim()}:{}),
  }));
  if (students.length === 0 || students.some((student) => !student.name || student.name.length > 120)) throw new StudentRosterError("missing_name", "学生姓名不能为空且不能超过 120 字。");
  if (students.length > 500) throw new StudentRosterError("too_many_students", "一次最多导入 500 名学生。");
  if(students.some(student=>student.className&&student.className.length>120))throw new StudentRosterError("too_large","班级名称不能超过 120 字。");
  if (students.some((student,index) => students.some((other,otherIndex) => otherIndex < index && other.name === student.name && (!student.className || !other.className || student.className === other.className)))) throw new StudentRosterError("duplicate_name", "同名学生需要填写不同班级，同班重复记录请先合并。");
  const corePayloadBytes = new TextEncoder().encode(JSON.stringify(students.map((student) => ({ name: student.name, traits: student.traits, parent_notes: student.parentNotes,...(student.className?{class_name:student.className}:{}) })))).byteLength;
  if (corePayloadBytes > 200 * 1024) throw new StudentRosterError("too_large", "名单内容过大，请拆分后导入。");
  return students;
}

export function parseStudentRosterCsv(source: string): StudentRosterRow[] {
  if (typeof source !== "string" || !source.trim()) throw new StudentRosterError("invalid_csv", "CSV 内容为空。");
  return parseStudentRosterRows(csvRows(source.replace(/^\uFEFF/, "")));
}

export function studentRecordKey(student: Record<string, unknown>, index = 0): string {
  for (const key of ["student_id", "id", "name", "student_name", "display_name"]) {
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
