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
function parentQuestionWorkspace() {
  const entities = ["class", "term", "student", "parent"].map(kind => ({
    entity_id: `${kind}-1`, entity_kind: kind, canonical_name: kind, status: "active",
  }));
  return { fact_spine: { projection_kind: "education_fact_v1", external_send: false, entities, conflicts: [],
    observations: [{ observation_id: "observation-question", source_id: "source-question", status: "active",
      entity_ids: entities.map(item => item.entity_id) }],
    accepted_facts: [{ fact_id: "fact-question", entity_id: "student-1", status: "accepted", fact_kind: "evidence",
      predicate: "communication.parent_question", subject_ref: "math",
      observation_ids: ["observation-question"], source_ids: ["source-question"], conflict_ids: [] }],
  } };
}

test("G5 question source binding recognizes Core subject aliases and canonical subject entities", () => {
  for (const [subject, reference] of [
    ["math", "数学"], ["数学", "mathematics"], [" mathematics ", "ＭＡＴＨ"],
    ["chinese", "语文"], ["english", "英语"], ["physics", "物理"], ["chemistry", "化学"],
    ["biology", "生物"], ["history", "历史"], ["geography", "地理"], ["politics", "政治"],
    ["science", "科学"], ["music", "音乐"], ["art", "美术"], ["pe", "体育"],
  ]) {
    const workspace = parentQuestionWorkspace();
    workspace.fact_spine.accepted_facts[0].subject_ref = reference;
    assert.deepEqual(control.parentQuestionSourceIds({ classId: "class-1", subject }, workspace),
      ["source-question"], `${subject} recognizes ${reference}`);
  }
  for (const [subject, reference, tagged] of [
    ["math", "subject-math", false], ["subject-math", "数学", false],
    ["subject-math", "subject-math", true], ["mathematics", "数学", true],
  ]) {
    const workspace = parentQuestionWorkspace();
    workspace.fact_spine.entities.push({ entity_id: "subject-math", entity_kind: "subject", status: "active",
      canonical_name: "校内数学", aliases: [{ namespace: "curriculum", value: "ＭＡＴＨ" }, { value: "数学" }] });
    workspace.fact_spine.accepted_facts[0].subject_ref = reference;
    if (tagged) workspace.fact_spine.observations[0].entity_ids.push("subject-math");
    assert.deepEqual(control.parentQuestionSourceIds({ classId: "class-1", subject }, workspace), ["source-question"]);
  }
});

