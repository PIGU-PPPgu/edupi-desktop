import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { jsx, jsxs } from "react/jsx-runtime";
import { parseHTML } from "linkedom";

const sources = Object.fromEntries(["EduPiGrowthWorkspace", "EduPiTeachingMethodEditor"].map(name => [name,
  fs.readFileSync(process.env.EDUPI_GROWTH_SOURCE_DIR ? `${process.env.EDUPI_GROWTH_SOURCE_DIR}/${name}.tsx` : new URL(`./${name}.tsx`, import.meta.url), "utf8")]));
const compile = source => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const task = { id: "synthetic-task", title: "[UI TEST] 合成任务", trigger: "teacher_created", status: "planned", deliverables: [], evidence: {} };
const method = (id = "synthetic-method") => ({ skillId: id, title: `[UI TEST] ${id}`, lifecycleState: "trial", trialCount: 1,
  evidenceIds: [], updatedAt: "2026-10-28T00:00:00Z", origin: "managed", revision: 3, contentRevision: 2,
  availableActions: ["update", "record_trial", "validate", "publish", "retire"],
  details: { content: "[UI TEST] 原始正文", truncated: false, retirementReason: null, approval: null, evaluation: null, trials: [], files: [] } });
const lifecycle = skills => ({ status: "ready", mutationEnabled: true, skills, teacherGrowth: [], mutationReceipts: [], generatedAt: null });
const labels = { create: "新增教学方法", update: "修订", record_trial: "记录试用", validate: "验证", publish: "发布", retire: "停用" };
const tick = () => new Promise(resolve => setImmediate(resolve));

