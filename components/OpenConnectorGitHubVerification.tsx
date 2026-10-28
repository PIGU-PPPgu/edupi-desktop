"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchDesktopApi } from "@/lib/desktop-native";
import {
  isGitHubVerificationStatus,
  type GitHubVerificationOperation,
  type GitHubVerificationStatus,
} from "@/lib/openconnector-verification-contract";

const API = "/api/desktop/openconnector/verification";
const MESSAGES: Record<string, string> = {
  github_login_required: "本机 GitHub 登录不可用，请先在终端登录 GitHub CLI。",
  github_authorization_failed: "GitHub 登录已失效，请重新登录。",
  github_connection_changed: "本机 GitHub 登录已变更，请重新连接。",
  github_account_changed: "本机 GitHub 账号已变更，请重新连接。",
  github_verification_busy: "连接正在处理，请稍后读取状态。",
  github_verification_timeout: "读取超时，请核对执行记录。",
  github_verification_unavailable: "GitHub 连接暂不可用。",
  github_connection_unavailable: "无法连接 GitHub，请检查网络后重试。",
  github_proxy_unsupported: "GitHub 连接仅支持本机 HTTP 代理，请检查代理设置。",
  github_audit_unavailable: "执行审计尚未核对，请先读取状态。",
};

export function canStartGitHubRead(status: GitHubVerificationStatus | null): boolean {
  return Boolean(status?.supported && status.connection
    && !(status.receipt?.connectionId === status.connection.id && status.receipt.status === "pending"));
}

async function requestStatus(operation?: GitHubVerificationOperation, signal?: AbortSignal): Promise<GitHubVerificationStatus> {
  const response = await fetchDesktopApi(API, {
    method: operation ? "POST" : "GET",
    ...(operation ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(operation) } : {}),
    signal,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.ok !== true || !isGitHubVerificationStatus(body.data)) {
    throw new Error(MESSAGES[body?.code] || "GitHub 连接暂不可用，请重新读取状态。");
  }
  return body.data;
}

export function OpenConnectorGitHubVerification() {
  const [status, setStatus] = useState<GitHubVerificationStatus | null>(null);
  const [busy, setBusy] = useState<string | null>("status");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const confirmationRef = useRef<HTMLHeadingElement>(null);

  const refresh = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy("status");
    setError("");
    try {
      const next = await requestStatus(undefined, controller.signal);
      if (!controller.signal.aborted) setStatus(next);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "无法读取连接状态。");
    } finally {
      if (controllerRef.current === controller) setBusy(null);
    }
  }, []);

  useEffect(() => { void refresh(); return () => controllerRef.current?.abort(); }, [refresh]);
  useEffect(() => { if (confirming) confirmationRef.current?.focus(); }, [confirming]);

  async function operate(operation: GitHubVerificationOperation) {
    if (busy) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(operation.op);
    setError("");
    setConfirming(false);
    try {
      const next = await requestStatus(operation, AbortSignal.any([controller.signal, AbortSignal.timeout(45_000)]));
      if (!controller.signal.aborted) setStatus(next);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "连接操作未完成。");
        // Reconcile the saved receipt; an interrupted request never re-dispatches.
        if (operation.op === "verify") {
          const next = await requestStatus(undefined, controller.signal).catch(() => null);
          if (next && !controller.signal.aborted) setStatus(next);
        }
      }
    } finally {
      if (controllerRef.current === controller) setBusy(null);
    }
  }

  const connection = status?.connection;
  const receipt = status?.receipt?.connectionId === connection?.id ? status?.receipt : null;
  const unresolved = receipt?.status === "pending" || receipt?.status === "unknown";

  return <section className="openconnector-verification" aria-label="GitHub 账号验证">
    <header><h3>GitHub 账号</h3><span>{busy === "connect" ? "正在连接" : busy === "verify" ? "正在读取" : connection ? connection.login : busy === "status" ? "正在读取" : "未连接"}</span></header>
    {error ? <div className="native-inline-alert is-error" role="alert">{error}</div> : null}
    {status && !status.supported ? <p>当前应用暂不支持账号验证。</p> : null}
    {status?.supported && !connection ? <>
      <p>使用本机 GitHub CLI 已登录的账号。</p>
      <button type="button" className="is-primary" disabled={busy !== null} onClick={() => void operate({ op: "connect" })}>连接 GitHub</button>
    </> : null}
    {connection && status?.supported ? <>
      {confirming ? <div className="openconnector-verification__confirm">
        <h4 ref={confirmationRef} tabIndex={-1}>读取当前账号</h4>
        <dl><div><dt>账号</dt><dd>{connection.login}</dd></div><div><dt>内容</dt><dd>公开账号资料与公开仓库数量</dd></div></dl>
        <details><summary>调用参数</summary><code>github.get_current_user</code><pre>{"{}"}</pre></details>
        <div className="openconnector-verification__buttons"><button type="button" className="is-primary" onClick={() => void operate({ op: "verify", connectionId: connection.id, requestId: crypto.randomUUID() })}>确认读取</button><button type="button" onClick={() => setConfirming(false)}>取消</button></div>
      </div> : <div className="openconnector-verification__buttons">
        <button type="button" className="is-primary" disabled={busy !== null || !canStartGitHubRead(status)} onClick={() => setConfirming(true)}>读取当前账号</button>
        <button type="button" disabled={busy !== null} onClick={() => void operate({ op: "disconnect", connectionId: connection.id })}>解除连接</button>
      </div>}
      {receipt ? <div className="openconnector-verification__receipt" aria-live="polite">
        <strong>{receipt.status === "succeeded" ? "读取成功" : receipt.status === "failed" ? "读取失败" : receipt.status === "unknown" ? "结果待核对" : "等待结果"}</strong>
        {receipt.profile ? <dl><div><dt>账号</dt><dd>{receipt.profile.login}</dd></div><div><dt>账号 ID</dt><dd>{receipt.profile.id}</dd></div><div><dt>公开仓库</dt><dd>{receipt.profile.publicRepos}</dd></div></dl> : null}
        {receipt.status === "failed" ? <p>本次读取未完成，可重新调用。</p> : receipt.status === "unknown" ? <p>本次结果未确认，重新读取会发起新请求。</p> : receipt.status === "pending" ? <p>请先读取执行状态，调用不会自动重发。</p> : null}
        <details><summary>执行记录</summary><dl><div><dt>操作</dt><dd>{receipt.actionId}</dd></div><div><dt>执行 ID</dt><dd>{receipt.executionId || "尚未取得"}</dd></div><div><dt>审计</dt><dd>{receipt.auditPersisted ? "已保存并核对" : "尚未核对"}</dd></div><div><dt>时间</dt><dd>{new Date(receipt.startedAt).toLocaleString("zh-CN")}</dd></div></dl></details>
      </div> : null}
    </> : null}
    {(error || unresolved) && !confirming ? <button type="button" disabled={busy !== null} onClick={() => void refresh()}>重新读取状态</button> : null}
  </section>;
}
