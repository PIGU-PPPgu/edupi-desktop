import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const code = ts.transpileModule(fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture(allowed = true) {
  const calls = [], exports = {};
  const dependencies = {
    "@/lib/bounded-form-data": { RequestBodyTooLargeError: class extends Error {} },
    "@/lib/desktop-api-auth": { isDesktopApiRequestAllowed: () => allowed },
    "@/lib/edupi-recall-prompt-server": { createEduPiRecallPromptService: () => ({
      inspect: async (...args) => { calls.push(args); return { version: 1, status: "accepted", reasonCode: null, externalSend: false }; },
      submit: () => assert.fail("GET cannot dispatch"),
    }) },
    "@/lib/edupi-recall-settings-server": { recallServerError: () => ({ code: "recall_invalid_input", status: 400 }) },
  };
  vm.runInNewContext(code, { exports, URL, Response, require: name => {
    assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name];
  } });
  return { route: exports, calls };
}
test("Native GET accepts exactly one session/request identity and never submit", async () => {
  const f = fixture();
  const response = await f.route.GET(new Request("http://localhost/api/edupi/recall/prompts?sessionId=synthetic-session&clientRequestId=synthetic-request"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).status, "accepted");
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [["synthetic-session", "synthetic-request"]]);
  for (const query of ["sessionId=s", "sessionId=s&clientRequestId=c&approveNormal=true",
    "sessionId=s&clientRequestId=c&clientRequestId=other"]) {
    assert.equal((await f.route.GET(new Request(`http://localhost/api/edupi/recall/prompts?${query}`))).status, 400);
  }
  assert.equal(f.calls.length, 1);
});
test("non-Native inspect cannot read private intent/outbox", async () => {
  const f = fixture(false);
  assert.equal((await f.route.GET(new Request("http://localhost/api/edupi/recall/prompts?sessionId=s&clientRequestId=c"))).status, 403);
  assert.deepEqual(f.calls, []);
});
