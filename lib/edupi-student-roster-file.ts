import { read, utils } from "xlsx";
import { parseStudentRosterCsv, parseStudentRosterRows, StudentRosterError, type StudentRosterRow } from "./edupi-student-roster-model";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const EXCEL_EXTENSIONS = new Set(["xlsx", "xls", "xlsm", "xlsb"]);

function extension(name: string): string { return name.split(".").pop()?.toLocaleLowerCase() || ""; }

export function parseStudentRosterFile(bytes: Uint8Array, sourceName: string): StudentRosterRow[] {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new StudentRosterError("invalid_csv", "名单文件为空。");
  if (bytes.byteLength > MAX_FILE_BYTES) throw new StudentRosterError("too_large", "名单文件不能超过 5 MB。");
  const kind = extension(sourceName);
  if (kind === "csv") return parseStudentRosterCsv(new TextDecoder().decode(bytes));
  if (kind === "tsv") return parseStudentRosterRows(new TextDecoder().decode(bytes).replace(/^\uFEFF/u, "").split(/\r?\n/u).map((line) => line.split("\t")));
  if (!EXCEL_EXTENSIONS.has(kind)) throw new StudentRosterError("invalid_csv", "请选择 CSV、TSV、XLSX、XLS、XLSM 或 XLSB 名单文件。");
  try {
    const workbook = read(bytes, { type: "array", cellDates: false, dense: true });
    let lastError: StudentRosterError | null = null;
    for (const name of workbook.SheetNames.slice(0, 20)) {
      const rows = utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, raw: false, defval: "", blankrows: false });
      if (rows.length > 520 || rows.some((row) => Array.isArray(row) && row.length > 100)) throw new StudentRosterError("too_many_students", "名单工作表过大，请只保留学生数据后重试。");
      try { return parseStudentRosterRows(rows); }
      catch (error) { if (error instanceof StudentRosterError && ["missing_name", "invalid_csv"].includes(error.code)) { lastError = error; continue; } throw error; }
    }
    throw lastError || new StudentRosterError("missing_name", "Excel 中没有找到“姓名”列。");
  } catch (error) {
    if (error instanceof StudentRosterError) throw error;
    throw new StudentRosterError("invalid_csv", "Excel 名单无法读取，请检查文件是否损坏。");
  }
}
