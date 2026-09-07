import assert from "node:assert/strict";
import test from "node:test";
import { runEduPiG3CapabilityE2 } from "./run-edupi-g3-capability-e2.mjs";

const coreRoot = process.env.EDUPI_CORE_ROOT;

test("paired G3 E2 prepares a source-backed capability draft and preserves feedback across restart", { skip: !coreRoot }, async () => {
  const result = await runEduPiG3CapabilityE2({ coreRoot });
  assert.equal(result.status, "passed");
  assert.equal(result.prompt_required, false);
  assert.equal(result.model_unavailable_retryable, true);
  assert.equal(result.source_change_stale, true);
  assert.equal(result.feedback_receipt_stable, true);
  assert.equal(result.artifact_consumer_count, 2);
  assert.equal(result.policy_candidate_applied, false);
  assert.equal(result.restart_projection_stable, true);
  assert.equal(result.external_send, false);
});
