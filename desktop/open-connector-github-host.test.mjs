import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createGitHubOAuthHost, fixedGitHubTestInput, isFixedGitHubTestInput, isGitHubHostNetwork } from "./open-connector-github-host.mjs";

const CLIENT_ID = "oauth-client-fixture";
const CLIENT_SECRET = "test-client-secret-never-production-123456";
const TOKEN = "test-oauth-access-token-never-production-123456";
const REFRESH = "test-oauth-refresh-token-never-production-123456";
const profile = { login: "PIGU-PPPgu", id: 59789742, html_url: "https://github.com/PIGU-PPPgu", public_repos: 42 };
const repo = { full_name: "PIGU-PPPgu/edupi-desktop", private: false, has_issues: true, archived: false, disabled: false,
  owner: { login: "PIGU-PPPgu" }, html_url: "https://github.com/PIGU-PPPgu/edupi-desktop", permissions: { push: true, admin: true } };
const request = (op, values = {}) => ({ id: randomUUID(), op, ...values });

async function fixture(options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "edupi-github-oauth-host-"));
  const originalFetch = globalThis.fetch;
  const calls = [];
  const issues = [];
  let host;
  let captured;
  let authorization;
  let tokenRequests = 0;
  let createRequests = 0;
  let refreshRequests = 0;
  let currentToken = TOKEN;
  let currentRefresh = REFRESH;
  const tokenProfiles = new Map([[TOKEN, profile]]);
  globalThis.fetch = async (input, init) => {
    const incoming = input instanceof Request ? input : new Request(input, init);
    const url = new URL(incoming.url);
    calls.push({ method: incoming.method, pathname: url.pathname });
    if (options.offline) throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
    if (incoming.url === "https://github.com/login/oauth/access_token") {
      tokenRequests += 1;
      const text = await incoming.text();
      const body = incoming.headers.get("content-type")?.includes("json") ? JSON.parse(text) : Object.fromEntries(new URLSearchParams(text));
      assert.equal(body.client_id, CLIENT_ID);
      assert.equal(body.client_secret, CLIENT_SECRET);
      if (body.grant_type === "refresh_token") {
        refreshRequests += 1;
        assert.equal(body.refresh_token, currentRefresh);
        assert.equal(body.code, undefined);
        if (options.beforeRefreshResponse) await options.beforeRefreshResponse();
        if (options.refreshResponse) return options.refreshResponse();
        if (options.refreshRejected) return Response.json({ error: "bad_refresh_token" }, { status: 400 });
        tokenProfiles.delete(currentToken);
        currentToken = `${TOKEN}-${refreshRequests}`; currentRefresh = `${REFRESH}-${refreshRequests}`;
        tokenProfiles.set(currentToken, profile);
        return Response.json({ access_token: currentToken, refresh_token: currentRefresh, expires_in: 28800, token_type: "bearer", scope: "public_repo" });
      }
      assert.equal(body.grant_type, "authorization_code");
      assert.equal(body.code, "fixture-authorization-code");
      assert.equal(body.redirect_uri, host.callbackUrl);
      assert.match(body.code_verifier, /^[A-Za-z0-9._~-]{43,128}$/u);
      assert.equal(createHash("sha256").update(body.code_verifier).digest("base64url"), authorization.searchParams.get("code_challenge"));
      const exchangedToken = options.authorizationToken ?? currentToken;
      tokenProfiles.set(exchangedToken, options.authorizationProfile ?? profile);
      return Response.json({ access_token: exchangedToken, token_type: "bearer", scope: "public_repo",
        ...(options.expiring ? { refresh_token: currentRefresh, expires_in: 28800 } : {}) });
    }
    assert.equal(url.origin, "https://api.github.com", "all provider calls must stay on the fixed GitHub API");
    const accessToken = incoming.headers.get("authorization")?.replace(/^Bearer /u, "");
    assert.equal(tokenProfiles.has(accessToken), true, "only current or separately issued fixture tokens may access GitHub");
    const headers = { "x-oauth-scopes": "public_repo" };
    if (url.pathname === "/user" && incoming.method === "GET") return options.accessRejected
      ? Response.json({ message: "Bad credentials" }, { status: 401 }) : Response.json(options.profile ?? tokenProfiles.get(accessToken), { headers });
    if (url.pathname === "/repos/PIGU-PPPgu/edupi-desktop" && incoming.method === "GET") return Response.json({ ...repo, ...options.repo }, { headers });
    if (url.pathname === "/repos/PIGU-PPPgu/edupi-desktop/issues" && incoming.method === "POST") {
      createRequests += 1;
      const body = await incoming.json();
      assert.deepEqual(Object.keys(body).sort(), ["body", "title"]);
      const issue = { id: 9900 + issues.length, number: 700 + issues.length, title: body.title, body: body.body,
        html_url: `https://github.com/PIGU-PPPgu/edupi-desktop/issues/${700 + issues.length}`, state: "open", user: { login: profile.login } };
      issues.push(issue);
      if (options.lostResponse) throw new Error("simulated response loss after provider accepted the issue");
      return Response.json(issue, { status: 201, headers });
    }
    if (url.pathname === "/repos/PIGU-PPPgu/edupi-desktop/issues" && incoming.method === "GET") return Response.json(issues, { headers });
    const number = url.pathname.match(/^\/repos\/PIGU-PPPgu\/edupi-desktop\/issues\/(\d+)$/u)?.[1];
    if (number && incoming.method === "GET") {
      const issue = issues.find((item) => item.number === Number(number));
      return Response.json(options.readbackMismatch ? { ...issue, body: "changed elsewhere" } : issue, { headers });
    }
    throw new Error("unexpected fixture provider path");
  };
  const encryptionKey = randomBytes(32).toString("hex");
  async function start() {
    const { createConnectorRuntime } = await import("@oomol-lab/open-connector");
    host = await createGitHubOAuthHost({ dataDir: directory, encryptionKey, acceptanceEnabled: options.acceptanceEnabled === true, runtimeFactory: async (runtimeOptions) => {
      const runtime = await createConnectorRuntime(runtimeOptions);
      captured = { runtime, options: runtimeOptions };
      return runtime;
    } });
  }
  async function startAuthorization(connectionId) {
    if (!connectionId) {
      const configured = await host.handle(request("configure", { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }));
      assert.deepEqual(configured.data, { clientConfigured: true });
    }
    const started = await host.handle(request("startOAuth", connectionId ? { connectionId, expectedAccountId: String(profile.id) } : {}));
    assert.equal(started.ok, true);
    authorization = new URL(started.data.authorizationUrl);
    const callback = new URL(host.callbackUrl);
    callback.searchParams.set("state", authorization.searchParams.get("state"));
    callback.searchParams.set("code", "fixture-authorization-code");
    return { started, callback };
  }
  async function authorize({ issuer = "https://github.com/login/oauth" } = {}) {
    const { started, callback } = await startAuthorization();
    if (issuer !== null) callback.searchParams.set("iss", issuer);
    const response = await originalFetch(callback, { redirect: "manual" });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/oauth/callback");
    const polled = await host.handle(request("pollOAuth", { requestId: started.data.requestId }));
    assert.equal(polled.ok, true);
    assert.equal(polled.data.status, "connected");
    return { connection: polled.data.connection, started, callback };
  }
  await start();
  return {
    directory, originalFetch, calls, issues, start, startAuthorization, authorize, options,
    get host() { return host; }, get captured() { return captured; },
    get tokenRequests() { return tokenRequests; }, get createRequests() { return createRequests; }, get refreshRequests() { return refreshRequests; },
    close: async () => { try { await host?.close(); } finally { globalThis.fetch = originalFetch; await rm(directory, { recursive: true, force: true }); } },
  };
}

