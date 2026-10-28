import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { configureVerificationNetwork, isVerificationNetwork, runGitHubVerification } from "./open-connector-verification-host.mjs";

const credential = "test-credential-not-a-real-github-token";
const adminToken = "test-admin-token";
const runtimeToken = "test-runtime-token";
const connectionId = randomUUID();
const alias = randomUUID();
const executionId = randomUUID();
const profile = { login: "example-user", id: 123, html_url: "https://github.com/example-user", public_repos: 3, email: "must-not-return@example.test", plan: { name: "must-not-return" } };
const connection = { id: connectionId, alias, service: "github", status: "active", providerAccountId: profile.login };

function fixture(overrides = {}) {
  const calls = [];
  const runtime = {
    async fetch(request) {
      const url = new URL(request.url);
      const body = request.method === "POST" ? await request.json() : undefined;
      calls.push({ path: url.pathname, method: request.method, body, headers: Object.fromEntries(request.headers) });
      if (url.pathname === "/v1/connections/github/connect/api-key") return Response.json(overrides.connection ?? { success: true, data: connection }, { status: overrides.connectionStatus ?? 200 });
      if (url.pathname === "/v1/actions/github.get_current_user") {
        if (overrides.actionThrows) throw new Error("sensitive upstream body");
        return Response.json(overrides.action ?? { success: true, data: profile, meta: { actionId: "github.get_current_user", executionId, auditPersisted: true } }, { status: overrides.actionStatus ?? 200 });
      }
      if (url.pathname === `/api/runs/${executionId}`) return Response.json(overrides.audit ?? { id: executionId, service: "github", actionId: "github.get_current_user", connectionId, ok: true });
      throw new Error(`Unexpected URL ${url.pathname}`);
    },
  };
  return { calls, runtime };
}

function request(op, extra = {}) {
  return { id: randomUUID(), op, credential, ...(op === "verify" ? { requestId: randomUUID(), expectedAccountId: profile.login } : {}), ...extra };
}

test("connect validates GitHub through official management endpoint and returns only account identity", async () => {
  const { runtime, calls } = fixture();
  const result = await runGitHubVerification(runtime, request("connect"), { adminToken, runtimeToken });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.account, { login: profile.login, accountId: profile.login, htmlUrl: profile.html_url });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.authorization, `Bearer ${adminToken}`);
  assert.deepEqual(calls[0].body, { apiKey: credential });
  assert.equal(JSON.stringify(result).includes(credential), false);
});

test("verify dispatches only fixed empty-input read, then independently reads matching audit", async () => {
  const { runtime, calls } = fixture();
  const input = request("verify");
  const result = await runGitHubVerification(runtime, input, { adminToken, runtimeToken });
  assert.equal(result.ok, true);
  assert.equal(result.data.status, "succeeded");
  assert.equal(result.data.auditPersisted, true);
  assert.equal(result.data.executionId, executionId);
  assert.deepEqual(result.data.profile, { login: profile.login, id: profile.id, htmlUrl: profile.html_url, publicRepos: 3 });
  assert.deepEqual(calls.map((item) => item.path), ["/v1/connections/github/connect/api-key", "/v1/actions/github.get_current_user", `/api/runs/${executionId}`]);
  assert.equal(calls[1].headers.authorization, `Bearer ${runtimeToken}`);
  assert.equal(calls[1].headers["idempotency-key"], input.requestId);
  assert.equal(calls[1].headers["x-oo-connector-alias"], alias);
  assert.deepEqual(calls[1].body, { input: {} });
  assert.doesNotMatch(JSON.stringify(result), /email|plan|sensitive|credential|token/u);
});

test("auth failure and changed account stop before Action dispatch", async () => {
  const rejected = fixture({ connection: { success: false, error: { message: credential } }, connectionStatus: 401 });
  const failure = await runGitHubVerification(rejected.runtime, request("verify"), { adminToken, runtimeToken });
  assert.equal(failure.code, "github_authorization_failed");
  assert.equal(rejected.calls.length, 1);
  assert.equal(JSON.stringify(failure).includes(credential), false);
  const changed = fixture();
  const result = await runGitHubVerification(changed.runtime, request("verify", { expectedAccountId: "different-user" }), { adminToken, runtimeToken });
  assert.equal(result.code, "github_account_changed");
  assert.equal(changed.calls.length, 1);
});

test("audit mismatch or lost response becomes unknown without automatic resend", async () => {
  const mismatch = fixture({ audit: { id: executionId, service: "github", actionId: "github.get_current_user", connectionId: randomUUID(), ok: true } });
  const result = await runGitHubVerification(mismatch.runtime, request("verify"), { adminToken, runtimeToken });
  assert.equal(result.data.status, "unknown");
  assert.equal(result.data.auditPersisted, false);
  assert.equal(mismatch.calls.filter((item) => item.path.startsWith("/v1/actions")).length, 1);
  const lost = fixture({ actionThrows: true });
  const unknown = await runGitHubVerification(lost.runtime, request("verify"), { adminToken, runtimeToken });
  assert.equal(unknown.data.status, "unknown");
  assert.equal(lost.calls.length, 2);
});

test("unknown operations, arbitrary actions, and caller input are rejected without any request", async () => {
  for (const input of [request("execute"), request("verify", { actionId: "github.create_repository" }), request("verify", { input: { name: "not-allowed" } }), request("connect", { url: "https://attacker.example" })]) {
    const { runtime, calls } = fixture();
    const result = await runGitHubVerification(runtime, input, { adminToken, runtimeToken });
    assert.equal(result.ok, false);
    assert.equal(result.code, "invalid_verification_request");
    assert.equal(calls.length, 0);
  }
});

