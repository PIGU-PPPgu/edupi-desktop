import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { createPlanOverlapService, planOverlapPairs, createSnapshotBoundPlanCalendar } = await createJiti(import.meta.url).import("./edupi-plan-overlaps.ts");
const { buildEducationIntakeCommandEnvelope } = await createJiti(import.meta.url).import("./edupi-education-intake.ts");
const event = (id, overrides = {}) => ({ id, date: "2026-09-10", endDate: null, dateStatus: "explicit", name: "家长会", type: "meeting", source: "calendar_import", confidence: "teacher_confirmed", notes: `备注${id}`, preparationStatus: "read_only", ...overrides });
function harness(events = [event("a"), event("b")]) {
  let calendar = structuredClone(events), cache = null, calls = 0, writes = 0, deletes = 0, failDelete = false, failModel = false;
  const deps = {
    readCalendar: async () => structuredClone(calendar), load: async () => structuredClone(cache), save: async value => { cache = structuredClone(value); },
    classify: async pairs => { calls++; if (failModel) throw Error("offline"); return JSON.stringify(pairs.map(pair => ({ id: pair.id, kind: "duplicate", reason: "名称和日期相同，建议核对" }))); },
    update: async value => { writes++; const index = calendar.findIndex(item => item.id === value.event_id); calendar[index] = { ...calendar[index], date: value.date, endDate: value.end_date, name: value.name, notes: value.notes, type: value.type, confidence: value.confidence }; },
    remove: async id => { deletes++; if (failDelete) throw Error("删除暂不可用"); calendar = calendar.filter(item => item.id !== id); },
  };
  return { run: createPlanOverlapService(deps), deps, get calendar() { return calendar; }, get counts() { return { calls, writes, deletes }; }, set failDelete(value) { failDelete = value; }, set failModel(value) { failModel = value; } };
}
test("candidate selection bounds date intersections and nearby same names, excludes distinct classes and timetable", () => {
  assert.equal(planOverlapPairs([event("a", { date: "2026-09-01", endDate: "2026-09-12" }), event("b")]).length, 1);
  assert.equal(planOverlapPairs([event("a"), event("b", { date: "2026-09-16" })]).length, 1);
  assert.equal(planOverlapPairs([event("a", { name: "七年级1班家长会" }), event("b", { name: "七年级2班家长会" })]).length, 0);
  assert.equal(planOverlapPairs([event("a", { source: "timetable" }), event("b")]).length, 0);
  assert.equal(planOverlapPairs([event("a", { date: "2026-99-99" }), event("b")]).length, 0);
  assert.equal(planOverlapPairs(Array.from({ length: 30 }, (_, index) => event(String(index)))).length, 20);
});
test("AI results cached by calendar version and separate decisions survive rescans", async () => {
  const h = harness();
  const first = await h.run({ action: "scan" });
  assert.equal(first.suggestions.length, 1);
  assert.equal(first.needsScan, false);
  await h.run({ action: "scan" });
  assert.equal(h.counts.calls, 1);
  await h.run({ action: "keep_separate", id: first.suggestions[0].id });
  h.calendar.push(event("c", { date: "2026-12-01" }));
  assert.equal((await h.run({ action: "scan" })).suggestions[0].status, "separate");
});
test("model failure is retryable and unbound model ids are rejected", async () => {
  const h = harness(); h.failModel = true;
  assert.equal((await h.run({ action: "scan" })).needsScan, true);
  assert.ok((await h.run()).error);
  h.failModel = false;
  assert.equal((await h.run({ action: "scan" })).error, undefined);
  const bad = harness(); bad.deps.classify = async () => JSON.stringify([{ id: "invented", kind: "duplicate", reason: "错误" }]);
  const result = await bad.run({ action: "scan" });
  assert.ok(result.error); assert.deepEqual(result.suggestions, []);
});
test("merge keeps selected fields and both notes, soft-deletes only after reread", async () => {
  const h = harness([event("a"), event("b", { name: "家长交流会", notes: "第二份备注" })]);
  const { suggestions } = await h.run({ action: "scan" });
  const result = await h.run({ action: "merge", id: suggestions[0].id, keepId: "a" });
  assert.equal(result.suggestions[0].status, "merged");
  assert.equal(h.calendar.length, 1); assert.equal(h.calendar[0].name, "家长会");
  assert.equal(h.calendar[0].notes, "备注a 合并计划：家长交流会 第二份备注");
  assert.deepEqual(h.counts, { calls: 1, writes: 1, deletes: 1 });
});
test("interrupted second write survives new service and retries deletion without duplicating notes", async () => {
  const h = harness(); const { suggestions } = await h.run({ action: "scan" });
  h.failDelete = true;
  await assert.rejects(h.run({ action: "merge", id: suggestions[0].id }), /删除/);
  const resumed = createPlanOverlapService(h.deps);
  const state = await resumed(); assert.equal(state.suggestions[0].merging, true); assert.equal(state.suggestions[0].keepId, "a");
  h.failDelete = false;
  assert.equal((await resumed({ action: "merge", id: suggestions[0].id })).suggestions[0].status, "merged");
  assert.deepEqual(h.counts, { calls: 1, writes: 1, deletes: 2 });
});
test("more than twenty pairs require successive scans and never report complete early", async () => {
  const h = harness(Array.from({ length: 8 }, (_, index) => event(String(index))));
  const first = await h.run({ action: "scan" });
  assert.equal(first.pairs, 28); assert.equal(first.remaining, 8); assert.equal(first.needsScan, true);
  const second = await h.run({ action: "scan" });
  assert.equal(second.remaining, 0); assert.equal(second.needsScan, false); assert.equal(second.suggestions.length, 28);
  await h.run({ action: "scan" }); assert.equal(h.counts.calls, 2);
});
test("source changes and oversized notes never delete the source", async () => {
  const h = harness(); const { suggestions } = await h.run({ action: "scan" });
  h.calendar[0].notes = "新来源";
  await assert.rejects(h.run({ action: "merge", id: suggestions[0].id }), /变化/);
  assert.equal(h.counts.deletes, 0);
  const long = harness([event("a", { notes: "甲".repeat(700) }), event("b", { notes: "乙".repeat(700) })]);
  const scan = await long.run({ action: "scan" });
  await assert.rejects(long.run({ action: "merge", id: scan.suggestions[0].id }), /1000/);
  assert.deepEqual(long.counts, { calls: 1, writes: 0, deletes: 0 });
});
test("source mutation during partial merge blocks retry without deleting", async () => {
  const h = harness(); const { suggestions } = await h.run({ action: "scan" }); h.failDelete = true;
  await assert.rejects(h.run({ action: "merge", id: suggestions[0].id }));
  h.calendar.find(item => item.id === "b").notes = "老师新修改"; h.failDelete = false;
  await assert.rejects(h.run({ action: "merge", id: suggestions[0].id }), /变化/);
  assert.equal(h.counts.deletes, 1);
});
test("cancel interrupted merge preserves persisted edits and removes durable intent", async () => {
  for (const action of ["keep_separate", "ignore"]) {
    const h = harness();
    const { suggestions } = await h.run({ action: "scan" });
    const id = suggestions[0].id;
    h.failDelete = true;
    await assert.rejects(h.run({ action: "merge", id }));
    h.calendar.find(item => item.id === "b").notes = "老师新修改";
    const before = structuredClone(h.calendar), counts = h.counts;
    await createPlanOverlapService(h.deps)({ action, id });
    const saved = await h.deps.load();
    assert.equal(saved.intents[id], undefined);
    assert.equal(saved.suggestions[0].status, action === "ignore" ? "ignored" : "separate");
    assert.equal(saved.suggestions[0].merging, undefined);
    assert.deepEqual(h.calendar, before);
    assert.deepEqual(h.counts, counts);
    assert.match(h.calendar[0].notes, /备注a 备注b/);
    await assert.rejects(createPlanOverlapService(h.deps)({ action: "merge", id }), /已经处理/);
    assert.deepEqual(h.counts, counts);
  }
});
test("normalized Core notes allow merge and resume old multiline intent without another write", async () => {
  const h = harness([event("a",{notes:"介绍学习计划"}),event("b",{name:"家长交流会",notes:"收集家长问题"})]);
  const update = h.deps.update;
  h.deps.update = value => update({...value,notes:value.notes?.replace(/\s+/g," ").trim() || null});
  const { suggestions } = await h.run({action:"scan"});
  h.failDelete = true;
  await assert.rejects(h.run({action:"merge",id:suggestions[0].id}),/删除/);
  const cache = await h.deps.load();
  cache.intents[suggestions[0].id].target.notes = "介绍学习计划\n\n合并计划：家长交流会\n\n收集家长问题";
  await h.deps.save(cache);
  const scan = await h.run({action:"scan"});
  assert.equal(scan.remaining,0);
  assert.equal(scan.suggestions.length,1);
  assert.equal(scan.suggestions[0].merging,true);
  assert.equal(h.counts.calls,1);
  h.failDelete = false;
  const result = await createPlanOverlapService(h.deps)({action:"merge",id:suggestions[0].id});
  assert.equal(result.suggestions[0].status,"merged");
  assert.equal(h.calendar[0].notes,"介绍学习计划 合并计划：家长交流会 收集家长问题");
  assert.equal(h.counts.writes,1);
});
test("production calendar adapter binds writes to inspected snapshot and refreshes binding on reread", async () => {
  let revision = 1, reads = 0;
  const accepted = [], attempted = [];
  const check = async (operation, dependencies) => {
    const snapshot = await dependencies.readSnapshot();
    attempted.push([operation,snapshot.payload.snapshot_id]);
    assert.equal(snapshot.envelope.snapshot_id,snapshot.payload.snapshot_id);
    assert.deepEqual(snapshot.roots,{runtime:{root:"runtime"},dataRoot:{root:"data"}});
    if (snapshot.payload.snapshot_id !== `snapshot-${revision}`) throw new Error("stale_snapshot");
    accepted.push(operation);
    revision++;
  };
  const adapter = createSnapshotBoundPlanCalendar({
    readSnapshot: async () => { reads++; return {envelope:{snapshot_id:`snapshot-${revision}`},payload:{snapshot_id:`snapshot-${revision}`},runtime:{root:"runtime"},dataRoot:{root:"data"},calendar:[event("a")]}; },
    project: async snapshot => ({calendar:snapshot.calendar}),
    intake: async () => { throw new Error("unexpected calendar reimport"); },
    updateNotes: async (input, deps) => {
      assert.deepEqual(input, { canonicalId: "a", expectedNotes: "备注a", notes: null, evidenceIds: ["plan-merge-a"] });
      return check("update", { readSnapshot: async () => deps.snapshot });
    },
    deleteEntity: async (_input, deps) => check("delete",deps),
  });
  const input = {event_id:"a",date:"2026-09-10",end_date:null,name:"家长会",type:"meeting",confidence:"teacher_confirmed",notes:null};
  await adapter.readCalendar();
  revision++; // Another calendar editor commits after our comparison.
  await assert.rejects(adapter.update(input),/stale_snapshot/);
  await assert.rejects(adapter.remove("b"),/stale_snapshot/);
  assert.equal(reads,1);
  assert.deepEqual(accepted,[]);
  await adapter.readCalendar();
  await adapter.update(input);
  await adapter.readCalendar(); // The service rereads after updating notes.
  await adapter.remove("b");
  assert.deepEqual(accepted,["update","delete"]);
  assert.deepEqual(attempted,[["update","snapshot-1"],["delete","snapshot-1"],["update","snapshot-2"],["delete","snapshot-3"]]);
});

