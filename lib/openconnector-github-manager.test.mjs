import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm, copyFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const manager = await createJiti(import.meta.url).import("./openconnector-github-manager.ts");
const CLIENT_SECRET = "fixture-oauth-client-secret-123456";
const KEY = "f".repeat(64);

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "edupi-github-oauth-manager-"));
  const assets = path.join(root, "assets"), stateDir = path.join(root, "state");
  await mkdir(assets); await writeFile(path.join(assets, "github-host.mjs"), "// fixture");
  const calls = [], connection = { id: randomUUID(), accountId: "59789742", login: "PIGU-PPPgu", scopes: ["public_repo"], authType: "oauth2" };
  let configured = false, authorized = false, oauthRequest = randomUUID(), writes = 0, mode = "success", gate = null, releaseGate;
  let savedInput, writeExecutionId, readExecutionId;
  let keyReads = 0, hostStarts = 0;
  const networks = [], gates = [];
  let token = { hasRefreshToken: true, expiresAt: new Date(Date.now() + 28800000).toISOString(), refreshedAt: null };
  const stateFile = path.join(stateDir, "openconnector-github", "state.json");
  const fake = {
    callbackUrl: "http://127.0.0.1:34567/oauth/callback",
    close: async () => {},
    async request(op) {
      calls.push(op);
      if (op.op === "configure") { configured = true; return { clientConfigured: true, clientSecret: CLIENT_SECRET }; }
      if (op.op === "status") return { clientConfigured: configured, connection: authorized ? { ...connection } : null };
      if (["checkConnection", "refreshOAuth", "expireTokenForAcceptance", "reconcileIssue"].includes(op.op) && mode === "offline") throw new manager.GitHubManagerError("github_connection_offline");
      if (op.op === "reconcileIssue" && mode === "readOffline") throw new manager.GitHubManagerError("github_connection_offline");
      if (op.op === "refreshOAuth" && mode === "revoked") throw new manager.GitHubManagerError("github_authorization_required");
      if (op.op === "refreshOAuth") token = { ...token, refreshedAt: new Date().toISOString() };
      if (op.op === "expireTokenForAcceptance") token = { ...token, expiresAt: new Date(Date.now() - 60000).toISOString() };
      if (["checkConnection", "refreshOAuth", "expireTokenForAcceptance"].includes(op.op)) return { connection: authorized ? { ...connection } : null, token };
      if (op.op === "startOAuth") return { requestId: oauthRequest, authorizationUrl: "https://github.com/login/oauth/authorize?client_id=" + "a".repeat(20) + "&state=fixture", expiresAt: new Date(Date.now() + 600000).toISOString() };
      if (op.op === "cancelOAuth") return { status: "cancelled" };
      if (op.op === "pollOAuth" && mode === "accountRejected") throw new manager.GitHubManagerError("github_account_changed");
      if (op.op === "pollOAuth" && mode === "callbackFailed") return { status: "failed", code: "github_connection_offline" };
      if (op.op === "pollOAuth") { authorized = true; return { status: "connected", connection: { ...connection }, token }; }
      if (op.op === "createTestIssue") {
        writes += 1; savedInput = op.input;
        const persisted = JSON.parse(await readFile(stateFile, "utf8"));
        assert.equal(persisted.receipt.status, "pending", "pending is on disk before dispatch");
        if (gate) await gate;
        if (mode === "unknown") throw new Error("fixture connection interrupted");
        writeExecutionId = randomUUID(); readExecutionId = randomUUID();
        return result();
      }
      if (op.op === "reconcileIssue") {
        if (mode === "readMismatch") return { status: "unknown", auditPersisted: false, readbackVerified: false, code: "github_issue_mismatch" };
        readExecutionId = randomUUID(); writeExecutionId ||= randomUUID(); return result();
      }
      throw Error("unexpected fixture operation");
    },
  };
  function result() { return { status: "succeeded", issue: { number: 123, url: "https://github.com/PIGU-PPPgu/edupi-desktop/issues/123", title: savedInput.title, body: savedInput.body, state: "open", author: "PIGU-PPPgu" }, writeExecutionId, readExecutionId, auditPersisted: true, readbackVerified: true }; }
  const options = { stateDir, root: assets, platform: "darwin", proxyEnv: {}, readSystemProxy: async () => undefined,
    getEncryptionKey: async () => { keyReads += 1; return KEY; }, hostFactory: async (_dir, key, network, gate) => { hostStarts += 1; networks.push(network); gates.push(gate); assert.equal(key, KEY); return fake; } };
  const run = (op) => manager.runGitHubOAuthOperation(op, options);
  async function authorize() { await run({ op: "configureOAuth", clientId: "a".repeat(20), clientSecret: CLIENT_SECRET }); await run({ op: "startOAuth" }); return run({ op: "pollOAuth", requestId: oauthRequest }); }
  return { root, stateDir, stateFile, options, connection, calls, run, authorize, networks, gates, writes: () => writes, keyReads: () => keyReads, hostStarts: () => hostStarts,
    setMode: (value) => { mode = value; }, block: () => { gate = new Promise((resolve) => { releaseGate = resolve; }); }, unblock: () => releaseGate(),
    cleanup: async () => { await manager.closeGitHubOAuthHost(stateDir); await rm(root, { recursive: true, force: true }); } };
}

