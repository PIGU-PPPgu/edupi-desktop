import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, fsCache: false });
const prompts = await jiti.import("../../../../../../lib/edupi-recall-prompt-server.ts");
const settings = await jiti.import("../../../../../../lib/edupi-recall-settings-server.ts");
const auth = await jiti.import("../../../../../../lib/desktop-api-auth.ts");
const bounded = await jiti.import("../../../../../../lib/bounded-form-data.ts");
const output = ts.transpileModule(fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const token = "synthetic-r04-process-token-".repeat(3);
const input = { sessionId: "synthetic-session", clientRequestId: "synthetic-request",
  message: " 合成问题\n", occurredAt: "2026-11-18T00:00:00.000Z" };
function fixture(status) {
  const submits = [];
  const modules = {
    "@/lib/bounded-form-data": bounded,
    "@/lib/desktop-api-auth": { isDesktopApiRequestAllowed: request => auth.isDesktopApiRequestAllowed(request, token) },
    "@/lib/edupi-recall-prompt-server": { createEduPiRecallPromptService(...args) {
      assert.deepEqual(args, [], "production handler never injects approveNormal");
      return status ? { submit: async body => { submits.push(body);
        return { version: 1, status, reasonCode: null, externalSend: false }; } }
        : prompts.createEduPiRecallPromptService({
          options() { assert.fail("default gate must reject before root/profile discovery"); },
          runtime() { assert.fail("default gate must reject before Core"); },
        });
    } },
    "@/lib/edupi-recall-settings-server": settings,
  };
  const evaluated = { exports: {} };
  new Function("require", "module", "exports", output)(name => {
    assert.ok(Object.hasOwn(modules, name), `unexpected route dependency ${name}`); return modules[name];
  }, evaluated, evaluated.exports);
  const request = (body = input, headers = {}) => new Request("http://localhost/api/edupi/recall/prompts", {
    method: "POST", headers: { host: "localhost", "x-pi-desktop-token": token, "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { route: evaluated.exports, request, submits };
}
test("the production prompt handler is closed by source even with valid explicit intent and process auth", async () => {
  const f = fixture();
  const response = await f.route.POST(f.request());
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { version: 1, status: "held", reasonCode: "recall_normal_not_approved", externalSend: false });
  assert.equal(response.headers.get("cache-control"), "no-store");
});
test("client authority fields and a command envelope are rejected by actual server validation", async () => {
  const f = fixture();
  for (const field of ["ownerId", "grantId", "budgetId", "model", "approveNormal", "rawQuery", "command"]) {
    const response = await f.route.POST(f.request({ ...input, [field]: "client" }));
    assert.equal(response.status, 400);
  }
  assert.equal((await f.route.POST(f.request({ ...input, message: "\ud800" }))).status, 400);
  assert.equal((await f.route.POST(f.request("{"))).status, 400);
});
test("native-token loopback guard and JSON/body bounds precede submit", async () => {
  const f = fixture("accepted");
  for (const headers of [{ host: "example.invalid" }, { "x-pi-desktop-token": "" }, { origin: "https://foreign.invalid" }]) {
    assert.equal((await f.route.POST(f.request(input, headers))).status, 403);
  }
  assert.equal((await f.route.POST(f.request(input, { "content-type": "text/plain" }))).status, 415);
  assert.equal((await f.route.POST(f.request("x".repeat(32_769)))).status, 413);
  assert.deepEqual(f.submits, []);
});
test("transport preserves raw message and reports accepted, uncertain and held with distinct HTTP status", async () => {
  for (const [status, http] of [["accepted", 200], ["uncertain", 202], ["held", 409]]) {
    const f = fixture(status), response = await f.route.POST(f.request());
    assert.equal(response.status, http);
    assert.deepEqual(f.submits, [input]);
    assert.equal((await response.json()).status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});
