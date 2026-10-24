import { createHash, randomBytes, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import path, { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OWNER = "PIGU-PPPgu";
const REPO = "edupi-desktop";
const LOGIN = OWNER;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ACTIONS = ["github.get_current_user", "github.get_repository", "github.create_issue", "github.get_issue", "github.list_repository_issues"];
const MAX_FRAME = 32 * 1024;
const MAX_RESPONSE = 512 * 1024;

function record(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function keys(value, expected) { return record(value) && Object.keys(value).sort().join(",") === [...expected].sort().join(","); }
function uuid(value) { return typeof value === "string" && UUID.test(value); }
function safeError(code) { const error = new Error(code); error.code = code; return error; }
function fail(code = "github_oauth_unavailable") { throw safeError(code); }
function canonicalHash(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

export function fixedGitHubTestInput(requestId) {
  if (!uuid(requestId)) fail("invalid_github_request");
  return {
    owner: OWNER,
    repo: REPO,
    title: `[EduPi OAuth TEST] ${requestId}`,
    body: `EduPi OpenConnector 本机 OAuth 与写入验收测试。\n\n仅包含测试内容，不涉及教师或学生资料。\n\n验收标记：edupi-openconnector-test:${requestId}`,
  };
}

export function isFixedGitHubTestInput(value, requestId) {
  if (!uuid(requestId) || !keys(value, ["owner", "repo", "title", "body"])) return false;
  const expected = fixedGitHubTestInput(requestId);
  return Object.entries(expected).every(([key, text]) => value[key] === text);
}

function isLocalProxy(value) {
  if (typeof value !== "string" || value.length > 256) return false;
  try {
    const url = new URL(value);
    const port = Number(url.port || "80");
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      && Number.isInteger(port) && port > 0 && port <= 65_535 && !url.username && !url.password
      && url.pathname === "/" && !url.search && !url.hash;
  } catch { return false; }
}

export function isGitHubHostNetwork(value) {
  return record(value) && Object.keys(value).every((key) => ["httpProxy", "httpsProxy", "noProxy"].includes(key))
    && (value.httpProxy !== undefined || value.httpsProxy !== undefined)
    && (value.httpProxy === undefined || isLocalProxy(value.httpProxy))
    && (value.httpsProxy === undefined || isLocalProxy(value.httpsProxy))
    && typeof value.noProxy === "string" && value.noProxy.length <= 2048 && !/[\u0000-\u001f\u007f]/u.test(value.noProxy);
}

async function configureNetwork(network) {
  if (network === undefined) return async () => {};
  if (!isGitHubHostNetwork(network)) fail("github_proxy_unsupported");
  const { EnvHttpProxyAgent, fetch, getGlobalDispatcher, setGlobalDispatcher } = await import("undici");
  const originalDispatcher = getGlobalDispatcher();
  const originalFetch = globalThis.fetch;
  const agent = new EnvHttpProxyAgent(network);
  setGlobalDispatcher(agent);
  globalThis.fetch = fetch;
  return async () => { globalThis.fetch = originalFetch; setGlobalDispatcher(originalDispatcher); await agent.close(); };
}

async function privateDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail();
  await chmod(directory, 0o700);
}

async function privateJson(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, JSON.stringify(value), { flag: "wx", mode: 0o600, flush: true }); await rename(temporary, file); }
  finally { await rm(temporary, { force: true }); }
}

async function readJson(response) {
  const reader = response.body?.getReader();
  if (!reader) fail();
  const parts = [];
  let size = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > MAX_RESPONSE) { await reader.cancel().catch(() => {}); fail(); }
      parts.push(item.value);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts)));
  } finally { reader.releaseLock(); }
}

