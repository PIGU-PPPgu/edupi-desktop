import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { buildEducationContractFromWorkspace } = await createJiti(import.meta.url).import("./edupi-education-contract.ts");

test("Desktop preserves one Fact v1 identity across student, teaching, and next-lesson views", () => {
  const factId = "fact_c1de4b14456d60b4bbb11c73026b2e86";
  const studentId = "entity_6a4ea769ca8e5b0c49f26c7b7464cb79";
  const fact = {
    fact_id: factId,
    entity_id: studentId,
    fact_kind: "error_pattern",
    predicate: "math.equation.transposition",
    value: "needs_targeted_practice",
    subject_ref: "math",
    topic_ref: "equation",
    confidence: { basis: "explicit", score: 1 },
    status: "accepted",
    source_ids: ["source-1"],
    observation_ids: ["observation-1"],
    conflict_ids: [],
    revision: 0,
    external_send: false,
  };
  const contract = buildEducationContractFromWorkspace({
    source_summaries: [], students: [], timetable: [], calendar: [], tasks: [],
    continuity: { memories: [], signals: [], insights: [], themes: [], subject_knowledge: [], family_contacts: [], documents: [], last_dream: null },
    fact_spine: {
      projection_kind: "education_fact_v1",
      projection_version: "1.0",
      state_hash: `sha256:${"a".repeat(64)}`,
      generated_at: "2026-09-07T02:05:00.000Z",
      entities: [{ entity_id: studentId, entity_kind: "student", canonical_name: "张三", status: "active", revision: 0, external_send: false }],
      observations: [],
      accepted_facts: [fact],
      fact_candidates: [],
      hypotheses: [],
      conflicts: [],
      student_views: [{ student_id: studentId, name: "张三", accepted_fact_ids: [factId], pending_fact_ids: [], external_send: false }],
      teaching_view: { accepted_fact_ids: [factId], by_subject: [{ subject_ref: "math", fact_ids: [factId] }], external_send: false },
      next_lesson_fact_ids: [factId],
      uses: [{ use_id: "fact_use_1", use_key: "lesson-1", consumer_kind: "next_lesson", consumer_ref: "lesson-1", fact_ids: [factId], used_at: "2026-09-07T02:06:00.000Z", external_send: false }],
      legacy_shadow: [{ legacy_id: "legacy-1", student: "张三", content: "旧版只读观察", state: "active", source_kind: "legacy_class_memory", read_only: true, external_send: false }],
      external_send: false,
    },
  }, { workspacePath: "/tmp/task12", supportedCommands: [] });

  assert.equal(contract.factSpine?.stateHash, `sha256:${"a".repeat(64)}`);
  assert.deepEqual(contract.factSpine?.acceptedFacts.map((item) => item.factId), [factId]);
  assert.deepEqual(contract.factSpine?.studentViews[0].acceptedFactIds, [factId]);
  assert.deepEqual(contract.factSpine?.teachingView.acceptedFactIds, [factId]);
  assert.deepEqual(contract.factSpine?.nextLessonFactIds, [factId]);
  assert.deepEqual(contract.factSpine?.uses[0].factIds, [factId]);
  assert.equal(contract.factSpine?.legacyShadow[0].readOnly, true);
});
