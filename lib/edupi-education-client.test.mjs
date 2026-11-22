import assert from "node:assert/strict";
import test from "node:test";
import { educationWriteHeaders, preserveUnavailableWorkspaceResources, readEduPiEducation, readEduPiWorkspace, resetEduPiEducationRequestForTest } from "./edupi-education-client.ts";
import { announceEduPiCloudStatus } from "./edupi-cloud-events.ts";

const cloudStatus = (workspaceId, overrides = {}) => ({
  mode: "cloud",
  generation: 1,
  configured: true,
  session: { state: "signed_in", user: { id: "account-1", email: null }, expiresAt: "2030-01-01T00:00:00.000Z" },
  workspaceId,
  sync: { pending: 0, conflict: 0, failed: 0 },
  error: null,
  ...overrides,
});
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function cloudWindow(t) {
  const previous = globalThis.window;
  globalThis.window = new EventTarget();
  t.after(() => {
    resetEduPiEducationRequestForTest();
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  });
  return globalThis.window;
}

test("preserves last-known resource rows while a committed refresh reports resources unavailable", () => {
  const previous = { students: [{ student_id: "student-1", class_name: "703" }], studentNameCounts: { 李四: 1 }, teacherMaterials: [{ material_id: "material-old" }], generatedArtifacts: [{ artifact_id: "artifact-old" }] };
  const next = { students: [{ student_id: "student-1", class_name: null }], studentNameCounts: {}, teacherMaterials: [], generatedArtifacts: [], workspaceResourcesUnavailable: true, generatedArtifactsUnavailable: true };
  const preserved = preserveUnavailableWorkspaceResources(previous, next);
  assert.equal(preserved.students[0].class_name, "703");
  assert.deepEqual(preserved.teacherMaterials, previous.teacherMaterials);
  assert.deepEqual(preserved.generatedArtifacts, previous.generatedArtifacts);
  assert.equal(preserved.workspaceResourcesUnavailable, true);
  assert.deepEqual(preserveUnavailableWorkspaceResources(previous, next, { removedMaterialId: "material-old" }).teacherMaterials, []);
  const available = { ...next, workspaceResourcesUnavailable: false };
  assert.equal(preserveUnavailableWorkspaceResources(previous, available), available);
});

test("concurrent education readers share one in-flight request and release it after completion", async () => {
  resetEduPiEducationRequestForTest();
  let calls = 0;
  let finish;
  const fetcher = async (url) => {
    calls += 1;
    assert.equal(url, "/api/edupi/workspace");
    await new Promise((resolve) => { finish = resolve; });
    return { ok: true, json: async () => ({ context: { name: "吴老师" }, data: { workspace: "/tmp/edupi", tasks: [] } }) };
  };

  const first = readEduPiWorkspace({ fetcher });
  const second = readEduPiEducation({ fetcher });
  assert.equal(calls, 1);
  finish();
  assert.deepEqual(await first, { context: { name: "吴老师" }, data: { workspace: "/tmp/edupi", tasks: [] } });
  assert.deepEqual(await second, { workspace: "/tmp/edupi", tasks: [] });

  const third = readEduPiEducation({ fetcher: async () => {
    calls += 1;
    return { ok: true, json: async () => ({ context: { name: "吴老师" }, data: { workspace: "/tmp/edupi", tasks: ["next"] } }) };
  } });
  assert.deepEqual(await third, { workspace: "/tmp/edupi", tasks: ["next"] });
  assert.equal(calls, 2);
});

test("one aborted reader does not cancel the shared education request", async () => {
  resetEduPiEducationRequestForTest();
  const controller = new AbortController();
  let finish;
  const fetcher = async () => {
    await new Promise((resolve) => { finish = resolve; });
    return { ok: true, json: async () => ({ context: { name: "吴老师" }, data: { workspace: "/tmp/edupi", tasks: [] } }) };
  };
  const aborted = readEduPiEducation({ fetcher, signal: controller.signal });
  const active = readEduPiEducation({ fetcher });
  controller.abort();
  finish();
  await assert.rejects(aborted, (error) => error?.name === "AbortError");
  assert.equal((await active).workspace, "/tmp/edupi");
});

test("a failed network read reports a usable error and permits a fresh retry", async () => {
  resetEduPiEducationRequestForTest();
  await assert.rejects(readEduPiWorkspace({ fetcher: async () => { throw new TypeError("Failed to fetch"); } }), /教育工作区暂不可用，请重试/);
  const bundle = { context: { name: "合成教师" }, data: { tasks: ["preserved"] } };
  assert.deepEqual(await readEduPiWorkspace({ fetcher: async () => ({ ok: true, json: async () => bundle }) }), bundle);
});

test("workspace scope changes reject old responses and start a fresh request even when task IDs match", async t => {
  resetEduPiEducationRequestForTest();
  cloudWindow(t);
  announceEduPiCloudStatus(cloudStatus("workspace-a"));
  const oldResponse = deferred(), nextResponse = deferred();
  const calls = [];
  const fetcher = async (_url, init) => {
    calls.push(init);
    return calls.length === 1 ? oldResponse.promise : nextResponse.promise;
  };
  const oldRead = readEduPiWorkspace({ fetcher }).then(value => value, error => error);
  announceEduPiCloudStatus(cloudStatus("workspace-b", { generation: 2 }));
  const nextRead = readEduPiWorkspace({ fetcher });
  oldResponse.resolve({ ok: true, json: async () => ({ context: { name: "A" }, data: { workspace: "workspace-a", tasks: [{ id: "same-task" }] } }) });
  nextResponse.resolve({ ok: true, json: async () => ({ context: { name: "B" }, data: { workspace: "workspace-b", tasks: [{ id: "same-task" }] } }) });
  assert.equal((await nextRead).data.workspace, "workspace-b");
  assert.equal((await oldRead).name, "AbortError");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].signal.aborted, true);
});

