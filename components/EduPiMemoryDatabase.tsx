"use client";

import { useEffect, useMemo, useState } from "react";
import type { EducationContract, EducationEntityDeleteKind, EducationMemory } from "@/lib/edupi-education-contract";
import { MEMORY_CATEGORIES, memoryCategoryRoute } from "@/lib/edupi-domain-navigation";
import { appendTeacherInputSlot } from "@/lib/edupi-teacher-input-slot";
import { isUserFacingMemory } from "@/lib/edupi-workbench";

const PAGE_SIZE = 8;

function shortDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function memoryUpdateReasonId(memoryId: string): string {
  return `memory-update-reason-${memoryId.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

export function EduPiMemoryDatabase({ data, query, selectedObjectId, onEducation, onStartAgent, onDeleteEntity }: { data: EducationContract; query: string; selectedObjectId: string | null; onEducation: (data: EducationContract) => void; onStartAgent: (prompt: string, mode?: "insert" | "replace") => void; onDeleteEntity: (kind: EducationEntityDeleteKind, id: string, label: string) => Promise<void> }) {
  const category = memoryCategoryRoute(selectedObjectId);
  const categoryLabel = MEMORY_CATEGORIES.find((item) => item.id === category)?.label || "学期";
  const [page, setPage] = useState(0);
  const [editor, setEditor] = useState<{ memoryId: string; draft: string; originalContent: string; revision: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
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
    if (!editor || !draft || draft === editor.originalContent || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/edupi/memories/${encodeURIComponent(memory.id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: editor.revision, content: draft }) });
      const result = await response.json() as { error?: string; code?: string; data?: EducationContract };
      if (!response.ok || !result.data) throw new Error(result.error || (result.code === "stale_revision" ? "记忆已更新，请刷新后重试" : "记忆保存失败"));
      const savedMemory = result.data.continuity.memories.find((item) => item.id === memory.id);
      onEducation(result.data);
      setPage(0);
      setEditor((current) => {
        if (current?.memoryId !== memory.id) return current;
        if (current.draft.trim() === draft) return null;
        return { ...current, originalContent: draft, revision: savedMemory?.revision ?? current.revision + 1 };
      });
      setMessage({ memoryId: memory.id, tone: "success", text: "记忆已保存" });
    } catch (error) {
      setMessage({ memoryId: memory.id, tone: "error", text: error instanceof Error ? error.message : "记忆保存失败" });
    } finally {
      setSaving(false);
    }
  };
  const openMemoryAgent = (memory: EducationMemory) => {
    const prompt = appendTeacherInputSlot([
      `请协助我修订这条 EduPi ${categoryLabel}记忆。`,
      `当前内容：${memory.content}`,
      "请根据我的要求说明修改建议和依据，待我确认后再写回并保留旧版本。",
    ].join("\n"), "我希望改成（在这里输入或口述）：");
    onStartAgent(prompt, "replace");
  };
  const deleteMemory = async (memory: EducationMemory) => {
    if (deletingId) return;
    setDeletingId(memory.id);
    setMessage(null);
    try {
      await onDeleteEntity("memory", memory.id, memory.content);
    } catch (error) {
      setMessage({ memoryId: memory.id, tone: "error", text: error instanceof Error ? error.message : "记忆删除失败" });
    } finally {
      setDeletingId(null);
    }
  };

  return <main className="edupi-module-workspace edupi-database-workspace">
    <header className="edupi-module-heading"><div><span>教育记忆 / {categoryLabel}</span><h1>{categoryLabel}记忆</h1><p>{rows.length} 条当前记忆</p></div></header>
    {message ? <p className={`edupi-memory-message is-${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>{message.text}</p> : null}
    <section className="edupi-database" aria-label={`${categoryLabel}记忆数据库`}>
      <div className="edupi-database__head edupi-memory-db-grid"><span>记忆</span><span>关联对象</span><span>标签</span><span>累计</span><span>更新时间</span></div>
      {visible.map((memory) => <details className="edupi-database-row" key={memory.id}>
        <summary className="edupi-memory-db-grid"><strong>{memory.content}</strong><span>{memory.student || categoryLabel}</span><span>{memory.tags.slice(0, 3).join(" · ") || "—"}</span><span>{memory.count} 次</span><time>{shortDate(memory.updatedAt || memory.createdAt)}</time></summary>
        <div className="edupi-database-row__detail"><div><span>创建</span><strong>{shortDate(memory.createdAt)}</strong></div><div><span>状态</span><strong>当前事实 · 版本 {memory.revision}</strong></div><div><span>完整标签</span><strong>{memory.tags.join("、") || "无"}</strong></div>{editor?.memoryId === memory.id ? <form className="edupi-memory-editor" onSubmit={(event) => { event.preventDefault(); void saveMemory(memory); }}><textarea value={editor.draft} rows={3} maxLength={4000} autoFocus aria-label="修改记忆内容" onChange={(event) => setEditor({ ...editor, draft: event.target.value })} /><footer><button type="button" disabled={saving} onClick={() => setEditor(null)}>取消</button><button type="submit" className="is-primary" disabled={saving || !editor.draft.trim() || editor.draft.trim() === editor.originalContent}>{saving ? "保存中…" : "保存"}</button></footer></form> : <footer className="edupi-memory-actions"><button type="button" aria-disabled={!data.capabilities.memoryUpdate.enabled} aria-describedby={!data.capabilities.memoryUpdate.enabled ? memoryUpdateReasonId(memory.id) : undefined} onClick={() => { if (!data.capabilities.memoryUpdate.enabled) return; setMessage(null); setEditor({ memoryId: memory.id, draft: memory.content, originalContent: memory.content, revision: memory.revision }); }}>手动修改</button>{!data.capabilities.memoryUpdate.enabled ? <span id={memoryUpdateReasonId(memory.id)} className="edupi-visually-hidden">{data.capabilities.memoryUpdate.reason}</span> : null}<button type="button" onClick={() => openMemoryAgent(memory)}>AI 协作</button>{data.capabilities.entityDelete.enabled && data.capabilities.entityDelete.targetKinds.includes("memory") ? <button type="button" className="is-delete" disabled={Boolean(deletingId)} onClick={() => void deleteMemory(memory)}>{deletingId === memory.id ? "删除中…" : "删除"}</button> : null}</footer>}</div>
      </details>)}
      {visible.length === 0 ? <div className="edupi-database__empty">此分类暂无记忆</div> : null}
    </section>
    <nav className="edupi-database-pagination" aria-label="记忆分页"><button type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>上一页</button><span>{page + 1} / {pages}</span><button type="button" disabled={page >= pages - 1} onClick={() => setPage((value) => value + 1)}>下一页</button></nav>
  </main>;
}
