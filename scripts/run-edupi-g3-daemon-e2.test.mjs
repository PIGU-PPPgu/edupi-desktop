import assert from "node:assert/strict";
import test from "node:test";
import { runEduPiG3DaemonE2 } from "./run-edupi-g3-daemon-e2.mjs";

test("paired G3 daemon schedules, retries, reviews, and restarts through the real Desktop broker", { skip: !process.env.EDUPI_CORE_ROOT }, async () => {
  const result = await runEduPiG3DaemonE2();
  assert.equal(result.status, "passed");
  assert.equal(result.daemon_scheduled, true);
  assert.equal(result.model_unavailable_retryable, true);
  assert.equal(result.desktop_review_bridge, true);
  assert.equal(result.restart_projection_stable, true);
  assert.equal(result.artifact_ids.length, 2);
  assert.equal(result.active_chat_sessions, 0);
  assert.equal(result.external_send, false);
});
