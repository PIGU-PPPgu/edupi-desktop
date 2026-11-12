import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import React, { act } from "react";
import { create } from "react-test-renderer";
import ts from "typescript";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const require = createRequire(import.meta.url);
const source = await readFile(new URL("./EduPiReflectionHistory.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const output = {};
vm.runInNewContext(compiled, {
  exports: output, AbortController, Date, Error, Intl,
  require: name => name === "@/lib/edupi-reflection-client"
    ? {
      readReflectionHistory: () => { throw new Error("Unexpected default completion request"); },
      readReflectionContentHistory: () => { throw new Error("Unexpected default content request"); },
    } : require(name),
});
const { EduPiReflectionHistory } = output;
const completionEntry = (factId, changes = {}) => ({
  lesson_id: "lesson-old", date: "2026-09-01", slot_id: "slot-old", term_id: "term-old",
  fact_id: factId, revision: 2, status: "rejected", source_id: "source-old", source_revision: "1",
  observation_id: "observation-old", raw_text: `隔离历史记录 ${factId}\n2026-09-01T10:00:00.000Z`,
  completed_at: "2026-09-01T10:00:00.000Z", created_at: "2026-09-01T10:00:00.000Z",
  updated_at: "2026-09-02T10:00:00.000Z", last_review: { action: "reject", reviewed_at: "2026-09-02T10:00:00.000Z" },
  ...changes,
});
const contentEntry = (factId, changes = {}) => {
  const entry = completionEntry(factId);
  delete entry.completed_at;
  return { ...entry, raw_text: `隔离历史记录 ${factId}`, predicate: "lesson.observation",
    value: `隔离历史记录 ${factId}`, ...changes };
};
const page = (entries, nextCursor = null, snapshotHash = "snapshot-a") => ({ entries, nextCursor, snapshotHash });
const changed = () => Object.assign(new Error("历史快照改变"), { code: "history_changed" });
const text = node => typeof node === "string" ? node : (node.children || []).map(text).join("");
const button = (root, label) => root.findAllByType("button").find(item => text(item) === label);
const historyToggle = (root, label) => root.findAllByType("button").find(item =>
  typeof item.props["aria-expanded"] === "boolean" && text(item).startsWith(label));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
};
async function mountHistory(props) {
  let renderer;
  await act(async () => { renderer = create(React.createElement(EduPiReflectionHistory, props)); });
  return renderer;
}

for (const kind of ["completion", "content"]) {
  const serviceProp = kind === "content" ? "contentService" : "service";
  const label = kind === "content" ? "课堂内容历史" : "历史记录";
  const entry = kind === "content" ? contentEntry : completionEntry;
  const toggle = root => historyToggle(root, label);
  const mount = service => mountHistory({ [serviceProp]: service });
  const historyTest = (name, run) => test(`${kind}: ${name}`, run);

historyTest("history loads only after opening and renders old facts read-only across pages", async () => {
  const calls = [];
  const renderer = await mount({ async read(cursor, signal) {
    calls.push({ cursor, signal });
    return cursor ? page([entry("fact-2", { status: "accepted", last_review: { action: "accept", reviewed_at: "2026-09-02T10:00:00.000Z" } })])
      : page([entry("fact-1")], "cursor-2");
  } });
  try {
    assert.equal(calls.length, 0);
    await act(async () => toggle(renderer.root).props.onClick());
    assert.match(text(renderer.root), /2026-09-01.*slot-old/);
    assert.match(text(renderer.root), /已撤回或驳回/);
    assert.match(text(renderer.root), /term-old/);
    assert.match(text(renderer.root), /source-old/);
    assert.equal(renderer.root.findAllByType("textarea").length, 0);
    assert.equal(renderer.root.findAllByType("input").length, 0);
    await act(async () => button(renderer.root, "加载更多").props.onClick());
    assert.deepEqual(calls.map(call => call.cursor), [undefined, "cursor-2"]);
    assert.equal(renderer.root.findAllByType("li").length, 2);
    assert.match(text(renderer.root), /已确认/);
    assert.equal(button(renderer.root, "加载更多"), undefined);
    assert.equal(renderer.root.findAllByType("button").length, 2);
  } finally { await act(async () => renderer.unmount()); }
});

historyTest("changed snapshot clears previous pages before one automatic first-page reload", async () => {
  const reload = deferred(), calls = [];
  const renderer = await mount({ async read(cursor) {
    calls.push(cursor);
    if (calls.length === 1) return page([entry("old")], "cursor-old");
    if (calls.length === 2) throw changed();
    return reload.promise;
  } });
  try {
    await act(async () => toggle(renderer.root).props.onClick());
    await act(async () => button(renderer.root, "加载更多").props.onClick());
    assert.deepEqual(calls, [undefined, "cursor-old", undefined]);
    assert.equal(renderer.root.findAllByType("li").length, 0);
    assert.match(text(renderer.root), /历史记录已变化，正在重新读取/);
    await act(async () => reload.resolve(page([entry("fresh")], null, "snapshot-b")));
    assert.match(text(renderer.root), /隔离历史记录 fresh/);
    assert.doesNotMatch(text(renderer.root), /隔离历史记录 old/);
  } finally { await act(async () => renderer.unmount()); }
});

historyTest("repeated history changes stop after one automatic retry and allow explicit retry", async () => {
  const calls = [];
  const renderer = await mount({ async read(cursor) {
    calls.push(cursor);
    if (calls.length <= 2) throw changed();
    return page([entry("recovered")]);
  } });
  try {
    await act(async () => toggle(renderer.root).props.onClick());
    assert.equal(calls.length, 2);
    assert.match(text(renderer.root), /历史记录仍在变化，请重试/);
    assert.doesNotMatch(text(renderer.root), /暂无历史记录/);
    await act(async () => button(renderer.root, "重试").props.onClick());
    assert.equal(calls.length, 3);
    assert.match(text(renderer.root), /隔离历史记录 recovered/);
  } finally { await act(async () => renderer.unmount()); }
});

historyTest("mismatched page hashes restart pagination instead of mixing snapshots", async () => {
  const calls = [];
  const renderer = await mount({ async read(cursor) {
    calls.push(cursor);
    if (calls.length === 1) return page([entry("old")], "cursor-2");
    if (calls.length === 2) return page([entry("mixed")], null, "snapshot-b");
    return page([entry("fresh")], null, "snapshot-b");
  } });
  try {
    await act(async () => toggle(renderer.root).props.onClick());
    await act(async () => button(renderer.root, "加载更多").props.onClick());
    assert.deepEqual(calls, [undefined, "cursor-2", undefined]);
    assert.equal(renderer.root.findAllByType("li").length, 1);
    assert.match(text(renderer.root), /隔离历史记录 fresh/);
    assert.doesNotMatch(text(renderer.root), /隔离历史记录 (old|mixed)/);
  } finally { await act(async () => renderer.unmount()); }
});

historyTest("pagination failures preserve prior rows and retry the same cursor without duplicate requests", async () => {
  const pending = deferred(), calls = [];
  const renderer = await mount({ async read(cursor) {
    calls.push(cursor);
    if (calls.length === 1) return page([entry("first")], "cursor-2");
    if (calls.length === 2) return pending.promise;
    return page([entry("second")]);
  } });
  try {
    await act(async () => toggle(renderer.root).props.onClick());
    const more = button(renderer.root, "加载更多");
    await act(async () => { more.props.onClick(); more.props.onClick(); });
    assert.equal(calls.length, 2);
    assert.equal(button(renderer.root, "加载更多").props.disabled, true);
    await act(async () => pending.reject(new Error("历史记录暂不可用")));
    assert.match(text(renderer.root), /隔离历史记录 first/);
    assert.doesNotMatch(text(renderer.root), /暂无历史记录/);
    await act(async () => button(renderer.root, "重试").props.onClick());
    assert.deepEqual(calls, [undefined, "cursor-2", "cursor-2"]);
    assert.equal(renderer.root.findAllByType("li").length, 2);
  } finally { await act(async () => renderer.unmount()); }
});

historyTest("closing aborts the active request and late responses cannot contaminate reopening", async () => {
  const pending = deferred(), calls = [];
  const renderer = await mount({ async read(cursor, signal) {
    calls.push({ cursor, signal });
    if (calls.length === 1) return pending.promise;
    return page([entry("reopened")]);
  } });
  try {
    await act(async () => toggle(renderer.root).props.onClick());
    assert.equal(calls[0].signal.aborted, false);
    await act(async () => toggle(renderer.root).props.onClick());
    assert.equal(calls[0].signal.aborted, true);
    await act(async () => toggle(renderer.root).props.onClick());
    await act(async () => pending.resolve(page([entry("late")])));
    assert.match(text(renderer.root), /隔离历史记录 reopened/);
    assert.doesNotMatch(text(renderer.root), /隔离历史记录 late/);
  } finally { await act(async () => renderer.unmount()); }
});

historyTest("unmount aborts pending reads and empty history is distinguished from errors", async () => {
  let signal;
  const pending = deferred();
  const renderer = await mount({ read(_cursor, nextSignal) { signal = nextSignal; return pending.promise; } });
  await act(async () => toggle(renderer.root).props.onClick());
  await act(async () => renderer.unmount());
  assert.equal(signal.aborted, true);
  await act(async () => pending.reject(new Error("aborted")));
  const empty = await mount({ async read() { return page([]); } });
  try {
    await act(async () => toggle(empty.root).props.onClick());
    assert.match(text(empty.root), /暂无历史记录/);
    assert.equal(button(empty.root, "重试"), undefined);
  } finally { await act(async () => empty.unmount()); }
});

historyTest("first-page failure stays an error and an explicit retry can recover", async () => {
  let calls = 0;
  const renderer = await mount({ async read() {
    calls++;
    if (calls === 1) throw new Error("当前授权不包含此来源");
    return page([entry("recovered")]);
  } });
  try {
    await act(async () => toggle(renderer.root).props.onClick());
    assert.match(text(renderer.root), /当前授权不包含此来源/);
    assert.doesNotMatch(text(renderer.root), /暂无历史记录/);
    assert.equal(calls, 1);
    await act(async () => button(renderer.root, "重试").props.onClick());
    assert.match(text(renderer.root), /隔离历史记录 recovered/);
  } finally { await act(async () => renderer.unmount()); }
});

historyTest("changing the history service discards prior rows even when the new scope fails", async () => {
  const renderer = await mount({ async read() { return page([entry("prior-scope")]); } });
  try {
    await act(async () => toggle(renderer.root).props.onClick());
    assert.match(text(renderer.root), /隔离历史记录 prior-scope/);
    await act(async () => renderer.update(React.createElement(EduPiReflectionHistory, {
      [serviceProp]: { async read() { throw new Error("当前范围不可用"); } },
    })));
    assert.doesNotMatch(text(renderer.root), /隔离历史记录 prior-scope/);
    assert.match(text(renderer.root), /当前范围不可用/);
  } finally { await act(async () => renderer.unmount()); }
});

historyTest("refreshing aborts an active page and reloads without accepting stale results", async () => {
  const pending = deferred(), calls = [];
  const service = { async read(cursor, signal) {
    calls.push({ cursor, signal });
    if (calls.length === 1) return page([entry("old")], "cursor-2");
    if (calls.length === 2) return pending.promise;
    return page([entry("refreshed")]);
  } };
  const renderer = await mount(service);
  try {
    await act(async () => toggle(renderer.root).props.onClick());
    await act(async () => button(renderer.root, "加载更多").props.onClick());
    await act(async () => renderer.update(React.createElement(EduPiReflectionHistory, {
      [serviceProp]: service, refreshKey: 1,
    })));
    assert.equal(calls[1].signal.aborted, true);
    assert.deepEqual(calls.map(call => call.cursor), [undefined, "cursor-2", undefined]);
    await act(async () => pending.resolve(page([entry("stale")])));
    assert.match(text(renderer.root), /隔离历史记录 refreshed/);
    assert.doesNotMatch(text(renderer.root), /隔离历史记录 (old|stale)/);
  } finally { await act(async () => renderer.unmount()); }
});
}

test("content history renders every content type and review without completion metadata or editing", async () => {
  const predicates = ["lesson.observation", "lesson.feedback", "lesson.statistic", "lesson.outcome", "lesson.review"];
  const renderer = await mountHistory({ contentService: { async read() {
    return page(predicates.map((predicate, index) => contentEntry(`content-${index}`, {
      predicate, status: index === 0 ? "stale" : "accepted",
      last_review: { action: "modify", reviewed_at: "2026-09-03T10:00:00.000Z" },
    })));
  } } });
  try {
    await act(async () => historyToggle(renderer.root, "课堂内容历史").props.onClick());
    for (const label of ["课堂观察", "课堂反馈", "课堂统计", "学习成果", "教学反思", "最近审核", "修改", "已失效", "已确认"]) {
      assert.ok(text(renderer.root).includes(label));
    }
    assert.doesNotMatch(text(renderer.root), /完课时间|completed_at/);
    assert.equal(renderer.root.findAllByType("li").length, 5);
    assert.equal(renderer.root.findAllByType("input").length, 0);
    assert.equal(renderer.root.findAllByType("textarea").length, 0);
    assert.equal(renderer.root.findAllByType("select").length, 0);
    assert.equal(renderer.root.findAllByType("button").length, 2);
  } finally { await act(async () => renderer.unmount()); }
});

test("completion and classroom content history have independent panels and requests", async () => {
  const pending = deferred(), calls = [];
  const renderer = await mountHistory({
    service: { async read(cursor, signal) {
      calls.push({ kind: "completion", cursor, signal });
      return page([completionEntry("completion")]);
    } },
    contentService: { async read(cursor, signal) {
      calls.push({ kind: "content", cursor, signal });
      return pending.promise;
    } },
  });
  try {
    assert.equal(calls.length, 0);
    const completionToggle = historyToggle(renderer.root, "历史记录");
    const contentToggle = historyToggle(renderer.root, "课堂内容历史");
    assert.notEqual(completionToggle.props["aria-controls"], contentToggle.props["aria-controls"]);
    await act(async () => contentToggle.props.onClick());
    assert.deepEqual(calls.map(call => call.kind), ["content"]);
    assert.equal(completionToggle.props["aria-expanded"], false);
    await act(async () => completionToggle.props.onClick());
    assert.match(text(renderer.root), /隔离历史记录 completion/);
    await act(async () => contentToggle.props.onClick());
    assert.equal(calls[0].signal.aborted, true);
    assert.equal(completionToggle.props["aria-expanded"], true);
    assert.match(text(renderer.root), /隔离历史记录 completion/);
    await act(async () => pending.resolve(page([contentEntry("late-content")])));
    assert.doesNotMatch(text(renderer.root), /隔离历史记录 late-content/);
  } finally { await act(async () => renderer.unmount()); }
});
