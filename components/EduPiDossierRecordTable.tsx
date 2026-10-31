"use client";

import { useEffect, useState } from "react";
import { dossierDate, dossierDateLabel } from "@/lib/edupi-class-dossier";
import { DisclosureChevron } from "./DisclosureChevron";

export type DossierRecordRow = {
  id: string;
  title: string;
  date: string | null;
  note: string;
  kind: "growth" | "attention" | "resolved";
  studentName?: string;
  student?: Record<string, unknown>;
};
const labels = { growth: "成长", attention: "关注中", resolved: "已解决" } as const;
const PAGE_SIZE = 6;

export function EduPiDossierRecordTable({ rows, title = "档案记录", onStudent }: {
  rows: DossierRecordRow[];
  title?: string;
  onStudent?: (student: Record<string, unknown>) => void;
}) {
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const filtered = rows.filter(row => filter === "all" || row.kind === filter).slice()
    .sort((a,b) => (dossierDate(b.date)?.timestamp ?? -Infinity) - (dossierDate(a.date)?.timestamp ?? -Infinity));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  useEffect(() => { setPage(0); setExpanded(null); }, [filter]);
  const displayRows = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const exportRows = () => {
    const csv = dossierRecordsCsv(filtered);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${title}.csv`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  return <section className="edupi-dossier-record-table" aria-label={title}>
    <header><h2>{title}</h2><div><label><span className="sr-only">筛选档案记录</span><select aria-label="筛选档案记录" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">全部记录</option><option value="growth">成长</option><option value="attention">关注中</option><option value="resolved">已解决</option></select></label><button type="button" onClick={exportRows} disabled={filtered.length === 0}>导出 CSV</button></div></header>
    {displayRows.length ? <div className="edupi-dossier-record-table__viewport"><table><thead><tr><th scope="col">{onStudent ? "学生与记录" : "记录"}</th><th scope="col">日期</th><th scope="col">状态</th><th scope="col"><span className="sr-only">详情</span></th></tr></thead><tbody>{displayRows.map(row => <RecordRows key={row.id} row={row} open={expanded === row.id} onToggle={() => setExpanded(current => current === row.id ? null : row.id)} onStudent={onStudent} />)}</tbody></table></div> : <p className="edupi-dossier-record-table__empty">暂无{filter === "all" ? "档案" : labels[filter as keyof typeof labels]}记录</p>}
    {pages > 1 ? <nav aria-label="档案记录分页"><button type="button" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>上一页</button><span>{safePage + 1} / {pages}</span><button type="button" disabled={safePage === pages - 1} onClick={() => setPage(safePage + 1)}>下一页</button></nav> : null}
  </section>;
}

function RecordRows({ row, open, onToggle, onStudent }: {row: DossierRecordRow; open: boolean; onToggle: () => void; onStudent?: (student: Record<string, unknown>) => void}) {
  return <><tr className={open ? "is-expanded" : undefined}>
    <td><button type="button" aria-expanded={open} onClick={onToggle}>{row.studentName ? <strong>{row.studentName}</strong> : null}<span>{row.title}</span></button></td>
    <td><time>{dossierDateLabel(row.date)}</time></td><td><span className={`edupi-record-chip is-${row.kind}`}>{labels[row.kind]}</span></td>
    <td><button type="button" aria-label={`${open ? "收起" : "展开"}${row.title}`} aria-expanded={open} onClick={onToggle}><DisclosureChevron open={open} /></button></td>
  </tr>{open ? <tr className="edupi-dossier-record-table__detail"><td colSpan={4}><p>{row.note || row.title}</p><span>学生档案</span>{row.student && onStudent ? <button type="button" onClick={() => onStudent(row.student!)}>打开学生档案</button> : null}</td></tr> : null}</>;
}

export function dossierRecordsCsv(rows: DossierRecordRow[]): string {
  const cell = (value: string) => {
    const safe = /^\s*[=+\-@]/.test(value) ? `'${value}` : value;
    return `"${safe.replaceAll('"','""')}"`;
  };
  return "\uFEFF" + [["学生","记录","日期","状态","备注"], ...rows.map(row => [row.studentName || "", row.title, row.date || "", labels[row.kind], row.note])].map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