async function mount() {
  const { window } = parseHTML("<html><body><button id='elsewhere'>其他入口</button><div id='root'></div></body></html>");
  const globals = Object.fromEntries(["window", "document", "HTMLElement", "IS_REACT_ACT_ENVIRONMENT"].map(name => [name, globalThis[name]]));
  Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const document = window.document;
  const focusState = { current: document.body };
  let invisible = false;
  Object.defineProperty(document, "activeElement", { get: () => focusState.current });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => invisible });
  const focusCalls = [], scrollCalls = [], requests = [], saved = [], events = [], reads = [], errors = [];
  const listeners = new Map(["focusin", "pointerdown", "visibilitychange"].map(name => [name, new Set()]));
  const addListener = document.addEventListener.bind(document), removeListener = document.removeEventListener.bind(document);
  document.addEventListener = (name, listener, options) => { listeners.get(name)?.add(listener); addListener(name, listener, options); };
  document.removeEventListener = (name, listener, options) => { listeners.get(name)?.delete(listener); removeListener(name, listener, options); };
  const disabled = element => Boolean(element.disabled || element.closest("fieldset[disabled]"));
  window.HTMLElement.prototype.focus = function(options) {
    assert.ok(this.isConnected && !disabled(this), "focused element must be connected and enabled");
    focusState.current = this; focusCalls.push({ element: this, options });
    this.dispatchEvent(new window.Event("focusin", { bubbles: true }));
  };
  window.HTMLElement.prototype.scrollIntoView = function(options) { scrollCalls.push({ element: this, options }); };
  // React was loaded before the synthetic document and selects its input fallback.
  window.HTMLElement.prototype.attachEvent = function() {};
  window.HTMLElement.prototype.detachEvent = function() {};
  window.getSelection = () => ({ anchorNode: null, anchorOffset: 0, focusNode: null, focusOffset: 0, rangeCount: 0 });
  window.addEventListener("edupi-preparation-updated", event => events.push(event.type));
  const modules = {
    react: React, "react/jsx-runtime": { jsx, jsxs, Fragment: React.Fragment },
    "@/lib/edupi-workbench": { taskDisplayTitle: value => value.title, confirmedTaskArtifacts: () => [] },
    "@/lib/edupi-domain-navigation": { routePart: (value, prefix, fallback) => value?.startsWith(`${prefix}:`) ? value.slice(prefix.length + 1) : fallback },
    "@/lib/edupi-platform-client": { mutateEduPiTeachingMethod: input => new Promise((resolve, reject) => requests.push({ input, resolve, reject })) },
  };
  const load = name => {
    const exports = {};
    vm.runInNewContext(compile(sources[name]), { exports, window, document, Event: window.Event, Error,
      console: { error: (...args) => errors.push(args) },
      require: name => { assert.ok(modules[name], `mocked ${name}`); return modules[name]; },
    });
    return exports;
  };
  modules["./EduPiTeachingMethodEditor"] = load("EduPiTeachingMethodEditor");
  const { EduPiGrowthWorkspace } = load("EduPiGrowthWorkspace");
  const container = document.getElementById("root"), root = createRoot(container);
  const props = { data: { workspace: "/synthetic/root-one", tasks: [task,
    { ...task, id: "synthetic-auto", title: "[UI TEST] 自动候选", trigger: "teaching_before_class" },
    { ...task, id: "synthetic-rejected", title: "[UI TEST] 被拒绝任务", status: "rejected" }], continuity: { documents: [] }, dataSources: { growth: { present: true } } },
    query: "", selectedObjectId: "growth:edupi", onOpenFile() {}, onTask() {}, onStartAgent() {} };
  let changeLifecycle, observedLifecycle;
  function Parent() {
    const [state, setState] = React.useState(lifecycle([method(), method("synthetic-other")]));
    const workspace = props.data.workspace;
    React.useLayoutEffect(() => { changeLifecycle = setState; }, []);
    React.useLayoutEffect(() => { observedLifecycle = state; }, [state]);
    React.useLayoutEffect(() => {
      let alive = true;
      // The real EducationPanel responds to this event with loadWorkspace /
      // readEduPiTeachingSkills. Its owner read is deferred locally here.
      const refresh = () => {
        new Promise(resolve => reads.push({ resolve })).then(next => { if (alive && props.data.workspace === workspace) setState(next); });
      };
      window.addEventListener("edupi-preparation-updated", refresh);
      return () => { alive = false; window.removeEventListener("edupi-preparation-updated", refresh); };
    }, [workspace]);
    return jsx(EduPiGrowthWorkspace, { ...props, teachingSkills: state, onTeachingSkills: next => { saved.push(next); setState(next); } });
  }
  const f = {
    document, window, container, root, props, requests, saved, events, reads, focusCalls, scrollCalls, listeners,
    get latest() { return observedLifecycle; },
    form: () => container.querySelector("form"),
    async run(action) {
      await act(async () => { action(); await tick(); });
      const active = focusState.current;
      if (active !== document.body && (!active?.isConnected || disabled(active))) focusState.current = document.body;
    },
    async flush() { await f.run(() => {}); },
    button(label, scope = container) { const found = [...scope.querySelectorAll("button")].find(button => button.textContent === label); assert.ok(found, label); return found; },
    async click(button, { focus = true, beforeCommit } = {}) {
      assert.ok(button.isConnected && !disabled(button), `enabled ${button.textContent}`);
      await f.run(() => { if (focus) button.focus(); focusCalls.length = 0; button.dispatchEvent(new window.Event("click", { bubbles: true })); beforeCommit?.(); });
    },
    async open(mode, options) {
      if (mode !== "create") container.querySelector("details.edupi-method-row").setAttribute("open", "");
      await f.click(f.button(labels[mode], mode === "create" ? container : container.querySelector("details.edupi-method-row")), options);
    },
    field(label) {
      const found = [...f.form().querySelectorAll("label")].find(item => item.firstChild?.textContent === label);
      assert.ok(found, label); return found.querySelector("input,textarea,select");
    },
    async change(label, value) {
      const field = f.field(label); assert.ok(!disabled(field));
      await f.run(() => { field.focus();
        const propsKey = Object.keys(field).find(key => key.startsWith("__reactProps$"));
        assert.ok(propsKey, "real React controlled field"); field[propsKey].onChange({ target: { value } });
      });
    },
    async fill(mode) {
      if (mode === "create" || mode === "update") { await f.change("方法名称", "[UI TEST] 修订方法"); await f.change("具体做法", "[UI TEST] 修订正文"); }
      else if (mode === "record_trial") await f.change("课堂反馈", "[UI TEST] 合成试用反馈");
      else if (mode === "validate") await f.change("验证意见", "[UI TEST] 合成验证意见");
      else if (mode === "retire") await f.change("停用原因", "[UI TEST] 合成停用原因");
    },
    async submit({ twice = false, focus = true } = {}) {
      const form = f.form(), button = form.querySelector('button[type="submit"]'); assert.ok(!disabled(button));
      await f.run(() => { if (focus) button.focus(); focusCalls.length = 0;
        form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
        if (twice) form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
      });
    },
    async escape({ composing = false } = {}) {
      const event = new window.Event("keydown", { bubbles: true, cancelable: true });
      Object.defineProperties(event, { key: { value: "Escape" }, isComposing: { value: composing } });
      await f.run(() => f.form().dispatchEvent(event)); return event.defaultPrevented;
    },
    async cancel() { await f.click(f.button("取消", f.form())); },
    async finish({ error, skills, projection = {} } = {}) {
      const request = requests.at(-1); assert.ok(request);
      const resultSkills = skills || (request.input.action === "create"
        ? [method(), method("synthetic-other"), { ...method("synthetic-created"), title: request.input.title, details: { ...method().details, content: request.input.content }, revision: 0, contentRevision: 1, lifecycleState: "draft", availableActions: ["update", "record_trial", "retire"] }]
        : [{ ...method(), revision: request.input.expectedRevision + 1, ...(request.input.action === "update" ? { title: request.input.title, details: { ...method().details, content: request.input.content } } : {}) }, method("synthetic-other")]);
      await f.run(() => error ? request.reject(new Error(error)) : request.resolve({ ...lifecycle(resultSkills), ...projection }));
    },
    async moveFocus() { await f.run(() => document.getElementById("elsewhere").focus()); focusCalls.length = 0; },
    async pointerOutside() { await f.run(() => document.body.dispatchEvent(new window.Event("pointerdown", { bubbles: true }))); focusCalls.length = 0; },
    async visibility(value) { await f.run(() => { invisible = value; document.dispatchEvent(new window.Event("visibilitychange")); }); focusCalls.length = 0; },
    async rerender(patch = {}) { Object.assign(props, patch); await f.run(() => root.render(jsx(Parent, {}))); focusCalls.length = 0; },
    async updateLifecycle(skills, mutationEnabled = true, projection = {}) { await f.run(() => changeLifecycle({ ...lifecycle(skills), mutationEnabled, ...projection })); focusCalls.length = 0; },
    async acceptOwnerRead(skills, projection = {}) {
      assert.ok(reads.length, "successful mutation requested an owner read");
      await f.run(() => reads.at(-1).resolve({ ...lifecycle(skills), ...projection }));
    },
    async close() { await f.run(() => { if (container.firstChild) root.unmount(); }); Object.assign(globalThis, globals); assert.deepEqual(errors, []); },
  };
  await f.run(() => root.render(jsx(Parent, {})));
  return f;
}

