import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const [conflicts, time] = await Promise.all([jiti.import("../lib/edupi-schedule-conflicts.ts"), jiti.import("../lib/edupi-calendar-form-time.ts")]);
const transpile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const code = transpile(fs.readFileSync(new URL("./EduPiScheduleConflictReview.tsx", import.meta.url), "utf8"));
const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : [];
const text = node => typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join("") : node?.props ? text(node.props.children) : "";
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function conflict(letter = "a", overrides = {}) {
  return conflicts.normalizeScheduleConflict({ conflict_id: `schedule_conflict_${letter.repeat(32)}`, kind: "calendar", canonical_id: `calendar-${letter}`, expected_revision: 2, expected_content_hash: `sha256:${"b".repeat(64)}`, expected_conflict_hash: `sha256:${"c".repeat(64)}`,
    canonical: { event_id: `calendar-${letter}`, date: "2026-10-30", end_date: null, name: `合成日程${letter}`, type: "meeting", confidence: "teacher_confirmed", notes: null, source_occurrence_ref: `occurrence-${letter}`, time_interval: { start: "2026-10-30T09:15+00:00", end: "2026-10-30T10:30+00:00", time_zone: "UTC" }, source_ids: ["desktop-calendar-manual-v1"], evidence_ids: ["evidence-old"] },
    candidate: { source_item_id: `calendar-${letter}`, date: "2026-10-30", end_date: null, name: `合成日程${letter}`, type: "meeting", confidence: "teacher_confirmed", notes: null, source_occurrence_ref: `occurrence-${letter}`, time_interval: { start: "2026-10-30T09:15-07:00", end: "2026-10-30T10:30-07:00", time_zone: "US/Pacific" }, source_ids: ["desktop-calendar-manual-v1"], evidence_ids: [`evidence-${letter}`] }, external_send: false, ...overrides });
}
const target = letter => ({ canonicalId: `calendar-${letter}`, occurrenceRef: `occurrence-${letter}`, evidenceIds: [`evidence-${letter}`] });
const page = (rows, nextCursor = null) => ({ conflicts: rows, nextCursor });

