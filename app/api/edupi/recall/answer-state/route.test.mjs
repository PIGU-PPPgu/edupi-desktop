import assert from "node:assert/strict";
import fs from "node:fs";
import { isIP } from "node:net";
import test from "node:test";
import { NextResponse } from "next/server.js";
import ts from "typescript";

// Execute the real route, JSON limit and request guards. No server singleton or
// Core module is imported; only its narrow service interface is substituted.
function load(relative, dependencies = {}) {
  const output = ts.transpileModule(fs.readFileSync(new URL(relative, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const testModule = { exports: {} };
  new Function("require", "module", "exports", "process", output)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `unexpected route dependency: ${name}`);
    return dependencies[name];
  }, testModule, testModule.exports, { env: {} });
  return testModule.exports;
}
const security = load("../../../../../lib/request-security.ts", { "node:net": { isIP } });
const bounded = load("../../../../../lib/bounded-form-data.ts");
const input = { sessionId: "synthetic-session", userEntryId: "synthetic-user", receiptId: "01234567-0123-4123-8123-012345678901" };
const url = "http://127.0.0.1:30141/api/edupi/recall/answer-state";

function fixture() {
  const calls = [];
  const service = {
    enabled: () => { calls.push({ method: "enabled" }); return true; },
    answerState: async value => { calls.push({ method: "answerState", value }); return { version: 1, status: "historical", reasonCode: null }; },
  };
  const route = load("./route.ts", {
    "next/server": { NextResponse }, "@/lib/request-security": security, "@/lib/bounded-form-data": bounded,
    "@/lib/edupi-recall-server": { eduPiRecallService: service, isEduPiRecallReady: async () => service.enabled() },
  });
  const request = (value = input, overrides = {}) => {
    const headers = new Headers({ host: "127.0.0.1:30141", origin: "http://127.0.0.1:30141", "content-type": "application/json" });
    for (const [name, value] of Object.entries(overrides.headers ?? {})) {
      if (value === null) headers.delete(name); else headers.set(name, value);
    }
    return new Request(url, {
      method: overrides.method ?? "POST", headers,
      ...(overrides.method === "GET" ? {} : { body: overrides.body ?? JSON.stringify(value) }),
    });
  };
  return { calls, service, route, request };
}

test("answer-state GET exposes only enablement and no-store through valid Host/Origin", async () => {
  const f = fixture();
  for (const enabled of [true, false]) {
    f.service.enabled = () => enabled;
    const response = await f.route.GET(f.request(undefined, { method: "GET" }));
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { version: 1, enabled });
  }
  assert.equal(f.calls.length, 0);
});

test("answer-state rejects invalid Host/Origin before service reads on GET and POST", async () => {
  const f = fixture();
  const blocked = [
    { host: null }, { host: "foreign.example" }, { host: "127.0.0.1:30141@foreign.example" },
    { origin: "https://foreign.example" }, { origin: "http://127.0.0.1:30142" },
    { "sec-fetch-site": "cross-site" },
  ];
  for (const method of ["GET", "POST"]) for (const headers of blocked) {
    const response = await f.route[method](f.request(undefined, { method, headers }));
    assert.equal(response.status, 403); assert.equal(response.headers.get("cache-control"), "no-store");
  }
  for (const type of [null, "text/plain", "application/x-www-form-urlencoded"]) {
    assert.equal((await f.route.POST(f.request(undefined, { headers: { "content-type": type } }))).status, 403);
  }
  assert.equal(f.calls.length, 0, "untrusted requests cannot reach the Core-facing service");
});

test("answer-state forwards only the strict receipt identity and preserves current/held/historical responses", async () => {
  const f = fixture();
  for (const status of ["current", "held", "historical"]) {
    const expected = { version: 1, status, reasonCode: status === "held" ? "source_changed" : null };
    f.service.answerState = async value => { f.calls.push(value); return expected; };
    const response = await f.route.POST(f.request());
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), expected);
  }
  assert.deepEqual(f.calls, [input, input, input]);
});

test("answer-state refuses malformed identity and all client authority/proof fields before the service", async () => {
  const f = fixture();
  const invalid = [
    null, [], {}, 1, "receipt", { ...input, receiptId: "" }, { ...input, sessionId: ["synthetic-session"] },
    { ...input, userEntryId: "x".repeat(161) },
    ...Object.entries({
      ownerId: "synthetic-owner", messageRef: "synthetic-message", sourceFingerprint: "synthetic-fingerprint",
      root_ref: "synthetic-root", term_ref: "synthetic-term", proof: { status: "current" }, current: true,
    }).map(([key, value]) => ({ ...input, [key]: value })),
  ];
  for (const value of invalid) {
    assert.equal((await f.route.POST(f.request(value))).status, 400);
  }
  assert.equal((await f.route.POST(f.request(undefined, { body: '{"sessionId":' }))).status, 400);
  assert.equal(f.calls.length, 0);
});

test("answer-state size limit and service failure hold the answer without restoring old proof", async () => {
  const f = fixture();
  for (const overrides of [
    { body: JSON.stringify({ ...input, padding: "x".repeat(4096) }) },
    { headers: { "content-length": "4097" } },
  ]) {
    const response = await f.route.POST(f.request(undefined, overrides));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { version: 1, status: "held", reasonCode: "source_unavailable" });
  }
  assert.equal(f.calls.length, 0);
  f.service.answerState = async () => { f.calls.push("unavailable"); throw new Error("synthetic read failure"); };
  const response = await f.route.POST(f.request());
  assert.deepEqual(await response.json(), { version: 1, status: "held", reasonCode: "source_unavailable" });
  assert.deepEqual(f.calls, ["unavailable"]);
});
