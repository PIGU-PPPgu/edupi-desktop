import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createJiti } from "jiti";
import ts from "typescript";

const root = new URL("../../../", import.meta.url);
const require = createRequire(import.meta.url);
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const real = Object.fromEntries(await Promise.all([
  "bounded-form-data", "request-security", "desktop-api-auth", "desktop-api",
  "edupi-cloud-client", "edupi-core-snapshot", "edupi-context-editor-model",
  "edupi-teacher-context-review", "edupi-teacher-context-versions",
  "edupi-teaching-priorities", "edupi-teaching-priority-request",
  "edupi-reminder-action", "edupi-docx-chapter-suggestion",
].map(async name => [`@/lib/${name}`, await jiti.import(new URL(`lib/${name}.ts`, root).pathname)])));
const { EduPiCloudError } = real["@/lib/edupi-cloud-client"];
const compiled = new Map();
const token = "synthetic-contract-cloud-errors-token-123456789";
const previousToken = process.env.PI_DESKTOP_API_TOKEN;
test.before(() => { process.env.PI_DESKTOP_API_TOKEN = token; });
test.after(() => {
  if (previousToken === undefined) delete process.env.PI_DESKTOP_API_TOKEN;
  else process.env.PI_DESKTOP_API_TOKEN = previousToken;
});

function load(route, error, overrides = {}) {
  if (!compiled.has(route)) compiled.set(route, ts.transpileModule(
    fs.readFileSync(new URL(`app/api/edupi/${route}/route.ts`, root), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } },
  ).outputText);
  let injections = 0;
  const reject = async () => { injections++; throw error; };
  const unexpected = () => assert.fail("scope read failure must stop subsequent local work");
  const modules = {
    ...real,
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/edupi-education-server": {
      readEducationContract: reject, readEducationWorkspaceBundle: reject, reviewTeacherContextCandidate: reject,
      bindEducationTaskSession: reject,
    },
    "@/lib/edupi-onboarding-server": { readTeacherContext: reject },
    "@/lib/edupi-core-snapshot": { ...real["@/lib/edupi-core-snapshot"], resolveEduPiBridgeRoots: () => ({}) },
    "@/lib/edupi-core-process-client": { runCoreProcess: async () => ({
      ok: true, context_id: "context-1", revision: 0, proposed_values: { name: "合成老师" },
    }) },
    "@/lib/edupi-teaching-priorities": {
      ...real["@/lib/edupi-teaching-priorities"],
      createTeachingPriority: async () => ({ priorityId: "priority-1" }),
      updateTeachingPriority: async () => ({ priorityId: "priority-1" }),
      readTeachingPriorityHistory: async () => ({}),
      restoreTeachingPriorityVersion: unexpected,
    },
    "@/lib/edupi-teacher-context-versions": {
      ...real["@/lib/edupi-teacher-context-versions"], readTeacherContextVersions: reject,
    },
    "@/lib/edupi-cloud-request-scope": { captureEducationWriteScope: route.startsWith("facts/")
      ? async () => ({ mode: "cloud", scope: { workspaceId: "synthetic" } }) : reject },
    "@/lib/edupi-preparation-runtime": { preparationStatus: reject, startPreparation: reject, ensurePreparation: reject },
    "@/lib/edupi-fact-lifecycle": { FactLifecycleError: class extends Error {}, mutateEducationFact: unexpected, findDeletedEducationFact: unexpected },
    "@/lib/edupi-fact-lifecycle-request": { parseFactId: value => value, parseFactMutationBody: value => value },
    "@/lib/edupi-fact-lifecycle-server": { verifiesDeletedFact: unexpected, verifiesFactMutation: unexpected },
    "@/lib/edupi-cloud-fact": { issueCloudFactMutation: reject },
    "@/lib/edupi-reminder-events": { reminderEvents: unexpected },
    "@/lib/edupi-foreground-server": { readServerForegroundPolicy: unexpected },
    "@/lib/edupi-reminder-notification-proof": {},
    "@/lib/edupi-reminder-store": { updateReminderStore: unexpected },
    "@/lib/edupi-attention-delivery": {},
    "@/lib/edupi-attention-outbox": {},
    "@/lib/edupi-material-metadata": { readMaterialMetadataHistory: unexpected },
    "@/lib/edupi-runtime-supervisor": { ensureEduPiRuntime: unexpected },
    ...overrides,
  };
  const result = { exports: {} };
  new Function("require", "module", "exports", compiled.get(route))(name => {
    if (name.startsWith("node:")) return require(name);
    assert.ok(Object.hasOwn(modules, name), `unexpected dependency: ${name}`);
    return modules[name];
  }, result, result.exports);
  return { ...result.exports, injections: () => injections };
}

