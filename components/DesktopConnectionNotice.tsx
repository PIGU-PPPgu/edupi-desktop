"use client";

import { useI18n } from "@/hooks/useI18n";
import { useModalDismiss } from "@/hooks/useModalDismiss";
import type { DesktopConnectionState } from "@/lib/desktop-connection";
import type { DesktopConnectionProbeRecord, DesktopProbeOutcome } from "@/lib/desktop-connection-probe";

const outcomeLabels: Record<DesktopProbeOutcome, string> = {
  ok: "正常", http: "HTTP 响应", missing_header: "缺少身份头",
  identity_mismatch: "身份不匹配", timeout: "超时", network: "网络错误",
};
const instanceLabels: Record<DesktopConnectionProbeRecord["instance"], string> = {
  unavailable: "未知", pinned: "首次确认", same: "相同", changed: "已变化",
};
const visibilityLabel = (value: DocumentVisibilityState) => value === "visible" ? "前台" : "后台";
const timeLabel = (value: number) => new Date(value).toLocaleTimeString("zh-CN", { hour12: false, fractionalSecondDigits: 3 });
const cellStyle = { padding: "8px 10px", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" } as const;

function ProbeTable({ records, label }: { records: readonly DesktopConnectionProbeRecord[]; label: string }) {
  return <table aria-label={label} style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
    <thead><tr>{["序号", "时间", "耗时", "前后台", "结果", "实例"].map(label => <th key={label} scope="col" style={cellStyle}>{label}</th>)}</tr></thead>
    <tbody>{records.map(record => <tr key={record.sequence}>
      <th scope="row" style={cellStyle}>{record.sequence}</th>
      <td style={cellStyle}><time dateTime={new Date(record.startedAt).toISOString()}>{timeLabel(record.startedAt)}</time></td>
      <td style={cellStyle}>{record.durationMs} ms</td>
      <td style={cellStyle}>{visibilityLabel(record.visibility)}{record.visibility !== record.settledVisibility ? ` → ${visibilityLabel(record.settledVisibility)}` : ""}</td>
      <td style={cellStyle}>{outcomeLabels[record.outcome]}{record.httpStatus !== null ? ` ${record.httpStatus}` : ""}</td>
      <td style={cellStyle}>{instanceLabels[record.instance]}</td>
    </tr>)}</tbody>
  </table>;
}

function ConnectionDetails({ records, incident, onClose }: { records: readonly DesktopConnectionProbeRecord[]; incident: readonly DesktopConnectionProbeRecord[]; onClose: () => void }) {
  const panelRef = useModalDismiss<HTMLDivElement>(onClose);
  const first = records[0] ?? incident[0];
  return (
    <div role="presentation" style={{ position: "fixed", inset: 0, zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "rgba(0,0,0,0.4)" }}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="desktop-connection-title" style={{ width: 720, maxWidth: "100%", maxHeight: "80vh", display: "flex", flexDirection: "column", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-panel)", color: "var(--text)", boxShadow: "0 12px 36px rgba(0,0,0,0.24)", overflow: "hidden" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
          <h2 id="desktop-connection-title" style={{ margin: 0, fontSize: 15 }}>连接详情</h2>
          <button type="button" className="native-button" data-autofocus onClick={onClose}>关闭</button>
        </header>
        <div style={{ overflow: "auto", padding: 12, fontSize: 12 }}>
          {first ? <>
            <dl style={{ display: "flex", gap: 12, margin: "0 0 12px", color: "var(--text-muted)" }}>
              <dt>文档启动</dt><dd style={{ margin: 0 }}><time dateTime={new Date(first.documentStartedAt).toISOString()}>{new Date(first.documentStartedAt).toLocaleString("zh-CN", { hour12: false })}</time></dd>
            </dl>
            {incident.length > 0 && <section><h3 style={{ margin: "0 0 6px", fontSize: 12 }}>最近断连</h3><ProbeTable records={incident} label="最近断连探测" /></section>}
            {records.length > 0 && <section>{incident.length > 0 && <h3 style={{ margin: "12px 0 6px", fontSize: 12 }}>最近探测</h3>}<ProbeTable records={records} label="最近连接探测" /></section>}
          </> : <div>暂无记录</div>}
        </div>
      </div>
    </div>
  );
}

export function DesktopConnectionNotice({ state, retry, diagnostics, failureIncident, detailsOpen, onOpenDetails, onCloseDetails }: {
  state: DesktopConnectionState;
  retry: () => void;
  diagnostics: readonly DesktopConnectionProbeRecord[];
  failureIncident: readonly DesktopConnectionProbeRecord[];
  detailsOpen: boolean;
  onOpenDetails: () => void;
  onCloseDetails: () => void;
}) {
  const { t } = useI18n();
  return <>
    {state === "offline" && <div role="alert" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, flexShrink: 0, padding: "7px 12px", background: "color-mix(in srgb, var(--danger) 14%, var(--bg-panel))", borderBottom: "1px solid color-mix(in srgb, var(--danger) 35%, var(--border))", color: "var(--text)", fontSize: 12, zIndex: 300 }}>
      <span>{t("connection.offline")}</span>
      <button type="button" onClick={retry} style={{ height: 24, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg)", color: "var(--accent)", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>{t("connection.retry")}</button>
      <button type="button" onClick={onOpenDetails} style={{ padding: 0, border: 0, background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}>连接详情</button>
    </div>}
    {detailsOpen && <ConnectionDetails records={diagnostics} incident={failureIncident} onClose={onCloseDetails} />}
  </>;
}
