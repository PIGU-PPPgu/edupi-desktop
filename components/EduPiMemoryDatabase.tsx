"use client";

import { useEffect, useMemo, useState } from "react";
import type { EducationContract, EducationMemoryCategory } from "@/lib/edupi-education-contract";
import { MEMORY_CATEGORIES, routePart } from "@/lib/edupi-domain-navigation";
import { isUserFacingMemory } from "@/lib/edupi-workbench";

const PAGE_SIZE = 8;

function shortDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function EduPiMemoryDatabase({ data, query, selectedObjectId, onStartAgent }: { data: EducationContract; query: string; selectedObjectId: string | null; onStartAgent: (prompt: string) => void }) {
  const category = routePart(selectedObjectId, "memory", "semester") as EducationMemoryCategory;
  const categoryLabel = MEMORY_CATEGORIES.find((item) => item.id === category)?.label || "学期";
  const [page, setPage] = useState(0);
  const rows = useMemo(() => data.continuity.memories
    .filter((memory) => memory.state === "active" && isUserFacingMemory(memory) && memory.category === category)
    .filter((memory) => !query || `${memory.content} ${memory.student || ""} ${memory.tags.join(" ")}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .sort((left, right) => String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || ""))), [category, data.continuity.memories, query]);
  useEffect(() => setPage(0), [category, query]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const visible = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return <main className="edupi-module-workspace edupi-database-workspace">
    <header className="edupi-module-heading"><div><span>教育记忆 / {categoryLabel}</span><h1>{categoryLabel}记忆</h1><p>{rows.length} 条当前记忆</p></div></header>
    <section className="edupi-database" aria-label={`${categoryLabel}记忆数据库`}>
      <div className="edupi-database__head edupi-memory-db-grid"><span>记忆</span><span>关联对象</span><span>标签</span><span>累计</span><span>更新时间</span></div>
      {visible.map((memory) => <details className="edupi-database-row" key={memory.id}>
        <summary className="edupi-memory-db-grid"><strong>{memory.content}</strong><span>{memory.student || categoryLabel}</span><span>{memory.tags.slice(0, 3).join(" · ") || "—"}</span><span>{memory.count} 次</span><time>{shortDate(memory.updatedAt || memory.createdAt)}</time></summary>
        <div className="edupi-database-row__detail"><div><span>创建</span><strong>{shortDate(memory.createdAt)}</strong></div><div><span>状态</span><strong>当前事实</strong></div><div><span>完整标签</span><strong>{memory.tags.join("、") || "无"}</strong></div><button type="button" onClick={() => onStartAgent(`请修订这条 EduPi ${categoryLabel}记忆：\n${memory.content}\n\n请先说明修改建议和依据，待我确认后再写回，保留旧版本。`)}>修订记忆</button></div>
      </details>)}
      {visible.length === 0 ? <div className="edupi-database__empty">此分类暂无记忆</div> : null}
    </section>
    <nav className="edupi-database-pagination" aria-label="记忆分页"><button type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>上一页</button><span>{page + 1} / {pages}</span><button type="button" disabled={page >= pages - 1} onClick={() => setPage((value) => value + 1)}>下一页</button></nav>
  </main>;
}
