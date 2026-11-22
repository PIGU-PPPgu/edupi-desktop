"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchDesktopApi } from "@/lib/desktop-native";
import { announceEduPiCloudStatus, EDUPI_CLOUD_STATUS_CHANGED, type EduPiCloudStatus } from "@/lib/edupi-cloud-events";

type CloudStatus = EduPiCloudStatus & {
  workspaces: NonNullable<EduPiCloudStatus["workspaces"]>;
};

async function requestStatus(body: Record<string, unknown> | null, signal: AbortSignal): Promise<EduPiCloudStatus> {
  const response = await fetchDesktopApi("/api/edupi/cloud", {
    cache: "no-store",
    signal,
    ...(body ? {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : "云端操作未成功，请重试。");
  return result as EduPiCloudStatus;
}

export function EduPiCloudSettingsCard() {
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const received = useRef(0);

  const action = useCallback(async (body: Record<string, unknown> | null = null) => {
    if (request.current) return;
    const controller = new AbortController();
    const captured = received.current;
    request.current = controller;
    const current = () => request.current === controller && (body !== null || received.current === captured);
    const deadline = setTimeout(() => controller.abort(), 45_000);
    setBusy(true);
    setError(null);
    try {
      const result = await requestStatus(body, controller.signal);
      if (!current() || controller.signal.aborted) return;
      if (body?.action === "login") setPassword("");
      announceEduPiCloudStatus(result);
      if (["set_mode", "select_workspace", "logout", "login"].includes(String(body?.action))
        || body?.action === "sync" && (result.flushed ?? 0) > 0) {
        window.dispatchEvent(new Event("edupi-education-refresh"));
      }
    } catch (cause) {
      if (!current()) return;
      setError(controller.signal.aborted ? "云端请求超时，请重试。"
        : cause instanceof TypeError ? "无法读取同步状态，请重试。"
          : cause instanceof Error ? cause.message : "云端操作未成功，请重试。");
    } finally {
      clearTimeout(deadline);
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }, []);

  useEffect(() => {
    const changed = (event: Event) => {
      const next = (event as CustomEvent<EduPiCloudStatus>).detail;
      received.current++;
      setStatus(previous => ({
        ...next,
        workspaces: next.workspaces ?? (previous?.session.user?.id === next.session.user?.id ? previous?.workspaces ?? [] : []),
      }));
    };
    window.addEventListener(EDUPI_CLOUD_STATUS_CHANGED, changed);
    void action();
    return () => {
      window.removeEventListener(EDUPI_CLOUD_STATUS_CHANGED, changed);
      const active = request.current;
      request.current = null;
      active?.abort();
    };
  }, [action]);

  const signedIn = status?.session.state === "signed_in";
  const sessionLabel = !status ? busy ? "读取中" : "未读取"
    : status.session.state === "expired" ? "登录已过期" : signedIn ? "已登录" : "未登录";
  const message = error || status?.error?.message;
  return (
    <div className="native-settings-card" style={{ padding: "13px 14px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
        <strong>云端同步</strong>
        <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{sessionLabel}</span>
      </div>
      <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="native-button" aria-pressed={status?.mode === "local"} disabled={busy} onClick={() => void action({ action: "set_mode", mode: "local" })}>本地模式</button>
          <button type="button" className="native-button" aria-pressed={status?.mode === "cloud"} disabled={busy || !status?.configured || !signedIn || !status?.workspaceId} onClick={() => void action({ action: "set_mode", mode: "cloud" })}>云端模式</button>
        </div>
        {status && (status.mode === "cloud" || Object.values(status.sync).some(count => count > 0)) ? (
          <div role="status" style={{ color: "var(--text-muted)", fontSize: 11 }}>
            {[
              status.sync.pending > 0 ? `待同步 ${status.sync.pending}` : "",
              status.sync.conflict > 0 ? `冲突 ${status.sync.conflict}` : "",
              status.sync.failed > 0 ? `失败 ${status.sync.failed}` : "",
            ].filter(Boolean).join(" · ") || "无待同步记录"}
          </div>
        ) : null}
        {!signedIn && status?.configured ? (
          <form onSubmit={(event) => { event.preventDefault(); void action({ action: "login", email, password }); }} style={{ display: "grid", gap: 7 }}>
            <input aria-label="云端邮箱" type="email" autoComplete="username" placeholder="邮箱" value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} />
            <input aria-label="云端密码" type="password" autoComplete="current-password" placeholder="密码" value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} />
            <button type="submit" className="native-button native-button-primary" disabled={busy || !email || !password}>登录</button>
          </form>
        ) : null}
        {signedIn && status ? (
          <div style={{ display: "grid", gap: 7 }}>
            <div style={{ color: "var(--text-muted)", fontSize: 11 }}>{status.session.user?.email}</div>
            <select aria-label="当前工作区" value={status.workspaceId || ""} disabled={busy} onChange={(event) => void action({ action: "select_workspace", workspace_id: event.target.value })}>
              <option value="" disabled>选择工作区</option>
              {status.workspaceId && !status.workspaces.some(workspace => workspace.id === status.workspaceId)
                ? <option value={status.workspaceId}>{status.workspaceId}</option> : null}
              {status.workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.id} · {workspace.mode}</option>)}
            </select>
          </div>
        ) : null}
        {status?.session.user ? <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="native-button" disabled={busy} onClick={() => void action({ action: "refresh" })}>刷新登录</button>
          <button type="button" className="native-button" disabled={busy} onClick={() => void action({ action: "logout" })}>退出云端</button>
        </div> : null}
        {status && !status.configured ? <div style={{ color: "var(--text-muted)", fontSize: 11 }}>云端同步尚未配置。</div> : null}
        {message ? <div className="native-inline-alert is-error" role="alert">
          {message}
          <button type="button" className="native-button" disabled={busy} onClick={() => void action()}>刷新状态</button>
        </div> : null}
      </div>
    </div>
  );
}