function mount(props = {}) {
  const slots = [], effects = new Map(), reads = [], resolutions = [], events = [], focused = [], focusListeners = new Set(), elements = new Map();
  let cursor = 0, dirty = false, tree, bootstrapCount = 0;
  const document = { body: {}, documentElement: {}, activeElement: null, addEventListener: (_name, fn) => focusListeners.add(fn), removeEventListener: (_name, fn) => focusListeners.delete(fn) };
  const move = target => { document.activeElement = target; for (const listener of focusListeners) listener({ target }); return target; };
  move(document.body);
  const root = { isConnected: true, ownerDocument: document, contains: element => element?.root === root && element.isConnected, querySelector(selector) {
    const key = { "[data-schedule-decision]": "decision", "[data-schedule-review-trigger]": "trigger", "[data-schedule-refresh]": "refresh", "[data-schedule-more]": "more" }[selector];
    if (selector === "[data-schedule-conflict]") return [...elements.values()].find(element => element.isConnected && element.key.startsWith("row:")) || null;
    assert.ok(key, selector); return elements.get(key)?.isConnected ? elements.get(key) : null;
  } };
  const same = (a, b) => a?.length === b?.length && a.every((value, i) => Object.is(value, b[i]));
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { value: typeof initial === "function" ? initial() : initial }; const slot = slots[index]; return [slot.value, value => { const next = typeof value === "function" ? value(slot.value) : value; if (!Object.is(next, slot.value)) { slot.value = next; dirty = true; } }]; },
    useRef(initial) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
    useId() { return hooks.useRef("synthetic-schedule-review").current; },
    useMemo(create, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = { deps, value: create() }; return slots[index].value; },
    useEffect(create, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) effects.set(index, { create, deps }); },
  };
  hooks.useCallback = (fn, deps) => hooks.useMemo(() => fn, deps);
  const jsx = (type, props) => ({ type, props: props || {} }), exports = {};
  const modules = { react: hooks, "react/jsx-runtime": { jsx, jsxs: jsx }, "@/lib/desktop-updater": { isTauriDesktop: () => true }, "@/lib/edupi-calendar-form-time": time,
    "@/lib/edupi-schedule-conflicts": { ...conflicts,
      readScheduleConflicts: async (_fetcher, _headers, after) => { const read = { ...deferred(), after }; reads.push(read); return read.promise; },
      bootstrapScheduleConflictReview: async () => { bootstrapCount += 1; },
      resolveScheduleConflict: async capture => { const resolution = { ...deferred(), capture }; resolutions.push(resolution); return resolution.promise; },
    },
  };
  vm.runInNewContext(code + "\nexports.ScheduleDetails = ScheduleDetails;", { exports, AbortController,
    fetch() { throw new Error("No live API calls allowed in this test"); },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    window: { dispatchEvent: event => { events.push(event); return true; } },
    require(name) { assert.ok(modules[name], name); return modules[name]; },
  });
  props = { enabled: true, scopeKey: "calendar-home", ...props };
  const commit = () => {
    if (tree?.props.ref) tree.props.ref.current = root;
    const visible = new Set();
    for (const node of nodes(tree)) {
      const p = node.props;
      const key = p["data-schedule-review-trigger"] ? "trigger" : p["data-schedule-conflict"] ? `row:${p["data-schedule-conflict"]}` : p["data-schedule-decision"] ? "decision" : p["data-schedule-refresh"] ? "refresh" : p["data-schedule-more"] ? "more" : node.type === "button" ? text(node) : null;
      if (!key) continue;
      visible.add(key);
      if (!elements.get(key)?.isConnected) elements.set(key, { key, root, isConnected: true, disabled: false, focus() { assert.ok(this.isConnected && !this.disabled, key); focused.push(key); move(this); } });
      elements.get(key).disabled = Boolean(p.disabled);
    }
    for (const [key, element] of elements) element.isConnected = visible.has(key);
    if (document.activeElement?.root === root && (!document.activeElement.isConnected || document.activeElement.disabled)) move(document.body);
  };
  const render = () => { let attempts = 0; do { assert.ok(attempts++ < 30); cursor = 0; dirty = false; tree = exports.EduPiScheduleConflictReview(props); commit(); const pending = [...effects]; effects.clear(); for (const [index, effect] of pending) { slots[index]?.cleanup?.(); slots[index] = { deps: effect.deps, cleanup: effect.create() }; } } while (dirty); return tree; };
  const f = { props, reads, resolutions, events, focused, focusListeners, document, elements, exports, render,
    setProps(next) { Object.assign(props, next); render(); },
    async flush() { for (let i = 0; i < 5; i++) { await tick(); if (dirty) render(); } },
    button(label) { const node = nodes(render()).find(node => node.type === "button" && text(node) === label); assert.ok(node, `button ${label}`); return node; },
    click(label) { const button = this.button(label); assert.ok(!button.props.disabled, label); const key = button.props["data-schedule-review-trigger"] ? "trigger" : button.props["data-schedule-refresh"] ? "refresh" : button.props["data-schedule-more"] ? "more" : label; elements.get(key)?.focus(); button.props.onClick(); render(); },
    row(index = 0) { const node = nodes(render()).filter(node => node.type === "button" && node.props["data-schedule-conflict"])[index]; assert.ok(node); elements.get(`row:${node.props["data-schedule-conflict"]}`).focus(); node.props.onClick(); render(); },
    select(value) { const node = nodes(render()).find(node => node.type === "input" && node.props.type === "radio" && node.props.value === value); assert.ok(node); elements.get("decision").focus(); node.props.onChange({ target: { value, checked: true } }); render(); },
    get selected() { return nodes(render()).find(node => node.type === "button" && node.props["data-schedule-conflict"] && node.props["aria-expanded"]); },
    get content() { return text(render()); }, get bootstrapCount() { return bootstrapCount; },
    outside() { return move({ name: "another control", isConnected: true }); }, body() { move(document.body); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); root.isConnected = false; },
  };
  render(); return f;
}

