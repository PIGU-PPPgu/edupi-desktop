import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createJiti } from "jiti";

const control = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-proactivity-control.ts");
const scope = { classId: "class-1", subject: "math" };
const now = "2026-11-10T04:00:00.000Z";

function workspace({ lesson = true } = {}) {
  const externalId = `2026-11-09:${createHash("sha256")
    .update(JSON.stringify(["slot-1", scope.classId, scope.subject, "term-1"])).digest("hex").slice(0, 32)}`;
  return {
    timetable: [{ slot_id: "slot-1", class_id: scope.classId, class_name: "合成班级", subject: scope.subject,
      kind: "class", day_of_week: 1, period: 1, start_time: "08:00", time_zone: "Asia/Shanghai",
      source_ids: ["source-timetable"] }],
    fact_spine: {
      projection_kind: "education_fact_v1", external_send: false, conflicts: [],
      entities: [
        { entity_id: "class-1", entity_kind: "class", canonical_name: "合成班级", status: "active" },
        { entity_id: "term-1", entity_kind: "term", canonical_name: "合成学期", status: "active" },
        ...(lesson ? [{ entity_id: "lesson-1", entity_kind: "lesson_occurrence", canonical_name: "合成课次", status: "active",
          external_refs: [{ namespace: "edupi-timetable-occurrence-v1", external_id: externalId }] }] : []),
      ],
      observations: [], accepted_facts: [],
    },
  };
}

function addFact(value, predicate, source = predicate) {
  value.fact_spine.observations.push({
    observation_id: `observation-${source}`, source_id: source, source_kind: "teacher_utterance", status: "active",
    observed_at: "2026-11-09T01:00:00.000Z", actor_ref: "owner-1",
    entity_ids: ["class-1", "term-1", "lesson-1"],
  });
  value.fact_spine.accepted_facts.push({
    fact_id: `fact-${source}`, entity_id: "lesson-1", fact_kind: "evidence", predicate, subject_ref: "math",
    confidence: { basis: "explicit" }, status: "accepted", source_ids: [source],
    observation_ids: [`observation-${source}`], conflict_ids: [],
  });
}

test("G4 can authorize a current timetable before registering or completing a lesson", () => {
  const value = workspace({ lesson: false });
  assert.deepEqual(control.buildCapabilityScopeCandidates("lesson_reflection", value), [
    { ...scope, className: "合成班级", slotCount: 1, materialCount: 0, ready: true },
  ]);
  assert.deepEqual(control.lessonReflectionSourceIds(scope, value), ["source-timetable"]);
  const binding = control.buildCapabilityGrantBinding("lesson_reflection", scope, value, now);
  assert.equal(binding.grantId, control.capabilityGrantId("lesson_reflection", scope));
  assert.equal(binding.spec.source_ids.length, 2);
  assert.equal(binding.spec.source_ids.includes("source-timetable"), true);
  assert.equal(binding.spec.budget.max_calls, 4);
  assert.deepEqual(binding.spec.domains, ["lesson_reflection"]);
  value.timetable.push({ ...value.timetable[0], slot_id: "slot-2", period: 2 });
  assert.equal(control.buildCapabilityScopeCandidates("lesson_reflection", value)[0].slotCount, 2);
});

test("G4 binds registered per-lesson completion and accepted content sources", () => {
  const value = workspace();
  addFact(value, "lesson.completed", "source-completed");
  addFact(value, "lesson.observation", "source-observation");
  const completion = control.lessonReflectionCompletionSourceId(scope, "lesson-1");
  assert.deepEqual(control.lessonReflectionSourceIds(scope, value),
    [completion, "source-completed", "source-observation", "source-timetable"].sort());
  assert.notEqual(completion, control.lessonReflectionCompletionSourceId(scope, "lesson-2"));
  assert.notEqual(completion, control.lessonReflectionCompletionSourceId({ ...scope, classId: "class-2" }, "lesson-1"));
  value.fact_spine.accepted_facts[0].status = "rejected";
  value.fact_spine.observations[1].status = "withdrawn";
  assert.deepEqual(control.lessonReflectionSourceIds(scope, value), [completion, "source-timetable"].sort());
  value.timetable = [];
  assert.deepEqual(control.lessonReflectionSourceIds(scope, value), []);
});