for (const mode of Object.keys(labels)) test(`${mode}: opening focuses its first control and leaves one primary action`, async () => {
  const f = await mount();
  try {
    await f.open(mode);
    const expected = mode === "create" || mode === "update" ? f.field("方法名称") : mode === "record_trial" ? f.field("教学任务")
      : mode === "validate" ? f.field("验证意见") : mode === "retire" ? f.field("停用原因") : f.button("取消", f.form());
    assert.ok(f.document.activeElement === expected, `${mode} first control receives focus`);
    assert.equal(f.container.querySelectorAll("button.is-primary").length, 1);
    assert.equal(f.container.querySelectorAll("[data-method-action], [data-method-create]").length, 0);
    assert.equal(f.form().getAttribute("aria-busy"), "false");
    assert.ok(f.scrollCalls.some(call => call.element === f.form()));
  } finally { await f.close(); }
});

for (const mode of Object.keys(labels)) for (const action of ["cancel", "escape"]) test(`${mode}: ${action} returns to the same entrance without writing`, async () => {
  const f = await mount();
  try {
    await f.open(mode); await f.fill(mode);
    if (action === "cancel") await f.cancel(); else assert.equal(await f.escape(), true);
    assert.equal(f.form(), null); assert.equal(f.requests.length, 0);
    const active = f.document.activeElement;
    assert.equal(active.dataset.methodAction || (active.hasAttribute("data-method-create") ? "create" : ""), mode);
  } finally { await f.close(); }
});

