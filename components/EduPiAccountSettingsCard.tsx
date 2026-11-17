"use client";

import Image from "next/image";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { fetchDesktopApi } from "@/lib/desktop-native";
import { isTauriDesktop } from "@/lib/desktop-updater";
import type {
  AccountAction,
  AccountChallenge,
  AccountIdentity,
  AccountPurpose,
  AccountReply,
  AccountStatus,
  PublicEduPiAccount,
} from "@/lib/edupi-account-types";

type RequestAction = AccountAction | null;
type RequestError = { message: string; retry: RequestAction };
type BusyAction = AccountAction["action"] | "load" | null;

const identityRows: { kind: AccountIdentity["kind"]; name: string; purpose: AccountPurpose }[] = [
  { kind: "wechat_miniprogram", name: "微信", purpose: "bind_wechat" },
  { kind: "phone", name: "手机号", purpose: "bind_phone" },
  { kind: "email", name: "邮箱", purpose: "bind_email" },
];

function isWaiting(challenge: AccountChallenge | null | undefined): challenge is AccountChallenge {
  return !!challenge && ["creating", "pending", "scanned"].includes(challenge.status);
}

function isSessionExpired(status: AccountStatus, now: number): boolean {
  return status.state === "expired" || (status.state === "signed_in"
    && status.expiresAt !== null && Date.parse(status.expiresAt) <= now);
}

function useAccountSettings() {
  const [reply, setReply] = useState<AccountReply | null>(null);
  const [busy, setBusy] = useState<BusyAction>("load");
  const [error, setError] = useState<RequestError | null>(null);
  const [hiddenFlowId, setHiddenFlowId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(false);
  const version = useRef(0);
  const request = useRef<AbortController | null>(null);
  const requestDeadline = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestReply = useRef<AccountReply | null>(null);

  const stop = useCallback(() => {
    version.current++;
    request.current?.abort();
    request.current = null;
    if (requestDeadline.current !== null) clearTimeout(requestDeadline.current);
    requestDeadline.current = null;
    if (pollTimer.current !== null) clearTimeout(pollTimer.current);
    pollTimer.current = null;
  }, []);

  const run = useCallback(async (action: RequestAction) => {
    stop();
    if (!mounted.current) return;
    const requestVersion = version.current;
    const controller = new AbortController();
    request.current = controller;
    const isCurrent = () => mounted.current && version.current === requestVersion;
    setBusy(action?.action ?? "load");
    setError(null);
    if (action?.action === "cancel") setHiddenFlowId(action.flowId);
    if (action?.action === "start") {
      setHiddenFlowId(latestReply.current?.status.challenge?.flowId ?? null);
    }
    let timedOut = false;
    const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, 45_000);
    requestDeadline.current = deadline;
    try {
      const response = await (isTauriDesktop() ? fetchDesktopApi : fetch)("/api/edupi/account", {
        cache: "no-store",
        signal: controller.signal,
        ...(action ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(action),
        } : {}),
      });
      const result = await response.json() as AccountReply & { error?: string; code?: string };
      if (!response.ok) throw new Error(result.error || "账号请求失败，请重试。");
      if (!result.status) throw new Error("账号状态暂不可用，请重试。");
      if (!isCurrent()) return;
      latestReply.current = result;
      setReply(result);
      setNow(Date.now());
      if (action?.action !== "cancel") setHiddenFlowId(null);
    } catch (cause) {
      if (!isCurrent()) return;
      setError({
        message: timedOut ? "账号请求超时，请重试。"
          : cause instanceof TypeError ? "无法连接账号服务，请重试。"
            : cause instanceof SyntaxError ? "账号状态暂不可用，请重试。"
              : cause instanceof Error ? cause.message : "账号请求失败，请重试。",
        // A start may have reached the server before its response was lost.
        // Recover that flow with GET rather than create a second challenge.
        retry: action?.action === "start" ? null : action,
      });
    } finally {
      clearTimeout(deadline);
      if (requestDeadline.current === deadline) requestDeadline.current = null;
      if (isCurrent()) {
        request.current = null;
        setBusy(null);
      }
    }
  }, [stop]);

  useEffect(() => {
    mounted.current = true;
    void run(null);
    return () => { mounted.current = false; stop(); };
  }, [run, stop]);

  const status = reply?.status ?? null;
  const challenge = status?.configured && status.challenge?.flowId !== hiddenFlowId
    ? status.challenge : null;
  const challengeDeadline = challenge ? Date.parse(challenge.expiresAt) : NaN;
  const challengeExpired = !!challenge && (!Number.isFinite(challengeDeadline) || challengeDeadline <= now);
  const sessionExpired = status ? isSessionExpired(status, now) : false;
  const canPoll = isWaiting(challenge) && !challengeExpired
    && (!sessionExpired || challenge.purpose === "login");
  const sessionDeadline = status?.state === "signed_in" && status.expiresAt
    ? Date.parse(status.expiresAt) : NaN;
  const clockDeadline = Math.min(
    isWaiting(challenge) && challengeDeadline > now ? challengeDeadline : Infinity,
    sessionDeadline > now ? sessionDeadline : Infinity,
  );

  // This clock only updates presentation; it never initiates a network request.
  useEffect(() => {
    if (!Number.isFinite(clockDeadline)) return;
    const tick = () => setNow(Date.now());
    const interval = setInterval(tick, 1_000);
    const expiry = setTimeout(tick, Math.min(clockDeadline - Date.now(), 2_147_483_647));
    return () => { clearInterval(interval); clearTimeout(expiry); };
  }, [clockDeadline]);

  useEffect(() => {
    if (!canPoll && busy === "poll") {
      stop();
      setBusy(null);
    }
  }, [canPoll, busy, stop]);

  useEffect(() => {
    if (!canPoll || !challenge || busy || error) return;
    const flowId = challenge.flowId;
    const pollAfter = Date.parse(challenge.pollAfter);
    const nextPoll = Number.isFinite(pollAfter) ? pollAfter : Date.now() + 3_000;
    const schedule = () => {
      // Bound timer lengths without polling earlier than the server permits.
      pollTimer.current = setTimeout(() => {
        pollTimer.current = null;
        if (Date.now() >= challengeDeadline) { setNow(Date.now()); return; }
        if (nextPoll > Date.now()) { schedule(); return; }
        void run({ action: "poll", flowId });
      }, Math.min(60_000, Math.max(1_000, nextPoll - Date.now())));
    };
    schedule();
    return () => {
      if (pollTimer.current !== null) clearTimeout(pollTimer.current);
      pollTimer.current = null;
    };
  }, [canPoll, challenge, challengeDeadline, busy, error, run]);

  return { reply, status, challenge, challengeExpired, sessionExpired, now, busy, error, run };
}

