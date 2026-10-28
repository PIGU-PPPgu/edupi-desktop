import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createJiti } from "jiti";

const { parseGitHubVerificationOperation, isGitHubVerificationStatus } = await createJiti(import.meta.url).import("./openconnector-verification-contract.ts");

test("only fixed manual connection operations and UUID bindings are accepted", () => {
  assert.deepEqual(parseGitHubVerificationOperation({ op: "connect" }), { op: "connect" });
  const input = { op: "verify", connectionId: randomUUID(), requestId: randomUUID() };
  assert.deepEqual(parseGitHubVerificationOperation(input), input);
  for (const value of [null, [], { op: "connect", token: "not-accepted" }, { ...input, input: {} }, { ...input, actionId: "github.create_repository" }, { ...input, requestId: "../../another-file" }]) {
    assert.equal(parseGitHubVerificationOperation(value), null);
  }
});

test("UI status requires a matching fixed audited success, not a success label alone", () => {
  const connection = { id: randomUUID(), service: "github", accountId: "example-user", login: "example-user", htmlUrl: "https://github.com/example-user", authorizedAt: new Date().toISOString() };
  const receipt = { id: randomUUID(), connectionId: connection.id, actionId: "github.get_current_user", login: connection.login,
    status: "succeeded", startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), executionId: randomUUID(), auditPersisted: true,
    profile: { login: connection.login, id: 123, htmlUrl: connection.htmlUrl, publicRepos: 2 } };
  assert.equal(isGitHubVerificationStatus({ supported: true, connection, receipt }), true);
  assert.equal(isGitHubVerificationStatus({ supported: true, connection, receipt: { ...receipt, auditPersisted: false } }), false);
  assert.equal(isGitHubVerificationStatus({ supported: true, connection, receipt: { ...receipt, profile: { ...receipt.profile, htmlUrl: "javascript:alert(1)" } } }), false);
  assert.equal(isGitHubVerificationStatus({ supported: true, connection, receipt: { ...receipt, actionId: "github.create_repository" } }), false);
});