for (const mode of Object.keys(labels)) test(`${mode}: pending submission locks all fields, rejects same-tick repeats and cannot cancel`, async () => {
  const f = await mount();
  try {
    await f.open(mode); await f.fill(mode); await f.submit({ twice: true });
    assert.equal(f.requests.length, 1);
    assert.deepEqual([...f.listeners.values()].map(value => value.size), [1, 1, 1]);
    for (const field of f.form().querySelectorAll("input,textarea,select,button")) assert.ok(field.closest("fieldset[disabled]"), field.outerHTML);
    assert.equal(await f.escape(), false); assert.ok(f.form());
    assert.equal(f.container.querySelectorAll("[data-method-action], [data-method-create]").length, 0);
    await f.finish(); assert.equal(f.form(), null); assert.equal(f.saved.length, mode === "create" ? 0 : 1); assert.equal(f.events.length, 1);
    assert.equal(f.reads.length, 1);
    assert.deepEqual([...f.listeners.values()].map(value => value.size), [0, 0, 0]);
    assert.equal(f.document.activeElement.dataset.methodAction || (f.document.activeElement.hasAttribute("data-method-create") ? "create" : ""), mode);
  } finally { await f.close(); }
});

test("retirement completion falls back to the current method summary when its action disappears", async () => {
  const f = await mount();
  try {
    await f.open("retire"); await f.fill("retire"); await f.submit();
    await f.finish({ skills: [{ ...method(), revision: 4, lifecycleState: "retired", availableActions: [] }, method("synthetic-other")] });
    assert.equal(f.document.activeElement.dataset.methodSummary, "synthetic-method");
  } finally { await f.close(); }
});

test("a failed save keeps the draft and original revision, unlocks controls and focuses retry", async () => {
  const f = await mount();
  try {
    await f.open("update"); await f.fill("update"); await f.submit(); await f.finish({ error: "合成版本冲突" });
    assert.equal(f.field("方法名称").value, "[UI TEST] 修订方法"); assert.equal(f.field("具体做法").value, "[UI TEST] 修订正文");
    assert.equal(f.form().querySelector("[role=alert]").textContent, "合成版本冲突");
    assert.equal(f.document.activeElement, f.form().querySelector('button[type="submit"]'));
    assert.equal(f.form().querySelector("fieldset").hasAttribute("disabled"), false);
    await f.submit(); assert.equal(f.requests.length, 2);
    assert.deepEqual(JSON.parse(JSON.stringify(f.requests[0].input)), JSON.parse(JSON.stringify(f.requests[1].input)));
  } finally { await f.close(); }
});

for (const move of ["focus", "pointer", "visibility"]) test(`a ${move} change during save never causes completion to steal focus`, async () => {
  const f = await mount();
  try {
    await f.open("update"); await f.fill("update"); await f.submit();
    if (move === "focus") await f.moveFocus();
    else if (move === "pointer") await f.pointerOutside();
    else { await f.visibility(true); await f.visibility(false); }
    const active = f.document.activeElement;
    await f.finish(); assert.equal(f.document.activeElement, active); assert.deepEqual(f.focusCalls, []);
  } finally { await f.close(); }
});