test("same-scope polls and omitted generation preserve the in-flight request", async t => {
  resetEduPiEducationRequestForTest();
  const window = cloudWindow(t);
  let changes = 0;
  window.addEventListener("edupi-education-scope-changed", () => { changes++; });
  announceEduPiCloudStatus(cloudStatus("workspace-a", { generation: 9 }));
  const response = deferred();
  let calls = 0;
  const fetcher = async () => { calls++; return response.promise; };
  const first = readEduPiWorkspace({ fetcher });
  announceEduPiCloudStatus(cloudStatus("workspace-a", { generation: 9, sync: { pending: 2, conflict: 0, failed: 0 } }));
  announceEduPiCloudStatus(cloudStatus("workspace-a", { generation: undefined }));
  const second = readEduPiWorkspace({ fetcher });
  response.resolve({ ok: true, json: async () => ({ context: {}, data: { workspace: "workspace-a", tasks: [] } }) });
  assert.equal((await first).data.workspace, "workspace-a");
  assert.equal((await second).data.workspace, "workspace-a");
  assert.equal(calls, 1);
  assert.equal(changes, 1);
});

test("mode, account, workspace and a known generation each invalidate shared workspace reads", async t => {
  resetEduPiEducationRequestForTest();
  cloudWindow(t);
  const changes = [
    cloudStatus("workspace-a", { mode: "local" }),
    cloudStatus("workspace-a"),
    cloudStatus("workspace-a", { session: { ...cloudStatus().session, user: { id: "account-2", email: null } } }),
    cloudStatus("workspace-b", { session: { ...cloudStatus().session, user: { id: "account-2", email: null } } }),
    cloudStatus("workspace-b", { generation: 2, session: { ...cloudStatus().session, user: { id: "account-2", email: null } } }),
  ];
  for (const status of changes) {
    const pending = deferred();
    const previous = readEduPiWorkspace({ fetcher: async () => pending.promise }).then(value => value, error => error);
    announceEduPiCloudStatus(status);
    pending.resolve({ ok: true, json: async () => ({ context: {}, data: { tasks: [] } }) });
    assert.equal((await previous).name, "AbortError");
  }
});

test("write headers capture the read bundle scope and cannot acquire a new scope from a status event", async t => {
  resetEduPiEducationRequestForTest();
  cloudWindow(t);
  assert.equal(educationWriteHeaders().get("x-edupi-cloud-scope"), "local");
  announceEduPiCloudStatus(cloudStatus("workspace-a"));
  assert.throws(() => educationWriteHeaders(), error => error.name === "AbortError");
  await readEduPiWorkspace({ fetcher: async () => ({
    ok: true, json: async () => ({ context: {}, data: { workspace: "workspace-a", cloudScope: "opaque-scope-a", tasks: [] } }),
  }) });
  const captured = educationWriteHeaders({ "Content-Type": "application/json" });
  assert.equal(captured.get("x-edupi-cloud-scope"), "opaque-scope-a");
  assert.equal(captured.get("content-type"), "application/json");
  announceEduPiCloudStatus(cloudStatus("workspace-b", { generation: 2 }));
  assert.throws(() => educationWriteHeaders(), error => error.name === "AbortError");
  assert.equal(educationWriteHeaders(undefined, "opaque-scope-a").get("x-edupi-cloud-scope"), "opaque-scope-a");
  await readEduPiWorkspace({ fetcher: async () => ({
    ok: true, json: async () => ({ context: {}, data: { workspace: "workspace-b", cloudScope: "opaque-scope-b", tasks: [] } }),
  }) });
  assert.equal(educationWriteHeaders().get("x-edupi-cloud-scope"), "opaque-scope-b");
  assert.equal(captured.get("x-edupi-cloud-scope"), "opaque-scope-a");
});

test("local write scopes are recorded only when a bundle is read, and cloud bundles without scope fail closed", async t => {
  resetEduPiEducationRequestForTest();
  cloudWindow(t);
  const read = () => readEduPiWorkspace({ fetcher: async () => ({ ok: true, json: async () => ({ context: {}, data: { tasks: [] } }) }) });
  await read();
  const captured = educationWriteHeaders();
  assert.equal(captured.get("x-edupi-cloud-scope"), "local");
  announceEduPiCloudStatus({ ...cloudStatus(null), mode: "local", generation: 7, session: { state: "signed_out", user: null, expiresAt: null } });
  assert.equal(captured.get("x-edupi-cloud-scope"), "local", "status must not rewrite a previously captured scope");
  assert.throws(() => educationWriteHeaders(), error => error.name === "AbortError");
  await read();
  assert.equal(educationWriteHeaders().get("x-edupi-cloud-scope"), '["local",7]');
  announceEduPiCloudStatus(cloudStatus("workspace-a", { generation: 8 }));
  await read();
  assert.throws(() => educationWriteHeaders(), error => error.name === "AbortError");
});

test("workspace failures show a bounded route-owned explanation instead of only HTTP 502", async () => {
  resetEduPiEducationRequestForTest();
  const message = "云端接口版本与当前客户端不匹配，请更新后重试。";
  await assert.rejects(readEduPiWorkspace({ fetcher: async () => ({
    ok: false, status: 502, json: async () => ({ error: message, code: "unsupported_contract" }),
  }) }), error => error.message === message);
  for (const error of ["x".repeat(241), { message }, "", "unsafe\nmessage"]) {
    await assert.rejects(readEduPiWorkspace({ fetcher: async () => ({
      ok: false, status: 502, json: async () => ({ error }),
    }) }), /教育工作区读取失败（HTTP 502）/u);
  }
});
