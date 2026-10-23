"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { fetchDesktopApi, handleExternalLinkClick, openExternal } from "@/lib/desktop-native";
import {
  isGitHubOAuthStatus,
  type GitHubOAuthOperation,
  type GitHubOAuthStatus,
} from "@/lib/openconnector-github-contract";

const API = "/api/desktop/openconnector/github";
const MESSAGES: Record<string, string> = {
  github_oauth_not_configured: "请先保存 GitHub OAuth 客户端。",
  github_client_required: "请先保存 GitHub OAuth 客户端。",
  github_oauth_not_connected: "请先完成 GitHub 授权。",
  github_oauth_busy: "连接正在处理，请稍后读取状态。",
  github_oauth_expired: "本次授权已过期，请重新授权。",
  github_oauth_denied: "GitHub 授权未完成。",
  github_connection_changed: "GitHub 账号已变化，请重新确认测试内容。",
  github_oauth_connection_required: "请先完成 GitHub OAuth 授权。",
  github_oauth_configuration_failed: "客户端配置无法保存，请检查 Client ID 与 Client Secret。",
  github_oauth_start_failed: "无法开始 GitHub 授权，请检查客户端配置和网络。",
  github_repository_not_allowed: "目标仓库不可写，请核对账号权限和 Issues 设置。",
  github_write_already_started: "本次创建已有执行记录，请读取结果。",
  github_keychain_unavailable: "无法读取系统钥匙串，请检查钥匙串是否已解锁。",
  github_proxy_unsupported: "当前连接仅支持本机 HTTP 代理，请检查代理设置。",
  github_test_issue_exists: "本次测试已有执行记录，请读取结果。",
  invalid_github_request: "配置或请求无效，请检查后重试。",
};

export function canPrepareGitHubTestIssue(status: GitHubOAuthStatus | null): boolean {
  return Boolean(status?.supported && status.clientConfigured && status.connection?.authType === "oauth2"
    && status.connection.scopes.length === 1 && status.connection.scopes[0] === "public_repo"
    && !status.receipt && status.authorization?.status !== "pending");
}

async function requestStatus(operation?: GitHubOAuthOperation, signal?: AbortSignal): Promise<GitHubOAuthStatus> {
  const response = await fetchDesktopApi(API, {
    method: operation ? "POST" : "GET",
    ...(operation ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(operation) } : {}),
    signal,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.ok !== true || !isGitHubOAuthStatus(body.data)) {
    throw new Error(MESSAGES[body?.code] || "GitHub 操作未完成，请重新读取状态。");
  }
  return body.data;
}