for (const change of ["category", "workspace", "query", "unmount"]) test(`late completion after ${change} cannot apply lifecycle or focus to another scope`, async () => {
  const f = await mount();
  try {
    await f.open("update"); await f.fill("update"); await f.submit();
    if (change === "category") await f.rerender({ selectedObjectId: "growth:teacher" });
    else if (change === "workspace") await f.rerender({ data: { ...f.props.data, workspace: "/synthetic/root-two" } });
    else if (change === "query") await f.rerender({ query: "synthetic-other" });
    else await f.run(() => f.root.unmount());
    assert.equal(f.form(), null); f.focusCalls.length = 0;
    await f.finish(); assert.equal(f.saved.length, 0); assert.deepEqual(f.focusCalls, []); assert.equal(f.events.length, 0);
  } finally { await f.close(); }
});

test("same-root projection refresh does not remount a draft or silently adopt a newer revision", async () => {
  const f = await mount();
  try {
    await f.open("update"); await f.fill("update"); const form = f.form();
    await f.updateLifecycle([{ ...method(), revision: 4, details: { ...method().details, content: "[UI TEST] 并行新正文" } }, method("synthetic-other")]);
    assert.ok(f.form() === form, "parallel projection keeps the same editor DOM"); assert.equal(f.field("具体做法").value, "[UI TEST] 修订正文");
    await f.submit(); assert.equal(f.requests[0].input.expectedRevision, 3);
  } finally { await f.close(); }
});

test("a revoked method action closes its pending editor and ignores the late lifecycle", async () => {
  const f = await mount();
  try {
    await f.open("publish"); await f.submit();
    const revoked = { ...method(), revision: 5, lifecycleState: "retired", availableActions: [], details: { ...method().details, retirementReason: "[UI TEST] 另一入口停用" } };
    await f.updateLifecycle([revoked, method("synthetic-other")]);
    assert.equal(f.form(), null); assert.deepEqual([...f.listeners.values()].map(value => value.size), [0, 0, 0]);
    await f.finish({ skills: [{ ...method(), revision: 4, lifecycleState: "published", availableActions: ["retire"] }, method("synthetic-other")] });
    assert.equal(f.saved.length, 0); assert.ok(f.container.textContent.includes("已停用"));
    assert.deepEqual(f.focusCalls, []); assert.equal(f.events.length, 0);
  } finally { await f.close(); }
});

test("a newer revision rejects an older successful save without discarding the draft or taking focus", async () => {
  const f = await mount();
  try {
    await f.open("update"); await f.fill("update"); await f.submit();
    const newer = { ...method(), revision: 5, title: "[UI TEST] 后续有效修订", details: { ...method().details, content: "[UI TEST] 后续有效正文" } };
    await f.updateLifecycle([newer, method("synthetic-other")]);
    await f.finish({ skills: [{ ...method(), revision: 4, title: "[UI TEST] 较早保存回执" }, method("synthetic-other")] });
    assert.equal(f.saved.length, 0); assert.ok(f.container.textContent.includes("后续有效修订"));
    assert.equal(f.field("具体做法").value, "[UI TEST] 修订正文");
    assert.equal(f.requests[0].input.expectedRevision, 3);
    assert.match(f.form().querySelector("[role=alert]").textContent, /方法已有更新/);
    assert.deepEqual(f.focusCalls, []); assert.equal(f.events.length, 0);
  } finally { await f.close(); }
});