test("held receipt requests open the current review and select only its exact candidate without deciding", async () => {
  const f = mount({ request: { id: 1, target: target("b") } });
  assert.equal(f.reads.length, 1); assert.equal(f.content.includes("没有待核对安排"), false);
  f.reads[0].resolve(page([conflict("a"), conflict("b")])); await f.flush();
  assert.equal(f.selected.props["data-schedule-conflict"], conflict("b").conflictId);
  assert.equal(f.document.activeElement, f.elements.get("decision"));
  assert.equal(f.button("确认处理").props.disabled, true);
  assert.equal(f.resolutions.length, 0);
  assert.equal(f.focusListeners.size, 0);
});

test("missing, ambiguous or newer candidate evidence leaves the original list for explicit review", async () => {
  for (const rows of [[], [conflict("a")], [conflict("a"), { ...conflict("a"), conflictId: `schedule_conflict_${"d".repeat(32)}` }]]) {
    const f = mount({ request: { id: 1, target: rows.length === 1 ? { ...target("a"), evidenceIds: ["newer-evidence"] } : target("a") } });
    f.reads[0].resolve(page(rows)); await f.flush();
    assert.equal(f.selected, undefined);
    assert.equal(f.resolutions.length, 0);
    assert.equal(f.document.activeElement, rows.length ? f.elements.get(`row:${rows[0].conflictId}`) : f.elements.get("trigger"));
  }
});

test("automatic read can display its matching comparison without refocusing after the user moves focus", async () => {
  const f = mount({ request: { id: 1, target: target("a") } });
  const outside = f.outside(); f.reads[0].resolve(page([conflict("a")])); await f.flush();
  assert.equal(f.selected.props["data-schedule-conflict"], conflict("a").conflictId); assert.equal(f.document.activeElement, outside); assert.equal(f.focusListeners.size, 0);
});

test("an explicit no-focus held request opens and locates review without moving the current focus", async () => {
  const f = mount(), outside = f.outside();
  f.setProps({ request: { id: 1, target: target("a"), focus: false } });
  assert.equal(f.reads.length, 1); f.reads[0].resolve(page([conflict("a")])); await f.flush();
  assert.equal(f.selected.props["data-schedule-conflict"], conflict("a").conflictId);
  assert.equal(f.document.activeElement, outside); assert.deepEqual(f.focused, []); assert.equal(f.focusListeners.size, 0);
  assert.equal(f.resolutions.length, 0); assert.equal(f.button("确认处理").props.disabled, true);
});

test("new scope and newer held requests cancel stale reads and cannot reopen over a new draft", async () => {
  const f = mount({ request: { id: 1, target: target("a") } });
  f.setProps({ scopeKey: "new-calendar-draft", request: null });
  const outside = f.outside(); f.reads[0].resolve(page([conflict("a")])); await f.flush();
  assert.equal(f.content.includes("合成日程a"), false); assert.equal(f.content.includes("没有待核对安排"), false); assert.equal(f.document.activeElement, outside);
  f.setProps({ scopeKey: "calendar-home", request: { id: 2, target: target("b") } });
  assert.equal(f.reads.length, 2); f.reads[1].resolve(page([conflict("b")])); await f.flush();
  assert.equal(f.selected.props["data-schedule-conflict"], conflict("b").conflictId);
  const old = mount({ request: { id: 10, target: target("a") } });
  old.setProps({ request: { id: 11, target: target("b") } }); assert.equal(old.reads.length, 2);
  old.reads[0].resolve(page([conflict("a")])); await old.flush(); assert.equal(old.selected, undefined);
  old.reads[1].resolve(page([conflict("b")])); await old.flush(); assert.equal(old.selected.props["data-schedule-conflict"], conflict("b").conflictId);
});