test("G5 rejects unproved, inactive, ambiguous and inconsistent observation subjects", () => {
  const scope = { classId: "class-1", subject: "math" };
  const workspace = parentQuestionWorkspace();
  workspace.fact_spine.entities.push(
    { entity_id: "subject-math", entity_kind: "subject", canonical_name: "数学", status: "active" },
    { entity_id: "subject-math-2", entity_kind: "subject", canonical_name: "mathematics", status: "active" },
    { entity_id: "subject-english", entity_kind: "subject", canonical_name: "英语", status: "active" },
  );
  workspace.fact_spine.observations[0].entity_ids.push("subject-math");
  workspace.fact_spine.observations.push({ ...workspace.fact_spine.observations[0],
    observation_id: "observation-question-2", source_id: "source-question-2",
    entity_ids: [...workspace.fact_spine.observations[0].entity_ids] });
  workspace.fact_spine.accepted_facts[0].observation_ids.push("observation-question-2");
  workspace.fact_spine.accepted_facts[0].source_ids.push("source-question-2");
  assert.deepEqual(control.parentQuestionSourceIds(scope, workspace), ["source-question", "source-question-2"]);
  const changes = [
    ["missing fact subject", value => { delete value.fact_spine.accepted_facts[0].subject_ref; }],
    ["neutral fact subject", value => { value.fact_spine.accepted_facts[0].subject_ref = null; }],
    ["unknown fact subject", value => { value.fact_spine.accepted_facts[0].subject_ref = "unknown"; }],
    ["different fact subject entity", value => { value.fact_spine.accepted_facts[0].subject_ref = "subject-math-2"; }],
    ["unknown entity tag", value => { value.fact_spine.observations[0].entity_ids.push("missing-subject"); }],
    ["cross-subject tag", value => { value.fact_spine.observations[0].entity_ids[4] = "subject-english"; }],
    ["multiple subject tags", value => { value.fact_spine.observations[0].entity_ids.push("subject-math-2"); }],
    ["different subject identity across observations", value => { value.fact_spine.observations[1].entity_ids[4] = "subject-math-2"; }],
    ["inactive subject tag", value => { value.fact_spine.entities[4].status = "deleted"; }],
    ["ambiguous subject aliases", value => { value.fact_spine.entities[4].aliases = [{ value: "英语" }]; }],
    ["unproved subject label", value => { value.fact_spine.entities[4].canonical_name = "unknown"; }],
    ["inactive required entity", value => { value.fact_spine.entities[2].status = "deleted"; }],
    ["extra inactive required entity", value => {
      value.fact_spine.entities.push({ entity_id: "parent-2", entity_kind: "parent", status: "deleted" });
      value.fact_spine.observations[0].entity_ids.push("parent-2");
    }],
    ["subject alias shadows non-subject entity", value => {
      value.fact_spine.entities.push({ entity_id: "math", entity_kind: "student", status: "active" });
    }],
    ["subject alias shadows inactive entity", value => {
      value.fact_spine.entities.push({ entity_id: "math", entity_kind: "subject", canonical_name: "数学", status: "deleted" });
    }],
  ];
  for (const [label, change] of changes) {
    const changed = structuredClone(workspace);
    change(changed);
    assert.deepEqual(control.parentQuestionSourceIds(scope, changed), [], label);
  }
  assert.deepEqual(control.parentQuestionSourceIds({ ...scope, subject: "unknown" }, workspace), []);
  assert.deepEqual(control.parentQuestionSourceIds({ ...scope, subject: "subject-math-2" }, workspace), []);
  const unknown = parentQuestionWorkspace();
  unknown.fact_spine.accepted_facts[0].subject_ref = "unknown";
  assert.deepEqual(control.parentQuestionSourceIds({ ...scope, subject: "unknown" }, unknown), [],
    "identical unknown strings cannot establish subject proof");
});

test("G5 grant source capacity counts the unique conversation source within Core's 128 limit", () => {
  const workspace = parentQuestionWorkspace();
  const scope = { classId: "class-1", subject: "math" };
  const conversation = `conversation:${createHash("sha256").update(control.EDUPI_CAPABILITY_CONVERSATIONS.parent_communication).digest("hex")}`;
  const observation = workspace.fact_spine.observations[0];
  workspace.fact_spine.observations = Array.from({ length: 127 }, (_, index) => ({
    ...observation, observation_id: `observation-${index}`, source_id: `source-${index}`,
  }));
  const fact = workspace.fact_spine.accepted_facts[0];
  const bind = () => {
    fact.observation_ids = workspace.fact_spine.observations.map(item => item.observation_id);
    fact.source_ids = workspace.fact_spine.observations.map(item => item.source_id);
    return control.buildCapabilityGrantBinding("parent_communication", scope, workspace, "2026-11-10T00:00:00.000Z");
  };
  assert.equal(bind().spec.source_ids.length, 128);
  workspace.fact_spine.observations.push({ ...observation, observation_id: "observation-conversation", source_id: conversation });
  const grant = bind();
  assert.equal(grant.spec.source_ids.length, 128);
  assert.equal(grant.spec.source_ids.filter(id => id === conversation).length, 1);
  workspace.fact_spine.observations.at(-1).source_id = "source-overflow";
  assert.throws(bind, error => error?.code === "proactivity_source_capacity");
});