const hash = `sha256:${"a".repeat(64)}`;
const restoreContext = {
  targetId: "context-1", versionId: "version-1", versionSide: "before", fieldKey: "grade",
  expectedSnapshotId: "snapshot-1", expectedRevision: 2, expectedSourceId: "source-2",
};
const endpoints = [
  ["reminders", "GET", null, { error: "提醒暂不可用" }],
  ["reminders", "POST", { id: "reminder-1", type: "read" }, { error: "提醒保存失败" }],
  ["material-excerpt", "GET", null, { error: "正文读取或保存未确认，请重试" }],
  ["material-excerpt", "POST", { materialId: "material-1", expectedRevision: 0, content: "合成正文", decision: "confirm" }, { error: "正文读取或保存未确认，请重试" }],
  ["material-excerpt/source", "GET", null, { error: "原文读取或确认未完成，请重试" }],
  ["material-excerpt/source", "POST", { materialId: "material-1", expectedRevision: 0, expectedBasisHash: hash, sourceSpans: [{ path: "synthetic", start: 0, end: 1 }] }, { error: "原文读取或确认未完成，请重试" }],
  ["teaching-priorities", "POST", { subject: "数学", className: "703", topic: "移项", note: null }, { code: "unavailable", error: "教学重点暂不可用" }],
  ["teaching-priorities", "PUT", { priorityId: "priority-1", expectedRevision: 2, patch: { note: "合成说明" } }, { code: "unavailable", error: "教学重点修改暂不可用" }],
  ["teaching-priorities/[priorityId]/versions", "GET", null, { code: "unavailable", error: "教学重点历史暂不可用" }],
  ["teaching-priorities/[priorityId]/versions", "POST", { versionId: "version-1", versionSide: "before", expectedRevision: 2 }, { code: "unavailable", error: "教学重点恢复暂不可用" }],
  ["onboarding", "GET", null, { error: "教育上下文暂不可用", reason: "Core v1.1 education_workspace 快照不可用。" }],
  ["onboarding", "POST", { name: "合成老师" }, { error: "保存未确认，请刷新查看待确认更新后重试" }],
  ["onboarding", "PUT", { targetId: "context-1", expectedSnapshotId: "snapshot-1", expectedRevision: 0, decision: "hold", patch: null, reviewerId: "teacher" }, { error: "unavailable", code: "unavailable", reason: "教师上下文审核暂不可用。" }],
  ["onboarding/versions", "GET", null, { error: "教师资料版本暂不可用", code: "unavailable" }],
  ["onboarding/versions", "POST", restoreContext, { error: "教师资料恢复暂不可用", code: "unavailable" }],
  ["material-schedule", "GET", null, { ok: false, errorCode: "material_schedule_unavailable", externalSend: false }],
  ["material-schedule", "POST", { action: "bootstrap_owner", materialId: "material-1", confirm: true }, { ok: false, errorCode: "material_schedule_unavailable", externalSend: false }],
  ["preparation", "GET", null, { state: "error", error: "备课状态暂不可用" }],
  ["preparation", "POST", { action: "run", taskId: "task-1" }, { state: "error", error: "合成本地错误" }],
  ["preparation", "POST", { action: "ensure" }, { state: "error", error: "合成本地错误" }],
  ["tasks/[taskId]/session", "GET", null, { error: "事项会话暂不可用" }],
  ["tasks/[taskId]/session", "PUT", { sessionId: "session-1" }, { error: "合成本地错误" }, 400],
  ["facts/[factId]", "POST", { action: "delete", expectedRevision: 0 }, { error: "云端事实操作暂不可用", code: "unavailable" }],
];
function invoke(route, method, body, handler) {
  const request = new Request(`http://localhost:30141/api/edupi/${route.replace("[priorityId]", "priority-1").replace("[taskId]", "task-1").replace("[factId]", "fact-1")}?materialId=material-1`, {
    method, headers: { host: "localhost:30141", origin: "http://localhost:30141",
      "content-type": "application/json", "x-pi-desktop-token": token },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return handler(request, { params: Promise.resolve({ priorityId: "priority-1", taskId: "task-1", factId: "fact-1" }) });
}
function cloudBody(route, method, error) {
  if (route === "material-schedule") return { ok: false, errorCode: error.code, externalSend: false };
  if (route === "onboarding" && method === "GET") return { error: "教育上下文暂不可用", reason: error.message, code: error.code };
  if (route === "onboarding" && method === "PUT") return { error: error.code, code: error.code, reason: error.message };
  if (route === "preparation") return { state: "error", error: error.message, code: error.code };
  if (route.startsWith("facts/") && error.status === 409) return { error: "事实已更新，请刷新后重试", code: error.code };
  return { error: error.message, code: error.code };
}
async function assertCloud(response, route, method, error) {
  assert.equal(response.status, error.status);
  assert.deepEqual(await response.json(), cloudBody(route, method, error));
}

for (const [route, method, body, localBody, localStatus = 503] of endpoints) {
  const label = `${method} ${route}${route === "preparation" ? ` ${body?.action || "status"}` : ""}`;
  test(`${label} preserves typed cloud statuses and its response fields`, async () => {
    for (const [code, status] of [
      ["login_required", 401], ["permission_denied", 403], ["stale_revision", 409],
      ["rate_limited", 429], ["invalid_response", 502],
    ]) {
      const error = new EduPiCloudError(code, `合成云错误 ${code}`, status);
      const handlers = load(route, error);
      await assertCloud(await invoke(route, method, body, handlers[method]), route, method, error);
      assert.ok(handlers.injections() > 0, "the route must reach the injected cloud error");
    }
  });
  test(`${label} retains ordinary local error mapping`, async () => {
    const error = Object.assign(new Error("合成本地错误"), { status: 401 });
    const handlers = load(route, error);
    const response = await invoke(route, method, body, handlers[method]);
    assert.equal(response.status, localStatus);
    assert.deepEqual(await response.json(), localBody);
    assert.ok(handlers.injections() > 0, "the route must reach the injected local error");
  });
}

test("teaching priority restore preserves a cloud error from the reconciliation read", async () => {
  const route = "teaching-priorities/[priorityId]/versions";
  const error = new EduPiCloudError("login_required", "合成重新登录提示", 401);
  const values = { subject: "数学", className: "703", topic: "移项", note: null, status: "active" };
  const history = { priorityId: "priority-1", revision: 2, historyCount: 1, versions: [
    { versionId: "version-1", revision: 2, beforeValues: { ...values, topic: "等式" }, afterValues: values },
  ] };
  let reads = 0;
  const handlers = load(route, error, {
    "@/lib/edupi-education-server": { readEducationContract: async () => {
      if (++reads > 1) throw error;
      return { continuity: { teachingPriorities: [{ id: "priority-1", revision: 2, historyCount: 1, ...values }] } };
    } },
    "@/lib/edupi-teaching-priorities": { ...real["@/lib/edupi-teaching-priorities"],
      readTeachingPriorityHistory: async () => history,
      restoreTeachingPriorityVersion: async () => { throw new Error("合成本地恢复失败"); } },
  });
  const response = await invoke(route, "POST", endpoints.find(item => item[0] === route && item[1] === "POST")[2], handlers.POST);
  await assertCloud(response, route, "POST", error);
  assert.equal(reads, 2, "the test must reach the reconciliation read");
});

test("teacher context restore preserves a cloud error without replacing it with replay availability", async () => {
  const error = new EduPiCloudError("permission_denied", "合成权限提示", 403);
  const versions = real["@/lib/edupi-teacher-context-versions"];
  const requestId = versions.teacherContextRestoreRequestId(restoreContext);
  let reads = 0, captures = 0, reviews = 0;
  const handlers = load("onboarding/versions", error, {
    "@/lib/edupi-teacher-context-versions": { ...versions,
      readTeacherContextVersions: async () => [{ versionId: "version-1", contextId: "context-1",
        revision: 1, beforeValues: { grade: "七年级" }, afterValues: { grade: "八年级" } }],
      captureTeacherContextFieldRestore: async () => { captures++; return { requestId, contextId: "context-1", alreadyApplied: false }; },
    },
    "@/lib/edupi-education-server": {
      readEducationContract: async () => ({ teacherContextCandidates: [{
        contextId: "context-1", revision: 2, snapshotId: "snapshot-1",
        sourceIds: [++reads === 1 ? "source-2" : `desktop-version:${requestId}`],
        currentValues: { grade: "八年级" }, proposedValues: { grade: "七年级" },
      }] }),
      reviewTeacherContextCandidate: async () => { reviews++; throw error; },
    },
  });
  await assertCloud(await invoke("onboarding/versions", "POST", restoreContext, handlers.POST), "onboarding/versions", "POST", error);
  assert.equal(reviews, 1);
  assert.equal(captures, 1, "a typed cloud rejection must not enter local replay recovery");
});

test("reminder claims preserve the final cloud error and release unsent notifications", async () => {
  const error = new EduPiCloudError("rate_limited", "合成稍后重试提示", 429);
  const item = { id: "reminder-1", notificationAttemptedAt: "2026-11-23T00:00:00.000Z" };
  const state = { items: [item], notifications: [item], metrics: {} };
  const data = { workspace: "/synthetic-edupi", continuity: { documents: [] } };
  let reads = 0;
  const handlers = load("reminders", error, {
    "@/lib/edupi-education-server": { readEducationWorkspaceBundle: async () => {
      if (++reads === 3) throw error;
      return { data };
    } },
    "@/lib/edupi-reminder-events": { reminderEvents: () => [] },
    "@/lib/edupi-reminder-store": {
      updateReminderStore: async (_file, _events, action) => {
        if (action?.type === "release_notification") delete item.notificationAttemptedAt;
        return state;
      },
      pendingReminderAttentionOutcomes: () => [],
    },
    "@/lib/edupi-attention-delivery": { syncReminderAttention: async () => ({ status: "synced", recorded: 0 }) },
    "@/lib/edupi-attention-outbox": {
      reconcileReminderAttentionOutboxWithin: async () => ({ status: "synced", recorded: 0, pendingIds: [] }),
      nativeAttentionRoute: () => "legacy_local",
      persistNativeAttentionRouteMarks: async () => ({ acceptedIds: [item.id], deferredIds: [], state }),
    },
  });
  const previous = process.env.PI_DESKTOP_INSTANCE_ID;
  process.env.PI_DESKTOP_INSTANCE_ID = "a".repeat(64);
  try {
    await assertCloud(await invoke("reminders", "POST", { id: "*", type: "claim_notifications" }, handlers.POST), "reminders", "POST", error);
    assert.equal(reads, 3, "the test must reach the final workspace read");
    assert.equal(item.notificationAttemptedAt, undefined, "a failed cloud recheck must still release the unsent claim");
  } finally {
    if (previous === undefined) delete process.env.PI_DESKTOP_INSTANCE_ID;
    else process.env.PI_DESKTOP_INSTANCE_ID = previous;
  }
});