test("read errors retain a safe refresh action and retry can locate the requested candidate", async () => {
  const f = mount({ request: { id: 1, target: target("a") } });
  f.reads[0].reject(new Error("synthetic offline")); await f.flush();
  assert.match(f.content, /待核对安排暂不可用/); assert.equal(f.document.activeElement, f.elements.get("refresh"));
  f.click("刷新"); f.reads[1].resolve(page([conflict("a")])); await f.flush();
  assert.equal(f.selected.props["data-schedule-conflict"], conflict("a").conflictId);
  assert.equal(f.document.activeElement, f.elements.get("decision"));
});

test("the existing explicit read path bootstraps only an uninitialized owner", async () => {
  const f = mount(); f.click("核对安排"); f.reads[0].reject(new conflicts.ScheduleConflictError("owner_uninitialized")); await f.flush();
  assert.equal(f.bootstrapCount, 1); assert.equal(f.reads.length, 2);
  f.reads[1].resolve(page([conflict("a")])); await f.flush();
  assert.equal(f.document.activeElement, f.elements.get(`row:${conflict("a").conflictId}`));
});

test("all valid decisions still require a teacher choice and preserve the exact owner CAS", async () => {
  for (const decision of ["keep_existing", "replace_with_candidate", "keep_both_distinct"]) {
    const item = conflict("a"); item.candidate = { ...item.candidate, source_item_id: "different-item", source_occurrence_ref: "another-occurrence" };
    const f = mount(); f.click("核对安排"); f.reads[0].resolve(page([item])); await f.flush(); f.row();
    const options = nodes(f.render()).filter(node => node.type === "input" && node.props.type === "radio");
    assert.deepEqual(options.map(node => node.props.value), ["keep_existing", "replace_with_candidate", "keep_both_distinct"]);
    assert.ok(options.every(node => node.props.checked === false));
    assert.equal(f.button("确认处理").props.disabled, true); assert.equal(f.resolutions.length, 0);
    f.select(decision); const confirm = f.button("确认处理").props.onClick; f.click("确认处理"); confirm(); f.render();
    assert.equal(f.resolutions.length, 1);
    const capture = f.resolutions[0].capture;
    assert.equal(capture.decision, decision); assert.equal(capture.canonicalId, item.canonicalId);
    assert.equal(capture.expectedRevision, item.expectedRevision); assert.equal(capture.expectedContentHash, item.expectedContentHash); assert.equal(capture.expectedConflictHash, item.expectedConflictHash);
    f.resolutions[0].resolve({ replayed: false }); await f.flush();
    assert.equal(f.events[0].type, "edupi-education-refresh");
    assert.equal(f.events[0].detail.scheduleResolution.evidenceIds[0], "evidence-a");
    assert.match(f.content, /已核对/);
    f.reads[1].resolve(page([])); await f.flush();
    assert.equal(f.document.activeElement, f.elements.get("trigger")); assert.equal(f.focusListeners.size, 0);
  }
});

test("same occurrence keeps its original restriction and uncertain retry sends the same captured decision", async () => {
  const f = mount({ request: { id: 1, target: target("a") } }); f.reads[0].resolve(page([conflict("a")])); await f.flush();
  assert.equal(nodes(f.render()).some(node => node.type === "input" && node.props.value === "keep_both_distinct"), false);
  f.select("replace_with_candidate"); f.click("确认处理"); const capture = f.resolutions[0].capture;
  f.resolutions[0].reject(new Error("response lost")); await f.flush();
  assert.match(f.content, /用原决定重试/); assert.equal(f.document.activeElement, f.elements.get("trigger"));
  f.click("重试原决定"); assert.equal(f.resolutions[1].capture, capture);
  assert.equal(JSON.stringify(f.resolutions[0].capture), JSON.stringify(f.resolutions[1].capture));
  f.resolutions[1].resolve({ replayed: true }); await f.flush(); f.reads[1].resolve(page([])); await f.flush();
  assert.match(f.content, /已核对/); assert.equal(f.events.length, 1);
});

