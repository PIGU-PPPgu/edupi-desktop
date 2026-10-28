import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { canPrepareGitHubTestIssue, isSameGitHubWriteReceipt } = await createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } }).import("./OpenConnectorGitHubPanel.tsx");
const connected = () => ({ supported: true, clientConfigured: true, connection: { authType: "oauth2", scopes: ["public_repo"] }, authorization: null, receipt: null });

test("test issue creation requires the new scoped OAuth connection", () => {
  assert.equal(canPrepareGitHubTestIssue(connected()), true);
  assert.equal(canPrepareGitHubTestIssue(null), false);
  assert.equal(canPrepareGitHubTestIssue({ ...connected(), connection: { authType: "api_key", scopes: ["public_repo"] } }), false);
  assert.equal(canPrepareGitHubTestIssue({ ...connected(), connection: { authType: "oauth2", scopes: ["repo", "delete_repo"] } }), false);
  assert.equal(canPrepareGitHubTestIssue({ ...connected(), authorization: { status: "pending" } }), false);
});

test("a saved write result never enables a second test issue after a timeout or remount", () => {
  for (const status of ["pending", "unknown", "succeeded", "failed"]) {
    assert.equal(canPrepareGitHubTestIssue({ ...connected(), receipt: { status } }), false);
  }
});

test("offline or invalid authorization cannot prepare a fresh external write", () => {
  for (const state of ["offline", "authorization_required"]) assert.equal(canPrepareGitHubTestIssue({ ...connected(), health: { status: state } }), false);
  assert.equal(canPrepareGitHubTestIssue({ ...connected(), health: { status: "ready" } }), true);
});

test("replay confirmation requires the same saved write, identity and issue while allowing a later read audit", () => {
  const receipt = { id: "receipt", requestId: "request", draftId: "draft", connectionId: "connection", accountId: "123", status: "succeeded", writeExecutionId: "write", readExecutionId: "first-read", issue: { number: 379 } };
  assert.equal(isSameGitHubWriteReceipt(receipt, { ...receipt, readExecutionId: "later-read" }), true);
  for (const key of ["id", "requestId", "draftId", "connectionId", "accountId", "writeExecutionId"]) assert.equal(isSameGitHubWriteReceipt(receipt, { ...receipt, [key]: "different" }), false);
  assert.equal(isSameGitHubWriteReceipt(receipt, { ...receipt, issue: { number: 380 } }), false);
  assert.equal(isSameGitHubWriteReceipt(receipt, { ...receipt, status: "unknown" }), false);
});