test("fixed test input rejects arbitrary targets, content, actions and embedded credential fields", () => {
  const id = randomUUID(), input = fixedGitHubTestInput(id);
  assert.equal(isFixedGitHubTestInput(input, id), true);
  for (const altered of [{ ...input, repo: "another" }, { ...input, owner: "another" }, { ...input, title: "A real issue" },
    { ...input, body: input.body + "\nextra content" }, { ...input, assignees: ["someone"] }, { ...input, apiKey: TOKEN }]) {
    assert.equal(isFixedGitHubTestInput(altered, id), false);
  }
  assert.equal(isGitHubHostNetwork({ httpsProxy: "http://127.0.0.1:80", noProxy: "localhost" }), true);
  assert.equal(isGitHubHostNetwork({ httpsProxy: "http://user:secret@127.0.0.1:7897", noProxy: "localhost" }), false);
});

test("real upstream OAuth uses public_repo and PKCE, accepts one callback, then creates and reads one marked issue with both audits", async () => {
  const f = await fixture();
  try {
    const before = await f.host.handle(request("status"));
    assert.equal(before.data.clientConfigured, false);
    const { connection, started, callback } = await f.authorize();
    assert.deepEqual(connection.scopes, ["public_repo"]);
    assert.equal(connection.authType, "oauth2");
    assert.equal(connection.accountId, String(profile.id));
    const authorization = new URL(started.data.authorizationUrl);
    assert.equal(authorization.searchParams.get("scope"), "public_repo offline_access");
    assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
    assert.equal(f.tokenRequests, 1);
    assert.equal((await f.originalFetch(callback, { redirect: "manual" })).status, 400);
    assert.equal(f.tokenRequests, 1, "replayed callback must never exchange the code again");
    const requestId = randomUUID();
    const input = fixedGitHubTestInput(requestId);
    const written = await f.host.handle(request("createTestIssue", { connectionId: connection.id, requestId, input }));
    assert.equal(written.ok, true);
    assert.equal(written.data.status, "succeeded");
    assert.equal(written.data.readbackVerified, true);
    assert.equal(written.data.auditPersisted, true);
    assert.equal(written.data.issue.title, input.title);
    assert.equal(written.data.issue.body, input.body);
    assert.equal(written.data.issue.author, profile.login);
    assert.notEqual(written.data.writeExecutionId, written.data.readExecutionId);
    assert.equal(f.createRequests, 1);
    const replayed = await f.host.handle(request("createTestIssue", { connectionId: connection.id, requestId, input }));
    assert.deepEqual(replayed.data, written.data);
    assert.equal(f.createRequests, 1);
    const denied = await f.captured.runtime.fetch(new Request(`${new URL(f.host.callbackUrl).origin}/v1/actions/github.delete_repository`, {
      method: "POST", headers: { authorization: `Bearer ${f.captured.options.runtimeToken}`, "content-type": "application/json" }, body: JSON.stringify({ input: { owner: "PIGU-PPPgu", repo: "edupi-desktop" } }),
    }));
    assert.equal(denied.ok, false);
    assert.equal(f.createRequests, 1);
    for (const file of ["connect.sqlite", "connect.sqlite-wal"]) {
      const bytes = await readFile(path.join(f.directory, file)).catch(() => Buffer.alloc(0));
      for (const secret of [TOKEN, CLIENT_SECRET, f.captured.options.encryptionKey]) assert.equal(bytes.includes(Buffer.from(secret)), false);
    }
    assert.equal(JSON.stringify(written).includes(TOKEN), false);
    assert.equal(JSON.stringify(started).includes(CLIENT_SECRET), false);
    await f.host.close();
    await f.start();
    const restored = await f.host.handle(request("status", { connectionId: connection.id }));
    assert.equal(restored.data.clientConfigured, true);
    assert.deepEqual(restored.data.connection, connection);
    const afterRestart = await f.host.handle(request("createTestIssue", { connectionId: connection.id, requestId, input }));
    assert.deepEqual(afterRestart.data, written.data);
    assert.equal(f.createRequests, 1, "durable host dispatch record prevents a second POST after restart");
  } finally { await f.close(); }
});

