import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createJiti } from "jiti";
import { createAccountFixture } from "../scripts/fixtures/edupi-account-fixture.mjs";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { createAccountService } = await jiti.import("./edupi-account-server.ts");
const { parseAction, pngDataUri } = await jiti.import("./edupi-account-protocol.ts");

async function setup(t) {
  const fixture = await createAccountFixture();
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-account-test-")));
  const env = { NODE_ENV: "test", EDUPI_ACCOUNT_SERVICE_URL: fixture.origin, EDUPI_ACCOUNT_ALLOW_LOOPBACK: "1" };
  let clock = Date.now();
  const options = { env, stateDir: root, now: () => clock };
  const service = createAccountService(options);
  t.after(async () => { await fixture.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const advance = (ms = 6000) => { clock += ms; };
  const login = async () => {
    const started = await service.act({ action: "start", purpose: "login" });
    fixture.authorize([...fixture.challenges.keys()].at(-1)); advance();
    return service.act({ action: "poll", flowId: started.status.challenge.flowId });
  };
  return { fixture, root, options, service, advance, login };
}

test("unconfigured client stays local with no network or credential writes", async () => {
  let calls = 0;
  const service = createAccountService({ env: {}, fetchImpl: async () => { calls++; throw new Error(); } });
  assert.equal((await service.status()).status.state, "unconfigured");
  assert.equal((await service.act({ action: "start", purpose: "login" })).status.configured, false);
  assert.equal(calls, 0);
});

test("real loopback challenge, scanned confirmation, PKCE, private persistence and restart", async t => {
  const { fixture, root, options, service, advance } = await setup(t);
  const start = await service.act({ action: "start", purpose: "login" });
  const flow = start.status.challenge.flowId;
  assert.equal(start.status.state, "signed_out"); assert.equal(start.status.challenge.status, "pending");
  assert.ok(start.status.challenge.qrImage.startsWith("data:image/png;base64,"));
  const secretText = fs.readFileSync(path.join(root, "account/account-private.json"), "utf8");
  assert.equal(fs.statSync(path.join(root, "account/account-private.json")).mode & 0o777, 0o600);
  assert.equal(JSON.stringify(start).includes("deviceCode"), false);
  assert.equal(JSON.stringify(start).includes("verifier"), false);
  const challenge = [...fixture.challenges.values()][0];
  assert.equal(JSON.stringify(start).includes(challenge.device), false);
  await service.act({ action: "poll", flowId: flow }); assert.equal(fixture.counters.poll, 0, "early polls are local");
  challenge.status = "scanned"; advance();
  assert.equal((await service.act({ action: "poll", flowId: flow })).status.challenge.status, "scanned");
  fixture.authorize(challenge.id); advance();
  const logged = await service.act({ action: "poll", flowId: flow });
  assert.equal(logged.status.state, "signed_in"); assert.equal(logged.status.account.id, "synthetic-teacher-1");
  assert.equal(logged.status.challenge, null);
  assert.equal((await createAccountService(options).status()).status.account.id, logged.status.account.id);
  const privateFile = JSON.parse(fs.readFileSync(path.join(root, "account/account-private.json"), "utf8"));
  assert.ok(privateFile.session.accessToken);
  assert.equal(JSON.stringify(logged).includes(privateFile.session.accessToken), false);
  assert.equal(JSON.stringify(logged).includes("synthetic-wechat_miniprogram-subject"), false);
  assert.ok(secretText.includes("verifier"));
});

test("binding phone and email preserves one account, denies wrong account and missing verification", async t => {
  const { fixture, service, advance, login } = await setup(t);
  await login();
  for (const [purpose, kind] of [["bind_phone", "phone"], ["bind_email", "email"]]) {
    const start = await service.act({ action: "start", purpose });
    fixture.authorize([...fixture.challenges.keys()].at(-1)); advance();
    const result = await service.act({ action: "poll", flowId: start.status.challenge.flowId });
    assert.equal(result.status.account.id, "synthetic-teacher-1");
    assert.ok(result.status.account.identities.some(item => item.kind === kind));
  }
  const bad = await service.act({ action: "start", purpose: "bind_phone" });
  fixture.authorize([...fixture.challenges.keys()].at(-1), { wrongAccount: true }); advance();
  await assert.rejects(service.act({ action: "poll", flowId: bad.status.challenge.flowId }), error => error.code === "account_mismatch");
  assert.equal((await service.status()).status.account.id, "synthetic-teacher-1");
  const absent = await service.act({ action: "start", purpose: "bind_phone" });
  fixture.authorize([...fixture.challenges.keys()].at(-1), { missingIdentity: true }); advance();
  await assert.rejects(service.act({ action: "poll", flowId: absent.status.challenge.flowId }), error => error.code === "unverified_identity");
  assert.equal((await service.status()).status.challenge.status, "denied");
});

test("expiry, denial, slow_down, replacement and cancellation cannot produce a login", async t => {
  const { fixture, service, advance } = await setup(t);
  let start = await service.act({ action: "start", purpose: "login" });
  let challenge = [...fixture.challenges.values()].at(-1);
  challenge.status = "slow_down"; advance();
  let result = await service.act({ action: "poll", flowId: start.status.challenge.flowId });
  const count = fixture.counters.poll; advance(6000);
  await service.act({ action: "poll", flowId: start.status.challenge.flowId });
  assert.equal(fixture.counters.poll, count, "slow_down extends interval");
  challenge.status = "denied"; advance(5000);
  result = await service.act({ action: "poll", flowId: start.status.challenge.flowId });
  assert.equal(result.status.challenge.qrImage, null); assert.equal(result.status.state, "signed_out");
  const old = start;
  start = await service.act({ action: "start", purpose: "login" });
  await assert.rejects(service.act({ action: "poll", flowId: old.status.challenge.flowId }), error => error.code === "stale_flow");
  advance(61_000);
  assert.equal((await service.status()).status.challenge.status, "expired");
  assert.equal((await service.status()).status.challenge.qrImage, null);
  start = await service.act({ action: "start", purpose: "login" });
  await service.act({ action: "cancel", flowId: start.status.challenge.flowId });
  assert.equal((await service.status()).status.challenge, null);
});

test("cancel during exchange fences the late credentials and logout clears only the account file", async t => {
  const { fixture, options, service, advance, root, login } = await setup(t);
  let release, reached;
  const barrier = new Promise(resolve => { release = resolve; });
  const waiting = new Promise(resolve => { reached = resolve; });
  const slow = createAccountService({ ...options, fetchImpl: async (url, init) => {
    const response = await fetch(url, init);
    if (String(url).endsWith("/v1/desktop/token")) { reached(); await barrier; }
    return response;
  } });
  const start = await slow.act({ action: "start", purpose: "login" });
  fixture.authorize([...fixture.challenges.keys()].at(-1)); advance();
  const polling = slow.act({ action: "poll", flowId: start.status.challenge.flowId });
  await waiting;
  await service.act({ action: "cancel", flowId: start.status.challenge.flowId }); release();
  await assert.rejects(polling, error => error.code === "stale_flow");
  assert.equal((await service.status()).status.state, "signed_out");
  await login();
  fs.writeFileSync(path.join(root, "teacher-data.json"), '{"preserved":true}');
  fixture.fail("/v1/desktop/revoke");
  const result = await service.act({ action: "logout" });
  assert.equal(result.status.state, "signed_out"); assert.match(result.warning, /尚未确认/u);
  assert.equal(fs.readFileSync(path.join(root, "teacher-data.json"), "utf8"), '{"preserved":true}');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "account/account-private.json"), "utf8")).session, null);
});

