"use client";

import { useEffect, useState } from "react";
import type { GeneratedArtifact } from "@/lib/edupi-generated-artifacts";
import { isTauriDesktop } from "@/lib/desktop-updater";
import { revealItemInDirNative } from "@/lib/desktop-native";

export function EduPiConversationFiles({ sessionId, taskId, cwd, onOpen }: { sessionId: string; taskId?: string; cwd: string; onOpen?: (path: string) => void }) {
  const [open, setOpen] = useState(Boolean(taskId));
  const [files, setFiles] = useState<GeneratedArtifact[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch("/api/edupi/artifacts", { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("文件索引暂不可用");
      const result = await response.json();
      setFiles((result.artifacts || []).filter((file: GeneratedArtifact) => taskId ? file.task_id === taskId : file.session_id === sessionId));
    }).catch(error => { if (!controller.signal.aborted) setMessage(error.message); });
    return () => controller.abort();
  }, [open, sessionId, taskId, refresh]);
  const sync = async () => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/edupi/artifacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "同步失败");
      setMessage(`已同步 ${result.registered} 份文件${result.failedCount ? `，${result.failedCount} 份未能接入` : ""}`);
      setRefresh(value => value + 1);
    } catch (error) { setMessage(error instanceof Error ? error.message : "同步失败"); }
    finally { setBusy(false); }
  };
  return <div style={{ alignSelf: "flex-end", padding: "6px 12px", maxWidth: "100%" }}>
    <button className="native-button" aria-expanded={open} onClick={() => setOpen(value => !value)}>文件 {open ? "⌃" : "⌄"}</button>
    {open ? <section aria-label="本次对话文件" style={{ padding: 12, border: "1px solid var(--border)", borderRadius: 8, maxHeight: 260, overflow: "auto" }} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); } }}>
      {files.map(file => {
        const fullPath = `${cwd.replace(/[\\/]$/, "")}/${file.relative_path}`;
        return <div key={file.artifact_id} style={{ display: "flex", gap: 8, marginBottom: 6 }}><button className="native-button" onClick={() => onOpen?.(fullPath)}>{file.title}</button>{isTauriDesktop() ? <button className="native-button" aria-label={`${file.title}所在文件夹`} onClick={() => void revealItemInDirNative(fullPath).catch(() => setMessage("文件夹打开失败"))}>文件夹</button> : null}</div>;
      })}
      {files.length === 0 ? <p>暂无已登记文件</p> : null}
      {sessionId ? <button className="native-button" disabled={busy} onClick={() => void sync()}>{busy ? "同步中…" : "同步对话文件"}</button> : null}
      {message ? <p role="status">{message}</p> : null}
    </section> : null}
  </div>;
}