test("callback listener rejects forged state, non-callback routes and cancelled authorization without provider exchange", async () => {
  const f = await fixture();
  try {
    const url = new URL(f.host.callbackUrl);
    url.searchParams.set("state", randomUUID()); url.searchParams.set("code", "fixture-authorization-code");
    assert.equal((await f.originalFetch(url)).status, 400);
    assert.equal((await f.originalFetch(`${url.origin}/v1/actions/github.create_issue`, { method: "POST", body: "{}" })).status, 404);
    assert.equal((await f.originalFetch(`${url.origin}/api/oauth/configs`)).status, 404);
    assert.equal(f.tokenRequests, 0);
    await f.host.handle(request("configure", { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }));
    const started = await f.host.handle(request("startOAuth"));
    const cancelled = await f.host.handle(request("cancelOAuth", { requestId: started.data.requestId }));
    assert.equal(cancelled.data.status, "cancelled");
    const auth = new URL(started.data.authorizationUrl);
    const callback = new URL(f.host.callbackUrl);
    callback.searchParams.set("state", auth.searchParams.get("state")); callback.searchParams.set("code", "fixture-authorization-code");
    assert.equal((await f.originalFetch(callback)).status, 400);
    assert.equal(f.tokenRequests, 0);
  } finally { await f.close(); }
});