test("G4 timetable bootstrap rejects missing source, clock, class and current term proof", () => {
  for (const change of [
    value => { value.timetable[0].source_ids = []; },
    value => { delete value.timetable[0].start_time; },
    value => { value.timetable[0].time_zone = "invalid/timezone"; },
    value => { value.timetable[0].class_id = "class-2"; },
    value => { value.fact_spine.entities[0].status = "deleted"; },
    value => { value.fact_spine.entities[1].status = "archived"; },
    value => { value.fact_spine.entities.push({ entity_id: "term-2", entity_kind: "term", status: "active" }); },
  ]) {
    const value = workspace({ lesson: false });
    change(value);
    assert.deepEqual(control.buildCapabilityScopeCandidates("lesson_reflection", value), []);
    assert.deepEqual(control.lessonReflectionSourceIds(scope, value), []);
    assert.throws(() => control.buildCapabilityGrantBinding("lesson_reflection", scope, value, now),
      error => error.code === "proactivity_scope_unavailable");
  }
});

test("G4 never grants foreign or obsolete registered lesson sources", () => {
  for (const change of [
    value => { value.timetable[0].subject = "english"; },
    value => { value.timetable[0].slot_id = "slot-2"; },
    value => { value.fact_spine.entities[2].status = "deleted"; },
    value => { value.fact_spine.entities[2].external_refs[0].namespace = "manual-lesson"; },
    value => { value.fact_spine.entities[2].external_refs[0].external_id = `2026-02-30:${"a".repeat(32)}`; },
    value => { value.fact_spine.entities[1].entity_id = "term-2"; },
  ]) {
    const value = workspace();
    addFact(value, "lesson.completed", "source-completed");
    change(value);
    assert.equal(control.lessonReflectionSourceIds(scope, value).some(source => source.startsWith("lesson-completion:")), false);
    assert.equal(control.lessonReflectionSourceIds(scope, value).includes("source-completed"), false);
  }
});

test("G4 accepted fact sources require the exact subject, class, term and lesson observation set", () => {
  for (const change of [
    value => { value.fact_spine.accepted_facts[0].subject_ref = "english"; },
    value => { value.fact_spine.accepted_facts[0].entity_id = "lesson-2"; },
    value => { value.fact_spine.accepted_facts[0].source_ids.push("source-forged"); },
    value => { value.fact_spine.accepted_facts[0].conflict_ids = ["unresolved"]; },
    value => { value.fact_spine.observations[0].entity_ids[0] = "class-other"; },
    value => { value.fact_spine.observations[0].entity_ids[1] = "term-other"; },
    value => { value.fact_spine.observations[0].entity_ids[2] = "lesson-other"; },
    value => {
      value.fact_spine.entities.push({ entity_id: "student-1", entity_kind: "student", status: "active" });
      value.fact_spine.observations[0].entity_ids.push("student-1");
    },
    value => { value.fact_spine.accepted_facts[0].confidence.basis = "inferred"; },
    value => { value.fact_spine.observations[0].source_kind = "calendar"; },
  ]) {
    const value = workspace();
    addFact(value, "lesson.completed", "source-completed");
    change(value);
    assert.equal(control.lessonReflectionSourceIds(scope, value).includes("source-completed"), false);
  }
});

test("G4 grant capacity includes timetable, completion and manual conversation sources", () => {
  const value = workspace();
  value.timetable[0].source_ids = Array.from({ length: 126 }, (_, index) => `source-${index}`);
  assert.equal(control.buildCapabilityGrantBinding("lesson_reflection", scope, value, now).spec.source_ids.length, 128);
  value.timetable[0].source_ids.push("overflow");
  assert.throws(() => control.buildCapabilityGrantBinding("lesson_reflection", scope, value, now),
    error => error.code === "proactivity_source_capacity");
});

