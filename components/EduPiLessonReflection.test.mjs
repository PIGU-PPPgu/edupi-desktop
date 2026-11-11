import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash, randomUUID, webcrypto } from "node:crypto";
import test, { beforeEach } from "node:test";
import vm from "node:vm";
import React, { act } from "react";
import { create } from "react-test-renderer";
import ts from "typescript";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const require = createRequire(import.meta.url);
const compile = async path => ts.transpileModule(await readFile(new URL(path, import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const client = {};
let fetchHandler;
let readProactivity;
let updateProactivity;
vm.runInNewContext(await compile("../lib/edupi-reflection-client.ts"), {
  exports: client, URLSearchParams, Date, Number, Error, TextEncoder, crypto: webcrypto,
  fetch: (...args) => fetchHandler(...args),
  require: name => name === "./edupi-proactivity-client"
    ? { readEduPiProactivity: (...args) => readProactivity(...args), updateEduPiProactivity: (...args) => updateProactivity(...args) }
    : { fetchDesktopApi: (...args) => fetchHandler(...args), desktopApiHeaders: async () => new Headers() },
});
const prefs = {};
vm.runInNewContext(await compile("../lib/app-prefs.ts"), { exports: prefs });
const pendingKey = prefs.APP_PREF_KEYS.edupiReflectionPendingOperation;
const stored = new Map(), events = [];
const storage = {
  getItem: key => stored.get(key) ?? null,
  setItem: (key, value) => { stored.set(key, value); },
  removeItem: key => { stored.delete(key); },
};
const testWindow = {
  dispatchEvent: event => events.push(event.type),
  localStorage: storage,
  crypto: { randomUUID, subtle: { digest: async (_algorithm, value) => createHash("sha256").update(value).digest() } },
};
beforeEach(() => {
  stored.clear();
  events.length = 0;
  testWindow.localStorage = storage;
});
const output = {};
vm.runInNewContext(await compile("./EduPiLessonReflection.tsx"), {
  exports: output, AbortController, Date, Error, Intl, Event, TextEncoder,
  window: testWindow, crypto: testWindow.crypto,
  require: name => name === "@/lib/edupi-reflection-client" ? client : name === "@/lib/app-prefs" ? prefs
    : name === "./EduPiReflectionHistory" ? { EduPiReflectionHistory: () => null } : require(name),
});
const { EduPiLessonReflection } = output;
const hash = letter => `sha256:${letter.repeat(64)}`;
const entry = { classId: "class-1", subject: "数学", date: "2026-11-10", slotId: "slot-1", lessonId: "lesson-1",
  lessonAt: "2026-11-10T09:00:00.000Z", registrationStatus: "unregistered", status: "ready", reasonCode: null,
  sourceBasisHash: hash("a"), grantVersion: 1, completionSourceIds: ["source-1"], completion: null,
  contentSourceIds: ["content-source-1"], content: null };
const completion = { factId: "fact-1", revision: 0, status: "pending_review", rawText: "课堂完成\n2026-11-10T10:00:00.000Z",
  completedAt: "2026-11-10T10:00:00.000Z", sourceBasisHash: hash("b"), sourceId: "source-1", sourceRevision: "1" };
const registered = { ...entry, registrationStatus: "registered" };
const sourceIdFor = (entry, input) => `lesson-content:${createHash("sha256").update(JSON.stringify([entry.classId, entry.subject, entry.lessonId])).digest("hex").slice(0, 24)}:${createHash("sha256").update(JSON.stringify([input.predicate, input.rawText])).digest("hex")}`;
const content = { factId: "content-fact-1", revision: 0, status: "pending_review",
  predicate: "lesson.observation", rawText: "学生能解释等式两边同减的依据", value: "学生能解释等式两边同减的依据",
  sourceBasisHash: hash("e"), sourceId: "content-source-1", sourceRevision: "1" };
content.sourceId = sourceIdFor(registered, content);
const text = node => typeof node === "string" ? node : (node.children || []).map(text).join("");
const button = (root, label) => root.findAllByType("button").find(item => text(item) === label);
const input = (root, type) => root.findAllByType("input").find(item => item.props.type === type);
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const list = entries => ({ ok: true, externalSend: false, enabled: true, date: entry.date, entries, truncated: false });
const receipt = (id, status = "prepared") => ({ id, fingerprint: hash("d"), status,
  terminal: ["committed", "not_committed"].includes(status) });
const outcome = (id, status, saved = null, code = null) => ({ operation: receipt(id, status), entry: saved, code });
const click = async (renderer, label) => act(async () => button(renderer.root, label).props.onClick());
const mount = async (service, today = entry.date) => {
  let renderer;
  await act(async () => { renderer = create(React.createElement(EduPiLessonReflection, { today, query: "", service })); });
  return renderer;
};
const unmount = async renderer => { if (renderer) await act(async () => renderer.unmount()); };
const fillCapture = async (root, notes = "课堂完成") => act(async () => {
  input(root, "datetime-local").props.onChange({ target: { value: "2026-11-10T10:00" } });
  root.findByType("textarea").props.onChange({ target: { value: notes } });
  root.findByType("select").props.onChange({ target: { value: "source-1" } });
});
function fixture(initial = [entry]) {
  const state = { entries: initial, registrations: [], prepares: [], commits: [], recoveries: [], reads: [], operations: new Map() };
  const service = {
    async read(date) { state.reads.push(date); return { enabled: true, entries: state.entries.filter(item => item.date === date), truncated: false }; },
    async refreshSources() { return { enabled: true, entries: state.entries, truncated: false }; },
    async registerContentSource(entry, input) {
      state.registrations.push({ entry, input });
      const sourceId = sourceIdFor(entry, input);
      const saved = { ...entry, grantVersion: entry.grantVersion + 1,
        contentSourceIds: [...entry.contentSourceIds, sourceId] };
      state.entries = state.entries.map(item => item === entry ? saved : item);
      return { sourceId, entry: saved };
    },
    async prepare(id, mutation) {
      state.prepares.push({ id, mutation });
      state.operations.set(id, outcome(id, "unknown"));
      return receipt(id);
    },
    async commit(id, fingerprint, mutation) {
      state.commits.push({ id, fingerprint, mutation });
      assert.equal(fingerprint, hash("d"));
      assert.deepEqual(mutation, state.prepares.find(item => item.id === id).mutation);
      assert.ok(stored.get(pendingKey)?.includes(id), "operation identity must be persisted before POST");
      assert.ok(stored.get(pendingKey)?.includes(fingerprint), "prepared fingerprint must be persisted before POST");
      const current = state.entries.find(item => item.classId === mutation.classId && item.subject === mutation.subject
        && item.date === mutation.date && item.slotId === mutation.slotId
        && (mutation.action !== "review" || item.completion?.factId === mutation.factId)
        && (mutation.action !== "contentReview" || item.content?.factId === mutation.factId));
      assert.ok(current);
      let saved;
      if (mutation.action === "register") saved = { ...current, registrationStatus: "registered" };
      else if (mutation.action === "capture") saved = { ...current, completion: { ...completion,
        sourceId: mutation.sourceId, sourceRevision: mutation.sourceRevision, rawText: mutation.rawText, completedAt: mutation.completedAt } };
      else if (mutation.action === "contentCapture") saved = { ...current, content: { ...content,
        sourceId: mutation.sourceId, sourceRevision: mutation.sourceRevision, predicate: mutation.predicate,
        rawText: mutation.rawText, value: mutation.rawText.normalize("NFKC").replace(/\s+/gu, " ").trim() } };
      else if (mutation.action === "contentReview") saved = { ...current, content: { ...current.content,
        revision: current.content.revision + 1, status: mutation.decision === "accept" ? "accepted" : "rejected",
        sourceBasisHash: hash("f") } };
      else saved = { ...current, completion: { ...current.completion, revision: current.completion.revision + 1,
        status: mutation.decision === "accept" ? "accepted" : "rejected", sourceBasisHash: hash("c") } };
      state.entries = state.entries.map(item => item === current ? saved : item);
      const result = outcome(id, "committed", saved);
      state.operations.set(id, result);
      return result;
    },
    async recover(id, fingerprint) {
      state.recoveries.push({ id, fingerprint });
      assert.equal(fingerprint, hash("d"));
      assert.ok(state.operations.has(id));
      return state.operations.get(id);
    },
  };
  return { state, service };
}
function uncertainFixture(initial) {
  const value = fixture(initial);
  value.service.commit = async (id, fingerprint, mutation) => {
    value.state.commits.push({ id, fingerprint, mutation });
    throw new client.ReflectionActionError("操作结果尚未确认", true);
  };
  return value;
}

test("client binds prepared register, capture and review to occurrence and returned CAS evidence", async () => {
  const captured = { ...registered, completion };
  const reviewed = { ...captured, completion: { ...completion, revision: 1, status: "accepted", sourceBasisHash: hash("c") } };
  const writes = [];
  fetchHandler = async (_url, options) => {
    const payload = JSON.parse(options.body);
    if (options.method === "PUT") return response({ ok: true, externalSend: false, operation: receipt(payload.operationId) });
    writes.push(payload);
    const saved = payload.action === "register" ? registered : payload.action === "capture" ? captured : reviewed;
    return response({ ok: true, externalSend: false, readbackConfirmed: true, entry: saved,
      operation: receipt(payload.operationId, "committed") });
  };
  for (const [current, action] of [[entry, { action: "register" }],
    [registered, { action: "capture", sourceId: "source-1", sourceRevision: "1", rawText: completion.rawText, completedAt: completion.completedAt }],
    [captured, { action: "review", decision: "accept" }]]) {
    const operation = await client.prepareReflection(current, action, randomUUID());
    await client.commitReflection(current, action, operation);
  }
  assert.equal(writes[0].slotId, "slot-1");
  assert.equal(writes[0].expectedSourceBasisHash, hash("a"));
  assert.equal(writes[2].expectedCompletionBasisHash, hash("b"));
  assert.equal(writes[2].expectedFactRevision, 0);
  await assert.rejects(() => client.prepareReflection(registered, { action: "capture", sourceId: "foreign", sourceRevision: "1",
    rawText: completion.rawText, completedAt: completion.completedAt }, randomUUID()));
  assert.equal(writes.length, 3);
});

test("client rejects malformed lists and a committed review without a newer fact revision", async () => {
  assert.equal(client.parseReflectionList(list([entry]), entry.date).entries.length, 1);
  assert.throws(() => client.parseReflectionList(list([{ ...entry, grantVersion: 0 }]), entry.date));
  assert.throws(() => client.parseReflectionList({ ...list([entry]), externalSend: true }, entry.date));
  const id = randomUUID(), captured = { ...registered, completion };
  fetchHandler = async () => response({ ok: true, externalSend: false, readbackConfirmed: true,
    operation: receipt(id, "committed"), entry: { ...captured, completion: { ...completion, status: "accepted" } } });
  await assert.rejects(() => client.commitReflection(captured, { action: "review", decision: "accept" }, receipt(id)),
    error => error instanceof client.ReflectionActionError && error.uncertain === true);
});

test("teacher registers, records, accepts and withdraws with prepared operation receipts", async () => {
  const { service, state } = fixture();
  const renderer = await mount(service);
  try {
    assert.match(text(renderer.root), /课次 slot-1/);
    await click(renderer, "登记课次");
    await fillCapture(renderer.root);
    await click(renderer, "记录完课");
    assert.match(text(renderer.root), /待审核/);
    await click(renderer, "确认完课");
    await click(renderer, "撤回确认");
    assert.deepEqual(state.commits.map(item => item.mutation.action), ["register", "capture", "review", "review"]);
    assert.deepEqual(state.commits.slice(2).map(item => item.mutation.decision), ["accept", "withdraw"]);
    assert.match(state.commits[1].mutation.rawText, /^课堂完成\n\d{4}-/);
    assert.match(text(renderer.root), /已撤回或驳回/);
    assert.equal(new Set(state.prepares.map(item => item.id)).size, 4);
    assert.equal(events.filter(event => event === "edupi-education-refresh").length, 4);
    assert.equal(stored.has(pendingKey), false);
  } finally { await unmount(renderer); }
});

test("registration refreshes authorized sources and capture uses the fresh grant", async () => {
  const { service, state } = fixture([{ ...entry, completionSourceIds: [] }]);
  let refreshes = 0;
  service.refreshSources = async current => {
    refreshes++;
    assert.equal(current.registrationStatus, "registered");
    state.entries = [{ ...current, grantVersion: 2, completionSourceIds: ["source-1"] }];
    return { enabled: true, entries: state.entries, truncated: false };
  };
  const renderer = await mount(service);
  try {
    await click(renderer, "登记课次");
    assert.equal(refreshes, 1);
    await fillCapture(renderer.root);
    await click(renderer, "记录完课");
    assert.equal(state.commits[1].mutation.expectedGrantVersion, 2);
    assert.equal(state.commits[1].mutation.sourceId, "source-1");
  } finally { await unmount(renderer); }
});

test("source refresh preserves active scope and CAS timestamp before reading the new grant", async () => {
  const activation = { enabled: true, configurationStatus: "ready", scope: { classId: entry.classId, subject: entry.subject }, updatedAt: "2026-11-10T08:00:00.000Z" };
  const state = { activation, grant: { status: "active" }, limits: { domain: "lesson_reflection" } };
  const requests = [];
  readProactivity = async (_signal, domain) => { assert.equal(domain, "lesson_reflection"); return state; };
  updateProactivity = async payload => { requests.push(payload); return state; };
  fetchHandler = async url => {
    assert.match(url, /^\/api\/edupi\/proactivity\/reflection\?date=2026-11-10$/);
    return response(list([{ ...registered, grantVersion: 2 }]));
  };
  assert.equal((await client.refreshReflectionSources(registered)).entries[0].grantVersion, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [{ enabled: true, classId: entry.classId, subject: entry.subject,
    expectedUpdatedAt: activation.updatedAt, domain: "lesson_reflection" }]);
  for (const invalid of [
    { ...state, activation: { ...activation, enabled: false } },
    { ...state, activation: { ...activation, scope: { classId: "other", subject: entry.subject } } },
    { ...state, grant: { status: "paused" } },
  ]) {
    readProactivity = async () => invalid;
    await assert.rejects(() => client.refreshReflectionSources(registered));
  }
  assert.equal(requests.length, 1);
});

test("a failed source refresh keeps registration and permits an explicit source retry after GET", async () => {
  const { service, state } = fixture([{ ...entry, completionSourceIds: [] }]);
  let refreshes = 0;
  service.refreshSources = async () => {
    if (++refreshes === 1) throw new Error("来源刷新失败，请刷新");
    state.entries = [{ ...registered, grantVersion: 2 }];
    return { enabled: true, entries: state.entries, truncated: false };
  };
  const renderer = await mount(service);
  try {
    await click(renderer, "登记课次");
    assert.equal(Boolean(button(renderer.root, "登记课次")), false);
    assert.equal(button(renderer.root, "刷新来源").props.disabled, true);
    await click(renderer, "刷新");
    assert.equal(button(renderer.root, "刷新来源").props.disabled, false);
    await click(renderer, "刷新来源");
    assert.equal(button(renderer.root, "记录完课").props.disabled, false);
    assert.equal(state.commits.length, 1);
    assert.equal(refreshes, 2);
  } finally { await unmount(renderer); }
});

test("unknown recovery stays locked even when GET contains the exact successful registration", async () => {
  const { service, state } = uncertainFixture();
  let renderer = await mount(service);
  try {
    await click(renderer, "登记课次");
    const { id, fingerprint } = state.commits[0];
    state.entries = [registered];
    await click(renderer, "刷新");
    assert.equal(button(renderer.root, "记录完课").props.disabled, true);
    assert.ok(stored.has(pendingKey));
    await unmount(renderer);
    renderer = await mount(service);
    assert.equal(button(renderer.root, "记录完课").props.disabled, true);
    assert.deepEqual(state.recoveries.at(-1), { id, fingerprint });
    state.operations.set(id, outcome(id, "committed", registered));
    await click(renderer, "刷新");
    assert.equal(button(renderer.root, "记录完课").props.disabled, false);
    assert.equal(stored.has(pendingKey), false);
    assert.equal(state.commits.length, 1);
  } finally { await unmount(renderer); }
});

test("recovery on a later date uses the persisted operation identity without repeating POST", async () => {
  const tomorrow = "2026-11-11";
  const { service, state } = uncertainFixture([entry, { ...entry, date: tomorrow, lessonId: "tomorrow-lesson" }]);
  let renderer = await mount(service);
  try {
    await click(renderer, "登记课次");
    const { id, fingerprint } = state.commits[0];
    await unmount(renderer);
    renderer = await mount(service, tomorrow);
    assert.equal(button(renderer.root, "登记课次").props.disabled, true);
    assert.deepEqual(state.recoveries.at(-1), { id, fingerprint });
    await click(renderer, "登记课次");
    assert.equal(state.commits.length, 1);
    state.entries = [registered, ...state.entries.filter(item => item.date === tomorrow)];
    state.operations.set(id, outcome(id, "committed", registered));
    await click(renderer, "刷新");
    assert.equal(button(renderer.root, "登记课次").props.disabled, false);
    assert.equal(stored.has(pendingKey), false);
  } finally { await unmount(renderer); }
});

test("not_committed recovery unlocks a new operation only after terminal proof", async () => {
  const { service, state } = uncertainFixture();
  const renderer = await mount(service);
  try {
    await click(renderer, "登记课次");
    const first = state.commits[0];
    await click(renderer, "刷新");
    assert.equal(button(renderer.root, "登记课次").props.disabled, true);
    state.operations.set(first.id, outcome(first.id, "not_committed", null, "operation_not_committed"));
    await click(renderer, "刷新");
    assert.equal(stored.has(pendingKey), false);
    assert.equal(button(renderer.root, "登记课次").props.disabled, false);
    await click(renderer, "登记课次");
    assert.equal(state.commits.length, 2);
    assert.notEqual(state.commits[1].id, first.id);
  } finally { await unmount(renderer); }
});

test("late POST after remount cannot clear a different pending operation", async () => {
  const { service, state } = fixture();
  let finishFirst;
  service.commit = async (id, fingerprint, mutation) => {
    state.commits.push({ id, fingerprint, mutation });
    if (state.commits.length === 1) return new Promise(resolve => { finishFirst = resolve; });
    throw new client.ReflectionActionError("操作结果尚未确认", true);
  };
  let renderer = await mount(service);
  try {
    await act(async () => { void button(renderer.root, "登记课次").props.onClick(); });
    const first = state.commits[0];
    assert.ok(stored.get(pendingKey).includes(first.id));
    await unmount(renderer);
    state.operations.set(first.id, outcome(first.id, "not_committed", null, "operation_not_committed"));
    renderer = await mount(service);
    await click(renderer, "登记课次");
    const second = state.commits[1], pending = stored.get(pendingKey);
    assert.notEqual(second.id, first.id);
    await act(async () => { finishFirst(outcome(first.id, "committed", registered)); });
    assert.equal(stored.get(pendingKey), pending);
    assert.equal(button(renderer.root, "登记课次").props.disabled, true);
    assert.equal(events.filter(event => event === "edupi-education-refresh").length, 0);
  } finally { await unmount(renderer); }
});

test("capture remount stores no raw evidence and rejects mismatched recovered completion", async () => {
  const { service, state } = uncertainFixture([registered]);
  const privateText = "仅保留在教师表单的原始内容";
  let renderer = await mount(service);
  try {
    await fillCapture(renderer.root, privateText);
    await click(renderer, "记录完课");
    const { id, mutation } = state.commits[0], raw = stored.get(pendingKey);
    assert.doesNotMatch(raw, /rawText|仅保留在教师表单/);
    await unmount(renderer);
    renderer = await mount(service);
    const exact = { ...registered, completion: { ...completion, rawText: mutation.rawText, completedAt: mutation.completedAt } };
    for (const mismatch of [{ rawText: "其他内容" }, { sourceId: "source-other" }, { sourceRevision: "2" },
      { completedAt: "2026-11-10T11:00:00.000Z" }]) {
      const wrong = { ...exact, completion: { ...exact.completion, ...mismatch } };
      state.entries = [wrong];
      state.operations.set(id, outcome(id, "committed", wrong));
      await click(renderer, "刷新");
      assert.ok(stored.has(pendingKey));
      assert.match(text(renderer.root), /操作结果尚未确认/);
    }
    state.entries = [exact];
    state.operations.set(id, outcome(id, "committed", exact));
    await click(renderer, "刷新");
    assert.equal(button(renderer.root, "确认完课").props.disabled, false);
    assert.equal(stored.has(pendingKey), false);
    assert.equal(state.commits.length, 1);
  } finally { await unmount(renderer); }
});

test("review remount requires the selected fact, newer revision and requested status", async () => {
  const first = { ...registered, completion };
  const second = { ...registered, completion: { ...completion, factId: "fact-2", rawText: "第二条完课事实" } };
  const { service, state } = uncertainFixture([first, second]);
  let renderer = await mount(service);
  try {
    await act(async () => button(renderer.root.findAllByType("li")[1], "确认完课").props.onClick());
    const { id } = state.commits[0];
    assert.equal(state.commits[0].mutation.factId, "fact-2");
    await unmount(renderer);
    renderer = await mount(service);
    const exact = { ...second, completion: { ...second.completion, revision: 1, status: "accepted" } };
    for (const mismatch of [{ factId: "fact-1" }, { revision: 0 }, { status: "rejected" }]) {
      const wrong = { ...exact, completion: { ...exact.completion, ...mismatch } };
      state.entries = [first, wrong];
      state.operations.set(id, outcome(id, "committed", wrong));
      await click(renderer, "刷新");
      assert.ok(stored.has(pendingKey));
      assert.match(text(renderer.root), /操作结果尚未确认/);
    }
    state.entries = [first, exact];
    state.operations.set(id, outcome(id, "committed", exact));
    await click(renderer, "刷新");
    assert.equal(stored.has(pendingKey), false);
    assert.equal(button(renderer.root.findAllByType("li")[1], "撤回确认").props.disabled, false);
    assert.equal(state.commits.length, 1);
  } finally { await unmount(renderer); }
});

test("capture recovery checks the second fact independently of another fact in the same lesson", async () => {
  const first = { ...registered, completion: { ...completion, rawText: "先前事实" } };
  const { service, state } = uncertainFixture([first, registered]);
  let renderer = await mount(service);
  try {
    const selected = renderer.root.findAllByType("li")[1];
    await fillCapture(selected, "第二条事实");
    await act(async () => button(selected, "记录完课").props.onClick());
    const { id, mutation } = state.commits[0];
    await unmount(renderer);
    renderer = await mount(service);
    state.operations.set(id, outcome(id, "committed", first));
    await click(renderer, "刷新");
    assert.ok(stored.has(pendingKey));
    const second = { ...registered, completion: { ...completion, factId: "fact-2",
      rawText: mutation.rawText, completedAt: mutation.completedAt } };
    state.entries = [first, second];
    state.operations.set(id, outcome(id, "committed", second));
    await click(renderer, "刷新");
    assert.equal(stored.has(pendingKey), false);
    assert.equal(button(renderer.root.findAllByType("li")[1], "确认完课").props.disabled, false);
    assert.equal(state.commits.length, 1);
  } finally { await unmount(renderer); }
});

test("mismatched recovery receipts cannot release the persisted operation", async () => {
  const { service, state } = uncertainFixture();
  const renderer = await mount(service);
  try {
    await click(renderer, "登记课次");
    const { id } = state.commits[0], pending = stored.get(pendingKey);
    for (const changes of [{ id: randomUUID() }, { fingerprint: hash("e") }, { terminal: false }]) {
      const result = outcome(id, "not_committed", null, "operation_not_committed");
      result.operation = { ...result.operation, ...changes };
      state.operations.set(id, result);
      await click(renderer, "刷新");
      assert.equal(stored.get(pendingKey), pending);
      assert.equal(button(renderer.root, "登记课次").props.disabled, true);
    }
    assert.equal(state.commits.length, 1);
  } finally { await unmount(renderer); }
});

test("held entries remain visible while pending operations block later mutations", async () => {
  const held = { ...entry, slotId: "slot-2", status: "held", reasonCode: "lesson_ambiguous",
    lessonId: null, lessonAt: null, sourceBasisHash: null, grantVersion: null };
  const { service, state } = uncertainFixture([entry, held]);
  const renderer = await mount(service);
  try {
    assert.match(text(renderer.root), /同日课次有歧义/);
    await click(renderer, "登记课次");
    await click(renderer, "刷新");
    assert.equal(button(renderer.root, "登记课次").props.disabled, true);
    assert.equal(state.commits.length, 1);
  } finally { await unmount(renderer); }
});

test("terminal source conflict preserves evidence text until explicit refresh", async () => {
  const { service } = fixture([registered]);
  service.commit = async id => outcome(id, "not_committed", null, "source_conflict");
  const renderer = await mount(service);
  try {
    await fillCapture(renderer.root, "保留内容");
    await click(renderer, "记录完课");
    assert.equal(renderer.root.findByType("textarea").props.value, "保留内容");
    assert.equal(button(renderer.root, "记录完课").props.disabled, true);
    assert.match(text(renderer.root), /来源已用于其他记录/);
    assert.equal(stored.has(pendingKey), false);
    await click(renderer, "刷新");
    assert.equal(button(renderer.root, "记录完课").props.disabled, false);
  } finally { await unmount(renderer); }
});

test("invalid source revision creates no operation and can be corrected before submission", async () => {
  const { service, state } = fixture([registered]);
  const renderer = await mount(service);
  try {
    await fillCapture(renderer.root);
    const revision = () => renderer.root.findAllByType("input").find(item => item.props.maxLength === 160);
    await act(async () => revision().props.onChange({ target: { value: "1\t2" } }));
    await click(renderer, "记录完课");
    assert.equal(state.prepares.length, 0);
    assert.equal(state.commits.length, 0);
    assert.equal(stored.has(pendingKey), false);
    assert.equal(button(renderer.root, "记录完课").props.disabled, false);
    assert.equal(renderer.root.findByType("textarea").props.value, "课堂完成");
    await act(async () => revision().props.onChange({ target: { value: "2" } }));
    await click(renderer, "记录完课");
    assert.equal(state.commits.length, 1);
    assert.equal(state.entries[0].completion.sourceRevision, "2");
    assert.equal(stored.has(pendingKey), false);
  } finally { await unmount(renderer); }
});

test("reject uses the selected completion and displays the returned status", async () => {
  const { service, state } = fixture([{ ...registered, completion }]);
  const renderer = await mount(service);
  try {
    await click(renderer, "驳回");
    assert.equal(state.commits[0].mutation.decision, "reject");
    assert.equal(state.commits[0].mutation.factId, completion.factId);
    assert.match(text(renderer.root), /已撤回或驳回/);
  } finally { await unmount(renderer); }
});

test("storage read, parse, write and silent write failures prevent POST", async () => {
  for (const failure of ["read", "parse", "write", "silent-write"]) {
    stored.clear();
    testWindow.localStorage = {
      ...storage,
      getItem(key) { if (failure === "read") throw new Error("存储读取失败"); return storage.getItem(key); },
      setItem(key, value) {
        if (failure === "write") throw new Error("存储写入失败");
        if (failure !== "silent-write") storage.setItem(key, value);
      },
    };
    if (failure === "parse") stored.set(pendingKey, "{invalid");
    const { service, state } = fixture();
    const renderer = await mount(service);
    try {
      if (button(renderer.root, "登记课次")) await click(renderer, "登记课次");
      assert.match(text(renderer.root), /操作结果尚未确认/);
      assert.equal(state.commits.length, 0, failure);
    } finally { await unmount(renderer); }
  }
});

test("failure to persist the prepared fingerprint never dispatches POST", async () => {
  const { service, state } = fixture();
  const prepare = service.prepare;
  service.prepare = async (...args) => {
    const result = await prepare(...args);
    testWindow.localStorage = { ...storage, setItem() { throw new Error("回执存储失败"); } };
    return result;
  };
  const renderer = await mount(service);
  try {
    await click(renderer, "登记课次");
    assert.equal(state.prepares.length, 1);
    assert.equal(state.commits.length, 0);
    assert.match(text(renderer.root), /操作结果尚未确认/);
  } finally { await unmount(renderer); }
});

test("failed GET and failed lock removal preserve recovery state until both succeed", async () => {
  const { service, state } = uncertainFixture();
  const read = service.read;
  let readFails = false, removeFails = false;
  service.read = async (...args) => {
    if (readFails) throw new Error("读取失败");
    return read(...args);
  };
  testWindow.localStorage = {
    ...storage,
    removeItem(key) { if (removeFails) throw new Error("存储删除失败"); storage.removeItem(key); },
  };
  let renderer = await mount(service);
  try {
    await click(renderer, "登记课次");
    const { id } = state.commits[0];
    await unmount(renderer);
    readFails = true;
    renderer = await mount(service);
    assert.ok(stored.has(pendingKey));
    assert.match(text(renderer.root), /操作结果尚未确认/);
    readFails = false;
    removeFails = true;
    state.entries = [registered];
    state.operations.set(id, outcome(id, "committed", registered));
    await click(renderer, "刷新");
    assert.ok(stored.has(pendingKey));
    assert.match(text(renderer.root), /操作结果尚未确认/);
    removeFails = false;
    await click(renderer, "刷新");
    assert.equal(stored.has(pendingKey), false);
    assert.equal(button(renderer.root, "记录完课").props.disabled, false);
    assert.equal(state.commits.length, 1);
  } finally { await unmount(renderer); }
});

test("silent lock removal failure remains locked across remount", async () => {
  const { service, state } = fixture();
  testWindow.localStorage = { ...storage, removeItem() {} };
  let renderer = await mount(service);
  try {
    await click(renderer, "登记课次");
    assert.ok(stored.has(pendingKey));
    await unmount(renderer);
    renderer = await mount(service);
    assert.match(text(renderer.root), /操作结果尚未确认/);
    assert.equal(state.commits.length, 1);
    testWindow.localStorage = storage;
    await click(renderer, "刷新");
    assert.equal(stored.has(pendingKey), false);
    assert.equal(button(renderer.root, "记录完课").props.disabled, false);
  } finally { await unmount(renderer); }
});

const fillContent = async (renderer, rawText = content.rawText) => {
  await click(renderer, "添加课堂内容");
  const form = renderer.root.findByProps({ "aria-label": "课堂内容记录" });
  await act(async () => {
    form.findByType("textarea").props.onChange({ target: { value: rawText } });
  });
};

test("classroom content is captured and owner-reviewed without completing the lesson", async () => {
  const { service, state } = fixture([registered]);
  const renderer = await mount(service);
  try {
    await fillCapture(renderer.root, "未提交的完课草稿");
    await fillContent(renderer);
    await click(renderer, "提交课堂内容");
    assert.equal(state.commits.length, 1);
    assert.equal(state.commits[0].mutation.action, "contentCapture");
    assert.equal(state.entries[0].content.status, "pending_review");
    assert.equal(state.entries[0].completion, null);
    assert.equal(renderer.root.findByType("textarea").props.value, "未提交的完课草稿");
    assert.equal(button(renderer.root, "确认完课"), undefined);
    await click(renderer, "接受内容");
    assert.equal(state.commits[1].mutation.action, "contentReview");
    assert.equal(state.commits[1].mutation.factId, content.factId);
    assert.equal(state.commits[1].mutation.expectedFactRevision, 0);
    assert.equal(state.commits[1].mutation.expectedContentBasisHash, hash("e"));
    assert.equal(state.entries[0].content.status, "accepted");
    assert.equal(state.entries[0].completion, null);
    assert.equal(stored.has(pendingKey), false);
    assert.match(text(renderer.root), /内容已接受/);
  } finally { await unmount(renderer); }
});

test("content rejection preserves an accepted completion", async () => {
  const acceptedCompletion = { ...completion, status: "accepted", revision: 1 };
  const { service, state } = fixture([{ ...registered, completion: acceptedCompletion, content }]);
  const renderer = await mount(service);
  try {
    await click(renderer, "驳回内容");
    assert.equal(state.entries[0].content.status, "rejected");
    assert.deepEqual(state.entries[0].completion, acceptedCompletion);
    assert.match(text(renderer.root), /内容已驳回/);
    assert.equal(button(renderer.root, "撤回确认").props.disabled, false);
  } finally { await unmount(renderer); }
});

test("unknown content capture keeps a hash-only lock and verifies exact source and predicate on recovery", async () => {
  const { service, state } = uncertainFixture([registered]);
  let renderer = await mount(service);
  try {
    await fillContent(renderer);
    await click(renderer, "提交课堂内容");
    assert.equal(state.commits.length, 1);
    const { id } = state.commits[0];
    assert.doesNotMatch(stored.get(pendingKey), /rawText|学生能解释/);
    await unmount(renderer);
    renderer = await mount(service);
    for (const mismatch of [{ rawText: "其他内容" }, { sourceId: "content-source-2" },
      { sourceRevision: "2" }, { predicate: "lesson.feedback" }]) {
      const wrong = { ...registered, content: { ...content, ...mismatch } };
      state.entries = [wrong];
      state.operations.set(id, outcome(id, "committed", wrong));
      await click(renderer, "刷新");
      assert.ok(stored.has(pendingKey));
      assert.equal(button(renderer.root, "接受内容").props.disabled, true);
    }
    const exact = { ...registered, content };
    state.entries = [exact];
    state.operations.set(id, outcome(id, "committed", exact));
    await click(renderer, "刷新");
    assert.equal(stored.has(pendingKey), false);
    assert.equal(button(renderer.root, "接受内容").props.disabled, false);
    assert.equal(state.commits.length, 1);
  } finally { await unmount(renderer); }
});

test("classroom content with no sources registers original text and captures using the returned grant", async () => {
  const { service, state } = fixture([{ ...registered, contentSourceIds: [] }]);
  service.refreshSources = async () => { throw new Error("must not refresh between registration and capture"); };
  const renderer = await mount(service);
  const rawText = "  学生能解释等式\n两边同减的依据  ";
  try {
    await fillContent(renderer, rawText);
    const form = renderer.root.findByProps({ "aria-label": "课堂内容记录" });
    assert.equal(form.findAllByType("select").length, 1);
    assert.equal(form.findAllByType("input").length, 0);
    assert.equal(button(renderer.root, "提交课堂内容").props.disabled, false);
    await click(renderer, "提交课堂内容");
    assert.equal(state.registrations.length, 1);
    assert.equal(state.registrations[0].input.rawText, rawText);
    assert.equal(state.prepares.length, 1);
    assert.equal(state.commits.length, 1);
    assert.equal(state.commits[0].mutation.rawText, rawText);
    assert.equal(state.commits[0].mutation.expectedGrantVersion, registered.grantVersion + 1);
    assert.equal(state.commits[0].mutation.sourceId, sourceIdFor(registered, { ...content, rawText }));
    assert.equal(state.commits[0].mutation.sourceRevision, "1");
    assert.equal(state.entries[0].content.rawText, rawText);
    assert.equal(stored.has(pendingKey), false);
    assert.match(text(renderer.root), /等待确认/);
  } finally { await unmount(renderer); }
});

test("blank classroom content creates no prepared operation and folding preserves the draft", async () => {
  const { service, state } = fixture([registered]);
  const renderer = await mount(service);
  try {
    await fillContent(renderer, "   ");
    await click(renderer, "提交课堂内容");
    assert.match(text(renderer.root), /请填写课堂内容/);
    assert.equal(state.prepares.length, 0);
    assert.equal(state.registrations.length, 0);
    const form = renderer.root.findByProps({ "aria-label": "课堂内容记录" });
    await act(async () => form.findByType("textarea").props.onChange({ target: { value: content.rawText } }));
    await click(renderer, "收起");
    await click(renderer, "添加课堂内容");
    assert.equal(renderer.root.findByProps({ "aria-label": "课堂内容记录" }).findByType("textarea").props.value, content.rawText);
    assert.equal(state.commits.length, 0);
    assert.equal(state.registrations.length, 0);
  } finally { await unmount(renderer); }
});

test("content review recovery checks fact, revision, fresh basis and decision without touching completion", async () => {
  const { service, state } = fixture([{ ...registered, content }]);
  const id = randomUUID();
  stored.set(pendingKey, JSON.stringify({ version: 2, classId: entry.classId, subject: entry.subject,
    date: entry.date, slotId: entry.slotId, lessonId: entry.lessonId, action: "contentReview",
    factId: content.factId, revision: content.revision, expectedContentBasisHash: content.sourceBasisHash,
    decision: "accept", operationId: id, fingerprint: hash("d") }));
  state.operations.set(id, outcome(id, "unknown"));
  const renderer = await mount(service);
  try {
    assert.equal(button(renderer.root, "接受内容").props.disabled, true);
    const exact = { ...registered, content: { ...content, status: "accepted", revision: 1, sourceBasisHash: hash("f") } };
    for (const mismatch of [{ factId: "other-fact" }, { revision: 0 }, { sourceBasisHash: content.sourceBasisHash }, { status: "rejected" }]) {
      const wrong = { ...exact, content: { ...exact.content, ...mismatch } };
      state.entries = [wrong];
      state.operations.set(id, outcome(id, "committed", wrong));
      await click(renderer, "刷新");
      assert.ok(stored.has(pendingKey));
    }
    state.entries = [exact];
    state.operations.set(id, outcome(id, "committed", exact));
    await click(renderer, "刷新");
    assert.equal(stored.has(pendingKey), false);
    assert.equal(state.entries[0].completion, null);
    assert.equal(state.commits.length, 0);
  } finally { await unmount(renderer); }
});

test("source registration failure, unknown and mismatched responses preserve the draft and never prepare capture", async () => {
  const input = { predicate: content.predicate, rawText: "  保留课堂内容\n原文  " };
  const sourceId = sourceIdFor(registered, input);
  const valid = { sourceId, entry: { ...registered, grantVersion: 2,
    contentSourceIds: [...registered.contentSourceIds, sourceId] } };
  const replies = [
    async () => { throw new client.ReflectionActionError("课堂内容来源尚未确认", false, "content_source_unverified"); },
    async () => { throw new Error("登记失败"); },
    async () => null,
    ...[{ lessonId: "lesson-other" }, { slotId: "slot-other" }, { date: "2026-11-11" },
      { classId: "class-other" }, { subject: "语文" }, { sourceBasisHash: hash("b") },
      { grantVersion: 0 }, { grantVersion: null }, { contentSourceIds: [] }]
      .map(changes => async () => ({ ...valid, entry: { ...valid.entry, ...changes } })),
    async () => ({ ...valid, sourceId: "content-source-1" }),
  ];
  for (const reply of replies) {
    const { service, state } = fixture([registered]);
    service.registerContentSource = reply;
    const renderer = await mount(service);
    try {
      await fillContent(renderer, input.rawText);
      await click(renderer, "提交课堂内容");
      assert.equal(state.prepares.length, 0);
      assert.equal(state.commits.length, 0);
      assert.equal(stored.has(pendingKey), false);
      assert.equal(renderer.root.findByProps({ "aria-label": "课堂内容记录" }).findByType("textarea").props.value, input.rawText);
      assert.equal(button(renderer.root, "提交课堂内容").props.disabled, false);
    } finally { await unmount(renderer); }
  }
});

test("source registration shares the pending lock and repeated clicks produce one capture", async () => {
  const { service, state } = fixture([{ ...registered, contentSourceIds: [] }]);
  const register = service.registerContentSource;
  let finish;
  service.registerContentSource = (...args) => new Promise(resolve => { finish = async () => resolve(await register(...args)); });
  const renderer = await mount(service);
  try {
    await fillContent(renderer);
    const submit = button(renderer.root, "提交课堂内容").props.onClick;
    let first, second;
    await act(async () => { first = submit(); second = submit(); });
    assert.equal(button(renderer.root, "提交课堂内容").props.disabled, true);
    assert.equal(state.prepares.length, 0);
    await act(async () => { await finish(); await Promise.all([first, second]); });
    assert.equal(state.registrations.length, 1);
    assert.equal(state.prepares.length, 1);
    assert.equal(state.commits.length, 1);
  } finally { await unmount(renderer); }
});

test("folding the content form never registers and legacy services fail only when content capture needs registration", async () => {
  const { service, state } = fixture([registered]);
  delete service.registerContentSource;
  const renderer = await mount(service);
  try {
    await fillContent(renderer);
    await click(renderer, "收起");
    assert.equal(state.registrations.length, 0);
    assert.equal(state.prepares.length, 0);
    await click(renderer, "添加课堂内容");
    await click(renderer, "提交课堂内容");
    assert.match(text(renderer.root), /课堂内容来源登记暂不可用/);
    assert.equal(state.commits.length, 0);
    await click(renderer, "收起");
    await fillCapture(renderer.root);
    await click(renderer, "记录完课");
    assert.equal(state.commits.length, 1);
  } finally { await unmount(renderer); }
});

test("late registration after date changes or unmount never prepares or commits", async () => {
  for (const leave of ["date", "unmount"]) {
    const { service, state } = fixture([registered]);
    const register = service.registerContentSource;
    let finish, submission;
    service.registerContentSource = (...args) => new Promise(resolve => { finish = async () => resolve(await register(...args)); });
    let renderer = await mount(service);
    try {
      await fillContent(renderer);
      await act(async () => { submission = button(renderer.root, "提交课堂内容").props.onClick(); });
      if (leave === "unmount") { await unmount(renderer); renderer = null; }
      else await act(async () => input(renderer.root, "date").props.onChange({ target: { value: "2026-11-11" } }));
      await act(async () => { await finish(); await submission; });
      assert.equal(state.prepares.length, 0, leave);
      assert.equal(state.commits.length, 0, leave);
      assert.equal(stored.has(pendingKey), false, leave);
      if (renderer) { assert.equal(input(renderer.root, "date").props.value, "2026-11-11"); assert.match(text(renderer.root), /当天没有可用课次/); }
    } finally { await unmount(renderer); }
  }
});

test("the component uses the real source helper before durable capture and final readback", async () => {
  const { service, state } = fixture([{ ...registered, contentSourceIds: [] }]);
  const rawText = "  实际客户端接线\n保留前后空格  ", requests = [];
  service.registerContentSource = client.registerReflectionContentSource;
  fetchHandler = async (url, options) => {
    const payload = JSON.parse(options.body);
    requests.push({ url, method: options.method, payload });
    assert.equal(state.prepares.length, 0);
    assert.equal(state.commits.length, 0);
    const current = state.entries[0];
    const sourceId = sourceIdFor(current, payload);
    state.entries = [{ ...current, grantVersion: 4, contentSourceIds: [sourceId] }];
    return response({ ok: true, externalSend: false, readbackConfirmed: true, sourceId, entry: state.entries[0] });
  };
  const renderer = await mount(service);
  try {
    await fillContent(renderer, rawText);
    await click(renderer, "提交课堂内容");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].payload.action, "registerContentSource");
    assert.equal(requests[0].payload.rawText, rawText);
    assert.equal(requests[0].payload.expectedGrantVersion, 1);
    assert.equal(state.prepares[0].mutation.expectedGrantVersion, 4);
    assert.equal(state.commits[0].mutation.rawText, rawText);
    assert.equal(state.entries[0].content.rawText, rawText);
    assert.equal(state.reads.length, 2);
    assert.equal(stored.has(pendingKey), false);
    assert.match(text(renderer.root), /等待确认/);
  } finally { await unmount(renderer); }
});

test("legacy unknown content operations recover without requiring new source registration", async () => {
  const { service, state } = fixture([registered]);
  delete service.registerContentSource;
  const id = randomUUID(), legacy = { ...content, sourceId: "content-source-legacy" };
  stored.set(pendingKey, JSON.stringify({ version: 2, classId: entry.classId, subject: entry.subject,
    date: entry.date, slotId: entry.slotId, lessonId: entry.lessonId, action: "contentCapture",
    sourceId: legacy.sourceId, sourceRevision: legacy.sourceRevision, predicate: legacy.predicate,
    contentHash: createHash("sha256").update(legacy.rawText).digest("hex"), operationId: id, fingerprint: hash("d") }));
  state.operations.set(id, outcome(id, "unknown"));
  const renderer = await mount(service);
  try {
    assert.ok(stored.has(pendingKey));
    assert.match(text(renderer.root), /操作结果尚未确认/);
    const saved = { ...registered, content: legacy };
    state.entries = [saved];
    state.operations.set(id, outcome(id, "committed", saved));
    await click(renderer, "刷新");
    assert.equal(stored.has(pendingKey), false);
    assert.equal(button(renderer.root, "接受内容").props.disabled, false);
    assert.equal(state.registrations.length, 0);
    assert.equal(state.prepares.length, 0);
    assert.equal(state.commits.length, 0);
  } finally { await unmount(renderer); }
});
