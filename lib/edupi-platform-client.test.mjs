import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { normalizeTeachingSkillLifecycle } = await createJiti(import.meta.url).import("./edupi-platform-client.ts");

test("normalizes the real teaching skill lifecycle and distinguishes empty from unavailable", () => {
  assert.deepEqual(normalizeTeachingSkillLifecycle(null), { status: "unavailable", generatedAt: null, skills: [] });
  assert.equal(normalizeTeachingSkillLifecycle({ projection_kind: "teaching_skill_lifecycle", external_send: false, generated_at: "2026-09-06T00:00:00.000Z", skills: [] }).status, "empty");
  const ready = normalizeTeachingSkillLifecycle({ projection_kind: "teaching_skill_lifecycle", external_send: false, generated_at: "2026-09-06T10:00:00.000Z", skills: [{ skill_id: "skill-1", title: "错因追问", lifecycle_state: "trial", trial_count: 3, can_reuse: false, evidence_ids: ["evidence-1"], updated_at: "2026-09-06T09:00:00.000Z" }] });
  assert.deepEqual(ready, { status: "ready", generatedAt: "2026-09-06T10:00:00.000Z", skills: [{ skillId: "skill-1", title: "错因追问", lifecycleState: "trial", trialCount: 3, canReuse: false, evidenceIds: ["evidence-1"], updatedAt: "2026-09-06T09:00:00.000Z" }] });
});
