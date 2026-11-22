import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { captureEducationWriteScope, cloudScopeKey, stateScopeKey } = await createJiti(import.meta.url).import("./edupi-cloud-request-scope.ts");
const scope = { issuer: "https://cloud.example.invalid", accountId: "teacher-a", workspaceId: "workspace-a", generation: 4 };
const state = { mode: "cloud", issuer: scope.issuer, session: { user: { id: scope.accountId } }, workspaceId: scope.workspaceId, generation: 4 };
const request = key => new Request("http://localhost/api/edupi/tasks", { headers: key ? { "x-edupi-cloud-scope": key } : {} });

test("cloud writes require the exact displayed account, workspace and generation", async () => {
  let captured = 0;
  const client = { state: async () => state, captureScope: async () => { captured++; return scope; } };
  for (const key of [null, "local", cloudScopeKey({ ...scope, workspaceId: "workspace-b" }),
    cloudScopeKey({ ...scope, accountId: "teacher-b" }), cloudScopeKey({ ...scope, generation: 3 })]) {
    await assert.rejects(captureEducationWriteScope(request(key), client), { code: "scope_changed" });
  }
  assert.equal(captured, 0);
  assert.deepEqual(await captureEducationWriteScope(request(cloudScopeKey(scope)), client), { mode: "cloud", scope });
});

test("a cloud request cannot fall back to local after logout or a mode switch", async () => {
  const local = { ...state, mode: "local", generation: 5 };
  const client = { state: async () => local };
  await assert.rejects(captureEducationWriteScope(request(cloudScopeKey(scope)), client), { code: "scope_changed" });
  assert.deepEqual(await captureEducationWriteScope(request(null), client), { mode: "local" });
  assert.deepEqual(await captureEducationWriteScope(request("local"), client), { mode: "local" });
  assert.deepEqual(await captureEducationWriteScope(request(stateScopeKey(local)), client), { mode: "local" });
});

test("a workspace change during scope capture is rejected too", async () => {
  const client = { state: async () => state, captureScope: async () => ({ ...scope, generation: 5 }) };
  await assert.rejects(captureEducationWriteScope(request(cloudScopeKey(scope)), client), { code: "scope_changed" });
});