test("reflection scope accepts an exact lesson fact and rejects cross-lesson evidence", () => {
  const workspace = { fact_spine: { projection_kind: "education_fact_v1", external_send: false,
    entities: ["class", "term", "lesson_occurrence"].map(kind => ({ entity_id: `${kind}-1`,
      entity_kind: kind, status: "active", canonical_name: kind })),
    observations: [{ observation_id: "observation-1", source_id: "source-1", status: "active",
      entity_ids: ["class-1", "term-1", "lesson_occurrence-1"] }],
    accepted_facts: [{ fact_id: "fact-1", entity_id: "lesson_occurrence-1", status: "accepted",
      fact_kind: "evidence", predicate: "lesson.observation", subject_ref: "math",
      source_ids: ["source-1"], observation_ids: ["observation-1"], conflict_ids: [] }], conflicts: [] } };
  const scopes = () => control.buildCapabilityScopeCandidates("lesson_reflection", workspace);
  assert.deepEqual(scopes().map(({ classId, subject, materialCount }) => ({ classId, subject, materialCount })),
    [{ classId: "class-1", subject: "math", materialCount: 1 }]);
  workspace.fact_spine.accepted_facts[0].entity_id = "class-1";
  assert.equal(scopes()[0]?.materialCount, 1, "legacy class-scoped fact remains readable");
  workspace.fact_spine.accepted_facts[0].entity_id = "lesson_occurrence-2";
  assert.deepEqual(scopes(), [], "a fact for another lesson cannot use this observation");
  workspace.fact_spine.entities.push({ entity_id: "lesson_occurrence-2", entity_kind: "lesson_occurrence",
    status: "active", canonical_name: "other lesson" });
  workspace.fact_spine.accepted_facts[0].entity_id = "lesson_occurrence-1";
  workspace.fact_spine.observations[0].entity_ids.push("lesson_occurrence-2");
  assert.deepEqual(scopes(), [], "an observation tagged with two lessons is ambiguous");
  workspace.fact_spine.observations[0].entity_ids = ["class-2", "term-1", "lesson_occurrence-1"];
  assert.deepEqual(scopes(), [], "a cross-class observation cannot enter the scope");
});

test("reflection scope requires every source observation to share the same registered lesson", () => {
  const entities = ["class", "term", "lesson_occurrence"].flatMap(kind => [1, 2].map(index => ({
    entity_id: `${kind}-${index}`, entity_kind: kind, status: "active", canonical_name: `${kind} ${index}`,
  })));
  const observation = (index, entityIds = ["class-1", "term-1", "lesson_occurrence-1"]) => ({
    observation_id: `observation-${index}`, source_id: `source-${index}`, status: "active", entity_ids: entityIds,
  });
  const workspace = { fact_spine: { projection_kind: "education_fact_v1", external_send: false, entities,
    observations: [observation(1), observation(2)], accepted_facts: [{
      fact_id: "fact-1", entity_id: "lesson_occurrence-1", status: "accepted", fact_kind: "evidence",
      predicate: "lesson.observation", subject_ref: "math", source_ids: ["source-2", "source-1"],
      observation_ids: ["observation-1", "observation-2"], conflict_ids: [],
    }], conflicts: [] } };
  const scopes = value => control.buildCapabilityScopeCandidates("lesson_reflection", value);
  assert.deepEqual(scopes(workspace).map(({ classId, subject, materialCount }) => ({ classId, subject, materialCount })),
    [{ classId: "class-1", subject: "math", materialCount: 1 }]);
  for (const kind of ["class", "term", "lesson_occurrence"]) {
    const changed = structuredClone(workspace);
    changed.fact_spine.observations[1].entity_ids = changed.fact_spine.observations[1].entity_ids
      .map(id => id === `${kind}-1` ? `${kind}-2` : id);
    assert.deepEqual(scopes(changed), [], `a registered second ${kind} cannot enter the lesson`);
  }
  for (const change of [
    value => { value.fact_spine.accepted_facts[0].source_ids.pop(); },
    value => { value.fact_spine.accepted_facts[0].source_ids.push("source-extra"); },
    value => { value.fact_spine.observations[1].status = "stale"; },
  ]) {
    const changed = structuredClone(workspace);
    change(changed);
    assert.deepEqual(scopes(changed), []);
  }
});
