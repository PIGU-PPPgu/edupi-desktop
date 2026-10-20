"use client";

import { useCallback, useEffect, useState } from "react";
import { downloadUrlAsFile } from "@/lib/desktop-native";
import { eraseTeacherUsage, readTeacherUsageBatch, readTeacherUsageStatus, retryTeacherUsageOutbox, setTeacherUsageConsent, teacherUsageErrorLabel, type TeacherUsageStatus } from "@/lib/edupi-teacher-usage";

export function EduPiUsageSettingsCard() {
  const [status, setStatus] = useState<TeacherUsageStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [acknowledgement, setAcknowledgement] = useState({ policyRef: "", checked: false, viewed: [] as string[] });
  const [document, setDocument] = useState<"privacy_policy" | "user_agreement" | null>(null);
  const [eraseConfirm, setEraseConfirm] = useState(false);
  const refresh = useCallback(async () => {
    const next = await readTeacherUsageStatus();
    setStatus(previous => previous?.documents.configured && previous.documents.policy_ref === next.documents.policy_ref
      ? { ...next, documents: { ...next.documents, privacy_policy: { ...next.documents.privacy_policy!, text: previous.documents.privacy_policy?.text }, user_agreement: { ...next.documents.user_agreement!, text: previous.documents.user_agreement?.text } } }
      : next);
  }, []);
  useEffect(() => { let active = true; void readTeacherUsageStatus().then(value => { if (active) setStatus(value); }).catch(cause => { if (active) setError(teacherUsageErrorLabel(cause)); }); return () => { active = false; }; }, []);
  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await action(); await refresh(); window.dispatchEvent(new Event("edupi-teacher-usage-updated")); }
    catch (cause) { setError(teacherUsageErrorLabel(cause)); await refresh().catch(() => undefined); }
    finally { setBusy(false); }
  }
  async function view(kind: "privacy_policy" | "user_agreement") {
    await run(async () => {
      const next = await readTeacherUsageStatus({}, true);
      if (!next.documents.configured || !next.documents[kind]?.text) throw new Error("documents");
      setAcknowledgement(current => current.policyRef === next.documents.policy_ref
        ? { ...current, viewed: [...new Set([...current.viewed, kind])] }
        : { policyRef: next.documents.policy_ref!, checked: false, viewed: [kind] });
      setStatus(next); setDocument(kind);
    });
  }
  const consent = status?.usage.consent;
  const policyRef = status?.documents.policy_ref;
  const viewed = acknowledgement.policyRef === policyRef ? acknowledgement.viewed : [];
  const checked = acknowledgement.policyRef === policyRef && acknowledgement.checked;
  const pendingControl = (status?.outbox.pending_control ?? 0) > 0;
  const title = document === "privacy_policy" ? "隐私政策" : "用户协议";
  return <section className="native-settings-card" aria-label="本地用量" style={{ padding: "13px 14px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)" }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}><strong style={{ fontSize: 12 }}>本地用量</strong><span style={{ color: "var(--text-muted)", fontSize: 11 }}>{status?.collecting ? "已开启" : "未收集"}</span></div>
    {status ? <>
      <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "8px 0" }}>{status.usage.summary.total_events} 条本地记录 · {status.outbox.pending} 条待确认 · {status.outbox.quarantined} 条已隔离</p>
      {status.documents.configured ? <div style={{ display: "flex", gap: 8, margin: "8px 0" }}><button type="button" className="native-button" disabled={busy} onClick={() => void view("privacy_policy")}>隐私政策</button><button type="button" className="native-button" disabled={busy} onClick={() => void view("user_agreement")}>用户协议</button></div> : null}
      {pendingControl ? <button type="button" className="native-button native-button-primary" disabled={busy} onClick={() => void run(() => retryTeacherUsageOutbox())}>重试待确认操作</button> : !status.documents.configured ? <p style={{ fontSize: 11, color: "var(--text-muted)" }}>{status.documents.error_code ? "当前文档校验失败，收集已停止。" : "尚未配置当前隐私政策和用户协议。"}</p> : !status.collecting ? <>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, margin: "10px 0" }}><input type="checkbox" checked={checked} disabled={busy || viewed.length < 2} onChange={event => { const selected = event.currentTarget.checked; setAcknowledgement(current => ({ ...current, checked: selected })); }} />我已阅读并同意当前文档，开启本地用量记录</label>
        <button type="button" className="native-button native-button-primary" disabled={busy || !checked || viewed.length < 2 || !policyRef} onClick={() => void run(async () => { await setTeacherUsageConsent({ commandId: `usage-consent-${crypto.randomUUID()}`, decision: "accept", at: new Date().toISOString(), policyRef: policyRef!, checked: true, viewed: true }); setAcknowledgement(current => ({ ...current, checked: false })); })}>开启</button>
      </> : <button type="button" className="native-button" disabled={busy} onClick={() => void run(() => setTeacherUsageConsent({ commandId: `usage-revoke-${crypto.randomUUID()}`, decision: "revoke", at: new Date().toISOString() }))}>撤销同意</button>}
      <details style={{ marginTop: 10, fontSize: 11 }}><summary>本地记录</summary>
        <p style={{ color: "var(--text-muted)" }}>仅记录操作类型，不含对话或教学正文；尚未上传。</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="native-button" disabled={busy} onClick={() => void run(() => retryTeacherUsageOutbox())}>重试待确认记录</button>
          <button type="button" className="native-button" disabled={busy} onClick={() => void run(async () => {
            const current = await readTeacherUsageStatus();
            const batches: Record<string, unknown>[] = [];
            if (current.collecting) {
              let after = current.usage.consent.start_after;
              for (let page = 0; page < 50; page++) {
                const batch = await readTeacherUsageBatch({ throughRevision: current.usage.revision, after, limit: 100 });
                batches.push(batch);
                if (batch.next_after === null) break;
                if (typeof batch.next_after !== "number" || batch.next_after <= after) throw new Error("cursor");
                after = batch.next_after;
                if (page === 49) throw new Error("capacity");
              }
            }
            const bytes = JSON.stringify({ version: 1, summary: current.usage.summary, consent: current.usage.consent, batches, external_send: false }, null, 2);
            const url = URL.createObjectURL(new Blob([bytes], { type: "application/json" }));
            try { await downloadUrlAsFile(url, "edupi-local-usage.json"); }
            finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
          })}>导出本地报告</button>
          {consent?.status === "accepted" && !status.collecting ? <button type="button" className="native-button" disabled={busy || pendingControl} onClick={() => void run(() => setTeacherUsageConsent({ commandId: `usage-revoke-${crypto.randomUUID()}`, decision: "revoke", at: new Date().toISOString() }))}>撤销同意</button> : null}
          <button type="button" className="native-button" disabled={busy || pendingControl} onClick={() => setEraseConfirm(true)}>擦除用量记录</button>
        </div>
        {eraseConfirm ? <div style={{ marginTop: 8 }}><p>擦除此资料库的全部用量记录并撤销同意。</p><button type="button" className="native-button" disabled={busy || pendingControl} onClick={() => void run(async () => { await eraseTeacherUsage({ commandId: `usage-erase-${crypto.randomUUID()}`, requestedAt: new Date().toISOString() }); setEraseConfirm(false); setAcknowledgement(current => ({ ...current, checked: false })); })}>确认擦除</button><button type="button" className="native-button" disabled={busy} onClick={() => setEraseConfirm(false)}>取消</button></div> : null}
        <p style={{ color: "var(--text-muted)" }}>同意状态：{consent?.status === "accepted" ? "已同意" : consent?.status === "revoked" ? "已撤销" : "未同意"}</p>
      </details>
    </> : <button type="button" className="native-button" disabled={busy} onClick={() => void run(refresh)}>重新读取</button>}
    {document && status?.documents[document]?.text ? <dialog ref={node => { if (node && !node.open) node.showModal(); }} onCancel={() => setDocument(null)} aria-label={title} style={{ position: "fixed", width: "min(700px, 85vw)", height: "min(600px, 80vh)", color: "var(--text)", background: "var(--bg-panel)", border: "1px solid var(--border)", padding: 20, borderRadius: 10, display: "flex", flexDirection: "column", gap: 12 }}><strong>{title}</strong><div style={{ fontSize: 11, color: "var(--text-muted)", overflowWrap: "anywhere" }}>版本 {status.documents[document]!.version}<br />{status.documents[document]!.sha256}</div><pre style={{ whiteSpace: "pre-wrap", overflow: "auto", flex: 1, fontFamily: "inherit", fontSize: 12 }}>{status.documents[document]!.text}</pre><button type="button" className="native-button" onClick={() => setDocument(null)}>关闭</button></dialog> : null}
    {error ? <p role="alert" style={{ fontSize: 11, marginTop: 8 }}>{error}</p> : null}
  </section>;
}
