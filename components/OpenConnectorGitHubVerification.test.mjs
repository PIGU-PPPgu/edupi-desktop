import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { canStartGitHubRead } = await createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } }).import("./OpenConnectorGitHubVerification.tsx");
const status = (receipt) => ({ supported: true, connection: { id: "current" }, receipt });

test("an interrupted read allows a new explicit read while its old request remains unknown", () => {
  const previous = { connectionId: "current", status: "unknown", id: "old-request" };
  assert.equal(canStartGitHubRead(status(previous)), true);
  assert.equal(previous.status, "unknown");
  assert.equal(previous.id, "old-request");
  assert.equal(canStartGitHubRead(status({ ...previous, status: "pending" })), false);
});

test("a previous connection's receipt does not block a newly authorized account", () => {
  assert.equal(canStartGitHubRead(status({ connectionId: "previous", status: "pending" })), true);
  assert.equal(canStartGitHubRead(status(null)), true);
  assert.equal(canStartGitHubRead(null), false);
  assert.equal(canStartGitHubRead({ supported: false, connection: null, receipt: null }), false);
});