test("only the owned method is patched; related feedback and receipts arrive through a fresh owner read", async () => {
  const f = await mount();
  try {
    await f.open("update"); await f.fill("update"); await f.submit();
    const other = { ...method("synthetic-other"), revision: 6, title: "[UI TEST] 其他方法新修订" };
    const otherGrowth = { growthId: "other-feedback", methodId: other.skillId, methodTitle: other.title, taskId: task.id, taskTitle: task.title, feedback: "[UI TEST] 新反馈", outcome: "helpful" };
    const otherReceipt = { requestId: "other-receipt", methodId: other.skillId, action: "update", revision: 6, contentRevision: 2, status: "accepted", trialId: null };
    await f.updateLifecycle([method(), other], true, { teacherGrowth: [otherGrowth], mutationReceipts: [otherReceipt], generatedAt: "2026-10-28T00:01:00Z" });
    const own = { ...method(), revision: 4, title: "[UI TEST] 本次保存", details: { ...method().details, content: "[UI TEST] 本次正文" } };
    const ownGrowth = { ...otherGrowth, growthId: "own-feedback", methodId: own.skillId, methodTitle: own.title };
    const ownReceipt = { ...otherReceipt, requestId: "own-receipt", methodId: own.skillId, revision: 4 };
    await f.finish({ skills: [own, method("synthetic-other")], projection: { teacherGrowth: [ownGrowth], mutationReceipts: [ownReceipt], generatedAt: "2026-10-28T00:02:00Z" } });
    assert.equal(f.saved.length, 1); const result = f.saved[0];
    assert.equal(result.skills.find(item => item.skillId === own.skillId).title, own.title);
    assert.equal(result.skills.find(item => item.skillId === other.skillId).title, other.title);
    assert.deepEqual(Array.from(result.teacherGrowth, item => item.growthId), ["other-feedback"]);
    assert.deepEqual(Array.from(result.mutationReceipts, item => item.requestId), ["other-receipt"]);
    assert.equal(result.generatedAt, "2026-10-28T00:01:00Z");
    assert.equal(f.document.activeElement.dataset.methodAction, "update");
    const focused = f.document.activeElement; f.focusCalls.length = 0;
    await f.acceptOwnerRead([own, other], { teacherGrowth: [otherGrowth, ownGrowth], mutationReceipts: [otherReceipt, ownReceipt], generatedAt: "2026-10-28T00:02:00Z" });
    assert.deepEqual(f.latest.teacherGrowth.map(item => item.growthId).sort(), ["other-feedback", "own-feedback"]);
    assert.deepEqual(f.latest.mutationReceipts.map(item => item.requestId).sort(), ["other-receipt", "own-receipt"]);
    assert.ok(f.document.activeElement === focused); assert.deepEqual(f.focusCalls, []);
  } finally { await f.close(); }
});

test("this save preserves an unrelated new method and cannot resurrect a method removed since opening", async () => {
  const f = await mount();
  try {
    await f.open("update"); await f.fill("update"); await f.submit();
    await f.updateLifecycle([method(), method("synthetic-new")]);
    await f.finish();
    assert.equal(f.saved.length, 1);
    assert.deepEqual(f.saved[0].skills.map(item => item.skillId).sort(), ["synthetic-method", "synthetic-new"]);
    assert.equal(f.saved[0].skills.find(item => item.skillId === "synthetic-method").revision, 4);
  } finally { await f.close(); }
});

test("a method observed and removed while saving is not resurrected by a still-valid own response", async () => {
  const f = await mount();
  try {
    await f.open("update"); await f.fill("update"); await f.submit();
    const transient = { ...method("synthetic-transient"), revision: 0, title: "[UI TEST] 已移除的新方法" };
    const own = { ...method(), revision: 4, title: "[UI TEST] 修订方法", details: { ...method().details, content: "[UI TEST] 修订正文" } };
    await f.updateLifecycle([own, method("synthetic-other"), transient]);
    assert.ok(f.container.textContent.includes(transient.title));
    await f.updateLifecycle([own, method("synthetic-other")]);
    assert.equal(f.container.textContent.includes(transient.title), false);
    await f.finish({ skills: [own, method("synthetic-other"), transient] });
    assert.equal(f.saved.length, 1);
    assert.equal(f.saved[0].skills.some(item => item.skillId === transient.skillId), false);
    assert.equal(f.saved[0].skills.find(item => item.skillId === own.skillId).revision, 4);
  } finally { await f.close(); }
});