const timed = (id, overrides = {}) => event(id, {
  date: "2026-03-08", occurrenceRef: `manual-${id}`, startsAt: "2026-03-08T03:15-07:00",
  endsAt: "2026-03-08T04:30-07:00", timeZone: "US/Pacific", location: "西楼 203", ...overrides,
});
const typedFields = value => ({ source_occurrence_ref: value.source_occurrence_ref, time_interval: value.time_interval, location: value.location });
const intakeEnvelope = input => buildEducationIntakeCommandEnvelope({ snapshotId: "snapshot-plan-test", command: {
  command_type: "import_calendar", source: { source_id: "plan-merge-test", source_kind: "teacher_message", source_hash: null, evidence_ids: ["plan-merge-test"] }, events: [input],
} });

for (const keepId of ["a", "b"]) test(`merge serializes the selected ${keepId} occurrence without replacing its wall clock, zone, location or ref`, async () => {
  const events = [timed("a"), timed("b", { startsAt: "2026-03-08T09:15+08:00", endsAt: "2026-03-08T10:30+08:00", timeZone: "Asia/Shanghai", location: "东楼 204" })];
  const selected = events.find(item => item.id === keepId);
  const h = harness(events), update = h.deps.update;
  let sent;
  h.deps.update = async input => {
    sent = structuredClone(input);
    assert.deepEqual(typedFields(input), { source_occurrence_ref: selected.occurrenceRef,
      time_interval: { start: selected.startsAt, end: selected.endsAt, time_zone: selected.timeZone }, location: selected.location });
    assert.equal(input.event_id, selected.id); assert.equal(input.end_date, null);
    assert.equal(intakeEnvelope(input).contract_version, "1.2");
    await update(input);
  };
  const scan = await h.run({ action: "scan" });
  const result = await h.run({ action: "merge", id: scan.suggestions[0].id, keepId });
  assert.equal(result.suggestions[0].status, "merged"); assert.equal(h.calendar.length, 1);
  assert.deepEqual({ ...h.calendar[0], notes: selected.notes }, selected);
  assert.ok(sent.notes.includes("备注a") && sent.notes.includes("备注b"));
  assert.deepEqual(h.counts, { calls: 1, writes: 1, deletes: 1 });
});

