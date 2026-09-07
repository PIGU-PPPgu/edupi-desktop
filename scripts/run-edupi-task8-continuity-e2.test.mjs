import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertExactTask8ArtifactFiles,
  requireSingleTask8Match,
  runTask8ContinuityE2,
} from "./run-edupi-task8-continuity-e2.mjs";

const coreRoot = process.env.EDUPI_CORE_ROOT;
const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("paired Task 8 G1 continuity survives model outage, Core restart, and Desktop restart without Chat", { skip: !coreRoot }, async () => {
  const result = await runTask8ContinuityE2({ coreRoot });
  assert.equal(result.status, "passed");
  assert.deepEqual(result.transition_states, ["queued", "running", "failed", "queued", "running", "draft_ready"]);
  assert.equal(result.execution_attempt, 2);
  assert.equal(result.artifact_ids.length, 4);
  assert.equal(result.artifact_hashes.length, 4);
  assert.equal(result.model_unavailable_retryable, true);
  assert.equal(result.core_restart_replay_stable, true);
  assert.equal(result.desktop_restart_replay_stable, true);
  assert.equal(Object.hasOwn(result, "active_chat_sessions"), false);
  assert.equal(result.chat_runtime_started, false);
  assert.equal(result.channel_connected, false);
  assert.equal(result.external_send, false);
});

test("Task 8 runner has no AgentSession, channel, provider, or external-send activation path", () => {
  const source = fs.readFileSync(path.join(desktopRoot, "scripts", "run-edupi-task8-continuity-e2.mjs"), "utf8");
  assert.doesNotMatch(source, /createAgentSession|startRpcSession|enqueue_event|sendVerified|https:\/\/|EDUPI_CORE_TOKEN[^\n]*process\.env/u);
  assert.match(source, /http:\/\/127\.0\.0\.1/u);
  assert.doesNotMatch(source, /active_chat_sessions:\s*0/u);
  assert.match(source, /active_chat_sessions:\s*ready\.running\.runningSessionIds\.length/u);
  assert.match(source, /api\/agent\/running/u);
  assert.match(source, /chat_runtime_started:\s*false/u);
  assert.match(source, /channel_connected:\s*false/u);
  assert.match(source, /external_send:\s*false/u);
});

test("Task 8 evidence rejects duplicate cases and extra artifact files", () => {
  assert.deepEqual(requireSingleTask8Match([{ id: "case-1" }], () => true, "work case"), { id: "case-1" });
  assert.equal(requireSingleTask8Match([], () => true, "work case"), null);
  assert.throws(
    () => requireSingleTask8Match([{ id: "case-1" }, { id: "case-2" }], () => true, "work case"),
    /exactly one work case/u,
  );
  assert.doesNotThrow(() => assertExactTask8ArtifactFiles(["/tmp/a.md", "/tmp/b.md"], ["/tmp/b.md", "/tmp/a.md"]));
  assert.throws(
    () => assertExactTask8ArtifactFiles(["/tmp/a.md"], ["/tmp/a.md", "/tmp/extra.md"]),
    /artifact file set/u,
  );
});