test("real authorization precedes a server-owned draft and one persisted dispatch; replays only read", async () => {
  const t = await setup();
  try {
    await assert.rejects(t.run({ op: "prepareTestIssue" }), /github_oauth_connection_required/);
    const connected = await t.authorize();
    assert.equal(connected.connection.authType, "oauth2");
    const draft = (await t.run({ op: "prepareTestIssue" })).draft;
    assert.equal(t.writes(), 0);
    const result = await t.run({ op: "createTestIssue", draftId: draft.id });
    assert.equal(result.receipt.status, "succeeded"); assert.equal(result.receipt.readbackVerified, true);
    assert.equal(t.writes(), 1);
    assert.equal((await t.run({ op: "createTestIssue", draftId: draft.id })).receipt.id, result.receipt.id);
    assert.equal(t.writes(), 1);
    assert.equal((await t.run({ op: "prepareTestIssue" })).draft.id, draft.id);
    const raw = await readFile(t.stateFile, "utf8");
    assert.equal(raw.includes(CLIENT_SECRET), false); assert.equal(raw.includes(KEY), false);
    assert.equal(JSON.stringify(result).includes(CLIENT_SECRET), false);
    await manager.closeGitHubOAuthHost(t.stateDir);
    const restored = await manager.readGitHubOAuthStatus(t.options);
    assert.equal(restored.receipt.writeExecutionId, result.receipt.writeExecutionId);
    assert.equal(t.writes(), 1);
    const readback = await t.run({ op: "readIssue", receiptId: result.receipt.id });
    assert.equal(readback.receipt.status, "succeeded"); assert.equal(t.writes(), 1);
  } finally { await t.cleanup(); }
});

test("local GET reads legacy durable receipts without touching a host, network or Keychain", async () => {
  const t = await setup();
  try {
    const initial = await manager.readGitHubOAuthStatus(t.options);
    assert.equal(initial.callbackUrl, null); assert.equal(initial.health.status, "unknown");
    assert.equal(t.keyReads(), 0); assert.equal(t.hostStarts(), 0);
    await t.authorize(); const draft = (await t.run({ op: "prepareTestIssue" })).draft;
    const written = await t.run({ op: "createTestIssue", draftId: draft.id });
    const raw = JSON.parse(await readFile(t.stateFile, "utf8")); delete raw.token; delete raw.health;
    await writeFile(t.stateFile, JSON.stringify(raw));
    await manager.closeGitHubOAuthHost(t.stateDir); t.setMode("offline");
    const keyReads = t.keyReads(), hostStarts = t.hostStarts(), calls = t.calls.length;
    const restored = await manager.readGitHubOAuthStatus(t.options);
    assert.deepEqual(restored.receipt, written.receipt); assert.equal(restored.health.status, "unknown");
    assert.deepEqual(restored.token, { hasRefreshToken: false, expiresAt: null, refreshedAt: null });
    assert.equal(t.keyReads(), keyReads); assert.equal(t.hostStarts(), hostStarts); assert.equal(t.calls.length, calls);
  } finally { await t.cleanup(); }
});