/** Derive a small catalog from the pinned upstream definition, not user input. */
export async function prepareGitHubOAuthAssets(dataDir, assetDirectory) {
  const provider = JSON.parse(await readFile(path.join(assetDirectory, "catalog/apps/github.json"), "utf8"));
  if (provider.service !== "github") fail();
  const oauth = provider.auth.find((auth) => auth.type === "oauth2");
  if (!oauth || oauth.authorizationUrl !== "https://github.com/login/oauth/authorize"
    || oauth.tokenUrl !== "https://github.com/login/oauth/access_token") fail();
  oauth.scopes = ["public_repo"];
  oauth.authorizationOptions = [{ id: "public_repo", label: "Public repositories", description: "Create the marked verification issue in the selected public repository.", required: true, defaultSelected: true, risk: "sensitive" }];
  oauth.pkce = { method: "S256" };
  provider.auth = [oauth];
  provider.authTypes = ["oauth2"];
  provider.actions = provider.actions.filter((action) => ACTIONS.includes(action.id));
  if (provider.actions.length !== ACTIONS.length) fail();
  for (const action of provider.actions) action.requiredScopes = ["public_repo"];
  const catalogDir = path.join(dataDir, "github-catalog");
  await privateDirectory(catalogDir);
  await privateJson(path.join(catalogDir, "github.json"), provider);
  return { catalogDir, migrationDirectory: path.join(assetDirectory, "migrations") };
}

function isSafeAuthorizationUrl(value, callbackUrl) {
  if (typeof value !== "string" || value.length > 4096) return false;
  try {
    const url = new URL(value);
    const allowed = new Set(["client_id", "redirect_uri", "response_type", "state", "scope", "code_challenge", "code_challenge_method"]);
    return url.origin === "https://github.com" && url.pathname === "/login/oauth/authorize"
      && !url.username && !url.password && !url.hash
      && [...url.searchParams.keys()].every((key) => allowed.has(key) && url.searchParams.getAll(key).length === 1)
      && url.searchParams.get("scope") === "public_repo" && url.searchParams.get("redirect_uri") === callbackUrl
      && url.searchParams.get("response_type") === "code" && uuid(url.searchParams.get("state"))
      && /^[A-Za-z0-9_-]{43}$/u.test(url.searchParams.get("code_challenge") || "")
      && url.searchParams.get("code_challenge_method") === "S256";
  } catch { return false; }
}

function validOperation(request) {
  if (!record(request) || !uuid(request.id)) return false;
  if (request.op === "configure") return keys(request, ["id", "op", "clientId", "clientSecret"])
    && typeof request.clientId === "string" && /^[A-Za-z0-9_.-]{6,128}$/u.test(request.clientId)
    && typeof request.clientSecret === "string" && /^[A-Za-z0-9_-]{16,256}$/u.test(request.clientSecret);
  if (request.op === "startOAuth") return keys(request, ["id", "op"]);
  if (request.op === "pollOAuth" || request.op === "cancelOAuth") return keys(request, ["id", "op", "requestId"]) && uuid(request.requestId);
  if (request.op === "status") return keys(request, request.connectionId === undefined ? ["id", "op"] : ["id", "op", "connectionId"])
    && (request.connectionId === undefined || uuid(request.connectionId));
  if (request.op === "readAccount") return keys(request, ["id", "op", "connectionId"]) && uuid(request.connectionId);
  if (request.op === "createTestIssue" || request.op === "reconcileIssue") {
    const fields = ["id", "op", "connectionId", "requestId", "input"];
    if (request.op === "reconcileIssue" && request.issueNumber !== undefined) fields.push("issueNumber");
    return keys(request, fields) && uuid(request.connectionId) && isFixedGitHubTestInput(request.input, request.requestId)
      && (request.issueNumber === undefined || Number.isSafeInteger(request.issueNumber) && request.issueNumber > 0);
  }
  return false;
}

function projectIssue(value, input, login) {
  if (!record(value) || value.pull_request !== undefined || !Number.isSafeInteger(value.number) || value.number <= 0
    || value.title !== input.title || value.body !== input.body || value.user?.login !== login
    || !["open", "closed"].includes(value.state)
    || value.html_url !== `https://github.com/${OWNER}/${REPO}/issues/${value.number}`) return null;
  return { number: value.number, url: value.html_url, title: value.title, body: value.body, state: value.state, author: value.user.login };
}

