import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import fs from "node:fs";
import { isIP } from "node:net";
import test from "node:test";
import { NextResponse } from "next/server.js";
import ts from "typescript";

// The process passed into the compiled guards is private to this test. It
// contains a synthetic native token and never reads or mutates the real token.
const token = "synthetic-r04-native-process-token-1234567890";
function load(relative, dependencies = {}, env = {}) {
  const output = ts.transpileModule(fs.readFileSync(new URL(relative, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const testModule = { exports: {} };
  new Function("require", "module", "exports", "process", output)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `unexpected route dependency: ${name}`);
    return dependencies[name];
  }, testModule, testModule.exports, { env });
  return testModule.exports;
}
const security = load("../../../../../lib/request-security.ts", { "node:net": { isIP } });
const bounded = load("../../../../../lib/bounded-form-data.ts");
const api = load("../../../../../lib/desktop-api.ts");
const input = { action: "read", sessionId: "synthetic-session", entryId: "synthetic-user", personName: "张老师" };
const confirmation = { ...input, action: "confirm", previewId: "synthetic-preview" };
const url = "http://127.0.0.1:30141/api/edupi/recall/person";

function fixture(expectedToken = token) {
  const calls = [];
  const native = load("../../../../../lib/desktop-api-auth.ts", {
    "node:crypto": crypto, "./desktop-api.ts": api, "./request-security.ts": security,
  }, { PI_DESKTOP_API_TOKEN: expectedToken });
  const service = { person: async value => {
    calls.push(value);
    return { version: 1, status: "held", reasonCode: "synthetic-held", personName: value.personName, previewId: null,
      personId: null, personRevision: null, sourceFingerprint: null, factWrite: false };
  } };
  const route = load("./route.ts", {
    "next/server": { NextResponse }, "@/lib/desktop-api-auth": native, "@/lib/request-security": security,
    "@/lib/bounded-form-data": bounded, "@/lib/edupi-recall-server": { eduPiRecallService: service },
  });
  const request = (value = input, overrides = {}) => {
    const headers = new Headers({
      host: "127.0.0.1:30141", origin: "http://127.0.0.1:30141", "content-type": "application/json", [api.DESKTOP_API_TOKEN_HEADER]: token,
    });
    for (const [name, value] of Object.entries(overrides.headers ?? {})) {
      if (value === null) headers.delete(name); else headers.set(name, value);
    }
    return new Request(url, { method: "POST", headers, body: overrides.body ?? JSON.stringify(value) });
  };
  return { calls, route, service, request };
}

test("person read and confirm require native process token plus trusted loopback Host/Origin", async () => {
  const f = fixture();
  const blocked = [
    { [api.DESKTOP_API_TOKEN_HEADER]: null }, { [api.DESKTOP_API_TOKEN_HEADER]: "synthetic-wrong-token" },
    { host: null }, { host: "foreign.example" },
    { host: "192.0.2.12:30141", origin: "http://192.0.2.12:30141" },
    { host: "127.0.0.1:30141@foreign.example" },
    { origin: "https://foreign.example" }, { origin: "http://127.0.0.1:30142" },
    { "sec-fetch-site": "cross-site" }, { "content-type": null }, { "content-type": "text/plain" },
  ];
  for (const value of [input, confirmation]) for (const headers of blocked) {
    const response = await f.route.POST(f.request(value, { headers }));
    assert.equal(response.status, 403); assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(f.calls.length, 0, "failed authorization performs zero Core-facing service calls");
  for (const expectedToken of ["", "synthetic-short-token"]) {
    const unavailable = fixture(expectedToken);
    assert.equal((await unavailable.route.POST(unavailable.request(confirmation))).status, 403);
    assert.equal(unavailable.calls.length, 0);
  }
});

test("person route accepts only explicit read and confirm with one string name and exact field sets", async () => {
  const f = fixture();
  const extra = {
    ownerId: "synthetic-owner", expected_owner_id: "synthetic-owner", messageRef: "synthetic-message",
    message_ref: "synthetic-message", sourceFingerprint: "synthetic-fingerprint", source_fingerprint: "synthetic-fingerprint",
    expected_source_fingerprint: "synthetic-fingerprint", fp: "synthetic-fingerprint", root_ref: "synthetic-root",
    personRevision: 0, expected_person_revision: 0, command_id: "client-command", fact_write: true,
  };
  const invalid = [
    null, [], {}, "read", 1, { ...input, action: "preview" }, { ...input, action: "write" },
    { ...input, action: "" }, { ...input, personName: ["张老师"] }, { ...input, personName: ["张老师", "李老师"] },
    { ...input, personName: { name: "张老师" } }, { ...input, personName: "" }, { ...input, personName: "x".repeat(161) },
    { ...input, sessionId: null }, { ...input, entryId: "" },
    { ...input, previewId: "synthetic-preview" }, { ...input, action: "confirm" },
    { ...confirmation, previewId: "" }, { ...confirmation, previewId: ["synthetic-preview"] },
    ...[input, confirmation].flatMap(base => Object.entries(extra).map(([key, value]) => ({ ...base, [key]: value }))),
  ];
  for (const value of invalid) assert.equal((await f.route.POST(f.request(value))).status, 400);
  assert.equal(f.calls.length, 0);
});

test("person route passes exact inputs and preserves confirmed/replayed/held and true/null write outcomes", async () => {
  const f = fixture();
  for (const [status, factWrite] of [["current", false], ["confirmed", true], ["replayed", false], ["held", true], ["held", null]]) {
    const expected = {
      version: 1, status, reasonCode: status === "held" ? "confirmation_unknown" : null, personName: "张老师",
      previewId: status === "current" ? "synthetic-preview" : null,
      personId: status === "held" ? null : "synthetic-person", personRevision: status === "held" ? null : 0,
      sourceFingerprint: status === "held" ? null : `sha256:${"a".repeat(64)}`, factWrite,
    };
    f.service.person = async value => { f.calls.push(value); return expected; };
    const body = status === "current" ? input : confirmation;
    const response = await f.route.POST(f.request(body));
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), expected);
    assert.deepEqual(f.calls.at(-1), body);
  }
  assert.equal(f.calls.length, 5, "the route never adds a retry");
});

test("person route bounds malformed/oversized bodies before Core and returns unavailable without retrying service failures", async () => {
  const f = fixture();
  assert.equal((await f.route.POST(f.request(undefined, { body: '{"action":' }))).status, 400);
  for (const overrides of [
    { body: JSON.stringify({ ...confirmation, padding: "x".repeat(4096) }) },
    { headers: { "content-length": "4097" } },
  ]) assert.equal((await f.route.POST(f.request(confirmation, overrides))).status, 503);
  assert.equal(f.calls.length, 0);
  f.service.person = async value => { f.calls.push(value); throw new Error("synthetic transport closed"); };
  const response = await f.route.POST(f.request(confirmation));
  assert.equal(response.status, 503); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { error: "人物核对暂不可用" });
  assert.deepEqual(f.calls, [confirmation]);
});