test("callback accepts one exact GitHub issuer and rejects malformed issuers before token exchange", async () => {
  const f = await fixture();
  try {
    const { started, callback } = await f.startAuthorization();
    for (const issuer of ["", "https://attacker.invalid/login/oauth", "https://github.com/login/oauth/", "https://github.com/login/oauth#fragment", "https://github.com@attacker.invalid/login/oauth"]) {
      const invalid = new URL(callback);
      invalid.searchParams.set("iss", issuer);
      assert.equal((await f.originalFetch(invalid, { redirect: "manual" })).status, 400);
      assert.equal(f.tokenRequests, 0);
    }
    const duplicate = new URL(callback);
    duplicate.searchParams.append("iss", "https://github.com/login/oauth");
    duplicate.searchParams.append("iss", "https://github.com/login/oauth");
    assert.equal((await f.originalFetch(duplicate, { redirect: "manual" })).status, 400);
    const unexpected = new URL(callback);
    unexpected.searchParams.set("iss", "https://github.com/login/oauth");
    unexpected.searchParams.set("unexpected", "value");
    assert.equal((await f.originalFetch(unexpected, { redirect: "manual" })).status, 400);
    assert.equal(f.tokenRequests, 0);
    callback.searchParams.set("iss", "https://github.com/login/oauth");
    assert.equal((await f.originalFetch(callback, { redirect: "manual" })).status, 303);
    assert.equal(f.tokenRequests, 1, "invalid issuer probes must not consume the legitimate pending state");
    assert.equal((await f.host.handle(request("pollOAuth", { requestId: started.data.requestId }))).data.status, "connected");
    assert.equal((await f.originalFetch(callback, { redirect: "manual" })).status, 400);
    assert.equal(f.tokenRequests, 1);
  } finally { await f.close(); }
});

test("callback remains compatible with GitHub responses without an issuer parameter", async () => {
  const f = await fixture();
  try {
    const { connection } = await f.authorize({ issuer: null });
    assert.equal(connection.authType, "oauth2");
    assert.equal(f.tokenRequests, 1);
  } finally { await f.close(); }
});

test("private or non-writable target is rejected before create_issue and arbitrary requests never reach the runtime", async () => {
  const f = await fixture({ repo: { private: true } });
  try {
    const { connection } = await f.authorize();
    const requestId = randomUUID(), input = fixedGitHubTestInput(requestId);
    const result = await f.host.handle(request("createTestIssue", { connectionId: connection.id, requestId, input }));
    assert.equal(result.data.status, "failed");
    assert.equal(result.data.code, "github_repository_not_allowed");
    assert.equal(f.createRequests, 0);
    const count = f.calls.length;
    for (const bad of [request("execute", { actionId: "github.create_repository" }), request("createTestIssue", { connectionId: connection.id, requestId, input: { ...input, body: "unrelated" } }),
      request("createTestIssue", { connectionId: connection.id, requestId, input, arbitrary: TOKEN })]) {
      assert.equal((await f.host.handle(bad)).code, "invalid_github_request");
    }
    assert.equal(f.calls.length, count);
  } finally { await f.close(); }
});

