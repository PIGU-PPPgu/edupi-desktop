"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { readEduPiWorkspace } from "@/lib/edupi-education-client";
import { isTauriDesktop } from "@/lib/desktop-updater";
import { EduPiRosterPreview, type RosterPreview } from "./EduPiRosterPreview";

type AutoImportResponse = { status?: "imported" | "needs_review"; verified?: boolean; sourceName?: string; sheets?: RosterPreview["sheets"]; reason?: string; result?: { imported?: number }; data?: { students?: unknown[] }; error?: string };

export function EduPiOnboardingRoster({ onComplete, onBusyChange }: { onComplete: () => void; onBusyChange: (busy: boolean) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<RosterPreview | null>(null);
  const [reviewReason, setReviewReason] = useState<string | null>(null);
  const [imported, setImported] = useState<number | null>(null);
  const [existing, setExisting] = useState(0);

  useEffect(() => { onBusyChange(busy || suggestBusy); }, [busy, suggestBusy, onBusyChange]);

  useEffect(() => {
    let active = true;
    void readEduPiWorkspace().then((bundle) => { if (active) setExisting(bundle.data.students.length); }).catch(() => {});
    return () => { active = false; };
  }, []);

  const markImported = (count: number) => {
    setImported(count);
    setPreview(null);
    setReviewReason(null);
    setExisting((value) => Math.max(value, count));
    window.dispatchEvent(new Event("edupi-education-refresh"));
  };

  const selectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busy) return;
    onBusyChange(true);
    setBusy(true); setError(null); setPreview(null); setReviewReason(null); setImported(null);
    try {
      const body = new FormData(); body.append("file", file, file.name);
      const response = await fetch("/api/edupi/students/import?auto=1", { method: "POST", body });
      const result = await response.json() as AutoImportResponse;
      if (!response.ok) throw new Error(response.status >= 500 ? "导入状态未确认，请先查看班级名单后再重试" : result.error || "名单无法读取");
      if (result.status === "needs_review" && result.sourceName && result.sheets?.length) {
        setPreview({ sourceName: result.sourceName, sheets: result.sheets });
        setReviewReason(result.reason || "请核对名单字段");
        return;
      }
      if (result.status !== "imported" || result.verified !== true || !Number.isInteger(result.result?.imported) || !Array.isArray(result.data?.students)) throw new Error("导入回执无效，请核对班级名单");
      markImported(result.result!.imported!);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "名单导入失败"); }
    finally { setBusy(false); }
  };

  const confirmImport = async (csv: string) => {
    if (!preview || busy) return;
    onBusyChange(true);
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/edupi/students/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceName: preview.sourceName, csv }) });
      const result = await response.json() as { verified?: boolean; result?: { imported?: number }; data?: { students?: unknown[] }; error?: string };
      if (!response.ok) throw new Error(response.status >= 500 ? "导入状态未确认，请先查看班级名单后再重试" : result.error || "名单导入失败");
      if (result.verified !== true || !Number.isInteger(result.result?.imported) || !Array.isArray(result.data?.students)) throw new Error("导入回执无效，请核对班级名单");
      markImported(result.result!.imported!);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "名单导入失败"); }
    finally { setBusy(false); }
  };

  return <section className="edupi-first-run__roster" aria-label="学生名单导入">
    {imported !== null ? <div className="edupi-first-run__roster-success" role="status"><strong>已导入 {imported} 名学生</strong><button type="button" className="edupi-first-run__form-primary" disabled={busy || suggestBusy} onClick={onComplete}>继续</button></div> : preview ? <><p className="edupi-first-run__roster-reason">{reviewReason}</p><EduPiRosterPreview preview={preview} busy={busy} onCancel={() => { setPreview(null); setReviewReason(null); }} onImport={(csv) => void confirmImport(csv)} aiSuggestion={isTauriDesktop()} onSuggestBusyChange={setSuggestBusy} /></> : <div className="edupi-first-run__roster-pick">
      <div className="edupi-first-run__roster-icon" aria-hidden="true">↑</div>
      <h3>上传学生名单</h3>
      <p>选择 Excel、CSV 或 TSV。字段清晰时自动导入，需要核对时展示预览。</p>
      <input ref={inputRef} type="file" accept=".csv,.tsv,.xlsx,.xls,.xlsm,.xlsb,text/csv,text/tab-separated-values" hidden onChange={(event) => void selectFile(event)} />
      <button type="button" className="edupi-first-run__form-primary" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? "正在处理…" : "选择名单"}</button>
      {existing > 0 ? <button type="button" className="edupi-first-run__form-secondary" disabled={busy} onClick={onComplete}>使用现有名单 · {existing} 人</button> : null}
    </div>}
    {error ? <p role="alert" className="edupi-first-run__form-error">{error}</p> : null}
  </section>;
}