test("bound all-day and located legacy events retain their existing v1.2 fields without inventing an interval", async () => {
  for (const [occurrenceRef, location] of [["ics-all-day-ref", "教学楼"], ["ics-all-day-no-location", null], [null, "教学楼"]]) {
    const keep = event("a", { occurrenceRef, startsAt: null, endsAt: null, timeZone: null, location });
    const h = harness([keep, event("b")]), update = h.deps.update;
    h.deps.update = async input => {
      assert.equal(input.source_occurrence_ref, occurrenceRef || undefined);
      assert.equal(input.location, location); assert.equal(Object.hasOwn(input, "time_interval"), false);
      assert.equal(intakeEnvelope(input).contract_version, "1.2"); await update(input);
    };
    const scan = await h.run({ action: "scan" }); await h.run({ action: "merge", id: scan.suggestions[0].id });
    assert.equal(h.calendar[0].occurrenceRef, occurrenceRef); assert.equal(h.calendar[0].startsAt, null);
  }
});

test("legacy all-day null fields keep the date-only durable target without manufacturing occurrence identity", async () => {
  const h = harness([event("a", { occurrenceRef: null, startsAt: null, endsAt: null, timeZone: null, location: null }), event("b")]);
  const update = h.deps.update;
  h.deps.update = async input => {
    for (const key of ["source_occurrence_ref", "time_interval", "location"]) assert.equal(Object.hasOwn(input, key), false);
    assert.equal(intakeEnvelope(input).contract_version, "1.1"); await update(input);
  };
  const scan = await h.run({ action: "scan" }); await h.run({ action: "merge", id: scan.suggestions[0].id });
  assert.equal(h.calendar[0].occurrenceRef, null); assert.deepEqual(h.counts, { calls: 1, writes: 1, deletes: 1 });
});