export function OpenConnectorGitHubPanel() {
  const [status, setStatus] = useState<GitHubOAuthStatus | null>(null);
  const [busy, setBusy] = useState<string | null>("status");
  const [error, setError] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [preview, setPreview] = useState(false);
  const activeRef = useRef(false);
  const requestVersionRef = useRef(0);
  const mountedRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const previewRef = useRef<HTMLHeadingElement>(null);

  const run = useCallback(async (operation?: GitHubOAuthOperation) => {
    if (!mountedRef.current || activeRef.current) return null;
    const version = ++requestVersionRef.current;
    activeRef.current = true;
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(operation?.op || "status");
    setError("");
    try {
      const next = await requestStatus(operation, AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]));
      if (mountedRef.current && requestVersionRef.current === version && !controller.signal.aborted) setStatus(next);
      return next;
    } catch (cause) {
      if (mountedRef.current && requestVersionRef.current === version && !controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "GitHub 操作未完成。");
        if (operation?.op === "createTestIssue") {
          // Recover the saved receipt; never retry a write after a lost response.
          const next = await requestStatus(undefined, controller.signal).catch(() => null);
          if (next && mountedRef.current && requestVersionRef.current === version && !controller.signal.aborted) setStatus(next);
        }
      }
      return null;
    } finally {
      if (requestVersionRef.current === version) {
        activeRef.current = false;
        if (mountedRef.current) setBusy(null);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void run();
    return () => {
      mountedRef.current = false;
      requestVersionRef.current += 1;
      activeRef.current = false;
      controllerRef.current?.abort();
    };
  }, [run]);
  useEffect(() => { if (status?.clientId) setClientId(status.clientId); }, [status?.clientId]);
  useEffect(() => { if (preview) previewRef.current?.focus(); }, [preview]);
  useEffect(() => {
    if (busy || status?.authorization?.status !== "pending") return;
    const requestId = status.authorization.requestId;
    const timer = setTimeout(() => { void run({ op: "pollOAuth", requestId }); }, 3_000);
    return () => clearTimeout(timer);
  }, [busy, status?.authorization, run]);

  async function saveClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = await run({ op: "configureOAuth", clientId: clientId.trim(), clientSecret });
    if (next?.clientConfigured) setClientSecret("");
  }

  async function authorize() {
    const next = await run({ op: "startOAuth" });
    if (next?.authorization?.status !== "pending") return;
    try { await openExternal(next.authorization.authorizationUrl); }
    catch { setError("浏览器未能打开，请点击打开授权页。"); }
  }

  async function prepare() {
    if (status?.draft) { setPreview(true); return; }
    const next = await run({ op: "prepareTestIssue" });
    if (next?.draft) setPreview(true);
  }

  async function createIssue() {
    if (!status?.draft) return;
    const draftId = status.draft.id;
    setPreview(false);
    await run({ op: "createTestIssue", draftId });
  }

  const connection = status?.connection;
  const authorization = status?.authorization;
  const receipt = status?.receipt;
  const clientForm = <form className="openconnector-github__client" onSubmit={(event) => void saveClient(event)}>
    <label>Client ID<input type="text" value={clientId} maxLength={200} autoComplete="off" disabled={busy !== null} onChange={(event) => setClientId(event.target.value)} /></label>
    <label>Client Secret<input type="password" value={clientSecret} maxLength={256} autoComplete="new-password" disabled={busy !== null} onChange={(event) => setClientSecret(event.target.value)} /></label>
    <div className="openconnector-github__callback"><span>回调地址</span><code>{status?.callbackUrl || "http://127.0.0.1/oauth/callback"}</code></div>
    <button type="submit" className="is-primary" disabled={busy !== null || !clientId.trim() || !clientSecret}>{busy === "configureOAuth" ? "正在保存…" : "保存客户端"}</button>
  </form>;

  return <section className="openconnector-verification openconnector-github" aria-label="GitHub OAuth 与测试 Issue">
    <header><h3>GitHub</h3><span>{busy === "createTestIssue" ? "正在创建" : connection ? `${connection.login} · OAuth 已授权` : authorization?.status === "pending" ? "等待 GitHub 授权" : "OAuth 未授权"}</span></header>
    {error ? <div className="native-inline-alert is-error" role="alert">{error}</div> : null}
    {!status ? <p role="status">{busy ? "正在读取连接" : "连接暂不可用"}</p> : !status.supported ? <p>当前应用暂不支持 GitHub OAuth。</p> : <>
      {!status.clientConfigured ? <div className="openconnector-github__setup"><h4>OAuth 客户端</h4><p><a href="https://github.com/settings/applications/new" onClick={(event) => handleExternalLinkClick(event, "https://github.com/settings/applications/new")}>在 GitHub 创建客户端</a></p>{clientForm}</div> : <>
        {!connection && authorization?.status !== "pending" ? <div className="openconnector-verification__buttons"><button type="button" className="is-primary" disabled={busy !== null} onClick={() => void authorize()}>授权 GitHub</button></div> : null}
        {authorization?.status === "pending" ? <>
          <p>请在 GitHub 确认公开仓库授权。</p>
          <div className="openconnector-verification__buttons"><button type="button" disabled={busy !== null} onClick={() => void openExternal(authorization.authorizationUrl).catch(() => setError("浏览器未能打开。"))}>打开授权页</button><button type="button" disabled={busy !== null} onClick={() => void run({ op: "pollOAuth", requestId: authorization.requestId })}>读取授权结果</button><button type="button" disabled={busy !== null} onClick={() => void run({ op: "cancelOAuth", requestId: authorization.requestId })}>取消授权</button></div>
        </> : null}
        {authorization?.status === "failed" ? <p role="status">授权未完成，请检查客户端配置后重新授权。</p> : authorization?.status === "expired" ? <p role="status">本次授权已过期，请重新授权。</p> : null}
        {connection && authorization?.status !== "pending" && !receipt ? <>
          {preview && status.draft ? <div className="openconnector-verification__confirm">
            <h4 ref={previewRef} tabIndex={-1}>创建测试 Issue</h4>
            <dl><div><dt>账号</dt><dd>{status.draft.login}</dd></div><div><dt>仓库</dt><dd>{status.draft.input.owner}/{status.draft.input.repo}</dd></div><div><dt>标题</dt><dd>{status.draft.input.title}</dd></div></dl>
            <pre className="openconnector-github__body">{status.draft.input.body}</pre>
            <div className="openconnector-verification__buttons"><button type="button" className="is-primary" disabled={busy !== null} onClick={() => void createIssue()}>确认创建</button><button type="button" disabled={busy !== null} onClick={() => setPreview(false)}>取消</button></div>
          </div> : <div className="openconnector-verification__buttons"><button type="button" className="is-primary" disabled={busy !== null || !canPrepareGitHubTestIssue(status)} onClick={() => void prepare()}>创建测试 Issue</button></div>}
        </> : null}
        {receipt ? <div className="openconnector-verification__receipt" aria-live="polite">
          <strong>{receipt.status === "succeeded" && receipt.readbackVerified ? "已创建并回读" : receipt.status === "pending" ? "创建中" : receipt.status === "unknown" ? "结果待核对" : "创建未完成"}</strong>
          {receipt.issue ? <>
            <dl><div><dt>Issue</dt><dd><a href={receipt.issue.url} onClick={(event) => handleExternalLinkClick(event, receipt.issue?.url)}>#{receipt.issue.number}</a></dd></div><div><dt>标题</dt><dd>{receipt.issue.title}</dd></div><div><dt>状态</dt><dd>{receipt.issue.state === "open" ? "打开" : "已关闭"}</dd></div><div><dt>创建者</dt><dd>{receipt.issue.author}</dd></div></dl>
            <details><summary>正文</summary><pre className="openconnector-github__body">{receipt.issue.body}</pre></details>
          </> : <p>先读取执行结果，创建请求不会自动重发。</p>}
          <div className="openconnector-verification__buttons"><button type="button" disabled={busy !== null} onClick={() => void run({ op: "readIssue", receiptId: receipt.id })}>{busy === "readIssue" ? "正在读取…" : "重新读取结果"}</button></div>
          <details><summary>执行记录</summary><dl><div><dt>写入 ID</dt><dd>{receipt.writeExecutionId || "尚未取得"}</dd></div><div><dt>回读 ID</dt><dd>{receipt.readExecutionId || "尚未取得"}</dd></div><div><dt>审计</dt><dd>{receipt.auditPersisted ? "已保存并核对" : "尚未核对"}</dd></div></dl></details>
        </div> : null}
        <details className="openconnector-github__settings"><summary>OAuth 客户端</summary>{clientForm}{connection ? <button type="button" disabled={busy !== null} onClick={() => void authorize()}>重新授权</button> : null}</details>
      </>}
    </>}
    {error ? <div className="openconnector-verification__buttons"><button type="button" disabled={busy !== null} onClick={() => void run()}>重新读取状态</button></div> : null}
  </section>;
}
