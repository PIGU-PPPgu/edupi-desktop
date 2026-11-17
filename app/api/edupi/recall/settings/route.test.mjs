import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, fsCache: false });
const server = await jiti.import("../../../../../../lib/edupi-recall-settings-server.ts");
const auth = await jiti.import("../../../../../../lib/desktop-api-auth.ts");
const bounded = await jiti.import("../../../../../../lib/bounded-form-data.ts");
const output = ts.transpileModule(fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const token = "synthetic-process-token-".repeat(3);
const enable = { enabled: true, expectedUpdatedAt: null, scope: { classId: "synthetic-class", subject: "数学" },
  model: { provider: "synthetic-provider", modelId: "synthetic-model" }, limit: 2, validUntil: "2026-11-19T00:00:00.000Z" };

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync("/tmp/edupi-r04-settings-route-"));
  fs.chmodSync(root, 0o700);
  const options = { dataRoot: path.join(root, "data"), stateDir: path.join(root, "state"),
    now: "2026-11-18T00:00:00.000Z", env: {} };
  for (const dir of [options.dataRoot, options.stateDir]) fs.mkdirSync(dir, { mode: 0o700 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let coreCalls = 0;
  const unavailable = async () => { coreCalls++; throw new Error("synthetic_Core_unavailable"); };
  const modules = {
    "@/lib/bounded-form-data": bounded,
    "@/lib/desktop-api-auth": { isDesktopApiRequestAllowed: request => auth.isDesktopApiRequestAllowed(request, token) },
    "@/lib/edupi-recall-settings-server": {
      ...server, createEduPiRecallSettingsService(...args) {
        assert.deepEqual(args, [], "the production handler must not inject approveNormal");
        return server.createEduPiRecallSettingsService({ options: () => options,
          runtime: unavailable, restartRoot: unavailable, preflightModel: unavailable });
      },
    },
  };
  const evaluated = { exports: {} };
  new Function("require", "module", "exports", output)(name => {
    assert.ok(Object.hasOwn(modules, name), `unexpected route dependency ${name}`); return modules[name];
  }, evaluated, evaluated.exports);
  const request = (body, change = {}) => new Request("http://localhost/api/edupi/recall/settings", {
    method: body === undefined ? "GET" : "POST",
    headers: { host: "localhost", "x-pi-desktop-token": token, "content-type": "application/json", ...change },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
  return { route: evaluated.exports, options, request, coreCalls: () => coreCalls };
}

test("GET and all errors are JSON no-store and require native token, loopback and allowed origin", async t => {
  const f = fixture(t);
  for (const headers of [
    { "x-pi-desktop-token": "" }, { "x-pi-desktop-token": "wrong" }, { host: "192.168.0.5" },
    { origin: "https://foreign.invalid" },
  ]) {
    const response = await f.route.GET(f.request(undefined, headers));
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("content-type"), /application\/json/u);
  }
  const response = await f.route.GET(f.request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.version, 1);
  assert.equal(body.normalApproved, false);
  assert.equal(body.activation.enabled, false);
  assert.equal(body.config.updatedAt, null);
  assert.deepEqual(fs.readdirSync(f.options.stateDir), []);
  assert.equal(f.coreCalls(), 0);
});

test("actual handler never injects approval; gate false rejects explicit enable without writes or preflight", async t => {
  const f = fixture(t);
  const response = await f.route.POST(f.request(enable));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).reasonCode, "recall_normal_not_approved");
  assert.equal(f.coreCalls(), 0);
  assert.deepEqual(fs.readdirSync(f.options.stateDir), []);
  const clientApproved = await f.route.POST(f.request({ ...enable, normalApproved: true }));
  assert.equal(clientApproved.status, 400);
});

test("POST stop persists before unavailable Core, reports unknown, and exact CAS rejects stale/null revisions", async t => {
  const f = fixture(t);
  const response = await f.route.POST(f.request({ enabled: false, expectedUpdatedAt: null }));
  assert.equal(response.status, 200);
  const stopped = await response.json();
  assert.equal(stopped.config.enabled, false);
  assert.equal(stopped.stop.status, "unknown");
  const reread = await (await f.route.GET(f.request())).json();
  assert.equal(reread.config.updatedAt, stopped.config.updatedAt);
  const conflict = await f.route.POST(f.request({ enabled: false, expectedUpdatedAt: null }));
  assert.equal(conflict.status, 409);
  const next = await f.route.POST(f.request({ enabled: false, expectedUpdatedAt: stopped.config.updatedAt }));
  assert.equal(next.status, 200);
  assert.notEqual((await next.json()).config.updatedAt, stopped.config.updatedAt);
});

test("POST enforces JSON, bounded bytes and strict malformed bodies before service mutations", async t => {
  const f = fixture(t);
  assert.equal((await f.route.POST(f.request(enable, { "content-type": "text/plain" }))).status, 415);
  assert.equal((await f.route.POST(f.request("{"))).status, 400);
  assert.equal((await f.route.POST(f.request({ enabled: false }))).status, 400);
  assert.equal((await f.route.POST(f.request("x".repeat(4097)))).status, 413);
  assert.equal((await f.route.POST(f.request(enable, { "content-length": "4097" }))).status, 413);
  assert.equal(f.coreCalls(), 0);
  assert.deepEqual(fs.readdirSync(f.options.stateDir), []);
});