test("lost write response stays unknown and reconciliation only reads the marked issue", async () => {
  const f = await fixture({ lostResponse: true });
  try {
    const { connection } = await f.authorize();
    const requestId = randomUUID(), input = fixedGitHubTestInput(requestId);
    const result = await f.host.handle(request("createTestIssue", { connectionId: connection.id, requestId, input }));
    assert.equal(result.data.status, "unknown");
    assert.equal(f.createRequests, 1);
    const read = await f.host.handle(request("reconcileIssue", { connectionId: connection.id, requestId, input }));
    assert.equal(read.ok, true, JSON.stringify(read));
    assert.equal(read.data.issue.number, f.issues[0].number);
    assert.equal(read.data.readbackVerified, true);
    assert.equal(read.data.status, "unknown", "a provider write with a lost response cannot claim an audited success");
    assert.equal(f.createRequests, 1);
    const replay = await f.host.handle(request("createTestIssue", { connectionId: connection.id, requestId, input }));
    assert.equal(replay.data.status, "unknown");
    assert.equal(f.createRequests, 1);
  } finally { await f.close(); }
});

test("manual refresh uses the pinned SDK refresh grant, persists rotated credentials and returns only safe metadata", async () => {
  const f = await fixture({ expiring: true });
  try {
    const { connection } = await f.authorize();
    const before = await f.host.handle(request("checkConnection", { connectionId: connection.id }));
    assert.deepEqual(Object.keys(before.data.token).sort(), ["expiresAt", "hasRefreshToken", "refreshedAt"]);
    assert.equal(before.data.token.hasRefreshToken, true); assert.equal(before.data.token.refreshedAt, null);
    const refreshed = await f.host.handle(request("refreshOAuth", { connectionId: connection.id }));
    assert.equal(refreshed.ok, true); assert.equal(f.refreshRequests, 1);
    assert.deepEqual(refreshed.data.connection, connection);
    assert.ok(Date.parse(refreshed.data.token.refreshedAt) > 0);
    assert.ok(Date.parse(refreshed.data.token.expiresAt) > Date.now() + 28000000);
    for (const secret of [TOKEN, REFRESH, CLIENT_SECRET, f.captured.options.encryptionKey]) assert.equal(JSON.stringify(refreshed).includes(secret), false);
    await f.host.close(); await f.start();
    const restored = await f.host.handle(request("checkConnection", { connectionId: connection.id }));
    assert.equal(restored.ok, true); assert.deepEqual(restored.data.token, refreshed.data.token);
    assert.equal(f.refreshRequests, 1, "restart uses the persisted new access token without refreshing again");
    for (const file of ["connect.sqlite", "connect.sqlite-wal"]) {
      const bytes = await readFile(path.join(f.directory, file)).catch(() => Buffer.alloc(0));
      for (const secret of [TOKEN, REFRESH, CLIENT_SECRET]) assert.equal(bytes.includes(Buffer.from(secret)), false);
    }
  } finally { await f.close(); }
});

test("controlled expiry is host-gated and a later read runs the actual SDK automatic refresh path", async () => {
  const f = await fixture({ expiring: true });
  try {
    const { connection } = await f.authorize();
    const count = f.calls.length;
    assert.equal((await f.host.handle(request("expireTokenForAcceptance", { connectionId: connection.id }))).code, "github_acceptance_disabled");
    assert.equal(f.calls.length, count);
    await f.host.close(); f.options.acceptanceEnabled = true; await f.start();
    const expired = await f.host.handle(request("expireTokenForAcceptance", { connectionId: connection.id }));
    assert.equal(expired.ok, true); assert.ok(Date.parse(expired.data.token.expiresAt) < Date.now());
    assert.equal(f.refreshRequests, 0, "changing local expiry does not exchange a token by itself");
    const read = await f.host.handle(request("checkConnection", { connectionId: connection.id }));
    assert.equal(read.ok, true); assert.equal(f.refreshRequests, 1);
    assert.ok(Date.parse(read.data.token.expiresAt) > Date.now());
    assert.ok(read.data.token.refreshedAt);
  } finally { await f.close(); }
  const noRefresh = await fixture({ acceptanceEnabled: true });
  try {
    const { connection } = await noRefresh.authorize();
    assert.equal((await noRefresh.host.handle(request("expireTokenForAcceptance", { connectionId: connection.id }))).code, "github_refresh_token_required");
    assert.equal((await noRefresh.host.handle(request("refreshOAuth", { connectionId: connection.id }))).code, "github_refresh_token_required");
  } finally { await noRefresh.close(); }
});

