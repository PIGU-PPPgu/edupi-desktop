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