async function historyFixture(context) {
  const coreRoot = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-history-pages-"));
  context.after(() => fs.rmSync(coreRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(coreRoot, "scripts"));
  fs.writeFileSync(path.join(coreRoot, "scripts/education_fact_store.mjs"), `
    export const state = { entities: [], hash: "initial" };
    export function loadEducationFactState() { return state; }
    export function educationFactStateHash(value) { return value.hash; }
  `);
  fs.writeFileSync(path.join(coreRoot, "scripts/capability_source_reflection_history.mjs"), `
    export const responses = { completion: [], content: [] };
    export const calls = [];
    export const hooks = {};
    function read(kind, input) {
      calls.push({ kind, ...input });
      hooks[kind]?.(input);
      return responses[kind].shift();
    }
    export function selectReflectionHistory(input) { return read("completion", input); }
    export function selectReflectionContentHistory(input) { return read("content", input); }
  `);
  const facts = await import(pathToFileURL(path.join(coreRoot, "scripts/education_fact_store.mjs")).href);
  const history = await import(pathToFileURL(path.join(coreRoot, "scripts/capability_source_reflection_history.mjs")).href);
  facts.state.entities = ["lesson-1", "lesson-2"].map((lessonId, index) => ({
    entity_id: lessonId, entity_kind: "lesson_occurrence", status: "active",
    aliases: [{ namespace: index ? "edupi-timetable-binding-v1" : "edupi-timetable-selection-v1",
      external_id: "occurrence", value: `slot-${index + 1}`, source_id: `timetable-${index + 1}` }],
  }));
  const page = (kind, entries = [], next = null) => ({
    status: "ready", read_only: true, external_send: false, entries, next_cursor: next,
    snapshot_hash: `sha256:${(kind === "completion" ? "a" : "b").repeat(64)}`,
  });
  const entry = { lesson_id: "lesson-1", slot_id: "slot-1", source_id: "completion-1" };
  history.responses.completion = [page("completion", [entry])];
  history.responses.content = [page("content", [{ ...entry, source_id: "content-1" }])];
  const grant = { id: "grant-1", scope: { class_id: scope.classId, subject: scope.subject },
    domains: ["lesson_reflection"], source_ids: ["completion-1", "content-1", "content-2", "timetable-1", "timetable-2"] };
  return { facts, history, page, entry,
    input: { coreRoot, memoryDir: coreRoot, rootRef: `sha256:${"c".repeat(64)}`, ownerId: "owner-1", scope, grant } };
}

test("G4 independently paginates completion and content snapshots including binding-only lessons", async context => {
  const { input, history, page, entry } = await historyFixture(context);
  history.responses.completion = [page("completion", [entry], "page2"), page("completion")];
  history.responses.content = [
    page("content", [{ ...entry, source_id: "content-1" }], "page2"),
    page("content", [{ lesson_id: "lesson-2", slot_id: "slot-2", source_id: "content-2" }]),
  ];
  assert.deepEqual(await control.readLessonReflectionHistorySourceIds(input), [...input.grant.source_ids].sort());
  assert.deepEqual(history.calls.map(({ kind, cursor }) => [kind, cursor]),
    [["completion", undefined], ["completion", "page2"], ["content", undefined], ["content", "page2"]]);
  for (const call of history.calls) {
    assert.deepEqual(call.binding, { ownerId: input.ownerId, domain: "lesson_reflection",
      grantId: input.grant.id, scope: input.grant.scope });
    assert.equal(call.root_ref, input.rootRef);
    assert.equal(call.page_size, 100);
    assert.equal(call.now, history.calls[0].now);
  }
});

test("G4 retains content-only history when completion history is empty", async context => {
  const { input, history, page } = await historyFixture(context);
  history.responses.completion = [page("completion")];
  assert.deepEqual(await control.readLessonReflectionHistorySourceIds(input), ["content-1", "timetable-1"]);
});

test("G4 rejects malformed content pages, cursors, grants and lesson selection", async context => {
  const changes = {
    held: fixture => { fixture.history.responses.content[0].status = "held"; },
    writable: fixture => { fixture.history.responses.content[0].read_only = false; },
    external: fixture => { fixture.history.responses.content[0].external_send = true; },
    entries: fixture => { fixture.history.responses.content[0].entries = null; },
    snapshot: fixture => { fixture.history.responses.content[0].snapshot_hash = ""; },
    cursor: fixture => { fixture.history.responses.content[0].next_cursor = ""; },
    "missing cursor": fixture => { delete fixture.history.responses.content[0].next_cursor; },
    "invalid cursor": fixture => { fixture.history.responses.content[0].next_cursor = "not a cursor"; },
    "ungranted content": fixture => { fixture.input.grant.source_ids.splice(1, 1); },
    "ungranted selection": fixture => {
      fixture.input.grant.source_ids = fixture.input.grant.source_ids.filter(source => source !== "timetable-1");
    },
    "foreign scope": fixture => { fixture.input.grant.scope.subject = "english"; },
    "foreign domain": fixture => { fixture.input.grant.domains = ["student_followup"]; },
    "missing selection": fixture => { fixture.facts.state.entities[0].aliases = []; },
    "ambiguous selection": fixture => {
      fixture.facts.state.entities[0].aliases.push({ ...fixture.facts.state.entities[0].aliases[0], value: "slot-2" });
    },
    "foreign selection": fixture => { fixture.facts.state.entities[0].aliases[0].value = "slot-foreign"; },
    "wrong entity kind": fixture => { fixture.facts.state.entities[0].entity_kind = "class"; },
    "inactive entity": fixture => { fixture.facts.state.entities[0].status = "deleted"; },
    "unknown lesson": fixture => { fixture.history.responses.content[0].entries[0].lesson_id = "lesson-missing"; },
    "reused content source": fixture => { fixture.history.responses.content[0].entries[0].source_id = "timetable-1"; },
  };
  for (const [name, change] of Object.entries(changes)) {
    await context.test(name, async nested => {
      const fixture = await historyFixture(nested);
      change(fixture);
      await assert.rejects(control.readLessonReflectionHistorySourceIds(fixture.input),
        error => error.code === "proactivity_response_invalid");
    });
  }
});

test("G4 rejects a changing snapshot, looping cursor or fact state during either history scan", async context => {
  for (const kind of ["completion", "content"]) {
    for (const failure of ["snapshot", "cursor", "factState"]) {
      await context.test(`${kind} ${failure}`, async nested => {
        const { input, history, facts, page, entry } = await historyFixture(nested);
        const first = page(kind, [entry], "page2");
        const second = page(kind, [entry]);
        history.responses[kind] = [first, second];
        if (failure === "snapshot") second.snapshot_hash = `sha256:${"d".repeat(64)}`;
        if (failure === "cursor") second.next_cursor = "page2";
        if (failure === "factState") history.hooks[kind] = () => { facts.state.hash = "changed"; };
        await assert.rejects(control.readLessonReflectionHistorySourceIds(input),
          error => error.code === "proactivity_response_invalid");
      });
    }
  }
});

test("G4 history sources require persisted owner-bound completions and exact lesson selection aliases",
  { skip: !process.env.EDUPI_CORE_ROOT }, async context => {
    const coreRoot = fs.realpathSync(process.env.EDUPI_CORE_ROOT);
    const dataRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-g4-history-sources-")));
    const home = path.join(dataRoot, ".edupi"), memoryDir = path.join(home, "memory");
    const environment = { EDUPI_PROJECT_ROOT: dataRoot, EDUPI_HOME: home, EDUPI_MEMORY_DIR: memoryDir,
      EDUPI_OUTPUT_DIR: path.join(home, "output"), EDUPI_LOCK_DIR: path.join(home, "locks") };
    const previous = new Map(Object.keys(environment).map(key => [key, process.env[key]]));
    Object.assign(process.env, environment);
    for (const directory of [memoryDir, environment.EDUPI_OUTPUT_DIR, environment.EDUPI_LOCK_DIR]) {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    }
    const load = file => import(pathToFileURL(path.join(coreRoot, "scripts", file)).href);
    let lease;
    context.after(async () => {
      await lease?.release();
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      fs.rmSync(dataRoot, { recursive: true, force: true });
    });
    const facts = await load("education_fact_store.mjs");
    const { prepareCoreRuntimeRoot } = await load("core_runtime_root.mjs");
    const { acquireCoreRuntimeWriterAdmission } = await load("core_runtime_writer_admission.mjs");
    const root = prepareCoreRuntimeRoot(dataRoot);
    lease = await acquireCoreRuntimeWriterAdmission({ root, kind: "legacy_history_sources_test" });
    const entity = (kind, externalId, namespace = "synthetic-history-sources", aliases = []) =>
      facts.registerEducationEntity({ memoryDir, now, entity: {
        entity_kind: kind, external_id: externalId, namespace, canonical_name: externalId, aliases,
      } }).entity;
    const classroom = entity("class", "selected-class"), foreign = entity("class", "foreign-class");
    const term = entity("term", "shared-term");
    const selectedScope = { classId: classroom.entity_id, subject: "math" };
    const completions = [], timetableSources = [], lessonIds = [], contentSources = [];
    for (let index = 0; index < 4; index++) {
      const classId = index === 2 ? foreign.entity_id : classroom.entity_id;
      const slot = `slot-${index}`, date = "2026-11-09";
      const externalId = `${date}:${createHash("sha256")
        .update(JSON.stringify([slot, classId, "math", term.entity_id])).digest("hex").slice(0, 32)}`;
      const timetableSource = `source-history-timetable-${index}`;
      const lesson = entity("lesson_occurrence", externalId, "edupi-timetable-occurrence-v1", [{
        namespace: index === 3 ? "edupi-timetable-binding-v1" : "edupi-timetable-selection-v1",
        external_id: externalId, value: slot, source_id: timetableSource,
      }]);
      const source = control.lessonReflectionCompletionSourceId({ classId, subject: "math" }, lesson.entity_id);
      completions.push(source);
      timetableSources.push(timetableSource);
      lessonIds.push(lesson.entity_id);
      const contentSource = `source-history-content-${index}`;
      contentSources.push(contentSource);
      const contentText = `合成课次 ${index} 的课堂观察`;
      const contentObservation = facts.captureEducationObservation({ memoryDir, now, observation: {
        source_kind: "teacher_utterance", source_id: contentSource, source_revision: "1",
        raw_text: contentText, observed_at: `${date}T02:00:00.000Z`, actor_ref: "owner-1",
        entity_ids: [classId, term.entity_id, lesson.entity_id],
      } }).observation;
      const contentFact = facts.proposeEducationFact({ memoryDir, now, fact: {
        entity_id: lesson.entity_id, fact_kind: "evidence", predicate: "lesson.observation", subject_ref: "math",
        value: contentText, confidence: { basis: "explicit", score: 1 },
        source_ids: [contentSource], observation_ids: [contentObservation.observation_id],
      } }).fact;
      if (index !== 3) facts.reviewEducationFact({ memoryDir, now, fact_id: contentFact.fact_id,
        expected_revision: contentFact.revision, decision: index === 1 ? "reject" : "accept", reviewer: "owner-1" });
      if (index === 3) continue;
      const completedAt = `${date}T02:00:00.000Z`;
      const observation = facts.captureEducationObservation({ memoryDir, now, observation: {
        source_kind: "teacher_utterance", source_id: source, source_revision: "1",
        raw_text: `合成课次已于 ${completedAt} 完成。`, observed_at: completedAt, actor_ref: "owner-1",
        entity_ids: [classId, term.entity_id, lesson.entity_id],
      } }).observation;
      const fact = facts.proposeEducationFact({ memoryDir, now, fact: {
        entity_id: lesson.entity_id, fact_kind: "evidence", predicate: "lesson.completed", subject_ref: "math",
        value: completedAt, confidence: { basis: "explicit", score: 1 },
        source_ids: [source], observation_ids: [observation.observation_id],
      } }).fact;
      facts.reviewEducationFact({ memoryDir, now, fact_id: fact.fact_id, expected_revision: fact.revision,
        decision: index === 1 ? "reject" : "accept", reviewer: "owner-1" });
    }
    const grant = { id: "history-grant", scope: { class_id: classroom.entity_id, subject: "math" },
      domains: ["lesson_reflection"], source_ids: [...completions, ...timetableSources, ...contentSources, "source-unrelated"] };
    const input = { coreRoot, memoryDir, rootRef: root.dataRootFingerprint, ownerId: "owner-1",
      scope: selectedScope, grant };
    const expected = [...completions.slice(0, 2), ...[0, 1, 3].flatMap(index => [timetableSources[index], contentSources[index]])].sort();
    assert.deepEqual(await control.readLessonReflectionHistorySourceIds(input), expected);
    assert.deepEqual(await control.readLessonReflectionHistorySourceIds({ ...input, ownerId: "owner-foreign" }), []);
    const withoutSelection = { ...grant, source_ids: grant.source_ids.filter(source => source !== timetableSources[0]) };
    assert.deepEqual(await control.readLessonReflectionHistorySourceIds({ ...input, grant: withoutSelection }),
      [completions[1], timetableSources[1], contentSources[1], timetableSources[3], contentSources[3]].sort());
    const withoutContent = { ...grant, source_ids: grant.source_ids.filter(source => !contentSources.includes(source)) };
    assert.deepEqual(await control.readLessonReflectionHistorySourceIds({ ...input, grant: withoutContent }),
      [...completions.slice(0, 2), ...timetableSources.slice(0, 2)].sort());
    assert.equal(expected.includes(completions[2]), false);
    assert.equal(expected.includes(completions[3]), false);
    assert.equal(new Set(lessonIds).size, 4);
    assert.deepEqual(await control.readLessonReflectionHistorySourceIds(input), expected);
    const persistedLesson = facts.loadEducationFactState({ memoryDir }).entities.find(item => item.entity_id === lessonIds[0]);
    const occurrence = persistedLesson.aliases.find(alias => alias.namespace === "edupi-timetable-occurrence-v1");
    const selection = persistedLesson.aliases.find(alias => alias.namespace === "edupi-timetable-selection-v1");
    entity("lesson_occurrence", occurrence.external_id, occurrence.namespace, [{ ...selection, value: "foreign-slot" }]);
    assert.deepEqual(await control.readLessonReflectionHistorySourceIds(input),
      [completions[1], timetableSources[1], contentSources[1], timetableSources[3], contentSources[3]].sort());
    await assert.rejects(control.readLessonReflectionHistorySourceIds({ ...input, scope: { ...selectedScope, subject: "english" } }),
      error => error.code === "proactivity_response_invalid");
  });