test("exchange response loss retries the persisted code and idempotency key after restart", async t => {
  const { fixture, options, advance } = await setup(t);
  let lost = true;
  const service = createAccountService({ ...options, fetchImpl: async (url, init) => {
    const response = await fetch(url, init);
    if (String(url).endsWith("/v1/desktop/token") && lost) { lost = false; throw new Error("synthetic lost reply"); }
    return response;
  } });
  const start = await service.act({ action: "start", purpose: "login" });
  fixture.authorize([...fixture.challenges.keys()].at(-1)); advance();
  await assert.rejects(service.act({ action: "poll", flowId: start.status.challenge.flowId }), error => error.code === "service_unavailable");
  advance();
  const result = await createAccountService(options).act({ action: "poll", flowId: start.status.challenge.flowId });
  assert.equal(result.status.state, "signed_in");
  assert.equal(fixture.counters.exchange, 2); assert.equal(fixture.counters.poll, 1);
});

test("session expiry refreshes privately and issuer changes cannot reuse its credentials", async t => {
  const { options, service, advance, fixture, login } = await setup(t);
  await login(); advance(61_000);
  assert.equal((await service.status()).status.state, "expired");
  assert.equal((await service.act({ action: "refresh" })).status.state, "signed_in");
  assert.equal(fixture.counters.refresh, 1);
  const other = createAccountService({ ...options, env: { ...options.env, EDUPI_ACCOUNT_CLIENT_ID: "another-client" } });
  await assert.rejects(other.status(), error => error.code === "issuer_changed");
  fixture.fail("/v1/me");
  await assert.rejects(service.act({ action: "refresh" }), error => error.code === "service_unavailable");
  assert.equal((await service.status()).status.state, "signed_in", "a temporary outage preserves local credentials");
});