test("offline checks, reads and refreshes retain historical success and recover without repeating a write", async () => {
  const t = await setup();
  try {
    await t.authorize(); const draft = (await t.run({ op: "prepareTestIssue" })).draft;
    const written = await t.run({ op: "createTestIssue", draftId: draft.id });
    for (const operation of [{ op: "checkConnection" }, { op: "refreshOAuth" }, { op: "readIssue", receiptId: written.receipt.id }]) {
      t.setMode("offline");
      await assert.rejects(t.run(operation), /github_connection_offline/);
      const offline = await manager.readGitHubOAuthStatus(t.options);
      assert.equal(offline.health.status, "offline"); assert.deepEqual(offline.receipt, written.receipt);
    }
    t.setMode("readOffline");
    await assert.rejects(t.run({ op: "readIssue", receiptId: written.receipt.id }), /github_connection_offline/);
    assert.deepEqual((await manager.readGitHubOAuthStatus(t.options)).receipt, written.receipt);
    t.setMode("readMismatch");
    await assert.rejects(t.run({ op: "readIssue", receiptId: written.receipt.id }), /github_issue_mismatch/);
    assert.deepEqual((await manager.readGitHubOAuthStatus(t.options)).receipt, written.receipt);
    t.setMode("revoked"); await assert.rejects(t.run({ op: "refreshOAuth" }), /github_authorization_required/);
    assert.equal((await manager.readGitHubOAuthStatus(t.options)).health.status, "authorization_required");
    t.setMode("success");
    const refreshed = await t.run({ op: "refreshOAuth" });
    assert.equal(refreshed.health.status, "ready"); assert.ok(refreshed.token.refreshedAt);
    assert.deepEqual(refreshed.receipt, written.receipt);
    await manager.closeGitHubOAuthHost(t.stateDir); t.setMode("offline");
    const count = t.calls.length;
    const replay = await t.run({ op: "createTestIssue", draftId: draft.id });
    assert.deepEqual(replay.receipt, written.receipt); assert.equal(t.calls.length, count);
    await assert.rejects(t.run({ op: "createTestIssue", draftId: randomUUID() }), /github_request_conflict/);
    assert.equal(t.writes(), 1);
    t.setMode("success"); assert.equal((await t.run({ op: "checkConnection" })).health.status, "ready");
  } finally { await t.cleanup(); }
});

test("reauthorization preserves the original connection, draft and receipt and rejects account changes", async () => {
  const t = await setup();
  try {
    await t.authorize(); const draft = (await t.run({ op: "prepareTestIssue" })).draft;
    const written = await t.run({ op: "createTestIssue", draftId: draft.id });
    const pending = await t.run({ op: "startOAuth" });
    assert.deepEqual(pending.receipt, written.receipt); assert.deepEqual(pending.draft, written.draft);
    assert.equal(t.calls.at(-1).connectionId, written.connection.id);
    assert.equal(t.calls.at(-1).expectedAccountId, written.connection.accountId);
    const recovered = await t.run({ op: "pollOAuth", requestId: pending.authorization.requestId });
    assert.equal(recovered.connection.id, written.connection.id); assert.deepEqual(recovered.receipt, written.receipt);
    const changed = await t.run({ op: "startOAuth" }); t.connection.accountId = "12345678";
    await assert.rejects(t.run({ op: "pollOAuth", requestId: changed.authorization.requestId }), /github_connection_changed/);
    const refused = await manager.readGitHubOAuthStatus(t.options);
    assert.deepEqual(refused.connection, written.connection); assert.deepEqual(refused.receipt, written.receipt);
    assert.equal(refused.authorization.status, "failed"); assert.equal(refused.health.status, "authorization_required");
    t.connection.accountId = "59789742";
    const rejected = await t.run({ op: "startOAuth" }); t.setMode("accountRejected");
    await assert.rejects(t.run({ op: "pollOAuth", requestId: rejected.authorization.requestId }), /github_account_changed/);
    assert.equal((await manager.readGitHubOAuthStatus(t.options)).authorization.status, "failed");
    const interrupted = await t.run({ op: "startOAuth" }); t.setMode("callbackFailed");
    const offline = await t.run({ op: "pollOAuth", requestId: interrupted.authorization.requestId });
    assert.equal(offline.authorization.status, "failed"); assert.equal(offline.health.status, "offline");
    assert.deepEqual(offline.receipt, written.receipt); assert.deepEqual(offline.connection, written.connection);
    assert.equal(t.writes(), 1);
  } finally { await t.cleanup(); }
});