for (const [field, changed] of [
  ["startsAt", { startsAt: "2026-03-08T03:30-07:00" }],
  ["endsAt", { endsAt: "2026-03-08T05:00-07:00" }],
  ["timeZone", { startsAt: "2026-03-08T03:15+08:00", endsAt: "2026-03-08T04:30+08:00", timeZone: "Asia/Shanghai" }],
  ["location", { location: "老师新选教室" }],
  ["occurrenceRef", { occurrenceRef: "other-reviewed-occurrence" }],
]) test(`a concurrent ${field} change after the notes write prevents deleting the other plan`, async () => {
  const h = harness([timed("a"), event("b", { date: "2026-03-08" })]), update = h.deps.update;
  h.deps.update = async input => { await update(input); Object.assign(h.calendar.find(item => item.id === "a"), changed); };
  const scan = await h.run({ action: "scan" });
  await assert.rejects(h.run({ action: "merge", id: scan.suggestions[0].id }), /核对/);
  assert.equal(h.calendar.length, 2); assert.deepEqual(h.counts, { calls: 1, writes: 1, deletes: 0 });
});

test("a held typed update keeps both plans until the target is actually present in the reread", async () => {
  const h = harness([timed("a"), event("b", { date: "2026-03-08" })]);
  h.deps.update = async () => {}; // Core can accept a candidate as held without changing the canonical event.
  const scan = await h.run({ action: "scan" });
  await assert.rejects(h.run({ action: "merge", id: scan.suggestions[0].id }), /核对/);
  assert.equal(h.calendar.length, 2); assert.equal(h.counts.deletes, 0);
});