test("late successful profile refresh cannot resurrect credentials invalidated by a concurrent 401", async t => {
  const { options, service, login } = await setup(t);
  await login();
  let release, reached;
  const barrier = new Promise(resolve => { release = resolve; });
  const waiting = new Promise(resolve => { reached = resolve; });
  const late = createAccountService({ ...options, fetchImpl: async (url, init) => {
    const result = await fetch(url, init);
    if (String(url).endsWith("/v1/me")) { reached(); await barrier; }
    return result;
  } });
  const pending = late.act({ action: "refresh" });
  await waiting;
  const revoked = createAccountService({ ...options, fetchImpl: async () => new Response("{}", { status: 401 }) });
  await assert.rejects(revoked.act({ action: "refresh" }), error => error.code === "session_revoked");
  release(); await pending;
  assert.equal((await service.status()).status.state, "expired");
});

test("a refresh token issued during logout is discarded and remotely revoked", async t => {
  const { options, service, fixture, login, advance } = await setup(t);
  await login(); advance(61_000);
  let release, reached, issued;
  const barrier = new Promise(resolve => { release = resolve; });
  const waiting = new Promise(resolve => { reached = resolve; });
  const late = createAccountService({ ...options, fetchImpl: async (url, init) => {
    const result = await fetch(url, init);
    if (String(url).endsWith("/v1/desktop/token")) {
      issued = await result.clone().json(); reached(); await barrier;
    }
    return result;
  } });
  const refreshing = late.act({ action: "refresh" });
  await waiting; await service.act({ action: "logout" }); release(); await refreshing;
  assert.equal((await service.status()).status.state, "signed_out");
  assert.equal((await fetch(`${fixture.origin}/v1/me`, { headers: { Authorization: `Bearer ${issued.access_token}` } })).status, 401);
});

test("canceling a binding does not hide a 401 for the unchanged credential", async t => {
  const { options, service, root, login } = await setup(t);
  await login();
  const binding = await service.act({ action: "start", purpose: "bind_phone" });
  let release, reached;
  const barrier = new Promise(resolve => { release = resolve; });
  const waiting = new Promise(resolve => { reached = resolve; });
  const late = createAccountService({ ...options, fetchImpl: async () => {
    reached(); await barrier; return new Response("{}", { status: 401 });
  } });
  const pending = late.act({ action: "refresh" });
  const rejected = assert.rejects(pending, error => error.code === "session_revoked");
  await waiting;
  await service.act({ action: "cancel", flowId: binding.status.challenge.flowId });
  release(); await rejected;
  assert.equal((await service.status()).status.state, "expired");
  const state = JSON.parse(fs.readFileSync(path.join(root, "account/account-private.json"), "utf8"));
  assert.equal(state.session.accessToken, "");
  assert.equal(state.session.refreshToken, null);
});

test("a late 401 for an old credential cannot erase a newer login", async t => {
  const { options, service, login } = await setup(t);
  await login();
  let release, reached;
  const barrier = new Promise(resolve => { release = resolve; });
  const waiting = new Promise(resolve => { reached = resolve; });
  const late = createAccountService({ ...options, fetchImpl: async () => {
    reached(); await barrier; return new Response("{}", { status: 401 });
  } });
  const pending = late.act({ action: "refresh" });
  const rejected = assert.rejects(pending, error => error.code === "session_revoked");
  await waiting;
  await service.act({ action: "logout" });
  await login();
  release(); await rejected;
  assert.equal((await service.status()).status.state, "signed_in");
});

