"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { isTauriDesktop, stageDesktopMaterialFiles } from "@/lib/desktop-native";
import { stageBrowserMaterialFiles, type MaterialStagingDescriptor } from "@/lib/edupi-material-staging-client";
import { materialScheduleUploadProposal } from "@/lib/edupi-material-schedule";
import type { MaterialScheduleApplyResult } from "@/lib/edupi-material-schedule";
import type { EduPiMaterialScheduleProposal as UploadProposal } from "@/lib/edupi-core-process-client";
import { EduPiMaterialScheduleProposal } from "./EduPiMaterialScheduleProposal";

export function calendarAdoptionMatches(result: MaterialScheduleApplyResult, calendar: Array<{ id?: string | null }>): boolean {
  if (!["accepted", "modified"].includes(result.status) || result.applied_ids.length === 0) return false;
  const observed = new Set(calendar.map((event) => event.id).filter((id): id is string => typeof id === "string"));
  return result.applied_ids.every((id) => observed.has(id));
}

type MaterialIntakeResponse = { error?: string; materialReceivedOnly?: boolean; receipt?: { status?: string }; materialScheduleProposal?: unknown };

export function materialIntakeAccepted(result: MaterialIntakeResponse): boolean {
  return result.materialReceivedOnly === true && ["accepted", "modified"].includes(result.receipt?.status || "");
}

export function EduPiOnboardingCalendarUpload({ onComplete, onReview, onOpenCalendar, onBusyChange }: { onComplete: () => void; onReview: () => void; onOpenCalendar: () => void; onBusyChange: (busy: boolean) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [staged, setStaged] = useState<MaterialStagingDescriptor | null>(null);
  const [received, setReceived] = useState(false);
  const [proposal, setProposal] = useState<UploadProposal | null>(null);
  const [proposalBusy, setProposalBusy] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [adopted, setAdopted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { onBusyChange(busy || proposalBusy || verifying); }, [busy, proposalBusy, verifying, onBusyChange]);

  const verifyApplied = async (result: MaterialScheduleApplyResult) => {
    if (!["accepted", "modified"].includes(result.status) || result.applied_ids.length === 0) { setError("安排仍待核对，可到材料页继续处理"); return; }
    onBusyChange(true);
    setVerifying(true);
    try {
      const response = await fetch("/api/edupi/workspace", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const workspace = await response.json() as { data?: { calendar?: Array<{ id?: string | null }> } };
      if (!workspace.data?.calendar || !calendarAdoptionMatches(result, workspace.data.calendar)) throw new Error();
      setAdopted(true);
      setError(null);
      window.dispatchEvent(new Event("edupi-education-refresh"));
    } catch { setError("安排已提交，但日程回读未确认，请到材料页核对"); }
    finally { setVerifying(false); }
  };

  const selectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busy) return;
    onBusyChange(true);
    setBusy(true); setError(null); setStaged(null); setReceived(false); setProposal(null); setAdopted(false);
    try {
      const items = isTauriDesktop() ? await stageDesktopMaterialFiles([file]) : await stageBrowserMaterialFiles([file]);
      if (items.length !== 1) throw new Error("文件暂存未确认，请重试");
      const item = items[0];
      setStaged(item);
      window.dispatchEvent(new Event("edupi-material-staging-changed"));
      if (item.kind !== "calendar") return;
      const response = await fetch("/api/edupi/intake", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "material", stagingId: item.staging_id, title: item.original_name, materialKind: "other", subject: "", classId: "" }) });
      const result = await response.json() as MaterialIntakeResponse;
      if (!response.ok || !materialIntakeAccepted(result)) throw new Error(result.error || "行事历已暂存，接入状态待核对");
      setReceived(true);
      window.dispatchEvent(new Event("edupi-material-staging-changed"));
      window.dispatchEvent(new Event("edupi-education-refresh"));
      if (result.materialScheduleProposal) setProposal(materialScheduleUploadProposal(result.materialScheduleProposal));
      else setError("文件已接入，安排提案待核对");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "行事历上传失败"); }
    finally { setBusy(false); }
  };

  const scheduleStatus = !received ? "已暂存，接入待核对"
    : proposal?.status === "proposed" ? "安排提案待确认"
      : proposal?.status === "held" ? "安排待核对"
        : proposal?.status === "unavailable" ? "安排暂不可用" : "已接入，安排待核对";

  return <section className="edupi-first-run__calendar-upload" aria-label="导入行事历">
    <header><h3>上传行事历</h3><p>真实日期能帮助 EduPi 提前准备待办和材料；交付前由你确认。</p></header>
    {!staged ? <div className="edupi-first-run__calendar-pick"><div aria-hidden="true">▦</div><span>支持 ICS、PDF、Word 和图片</span><input ref={inputRef} type="file" accept=".ics,.pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,text/calendar,application/pdf,image/*" hidden onChange={(event) => void selectFile(event)} /><button type="button" className="edupi-first-run__form-primary" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? "正在处理…" : "选择文件"}</button></div> : <div className="edupi-first-run__calendar-result"><strong>{staged.original_name}</strong><span>{staged.kind === "calendar" ? scheduleStatus : "已暂存，请在材料页确认来源与类型"}</span></div>}
    {proposal ? <EduPiMaterialScheduleProposal materialId={proposal.material_id} initialProposal={proposal} lockOpenDuringApply onBusyChange={setProposalBusy} onApplied={(result) => { void verifyApplied(result); }} /> : null}
    {error ? <p role="alert" className="edupi-first-run__form-error">{error}</p> : null}
    <footer>{staged ? <button type="button" className="edupi-first-run__form-secondary" disabled={busy || proposalBusy || verifying} onClick={onReview}>到材料页核对</button> : <button type="button" className="edupi-first-run__form-secondary" disabled={busy} onClick={onOpenCalendar}>手动填写日程与课表</button>}{adopted ? <button type="button" className="edupi-first-run__form-primary" disabled={busy || proposalBusy || verifying} onClick={onComplete}>继续</button> : null}</footer>
  </section>;
}
