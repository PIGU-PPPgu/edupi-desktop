import { createHash, randomBytes, randomUUID } from "node:crypto";
import { ACCOUNT_CONTRACT, AccountError, accountFail, integer, opaque, parseAccount, pngDataUri, responseObject, text } from "./edupi-account-protocol";
import { accountTransaction, type PrivateAccountState, type PrivateChallenge, type PrivateSession } from "./edupi-account-store";
import type { AccountAction, AccountPurpose, AccountReply, AccountStatus } from "./edupi-account-types";

type Options = { env?: NodeJS.ProcessEnv; stateDir?: string; now?: () => number; fetchImpl?: typeof fetch };
type Config = { url: string; clientId: string };
const iso = (time: number) => new Date(time).toISOString();

function configuration(env: NodeJS.ProcessEnv): Config | null {
  const value = env.EDUPI_ACCOUNT_SERVICE_URL?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash
      || url.protocol !== "https:" && !(url.protocol === "http:" && loopback && env.EDUPI_ACCOUNT_ALLOW_LOOPBACK === "1" && env.NODE_ENV !== "production")) throw new Error();
    return { url: url.href.replace(/\/+$/u, ""), clientId: opaque(env.EDUPI_ACCOUNT_CLIENT_ID || "edupi-desktop", 1, 120) };
  } catch { return accountFail("configuration_invalid", "账号服务配置无效，请检查 HTTPS 地址。", 503); }
}

function publicStatus(state: PrivateAccountState, config: Config, now: number): AccountStatus {
  const session = state.session;
  const challenge = state.pending;
  const expired = challenge && Date.parse(challenge.expiresAt) <= now;
  return { configured: true, serviceOrigin: new URL(config.url).origin,
    state: session ? Date.parse(session.expiresAt) > now ? "signed_in" : "expired" : "signed_out",
    account: session ? { id: session.account.id, displayName: session.account.displayName,
      identities: session.account.identities.map(({ kind, label, verifiedAt }) => ({ kind, label, verifiedAt })) } : null,
    expiresAt: session?.expiresAt || null,
    challenge: challenge ? { flowId: challenge.flowId, purpose: challenge.purpose,
      status: expired ? "expired" : challenge.status, qrImage: expired ? null : challenge.qrImage,
      userCode: expired ? null : challenge.userCode, expiresAt: challenge.expiresAt, pollAfter: challenge.pollAfter } : null,
    localDataMode: "local" };
}