test("typed durable merge intent retries deletion without a second note or occurrence write", async () => {
  const h = harness([timed("a"), event("b", { date: "2026-03-08" })]);
  const scan = await h.run({ action: "scan" }); h.failDelete = true;
  await assert.rejects(h.run({ action: "merge", id: scan.suggestions[0].id }), /删除/);
  const intent = (await h.deps.load()).intents[scan.suggestions[0].id];
  assert.deepEqual(typedFields(intent.target), { source_occurrence_ref: "manual-a", time_interval: {
    start: "2026-03-08T03:15-07:00", end: "2026-03-08T04:30-07:00", time_zone: "US/Pacific" }, location: "西楼 203" });
  h.failDelete = false;
  const result = await createPlanOverlapService(h.deps)({ action: "merge", id: scan.suggestions[0].id });
  assert.equal(result.suggestions[0].status, "merged"); assert.equal(h.calendar[0].occurrenceRef, "manual-a");
  assert.deepEqual(h.counts, { calls: 1, writes: 1, deletes: 2 });
});

test("a pre-v1.2 durable target cannot silently approve a typed plan on resume", async () => {
  const h = harness([timed("a"), event("b", { date: "2026-03-08" })]);
  const scan = await h.run({ action: "scan" }); h.failDelete = true;
  await assert.rejects(h.run({ action: "merge", id: scan.suggestions[0].id }), /删除/);
  const cache = await h.deps.load(), id = scan.suggestions[0].id;
  for (const key of ["source_occurrence_ref", "time_interval", "location"]) delete cache.intents[id].target[key];
  await h.deps.save(cache); h.failDelete = false;
  const before = structuredClone(h.calendar), counts = h.counts;
  await assert.rejects(createPlanOverlapService(h.deps)({ action: "merge", id }), /变化/);
  assert.deepEqual(h.calendar, before); assert.deepEqual(h.counts, counts);
  assert.ok((await h.deps.load()).intents[id], "retain the paused intent until an explicit cancellation");
  await createPlanOverlapService(h.deps)({ action: "keep_separate", id });
  assert.equal((await h.deps.load()).intents[id], undefined);
  assert.deepEqual(h.calendar, before); assert.deepEqual(h.counts, counts);
});

test("production calendar adapter explicitly requests the bound v1.2 occurrence projection", async () => {
  const requested = [];
  const adapter = createSnapshotBoundPlanCalendar({
    readSnapshot: async options => { requested.push(options); return { calendar: [timed("a")], runtime: {}, dataRoot: {}, envelope: {}, payload: {} }; },
    project: async snapshot => ({ calendar: snapshot.calendar }),
  });
  await adapter.readCalendar(); await adapter.readCalendar();
  assert.deepEqual(requested, [{ scheduleOccurrenceVersion: "1.2" }, { scheduleOccurrenceVersion: "1.2" }]);
});

test("production merge updates only canonical notes and never reimports an occurrence under a new issuer", async () => {
  const original = timed("canonical-original", { source: "teacher" });
  const calls = [];
  const adapter = createSnapshotBoundPlanCalendar({
    readSnapshot: async () => ({ calendar: [original], runtime: { root: "core" }, dataRoot: { root: "test-data" },
      envelope: { snapshot_id: "bound-snapshot" }, payload: { snapshot_id: "bound-snapshot" } }),
    project: async snapshot => ({ calendar: snapshot.calendar }),
    updateNotes: async (input, dependencies) => calls.push({ input, snapshot: dependencies.snapshot }),
    intake: async () => { throw new Error("unexpected calendar reimport"); },
  });
  await adapter.readCalendar();
  await adapter.update({ event_id: original.id, notes: "双方备注", source_occurrence_ref: original.occurrenceRef,
    time_interval: { start: original.startsAt, end: original.endsAt, time_zone: original.timeZone }, location: original.location });
  assert.deepEqual(calls[0].input, { canonicalId: original.id, expectedNotes: original.notes, notes: "双方备注", evidenceIds: [`plan-merge-${original.id}`] });
  assert.equal(calls[0].snapshot.payload.snapshot_id, "bound-snapshot");
  assert.deepEqual(calls[0].snapshot.roots, { runtime: { root: "core" }, dataRoot: { root: "test-data" } });
  await assert.rejects(adapter.update({ event_id: "missing", notes: "not sent" }), /变化/);
  assert.equal(calls.length, 1);
});
