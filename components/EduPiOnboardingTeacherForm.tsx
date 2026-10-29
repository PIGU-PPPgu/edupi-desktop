"use client";

import { useEffect, useState, type FormEvent } from "react";
import { verifyTeacherContextReview } from "@/lib/edupi-context-editor-model";
import type { TeacherContextSnapshot } from "@/lib/edupi-onboarding-types";

type TeacherFields = { name: string; subject: string; grade: string; role: string; class_name: string };
const EMPTY: TeacherFields = { name: "", subject: "", grade: "", role: "任课教师", class_name: "" };

export function EduPiOnboardingTeacherForm({ onComplete, onBusyChange }: { onComplete: () => void; onBusyChange: (busy: boolean) => void }) {
  const [fields, setFields] = useState<TeacherFields>(EMPTY);
  const [configured, setConfigured] = useState(false);
  const [multipleClasses, setMultipleClasses] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    onBusyChange(true);
    fetch("/api/edupi/onboarding", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("教师资料读取失败");
        const data = await response.json() as TeacherContextSnapshot;
        if (controller.signal.aborted) return;
        const hasMultipleClasses = (data.classes?.length || 0) > 1;
        setFields({ name: data.name || "", subject: data.subject || "", grade: data.grade || "", role: data.roles?.includes("homeroom_teacher") ? "班主任" : "任课教师", class_name: hasMultipleClasses ? "" : data.classes?.[0] || "" });
        setConfigured(Boolean(data.configured && data.name?.trim() && data.subject?.trim() && data.grade?.trim()));
        setMultipleClasses(hasMultipleClasses);
      })
      .catch(() => { if (!controller.signal.aborted) setError("教师资料暂不可用，请重试"); })
      .finally(() => { if (!controller.signal.aborted) { setLoading(false); onBusyChange(false); } });
    return () => controller.abort();
  }, [onBusyChange]);

  const setField = (field: keyof TeacherFields, value: string) => setFields((current) => ({ ...current, [field]: value }));
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || loading || multipleClasses) return;
    setBusy(true); setError(null);
    onBusyChange(true);
    const values = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value));
    try {
      const response = await fetch("/api/edupi/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
      const result = await response.json() as { error?: string; candidate?: { contextId?: string; snapshotId?: string; stateHash?: string } };
      if (!response.ok) throw new Error(result.error || "教师资料保存失败");
      const candidate = result.candidate;
      if (!candidate?.contextId || !candidate.snapshotId || !candidate.stateHash) throw new Error("教师资料保存回执不完整");
      const verified = verifyTeacherContextReview(result, { targetId: candidate.contextId, expectedSnapshotId: candidate.snapshotId, expectedStateHash: candidate.stateHash, decision: "accept" });
      if (!verified.ok) throw new Error("教师资料保存未确认");
      if (Object.entries(values).some(([key, value]) => verified.candidate.currentValues[key as keyof TeacherFields] !== value)) throw new Error("教师资料保存结果不一致，请核对");
      const refreshed = await fetch("/api/edupi/onboarding", { cache: "no-store" });
      const context = await refreshed.json() as TeacherContextSnapshot;
      if (!refreshed.ok || !context.configured || context.name !== fields.name.trim() || context.subject !== fields.subject.trim() || context.grade !== fields.grade.trim()) throw new Error("教师资料已保存，刷新后请核对");
      const expectedRole = { "任课教师": "subject_teacher", "班主任": "homeroom_teacher", "年级组": "grade_group", "教务": "academic_admin" }[fields.role];
      if (expectedRole && !context.roles.includes(expectedRole as TeacherContextSnapshot["roles"][number]) || fields.class_name.trim() && !context.classes.includes(fields.class_name.trim())) throw new Error("教师资料已保存，身份或班级待核对");
      window.dispatchEvent(new Event("edupi-education-refresh"));
      onComplete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "教师资料保存失败");
    } finally { setBusy(false); onBusyChange(false); }
  };

  return <form className="edupi-first-run__teacher-form" onSubmit={(event) => void submit(event)}>
    <header><h3>教师资料</h3></header>
    {loading ? <p role="status">正在读取教师资料…</p> : null}
    {multipleClasses ? <p role="status">已有多个班级，当前引导不修改原资料。可继续使用，或稍后在教师资料中核对。</p> : null}
    <div className="edupi-first-run__teacher-fields">
      <label>称呼<input value={fields.name} onChange={(event) => setField("name", event.target.value)} maxLength={120} required autoComplete="name" disabled={loading || busy || multipleClasses} /></label>
      <label>学科<input value={fields.subject} onChange={(event) => setField("subject", event.target.value)} maxLength={120} required disabled={loading || busy || multipleClasses} /></label>
      <label>年级<input value={fields.grade} onChange={(event) => setField("grade", event.target.value)} maxLength={120} required disabled={loading || busy || multipleClasses} /></label>
      <label>身份<select value={fields.role} onChange={(event) => setField("role", event.target.value)} disabled={loading || busy || multipleClasses}><option>任课教师</option><option>班主任</option><option>年级组</option><option>教务</option></select></label>
      <label className="is-wide">班级<input value={fields.class_name} onChange={(event) => setField("class_name", event.target.value)} maxLength={120} placeholder="可稍后填写" disabled={loading || busy || multipleClasses} /></label>
    </div>
    {error ? <p role="alert" className="edupi-first-run__form-error">{error}</p> : null}
    <footer>{configured ? <button type="button" className="edupi-first-run__form-secondary" disabled={loading || busy} onClick={onComplete}>使用现有资料</button> : null}<button type="submit" className="edupi-first-run__form-primary" disabled={loading || busy || multipleClasses}>{busy ? "保存中…" : "保存并继续"}</button></footer>
  </form>;
}
