import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createJiti } from "jiti";
const { readCloudDeletedFactPage } = await createJiti(import.meta.url).import("./edupi-cloud-fact.ts");
const scope = { issuer: "https://cloud.example.invalid", accountId: "account-a", workspaceId: "workspace-a", generation: 4 };
const deleted = { fact_id: "deleted-cloud", entity_id: "student-a", fact_kind: "academic", predicate: "掌握", value: "隔离事实",
  subject_ref: null, topic_ref: null, source_ids: [], source_count: 0, observation_ids: [], observation_count: 0,
  restore_conflicts: [], restore_conflict_count: 0, restore_mode: "direct", status: "deleted",
  deleted_previous_status: "accepted", revision: 2, deleted_at: "2026-11-22T00:00:00+00:00", external_send: false };
const page = { ok: true, operation: "education-facts", action: "list_deleted", total: 1, offset: 0, limit: 100,
  next_offset: null, facts: [deleted], external_send: false };

test("cloud trash keeps workspace scope and returns the Desktop fact recovery model", async () => {
  const calls = [];
  const client = { operation: async (...args) => { calls.push(args); return page; } };
  const result = await readCloudDeletedFactPage(client, scope, 0, 100);
  assert.equal(result.facts[0].factId, "deleted-cloud");
  assert.equal(result.facts[0].deletedAt, "2026-11-22T00:00:00.000Z");
  assert.equal(result.facts[0].restoreMode, "direct");
  assert.deepEqual(calls, [["education-facts", { action: "list_deleted", offset: 0, limit: 100 }, scope]]);
});

test("cloud trash route never calls the local Core trash reader", async () => {
  const exports = {};
  const client = { state: async () => ({ mode: "cloud" }), captureScope: async () => scope,
    operation: async () => page };
  const modules = {
    "next/server": { NextResponse: Response },
    "@/lib/edupi-fact-lifecycle": { FactLifecycleError: class extends Error {}, readDeletedEducationFacts: () => { throw new Error("local Core called"); } },
    "@/lib/edupi-fact-lifecycle-request": { parseDeletedFactPage: () => ({ offset: 0, limit: 100 }) },
    "@/lib/request-security": { isApiRequestAllowed: () => true },
    "@/lib/edupi-cloud-client": { createEduPiCloudClient: () => client, EduPiCloudError: class extends Error {} },
    "@/lib/edupi-cloud-fact": { readCloudDeletedFactPage },
  };
  const code = ts.transpileModule(fs.readFileSync(new URL("../app/api/edupi/facts/deleted/route.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require: name => { assert.ok(modules[name], name); return modules[name]; } });
  const response = await exports.GET(new Request("http://localhost/api/edupi/facts/deleted"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).facts[0].factId, "deleted-cloud");
});