test("a late 401 preserves a new login begun after the old session naturally expires", async t => {
  const { options, service, fixture, advance, login } = await setup(t);
  await login(); advance(55_000);
  let release, reached;
  const barrier = new Promise(resolve => { release = resolve; });
  const waiting = new Promise(resolve => { reached = resolve; });
  const late = createAccountService({ ...options, fetchImpl: async () => {
    reached(); await barrier; return new Response("{}", { status: 401 });
  } });
  const pending = late.act({ action: "refresh" });
  const rejected = assert.rejects(pending, error => error.code === "session_revoked");
  await waiting; advance(6000);
  const started = await service.act({ action: "start", purpose: "login" });
  const flowId = started.status.challenge.flowId;
  release(); await rejected;
  assert.equal((await service.status()).status.challenge.flowId, flowId);
  fixture.authorize([...fixture.challenges.keys()].at(-1)); advance();
  assert.equal((await service.act({ action: "poll", flowId })).status.state, "signed_in");
});

test("an expired account can explicitly sign in as a different authoritative account", async t => {
  const { fixture, service, login, advance } = await setup(t);
  await login(); advance(61_000);
  const start = await service.act({ action: "start", purpose: "login" });
  fixture.authorize([...fixture.challenges.keys()].at(-1), { wrongAccount: true }); advance();
  const result = await service.act({ action: "poll", flowId: start.status.challenge.flowId });
  assert.equal(result.status.account.id, "synthetic-other-teacher");
  assert.equal(result.status.state, "signed_in");
});

test("simultaneous idempotent token refresh does not revoke credentials adopted by the other request", async t => {
  const { service, fixture, login, advance } = await setup(t);
  await login(); advance(61_000);
  const results = await Promise.all([service.act({ action: "refresh" }), service.act({ action: "refresh" })]);
  assert.ok(results.every(result => result.status.state === "signed_in"));
  await service.act({ action: "refresh" });
  assert.equal(fixture.counters.revoke, 0);
});

test("a generation change retains an idempotent refresh while its original credential is still recoverable", async t => {
  const { service, fixture, options, login, advance } = await setup(t);
  await login(); advance(61_000);
  let release, reached;
  const barrier = new Promise(resolve => { release = resolve; });
  const waiting = new Promise(resolve => { reached = resolve; });
  const late = createAccountService({ ...options, fetchImpl: async (url, init) => {
    const response = await fetch(url, init);
    if (String(url).endsWith("/v1/desktop/token")) { reached(); await barrier; }
    return response;
  } });
  const pending = late.act({ action: "refresh" });
  await waiting;
  await service.act({ action: "start", purpose: "login" });
  release(); await pending;
  assert.equal(fixture.counters.revoke, 0, "do not revoke a result while its source refresh credential can still recover it");
  const adopted = await service.act({ action: "refresh" });
  assert.equal(adopted.status.state, "signed_in");
  await service.act({ action: "refresh" });
  assert.equal(fixture.counters.revoke, 0);
});

test("credential permissions, symlinks, external redirects and malformed actions fail closed", async t => {
  const { service, root, options, login } = await setup(t);
  await login();
  const file = path.join(root, "account/account-private.json");
  fs.chmodSync(file, 0o644);
  await assert.rejects(service.status(), error => error.code === "storage_unavailable");
  fs.chmodSync(file, 0o600);
  const target = path.join(root, "unchanged.json"); fs.renameSync(file, target); fs.symlinkSync(target, file);
  await assert.rejects(service.status(), error => error.code === "storage_unavailable");
  assert.throws(() => createAccountService({ env: { EDUPI_ACCOUNT_SERVICE_URL: "http://example.test" } }), error => error.code === "configuration_invalid");
  for (const input of [{ action: "poll", flowId: "x" }, { action: "start", purpose: "login", openid: "fake" }, { action: "verify", verified: true }]) assert.throws(() => parseAction(input));
  assert.throws(() => pngDataUri("PHN2ZyBvbmxvYWQ9eD4="));
  const redirect = createAccountService({ ...options, stateDir: fs.mkdtempSync(path.join(root, "redirect-")), fetchImpl: async (_url, init) => {
    assert.equal(init.redirect, "error"); return new Response("<html/>", { headers: { "Content-Type": "text/html" } });
  } });
  await assert.rejects(redirect.act({ action: "start", purpose: "login" }), error => error.code === "service_unavailable");
});