test("stale CAS refreshes explicitly and successful resolution with failed list refresh remains truthful", async () => {
  const stale = mount({ request: { id: 1, target: target("a") } }); stale.reads[0].resolve(page([conflict("a")])); await stale.flush();
  stale.select("keep_existing"); stale.click("确认处理"); stale.resolutions[0].reject(new conflicts.ScheduleConflictError("schedule_conflict_stale")); await stale.flush();
  assert.match(stale.content, /来源或决定已变化/); assert.equal(stale.events.length, 0); assert.equal(stale.document.activeElement, stale.elements.get("refresh"));
  stale.click("刷新"); stale.reads[1].resolve(page([])); await stale.flush();
  const f = mount({ request: { id: 1, target: target("a") } }); f.reads[0].resolve(page([conflict("a"), conflict("b")])); await f.flush();
  f.select("keep_existing"); f.click("确认处理"); f.resolutions[0].resolve({ replayed: false }); await f.flush();
  f.reads[1].reject(new Error("synthetic refresh failure")); await f.flush();
  assert.match(f.content, /已核对/); assert.match(f.content, /决定已记录/); assert.equal(f.content.includes("合成日程a"), false); assert.match(f.content, /合成日程b/);
  assert.equal(f.document.activeElement, f.elements.get("refresh"));
});

test("confirm and paginated reads do not steal focus after a scope or intentional focus change", async () => {
  const f = mount({ request: { id: 1, target: target("a") } }); f.reads[0].resolve(page([conflict("a")])); await f.flush();
  f.select("keep_existing"); f.click("确认处理"); const outside = f.outside(); f.body(); f.focused.length = 0;
  f.setProps({ scopeKey: "new-draft", request: null }); f.resolutions[0].resolve({ replayed: false }); await f.flush(); f.reads[1].resolve(page([])); await f.flush();
  assert.deepEqual(f.focused, []); assert.notEqual(f.document.activeElement, outside); assert.equal(f.document.activeElement, f.document.body);
  const more = mount(); more.click("核对安排"); const cursor = `schedule_conflict_${"d".repeat(32)}`;
  more.reads[0].resolve(page([conflict("a")], cursor)); await more.flush(); more.click("更多");
  assert.equal(more.reads[1].after, cursor); more.reads[1].reject(new Error("synthetic page failure")); await more.flush();
  assert.match(more.content, /更多安排暂不可用/); assert.equal(more.document.activeElement, more.elements.get("more"));
  more.click("更多"); assert.equal(more.reads[2].after, cursor); more.reads[2].resolve(page([conflict("a"), conflict("b")])); await more.flush();
  assert.equal(nodes(more.render()).filter(node => node.props["data-schedule-conflict"]).length, 2);
  assert.equal(more.document.activeElement, more.elements.get("trigger"));
});

test("unmount drops pending read UI and removes focus listeners", async () => {
  const f = mount({ request: { id: 1, target: target("a") } });
  assert.equal(f.focusListeners.size, 1); f.unmount(); assert.equal(f.focusListeners.size, 0);
  f.reads[0].resolve(page([conflict("a")])); await f.flush(); assert.equal(f.events.length, 0); assert.deepEqual(f.focused, []);
});

test("a confirmed decision may refresh shared owner state after leaving without restoring the old UI", async () => {
  const f = mount({ request: { id: 1, target: target("a") } }); f.reads[0].resolve(page([conflict("a")])); await f.flush();
  f.select("keep_existing"); f.click("确认处理"); f.focused.length = 0; f.unmount();
  f.resolutions[0].resolve({ replayed: false }); await f.flush();
  assert.equal(f.events.length, 1); assert.equal(f.reads.length, 1); assert.equal(f.focusListeners.size, 0); assert.deepEqual(f.focused, []);
});

