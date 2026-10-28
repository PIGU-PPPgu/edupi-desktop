import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { jsx, jsxs, Fragment } from "react/jsx-runtime";
import { parseHTML } from "linkedom";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const names = ["edupi-today-work", "edupi-l4-preparation", "edupi-workbench", "edupi-work-case", "edupi-teacher-feedback", "edupi-foreground", "edupi-task-board"];
const modules = Object.fromEntries(await Promise.all(names.map(async name => [`@/lib/${name}`, await jiti.import(`../lib/${name}.ts`)])));
const today = modules["@/lib/edupi-today-work"];
const { buildEducationContract } = await jiti.import("../lib/edupi-education-contract.ts");
const source = fs.readFileSync(process.env.EDUPI_TODAY_SOURCE || new URL("./EduPiTodayWork.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));
const policy = { today: "2026-10-28", graceDays: 3, pinnedTaskIds: [] };
const candidate = id => ({ candidateId: id, taskId: `task-${id}`, snapshotId: "snapshot-a", revision: 2, stateHash: "sha256:state", title: `合成工作 ${id}`, summary: "合成说明", dueAt: "2099-10-28", reason: "教师内部准备", sourceIds: ["synthetic-source"], evidenceIds: ["synthetic-evidence"], status: "pending_review", snoozeUntil: null, suppressionScope: null, nextCycleState: "awaiting_teacher", teacherReview: { state: "pending_review", reviewerId: null, reviewedAt: null, note: null, revision: 2 }, externalSend: false });
const propsOf = element => element[Object.keys(element).find(key => key.startsWith("__reactProps$"))];

async function mount({ strict = false } = {}) {
  const { window } = parseHTML("<html><body><button id='outside'>别处</button><div id='root'></div></body></html>");
  const document = window.document, saved = {};
  window.getSelection = () => ({ anchorNode: null, anchorOffset: 0, focusNode: null, focusOffset: 0 });
  for (const key of ["window", "document", "HTMLElement", "IS_REACT_ACT_ENVIRONMENT"]) saved[key] = globalThis[key];
  Object.assign(globalThis, { window, document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  let active = document.body;
  const activate = element => { active = element; };
  const focused = [], scrolled = [], requests = [], notifications = [];
  Object.defineProperty(document, "activeElement", { configurable: true, get: () => active.isConnected && !active.matches?.(":disabled") ? active : document.body });
  Object.defineProperty(document, "hidden", { configurable: true, writable: true, value: false });
  window.HTMLElement.prototype.focus = function () { if (!this.isConnected || this.matches(":disabled")) return; activate(this); focused.push(this.id || this.textContent); this.dispatchEvent(new window.Event("focusin", { bubbles: true })); };
  window.HTMLElement.prototype.scrollIntoView = function (options) { scrolled.push({ target: this, options }); };
  window.HTMLElement.prototype.attachEvent = () => {};
  window.HTMLElement.prototype.detachEvent = () => {};
  const renderRows = ({ rows, renderRow, limit = 10 }) => jsx("div", { children: rows.slice(0, limit).map(renderRow) });
  const runtime = { ...modules, react: React, "react/jsx-runtime": { jsx, jsxs, Fragment },
    "@/lib/edupi-today-work": { ...today, submitTodayWorkReview: input => today.submitTodayWorkReview(input, (url, options) => {
      assert.equal(url, "/api/edupi/education");
      if (options.method === "GET") return Promise.resolve({ ok: true, json: async () => reconciliationData || props.data });
      assert.equal(options.method, "POST");
      return new Promise(resolve => requests.push({ input, body: JSON.parse(options.body), resolve }));
    }) },
    "@/lib/desktop-updater": { isTauriDesktop: () => false }, "@/lib/edupi-usage-observation": { observeTeacherUsage() { assert.fail("no live usage calls"); } },
    "./EduPiForeground": { useEduPiForegroundPolicy: () => policy, EduPiListPreview: renderRows, EduPiPagedRows: props => renderRows({ ...props, limit: 100 }) },
    "./EduPiUsageObservation": { EduPiUsageArticle: ({ children, className }) => jsx("article", { className, children }), EduPiUsageVisibility: ({ children }) => children },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, window, document, AbortController, Event: window.Event, Intl, Date, crypto: globalThis.crypto,
    fetch(url) { assert.equal(url, "/api/edupi/status?summary=1"); return Promise.resolve({ ok: true, json: async () => ({}) }); },
    require(name) { assert.ok(runtime[name], name); return runtime[name]; },
  });
  const root = createRoot(document.getElementById("root"));
  let reconciliationData = null;
  const props = { data: buildEducationContract({ workspace: "/synthetic/today" }), onTaskDetail() {}, onEducation(next) { notifications.push(next.workspace); props.data = next; render(); } };
  props.data.workCandidates = [candidate("a"), candidate("b")];
  props.data.capabilities.workCandidateReview.enabled = true;
  const render = () => root.render(strict ? jsx(React.StrictMode, { children: jsx(exports.EduPiTodayWork, { ...props }) }) : jsx(exports.EduPiTodayWork, { ...props }));
  const f = { document, window, props, requests, focused, scrolled, notifications,
    get form() { return document.querySelector(".edupi-today-work__editor"); },
    card(id = "a") { return Array.from(document.querySelectorAll("article")).find(element => element.textContent.includes(`合成工作 ${id}`)); },
    button(label, card = f.card()) { const result = Array.from(card.querySelectorAll("button")).find(button => button.textContent === label); assert.ok(result, `button ${label}`); return result; },
    async click(label, card) { await act(async () => { const button = f.button(label, card); assert.equal(button.disabled, false); button.focus(); button.click(); await tick(); }); },
    async draft(id, value) { await act(async () => { const field = document.getElementById(id); propsOf(field).onChange({ target: { value } }); }); },
    async key(key, composing = false, target = document.activeElement) { await act(async () => { const event = new window.Event("keydown", { bubbles: true, cancelable: true }); Object.assign(event, { key, isComposing: composing }); target.dispatchEvent(event); }); },
    async submit() { await act(async () => { f.form.querySelector('button[type="submit"]').focus(); f.form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); await tick(); }); },
    async finish({ error, status, data, reconciliation, index = requests.length - 1 } = {}) { await act(async () => {
      const request = requests[index]; assert.ok(request);
      const next = structuredClone(data || props.data);
      const item = next.workCandidates.find(item => item.candidateId === request.body.candidateId);
      Object.assign(item, request.body.patch, { status: status || ({ modify: "modified", snooze: "snoozed", suppress: "suppressed", accept: "accepted", reject: "rejected", hold: "held" })[request.body.decision], revision: 3, teacherReview: { ...item.teacherReview, reviewedAt: "2026-10-27T20:48:12.000Z" } });
      reconciliationData = reconciliation || next;
      request.resolve({ ok: !error, json: async () => error ? { code: error } : { receipt: { receipt_id: "synthetic-receipt" }, data: next } });
      await tick();
    }); },
    async update(callback) { await act(async () => { callback(props); render(); await tick(); }); },
    async outside() { await act(async () => { document.getElementById("outside").focus(); }); },
    async unmount() { await act(async () => root.unmount()); Object.assign(globalThis, saved); },
  };
  await act(async () => { render(); await tick(); }); focused.length = 0; return f;
}

for (const [label, first] of [["调整", "edupi-today-work-edit-title"], ["稍后", "edupi-today-work-snooze-until"], ["停止提示", "edupi-today-work-suppression-scope"]]) test(`${label} focuses its first real DOM field and Cancel/Escape return to the same current entry`, async () => {
  const f = await mount(); try {
    await f.click(label); assert.equal(f.document.activeElement.id, first);
    assert.equal(f.card().querySelector(".edupi-today-work__actions"), null);
    assert.equal(f.card().querySelectorAll("button.is-primary").length, 1);
    assert.ok(f.scrolled.at(-1).target === f.form);
    await f.click("取消"); assert.equal(f.form, null); assert.ok(f.document.activeElement === f.button(label));
    await f.click(label); await f.key("Escape", true); assert.ok(f.form, "IME Escape must not cancel");
    await f.key("Escape"); assert.equal(f.form, null); assert.ok(f.document.activeElement === f.button(label)); assert.equal(f.requests.length, 0);
  } finally { await f.unmount(); }
});

test("modify preserves the exact captured CAS and draft through failure, locks pending, and returns to the refreshed decision", async () => {
  const f = await mount(); try {
    await f.click("调整"); await f.draft("edupi-today-work-edit-title", "合成修订标题"); await f.draft("edupi-today-work-edit-summary", "合成未保存说明");
    await f.draft("edupi-today-work-edit-due", "2099-10-29");
    await f.submit(); assert.equal(f.requests.length, 1); assert.equal(f.form.querySelector('button[type="submit"]').disabled, true);
    await f.key("Escape", false, f.form); assert.ok(f.form);
    await f.submit(); assert.equal(f.requests.length, 1, "a second submit cannot replace the pending mutation");
    assert.deepEqual(f.requests[0].body, { commandType: "review_work_candidate", candidateId: "a", expectedSnapshotId: "snapshot-a", expectedRevision: 2, decision: "modify", patch: { title: "合成修订标题", summary: "合成未保存说明", dueAt: "2099-10-29" } });
    await f.finish({ error: "unavailable" }); assert.ok(f.form); assert.equal(f.document.getElementById("edupi-today-work-edit-summary").value, "合成未保存说明");
    assert.equal(f.document.getElementById("edupi-today-work-edit-due").value, "2099-10-29");
    assert.ok(f.document.activeElement === f.form.querySelector('button[type="submit"]'), `retry focus was ${f.document.activeElement.tagName}`);
    await f.submit(); await f.finish(); assert.equal(f.form, null);
    assert.equal(f.document.activeElement.textContent, "修改决定");
  } finally { await f.unmount(); }
});

test("snooze and suppress send their existing patch/note and focus the moved current card", async () => {
  for (const [label, field, value, decision, patch, note] of [["稍后", "edupi-today-work-snooze-until", "2099-12-30", "snooze", { snoozeUntil: "2099-12-30" }], ["停止提示", "edupi-today-work-suppression-note", "合成原因", "suppress", { suppressionScope: "this_candidate" }, "合成原因"]]) {
    const f = await mount(); try {
      await f.click(label); await f.draft(field, value); await f.submit();
      assert.equal(f.requests[0].body.decision, decision); assert.deepEqual(f.requests[0].body.patch, patch);
      assert.equal(f.requests[0].body.note, note); await f.finish();
      assert.equal(f.form, null); assert.equal(f.document.activeElement.textContent, "修改决定");
      assert.equal(f.document.activeElement.closest("article").querySelector("time").getAttribute("title"), "2026-10-27T20:48:12.000Z");
      assert.doesNotMatch(f.document.activeElement.closest("article").textContent, /2026-10-27T20:48/);
    } finally { await f.unmount(); }
  }
});

test("pending completion respects a newer focus even when it later returns to body", async () => {
  for (const error of [undefined, "unavailable"]) for (const returnToBody of [false, true]) {
    const f = await mount(); try {
      await f.click("调整"); await f.draft("edupi-today-work-edit-title", "合成修订"); await f.submit();
      await f.outside();
      if (returnToBody) await act(async () => f.document.body.focus());
      f.focused.length = 0; await f.finish({ error });
      assert.equal(returnToBody ? f.document.activeElement.tagName : f.document.activeElement.id, returnToBody ? "BODY" : "outside"); assert.deepEqual(f.focused, []);
    } finally { await f.unmount(); }
  }
});

test("a review that moves outside the current list returns to that list's visible heading", async () => {
  const f = await mount(); try {
    await f.update(props => { props.selectedObjectId = "today:list:now"; });
    await f.click("调整"); await f.draft("edupi-today-work-edit-title", "合成修订"); await f.submit(); await f.finish();
    assert.equal(f.document.activeElement.tagName, "H1"); assert.equal(f.document.activeElement.textContent, "待你决定");
  } finally { await f.unmount(); }
});

test("candidate refreshes and leaving the current list do not restore an old pending control", async () => {
  const f = await mount(); try {
    await f.click("调整"); const title = f.document.activeElement;
    await f.update(props => { props.data = { ...props.data, workCandidates: props.data.workCandidates.map(item => item.candidateId === "b" ? { ...item, summary: "另一项刷新" } : item) }; });
    assert.ok(f.document.activeElement === title);
    await f.draft("edupi-today-work-edit-title", "合成修订"); await f.submit();
    await f.update(props => { props.selectedObjectId = "today:list:later"; }); f.focused.length = 0;
    await f.finish(); assert.deepEqual(f.focused, []);
  } finally { await f.unmount(); }
});

test("recorded and later status times are local short text while exact timestamps remain in title", async () => {
  const f = await mount(); try {
    await f.update(props => { props.data.workCandidates = props.data.workCandidates.map(item => ({ ...item, status: "snoozed", snoozeUntil: "2099-10-28T20:48:12.000Z", teacherReview: { ...item.teacherReview, reviewedAt: "2026-10-27T20:48:12.000Z" } })); });
    assert.doesNotMatch(f.card().textContent, /T20:48.*Z/); assert.match(f.card().textContent, /2099\/10\//);
    assert.equal(f.card().querySelector("time").dateTime || f.card().querySelector("time").getAttribute("dateTime"), "2026-10-27T20:48:12.000Z");
    const local = new Date("2026-10-27T20:48:12.000Z");
    assert.equal(f.card().querySelector("time").textContent, `${local.getFullYear()}/${local.getMonth() + 1}/${local.getDate()} ${String(local.getHours()).padStart(2, "0")}:${String(local.getMinutes()).padStart(2, "0")}`);
  } finally { await f.unmount(); }
});

test("source disclosure uses available calendar titles and marks unresolved references without exposing raw IDs", async () => {
  const f = await mount(); try {
    await f.update(props => {
      props.data.tasks = buildEducationContract({ tasks: [{ id: "task-a", title: "合成会议准备", source_event_id: "calendar-a", trigger: "meeting_preparation", status: "planned", due_date: "2099-10-28", evidence: {} }] }).tasks;
      props.data.calendar = [{ id: "calendar-a", date: "2099-10-28", name: "合成教研会议" }];
      props.data.workCandidates[0] = { ...props.data.workCandidates[0], sourceIds: ["task-a"], evidenceIds: ["calendar-a", "teaching_method_unknown", "calendar_version_unknown"] };
    });
    const details = f.card().querySelector("details");
    await act(async () => { details.querySelector("summary").click(); });
    assert.match(details.textContent, /合成教研会议/);
    assert.match(details.textContent, /2 项依据待核对/);
    assert.doesNotMatch(details.textContent, /task-a|calendar-a|teaching_method_unknown|calendar_version_unknown|候选 ID/);
    assert.deepEqual(f.props.data.workCandidates[0].evidenceIds, ["calendar-a", "teaching_method_unknown", "calendar_version_unknown"]);
  } finally { await f.unmount(); }
});

test("recorded decisions can open a real adjustment form without relaxing revision or snapshot capture", async () => {
  for (const status of ["accepted", "modified", "rejected", "suppressed"]) {
    const f = await mount(); try {
      await f.update(props => { props.data.workCandidates[0] = { ...props.data.workCandidates[0], status, teacherReview: { ...props.data.workCandidates[0].teacherReview, state: status === "suppressed" ? "rejected" : status, reviewedAt: "2026-10-27T20:48:12.000Z" } }; });
      await f.click("修改决定"); await f.click("调整"); assert.ok(f.form, `${status} must allow an explicit adjustment`);
      assert.equal(f.document.activeElement.id, "edupi-today-work-edit-title");
      await f.draft("edupi-today-work-edit-title", "合成重新调整"); await f.submit();
      assert.equal(f.requests[0].body.expectedRevision, 2); assert.equal(f.requests[0].body.expectedSnapshotId, "snapshot-a");
      assert.equal(f.requests[0].body.decision, "modify"); await f.finish();
      assert.equal(f.props.data.workCandidates[0].status, "modified"); assert.equal(f.document.activeElement.textContent, "修改决定");
    } finally { await f.unmount(); }
  }
});

test("switching workspace invalidates every editor and its detached submit handler despite matching candidate CAS", async () => {
  for (const [label, field, value] of [["调整", "edupi-today-work-edit-title", "只属于旧目录的草稿"], ["稍后", "edupi-today-work-snooze-until", "2099-12-30"], ["停止提示", "edupi-today-work-suppression-note", "只属于旧目录的原因"]]) {
    const f = await mount(); try {
      await f.click(label); await f.draft(field, value);
      const submit = propsOf(f.form).onSubmit;
      await f.update(props => { props.data = { ...props.data, workspace: "/synthetic/other" }; });
      assert.equal(f.form, null);
      await act(async () => submit({ preventDefault() {} }));
      assert.equal(f.requests.length, 0); assert.equal(f.document.querySelector('[role="alert"]'), null);
      await f.click(label); assert.notEqual(f.document.getElementById(field).value, value, "a new directory starts from its own candidate values");
    } finally { await f.unmount(); }
  }
});

test("late old-workspace success, reconciliation and failure cannot replace the new projection or its local state", async () => {
  for (const error of [undefined, "stale_snapshot", "unavailable"]) {
    const f = await mount(); try {
      const oldData = structuredClone(f.props.data);
      await f.click("调整"); await f.draft("edupi-today-work-edit-title", "旧目录返回的标题"); await f.submit();
      await f.update(props => { props.data = { ...props.data, workspace: "/synthetic/other" }; });
      assert.equal(f.form, null); assert.doesNotMatch(f.card().textContent, /正在调整|正在提交/);
      f.focused.length = 0;
      await f.finish({ error, data: oldData, reconciliation: oldData });
      assert.equal(f.props.data.workspace, "/synthetic/other"); assert.deepEqual(f.notifications, []);
      assert.equal(f.form, null); assert.equal(f.document.querySelector('[role="alert"]'), null);
      assert.equal(f.document.querySelector('.edupi-today-work__feedback'), null); assert.deepEqual(f.focused, []);
      assert.equal(today.getTodayWorkMutationSnapshot(), false, "the actual shared mutation lock still releases");
      assert.equal(f.button("接受").disabled, false);
      await f.click("调整"); await f.draft("edupi-today-work-edit-title", "新目录的草稿"); await f.submit();
      assert.equal(f.requests.length, 2);
      assert.deepEqual(Object.keys(f.requests[1].body).sort(), ["commandType", "candidateId", "expectedSnapshotId", "expectedRevision", "decision", "patch"].sort());
      await f.finish(); assert.equal(f.props.data.workspace, "/synthetic/other"); assert.deepEqual(f.notifications, ["/synthetic/other"]);
    } finally { await f.unmount(); }
  }
});

test("returning to the same workspace name does not revive a previous workspace generation", async () => {
  const f = await mount(); try {
    const oldData = structuredClone(f.props.data);
    await f.click("调整"); await f.draft("edupi-today-work-edit-title", "旧代次标题"); await f.submit();
    await f.update(props => { props.data = { ...props.data, workspace: "/synthetic/other" }; });
    await f.update(props => { props.data = { ...props.data, workspace: oldData.workspace }; });
    f.focused.length = 0; await f.finish({ data: oldData });
    assert.equal(f.props.data.workspace, oldData.workspace); assert.deepEqual(f.notifications, []); assert.deepEqual(f.focused, []);
    assert.equal(f.props.data.workCandidates[0].title, "合成工作 a");
    await f.click("调整"); assert.equal(f.document.getElementById("edupi-today-work-edit-title").value, "合成工作 a");
  } finally { await f.unmount(); }
});

test("same-workspace list navigation keeps a valid review result while cancelling only its focus return", async () => {
  const f = await mount(); try {
    await f.click("调整"); await f.draft("edupi-today-work-edit-title", "同目录的有效调整"); await f.submit();
    await f.update(props => { props.selectedObjectId = "today:list:later"; });
    f.focused.length = 0; await f.finish();
    assert.equal(f.props.data.workCandidates[0].title, "同目录的有效调整");
    assert.deepEqual(f.notifications, ["/synthetic/today"]); assert.deepEqual(f.focused, []);
  } finally { await f.unmount(); }
});

test("an unexpected response workspace is not applied even while the displayed workspace stays unchanged", async () => {
  const f = await mount(); try {
    const otherData = { ...structuredClone(f.props.data), workspace: "/synthetic/unexpected" };
    await f.click("调整"); await f.draft("edupi-today-work-edit-title", "合成修订"); await f.submit();
    await f.finish({ data: otherData });
    assert.equal(f.props.data.workspace, "/synthetic/today"); assert.deepEqual(f.notifications, []);
    assert.equal(today.getTodayWorkMutationSnapshot(), false); assert.match(f.document.querySelector('[role="alert"]').textContent, /内容已更新/);
  } finally { await f.unmount(); }
});

test("workspace binding remains usable after StrictMode effect replay", async () => {
  const f = await mount({ strict: true }); try {
    await f.click("调整"); assert.equal(f.document.activeElement.id, "edupi-today-work-edit-title");
    await f.draft("edupi-today-work-edit-title", "严格模式调整"); await f.submit(); await f.finish();
    assert.equal(f.requests.length, 1); assert.deepEqual(f.notifications, ["/synthetic/today"]);
  } finally { await f.unmount(); }
});

test("unmount invalidates a pending result without interfering with shared lock release", async () => {
  const f = await mount(), data = structuredClone(f.props.data);
  await f.click("调整"); await f.draft("edupi-today-work-edit-title", "已离开页面的调整"); await f.submit();
  await f.unmount(); f.focused.length = 0; await f.finish({ data });
  assert.deepEqual(f.notifications, []); assert.deepEqual(f.focused, []); assert.equal(today.getTodayWorkMutationSnapshot(), false);
});
