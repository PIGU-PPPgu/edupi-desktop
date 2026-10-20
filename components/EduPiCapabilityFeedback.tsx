"use client";

import { useEffect, useRef, useState } from "react";
import type { EducationWorkCase, TeacherTask } from "@/lib/edupi-education-contract";
import { capabilityFeedbackBinding, capabilityFeedbackMustRefresh, currentCapabilityFeedback, prepareCapabilityFeedback, readCapabilityFeedbackRecords } from "@/lib/edupi-capability-feedback";
import { recordTeacherFeedback, type TeacherFeedbackCapture } from "@/lib/edupi-teacher-feedback";
import { isTauriDesktop } from "@/lib/desktop-updater";
import { EduPiTeacherValueForm, type TeacherValueDraft } from "./EduPiTodayWork";
import { EduPiUsageVisibility } from "./EduPiUsageObservation";

const EMPTY: TeacherValueDraft = { usefulness: "", used: false, wouldUseAgain: "", baselineMinutes: "", reviewMinutes: "", note: "" };

export function EduPiCapabilityFeedback({ task, workCase }: { task: TeacherTask; workCase: EducationWorkCase | null }) {
  const binding = capabilityFeedbackBinding(task, workCase);
  const identity = binding ? `${binding.workCaseId}:${binding.revision}:${binding.status}` : "unavailable";
  const bindingRef = useRef(binding);
  bindingRef.current = binding;
  const [desktop, setDesktop] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const [draft, setDraft] = useState<TeacherValueDraft>(EMPTY);
  const [prepared, setPrepared] = useState<TeacherFeedbackCapture | null>(null);
  const [retry, setRetry] = useState<TeacherFeedbackCapture | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const epoch = useRef(0);
  useEffect(() => { setDesktop(isTauriDesktop()); }, []);
  useEffect(() => {
    const current = ++epoch.current;
    setOpen(false); setBusy(false); setRecorded(false); setDraft(EMPTY); setPrepared(null); setRetry(null); setMessage(null);
    const activeBinding = bindingRef.current;
    if (desktop && activeBinding) void readCapabilityFeedbackRecords().then(rows => {
      if (epoch.current === current) setRecorded(Boolean(currentCapabilityFeedback(rows, activeBinding)));
    }).catch(() => {});
    return () => { epoch.current = current + 1; };
  }, [desktop, identity]);
  if (!desktop || !binding) return null;

  const openForm = async () => {
    if (busy) return;
    const current = epoch.current;
    setBusy(true); setMessage(null);
    try {
      const rows = await readCapabilityFeedbackRecords();
      if (epoch.current !== current) return;
      if (currentCapabilityFeedback(rows, binding)) { setRecorded(true); return; }
      const capture = retry || await prepareCapabilityFeedback(binding);
      if (epoch.current !== current) return;
      setPrepared(capture); setOpen(true);
    } catch { if (epoch.current === current) setMessage("评价依据暂不可用，请刷新任务。"); }
    finally { if (epoch.current === current) setBusy(false); }
  };

  const submit = async () => {
    if (busy || !prepared || !retry && !draft.usefulness) return;
    const current = epoch.current;
    setBusy(true); setMessage(null);
    try {
      const rows = await readCapabilityFeedbackRecords();
      if (epoch.current !== current) return;
      if (currentCapabilityFeedback(rows, binding)) { setRecorded(true); setOpen(false); setRetry(null); return; }
      const baseline = draft.baselineMinutes.trim(), review = draft.reviewMinutes.trim();
      const baselineMinutes = baseline ? Number(baseline) : null, reviewMinutes = review ? Number(review) : null;
      if (!retry && ((baselineMinutes === null) !== (reviewMinutes === null)
        || baselineMinutes !== null && (!Number.isFinite(baselineMinutes) || baselineMinutes <= 0 || baselineMinutes > 1440)
        || reviewMinutes !== null && (!Number.isFinite(reviewMinutes) || reviewMinutes <= 0 || reviewMinutes > 1440))) {
        setMessage("请同时填写 1–1440 分钟的预计与实际投入。"); return;
      }
      const capture: TeacherFeedbackCapture = retry || { ...prepared, usefulness: draft.usefulness || "not_observed",
        used: draft.used && (binding.decision === "accept" || binding.decision === "modify"),
        wouldUseAgain: draft.wouldUseAgain === "" ? null : draft.wouldUseAgain === "yes",
        baselineMinutes, reviewMinutes, note: draft.note.trim() || null,
        issueCodes: draft.usefulness === "unsafe" ? ["safety"] : draft.usefulness === "incorrect" ? ["incorrect_content"] : [] };
      setRetry(capture);
      const result = await recordTeacherFeedback(capture);
      if (epoch.current !== current) return;
      const confirmed = currentCapabilityFeedback(await readCapabilityFeedbackRecords(), binding);
      if (epoch.current !== current) return;
      if (!result.current || confirmed?.feedback_id !== result.feedbackId) {
        setRetry(null); setPrepared(null); setOpen(false); setMessage("评价状态已变化，请刷新任务。"); return;
      }
      setRecorded(true); setRetry(null); setOpen(false); setDraft(EMPTY);
    } catch (error) { if (epoch.current === current) {
      if (capabilityFeedbackMustRefresh(error)) { setRetry(null); setPrepared(null); setOpen(false); setMessage("评价目标已变化，请刷新任务。"); }
      else setMessage("评价尚未核对写入，请重试。");
    } }
    finally { if (epoch.current === current) setBusy(false); }
  };

  return <section className="edupi-task-feedback" aria-label="教师评价">
    {!open && !recorded ? <button type="button" disabled={busy} onClick={() => void openForm()}>评价本次草稿</button> : null}
    {recorded ? <span role="status">已评价</span> : null}
    {open && !retry ? <EduPiUsageVisibility target={{ kind: "capability_work", targetId: binding.workCaseId, expectedRevision: binding.revision }} action="feedback_form_opened" surface="task"><EduPiTeacherValueForm draft={draft} allowUsed={binding.decision === "accept" || binding.decision === "modify"}
      busy={busy} onChange={setDraft} onSubmit={() => void submit()} onCancel={() => { if (!busy) setOpen(false); }} /></EduPiUsageVisibility> : null}
    {open && retry ? <button type="button" disabled={busy} onClick={() => void submit()}>{busy ? "核对中…" : "重试记录"}</button> : null}
    {message ? <p role="status">{message}{!prepared && !busy ? <button type="button" onClick={() => window.dispatchEvent(new Event("edupi-education-refresh"))}>刷新任务</button> : null}</p> : null}
  </section>;
}
