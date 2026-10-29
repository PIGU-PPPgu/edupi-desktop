"use client";

import { useState } from "react";
import { detectStudentRosterHeaderColumns, detectStudentRosterMapping, isStudentRosterSummaryLabel, parseStudentRosterRows } from "@/lib/edupi-student-roster-model";
import { fetchDesktopApi } from "@/lib/desktop-native";

export type RosterPreview = { sourceName: string; sheets: Array<{ name: string; rows: string[][] }> };
const fields = ["姓名", "学生特征", "家校备注", "班级"];

export function EduPiRosterPreview({ preview, busy, onCancel, onImport, aiSuggestion = false, onSuggestBusyChange }: { preview: RosterPreview; busy: boolean; onCancel: () => void; onImport: (csv: string) => void; aiSuggestion?: boolean; onSuggestBusyChange?: (busy: boolean) => void }) {
  const [sheetIndex, setSheetIndex] = useState(() => Math.max(0, preview.sheets.findIndex((sheet) => detectStudentRosterMapping(sheet.rows).columns[0] >= 0)));
  const [mapping, setMapping] = useState(() => detectStudentRosterMapping(preview.sheets[sheetIndex]?.rows || []));
  const [page, setPage] = useState(0);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [excludedRows, setExcludedRows] = useState<Set<number>>(() => new Set());
  const rows = preview.sheets[sheetIndex]?.rows || [];
  const headers = rows[mapping.header] || [];
  const mapped = rows.slice(mapping.header + 1).filter((row) => row.some((cell) => cell.trim())).map((row) => mapping.columns.map((column) => column < 0 ? "" : row[column] || ""));
  const selectedMapped = mapped.filter((_row, index) => !excludedRows.has(index));
  let error = "";
  try { parseStudentRosterRows([["姓名", "特征", "家校备注","班级"], ...selectedMapped]); }
  catch (reason) { error = reason instanceof Error ? reason.message : "请检查字段对应"; }
  if (mapping.columns[0] < 0) error = "请选择姓名列";
  const selectedColumns = mapping.columns.filter((column) => column >= 0);
  if (new Set(selectedColumns).size !== selectedColumns.length) error = "各字段请选择不同的列";
  if (selectedMapped.some((row) => isStudentRosterSummaryLabel(row[0]))) error = "请取消勾选汇总或备注行";
  const pages = Math.max(1, Math.ceil(mapped.length / 10));
  const currentPage = Math.min(page, pages - 1);
  const submit = () => onImport([["姓名", "特征", "家校备注","班级"], ...selectedMapped].map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\r\n"));
  const toggleRow = (index: number) => setExcludedRows((current) => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next; });
  const suggest = async () => {
    if (suggesting || busy || !headers.length) return;
    onSuggestBusyChange?.(true);
    setSuggesting(true); setSuggestError(null);
    try {
      const response = await fetchDesktopApi("/api/edupi/students/import/suggest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ headers }) });
      const result = await response.json() as { columns?: number[]; error?: string };
      if (!response.ok || !Array.isArray(result.columns) || result.columns.length !== fields.length) throw new Error(result.error || "列名识别失败，请手动选择");
      setMapping((current) => ({ ...current, columns: result.columns!, confident: false }));
    } catch (cause) { setSuggestError(cause instanceof Error ? cause.message : "列名识别失败，请手动选择"); }
    finally { setSuggesting(false); onSuggestBusyChange?.(false); }
  };
  return <section className="edupi-roster-preview" aria-label="名单导入预览">
    <header><h2>导入预览</h2><button type="button" disabled={busy || suggesting} onClick={onCancel}>取消</button></header>
    <p>{preview.sourceName} · {mapped.length} 行</p>
    <div className="edupi-roster-preview__fields">
      <label>工作表<select disabled={busy || suggesting} value={sheetIndex} onChange={(event) => { const index = Number(event.target.value); setSheetIndex(index); setMapping(detectStudentRosterMapping(preview.sheets[index].rows)); setPage(0); setExcludedRows(new Set()); setSuggestError(null); }}>{preview.sheets.map((sheet, index) => <option key={index} value={index}>{sheet.name}</option>)}</select></label>
      <label>表头行<input disabled={busy || suggesting} type="number" min={1} max={Math.max(1, rows.length)} value={mapping.header + 1} onChange={(event) => { const header = Math.min(rows.length - 1, Math.max(0, Number(event.target.value) - 1)); setMapping({ header, columns: detectStudentRosterHeaderColumns(rows[header] || []), confident: false }); setPage(0); setExcludedRows(new Set()); setSuggestError(null); }} /></label>
      {fields.map((field, index) => <label key={field}>{field}<select disabled={busy || suggesting} value={mapping.columns[index]} onChange={(event) => setMapping({ ...mapping, columns: mapping.columns.map((column, position) => position === index ? Number(event.target.value) : column) })}><option value={-1}>{index === 0 ? "选择姓名列" : "不导入"}</option>{headers.map((header, column) => <option key={column} value={column}>{header || `第 ${column + 1} 列`}</option>)}</select></label>)}
    </div>
    {aiSuggestion ? <div className="edupi-roster-preview__ai"><span>AI 只接收当前表头行；请确认该行不含学生信息。</span><button type="button" disabled={busy || suggesting || !headers.length} onClick={() => void suggest()}>{suggesting ? "识别中…" : "AI 辅助识别列名"}</button></div> : null}
    <div className="edupi-roster-preview__table"><table><thead><tr><th>导入</th>{fields.map((field) => <th key={field}>{field}</th>)}</tr></thead><tbody>{mapped.slice(currentPage * 10, (currentPage + 1) * 10).map((row, index) => { const rowIndex = currentPage * 10 + index; return <tr key={rowIndex}><td><input type="checkbox" aria-label={`导入第 ${rowIndex + 1} 行`} checked={!excludedRows.has(rowIndex)} disabled={busy || suggesting} onChange={() => toggleRow(rowIndex)} /></td>{row.map((cell, column) => <td key={column}>{cell || "—"}</td>)}</tr>; })}</tbody></table></div>
    {error ? <p role="alert">{error}</p> : null}
    {suggestError ? <p role="alert">{suggestError}</p> : null}
    <footer><button type="button" disabled={suggesting || currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button><span>{currentPage + 1} / {pages}</span><button type="button" disabled={suggesting || currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>下一页</button><button type="button" className="is-primary" disabled={busy || suggesting || Boolean(error)} onClick={submit}>{busy ? "导入中…" : `导入 ${selectedMapped.length} 名学生`}</button></footer>
  </section>;
}
