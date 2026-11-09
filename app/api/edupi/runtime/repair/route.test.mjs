import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);

test("Core repair is desktop-token protected, bounded, and health checked", async () => {
  const [route, client, native] = await Promise.all([
    readFile(new URL("./route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../../../lib/edupi-runtime-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../../../lib/desktop-native.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /isDesktopApiRequestAllowed\(request\)/);
  assert.doesNotMatch(route, /isApiRequestAllowed\(request\)/);
  assert.match(route, /await repairEduPiRuntimeState/);
  assert.match(route, /repaired\.repaired \? await restartEduPiRuntime\(roots\) : await ensureEduPiRuntime\(roots\)/);
  assert.match(route, /host\.call\("health", null\)/);
  assert.doesNotMatch(route, /error instanceof Error \? error\.message|String\(error\)/);
  assert.match(client, /fetchDesktopApi\("\/api\/edupi\/runtime\/repair"/);
  assert.match(native, /headers\.set\(DESKTOP_API_TOKEN_HEADER/);
  assert.match(native, /\^\\\/api\\\//);
});

test("Core repair route rejects blocked v4 before writing or starting Core and preserves v1 repair", async () => {
  const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
  const roots = { dataRoot: { root: "/private/test-root" }, runtime: { coreCommit: "test-commit" } };
  const calls = [];
  let authorized = true;
  let inspection = { status: "blocked", reason: "/private/test-root/secret.sqlite" };
  let repairResult = { ...inspection, repaired: false, files: [], backups: [] };
  let repairError = null;
  const modules = {
    "next/server": { NextResponse: { json: (body, options) => Response.json(body, options) } },
    "@/lib/desktop-api-auth": { isDesktopApiRequestAllowed: () => authorized },
    "@/lib/edupi-bridge-manifest": { activeBridgeIdentity: () => { calls.push("identity"); return { runtime: { runtime_component_manifest_hash: "test-hash" } }; } },
    "@/lib/edupi-core-snapshot": { resolveEduPiBridgeRoots: () => roots },
    "@/lib/edupi-runtime-recovery": {
      coreRuntimeFingerprint: async () => "sha256:test",
      inspectEduPiRuntimeRecovery: () => inspection,
      repairEduPiRuntimeState: async () => { calls.push("repair"); if (repairError) throw repairError; return repairResult; },
    },
    "@/lib/edupi-runtime-supervisor": {
      describeEduPiRuntimeStartupFailure: () => null,
      ensureEduPiRuntime: async () => { calls.push("ensure"); return { call: async () => ({}) }; },
      restartEduPiRuntime: async () => { calls.push("restart"); return { call: async () => ({}) }; },
      g1ScopeForActivation: () => null,
    },
    "@/lib/edupi-runtime-health": { projectCoreRuntimeHealth: () => ({ status: "ready" }) },
    "@/lib/edupi-proactivity-config": { readEduPiProactivityActivation: () => ({}) },
  };
  const routeModule = { exports: {} };
  new Function("require", "module", "exports", ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)((name) => modules[name] || require(name), routeModule, routeModule.exports);
  const post = () => routeModule.exports.POST(new Request("http://localhost/api/edupi/runtime/repair", { method: "POST" }));
  const get = () => routeModule.exports.GET(new Request("http://localhost/api/edupi/runtime/repair"));

  authorized = false;
  assert.equal((await get()).status, 403);
  const denied = await post();
  assert.equal(denied.status, 403);
  assert.deepEqual(calls, []);

  authorized = true;
  const blockedInspection = await get();
  assert.equal(blockedInspection.status, 200);
  assert.deepEqual(await blockedInspection.json(), { ok: true, status: "blocked" });
  assert.deepEqual(calls, []);
  const blocked = await post();
  assert.equal(blocked.status, 409);
  const blockedBody = await blocked.json();
  assert.equal(blockedBody.code, "runtime_repair_blocked");
  assert.deepEqual(blockedBody.before, { status: "blocked" });
  assert.doesNotMatch(JSON.stringify(blockedBody), /secret\.sqlite|private\/test-root/);
  assert.deepEqual(calls, []);

  inspection = { status: "clean", reason: null };
  repairResult = { ...inspection, repaired: false, files: [], backups: [] };
  const clean = await post();
  assert.equal(clean.status, 200);
  assert.deepEqual(calls.splice(0), ["repair", "identity", "ensure"]);

  inspection = { status: "stale", reason: null };
  assert.deepEqual(await (await get()).json(), { ok: true, status: "stale" });
  repairResult = { ...inspection, repaired: true, files: [], backups: [] };
  const repaired = await post();
  assert.equal(repaired.status, 200);
  assert.deepEqual(calls.splice(0), ["repair", "identity", "restart"]);

  inspection = { status: "clean", reason: null };
  repairError = new Error("/private/test-root/secret.sqlite");
  const failed = await post();
  assert.equal(failed.status, 503);
  assert.equal((await failed.json()).code, "runtime_repair_failed");
  assert.deepEqual(calls.splice(0), ["repair"]);
});
