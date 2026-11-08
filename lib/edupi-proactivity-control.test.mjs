import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createJiti } from "jiti";

const control = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-proactivity-control.ts");

test("canary scopes require explicit class timetable bindings and current matching materials", () => {
  const workspace = { timetable: [
    { slot_id: "slot-1", class_id: "class-7-1", class_name: "七一班", subject: "数学", kind: "class" },
    { slot_id: "slot-2", class_id: "class-7-1", class_name: "七一班", subject: "数学", kind: "class" },
    { slot_id: "legacy-slot", class_name: "七二班", subject: "数学", kind: "class" },
    { slot_id: "slot-other", class_id: "class-8-1", class_name: "八一班", subject: "数学", kind: "class" },
  ] };
  const materials = [
    { material_id: "material-1", class_id: "class-7-1", subject: "数学", available: true },
    { material_id: "material-missing", class_id: "class-7-1", subject: "数学", available: false },
    { material_id: "material-other", class_id: "class-8-1", subject: "数学", available: true },
  ];
  const scopes = control.buildProactivityScopeCandidates(workspace, materials);
  assert.deepEqual(scopes.map((item) => ({ classId: item.classId, subject: item.subject, ready: item.ready,
    slots: item.slotCount, materials: item.materialCount })), [
    { classId: "class-7-1", subject: "数学", ready: true, slots: 2, materials: 1 },
    { classId: "class-8-1", subject: "数学", ready: true, slots: 1, materials: 1 },
  ]);
  assert.equal(JSON.stringify(scopes).includes("slot-1"), false, "public candidates do not expose source identities");
  const binding = control.buildProactivityGrantBinding({ classId: "class-7-1", subject: "数学" }, workspace, materials,
    "2026-09-23T08:00:00.000Z");
  assert.match(binding.grantId, /^desktop_canary_v2_[a-f0-9]{32}$/u);
  assert.match(binding.spec.budget.id, /^budget_v2_[a-f0-9]{32}$/u);
  assert.equal(binding.spec.domains.join(","), "teaching_preparation");
  assert.deepEqual(binding.spec.actions, ["prepare", "update"]);
  assert.equal(binding.spec.source_ids.length, 4);
  assert.equal(binding.spec.max_calls, undefined);
  assert.equal(binding.spec.budget.max_calls, 12);
  assert.equal(binding.endsAt, "2026-09-30T08:00:00.000Z");
  assert.equal(binding.spec.source_ids.every((id) => /^(?:conversation|material|timetable):[a-f0-9]{64}$/u.test(id)), true);
});

test("a scope without both schedule and material evidence is not activatable", () => {
  const workspace = { timetable: [{ slot_id: "slot-1", class_id: "class-7-1", subject: "数学", kind: "class" }] };
  assert.deepEqual(control.buildProactivityScopeCandidates(workspace, []), [{
    classId: "class-7-1", className: null, subject: "数学", slotCount: 1, materialCount: 0, ready: false,
  }]);
  assert.throws(() => control.buildProactivityGrantBinding({ classId: "class-7-1", subject: "数学" }, workspace, [],
    "2026-09-23T08:00:00.000Z"), (error) => error?.code === "proactivity_scope_unavailable");
});

test("G2 binds only its own conversation and four-call budget to a current math roster scope", () => {
  const scope = { classId: "class-7-1", subject: "数学" };
  const workspace = { timetable: [
    { slot_id: "slot-1", class_id: scope.classId, class_name: "七一班", subject: scope.subject, kind: "class" },
    { slot_id: "slot-english", class_id: scope.classId, class_name: "七一班", subject: "英语", kind: "class" },
    { slot_id: "slot-noncanonical-math", class_id: scope.classId, class_name: "七一班", subject: "math", kind: "class" },
    { slot_id: "slot-without-id", class_name: "七二班", subject: scope.subject, kind: "class" },
  ], students: [{ student_id: "student-1", name: "合成学生", class_name: "七一班" }] };
  assert.deepEqual(control.buildStudentFollowupScopeCandidates(workspace), [{ ...scope, className: "七一班",
    slotCount: 1, materialCount: 0, ready: true }]);
  const binding = control.buildStudentFollowupGrantBinding(scope, workspace, "2026-10-04T00:00:00.000Z");
  assert.deepEqual(binding.spec.domains, ["student_followup"]);
  assert.deepEqual(binding.spec.actions, ["update"]);
  assert.equal(binding.spec.budget.max_calls, 4);
  assert.equal(binding.endsAt, "2026-10-11T00:00:00.000Z");
  assert.equal(control.EDUPI_STUDENT_FOLLOWUP_CONVERSATION_ID, "desktop-student-followup-canary-v1");
  assert.deepEqual(binding.spec.source_ids, [`conversation:${createHash("sha256").update(control.EDUPI_STUDENT_FOLLOWUP_CONVERSATION_ID).digest("hex")}`]);
  const later = control.buildStudentFollowupGrantBinding(scope, workspace, "2026-10-05T00:00:00.000Z");
  assert.equal(later.grantId, binding.grantId);
  assert.equal(later.spec.budget.id, binding.spec.budget.id);
  const g1 = control.buildProactivityGrantBinding(scope, workspace, [
    { material_id: "material-1", class_id: scope.classId, subject: scope.subject },
  ], "2026-10-04T00:00:00.000Z");
  assert.notEqual(binding.grantId, g1.grantId);
  assert.notEqual(binding.spec.budget.id, g1.spec.budget.id);
  assert.doesNotMatch(JSON.stringify(binding), /student-1|合成学生|material-1/);
});

