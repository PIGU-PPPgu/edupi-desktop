import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
const source = fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const rootRef = `sha256:${"a".repeat(64)}`, messageRef = `owner_message:${"b".repeat(64)}`;
function fixture({ allowed = true, isolated = true, savedStage = "pi_accepted", captured = true, grantId = "grant-parent", confirmFailure = false,
  historicalCount = 0, ownerUnavailable = false } = {}) {
  const calls = [], candidate = { root_ref: rootRef, owner_id: "owner-1", message_ref: messageRef, grant_id: "grant-parent", grant_version: 1,
    scope: { class_id: "class-1", subject: "math" }, student: { entity_id: "student-1", label: "合成学生", revision: 1 },
    recipient: { entity_id: "parent-1", label: "合成联系人", revision: 1 }, term: { entity_id: "term-1", label: "合成学期", revision: 1 },
    source_fingerprint: `sha256:${"c".repeat(64)}`, evidence_ids: ["body-source"], confirmed_fact_id: null };
  let confirmed = false;
  const saved = { stage: savedStage, occurredAt: "2026-10-20T00:00:00.000Z", bindings: [{ domain: "parent_communication", ownerId: "owner-1", grantId,
    captured, grantVersion: 1, registration: { producer_epoch: "d".repeat(64) }, messageRef }] };
  const host = { async call(operation) { calls.push({ operation }); return { ok: true, result: { data_root_fingerprint: rootRef, capabilities: { g3_processor: "active" } } }; },
    async callOwnerControl(operation, payload) {
      calls.push({ operation, payload });
      if (operation === "owner_read") return ownerUnavailable ? { ok: false, error_code: "owner_state_invalid" }
        : { ok: true, result: { owner: { id: "owner-1" }, grants: [{ id: "grant-parent", version: 1, status: "active" }] } };
      assert.equal(payload.message_ref, messageRef); assert.equal(payload.expected_owner_id, "owner-1");
      if (operation === "owner_parent_recipient_confirm") {
        if (confirmFailure) return { ok: false, error_code: "stale_source" };
        confirmed = true; return { ok: true, result: { fact_write: true, fact_id: "fact-recipient", external_send: false } };
      }
      assert.equal(operation, "owner_parent_recipient_read");
      return { ok: true, result: { version: 1, status: confirmed ? "confirmed" : "ready", reason: "recipient_confirmation_required",
        candidate: { ...candidate, confirmed_fact_id: confirmed ? "fact-recipient" : null }, fact_write: false, external_send: false } };
    } };
  const modules = {
    "next/server": { NextResponse: { json: (body, init = {}) => Response.json(body, init) } },
    "@/lib/desktop-api-auth": { isDesktopApiRequestAllowed: () => allowed },
    "@/lib/bounded-form-data": { parseJsonWithinLimit: request => request.json(), RequestBodyTooLargeError: class extends Error {} },
    "@/lib/edupi-core-snapshot": { resolveEduPiBridgeRoots: () => ({ dataRoot: { root: "/isolated-synthetic" } }) },
    "@/lib/edupi-proactivity-config": { readEduPiProactivityActivation: () => ({ enabled: true, grantId: "grant-parent", ownerId: "owner-1", scope: { classId: "class-1", subject: "math" } }) },
    "@/lib/edupi-prompt-outbox": { readEduPiPromptOutbox: (_session, requestId) => requestId.startsWith("old-") ? { ...saved, bindings: [{ ...saved.bindings[0], grantId: "old-grant", ownerId: "old-owner" }] } : saved,
      listEduPiPromptOutbox: () => [...Array.from({ length: historicalCount }, (_, index) => ({ sessionId: "session-old", clientRequestId: `old-${index}`, stage: "pi_accepted",
        occurredAt: "2026-10-21T00:00:00.000Z", domains: [{ domain: "parent_communication", captured: true }] })), { sessionId: "session-1", clientRequestId: "request-1", stage: savedStage,
        occurredAt: saved.occurredAt, domains: [{ domain: "parent_communication", captured }] }] },
    "@/lib/edupi-runtime-supervisor": { ensureEduPiRuntime: async () => host },
    "@/lib/safe-mode": { canStartEduPiCapabilityDrafts: () => isolated },
    "@/lib/edupi-ambient-session-lock": { withEduPiAmbientSessionLock: async (_id, callback) => callback() },
    "@/lib/edupi-parent-recipient-client": { parseParentRecipientEntries: body => body.entries },
  };
  const routeModule = { exports: {} }; new Function("require", "module", "exports", compiled)(name => { assert.ok(modules[name], name); return modules[name]; }, routeModule, routeModule.exports);
  const input = { sessionId: "session-1", clientRequestId: "request-1", commandId: "recipient-command", expectedGrantVersion: 1,
    expectedSourceFingerprint: candidate.source_fingerprint, studentId: "student-1", recipientId: "parent-1", termRef: "term-1" };
  return { calls, input, get: () => routeModule.exports.GET(new Request("http://localhost/api/edupi/proactivity/parent-recipient")),
    post: (body = input) => routeModule.exports.POST(new Request("http://localhost/api/edupi/proactivity/parent-recipient", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })) };
}
test("recipient confirmation only exposes accepted registered outbox sources and authenticates every owner call", async () => {
  const f = fixture(), before = await (await f.get()).json();
  assert.equal(before.entries.length, 1); assert.equal(before.entries[0].candidate.student.entity_id, "student-1");
  const result = await f.post(); assert.equal(result.status, 200); assert.equal((await result.json()).readbackConfirmed, true);
  const confirm = f.calls.find(call => call.operation === "owner_parent_recipient_confirm");
  assert.deepEqual(confirm.payload, { root_ref: rootRef, expected_owner_id: "owner-1", message_ref: messageRef, command_id: "recipient-command",
    expected_grant_version: 1, expected_source_fingerprint: f.input.expectedSourceFingerprint, student_id: "student-1", recipient_id: "parent-1", term_ref: "term-1" });
  assert.equal((await (await f.get()).json()).entries.length, 0);
});
test("non-isolated, denied, uncertain and foreign grants cannot write recipient facts", async () => {
  for (const options of [{ allowed: false }, { isolated: false }, { savedStage: "pi_unknown" }, { captured: false }, { grantId: "foreign-grant" }]) {
    const f = fixture(options), result = await f.post(); assert.notEqual(result.status, 200);
    assert.equal(f.calls.some(call => call.operation === "owner_parent_recipient_confirm"), false);
  }
  const stale = fixture({ confirmFailure: true }); assert.equal((await stale.post()).status, 409);
  const extra = fixture(); assert.equal((await extra.post({ ...extra.input, factId: "arbitrary" })).status, 400);
});

test("historical grants cannot hide a current confirmation or turn global owner failure into success", async () => {
  const mixed = fixture({ historicalCount: 40 }), response = await mixed.get();
  assert.equal(response.status, 200); const body = await response.json();
  assert.equal(body.entries.length, 1); assert.equal(body.entries[0].clientRequestId, "request-1");
  assert.equal(mixed.calls.filter(item => item.operation === "owner_parent_recipient_read").length, 1);
  const unavailable = fixture({ historicalCount: 40, ownerUnavailable: true }); assert.equal((await unavailable.get()).status, 503);
});