function AccountIdentities({ account, disabled, onBind }: {
  account: PublicEduPiAccount;
  disabled: boolean;
  onBind: (purpose: AccountPurpose) => void;
}) {
  return (
    <dl className="edupi-account__identities">
      {identityRows.map(({ kind, name, purpose }) => {
        const identity = account.identities.find(item => item.kind === kind);
        const verified = !!identity?.verifiedAt;
        const label = identity?.label && identity.label !== account.displayName ? identity.label : null;
        return (
          <div className="edupi-account__identity" key={kind}>
            <dt>{name}</dt>
            <dd>
              <div className="edupi-account__identity-value">
                {label ? <span>{label}</span> : null}
                <span className="edupi-account__muted">{verified ? "已验证" : identity ? "待验证" : "未绑定"}</span>
              </div>
              <button type="button" className="native-button" disabled={disabled}
                aria-label={`${verified ? "更换" : "绑定"}${name}`}
                onClick={() => onBind(purpose)}>
                {verified ? "更换" : "绑定"}{name}
              </button>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function ChallengeView({ challenge, expired, now, busy, hasError, onCancel, onRestart }: {
  challenge: AccountChallenge;
  expired: boolean;
  now: number;
  busy: BusyAction;
  hasError: boolean;
  onCancel: () => void;
  onRestart: () => void;
}) {
  const terminal = expired || challenge.status === "expired" || challenge.status === "denied";
  const qrImage = !terminal
    && /^data:image\/png;base64,[A-Za-z0-9+/=\r\n]+$/.test(challenge.qrImage ?? "")
    ? challenge.qrImage : null;
  const remaining = Math.max(0, Math.ceil((Date.parse(challenge.expiresAt) - now) / 1_000));
  const label = challenge.status === "denied" ? "未获授权"
    : terminal ? "二维码已过期"
      : challenge.status === "creating" ? "正在创建二维码"
        : challenge.status === "scanned" ? "已扫码，等待手机确认" : "等待扫码";
  const purpose = challenge.purpose === "login" ? "登录"
    : challenge.purpose === "bind_phone" ? "绑定手机号"
      : challenge.purpose === "bind_email" ? "绑定邮箱" : "绑定微信";
  return (
    <div className="edupi-account__challenge" tabIndex={-1} data-account-focus
      aria-label={`${purpose}二维码`}>
      <p className="edupi-account__flow-status" role="status">{label}</p>
      {qrImage ? (
        <div className="edupi-account__qr">
          <Image src={qrImage} alt={`${purpose}二维码，用小程序扫描并确认`}
            width={224} height={224} unoptimized />
        </div>
      ) : !terminal && challenge.status !== "creating" ? (
        <p className="edupi-account__muted">二维码暂不可用。</p>
      ) : null}
      {!terminal && (qrImage || challenge.status !== "creating") ? (
        <div className="edupi-account__scan-details">
          <p className="edupi-account__muted">用小程序扫描并确认。</p>
          {challenge.userCode ? <p className="edupi-account__verification">
            <span>手机核对码</span><code>{challenge.userCode}</code>
          </p> : null}
          <p className="edupi-account__countdown" role="timer" aria-label="二维码剩余有效时间" aria-live="off">
            {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")} 后过期
          </p>
        </div>
      ) : null}
      <div className="edupi-account__actions">
        {terminal ? <button type="button" className="native-button native-button-primary"
          disabled={busy !== null} onClick={onRestart}>刷新二维码</button> : null}
        <button type="button" className="native-button"
          disabled={busy === "cancel"} onClick={onCancel}
          aria-label={`取消${purpose}`}>取消</button>
      </div>
      {hasError && !terminal ? <p className="edupi-account__muted">状态检查已暂停。</p> : null}
    </div>
  );
}

export function EduPiAccountSettingsCard() {
  const { reply, status, challenge, challengeExpired, sessionExpired, now, busy, error, run } = useAccountSettings();
  const titleId = useId();
  const card = useRef<HTMLElement | null>(null);
  const focusNext = useRef(false);
  const perform = (action: RequestAction) => {
    focusNext.current = true;
    void run(action);
  };
  useEffect(() => {
    if (busy || !focusNext.current) return;
    focusNext.current = false;
    const target = card.current?.querySelector<HTMLElement>(error
      ? ".edupi-account__error button" : "[data-account-focus]");
    (target ?? card.current)?.focus();
  }, [busy, reply, error]);

  const configured = status?.configured && status.state !== "unconfigured";
  const signedIn = configured && status.state === "signed_in" && !!status.account && !sessionExpired;
  const account = configured ? status.account : null;
  const bindingExpired = sessionExpired && challenge?.purpose !== "login";
  const visibleChallenge = bindingExpired ? null : challenge;
  const disabled = busy !== null;
  const retryExpiredPoll = error?.retry?.action === "poll" && (challengeExpired || bindingExpired);
  const statusLabel = !status ? busy ? "读取中" : "未读取"
    : !configured ? "未配置" : sessionExpired ? "登录已过期" : signedIn ? "已登录" : "未登录";

  return (
    <section ref={card} className="native-settings-card edupi-account" data-setting-id="account" tabIndex={-1}
      aria-labelledby={titleId} aria-busy={busy !== null && busy !== "poll"}>
      <div className="edupi-account__header">
        <h3 id={titleId}>账号</h3>
        <span className="edupi-account__muted">{statusLabel}</span>
      </div>
      {status && !configured ? (
        <div className="edupi-account__body">
          <p>账号服务尚未配置</p>
          <p className="edupi-account__muted">当前可继续使用本地功能。</p>
          <details className="edupi-account__help">
            <summary>服务帮助</summary>
            <p>由管理员配置账号服务后，可使用小程序扫码登录与绑定。</p>
          </details>
        </div>
      ) : null}
      {account ? (
        <div className="edupi-account__body">
          <strong className="edupi-account__name">{account.displayName || "EduPi 账号"}</strong>
          <details className="edupi-account__account-id">
            <summary>账号 ID</summary>
            <code>{account.id}</code>
          </details>
          <AccountIdentities account={account}
            disabled={disabled || !!challenge || !signedIn}
            onBind={purpose => perform({ action: "start", purpose })} />
        </div>
      ) : null}
      {busy === "start" ? <p className="edupi-account__flow-status" role="status">正在创建二维码</p>
        : visibleChallenge ? <ChallengeView challenge={visibleChallenge} expired={challengeExpired}
          now={now} busy={busy} hasError={!!error}
          onCancel={() => perform({ action: "cancel", flowId: visibleChallenge.flowId })}
          onRestart={() => perform({ action: "start", purpose: visibleChallenge.purpose })} />
          : configured && !signedIn && (!error || sessionExpired) ? (
            <div className="edupi-account__body">
              {sessionExpired ? <p className="edupi-account__muted">登录已过期，请刷新账号状态或重新扫码。</p> : null}
              <button type="button" className="native-button native-button-primary"
                data-account-focus disabled={disabled}
                onClick={() => perform({ action: "start", purpose: "login" })}>
                {sessionExpired ? "重新扫码登录" : "小程序扫码登录"}
              </button>
            </div>
          ) : null}
      {busy === "cancel" ? <p role="status">正在取消</p> : null}
      {error ? (
        <div className="edupi-account__error" role="alert">
          <p>{error.message}</p>
          {!retryExpiredPoll ? <button type="button" className="native-button" disabled={disabled}
            onClick={() => perform(error.retry)} aria-label="重试账号请求">重试</button> : null}
        </div>
      ) : null}
      {reply?.warning ? <p className="edupi-account__warning" role="status">{reply.warning}</p> : null}
      {configured && !visibleChallenge && busy !== "start" ? (
        <div className="edupi-account__footer">
          <button type="button" className="native-button" disabled={disabled}
            onClick={() => perform(status && configured ? { action: "refresh" } : null)}
            aria-label="刷新账号状态">
            {busy === "load" || busy === "refresh" ? "读取中" : "刷新账号状态"}
          </button>
          {account ? <button type="button" className="native-button" disabled={disabled}
            onClick={() => perform({ action: "logout" })}>退出此设备</button> : null}
        </div>
      ) : null}
      {account && !visibleChallenge ? <p className="edupi-account__muted edupi-account__local-note">退出此设备会保留本地资料。</p> : null}
    </section>
  );
}
