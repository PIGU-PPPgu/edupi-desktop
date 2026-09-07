import assert from "node:assert/strict";
import test from "node:test";
import { runEduPiG2FactE2 } from "./run-edupi-g2-fact-e2.mjs";

const coreRoot = process.env.EDUPI_CORE_ROOT;

test("paired G2 E2 keeps one fact identity across Core projections and Desktop restart", { skip: !coreRoot }, async () => {
  const result = await runEduPiG2FactE2({ coreRoot });
  assert.equal(result.status, "passed");
  assert.equal(result.split_students, 3);
  assert.equal(result.raw_observation_preserved, true);
  assert.equal(result.modified_fact_shared, true);
  assert.equal(result.fresh_core_snapshot_processes, 2);
  assert.equal(result.desktop_envelope_validated, true);
  assert.equal(result.restart_projection_stable, true);
  assert.equal(result.desktop_direct_writes, 0);
  assert.equal(result.legacy_shadow_unchanged, true);
  assert.equal(result.external_send, false);
});
