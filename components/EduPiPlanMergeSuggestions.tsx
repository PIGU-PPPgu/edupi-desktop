"use client";
import { useEffect, useState } from "react";
import type { CalendarFact } from "@/lib/edupi-education-contract";
import type { PlanOverlapAction, PlanOverlapState } from "@/lib/edupi-plan-overlap-types";

export function EduPiPlanMergeSuggestions({ calendar }: { calendar: CalendarFact[] }) {
  const [state, setState] = useState<PlanOverlapState | null>(null);
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState("正在检查计划");
  const [error, setError] = useState("");
  const [keepers, setKeepers] = useState<Record<string, string>>({});
  const calendarVersion = JSON.stringify(calendar);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        let response = await fetch("/api/edupi/plan-overlaps", { signal: controller.signal, cache: "no-store" });
        let result = await response.json() as PlanOverlapState;
        if (!response.ok) throw new Error(result.error || "重复计划检查暂不可用");
        if (!controller.signal.aborted) setState(result);
        if (result.needsScan && result.pairs > 0 && !result.error) {
          setBusy(true);
          setOperation("正在检查计划");
          response = await fetch("/api/edupi/plan-overlaps", { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "scan" }) });
          result = await response.json();
        }
        if (!controller.signal.aborted) { setState(result); setError(result.error || ""); }
      } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "检查失败"); }
      finally { if (!controller.signal.aborted) setBusy(false); }
    };
    void load();
    return () => controller.abort();
  }, [calendarVersion]);
  const resolve = async (action: PlanOverlapAction) => {
    setBusy(true); setError("");
    setOperation(action.action === "scan" ? "正在检查计划" : action.action === "merge" ? "正在合并" : "正在保存");
    try {
      const response = await fetch("/api/edupi/plan-overlaps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) });
      const result = await response.json() as PlanOverlapState;
      setState(result);
      if (!response.ok || result.error) throw new Error(result.error || "操作未完成");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "操作未完成"); }
    finally { setBusy(false); if (action.action === "merge") window.dispatchEvent(new Event("edupi-preparation-updated")); }
  };
  const pending = state?.suggestions?.filter(item => item.status === "pending") || [];
  const remaining = state?.remaining || 0;
  if (!busy && !error && !pending.length && !remaining) return null;
  return <section aria-label="计划合并建议" style={{ padding: "12px 16px", border: "1px solid var(--border)", borderRadius: 8, marginBottom: 12 }}>
    <header style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><strong>{busy ? operation : `计划合并建议 · ${pending.length}`}</strong><button className="native-button" disabled={busy} onClick={() => void resolve({ action: "scan" })}>{remaining ? `继续检查 · ${remaining}` : "重新检查"}</button></header>
    {error ? <p role="alert">{error}</p> : null}
    {pending.map(item => <details key={item.id}>
      <summary>{item.kind === "duplicate" ? "可能重复" : "日期重叠"} · {item.left.name} / {item.right.name}</summary>
      <p>{item.reason}</p>
      <label>保留计划 <select aria-label={`保留计划 ${item.id}`} disabled={busy || item.merging} value={item.keepId || keepers[item.id] || item.left.id || ""} onChange={event => setKeepers(value => ({ ...value, [item.id]: event.target.value }))}>{[item.left, item.right].map(plan => <option key={plan.id} value={plan.id || ""}>{plan.name} · {plan.date}{plan.endDate && plan.endDate !== plan.date ? ` 至 ${plan.endDate}` : ""}</option>)}</select></label>
      <p>{item.merging ? "停止合并不会撤回已保存的备注。" : "保留所选日期，合并双方备注。原文件保留。"}</p>
      <div style={{ display: "flex", gap: 8, padding: "8px 0" }}><button className="native-button" disabled={busy} onClick={() => void resolve({ action: "merge", id: item.id, keepId: item.keepId || keepers[item.id] || item.left.id || undefined })}>{item.merging ? "继续合并" : "合并"}</button><button className="native-button" disabled={busy} onClick={() => void resolve({ action: "keep_separate", id: item.id })}>{item.merging ? "停止合并" : "分别保留"}</button>{!item.merging && <button className="native-button" disabled={busy} onClick={() => void resolve({ action: "ignore", id: item.id })}>忽略</button>}</div>
    </details>)}
  </section>;
}