test("host network accepts only bounded credential-free local HTTP proxies", async () => {
  const network = { httpProxy: "http://127.0.0.1:7897", httpsProxy: "http://localhost:7897", noProxy: "localhost,127.0.0.1" };
  assert.equal(isVerificationNetwork(network), true);
  assert.equal(isVerificationNetwork({ ...network, httpsProxy: "http://127.0.0.1:80" }), true);
  assert.equal(isVerificationNetwork({ ...network, httpsProxy: "http://127.0.0.1" }), true);
  for (const bad of [{ ...network, httpsProxy: "http://user:secret@127.0.0.1:7897" }, { ...network, httpsProxy: "http://remote.example:7897" },
    { ...network, httpsProxy: "http://127.0.0.1:7897/path" }, { ...network, noProxy: "x".repeat(2049) },
    { ...network, noProxy: "localhost\nsecret" }, { ...network, arbitrary: "not-allowed" }]) {
    assert.equal(isVerificationNetwork(bad), false);
    const { runtime, calls } = fixture();
    const result = await runGitHubVerification(runtime, request("connect", { network: bad }), { adminToken, runtimeToken });
    assert.equal(result.code, "invalid_verification_request");
    assert.equal(calls.length, 0);
  }
});

test("fixed packaged runtime actually authenticates, executes and audits against a hermetic provider fetch", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    assert.equal(request.url, "https://api.github.com/user");
    assert.equal(request.method, "GET");
    assert.equal(request.headers.get("authorization"), `Bearer ${credential}`);
    calls.push(request.url);
    return Response.json(profile);
  };
  const dir = await mkdtemp(path.join(tmpdir(), "edupi-github-runtime-test-"));
  let runtime;
  try {
    const { createConnectorRuntime } = await import("@oomol-lab/open-connector");
    runtime = await createConnectorRuntime({
      dataDir: dir, publicOrigin: "http://127.0.0.1:32999", encryptionKey: "hermetic-test-key-not-production", adminToken, runtimeToken,
      actionPolicy: { allowedActions: ["github.get_current_user"], blockedProxies: ["*"] },
      network: { trustedHosts: ["api.github.com"] },
    });
    const connect = await runGitHubVerification(runtime, request("connect"), { adminToken, runtimeToken });
    assert.equal(connect.ok, true);
    assert.equal(connect.data.account.accountId, profile.login);
    const verified = await runGitHubVerification(runtime, request("verify"), { adminToken, runtimeToken });
    assert.equal(verified.data.status, "succeeded");
    assert.equal(verified.data.auditPersisted, true);
    assert.equal(verified.data.profile.id, 123);
    assert.equal(calls.length, 3);
    for (const filename of ["connect.sqlite", "connect.sqlite-wal"]) {
      const bytes = await readFile(path.join(dir, filename)).catch(() => Buffer.alloc(0));
      assert.equal(bytes.includes(Buffer.from(credential)), false, `${filename} must not retain plaintext credentials`);
    }
    const denied = await runtime.fetch(new Request("http://127.0.0.1:32999/v1/actions/github.create_repository", {
      method: "POST", headers: { authorization: `Bearer ${runtimeToken}`, "content-type": "application/json" }, body: JSON.stringify({ input: { name: "forbidden" } }),
    }));
    assert.equal(denied.ok, false);
    assert.equal(calls.length, 3);
  } finally {
    if (runtime) await runtime.close();
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("isolated runtime provider egress uses the configured proxy and closes its dispatcher", async () => {
  const { getGlobalDispatcher } = await import("undici");
  const originalDispatcher = getGlobalDispatcher();
  const originalFetch = globalThis.fetch;
  const targets = [];
  const sockets = new Set();
  const proxy = http.createServer((_request, response) => { response.writeHead(502); response.end(); });
  proxy.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  proxy.on("connect", (incoming, socket) => {
    targets.push(incoming.url);
    socket.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
  });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const dir = await mkdtemp(path.join(tmpdir(), "edupi-github-proxy-test-"));
  const closeNetwork = await configureVerificationNetwork({ httpsProxy: `http://127.0.0.1:${proxy.address().port}`, noProxy: "localhost,127.0.0.1" });
  const agent = getGlobalDispatcher();
  let runtime;
  try {
    const { createConnectorRuntime } = await import("@oomol-lab/open-connector");
    runtime = await createConnectorRuntime({
      dataDir: dir, publicOrigin: "http://127.0.0.1:32999", encryptionKey: "proxy-hermetic-test-key", adminToken, runtimeToken,
      actionPolicy: { allowedActions: ["github.get_current_user"], blockedProxies: ["*"] }, network: { trustedHosts: ["api.github.com"] },
    });
    const result = await runGitHubVerification(runtime, request("connect"), { adminToken, runtimeToken }, { signal: AbortSignal.timeout(2000) });
    assert.equal(result.ok, false);
    assert.deepEqual(targets, ["api.github.com:443"]);
  } finally {
    if (runtime) await runtime.close();
    await closeNetwork();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => proxy.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
  assert.equal(getGlobalDispatcher(), originalDispatcher);
  assert.equal(globalThis.fetch, originalFetch);
  await assert.rejects(agent.request({ origin: "http://closed-dispatcher.invalid", path: "/", method: "GET" }), { code: "UND_ERR_DESTROYED" });
});