test("G2 scopes reject missing, transferred and ambiguous class mappings without student text parsing", () => {
  const scope = { classId: "class-7-1", subject: "数学" };
  const slot = { slot_id: "slot-1", class_id: scope.classId, class_name: "七一班", subject: scope.subject, kind: "class" };
  const roster = [{ class_name: "七一班" }];
  const cases = [
    { timetable: [slot], students: [] },
    { timetable: [slot], students: [{ class_name: "七二班" }] },
    { timetable: [{ ...slot, class_name: null }], students: roster },
    { timetable: [slot, { ...slot, slot_id: "slot-2", class_id: "class-other" }], students: roster },
    { timetable: [slot, { ...slot, slot_id: "slot-2", class_name: "七二班" }], students: roster },
  ];
  for (const workspace of cases) {
    assert.ok(control.buildStudentFollowupScopeCandidates(workspace).every((item) => !item.ready));
    assert.throws(() => control.buildStudentFollowupGrantBinding(scope, workspace),
      error => error?.code === "proactivity_scope_unavailable");
  }
});
test("G5 grant binds only current accepted parent-question sources in the exact scope", () => {
  const entities = ["class", "term", "student", "parent"].map(kind => ({ entity_id: `${kind}-1`, entity_kind: kind, canonical_name: kind, status: "active" }));
  const observation = { observation_id: "observation-question", source_id: "source-question", source_kind: "teacher_utterance",
    observed_at: "2026-11-05T00:00:00.000Z", entity_ids: entities.map(item => item.entity_id), status: "active" };
  const question = { fact_id: "fact-question", status: "accepted", fact_kind: "evidence", predicate: "communication.parent_question",
    entity_id: "student-1", subject_ref: "math", source_ids: ["source-question"], observation_ids: [observation.observation_id], conflict_ids: [],
    confidence: { basis: "explicit" } };
  const workspace = { fact_spine: { projection_kind: "education_fact_v1", external_send: false,
    entities, observations: [observation], accepted_facts: [question], conflicts: [] } };
  const scope = { classId: "class-1", subject: "math" };
  assert.deepEqual(control.parentQuestionSourceIds(scope, workspace), ["source-question"]);
  assert.equal(control.buildCapabilityScopeCandidates("parent_communication", workspace)[0]?.ready, true);
  const grant = control.buildCapabilityGrantBinding("parent_communication", scope, workspace, "2026-11-05T00:00:00.000Z");
  assert.equal(grant.spec.source_ids.length, 2);
  assert.deepEqual(grant.spec.source_ids.slice(1), ["source-question"]);
  const confirmed = structuredClone(workspace);
  confirmed.fact_spine.observations.push({ ...observation, observation_id: "observation-confirmation", source_id: "source-confirmation" });
  confirmed.fact_spine.accepted_facts.push({ ...question, fact_id: "fact-confirmation", predicate: "communication.question_recipient_confirmed",
    entity_id: "parent-1", subject_ref: null, source_ids: ["source-confirmation"], observation_ids: ["observation-confirmation"] });
  assert.deepEqual(control.parentQuestionSourceIds(scope, confirmed), ["source-question"], "the confirmation source is not a new question grant");
  assert.equal(control.buildCapabilityScopeCandidates("parent_communication", confirmed)[0].materialCount, 1,
    "the G5 confirmation is a recipient proof, not an extra question body");
  confirmed.fact_spine.observations.push({ ...observation, observation_id: "observation-confirmation-2", source_id: "source-confirmation-2" });
  confirmed.fact_spine.accepted_facts.push({ ...confirmed.fact_spine.accepted_facts.at(-1), fact_id: "fact-confirmation-2",
    source_ids: ["source-confirmation-2"], observation_ids: ["observation-confirmation-2"] });
  assert.equal(control.buildCapabilityScopeCandidates("parent_communication", confirmed)[0].materialCount, 1,
    "two question-specific confirmations cannot suppress the parent-question scope");
  const oldRecipient = structuredClone(workspace);
  oldRecipient.fact_spine.observations.push({ ...observation, observation_id: "observation-old-recipient", source_id: "source-old-recipient" });
  oldRecipient.fact_spine.accepted_facts.push({ ...question, fact_id: "fact-old-recipient", predicate: "communication.recipient_confirmed",
    entity_id: "parent-1", subject_ref: null, source_ids: ["source-old-recipient"], observation_ids: ["observation-old-recipient"] });
  assert.equal(control.buildCapabilityScopeCandidates("parent_communication", oldRecipient).length, 1);
  oldRecipient.fact_spine.observations.push({ ...observation, observation_id: "observation-old-recipient-2", source_id: "source-old-recipient-2" });
  oldRecipient.fact_spine.accepted_facts.push({ ...oldRecipient.fact_spine.accepted_facts.at(-1), fact_id: "fact-old-recipient-2",
    source_ids: ["source-old-recipient-2"], observation_ids: ["observation-old-recipient-2"] });
  assert.deepEqual(control.buildCapabilityScopeCandidates("parent_communication", oldRecipient), [],
    "the existing per-message recipient ambiguity gate remains unchanged");
  for (const change of [
    value => { value.fact_spine.accepted_facts[0].status = "deleted"; },
    value => { value.fact_spine.accepted_facts[0].subject_ref = "english"; },
    value => { value.fact_spine.observations[0].entity_ids[0] = "foreign-class"; },
    value => { value.fact_spine.observations[0].status = "stale"; },
    value => { value.fact_spine.accepted_facts[0].conflict_ids = ["open-conflict"]; },
  ]) {
    const altered = structuredClone(workspace); change(altered);
    assert.deepEqual(control.parentQuestionSourceIds(scope, altered), []);
  }
});