test("comparison rows use unchanged wall clocks and hide only default technical source ids", () => {
  const f = mount(), item = conflict("a"), before = JSON.stringify(item);
  const original = f.exports.ScheduleDetails({ conflict: item, item: item.canonical, title: "原安排" });
  const candidate = f.exports.ScheduleDetails({ conflict: item, item: item.candidate, title: "新来源" });
  assert.match(text(original), /09:15.*10:30.*UTC/); assert.match(text(candidate), /09:15.*10:30.*US\/Pacific/);
  assert.doesNotMatch(text(original), /T09:15|desktop-calendar-manual-v1|未设置/);
  assert.match(nodes(original).find(node => node.type === "strong").props.title, /desktop-calendar-manual-v1/);
  const external = { ...item.candidate, source_ids: ["学校通知"] };
  assert.match(text(f.exports.ScheduleDetails({ conflict: item, item: external, title: "新来源" })), /来源：学校通知/);
  assert.equal(JSON.stringify(item), before);
});

const panelSource = ts.createSourceFile("EduPiEducationPanel.tsx", fs.readFileSync(new URL("./EduPiEducationPanel.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const printer = ts.createPrinter();
function expression(find) {
  let found;
  function visit(node) { if (find(node)) found = node; ts.forEachChild(node, visit); }
  visit(panelSource); assert.ok(found);
  return printer.printNode(ts.EmitHint.Expression, found, panelSource);
}
function panelHandlers(receipt = { status: "held", evidence_ids: ["evidence-a"] }) {
  const listeners = new Map(), requests = [], messages = [];
  let current = null, refreshes = 0;
  const exports = {}, context = { exports, scheduleResolutionMatchesTarget: conflicts.scheduleResolutionMatchesTarget,
    useCallback: fn => fn, submitEducationIntake: async body => { requests.push(body); return { receipt }; },
    setMaterialStagingMessage: value => { current = typeof value === "function" ? value(current) : value; messages.push(current); },
    setReviewMessage() {}, loadWorkspace: async () => { refreshes += 1; },
    window: { addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) },
  };
  const callback = expression(node => ts.isCallExpression(node) && node.parent && ts.isVariableDeclaration(node.parent) && node.parent.name.getText(panelSource) === "importCalendarEvent");
  const setup = expression(node => ts.isArrowFunction(node) && node.parent && ts.isCallExpression(node.parent) && node.parent.expression.getText(panelSource) === "useEffect" && node.getText(panelSource).includes('window.addEventListener("edupi-education-refresh"'));
  vm.runInNewContext(transpile(`exports.importCalendar = ${callback}; exports.setup = ${setup};`), context);
  const cleanup = exports.setup();
  return { exports, listeners, requests, messages, cleanup, get message() { return current; }, get refreshes() { return refreshes; } };
}

test("the real parent calendar callback returns receipt status and evidence without changing its wire payload", async () => {
  const f = panelHandlers();
  const event = { eventId: "calendar-a", date: "2026-10-30", endDate: null, name: "合成日程", type: "meeting", notes: null, sourceOccurrenceRef: "occurrence-a", startAt: "2026-10-30T09:15-07:00", endAt: "2026-10-30T10:30-07:00", timeZone: "US/Pacific", location: null };
  const result = await f.exports.importCalendar(event);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { status: "held", evidenceIds: ["evidence-a"] });
  assert.equal(f.requests[0].events[0].sourceOccurrenceRef, event.sourceOccurrenceRef); assert.equal(f.requests[0].events[0].timeInterval.start, event.startAt);
  assert.deepEqual(Object.keys(f.requests[0]).sort(), ["events", "kind"]);
  assert.equal(f.message.sticky, true); assert.equal(f.message.scheduleReviewTarget.canonicalId, "calendar-a");
  f.cleanup(); assert.equal(f.listeners.size, 0);
});

test("parent refresh updates only the matching held message and preserves newer candidate feedback", async () => {
  const receipt = { status: "held", evidence_ids: ["evidence-a"] };
  const f = panelHandlers(receipt), event = { eventId: "calendar-a", sourceOccurrenceRef: "occurrence-a" };
  await f.exports.importCalendar(event);
  const refresh = f.listeners.get("edupi-education-refresh");
  refresh({ type: "edupi-education-refresh", detail: { scheduleResolution: { kind: "calendar", canonicalId: "calendar-a", occurrenceRef: "occurrence-a", evidenceIds: ["old-evidence"] } } });
  assert.equal(f.message.sticky, true);
  refresh({ type: "edupi-education-refresh", detail: { scheduleResolution: { kind: "calendar", canonicalId: "calendar-a", occurrenceRef: "occurrence-a", evidenceIds: ["evidence-a"] } } });
  assert.deepEqual(JSON.parse(JSON.stringify(f.message)), { tone: "success", text: "日程已核对。" });
  receipt.evidence_ids = ["evidence-newer"];
  await f.exports.importCalendar(event);
  refresh({ type: "edupi-education-refresh", detail: { scheduleResolution: { kind: "calendar", canonicalId: "calendar-a", occurrenceRef: "occurrence-a", evidenceIds: ["evidence-a"] } } });
  assert.equal(f.message.sticky, true); assert.deepEqual(Array.from(f.message.scheduleReviewTarget.evidenceIds), ["evidence-newer"]);
  await f.exports.importCalendar({ eventId: "calendar-b", sourceOccurrenceRef: "occurrence-b" });
  refresh({ type: "edupi-education-refresh", detail: { scheduleResolution: { kind: "calendar", canonicalId: "calendar-a", occurrenceRef: "occurrence-a", evidenceIds: ["evidence-a"] } } });
  assert.equal(f.message.scheduleReviewTarget.canonicalId, "calendar-b"); assert.equal(f.message.sticky, true);
  await tick(); assert.equal(f.refreshes, 4); f.cleanup();
});

test("a parent load snapshot does not reopen a locally closed calendar before URL acknowledgement", async () => {
  const calendarModel = await jiti.import("../lib/edupi-calendar-model.ts");
  const oldEducation = { calendar: [{ id: "calendar-a", name: "合成日程a", date: "2026-10-30", endDate: null, source: "teacher", preparationStatus: "read_only" }], tasks: [], timetable: [] };
  const nextEducation = { ...oldEducation, calendar: oldEducation.calendar.map(event => ({ ...event, preparationStatus: "hold" })) };
  const oldParams = new URLSearchParams({ edupi: "1", module: "calendar", calendarKind: "calendar", calendarItem: "calendar-a", date: "2026-10-30" });
  const context = { exports: {}, education: nextEducation, routeView: "calendar", searchParams: oldParams,
    appliedCalendarLink: { current: { key: JSON.stringify(["calendar", "calendar-a", "2026-10-30"]), education: oldEducation } }, calendarSelectionRef: { current: null },
    calendarSelectionFromLink: calendarModel.calendarSelectionFromLink, URLSearchParams, router: { replace() {} }, selection: null,
    setCalendarSelection(selection) { context.selection = selection; },
  };
  const syncLink = expression(node => ts.isArrowFunction(node) && node.parent && ts.isCallExpression(node.parent) && node.parent.expression.getText(panelSource) === "useEffect" && node.getText(panelSource).includes("const clearCalendarLink"));
  vm.runInNewContext(transpile(`exports.sync = ${syncLink};`), context);
  const request = { id: 1, target: target("a") }, f = mount({ request });
  assert.equal(f.reads.length, 1);
  // loadWorkspace queued new education while router.replace still exposes the old calendar URL.
  context.exports.sync(); assert.equal(context.selection, null);
  const newerFocus = f.outside();
  // The same parent's URL effect later observes the acknowledged detail close.
  context.searchParams = new URLSearchParams({ edupi: "1", module: "calendar" });
  context.exports.sync(); assert.equal(context.selection, null);
  f.setProps({ request, scopeKey: "calendar-home" });
  assert.equal(f.reads.length, 1, "a local close must not be interrupted by the old URL during refresh");
  f.reads[0].resolve(page([conflict("a")])); await f.flush();
  assert.equal(f.selected.props["data-schedule-conflict"], conflict("a").conflictId);
  assert.equal(f.document.activeElement, newerFocus);
  assert.equal(f.resolutions.length, 0);
  // After the close has been acknowledged, an authoritative deep link can open the same item again.
  context.searchParams = oldParams; context.exports.sync(); assert.equal(context.selection.sourceId, "calendar-a");
  context.calendarSelectionRef.current = context.selection;
  context.education = { ...nextEducation, calendar: nextEducation.calendar.map(event => ({ ...event, name: "合成新名称" })) };
  context.exports.sync(); assert.equal(context.selection.title, "合成新名称");
});

test("an interrupted held read can resume its same request without adopting a newer opener", async () => {
  const request = { id: 1, target: target("a") }, f = mount({ request });
  f.setProps({ request: null, scopeKey: "temporary-detail" }); const outside = f.outside();
  f.setProps({ request, scopeKey: "calendar-home" });
  assert.equal(f.reads.length, 2);
  f.reads[0].resolve(page([conflict("b")])); await f.flush(); assert.equal(f.selected, undefined);
  f.reads[1].resolve(page([conflict("a")])); await f.flush();
  assert.equal(f.selected.props["data-schedule-conflict"], conflict("a").conflictId);
  assert.equal(f.document.activeElement, outside); assert.equal(f.resolutions.length, 0);
});

test("the real parent delete handler closes only its still-selected calendar target", async () => {
  const callback = expression(node => ts.isCallExpression(node) && node.parent && ts.isVariableDeclaration(node.parent) && node.parent.name.getText(panelSource) === "deleteEntity");
  for (const scenario of ["current", "other", "cancel"]) {
    const api = deferred(), writes = [], closes = [], context = { exports: {}, useCallback: fn => fn, deleteBusy: null,
      education: { capabilities: { entityDelete: { enabled: true, targetKinds: ["calendar"] } }, workspaceResourcesUnavailable: false },
      calendarSelectionRef: { current: { kind: "calendar", sourceId: "calendar-a" } }, deleteResolver: { current: null },
      setDeleteLabel() {}, setDeleteBusy(value) { context.deleteBusy = value; }, setMaterialStagingMessage() {},
      deleteEducationEntity: async (kind, id) => { writes.push({ kind, id }); return api.promise; }, commitEducationSnapshot() {},
      stopTaskTracking() {}, closeTaskDetail() {}, setSelectedTaskKey() {}, setSelectedStudentId() {},
      selectCalendarItem(value) { closes.push(value); context.calendarSelectionRef.current = value; },
    };
    vm.runInNewContext(transpile(`exports.delete = ${callback};`), context);
    const pending = context.exports.delete("calendar", "calendar-a", "合成日程a");
    if (scenario === "cancel") { context.deleteResolver.current(false); assert.equal(await pending, false); assert.equal(writes.length, 0); }
    else {
      context.deleteResolver.current(true); await tick();
      if (scenario === "other") context.calendarSelectionRef.current = { kind: "calendar", sourceId: "calendar-b" };
      api.resolve({ data: { workspaceResourcesUnavailable: false }, target: { id: "calendar-a" } });
      assert.equal(await pending, true);
      assert.deepEqual(writes, [{ kind: "calendar", id: "calendar-a" }]);
    }
    assert.equal(closes.length, scenario === "current" ? 1 : 0, scenario);
    if (scenario === "other") assert.equal(context.calendarSelectionRef.current.sourceId, "calendar-b");
  }
});