export async function createGitHubOAuthHost({ dataDir, encryptionKey, network, runtimeFactory } = {}) {
  if (!isAbsolute(dataDir || "") || typeof encryptionKey !== "string" || !/^[a-f0-9]{64}$/u.test(encryptionKey)) fail("invalid_github_init");
  await privateDirectory(dataDir);
  const dispatchDir = path.join(dataDir, "test-dispatches");
  await privateDirectory(dispatchDir);
  const closeNetwork = await configureNetwork(network);
  const tokens = { adminToken: randomBytes(32).toString("hex"), runtimeToken: randomBytes(32).toString("hex") };
  const secrets = new Set([encryptionKey, tokens.adminToken, tokens.runtimeToken]);
  const authStates = new Map();
  const socketSet = new Set();
  let runtime;
  let closed = false;
  let origin;
  const server = http.createServer(async (incoming, outgoing) => {
    outgoing.setHeader("Cache-Control", "no-store");
    outgoing.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    outgoing.setHeader("Referrer-Policy", "no-referrer");
    outgoing.setHeader("X-Content-Type-Options", "nosniff");
    outgoing.setHeader("Content-Type", "text/html; charset=utf-8");
    try {
      if (!runtime || incoming.method !== "GET" || incoming.headers.host !== new URL(origin).host
        || typeof incoming.url !== "string" || !incoming.url.startsWith("/") || incoming.url.length > 4096) {
        outgoing.writeHead(404); outgoing.end("Not found"); return;
      }
      const url = new URL(incoming.url, origin);
      if (url.origin !== origin || url.pathname !== "/oauth/callback") { outgoing.writeHead(404); outgoing.end("Not found"); return; }
      if (!url.search) { outgoing.end("<!doctype html><meta charset=utf-8><title>EduPi</title><p>授权流程已处理，请返回 EduPi 读取状态。</p>"); return; }
      const state = url.searchParams.get("state");
      const pending = authStates.get(state);
      const allowed = new Set(["state", "code", "error", "error_description", "iss"]);
      if (!uuid(state) || !pending || pending.used || Date.parse(pending.expiresAt) <= Date.now()
        || [...url.searchParams.keys()].some((key) => !allowed.has(key) || url.searchParams.getAll(key).length !== 1)
        || (url.searchParams.has("iss") && url.searchParams.get("iss") !== "https://github.com/login/oauth")
        || (!url.searchParams.get("code") && !url.searchParams.get("error"))) {
        outgoing.writeHead(400); outgoing.end("授权状态无效，请返回 EduPi 重新授权。"); return;
      }
      pending.used = true;
      pending.controller = new AbortController();
      const response = await runtime.fetch(new Request(url, { signal: AbortSignal.any([AbortSignal.timeout(30_000), pending.controller.signal]) }));
      await response.body?.cancel().catch(() => {});
      if (!response.ok && response.status !== 302) { outgoing.writeHead(400); outgoing.end("授权未完成，请返回 EduPi 重试。"); return; }
      outgoing.writeHead(303, { Location: "/oauth/callback" }); outgoing.end();
    } catch { outgoing.writeHead(400); outgoing.end("授权未完成，请返回 EduPi 重试。"); }
  });
  server.on("connection", (socket) => { socketSet.add(socket); socket.on("close", () => socketSet.delete(socket)); });

  async function close() {
    if (closed) return;
    closed = true;
    for (const socket of socketSet) socket.destroy();
    await new Promise((resolveClose) => server.close(resolveClose));
    try { if (runtime) await runtime.close(); }
    finally { await closeNetwork(); }
  }

  try {
    await new Promise((resolveListen, rejectListen) => { server.once("error", rejectListen); server.listen(0, "127.0.0.1", resolveListen); });
    origin = `http://127.0.0.1:${server.address().port}`;
    const { createConnectorRuntime, getConnectorAssetDirectory } = await import("@oomol-lab/open-connector");
    const assets = await prepareGitHubOAuthAssets(dataDir, getConnectorAssetDirectory());
    runtime = await (runtimeFactory ?? createConnectorRuntime)({
      dataDir, publicOrigin: origin, encryptionKey, ...tokens, assets,
      actionPolicy: { allowedActions: ACTIONS, blockedProxies: ["*"] },
      network: { trustedHosts: ["github.com", "api.github.com"] },
    });
  } catch (error) { await close(); throw error; }
  const callbackUrl = `${origin}/oauth/callback`;

  async function call(route, token, init = {}) {
    const response = await runtime.fetch(new Request(new URL(route, origin), {
      ...init, headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
      signal: AbortSignal.timeout(25_000),
    }));
    return { ok: response.ok, status: response.status, body: await readJson(response) };
  }

  async function action(actionId, connection, input, requestId = randomUUID()) {
    const result = await call(`/v1/actions/${actionId}`, tokens.runtimeToken, {
      method: "POST", headers: { "x-oo-connector-alias": connection.alias, "Idempotency-Key": requestId }, body: JSON.stringify({ input }),
    });
    const executionId = result.body?.meta?.executionId;
    if (!uuid(executionId) || result.body?.meta?.auditPersisted !== true) fail("github_audit_unavailable");
    const audit = await call(`/api/runs/${executionId}`, tokens.adminToken);
    if (!audit.ok || audit.body?.id !== executionId || audit.body?.actionId !== actionId || audit.body?.service !== "github"
      || audit.body?.connectionId !== connection.id || typeof audit.body?.ok !== "boolean") fail("github_audit_unavailable");
    if (!result.ok || result.body?.success !== true || audit.body.ok !== true) fail("github_action_failed");
    return { data: result.body.data, executionId };
  }

  async function connectionFor(id) {
    const reply = await call(`/v1/connections/by-id/${id}`, tokens.adminToken);
    const connection = reply.body?.data;
    if (!reply.ok || reply.body?.success !== true || connection?.id !== id || connection.service !== "github"
      || connection.status !== "active" || connection.authType !== "oauth2" || !uuid(connection.alias)
      || !Array.isArray(connection.scopes) || connection.scopes.length !== 1 || connection.scopes[0] !== "public_repo") fail("github_oauth_connection_required");
    const profile = await action("github.get_current_user", connection, {});
    if (profile.data?.login !== LOGIN || !Number.isSafeInteger(profile.data.id) || profile.data.id <= 0
      || profile.data.html_url !== `https://github.com/${LOGIN}`) fail("github_account_changed");
    return { internal: connection, public: { id: connection.id, login: profile.data.login, accountId: String(profile.data.id), scopes: ["public_repo"], authType: "oauth2" }, profile: profile.data };
  }

  async function configured() {
    const reply = await call("/api/oauth/configs", tokens.adminToken);
    if (!reply.ok || !Array.isArray(reply.body)) fail();
    const value = reply.body.find((item) => item.service === "github");
    return value?.configured === true && Array.isArray(value.effectiveScopes) && value.effectiveScopes.length === 1 && value.effectiveScopes[0] === "public_repo";
  }

  async function repositoryFor(connection) {
    const reply = await action("github.get_repository", connection, { owner: OWNER, repo: REPO });
    const value = reply.data;
    if (value?.full_name !== `${OWNER}/${REPO}` || value.private !== false || value.has_issues !== true
      || value.archived === true || value.disabled === true || value.owner?.login !== LOGIN
      || value.html_url !== `https://github.com/${OWNER}/${REPO}` || !(value.permissions?.push === true || value.permissions?.admin === true)) fail("github_repository_not_allowed");
  }

  const dispatchFile = (requestId) => path.join(dispatchDir, `${requestId}.json`);
  async function loadDispatch(requestId) {
    try {
      const file = dispatchFile(requestId), stats = await lstat(file);
      if (!stats.isFile() || stats.isSymbolicLink() || stats.size > 16 * 1024) fail();
      const value = JSON.parse(await readFile(file, "utf8"));
      if (!record(value) || value.requestId !== requestId || !uuid(value.connectionId) || !/^[a-f0-9]{64}$/u.test(value.inputHash || "")) fail();
      return value;
    } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
  }

  async function createIssue(request, connection) {
    const hash = canonicalHash(request.input);
    const previous = await loadDispatch(request.requestId);
    if (previous) {
      if (previous.inputHash !== hash || previous.connectionId !== request.connectionId) fail("github_request_conflict");
      return previous.result ?? { status: "unknown", auditPersisted: false, readbackVerified: false, code: "github_write_interrupted" };
    }
    const stored = { requestId: request.requestId, connectionId: request.connectionId, inputHash: hash };
    const file = await open(dispatchFile(request.requestId), "wx", 0o600);
    try { await file.writeFile(JSON.stringify(stored)); await file.sync(); } finally { await file.close(); }
    let result;
    try {
      await repositoryFor(connection.internal);
      const written = await action("github.create_issue", connection.internal, request.input, request.requestId);
      stored.writeExecutionId = written.executionId;
      const issue = projectIssue(written.data, request.input, connection.public.login);
      if (!issue) fail("github_issue_mismatch");
      stored.issueNumber = issue.number;
      await privateJson(dispatchFile(request.requestId), stored);
      const read = await action("github.get_issue", connection.internal, { owner: OWNER, repo: REPO, issueNumber: issue.number });
      const readback = projectIssue(read.data, request.input, connection.public.login);
      if (!readback || readback.number !== issue.number) fail("github_issue_mismatch");
      result = { status: "succeeded", issue: readback, writeExecutionId: written.executionId, readExecutionId: read.executionId, auditPersisted: true, readbackVerified: true };
    } catch (error) {
      result = { status: stored.writeExecutionId || error?.code !== "github_repository_not_allowed" ? "unknown" : "failed", auditPersisted: false, readbackVerified: false,
        ...(stored.writeExecutionId ? { writeExecutionId: stored.writeExecutionId } : {}), code: error?.code === "github_repository_not_allowed" ? error.code : "github_issue_result_unknown" };
    }
    stored.result = result;
    await privateJson(dispatchFile(request.requestId), stored);
    return result;
  }

  async function reconcileIssue(request, connection) {
    const stored = await loadDispatch(request.requestId);
    if (!stored || stored.inputHash !== canonicalHash(request.input)) fail("github_request_conflict");
    const unknown = { status: "unknown", auditPersisted: false, readbackVerified: false, code: "github_issue_not_found_yet" };
    let number = request.issueNumber ?? stored.issueNumber;
    if (number === undefined) {
      const matches = [];
      for (let page = 1; page <= 3 && matches.length === 0; page += 1) {
        const listed = await action("github.list_repository_issues", connection.internal, { owner: OWNER, repo: REPO, state: "all", sort: "created", direction: "desc", perPage: 50, page });
        const items = Array.isArray(listed.data) ? listed.data : listed.data?.issues;
        if (!Array.isArray(items)) fail("github_issue_mismatch");
        for (const item of items) if (projectIssue(item, request.input, connection.public.login)) matches.push(item.number);
        const fetched = listed.data?.pageInfo?.fetched;
        if ((Number.isSafeInteger(fetched) ? fetched : items.length) < 50) break;
      }
      if (matches.length !== 1) return unknown;
      [number] = matches;
    }
    const read = await action("github.get_issue", connection.internal, { owner: OWNER, repo: REPO, issueNumber: number });
    const issue = projectIssue(read.data, request.input, connection.public.login);
    if (!issue || issue.number !== number) return { ...unknown, code: "github_issue_mismatch" };
    let writeExecutionId = stored.writeExecutionId;
    if (!writeExecutionId) {
      const runs = await call("/api/runs?service=github&actionId=github.create_issue&limit=100", tokens.adminToken);
      const matches = runs.ok && Array.isArray(runs.body?.items) ? runs.body.items.filter((run) => run.actionId === "github.create_issue"
        && run.connectionId === stored.connectionId && run.ok === true && JSON.stringify(run.inputSummary).includes(`edupi-openconnector-test:${request.requestId}`)) : [];
      if (matches.length === 1 && uuid(matches[0].id)) writeExecutionId = matches[0].id;
    }
    if (!writeExecutionId) return { ...unknown, issue, readExecutionId: read.executionId, readbackVerified: true, code: "github_write_audit_unavailable" };
    const audit = await call(`/api/runs/${writeExecutionId}`, tokens.adminToken);
    if (!audit.ok || audit.body?.id !== writeExecutionId || audit.body?.actionId !== "github.create_issue"
      || audit.body?.connectionId !== stored.connectionId || audit.body?.ok !== true) return { ...unknown, issue, readExecutionId: read.executionId, readbackVerified: true, code: "github_write_audit_unavailable" };
    const result = { status: "succeeded", issue, writeExecutionId, readExecutionId: read.executionId, auditPersisted: true, readbackVerified: true };
    await privateJson(dispatchFile(request.requestId), { ...stored, writeExecutionId, issueNumber: number, result });
    return result;
  }

  async function handle(request) {
    if (!validOperation(request)) return { id: uuid(request?.id) ? request.id : null, ok: false, code: "invalid_github_request" };
    try {
      let data;
      if (request.op === "configure") {
        for (const pending of authStates.values()) pending.controller?.abort();
        authStates.clear();
        secrets.add(request.clientSecret);
        const reply = await call("/api/oauth/configs/github", tokens.adminToken, { method: "PUT", body: JSON.stringify({ clientId: request.clientId, clientSecret: request.clientSecret, requestedScopes: ["public_repo"] }) });
        if (!reply.ok || reply.body?.configured !== true) fail("github_oauth_configuration_failed");
        data = { clientConfigured: true };
      } else if (request.op === "startOAuth") {
        const reply = await call("/v1/connections/github/connect", tokens.adminToken, { method: "POST", body: "{}" });
        const value = reply.body?.data;
        if (!reply.ok || reply.body?.success !== true || !uuid(value?.connectionRequestId) || !isSafeAuthorizationUrl(value?.authorizationUrl, callbackUrl)
          || typeof value.expiresAt !== "string" || !Number.isFinite(Date.parse(value.expiresAt))) fail("github_oauth_start_failed");
        const state = new URL(value.authorizationUrl).searchParams.get("state");
        authStates.set(state, { requestId: value.connectionRequestId, expiresAt: value.expiresAt, used: false });
        data = { requestId: value.connectionRequestId, authorizationUrl: value.authorizationUrl, expiresAt: value.expiresAt };
      } else if (request.op === "cancelOAuth") {
        for (const [state, pending] of authStates) if (pending.requestId === request.requestId) {
          pending.controller?.abort();
          authStates.delete(state);
        }
        data = { status: "cancelled" };
      } else if (request.op === "pollOAuth") {
        const reply = await call(`/v1/connection-requests/${request.requestId}`, tokens.adminToken);
        const value = reply.body?.data;
        if (!reply.ok || reply.body?.success !== true || value?.service !== "github") fail("github_oauth_request_missing");
        if (value.status === "connected" && uuid(value.appId)) data = { status: "connected", connection: (await connectionFor(value.appId)).public };
        else data = { status: value.status === "expired" ? "expired" : value.status === "failed" ? "failed" : "pending" };
      } else if (request.op === "status") {
        data = { clientConfigured: await configured(), callbackUrl, connection: request.connectionId ? (await connectionFor(request.connectionId)).public : null };
      } else if (request.op === "readAccount") {
        const connection = await connectionFor(request.connectionId);
        const profile = connection.profile;
        data = { connection: connection.public, profile: { login: profile.login, id: profile.id, url: profile.html_url, publicRepos: profile.public_repos } };
      } else {
        const connection = await connectionFor(request.connectionId);
        data = request.op === "createTestIssue" ? await createIssue(request, connection) : await reconcileIssue(request, connection);
      }
      const response = { id: request.id, ok: true, data };
      const output = JSON.stringify(response);
      if ([...secrets].some((secret) => output.includes(secret))) fail();
      return response;
    } catch (error) {
      const code = typeof error?.code === "string" && /^github_[a-z_]{1,64}$/u.test(error.code) ? error.code : "github_oauth_unavailable";
      return { id: request.id, ok: false, code };
    }
  }
  return { callbackUrl, handle, close };
}