test("acceptance expiry requires the exact server environment gate and forwards it only at host initialization", async () => {
  const t = await setup(), previous = process.env.EDUPI_OPENCONNECTOR_GITHUB_ACCEPTANCE;
  try {
    for (const value of [undefined, "true", "0"]) {
      if (value === undefined) delete process.env.EDUPI_OPENCONNECTOR_GITHUB_ACCEPTANCE; else process.env.EDUPI_OPENCONNECTOR_GITHUB_ACCEPTANCE = value;
      await assert.rejects(t.run({ op: "expireTokenForAcceptance" }), /github_acceptance_disabled/);
      assert.equal(t.hostStarts(), 0);
    }
    process.env.EDUPI_OPENCONNECTOR_GITHUB_ACCEPTANCE = "1";
    await t.authorize(); assert.equal(t.gates[0], true);
    const expired = await t.run({ op: "expireTokenForAcceptance" });
    assert.ok(Date.parse(expired.token.expiresAt) < Date.now()); assert.equal(expired.diagnostics.acceptanceEnabled, true);
    delete process.env.EDUPI_OPENCONNECTOR_GITHUB_ACCEPTANCE;
    await assert.rejects(t.run({ op: "expireTokenForAcceptance" }), /github_acceptance_disabled/);
    assert.equal((await manager.readGitHubOAuthStatus(t.options)).diagnostics.acceptanceEnabled, false);
  } finally {
    if (previous === undefined) delete process.env.EDUPI_OPENCONNECTOR_GITHUB_ACCEPTANCE; else process.env.EDUPI_OPENCONNECTOR_GITHUB_ACCEPTANCE = previous;
    await t.cleanup();
  }
});

test("GitHub-only proxy override accepts fixed loopback HTTP endpoints and rejects malformed or remote proxies before Keychain", async () => {
  const t = await setup();
  try {
    for (const value of ["", "https://127.0.0.1:9000", "http://example.com:9000", "http://user:password@127.0.0.1:9000", "http://127.0.0.1:9000/path", "http://127.0.0.1:9000/?x=1", "http://127.0.0.1:9000/#x", "http://127.0.0.1:0", "http://127.0.0.1:9000\n"]) {
      t.options.proxyEnv = { EDUPI_OPENCONNECTOR_GITHUB_PROXY: value };
      await assert.rejects(t.run({ op: "configureOAuth", clientId: "a".repeat(20), clientSecret: CLIENT_SECRET }), /github_proxy_unsupported/);
    }
    assert.equal(t.keyReads(), 0); assert.equal(t.hostStarts(), 0);
    t.options.proxyEnv = { EDUPI_OPENCONNECTOR_GITHUB_PROXY: "http://127.0.0.1:9000", HTTPS_PROXY: "http://remote.invalid:8888" };
    await t.authorize();
    assert.deepEqual(t.networks[0], { httpProxy: "http://127.0.0.1:9000", httpsProxy: "http://127.0.0.1:9000", noProxy: "localhost,127.0.0.1,::1,[::1]" });
  } finally { await t.cleanup(); }
});

test("cancelled OAuth and preview do not dispatch writes", async () => {
  const t = await setup();
  try {
    await t.run({ op: "configureOAuth", clientId: "a".repeat(20), clientSecret: CLIENT_SECRET });
    const pending = await t.run({ op: "startOAuth" });
    const cancelled = await t.run({ op: "cancelOAuth", requestId: pending.authorization.requestId });
    assert.equal(cancelled.authorization.status, "cancelled");
    assert.equal((await t.run({ op: "pollOAuth", requestId: pending.authorization.requestId })).connection, null);
    assert.equal(t.writes(), 0);
  } finally { await t.cleanup(); }
});

test("an interrupted write is unknown across restart and is never posted again, only reconciled", async () => {
  const t = await setup();
  try {
    await t.authorize();
    const draft = (await t.run({ op: "prepareTestIssue" })).draft;
    t.setMode("unknown");
    const first = await t.run({ op: "createTestIssue", draftId: draft.id });
    assert.equal(first.receipt.status, "unknown"); assert.equal(t.writes(), 1);
    await manager.closeGitHubOAuthHost(t.stateDir);
    assert.equal((await t.run({ op: "createTestIssue", draftId: draft.id })).receipt.status, "unknown");
    assert.equal(t.writes(), 1);
    const read = await t.run({ op: "readIssue", receiptId: first.receipt.id });
    assert.equal(read.receipt.status, "succeeded"); assert.equal(read.receipt.code, undefined);
    assert.equal(t.writes(), 1);
    const raw = JSON.parse(await readFile(t.stateFile, "utf8"));
    raw.receipt.status = "pending";
    await writeFile(t.stateFile, JSON.stringify(raw));
    await manager.closeGitHubOAuthHost(t.stateDir);
    assert.equal((await manager.readGitHubOAuthStatus(t.options)).receipt.status, "unknown");
    assert.equal(t.writes(), 1);
  } finally { await t.cleanup(); }
});

