"use client";

import { useEffect, useMemo, useState } from "react";
import type { EducationContract } from "@/lib/edupi-education-contract";
import { INSIGHT_CATEGORIES, INSIGHT_STATUSES, insightCategory, routePart, type InsightCategoryId, type InsightStatusId } from "@/lib/edupi-domain-navigation";

const PAGE_SIZE = 8;

function shortDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function EduPiInsightDatabase({ data, query, selectedObjectId }: { data: EducationContract; query: string; selectedObjectId: string | null }) {
  const [category = "learning", status = "all"] = routePart(selectedObjectId, "insights", "learning:all").split(":") as [InsightCategoryId, InsightStatusId];
  const [page, setPage] = useState(0);
  const categoryLabel = INSIGHT_CATEGORIES.find((item) => item.id === category)?.label || "学情观察";
  const statusLabel = INSIGHT_STATUSES.find((item) => item.id === status)?.label || "全部";
  const rows = useMemo(() => {
    const insights = data.continuity.insights.filter((item) => !item.content.startsWith("[主题候选]") && insightCategory(item.content) === category).map((item) => ({ id: `insight:${item.id}`, type: "洞察", content: item.content.replace(/^\[梦境启示\]\s*/, ""), status: item.status === "surfaced" ? "已浮出" : "酝酿中", statusId: item.status, evidence: item.evidenceIds, strength: Math.round(item.confidence * 100), date: item.surfacedAt || item.createdAt, related: [] as string[] }));
    const signals = data.continuity.signals.filter((item) => insightCategory(item.content) === category).map((item) => ({ id: `signal:${item.id}`, type: "观察", content: item.content, status: "弱信号", statusId: "signal", evidence: [] as string[], strength: item.strength, date: item.lastSeenAt || item.createdAt, related: item.related }));
    return [...insights, ...signals]
      .filter((item) => status === "all" || item.statusId === status)
      .filter((item) => !query || `${item.content} ${item.status} ${item.related.join(" ")}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
      .sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")));
  }, [category, data.continuity.insights, data.continuity.signals, query, status]);
  useEffect(() => setPage(0), [category, query, status]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const visible = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return <main className="edupi-module-workspace edupi-database-workspace">
    <header className="edupi-module-heading"><div><span>观察与洞察 / {categoryLabel}</span><h1>{categoryLabel}</h1><p>{statusLabel} · {rows.length} 条记录</p></div></header>
    <section className="edupi-database" aria-label={`${categoryLabel}数据库`}>
      <div className="edupi-database__head edupi-insight-db-grid"><span>类型</span><span>内容</span><span>状态</span><span>依据</span><span>最近时间</span></div>
      {visible.map((item) => <details className="edupi-database-row" key={item.id}><summary className="edupi-insight-db-grid"><span>{item.type}</span><strong>{item.content}</strong><span>{item.status}</span><span>{item.evidence.length || item.related.length}</span><time>{shortDate(item.date)}</time></summary><div className="edupi-database-row__detail"><div><span>强度 / 置信度</span><strong>{item.strength}{item.type === "洞察" ? "%" : " 次"}</strong></div><div><span>关联</span><strong>{item.related.join("、") || "—"}</strong></div><div><span>来源依据</span><strong>{item.evidence.length ? `${item.evidence.length} 条已保留` : "继续观察"}</strong></div></div></details>)}
      {visible.length === 0 ? <div className="edupi-database__empty">当前筛选暂无记录</div> : null}
    </section>
    <nav className="edupi-database-pagination" aria-label="观察与洞察分页"><button type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>上一页</button><span>{page + 1} / {pages}</span><button type="button" disabled={page >= pages - 1} onClick={() => setPage((value) => value + 1)}>下一页</button></nav>
  </main>;
}
