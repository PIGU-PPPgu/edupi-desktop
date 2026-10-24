import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createJiti } from "jiti";
const c = await createJiti(import.meta.url).import("./openconnector-github-contract.ts");

test("OAuth operations have strict inputs and reject secrets pasted as public client IDs", () => {
  assert.deepEqual(c.parseGitHubOAuthOperation({ op: "startOAuth" }), { op: "startOAuth" });
  assert.ok(c.parseGitHubOAuthOperation({ op: "configureOAuth", clientId: "a".repeat(20), clientSecret: "test-client-secret-only-123456" }));
  for (const clientId of ["b".repeat(40), "ghp_" + "x".repeat(36), "gho_" + "x".repeat(36), "github_pat_" + "x".repeat(50)]) {
    assert.equal(c.parseGitHubOAuthOperation({ op: "configureOAuth", clientId, clientSecret: "test-client-secret-only-123456" }), null);
  }
  for (const input of [{ op: "prepareTestIssue", owner: "another" }, { op: "createTestIssue", draftId: randomUUID(), input: {} },
    { op: "createTestIssue", draftId: "../anything" }, { op: "execute", actionId: "github.delete_repository" }]) assert.equal(c.parseGitHubOAuthOperation(input), null);
});

test("test content is fixed to the declared repository and exact unique marker", () => {
  const id = randomUUID(), input = c.makeTestIssueInput(id);
  assert.equal(input.owner, "PIGU-PPPgu"); assert.equal(input.repo, "edupi-desktop");
  assert.equal(input.title, `[EduPi OAuth TEST] ${id}`);
  assert.ok(input.body.includes(`edupi-openconnector-test:${id}`));
  assert.throws(() => c.makeTestIssueInput("unbounded"), /invalid_github_request/);
  const connection = { id: randomUUID(), accountId: "59789742", login: "PIGU-PPPgu", scopes: ["public_repo"], authType: "oauth2" };
  assert.equal(c.isGitHubOAuthConnection(connection), true);
  assert.equal(c.isGitHubOAuthConnection({ ...connection, accessToken: "test-only-secret" }), false);
  assert.equal(c.isGitHubOAuthConnection({ ...connection, scopes: ["repo"] }), false);
});

test("recovery operations have no caller-supplied token, network or expiry fields", () => {
  for (const op of ["checkConnection", "refreshOAuth", "expireTokenForAcceptance"]) {
    assert.deepEqual(c.parseGitHubOAuthOperation({ op }), { op });
    for (const extra of [{ accessToken: "fixture" }, { expiresAt: new Date().toISOString() }, { acceptanceEnabled: true }, { proxy: "http://127.0.0.1" }]) {
      assert.equal(c.parseGitHubOAuthOperation({ op, ...extra }), null);
    }
  }
});

test("safe token and health projections reject raw credentials and arbitrary metadata", () => {
  const token = { hasRefreshToken: true, expiresAt: new Date().toISOString(), refreshedAt: null };
  const health = { status: "offline", checkedAt: new Date().toISOString(), code: "github_connection_offline" };
  assert.equal(c.isGitHubOAuthToken(token), true); assert.equal(c.isGitHubConnectionHealth(health), true);
  for (const extra of [{ accessToken: "fixture" }, { refreshToken: "fixture" }, { metadata: {} }, { values: {} }]) assert.equal(c.isGitHubOAuthToken({ ...token, ...extra }), false);
  assert.equal(c.isGitHubOAuthToken({ ...token, expiresAt: "tomorrow" }), false);
  assert.equal(c.isGitHubConnectionHealth({ ...health, code: "Bearer fixture-secret" }), false);
  const oldStatus = { supported: true, clientConfigured: false, clientId: null, callbackUrl: null, authorization: null, connection: null, draft: null, receipt: null };
  assert.equal(c.isGitHubOAuthStatus(oldStatus), true);
  assert.equal(c.isGitHubOAuthStatus({ ...oldStatus, token, health, diagnostics: { acceptanceEnabled: false } }), true);
  assert.equal(c.isGitHubOAuthStatus({ ...oldStatus, diagnostics: { acceptanceEnabled: true, encryptionKey: "fixture" } }), false);
});
