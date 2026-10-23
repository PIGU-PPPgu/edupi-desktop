import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { canPrepareGitHubTestIssue } = await createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } }).import("./OpenConnectorGitHubPanel.tsx");
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
