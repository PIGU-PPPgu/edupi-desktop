"use client";

import { useEffect, useMemo, useState } from "react";
import type { EducationContract, EducationMemory } from "@/lib/edupi-education-contract";
import { MEMORY_CATEGORIES, memoryCategoryRoute } from "@/lib/edupi-domain-navigation";
import { isUserFacingMemory } from "@/lib/edupi-workbench";

const PAGE_SIZE = 8;

function shortDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function EduPiMemoryDatabase({ data, query, selectedObjectId, onEducation, onStartAgent }: { data: EducationContract; query: string; selectedObjectId: string | null; onEducation: (data: EducationContract) => void; onStartAgent: (prompt: string) => void }) {
  const category = memoryCategoryRoute(selectedObjectId);
  const categoryLabel = MEMORY_CATEGORIES.find((item) => item.id === category)?.label || "学期";
  const [page, setPage] = useState(0);
  const [editor, setEditor] = useState<{ memoryId: string; draft: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ memoryId: string; tone: "success" | "error"; text: string } | null>(null);
  const rows = useMemo(() => data.continuity.memories
    .filter((memory) => memory.state === "active" && isUserFacingMemory(memory) && memory.category === category)
    .filter((memory) => !query || `${memory.content} ${memory.student || ""} ${memory.tags.join(" ")}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .sort((left, right) => String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || ""))), [category, data.continuity.memories, query]);
  useEffect(() => { setPage(0); setEditor(null); setMessage(null); }, [category, query]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const visible = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const saveMemory = async (memory: EducationMemory) => {
    const draft = editor?.memoryId === memory.id ? editor.draft.trim() : "";
    if (!draft || draft === memory.content || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/edupi/memories/${encodeURIComponent(memory.id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: memory.revision, content: draft }) });
      const result = await response.json() as { error?: string; code?: string; data?: EducationContract };
      if (!response.ok || !result.data) throw new Error(result.error || (result.code === "stale_revision" ? "记忆已更新，请刷新后重试" : "记忆保存失败"));
      onEducation(result.data);
      setEditor(null);
      setMessage({ memoryId: memory.id, tone: "success", text: "记忆已保存" });
    } catch (error) {
      setMessage({ memoryId: memory.id, tone: "error", text: error instanceof Error ? error.message : "记忆保存失败" });
    } finally {
      setSaving(false);
    }
  };

  return <main className="edupi-module-workspace edupi-database-workspace">
    <header className="edupi-module-heading"><div><span>教育记忆 / {categoryLabel}</span><h1>{categoryLabel}记忆</h1><p>{rows.length} 条当前记忆</p></div></header>
    <section className="edupi-database" aria-label={`${categoryLabel}记忆数据库`}>
      <div className="edupi-database__head edupi-memory-db-grid"><span>记忆</span><span>关联对象</span><span>标签</span><span>累计</span><span>更新时间</span></div>
      {visible.map((memory) => <details className="edupi-database-row" key={memory.id}>
        <summary className="edupi-memory-db-grid"><strong>{memory.content}</strong><span>{memory.student || categoryLabel}</span><span>{memory.tags.slice(0, 3).join(" · ") || "—"}</span><span>{memory.count} 次</span><time>{shortDate(memory.updatedAt || memory.createdAt)}</time></summary>
        <div className="edupi-database-row__detail"><div><span>创建</span><strong>{shortDate(memory.createdAt)}</strong></div><div><span>状态</span><strong>当前事实 · 版本 {memory.revision}</strong></div><div><span>完整标签</span><strong>{memory.tags.join("、") || "无"}</strong></div>{editor?.memoryId === memory.id ? <form className="edupi-memory-editor" onSubmit={(event) => { event.preventDefault(); void saveMemory(memory); }}><textarea value={editor.draft} rows={3} maxLength={4000} autoFocus aria-label="修改记忆内容" onChange={(event) => setEditor({ memoryId: memory.id, draft: event.target.value })} /><footer><button type="button" disabled={saving} onClick={() => setEditor(null)}>取消</button><button type="submit" className="is-primary" disabled={saving || !editor.draft.trim() || editor.draft.trim() === memory.content}>{saving ? "保存中…" : "保存"}</button></footer></form> : <footer className="edupi-memory-actions"><button type="button" disabled={!data.capabilities.memoryUpdate.enabled} title={data.capabilities.memoryUpdate.reason} onClick={() => { setMessage(null); setEditor({ memoryId: memory.id, draft: memory.content }); }}>手动修改</button><button type="button" onClick={() => onStartAgent(`请协助我修订这条 EduPi ${categoryLabel}记忆：\n${memory.content}\n\n请先说明修改建议和依据，待我确认后再写回，保留旧版本。`)}>AI 协作</button></footer>}{message?.memoryId === memory.id ? <p className={`edupi-memory-message is-${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>{message.text}</p> : null}</div>
      </details>)}
      {visible.length === 0 ? <div className="edupi-database__empty">此分类暂无记忆</div> : null}
    </section>
    <nav className="edupi-database-pagination" aria-label="记忆分页"><button type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>上一页</button><span>{page + 1} / {pages}</span><button type="button" disabled={page >= pages - 1} onClick={() => setPage((value) => value + 1)}>下一页</button></nav>
  </main>;
}
