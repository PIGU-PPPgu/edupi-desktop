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
  globalThis.fetch = async (input, init) => {
    const incoming = input instanceof Request ? input : new Request(input, init);
    const url = new URL(incoming.url);
    calls.push({ method: incoming.method, pathname: url.pathname });
    if (incoming.url === "https://github.com/login/oauth/access_token") {
      tokenRequests += 1;
      const text = await incoming.text();
      const body = incoming.headers.get("content-type")?.includes("json") ? JSON.parse(text) : Object.fromEntries(new URLSearchParams(text));
      assert.equal(body.client_id, CLIENT_ID);
      assert.equal(body.client_secret, CLIENT_SECRET);
      assert.equal(body.code, "fixture-authorization-code");
      assert.equal(body.redirect_uri, host.callbackUrl);
      assert.match(body.code_verifier, /^[A-Za-z0-9._~-]{43,128}$/u);
      assert.equal(createHash("sha256").update(body.code_verifier).digest("base64url"), authorization.searchParams.get("code_challenge"));
      return Response.json({ access_token: TOKEN, token_type: "bearer", scope: "public_repo" });
    }
    assert.equal(url.origin, "https://api.github.com", "all provider calls must stay on the fixed GitHub API");
    assert.equal(incoming.headers.get("authorization"), `Bearer ${TOKEN}`);
    const headers = { "x-oauth-scopes": "public_repo" };
    if (url.pathname === "/user" && incoming.method === "GET") return Response.json(profile, { headers });
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
    host = await createGitHubOAuthHost({ dataDir: directory, encryptionKey, runtimeFactory: async (runtimeOptions) => {
      const runtime = await createConnectorRuntime(runtimeOptions);
      captured = { runtime, options: runtimeOptions };
      return runtime;
    } });
  }
  async function authorize() {
    const configured = await host.handle(request("configure", { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }));
    assert.deepEqual(configured.data, { clientConfigured: true });
    const started = await host.handle(request("startOAuth"));
    assert.equal(started.ok, true);
    authorization = new URL(started.data.authorizationUrl);
    const callback = new URL(host.callbackUrl);
    callback.searchParams.set("state", authorization.searchParams.get("state"));
    callback.searchParams.set("code", "fixture-authorization-code");
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
    directory, originalFetch, calls, issues, start, authorize,
    get host() { return host; }, get captured() { return captured; },
    get tokenRequests() { return tokenRequests; }, get createRequests() { return createRequests; },
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
    assert.equal(authorization.searchParams.get("scope"), "public_repo");
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
