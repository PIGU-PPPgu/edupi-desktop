import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { renderToStaticMarkup } from "react-dom/server";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } });
const config = await jiti.import("./edupi-proactivity-config.ts"), control = await jiti.import("./edupi-proactivity-control.ts"),
  safeMode = await jiti.import("./safe-mode.ts"), supervisor = await jiti.import("./edupi-runtime-supervisor.ts"),
  client = await jiti.import("./edupi-proactivity-client.ts"), recipient = await jiti.import("./edupi-parent-recipient-client.ts"),
  views = await jiti.import("../components/EduPiParentRecipientConfirmation.tsx");
const domains = ["calendar_administration", "lesson_reflection", "parent_communication"];
function workspace() {
  const entities = ["class", "term", "lesson_occurrence", "student", "parent"].map(kind => ({ entity_id: `${kind}-1`, entity_kind: kind, canonical_name: kind, status: "active" }));
  const observations = [], accepted_facts = [];
  for (const [domain, predicate, kinds, entity, subject] of [
    ["admin", "admin.deadline", ["class", "term"], "class", null],
    ["reflection", "lesson.observation", ["class", "term", "lesson_occurrence"], "class", "math"],
    ["parent", "communication.fact", ["class", "term", "student", "parent"], "student", "math"],
  ]) {
    observations.push({ observation_id: `observation-${domain}`, source_id: `source-${domain}`, source_kind: "teacher_utterance",
      observed_at: "2026-11-05T00:00:00.000Z", entity_ids: kinds.map(kind => `${kind}-1`), status: "active" });
    accepted_facts.push({ fact_id: `fact-${domain}`, fact_kind: "evidence", predicate, entity_id: `${entity}-1`, status: "accepted", subject_ref: subject,
      source_ids: [`source-${domain}`], observation_ids: [`observation-${domain}`], conflict_ids: [], confidence: { basis: "explicit" } });
  }
  return { fact_spine: { projection_kind: "education_fact_v1", external_send: false, entities, observations, accepted_facts, conflicts: [] } };
}
test("scope selection admits resolved conflicts and rejects missing or unresolved conflicts", () => {
  const current = workspace();
  current.fact_spine.accepted_facts[0].conflict_ids = ["conflict-admin"];
  current.fact_spine.conflicts = [{ conflict_id: "conflict-admin", status: "resolved" }];
  assert.equal(control.buildCapabilityScopeCandidates("calendar_administration", current).length, 1);
  current.fact_spine.conflicts[0].status = "open";
  assert.deepEqual(control.buildCapabilityScopeCandidates("calendar_administration", current), []);
  current.fact_spine.conflicts = [];
  assert.deepEqual(control.buildCapabilityScopeCandidates("calendar_administration", current), []);
});
test("three default-off configs persist independent exact grants and a stop fences only its domain", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-capability-config-")), stateDir = path.join(root, "state"), dataRoot = path.join(root, "data"), foreignRoot = path.join(root, "foreign");
  for (const dir of [stateDir, dataRoot, foreignRoot]) fs.mkdirSync(dir, { mode: 0o700 });
  try {
    for (const domain of domains) {
      const options = { stateDir, dataRoot, domain, env: { EDUPI_AMBIENT_PLANNING: "1" } };
      assert.equal(config.readEduPiProactivityActivation(options).enabled, false);
      const scope = { classId: "class-1", subject: domain === "calendar_administration" ? "administration" : "math" };
      config.writeEduPiProactivityConfig({ enabled: true, scope, grantId: `grant-${domain}`, ownerId: "owner-1" }, options);
      assert.equal(config.readEduPiProactivityActivation(options).ownerId, "owner-1");
      assert.equal(config.readEduPiProactivityActivation({ ...options, dataRoot: foreignRoot }).enabled, false);
    }
    config.writeEduPiProactivityStopIntent({ scope: { classId: "class-1", subject: "math" }, grantId: "grant-parent_communication" }, { stateDir, dataRoot, domain: "parent_communication" });
    assert.equal(config.readEduPiProactivityActivation({ stateDir, dataRoot, domain: "parent_communication" }).configurationStatus, "stop_pending");
    for (const domain of domains.slice(0, 2)) assert.equal(config.readEduPiProactivityActivation({ stateDir, dataRoot, domain }).enabled, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test("capability selection requires accepted exact tagged scope and retains G5 recipient confirmation as a later explicit gate", () => {
  const current = workspace();
  for (const domain of domains) {
    const scopes = control.buildCapabilityScopeCandidates(domain, current); assert.equal(scopes.length, 1); assert.equal(scopes[0].ready, true);
    const binding = control.buildCapabilityGrantBinding(domain, scopes[0], current, "2026-10-20T00:00:00.000Z");
    assert.deepEqual(binding.spec.domains, [domain]); assert.deepEqual(binding.spec.actions, ["update"]);
    assert.equal(binding.spec.source_ids.length, 1); assert.equal(binding.spec.scope.class_id, "class-1");
  }
  assert.equal(new Set(domains.map(domain => control.proactivityConversationId(domain))).size, 3);
  const crossed = workspace(); crossed.fact_spine.entities.push({ entity_id: "student-other", entity_kind: "student", status: "active" });
  crossed.fact_spine.observations.at(-1).entity_ids.push("student-other");
  assert.deepEqual(control.buildCapabilityScopeCandidates("parent_communication", crossed), []);
  const stale = workspace(); stale.fact_spine.observations[1].status = "stale";
  assert.deepEqual(control.buildCapabilityScopeCandidates("lesson_reflection", stale), []);
});

test("calendar administration grant includes only accepted current calendar deadline sources", () => {
  const current = workspace();
  current.fact_spine.entities.push({ entity_id: "calendar-event-1", entity_kind: "calendar_event", status: "active" });
  current.fact_spine.observations[0].source_kind = "calendar";
  current.fact_spine.observations[0].entity_ids.push("calendar-event-1");
  current.fact_spine.accepted_facts[0].value = "行政材料截止 2026-11-08T09:00:00.000Z";
  const scope = { classId: "class-1", subject: "administration" };
  const binding = control.buildCapabilityGrantBinding("calendar_administration", scope, current, "2026-11-05T00:00:00.000Z");
  assert.deepEqual(binding.spec.source_ids.slice(1), ["source-admin"]);
  assert.equal(binding.spec.source_ids.length, 2, "the existing manual conversation remains explicitly granted");
  current.fact_spine.accepted_facts[0].entity_id = "calendar-event-1";
  assert.deepEqual(control.buildCapabilityScopeCandidates("calendar_administration", current).map(item => item.classId), ["class-1"]);
  assert.deepEqual(control.buildCapabilityGrantBinding("calendar_administration", scope, current, "2026-11-05T00:00:00.000Z").spec.source_ids.slice(1), ["source-admin"]);
  const valid = structuredClone(current);
  const duplicate = structuredClone(valid);
  duplicate.fact_spine.observations.push({ ...duplicate.fact_spine.observations[0], observation_id: "observation-admin-2", source_id: "source-admin-2" });
  duplicate.fact_spine.accepted_facts.push({ ...duplicate.fact_spine.accepted_facts[0], fact_id: "fact-admin-2",
    source_ids: ["source-admin-2"], observation_ids: ["observation-admin-2"] });
  assert.deepEqual(control.calendarAdministrativeSourceIds(scope, duplicate), [], "two deadlines for one event cannot pre-authorize either source");
  const tooLong = structuredClone(valid);
  tooLong.fact_spine.accepted_facts[0].value = `${"x".repeat(1001)}2026-11-08T09:00:00.000Z`;
  assert.deepEqual(control.calendarAdministrativeSourceIds(scope, tooLong), []);
  const crossDay = structuredClone(valid);
  crossDay.fact_spine.observations.push({ ...crossDay.fact_spine.observations[0], observation_id: "observation-admin-2",
    source_id: "source-admin-2", observed_at: "2026-11-06T00:00:00.000Z" });
  crossDay.fact_spine.accepted_facts[0].source_ids.push("source-admin-2");
  crossDay.fact_spine.accepted_facts[0].observation_ids.push("observation-admin-2");
  assert.deepEqual(control.calendarAdministrativeSourceIds(scope, crossDay), []);
  const capacity = structuredClone(valid);
  const originalEvent = capacity.fact_spine.entities.find(item => item.entity_kind === "calendar_event");
  const originalObservation = capacity.fact_spine.observations[0], originalFact = capacity.fact_spine.accepted_facts[0];
  for (let index = 2; index <= 128; index++) {
    const eventId = `calendar-event-${index}`, observationId = `observation-admin-${index}`, sourceId = `source-admin-${index}`;
    capacity.fact_spine.entities.push({ ...originalEvent, entity_id: eventId });
    capacity.fact_spine.observations.push({ ...originalObservation, observation_id: observationId, source_id: sourceId,
      entity_ids: originalObservation.entity_ids.map(id => id === originalEvent.entity_id ? eventId : id) });
    capacity.fact_spine.accepted_facts.push({ ...originalFact, fact_id: `fact-admin-${index}`, entity_id: eventId,
      source_ids: [sourceId], observation_ids: [observationId] });
  }
  assert.equal(control.calendarAdministrativeSourceIds(scope, capacity).length, 128);
  assert.throws(() => control.buildCapabilityGrantBinding("calendar_administration", scope, capacity, "2026-11-05T00:00:00.000Z"),
    (error) => error?.code === "proactivity_source_capacity", "128 calendar sources cannot silently remove manual conversation authority");
  const withinCapacity = structuredClone(capacity);
  withinCapacity.fact_spine.entities.pop(); withinCapacity.fact_spine.observations.pop(); withinCapacity.fact_spine.accepted_facts.pop();
  const at127 = control.buildCapabilityGrantBinding("calendar_administration", scope, withinCapacity, "2026-11-05T00:00:00.000Z");
  assert.equal(at127.spec.source_ids.length, 128);
  assert.match(at127.spec.source_ids[0], /^conversation:/);
  assert.equal(at127.spec.source_ids.includes("source-admin-127"), true);
  capacity.fact_spine.entities.push({ ...originalEvent, entity_id: "calendar-event-129" });
  capacity.fact_spine.observations.push({ ...originalObservation, observation_id: "observation-admin-129", source_id: "source-admin-129",
    entity_ids: originalObservation.entity_ids.map(id => id === originalEvent.entity_id ? "calendar-event-129" : id) });
  capacity.fact_spine.accepted_facts.push({ ...originalFact, fact_id: "fact-admin-129", entity_id: "calendar-event-129",
    source_ids: ["source-admin-129"], observation_ids: ["observation-admin-129"] });
  assert.throws(() => control.buildCapabilityGrantBinding("calendar_administration", scope, capacity, "2026-11-05T00:00:00.000Z"),
    (error) => error?.code === "proactivity_source_capacity");
  for (const changed of [
    () => { current.fact_spine.observations[0].status = "stale"; },
    () => { current.fact_spine.observations[0].status = "active"; current.fact_spine.accepted_facts[0].value = "日期待定"; },
    () => { current.fact_spine.accepted_facts[0].value = "截止 2026-11-08T09:00:00.000Z"; current.fact_spine.observations[0].source_kind = "teacher_utterance"; },
  ]) {
    changed();
    assert.equal(control.calendarAdministrativeSourceIds(scope, current).length, 0);
  }
});
test("G3 bootstrap is isolated macOS only and snapshots full scope and owner", () => {
  assert.equal(safeMode.canStartEduPiCapabilityDrafts("darwin", {}), false);
  assert.equal(safeMode.canStartEduPiCapabilityDrafts("darwin", { EDUPI_DESKTOP_ISOLATED_CANARY: "1" }), true);
  for (const platform of ["win32", "linux"]) assert.equal(safeMode.canStartEduPiCapabilityDrafts(platform, { EDUPI_DESKTOP_ISOLATED_CANARY: "1" }), false);
  const previous = process.env.EDUPI_DESKTOP_ISOLATED_CANARY; process.env.EDUPI_DESKTOP_ISOLATED_CANARY = "1";
  const platformProperty = Object.getOwnPropertyDescriptor(process, "platform");
  try {
    const activation = { enabled: true, source: "desktop_canary", configurationStatus: "ready", scope: { classId: "class-1", subject: "math" }, grantId: "grant-1", ownerId: "owner-1" };
    for (const platform of ["win32", "linux"]) {
      Object.defineProperty(process, "platform", { ...platformProperty, value: platform });
      assert.equal(supervisor.g3BindingForActivation("lesson_reflection", activation), null);
    }
    Object.defineProperty(process, "platform", { ...platformProperty, value: "darwin" });
    const binding = supervisor.g3BindingForActivation("lesson_reflection", activation);
    assert.ok(Object.isFrozen(binding) && Object.isFrozen(binding.scope));
    activation.scope.classId = "other"; activation.grantId = "other";
    assert.deepEqual(binding, { domain: "lesson_reflection", grantId: "grant-1", ownerId: "owner-1", scope: { class_id: "class-1", subject: "math" } });
    assert.equal(supervisor.g3BindingForActivation("lesson_reflection", { ...activation, enabled: false }), null);
    const admin = supervisor.g3BindingForActivation("calendar_administration", { ...activation,
      scope: { classId: "class-1", subject: "administration" }, grantId: "grant-admin", ownerId: "owner-1" });
    assert.equal(supervisor.sourceAdministrativeGoalsForBindings([binding]), false);
    assert.equal(supervisor.sourceAdministrativeGoalsForBindings([{ ...admin, ownerId: undefined }]), false);
    assert.equal(supervisor.sourceAdministrativeGoalsForBindings([admin]), true);
    delete process.env.EDUPI_DESKTOP_ISOLATED_CANARY;
    assert.equal(supervisor.sourceAdministrativeGoalsForBindings([admin]), false);
  } finally {
    Object.defineProperty(process, "platform", platformProperty);
    if (previous === undefined) delete process.env.EDUPI_DESKTOP_ISOLATED_CANARY; else process.env.EDUPI_DESKTOP_ISOLATED_CANARY = previous;
  }
});
test("capability state has no model budget and cannot claim model execution", () => {
  for (const domain of domains) {
    const state = { ok: true, externalSend: false, activation: { enabled: true, source: "desktop_canary", configurationStatus: "ready", scope: { classId: "class-1", subject: "math" }, updatedAt: null },
      scopes: [], grant: { status: "active", grantVersion: 1, endsAt: "2099-01-01T00:00:00.000Z", modelBudget: null },
      capabilities: { ambientPlanning: true, ownerIntent: true, attentionDelivery: true, teacherFeedback: true, capabilityDrafts: true }, limits: { domain, durationDays: 7, maxModelCalls: 0 } };
    assert.doesNotThrow(() => client.parseEduPiProactivityState(state));
    assert.throws(() => client.parseEduPiProactivityState({ ...state, limits: { ...state.limits, maxModelCalls: 1 } }));
  }
});
test("recipient preview exposes the proved student, recipient and term with one confirmation action", () => {
  const entry = { sessionId: "session-1", clientRequestId: "request-1", occurredAt: "2026-10-20T00:00:00.000Z", status: "ready", reason: "recipient_confirmation_required",
    candidate: { root_ref: `sha256:${"a".repeat(64)}`, owner_id: "owner-1", message_ref: `owner_message:${"b".repeat(64)}`, grant_id: "grant-1", grant_version: 1,
      scope: { class_id: "class-1", subject: "math" }, student: { entity_id: "student-1", label: "隔离学生", revision: 1 }, recipient: { entity_id: "parent-1", label: "隔离联系人", revision: 1 },
      term: { entity_id: "term-1", label: "隔离学期", revision: 1 }, evidence_ids: ["source-1"], source_fingerprint: `sha256:${"c".repeat(64)}`, confirmed_fact_id: null } };
  assert.equal(recipient.parseParentRecipientEntries({ ok: true, entries: [entry], externalSend: false }).length, 1);
  const html = renderToStaticMarkup(views.EduPiParentRecipientConfirmationView({ entries: [entry], busy: null, message: null, onConfirm() {} }));
  assert.match(html, /隔离学生.*隔离联系人.*隔离学期/); assert.match(html, /确认收件人/);
  assert.equal((html.match(/<button/g) ?? []).length, 1); assert.doesNotMatch(html, /发送|外发/);
  assert.throws(() => recipient.parseParentRecipientEntries({ ok: true, entries: [{ ...entry, status: "held" }], externalSend: false }));
});