export function createAccountService(options: Options = {}) {
  const env = options.env || process.env;
  const now = options.now || Date.now;
  const config = configuration(env);
  const stateDir = options.stateDir || env.PI_DESKTOP_STATE_DIR;
  const transport = options.fetchImpl || fetch;
  const tx = <T>(change: (state: PrivateAccountState) => { result: T; write?: boolean }) => {
    if (!config) return accountFail("not_configured", "账号服务尚未配置，当前可继续使用本地功能。", 503);
    return accountTransaction(config.url, config.clientId, stateDir, change);
  };
  const status = async (): Promise<AccountReply> => {
    if (!config) return { status: { configured: false, serviceOrigin: null, state: "unconfigured", account: null, expiresAt: null, challenge: null, localDataMode: "local" } };
    return tx(state => ({ result: { status: publicStatus(state, config, now()) } }));
  };
  async function remote(endpoint: string, body: Record<string, unknown> | null, bearer?: string | null, signal?: AbortSignal, idempotencyKey?: string): Promise<Record<string, unknown>> {
    if (!config) accountFail("not_configured", "账号服务尚未配置。", 503);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await transport(`${config.url}${endpoint}`, {
        method: body === null ? "GET" : "POST", redirect: "error", cache: "no-store",
        signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal,
        headers: { Accept: "application/json", ...(body === null ? {} : { "Content-Type": "application/json" }),
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
        ...(body === null ? {} : { body: JSON.stringify({ contract: ACCOUNT_CONTRACT, ...body }) }),
      });
      if (response.status === 401) accountFail("session_revoked", "账号登录已失效，请重新扫码。", 401);
      if (response.status === 429) accountFail("rate_limited", "账号服务请求过于频繁，请稍后重试。", 429);
      if (!response.ok || !response.headers.get("content-type")?.toLowerCase().includes("application/json")) accountFail("service_unavailable", "账号服务暂不可用，请稍后重试。", 503);
      if (!response.body) accountFail("invalid_response", "账号服务返回为空。", 502);
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > 1024 * 1024) { await reader.cancel(); accountFail("invalid_response", "账号服务响应超过上限。", 502); }
        chunks.push(next.value);
      }
      return responseObject(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    } catch (error) {
      if (error instanceof AccountError) throw error;
      if (signal?.aborted) accountFail("cancelled", "账号操作已取消。", 409);
      return accountFail("service_unavailable", "账号服务连接失败，请稍后重试。", 503);
    } finally { clearTimeout(timeout); }
  }
  async function bestEffortCancel(pending: PrivateChallenge | null): Promise<void> {
    if (!pending?.challengeId || !pending.deviceCode) return;
    try { await remote(`/v1/desktop/challenges/${encodeURIComponent(pending.challengeId)}/cancel`, { device_code: pending.deviceCode }); } catch { /* local generation already invalidated */ }
  }
  async function start(purpose: AccountPurpose, signal?: AbortSignal): Promise<AccountReply> {
    if (!config) return status();
    const reservation = await tx(state => {
      if (purpose === "login" && state.session && Date.parse(state.session.expiresAt) > now()) accountFail("already_signed_in", "请先退出当前账号后再切换账号。", 409);
      if (purpose !== "login" && (!state.session || Date.parse(state.session.expiresAt) <= now())) accountFail("login_required", "请先登录再绑定身份。", 401);
      const previous = state.pending;
      const flowId = randomUUID(), verifier = randomBytes(32).toString("base64url");
      state.generation++;
      state.pending = { flowId, purpose, status: "creating", qrImage: null, userCode: null,
        expiresAt: iso(now() + 30_000), pollAfter: iso(now() + 5_000), challengeId: null, deviceCode: null,
        verifier, interval: 5, expectedAccountId: purpose === "login" ? null : state.session!.account.id,
        baseSessionId: state.session?.id || null, pollingAt: null };
      return { result: { pending: structuredClone(state.pending), generation: state.generation,
        installationId: state.installationId, token: purpose === "login" ? null : state.session!.accessToken, previous }, write: true };
    });
    // A replaced code is invalid locally immediately. Do not delay the new QR.
    void bestEffortCancel(reservation.previous);
    try {
      const challenge = await remote("/v1/desktop/challenges", {
        client_id: config.clientId, installation_id: reservation.installationId, purpose,
        code_challenge: createHash("sha256").update(reservation.pending.verifier).digest("base64url"), code_challenge_method: "S256",
      }, reservation.token, signal, reservation.pending.flowId);
      const pending: PrivateChallenge = { ...reservation.pending, status: "pending",
        challengeId: opaque(challenge.challenge_id, 1, 160), deviceCode: opaque(challenge.device_code, 32),
        expiresAt: iso(now() + integer(challenge.expires_in, 30, 600) * 1000),
        interval: Math.max(5, integer(challenge.interval ?? 5, 1, 60)),
        pollAfter: iso(now() + Math.max(5, Number(challenge.interval || 5)) * 1000),
        userCode: text(challenge.user_code, 32, 4), qrImage: pngDataUri(challenge.qr_png_base64) };
      const applied = await tx(state => {
        if (state.generation !== reservation.generation || state.pending?.flowId !== pending.flowId) return { result: false };
        state.pending = pending; return { result: true, write: true };
      });
      if (!applied) { await bestEffortCancel(pending); accountFail("stale_flow", "该二维码已取消或被替换。", 409); }
      return status();
    } catch (error) {
      await tx(state => {
        if (state.pending?.flowId !== reservation.pending.flowId) return { result: null };
        state.pending.status = "expired"; state.pending.qrImage = null; state.pending.expiresAt = iso(now());
        return { result: null, write: true };
      });
      throw error;
    }
  }

  async function tokenSession(response: Record<string, unknown>, previous: PrivateSession | null, signal?: AbortSignal): Promise<PrivateSession> {
    if (response.token_type !== "Bearer") accountFail("invalid_response", "账号服务返回的凭据类型无效。", 502);
    const accessToken = opaque(response.access_token, 32, 4096);
    const refreshToken = response.refresh_token == null ? previous?.refreshToken || null : opaque(response.refresh_token, 32, 4096);
    const expiresAt = iso(now() + integer(response.expires_in, 30, 86400) * 1000);
    const profile = await remote("/v1/me", null, accessToken, signal);
    return { id: randomUUID(), accessToken, refreshToken, expiresAt, account: parseAccount(profile.account) };
  }
  async function poll(flowId: string, signal?: AbortSignal): Promise<AccountReply> {
    if (!config) return status();
    const claim = await tx(state => {
      const pending = state.pending;
      if (!pending || pending.flowId !== flowId) accountFail("stale_flow", "该二维码已取消或被替换。", 409);
      if (Date.parse(pending.expiresAt) <= now()) {
        pending.status = "expired"; pending.qrImage = null; return { result: null, write: true };
      }
      if (pending.status === "creating" || pending.status === "denied" || pending.status === "expired"
        || Date.parse(pending.pollAfter) > now() || pending.pollingAt !== null && now() - pending.pollingAt < 45_000) return { result: null };
      pending.pollingAt = now(); pending.pollAfter = iso(now() + pending.interval * 1000);
      return { result: { pending: structuredClone(pending), generation: state.generation, previous: state.session }, write: true };
    });
    if (!claim) return status();
    const { pending } = claim;
    const current = (state: PrivateAccountState) => state.generation === claim.generation && state.pending?.flowId === flowId
      && (state.session?.id || null) === pending.baseSessionId;
    try {
      const result = pending.authorizationCode ? { status: "authorized", challenge_id: pending.challengeId, authorization_code: pending.authorizationCode } : await remote(`/v1/desktop/challenges/${encodeURIComponent(pending.challengeId!)}/poll`, {
        device_code: pending.deviceCode,
      }, null, signal);
      if (result.challenge_id !== pending.challengeId) accountFail("challenge_mismatch", "扫码结果与当前二维码不符。", 502);
      if (result.status === "authorized") {
        const code = opaque(result.authorization_code, 32);
        const ready = await tx(state => {
          if (!current(state)) return { result: false };
          state.pending!.authorizationCode = code; state.pending!.status = "scanned";
          return { result: true, write: true };
        });
        if (!ready) accountFail("stale_flow", "扫码操作已取消或被替换。", 409);
        const token = await remote("/v1/desktop/token", { grant_type: "mini_program_code", client_id: config.clientId,
          challenge_id: pending.challengeId, authorization_code: code,
          code_verifier: pending.verifier }, null, signal, flowId);
        const session = await tokenSession(token, null, signal);
        if (pending.expectedAccountId && session.account.id !== pending.expectedAccountId) {
          try { await remote("/v1/desktop/revoke", { token: session.refreshToken || session.accessToken }, session.accessToken); } catch { /* never adopt a different account */ }
          accountFail("account_mismatch", "扫码账号与当前账号不同，未更改绑定。", 409);
        }
        const identityKind = { login: "wechat_miniprogram", bind_wechat: "wechat_miniprogram", bind_phone: "phone", bind_email: "email" }[pending.purpose];
        if (!session.account.identities.some(identity => identity.kind === identityKind)) accountFail("unverified_identity", "账号服务尚未确认所请求的身份绑定。", 502);
        const applied = await tx(state => {
          if (!current(state) || Date.parse(state.pending!.expiresAt) <= now()) return { result: false };
          state.session = session; state.pending = null; state.generation++;
          return { result: true, write: true };
        });
        if (!applied) {
          try { await remote("/v1/desktop/revoke", { token: session.refreshToken || session.accessToken }, session.accessToken); } catch { /* rejected result never enters local session */ }
          accountFail("stale_flow", "扫码操作已取消或过期，请重新扫码。", 409);
        }
      } else {
        if (!["pending", "scanned", "denied", "expired", "slow_down"].includes(String(result.status))) accountFail("invalid_response", "账号扫码状态无效。", 502);
        await tx(state => {
          if (!current(state)) return { result: null };
          const latest = state.pending!;
          latest.status = result.status === "slow_down" ? latest.status : result.status as PrivateChallenge["status"];
          if (result.status === "slow_down") latest.interval = Math.min(120, latest.interval + 5);
          latest.pollAfter = iso(now() + latest.interval * 1000); latest.pollingAt = null;
          if (["expired", "denied"].includes(latest.status)) latest.qrImage = null;
          return { result: null, write: true };
        });
      }
      return status();
    } catch (error) {
      await tx(state => {
        if (!current(state)) return { result: null };
        state.pending!.pollingAt = null;
        // Invalid identity and contract results end the code instead of retrying a consumed grant.
        if (error instanceof AccountError && !["service_unavailable", "rate_limited", "cancelled"].includes(error.code)) {
          state.pending!.status = "denied"; state.pending!.qrImage = null;
        }
        return { result: null, write: true };
      });
      throw error;
    }
  }
  async function refresh(signal?: AbortSignal): Promise<AccountReply> {
    if (!config) return status();
    const captured = await tx(state => ({ result: { previous: structuredClone(state.session), generation: state.generation } }));
    const { previous, generation } = captured;
    if (!previous) return status();
    try {
      let session: PrivateSession;
      if (Date.parse(previous.expiresAt) <= now()) {
        if (!previous.refreshToken) accountFail("login_required", "账号登录已过期，请重新扫码。", 401);
        const result = await remote("/v1/desktop/token", { grant_type: "refresh_token", client_id: config.clientId, refresh_token: previous.refreshToken },
          null, signal, `refresh-${previous.id}`);
        session = await tokenSession(result, previous, signal);
      } else {
        const result = await remote("/v1/me", null, previous.accessToken, signal);
        session = { ...previous, account: parseAccount(result.account) };
      }
      if (session.account.id !== previous.account.id) accountFail("account_mismatch", "账号服务返回了不同账号，未更改本地登录。", 409);
      const adopted = await tx(state => {
        if (state.session?.id !== previous.id || state.generation !== generation) return { result: false };
        state.session = session;
        // Refresh while a code is pending would change its base credential binding.
        if (session.id !== previous.id) { state.pending = null; state.generation++; }
        return { result: true, write: true };
      });
      if (!adopted) {
        const retained = await tx(state => ({ result: state.session?.accessToken === session.accessToken
          || state.session?.id === previous.id && Boolean(state.session.accessToken || state.session.refreshToken) }));
        if (!retained) {
          try { await remote("/v1/desktop/revoke", { token: session.refreshToken || session.accessToken }, session.accessToken); } catch { /* a late result cannot restore the local session */ }
        }
      }
      return status();
    } catch (error) {
      if (error instanceof AccountError && ["session_revoked", "login_required", "account_mismatch"].includes(error.code)) {
        await tx(state => {
          if (state.session?.id !== previous.id || state.session.accessToken !== previous.accessToken
            || state.session.refreshToken !== previous.refreshToken) return { result: null };
          state.session.expiresAt = iso(now()); state.session.accessToken = ""; state.session.refreshToken = null;
          // A new login proves its own identity; binding flows still depend on
          // the revoked credential. Keep an independent login's generation.
          if (state.pending?.purpose !== "login") { state.pending = null; state.generation++; }
          return { result: null, write: true };
        });
      }
      throw error;
    }
  }
  async function act(action: AccountAction, signal?: AbortSignal): Promise<AccountReply> {
    if (action.action === "start") return start(action.purpose, signal);
    if (action.action === "poll") return poll(action.flowId, signal);
    if (action.action === "refresh") return refresh(signal);
    if (!config) return status();
    const removed = await tx(state => {
      if (action.action === "cancel" && state.pending?.flowId !== action.flowId) return { result: { pending: null, session: null } };
      const pending = state.pending, session = action.action === "logout" ? state.session : null;
      state.pending = null; if (action.action === "logout") state.session = null;
      state.generation++; return { result: { pending, session }, write: true };
    });
    await bestEffortCancel(removed.pending);
    let warning: string | undefined;
    if (removed.session?.accessToken) {
      try { await remote("/v1/desktop/revoke", { token: removed.session.refreshToken || removed.session.accessToken }, removed.session.accessToken, signal); }
      catch { warning = "已退出此设备，账号服务的撤销状态尚未确认。"; }
    }
    return { ...await status(), ...(warning ? { warning } : {}) };
  }
  return { status, act };
}