test("a mutation response can patch neither a newer unrelated method nor an unknown method", async () => {
  const f = await mount();
  try {
    await f.open("update"); await f.fill("update"); await f.submit();
    const own = { ...method(), revision: 4 };
    await f.finish({ skills: [own, { ...method("synthetic-other"), revision: 8, title: "[UI TEST] 非本次对象" }, method("synthetic-unknown")] });
    assert.equal(f.saved.length, 1);
    assert.deepEqual(f.saved[0].skills.map(item => item.skillId), ["synthetic-method", "synthetic-other"]);
    assert.equal(f.saved[0].skills.find(item => item.skillId === "synthetic-other").revision, 3);
    assert.equal(f.saved[0].skills.find(item => item.skillId === "synthetic-method").revision, 4);
    assert.equal(f.reads.length, 1);
  } finally { await f.close(); }
});

test("create never selects unknown response IDs and displays only the fresh owner projection", async () => {
  const f = await mount();
  try {
    await f.open("create"); await f.fill("create"); await f.submit();
    await f.updateLifecycle([method(), { ...method("synthetic-other"), revision: 7, title: "[UI TEST] 另一方法的新状态" }]);
    const created = { ...method("synthetic-created"), title: "[UI TEST] 修订方法", revision: 0, contentRevision: 1, lifecycleState: "draft", details: { ...method().details, content: "[UI TEST] 修订正文" } };
    await f.finish({ skills: [method(), method("synthetic-other"), created, { ...method("synthetic-stale-new"), revision: 0 }] });
    assert.equal(f.saved.length, 0);
    assert.equal(f.latest.skills.some(item => item.skillId === "synthetic-stale-new"), false);
    assert.equal(f.latest.skills.find(item => item.skillId === "synthetic-other").revision, 7);
    assert.ok(f.document.activeElement.hasAttribute("data-method-create"));
    const focused = f.document.activeElement; f.focusCalls.length = 0;
    await f.acceptOwnerRead([method(), { ...method("synthetic-other"), revision: 7 }, created]);
    assert.equal(f.latest.skills.some(item => item.skillId === "synthetic-stale-new"), false);
    assert.ok(f.latest.skills.some(item => item.skillId === "synthetic-created"));
    assert.ok(f.document.activeElement === focused); assert.deepEqual(f.focusCalls, []);
  } finally { await f.close(); }
});

test("a create response cannot reinsert a newly observed method that the owner has since removed", async () => {
  const f = await mount();
  try {
    await f.open("create"); await f.fill("create"); await f.submit();
    const created = { ...method("synthetic-created"), title: "[UI TEST] 修订方法", revision: 0, contentRevision: 1, lifecycleState: "draft", details: { ...method().details, content: "[UI TEST] 修订正文" } };
    await f.updateLifecycle([method(), method("synthetic-other"), created]);
    await f.updateLifecycle([method(), method("synthetic-other")]);
    await f.finish({ skills: [method(), method("synthetic-other"), created] });
    assert.equal(f.saved.length, 0); assert.equal(f.latest.skills.some(item => item.skillId === created.skillId), false);
    assert.equal(f.reads.length, 1);
    await f.acceptOwnerRead([method(), method("synthetic-other")]);
    assert.equal(f.latest.skills.some(item => item.skillId === created.skillId), false);
  } finally { await f.close(); }
});

