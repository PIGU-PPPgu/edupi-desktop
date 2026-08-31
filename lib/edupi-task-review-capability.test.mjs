import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { buildEducationContractFromWorkspace } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-education-contract.ts");
const workspace = { tasks: [], calendar: [], timetable: [], students: [], continuity: {}, source_summaries: [] };

test("enables native task review only when both pinned and snapshot capabilities contain review_task", () => {
  const commands = ["review_observation", "review_task"];
  const enabled = buildEducationContractFromWorkspace(workspace, { workspacePath: "/tmp/edupi", supportedCommands: commands, snapshotPayload: { capabilities: { supported_commands: commands } } });
  assert.equal(enabled.capabilities.taskReview.enabled, true);
  assert.equal(enabled.capabilities.taskReview.mode, "canonical_safe_store");

  const missingManifest = buildEducationContractFromWorkspace(workspace, { workspacePath: "/tmp/edupi", supportedCommands: ["review_observation"], snapshotPayload: { capabilities: { supported_commands: commands } } });
  assert.equal(missingManifest.capabilities.taskReview.enabled, false);
  const missingSnapshot = buildEducationContractFromWorkspace(workspace, { workspacePath: "/tmp/edupi", supportedCommands: commands, snapshotPayload: { capabilities: { supported_commands: ["review_observation"] } } });
  assert.equal(missingSnapshot.capabilities.taskReview.enabled, false);
});
