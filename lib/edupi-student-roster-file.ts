import { read, utils } from "xlsx";
import { parseStudentRosterCsv, parseStudentRosterRows, StudentRosterError, type StudentRosterRow } from "./edupi-student-roster-model";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const EXCEL_EXTENSIONS = new Set(["xlsx", "xls", "xlsm", "xlsb"]);

function extension(name: string): string { return name.split(".").pop()?.toLocaleLowerCase() || ""; }

export function previewStudentRosterFile(bytes: Uint8Array, sourceName: string): Array<{ name: string; rows: string[][] }> {
  if (!bytes.byteLength || bytes.byteLength > MAX_FILE_BYTES) throw new StudentRosterError("too_large", "请选择不超过 5 MB 的名单文件。");
  const kind = extension(sourceName);
  if (!["csv", "tsv", ...EXCEL_EXTENSIONS].includes(kind)) throw new StudentRosterError("invalid_csv", "请选择 CSV 或 Excel 名单文件。");
  try {
    const workbook = kind === "csv" || kind === "tsv"
      ? read(new TextDecoder().decode(bytes), { type: "string", raw: true, dense: true, sheetRows: 522, FS: kind === "tsv" ? "\t" : "," })
      : read(bytes, { type: "array", dense: true, sheetRows: 522 });
    const sheets = workbook.SheetNames.slice(0, 20).map((name) => {
      const sheet = workbook.Sheets[name];
      const range = sheet["!fullref"] || sheet["!ref"];
      if (range && (utils.decode_range(range).e.r >= 521 || utils.decode_range(range).e.c >= 100)) throw new StudentRosterError("too_many_students", "名单工作表过大，请拆分后导入。");
      const rows = utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "", blankrows: true });
      return { name, rows };
    });
    if (new TextEncoder().encode(JSON.stringify(sheets)).byteLength > 1024 * 1024) throw new StudentRosterError("too_large", "预览内容过大，请只保留学生名单。");
    return sheets;
  } catch (error) {
    if (error instanceof StudentRosterError) throw error;
    throw new StudentRosterError("invalid_csv", "名单无法读取，请检查文件。");
  }
}

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