async function* frames(input) {
  let bytes = Buffer.alloc(0);
  for await (const chunk of input) {
    bytes = Buffer.concat([bytes, chunk]);
    let newline;
    while ((newline = bytes.indexOf(10)) >= 0) {
      if (newline > MAX_FRAME) fail("invalid_github_request");
      const line = bytes.subarray(0, newline); bytes = bytes.subarray(newline + 1);
      if (line.length) yield JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(line));
    }
    if (bytes.length > MAX_FRAME) fail("invalid_github_request");
  }
  if (bytes.length) fail("invalid_github_request");
}

async function main() {
  const dataDir = process.argv[2];
  let host;
  let closing;
  const close = () => closing ??= host?.close();
  const terminate = () => { void Promise.resolve(close()).finally(() => process.exit(0)); };
  process.once("SIGTERM", terminate);
  process.once("SIGINT", terminate);
  try {
    for await (const request of frames(process.stdin)) {
      if (!host) {
        const expected = request?.network === undefined ? ["id", "op", "encryptionKey"] : ["id", "op", "encryptionKey", "network"];
        if (!keys(request, expected) || !uuid(request.id) || request.op !== "init") fail("invalid_github_init");
        host = await createGitHubOAuthHost({ dataDir, encryptionKey: request.encryptionKey, network: request.network });
        process.stdout.write(`${JSON.stringify({ id: request.id, ok: true, data: { ready: true, callbackUrl: host.callbackUrl } })}\n`);
      } else process.stdout.write(`${JSON.stringify(await host.handle(request))}\n`);
    }
  } finally { await close(); }
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch(() => { process.stderr.write("GitHub OAuth host unavailable\n"); process.exitCode = 1; });
}