test("wrong draft, changed identity and tampered canonical hash reject before dispatch", async () => {
  const t = await setup();
  try {
    await t.authorize();
    const draft = (await t.run({ op: "prepareTestIssue" })).draft;
    await assert.rejects(t.run({ op: "createTestIssue", draftId: randomUUID() }), /github_draft_changed/);
    t.connection.accountId = "12345678";
    await assert.rejects(t.run({ op: "createTestIssue", draftId: draft.id }), /github_connection_changed/);
    t.connection.accountId = "59789742";
    const raw = JSON.parse(await readFile(t.stateFile, "utf8")); raw.draft.inputHash = "sha256:" + "0".repeat(64);
    await writeFile(t.stateFile, JSON.stringify(raw));
    await assert.rejects(t.run({ op: "createTestIssue", draftId: draft.id }), /github_state_invalid/);
    assert.equal(t.writes(), 0);
  } finally { await t.cleanup(); }
});

test("concurrent refresh observes pending without recovering or duplicating the live write", async () => {
  const t = await setup();
  try {
    await t.authorize(); const draft = (await t.run({ op: "prepareTestIssue" })).draft;
    t.block(); const writing = t.run({ op: "createTestIssue", draftId: draft.id });
    for (let i = 0; i < 100 && t.writes() === 0; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(t.writes(), 1);
    assert.equal((await manager.readGitHubOAuthStatus(t.options)).receipt.status, "pending");
    await assert.rejects(t.run({ op: "createTestIssue", draftId: draft.id }), /github_oauth_busy/);
    t.unblock(); assert.equal((await writing).receipt.status, "succeeded");
    assert.equal(t.writes(), 1);
  } finally { await t.cleanup(); }
});

test("unsupported platform never initializes Keychain or a host", async () => {
  const t = await setup();
  try {
    const status = await manager.readGitHubOAuthStatus({ ...t.options, platform: "linux", getEncryptionKey: () => { throw Error("not allowed"); } });
    assert.equal(status.supported, false); assert.equal(t.calls.length, 0);
  } finally { await t.cleanup(); }
});

test("real host pipe boots encrypted runtime and configures OAuth without external requests or Keychain", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "edupi-github-oauth-pipe-"));
  const assets = path.join(root, "assets"), stateDir = path.join(root, "state");
  await mkdir(assets);
  await copyFile(new URL("../desktop/open-connector-github-host.mjs", import.meta.url), path.join(assets, "github-host.mjs"));
  await symlink(new URL("../node_modules", import.meta.url).pathname, path.join(assets, "node_modules"), "dir");
  const options = { stateDir, root: assets, platform: "darwin", proxyEnv: {}, readSystemProxy: async () => undefined, getEncryptionKey: async () => KEY };
  try {
    const initial = await manager.readGitHubOAuthStatus(options);
    assert.equal(initial.clientConfigured, false);
    assert.equal(initial.callbackUrl, null, "GET must not start the host");
    const configured = await manager.runGitHubOAuthOperation({ op: "configureOAuth", clientId: "a".repeat(20), clientSecret: CLIENT_SECRET }, options);
    assert.equal(configured.clientConfigured, true);
    const request = await manager.runGitHubOAuthOperation({ op: "startOAuth" }, options);
    assert.equal(request.authorization.status, "pending");
    assert.equal(new URL(request.authorization.authorizationUrl).searchParams.get("scope"), "public_repo offline_access");
    assert.equal(new URL(request.authorization.authorizationUrl).searchParams.get("code_challenge_method"), "S256");
    const cancelled = await manager.runGitHubOAuthOperation({ op: "cancelOAuth", requestId: request.authorization.requestId }, options);
    assert.equal(cancelled.authorization.status, "cancelled");
    const file = await readFile(path.join(stateDir, "openconnector-github", "state.json"), "utf8");
    assert.equal(file.includes(KEY), false); assert.equal(file.includes(CLIENT_SECRET), false);
  } finally { await manager.closeGitHubOAuthHost(stateDir); await rm(root, { recursive: true, force: true }); }
});
