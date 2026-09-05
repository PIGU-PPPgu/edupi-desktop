"use client";

import { useState } from "react";
import { parseStudentRosterRows } from "@/lib/edupi-student-roster-model";

export type RosterPreview = { sourceName: string; sheets: Array<{ name: string; rows: string[][] }> };
const fields = ["姓名", "学生特征", "家校备注"];
const aliases = [["姓名", "学生姓名", "学生", "name", "studentname"], ["特征", "特点", "性格特征", "traits", "tags"], ["家长备注", "家校备注", "家长沟通", "parentnotes", "notes"]];
const normalize = (value: string) => value.trim().toLowerCase().replace(/[\s_-]+/g, "");
function detect(rows: string[][]) {
  const header = Math.max(0, rows.slice(0, 20).findIndex((row) => row.some((cell) => aliases[0].includes(normalize(cell)))));
  return { header, columns: aliases.map((names) => (rows[header] || []).findIndex((cell) => names.includes(normalize(cell)))) };
}

export function EduPiRosterPreview({ preview, busy, onCancel, onImport }: { preview: RosterPreview; busy: boolean; onCancel: () => void; onImport: (csv: string) => void }) {
  const [sheetIndex, setSheetIndex] = useState(() => Math.max(0, preview.sheets.findIndex((sheet) => detect(sheet.rows).columns[0] >= 0)));
  const [mapping, setMapping] = useState(() => detect(preview.sheets[sheetIndex]?.rows || []));
  const [page, setPage] = useState(0);
  const rows = preview.sheets[sheetIndex]?.rows || [];
  const headers = rows[mapping.header] || [];
  const mapped = rows.slice(mapping.header + 1).filter((row) => row.some((cell) => cell.trim())).map((row) => mapping.columns.map((column) => column < 0 ? "" : row[column] || ""));
  let error = "";
  try { parseStudentRosterRows([["姓名", "特征", "家校备注"], ...mapped]); }
  catch (reason) { error = reason instanceof Error ? reason.message : "请检查字段对应"; }
  if (mapping.columns[0] < 0) error = "请选择姓名列";
  const selectedColumns = mapping.columns.filter((column) => column >= 0);
  if (new Set(selectedColumns).size !== selectedColumns.length) error = "各字段请选择不同的列";
  const pages = Math.max(1, Math.ceil(mapped.length / 10));
  const currentPage = Math.min(page, pages - 1);
  const submit = () => onImport([["姓名", "特征", "家校备注"], ...mapped].map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\r\n"));
  return <section className="edupi-roster-preview" aria-label="名单导入预览">
    <header><h2>导入预览</h2><button type="button" disabled={busy} onClick={onCancel}>取消</button></header>
    <p>{preview.sourceName} · {mapped.length} 名学生</p>
    <div className="edupi-roster-preview__fields">
      <label>工作表<select disabled={busy} value={sheetIndex} onChange={(event) => { const index = Number(event.target.value); setSheetIndex(index); setMapping(detect(preview.sheets[index].rows)); setPage(0); }}>{preview.sheets.map((sheet, index) => <option key={index} value={index}>{sheet.name}</option>)}</select></label>
      <label>表头行<input disabled={busy} type="number" min={1} max={Math.max(1, rows.length)} value={mapping.header + 1} onChange={(event) => { const header = Math.min(rows.length - 1, Math.max(0, Number(event.target.value) - 1)); setMapping({ header, columns: aliases.map((names) => (rows[header] || []).findIndex((cell) => names.includes(normalize(cell)))) }); setPage(0); }} /></label>
      {fields.map((field, index) => <label key={field}>{field}<select disabled={busy} value={mapping.columns[index]} onChange={(event) => setMapping({ ...mapping, columns: mapping.columns.map((column, position) => position === index ? Number(event.target.value) : column) })}><option value={-1}>{index === 0 ? "选择姓名列" : "不导入"}</option>{headers.map((header, column) => <option key={column} value={column}>{header || `第 ${column + 1} 列`}</option>)}</select></label>)}
    </div>
    <div className="edupi-roster-preview__table"><table><thead><tr>{fields.map((field) => <th key={field}>{field}</th>)}</tr></thead><tbody>{mapped.slice(currentPage * 10, (currentPage + 1) * 10).map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column}>{cell || "—"}</td>)}</tr>)}</tbody></table></div>
    {error ? <p role="alert">{error}</p> : null}
    <footer><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button><span>{currentPage + 1} / {pages}</span><button type="button" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>下一页</button><button type="button" className="is-primary" disabled={busy || Boolean(error)} onClick={submit}>{busy ? "导入中…" : `导入 ${mapped.length} 名学生`}</button></footer>
  </section>;
}