test("network failure and revoked refresh are distinct, and neither discards usable credentials", async () => {
  const f = await fixture({ expiring: true });
  try {
    const { connection } = await f.authorize();
    f.options.offline = true;
    assert.equal((await f.host.handle(request("checkConnection", { connectionId: connection.id }))).code, "github_connection_offline");
    assert.equal((await f.host.handle(request("refreshOAuth", { connectionId: connection.id }))).code, "github_connection_offline");
    f.options.offline = false; f.options.refreshRejected = true;
    assert.equal((await f.host.handle(request("refreshOAuth", { connectionId: connection.id }))).code, "github_authorization_required");
    assert.equal((await f.host.handle(request("checkConnection", { connectionId: connection.id }))).ok, true);
    f.options.accessRejected = true;
    assert.equal((await f.host.handle(request("checkConnection", { connectionId: connection.id }))).code, "github_authorization_required");
    f.options.accessRejected = false;
    f.options.refreshRejected = false;
    f.options.refreshResponse = () => Response.json({ error: "bad_refresh_token" }, { status: 503 });
    assert.equal((await f.host.handle(request("refreshOAuth", { connectionId: connection.id }))).code, "github_connection_offline", "a transient HTTP status takes precedence over credential-like response text");
    f.options.refreshResponse = undefined;
    assert.equal((await f.host.handle(request("refreshOAuth", { connectionId: connection.id }))).ok, true);
  } finally { await f.close(); }
});

for (const scenario of [
  { name: "429 temporarily_unavailable", response: () => Response.json({ error: "temporarily_unavailable" }, { status: 429 }) },
  { name: "503 empty response", response: () => new Response(null, { status: 503 }) },
  { name: "unrecognized successful response", response: () => new Response("proxy response without token fields", { status: 200 }) },
]) test(`SDK refresh ${scenario.name} remains retryable through manual and automatic refresh`, async () => {
  const f = await fixture({ expiring: true, acceptanceEnabled: true });
  try {
    const { connection } = await f.authorize();
    f.options.refreshResponse = scenario.response;
    const manual = await f.host.handle(request("refreshOAuth", { connectionId: connection.id }));
    assert.equal(manual.code, "github_connection_offline");
    assert.equal((await f.host.handle(request("expireTokenForAcceptance", { connectionId: connection.id }))).ok, true);
    const automatic = await f.host.handle(request("checkConnection", { connectionId: connection.id }));
    assert.equal(automatic.code, "github_connection_offline"); assert.equal(f.refreshRequests, 2);
    for (const secret of [TOKEN, REFRESH, CLIENT_SECRET]) assert.equal(JSON.stringify([manual, automatic]).includes(secret), false);
    f.options.refreshResponse = undefined;
    const recovered = await f.host.handle(request("checkConnection", { connectionId: connection.id }));
    assert.equal(recovered.ok, true); assert.equal(f.refreshRequests, 3);
    assert.deepEqual(recovered.data.connection, connection); assert.equal(f.createRequests, 0);
  } finally { await f.close(); }
});

test("by-id reconnect updates one connection and a different account is refused", async () => {
  const f = await fixture({ expiring: true });
  try {
    const { connection } = await f.authorize();
    const { started, callback } = await f.startAuthorization(connection.id);
    assert.equal((await f.originalFetch(callback, { redirect: "manual" })).status, 303);
    const result = await f.host.handle(request("pollOAuth", { requestId: started.data.requestId }));
    assert.equal(result.ok, true); assert.deepEqual(result.data.connection, connection);
    const response = await f.captured.runtime.fetch(new Request(`${new URL(f.host.callbackUrl).origin}/v1/connections`, { headers: { authorization: `Bearer ${f.captured.options.adminToken}` } }));
    assert.equal((await response.json()).data.length, 1);
    f.options.profile = { ...profile, id: 12345, login: "another-account", html_url: "https://github.com/another-account" };
    assert.equal((await f.host.handle(request("checkConnection", { connectionId: connection.id }))).code, "github_account_changed");
  } finally { await f.close(); }
});