test("an already observed matching revision keeps current data while completing its editor", async () => {
  const f = await mount();
  try {
    await f.open("update"); await f.fill("update"); await f.submit();
    await f.updateLifecycle([{ ...method(), revision: 4, title: "[UI TEST] 已回读的同版本" }, method("synthetic-other")], true, { generatedAt: "2026-10-28T00:02:00Z" });
    await f.finish({ projection: { generatedAt: "2026-10-28T00:01:00Z" } });
    assert.equal(f.saved.length, 1); assert.equal(f.form(), null);
    assert.equal(f.saved[0].skills.find(item => item.skillId === "synthetic-method").title, "[UI TEST] 已回读的同版本");
    assert.equal(f.saved[0].generatedAt, "2026-10-28T00:02:00Z");
  } finally { await f.close(); }
});

for (const removed of ["method", "capability"]) test(`a removed ${removed} ends the old editor and its response cannot replace current data`, async () => {
  const f = await mount();
  try {
    await f.open("update"); await f.fill("update"); await f.submit();
    if (removed === "method") await f.updateLifecycle([method("synthetic-other")]);
    else await f.updateLifecycle([method(), method("synthetic-other")], false);
    assert.equal(f.form(), null); f.focusCalls.length = 0;
    if (removed === "capability") assert.equal(f.container.querySelectorAll("[data-method-action], [data-method-create]").length, 0);
    const saves = f.saved.length;
    await f.finish(); assert.equal(f.saved.length, saves); assert.deepEqual(f.focusCalls, []); assert.equal(f.events.length, 0);
  } finally { await f.close(); }
});

test("trial keeps eligible task filtering and sends the chosen outcome; validation rejection keeps its decision", async () => {
  const f = await mount();
  try {
    await f.open("record_trial"); const options = [...f.field("教学任务").options];
    assert.deepEqual(options.map(item => item.textContent), ["选择实际教学任务", task.title]);
    await f.fill("record_trial"); await f.change("实际效果", "mixed"); await f.submit();
    assert.equal(f.requests[0].input.taskId, task.id); assert.equal(f.requests[0].input.outcome, "mixed"); await f.finish();
    await f.open("validate"); await f.fill("validate"); await f.click(f.button("不再使用", f.form()));
    assert.equal(f.requests[1].input.decision, "rejected"); assert.equal(f.requests[1].input.expectedRevision, 4);
  } finally { await f.close(); }
});

test("Escape during composition keeps the form; an empty create cannot issue a mutation", async () => {
  const f = await mount();
  try {
    await f.open("create"); assert.equal(await f.escape({ composing: true }), false);
    await f.run(() => f.form().dispatchEvent(new f.window.Event("submit", { bubbles: true, cancelable: true })));
    assert.equal(f.requests.length, 0); assert.ok(f.form());
  } finally { await f.close(); }
});

for (const change of ["focus", "inert", "hidden-document"]) test(`an opening interrupted by ${change} does not focus an unavailable form`, async () => {
  const f = await mount();
  try {
    const options = { beforeCommit() {
      if (change === "focus") f.document.getElementById("elsewhere").focus();
      else if (change === "inert") f.container.setAttribute("inert", "");
      else Object.defineProperty(f.document, "hidden", { get: () => true });
      f.focusCalls.length = 0; f.scrollCalls.length = 0;
    } };
    await f.open("create", options);
    assert.deepEqual(f.focusCalls, []); assert.deepEqual(f.scrollCalls, []);
    assert.ok(f.form()); assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("a failed response after another control received focus keeps its draft without focus return", async () => {
  const f = await mount();
  try {
    await f.open("update"); await f.fill("update"); await f.submit(); await f.moveFocus();
    const active = f.document.activeElement;
    await f.finish({ error: "合成读取失败" });
    assert.ok(f.document.activeElement === active); assert.deepEqual(f.focusCalls, []);
    assert.equal(f.field("具体做法").value, "[UI TEST] 修订正文");
    assert.deepEqual([...f.listeners.values()].map(value => value.size), [0, 0, 0]);
  } finally { await f.close(); }
});
