"use client";
import { useState } from "react";

export function EduPiTeachingMethodEditor({ skillId, onSaved, mutationEnabled = false }: { skillId?: string; onSaved: () => void; mutationEnabled?: boolean }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (decision = "accepted") => {
    if (!mutationEnabled) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/edupi/teaching-skills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(skillId ? { action: "review", skill_id: skillId, content, decision } : { action: "create", title, content }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "保存失败");
      window.dispatchEvent(new Event("edupi-preparation-updated")); onSaved();
    } catch (error) { setError(error instanceof Error ? error.message : "保存失败"); }
    finally { setBusy(false); }
  };
  if (!mutationEnabled) return <p>当前教学方法不可编辑。</p>;
  return <form onSubmit={event => { event.preventDefault(); void save(); }} style={{ display: "grid", gap: 10, padding: 16 }}>
    {!skillId ? <label>方法名称<input value={title} maxLength={240} required onChange={event => setTitle(event.target.value)} /></label> : null}
    <label>{skillId ? "使用反馈" : "做法与依据"}<textarea value={content} required maxLength={12000} rows={4} onChange={event => setContent(event.target.value)} /></label>
    {error ? <p role="alert">{error}</p> : null}
    <div style={{ display: "flex", gap: 8 }}><button className="native-button" disabled={busy || !content.trim() || !skillId && !title.trim()} type="submit">{busy ? "保存中…" : skillId ? "接受并保存反馈" : "保存方法"}</button>{skillId ? <button type="button" className="native-button" disabled={busy || !content.trim()} onClick={() => void save("rejected")}>停止使用</button> : null}</div>
  </form>;
}