test("a wrong-account code callback is rejected before replacing a good connection and its issue remains readable", async () => {
  const f = await fixture({ expiring: true });
  try {
    const { connection } = await f.authorize();
    const requestId = randomUUID(), input = fixedGitHubTestInput(requestId);
    const written = await f.host.handle(request("createTestIssue", { connectionId: connection.id, requestId, input }));
    assert.equal(written.data.status, "succeeded");
    const { DatabaseSync } = await import("node:sqlite");
    const revision = () => {
      const database = new DatabaseSync(path.join(f.directory, "connect.sqlite"), { readOnly: true });
      try { return database.prepare("select revision from connections where id = ?").get(connection.id).revision; }
      finally { database.close(); }
    };
    const originalRevision = revision();
    for (const wrong of [
      { ...profile, login: "another-account", id: 12345, html_url: "https://github.com/another-account" },
      { ...profile, id: profile.id + 1 },
    ]) {
      const { started, callback } = await f.startAuthorization(connection.id);
      f.options.authorizationToken = `${TOKEN}-wrong-account-${wrong.id}`;
      f.options.authorizationProfile = wrong;
      assert.equal((await f.originalFetch(callback, { redirect: "manual" })).status, 400);
      const polled = await f.host.handle(request("pollOAuth", { requestId: started.data.requestId }));
      assert.equal(polled.data.status, "failed"); assert.equal(polled.data.code, "github_account_changed");
      assert.equal(revision(), originalRevision, "the SDK must not commit the rejected credential");
      assert.equal(JSON.stringify(polled).includes(f.options.authorizationToken), false);
      const count = f.tokenRequests;
      assert.equal((await f.originalFetch(callback, { redirect: "manual" })).status, 400);
      assert.equal(f.tokenRequests, count, "the rejected callback cannot exchange its code a second time");
    }
    const read = await f.host.handle(request("reconcileIssue", { connectionId: connection.id, requestId, input, issueNumber: written.data.issue.number }));
    assert.equal(read.ok, true); assert.equal(read.data.status, "succeeded");
    assert.deepEqual(read.data.issue, written.data.issue); assert.equal(read.data.writeExecutionId, written.data.writeExecutionId);
    const replay = await f.host.handle(request("createTestIssue", { connectionId: connection.id, requestId, input }));
    assert.equal(replay.data.writeExecutionId, written.data.writeExecutionId); assert.equal(f.createRequests, 1);
  } finally { await f.close(); }
});

test("initial authorization also refuses an unexpected account before storing any connection", async () => {
  const f = await fixture({ expiring: true, authorizationToken: `${TOKEN}-wrong-first-account`,
    authorizationProfile: { ...profile, login: "another-account", id: 12345, html_url: "https://github.com/another-account" } });
  try {
    const { started, callback } = await f.startAuthorization();
    assert.equal((await f.originalFetch(callback, { redirect: "manual" })).status, 400);
    const polled = await f.host.handle(request("pollOAuth", { requestId: started.data.requestId }));
    assert.equal(polled.data.status, "failed"); assert.equal(polled.data.code, "github_account_changed");
    const response = await f.captured.runtime.fetch(new Request(`${new URL(f.host.callbackUrl).origin}/v1/connections`, { headers: { authorization: `Bearer ${f.captured.options.adminToken}` } }));
    assert.deepEqual((await response.json()).data, []);
    assert.equal((await f.originalFetch(callback, { redirect: "manual" })).status, 400); assert.equal(f.tokenRequests, 1);
  } finally { await f.close(); }
});

test("refresh CAS refuses a concurrent credential replacement without returning token material", async () => {
  const f = await fixture({ expiring: true });
  try {
    const { connection } = await f.authorize();
    f.options.beforeRefreshResponse = async () => {
      const { DatabaseSync } = await import("node:sqlite");
      const database = new DatabaseSync(path.join(f.directory, "connect.sqlite"));
      try { database.prepare("update connections set revision = ? where id = ?").run(randomUUID(), connection.id); }
      finally { database.close(); }
    };
    const result = await f.host.handle(request("refreshOAuth", { connectionId: connection.id }));
    assert.equal(result.code, "github_connection_changed"); assert.equal(f.refreshRequests, 1);
    for (const secret of [TOKEN, REFRESH, CLIENT_SECRET]) assert.equal(JSON.stringify(result).includes(secret), false);
  } finally { await f.close(); }
});
