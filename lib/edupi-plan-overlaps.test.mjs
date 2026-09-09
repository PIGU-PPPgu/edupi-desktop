import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { createPlanOverlapService, planOverlapPairs, createSnapshotBoundPlanCalendar } = await createJiti(import.meta.url).import("./edupi-plan-overlaps.ts");
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
    intake: async (_command, deps) => check("update",deps),
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
