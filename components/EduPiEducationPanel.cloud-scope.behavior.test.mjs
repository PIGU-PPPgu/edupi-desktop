import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import React, { act } from "react";
import { create } from "react-test-renderer";
import ts from "typescript";
import {
  educationWriteHeaders, getEduPiEducationScopeVersion, preserveUnavailableWorkspaceResources,
  readEduPiWorkspace, resetEduPiEducationRequestForTest,
} from "../lib/edupi-education-client.ts";
import { announceEduPiCloudStatus, EDUPI_EDUCATION_SCOPE_CHANGED } from "../lib/edupi-cloud-events.ts";
import { createActivationRequestTracker } from "../lib/edupi-activation-request.ts";
import { hasEveryTrackedTask } from "../lib/edupi-task-refresh.ts";

const require = createRequire(import.meta.url);
const text = fs.readFileSync(new URL("./EduPiEducationPanel.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("panel.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const body = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "EduPiEducationPanel").body;
const declaration = name => {
  const node = body.statements.find(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(item => ts.isArrayBindingPattern(item.name)
      ? item.name.elements.some(binding => binding.name?.getText(source) === name) : item.name.getText(source) === name));
  assert.ok(node, name);
  return node.getText(source);
};
const effects = body.statements.filter(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
  && node.expression.expression.getText(source) === "useEffect");
const effect = marker => {
  const matches = effects.filter(node => node.getText(source).includes(marker));
  assert.equal(matches.length, 1, marker);
  return matches[0].getText(source);
};
let rootKey, toast;
function visit(node) {
  if (ts.isJsxAttribute(node) && node.name.getText(source) === "key"
    && node.initializer?.expression?.getText(source) === "workspaceScopeVersion") rootKey = node.initializer.expression.getText(source);
  if (ts.isJsxExpression(node) && node.getText(source).includes('className={`edupi-material-staging-toast')) toast = node.expression.getText(source);
  ts.forEachChild(node, visit);
}
visit(body);
assert.ok(rootKey, "the displayed subtree must carry the actual panel scope key");
assert.ok(toast, "use the actual panel's pending-write notification");
const fields = [
  "workspaceScopeVersion", "education", "context", "memoryScopes", "teachingSkills", "kernelState", "runningKernelCount",
  "loading", "loadError", "selectedTaskKey", "selectedStudentId", "selectedObjectId", "selectedC1Target", "reviewMode",
  "activeStage", "taskDetailTask", "agentTask", "drawer", "previewPath", "previewArtifact", "fileReturnTaskKey",
  "pendingTaskBinding", "pendingAgentPrompt", "taskSessionBusy", "taskSessionError", "reviewBusy", "reviewMessage",
  "stagedMaterials", "materialStagingBusy", "educationIntakeBusy", "materialStagingMessage", "contextOpen", "contextBusy",
  "calendarSelection", "inspectorOpen", "deleteLabel", "deleteBusy",
  "workspaceLoadSequenceRef", "workspaceMinimumApplySequenceRef", "workspaceRequestsRef", "preparationPollsRef",
  "taskRefreshesRef", "taskRefreshRequirementsRef", "durableTaskIdsRef", "deleteResolver", "appliedCalendarLink",
  "activationRequestsRef", "taskSessionOpeningRef",
];
const code = ts.transpileModule(`exports.ScopePanel = function ScopePanel({readOnlyRefreshActive = true, refreshKey = 0}) {
  const projectionReadsActive = readOnlyRefreshActive;
  const requestedTaskKey = "same-task", requestedStudentId = "same-student", requestedObjectId = "same-material";
  const requestedStage = "review", requestedReviewTarget = null, routeView = "workspace", activeView = "workspace";
  ${fields.map(declaration).join("\n")}
  ${["isCurrentWorkspace", "commitEducationSnapshot", "cancelActivation", "loadWorkspace", "createBoardTask", "moveBoardTask"].map(declaration).join("\n")}
  ${effect("window.addEventListener(EDUPI_EDUCATION_SCOPE_CHANGED")}
  ${effect("[loadWorkspace, refreshKey, projectionReadsActive,")}
  expose({ education, context, loading, loadError, taskDetailTask, selectedTaskKey, drawer,
    pendingTaskBinding, materialStagingMessage, commitEducationSnapshot, loadWorkspace, createBoardTask, moveBoardTask,
    preparationPollsRef, taskRefreshesRef, taskRefreshRequirementsRef, durableTaskIdsRef,
    setTaskDetailTask, setDrawer, setPendingTaskBinding });
  if (!education) return <div role="status">正在读取教育工作区</div>;
  return <section key={${rootKey}}>
    <ScopedChild data={education} onEducation={commitEducationSnapshot} onMoveTask={moveBoardTask}/>
    {${toast}}
  </section>;
}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const bundle = (workspace, resourceUnavailable = false) => ({
  context: { name: workspace },
  data: {
    workspace, cloudScope: `scope:${workspace}`, tasks: [{ id: "same-task", title: `任务 ${workspace}`, boardRevision: 0, boardStage: "todo" }],
    students: [], studentNameCounts: {}, teacherMaterials: resourceUnavailable ? [] : [{ material_id: `material:${workspace}` }],
    generatedArtifacts: [], workspaceResourcesUnavailable: resourceUnavailable,
  },
});
const cloudStatus = (workspaceId, generation = 1) => ({
  mode: "cloud", generation, configured: true, workspaceId,
  session: { state: "signed_in", user: { id: "same-account", email: null }, expiresAt: "2030-01-01T00:00:00.000Z" },
  sync: { pending: 0, conflict: 0, failed: 0 }, error: null,
});
const renderedText = node => typeof node === "string" ? node : (node?.children || []).map(renderedText).join("");

async function mount(t, initialProps = {}) {
  resetEduPiEducationRequestForTest();
  const previousWindow = globalThis.window, previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const window = new EventTarget();
  globalThis.window = window;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  announceEduPiCloudStatus(cloudStatus("workspace-a"));
  const state = { current: bundle("workspace-a"), reads: [], queued: [], writes: [], refreshes: [], preparationPolls: [], routes: [], api: null, child: null };
  const searchParams = new URLSearchParams("view=workspace&task=same-task&taskDetail=same-task&item=same-material&student=same-student");
  let write = async () => Response.json({ pendingSync: true, data: null, receipt: null }, { status: 202 });
  let desktopHeaders = async headers => headers;
  const router = { replace: value => state.routes.push(value) };
  function ScopedChild({ data, onEducation, onMoveTask }) {
    const [draft, setDraft] = React.useState(`draft:${data.workspace}`);
    state.child = { data, onEducation, onMoveTask, draft, setDraft };
    return React.createElement("button", { onClick: () => onMoveTask(data.tasks[0], "doing") }, `${data.tasks[0].title} ${draft}`);
  }
  const exported = {};
  vm.runInNewContext(code, {
    exports: exported, ...React, window, router, searchParams, URLSearchParams, AbortController, DOMException, Event,
    getEduPiEducationScopeVersion, educationWriteHeaders, EDUPI_EDUCATION_SCOPE_CHANGED, createActivationRequestTracker,
    preserveUnavailableWorkspaceResources, hasEveryTrackedTask, ScopedChild,
    objectItemForView: (_view, id) => id,
    isTaskStage: () => true,
    readEduPiWorkspace: options => readEduPiWorkspace({
      ...options,
      fetcher: async (_url, init) => {
        state.reads.push(init);
        const selected = state.queued.shift() ?? state.current;
        return { ok: true, json: async () => selected?.promise ?? selected };
      },
    }),
    readEducationMemoryScopes: async () => null,
    readEduPiTeachingSkills: async () => ({ skills: [] }),
    readEduPiKernel: async () => ({ running: 0 }),
    refreshCommittedTask: (...args) => state.refreshes.push(args),
    pollBoardPreparation: taskId => state.preparationPolls.push(taskId),
    desktopApiHeaders: headers => desktopHeaders(headers),
    fetch: async (url, options) => { state.writes.push({ url, ...options }); return write(url, options); },
    expose: value => { state.api = value; },
    require,
  });
  let props = initialProps, renderer;
  t.after(async () => {
    if (renderer) await act(async () => renderer.unmount());
    resetEduPiEducationRequestForTest();
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct;
  });
  await act(async () => { renderer = create(React.createElement(exported.ScopePanel, props)); });
  return {
    state, renderer,
    async run(callback) { await act(async () => { await callback(); }); },
    async update(next) { props = { ...props, ...next }; await act(async () => renderer.update(React.createElement(exported.ScopePanel, props))); },
    async switchTo(workspace, nextBundle = bundle(workspace), generation = 2) {
      state.current = nextBundle;
      await act(async () => announceEduPiCloudStatus(cloudStatus(workspace, generation)));
    },
    setWrite: next => { write = next; },
    setDesktopHeaders: next => { desktopHeaders = next; },
  };
}

test("scope changes clear old data, task controls and task tracking before the new workspace finishes loading", async t => {
  const f = await mount(t);
  const oldPreparation = new AbortController(), oldTaskRefresh = new AbortController(), next = deferred();
  f.state.api.preparationPollsRef.current.set("same-task", oldPreparation);
  f.state.api.taskRefreshesRef.current.set("same-task", oldTaskRefresh);
  f.state.api.taskRefreshRequirementsRef.current.set("same-task", { boardRevision: 4 });
  f.state.api.durableTaskIdsRef.current.add("old-only-task");
  await f.run(() => {
    f.state.api.setTaskDetailTask(f.state.current.data.tasks[0]);
    f.state.api.setDrawer("agent");
    f.state.api.setPendingTaskBinding({ taskId: "same-task", previousSessionId: null });
  });
  f.state.queued.push(next);
  await f.switchTo("workspace-b", bundle("workspace-b", true));
  assert.equal(f.state.api.education, null);
  assert.equal(f.renderer.root.findAllByType("button").length, 0);
  assert.equal(f.state.api.taskDetailTask, null);
  assert.equal(f.state.api.selectedTaskKey, null);
  assert.equal(f.state.api.drawer, null);
  assert.equal(f.state.api.pendingTaskBinding, null);
  assert.equal(oldPreparation.signal.aborted, true);
  assert.equal(oldTaskRefresh.signal.aborted, true);
  assert.equal(f.state.api.taskRefreshRequirementsRef.current.size, 0);
  assert.equal(f.state.api.durableTaskIdsRef.current.size, 0);
  assert.equal(f.state.routes.at(-1), "/?view=workspace");
  await f.run(() => next.resolve(bundle("workspace-b", true)));
  assert.equal(f.state.api.education.workspace, "workspace-b");
  assert.equal(f.state.api.education.teacherMaterials.length, 0, "A's cached materials must not be preserved into B");
  assert.match(renderedText(f.renderer.toJSON()), /任务 workspace-b/);
});

test("late workspace reads and unmounted child mutation callbacks cannot overwrite the new workspace with matching task IDs", async t => {
  const f = await mount(t), oldResponse = deferred();
  const oldFactCallback = f.state.child.onEducation;
  const oldMaterialCallback = f.state.child.onEducation;
  f.state.queued.push(oldResponse);
  let lateRead;
  await f.run(() => { lateRead = f.state.api.loadWorkspace().catch(error => error); });
  const oldSignal = f.state.reads.at(-1).signal;
  await f.switchTo("workspace-b");
  assert.equal(oldSignal.aborted, true);
  assert.equal((await lateRead).name, "AbortError");
  await f.run(() => oldResponse.resolve(bundle("workspace-a")));
  await f.run(() => {
    oldFactCallback({ ...bundle("workspace-a").data, factLabel: "late fact" });
    oldMaterialCallback({ ...bundle("workspace-a").data, materialLabel: "late material" });
  });
  assert.equal(f.state.api.education.workspace, "workspace-b");
  assert.equal(f.state.api.education.factLabel, undefined);
  assert.equal(f.state.api.education.materialLabel, undefined);
});

test("the real scope key remounts child state for identical IDs, while same-scope polls keep the current child", async t => {
  const f = await mount(t);
  await f.run(() => f.state.child.setDraft("old workspace draft"));
  const reads = f.state.reads.length;
  await f.run(() => announceEduPiCloudStatus({ ...cloudStatus("workspace-a"), sync: { pending: 4, conflict: 0, failed: 0 } }));
  assert.equal(f.state.reads.length, reads);
  assert.equal(f.state.child.draft, "old workspace draft");
  await f.switchTo("workspace-b");
  assert.equal(f.state.child.draft, "draft:workspace-b");
});

test("a scope change behind settings clears the hidden panel and waits for activation before reloading", async t => {
  const f = await mount(t);
  await f.update({ readOnlyRefreshActive: false });
  const reads = f.state.reads.length;
  await f.switchTo("workspace-b");
  assert.equal(f.state.api.education, null);
  assert.equal(f.state.reads.length, reads);
  await f.update({ readOnlyRefreshActive: true });
  assert.equal(f.state.api.education.workspace, "workspace-b");
});

test("a queued 202 task move succeeds without data, shows pending sync and captures the displayed workspace header", async t => {
  const f = await mount(t);
  await f.run(() => f.state.api.moveBoardTask(f.state.current.data.tasks[0], "doing"));
  assert.equal(f.state.writes[0].headers.get("x-edupi-cloud-scope"), "scope:workspace-a");
  assert.equal(f.state.api.education.tasks[0].boardStage, "todo", "queued writes must not invent a confirmed stage");
  assert.equal(f.state.refreshes.length, 0, "queued work must not start confirmed-revision polling");
  assert.equal(f.state.api.materialStagingMessage.tone, "success");
  assert.match(renderedText(f.renderer.toJSON()), /已保存，待同步/);
});

test("a late task move response and an old move closure cannot update or write through the new workspace", async t => {
  const f = await mount(t), response = deferred();
  f.setWrite(async () => response.promise);
  const oldMove = f.state.api.moveBoardTask;
  let move;
  await f.run(() => { move = oldMove(f.state.current.data.tasks[0], "doing"); });
  await f.switchTo("workspace-b");
  await f.run(() => response.resolve(Response.json({ data: bundle("workspace-a").data })));
  await move;
  assert.equal(f.state.api.education.workspace, "workspace-b");
  assert.equal(f.state.refreshes.length, 0);
  assert.equal(f.state.writes[0].headers.get("x-edupi-cloud-scope"), "scope:workspace-a");
  await assert.rejects(oldMove(f.state.current.data.tasks[0], "doing"), error => error.name === "AbortError");
  assert.equal(f.state.writes.length, 1);
});

test("task creation binds headers before native authorization and stops if scope changes during that wait", async t => {
  const f = await mount(t), authorization = deferred();
  let captured;
  f.setDesktopHeaders(headers => { captured = headers; return authorization.promise; });
  let create;
  await f.run(() => {
    create = f.state.api.createBoardTask({ title: "synthetic", recurrence: {} }).catch(error => error);
  });
  assert.equal(captured.get("x-edupi-cloud-scope"), "scope:workspace-a");
  await f.switchTo("workspace-b");
  await f.run(() => authorization.resolve(captured));
  assert.equal((await create).name, "AbortError");
  assert.equal(f.state.writes.length, 0);
});

test("an offline queued task create leaves other objects refreshable without durable tracking or confirmation polls", async t => {
  const f = await mount(t);
  f.setWrite(async () => Response.json({
    taskId: "offline-queued-task", pendingSync: true, data: null, receipt: null, preparation: null, refreshPending: true,
  }, { status: 202 }));
  let outcome;
  await f.run(async () => { outcome = await f.state.api.createBoardTask({ title: "离线任务", preparationSource: {} }); });
  assert.deepEqual(JSON.parse(JSON.stringify(outcome)), { preparationState: null, preparationError: null });
  assert.equal(f.state.api.durableTaskIdsRef.current.size, 0);
  assert.equal(f.state.api.taskRefreshRequirementsRef.current.size, 0);
  assert.equal(f.state.refreshes.length, 0);
  assert.equal(f.state.preparationPolls.length, 0);
  assert.match(renderedText(f.renderer.toJSON()), /已保存，待同步/);
  f.state.current = {
    ...bundle("workspace-a"),
    data: {
      ...bundle("workspace-a").data,
      tasks: [{ ...bundle("workspace-a").data.tasks[0], title: "另一个任务已更新" }],
      teacherMaterials: [{ material_id: "another-material-updated" }],
    },
  };
  await f.run(() => f.state.api.loadWorkspace());
  assert.equal(f.state.api.education.tasks[0].title, "另一个任务已更新");
  assert.equal(f.state.api.education.teacherMaterials[0].material_id, "another-material-updated");
  assert.equal(f.state.api.education.tasks.some(task => task.id === "offline-queued-task"), false);
});
