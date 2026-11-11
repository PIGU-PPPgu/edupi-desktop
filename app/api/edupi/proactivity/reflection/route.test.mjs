import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { createJiti } from "jiti";
import ts from "typescript";

const operationModule = await createJiti(import.meta.url).import("../../../../../lib/edupi-reflection-operation.ts");
const configModule = await createJiti(import.meta.url).import("../../../../../lib/edupi-proactivity-config.ts");
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "reflection-route-"));
after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
const source = fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const rootRef = `sha256:${"a".repeat(64)}`, sourceBasisHash = `sha256:${"b".repeat(64)}`, completionHash = `sha256:${"c".repeat(64)}`;
const date = "2026-11-10", completedAt = `${date}T10:00:00.000Z`;
const completionSourceId = `lesson-completion:${createHash("sha256").update(JSON.stringify(["class-1", "math", "lesson-1"])).digest("hex")}`;
const historyBinding = { ownerId: "owner-1", grantId: "grant-reflection", scope: { classId: "class-1", subject: "math" } };
const base = { classId: "class-1", subject: "math", date, slotId: "slot-1",
  expectedSourceBasisHash: sourceBasisHash, expectedGrantVersion: 1 };
const capture = { ...base, action: "capture", sourceId: completionSourceId, sourceRevision: "1",
  rawText: `本课在 ${completedAt} 完成。`, completedAt };
const sourceFor = (rawText, predicate = "lesson.observation", lessonId = "lesson-1", classId = "class-1") =>
  `lesson-content:${createHash("sha256").update(JSON.stringify([classId, "math", lessonId])).digest("hex").slice(0, 24)}:${createHash("sha256")
    .update(JSON.stringify([predicate, rawText])).digest("hex")}`;
const contentSourceId = sourceFor("  学生能解释计算过程。\n仍需核对单位。 ");
const contentCapture = { ...base, action: "contentCapture", sourceId: contentSourceId, sourceRevision: "1",
  predicate: "lesson.observation", rawText: "  学生能解释计算过程。\n仍需核对单位。 " };
const contentValue = raw => raw.normalize("NFKC").replace(/\s+/gu, " ").trim();
const writes = ["owner_reflection_lesson_register", "owner_reflection_completion_capture", "owner_reflection_completion_review",
  "owner_reflection_content_capture", "owner_reflection_content_review"];

function contentHistoryEntry(changes = {}) {
  const result = { ...historyEntry(), fact_id: "fact-content", source_id: contentSourceId,
    observation_id: "observation-content", raw_text: contentCapture.rawText, predicate: contentCapture.predicate,
    value: contentValue(contentCapture.rawText), ...changes };
  delete result.completed_at;
  return result;
}

function historyEntry(changes = {}) {
  return { lesson_id: "lesson-1", date, slot_id: "slot-1", term_id: "term-1",
    fact_id: "fact-completion", revision: 0, status: "pending_review", source_id: completionSourceId,
    source_revision: "1", observation_id: "observation-completion", raw_text: capture.rawText, completed_at: completedAt,
    created_at: completedAt, updated_at: completedAt, last_review: null, ...changes };
}

function historyResponse(entries, changes = {}) {
  return { ok: true, result: { status: "ready", reason_code: null, entries,
    next_cursor: null, snapshot_hash: sourceBasisHash, read_only: true, external_send: false, ...changes } };
}

function fixture(options = {}) {
  const dataRoot = fs.mkdtempSync(path.join(testRoot, "fixture-")), stateDir = path.join(dataRoot, "state");
  fs.mkdirSync(stateDir, { mode: 0o700 });
  const calls = [], locks = [], index = [];
  let registered = options.registered ?? false, completion = options.completion ? {
    fact_id: "fact-completion", revision: 0, status: "pending_review", source_id: completionSourceId,
    source_revision: "1", observation_id: "observation-completion", raw_text: capture.rawText,
    completed_at: completedAt, source_basis_hash: completionHash, ...options.completion,
  } : null;
  let content = options.content ? { fact_id: "fact-content", revision: 0, status: "pending_review",
    source_id: contentSourceId, source_revision: "1", observation_id: "observation-content",
    raw_text: contentCapture.rawText, predicate: contentCapture.predicate, value: contentValue(contentCapture.rawText),
    source_basis_hash: completionHash, ...options.content } : null;
  const occurrence = { entity_id: "lesson-1", namespace: "edupi-timetable-occurrence-v1",
    external_id: "occurrence-1", slot_id: "slot-1", slot_revision: 1,
    slot_content_hash: sourceBasisHash, source_event_date: date, source_ids: ["timetable-source"],
    task_id: "task-1", class_id: "class-1", subject: "math", term_id: "term-1",
    lesson_at: `${date}T09:00:00.000Z`, time_zone: "UTC", source_basis_hash: sourceBasisHash };
  const held = { status: "held", reason_code: "source_changed", entity_id: null, occurrence: null, external_send: false };
  const ready = status => ({ status, reason_code: null, entity_id: occurrence.entity_id,
    occurrence: { ...occurrence, ...options.occurrence }, grant_version: options.readGrantVersion ?? options.grant?.version ?? 1, external_send: false });
  const host = {
    async call(operation) {
      calls.push({ operation });
      return { ok: options.healthOk !== false, result: { data_root_fingerprint: rootRef, capabilities: { g3_processor: options.processor ?? "active" } } };
    },
    async callOwnerControl(operation, payload) {
      calls.push({ operation, payload });
      options.onCall?.(operation, payload);
      if (operation === "owner_control") {
        assert.equal(payload.action, "update");
        assert.equal(payload.expected_version, options.grant?.version ?? 1);
        if (options.sourceUpdateDenied) return { ok: false, error_code: "permission_denied" };
        options.grant = { ...options.grant, ...structuredClone(payload.spec), version: payload.expected_version + 1 };
        if (options.sourceUpdateThrowAfter) throw new Error("lost grant update response");
        if (options.sourceUpdateMismatch) options.grant.ends_at = "2098-01-01T00:00:00.000Z";
        return { ok: true, result: { grant_version: options.grant.version } };
      }
      if (operation === "owner_read") return { ok: true, result: { root_ref: options.ownerRoot ?? rootRef,
        owner: { id: options.ownerId ?? "owner-1", root_ref: options.ownerIdentityRoot ?? rootRef },
        grants: [{ id: "grant-reflection", version: 1, status: "active",
          scope: { class_id: "class-1", subject: "math" }, domains: ["lesson_reflection"], actions: ["update"],
          starts_at: "2020-01-01T00:00:00.000Z", ends_at: "2099-01-01T00:00:00.000Z",
          source_ids: ["timetable-source", completionSourceId, contentSourceId], ...options.grant }] } };
      assert.equal(payload.root_ref, rootRef);
      assert.equal(payload.expected_owner_id, "owner-1");
      assert.equal(payload.grant_id, "grant-reflection");
      assert.equal(payload.class_id, "class-1");
      assert.equal(payload.subject, "math");
      if (operation === "owner_reflection_content_history_read") {
        if (typeof options.contentHistoryResponse === "function") return options.contentHistoryResponse(payload);
        if (options.contentHistoryResponse) return options.contentHistoryResponse;
        if (!content) return historyResponse([]);
        const item = contentHistoryEntry({ ...content,
          last_review: ["accepted", "rejected"].includes(content.status)
            ? { action: content.status === "accepted" ? "accept" : "reject", reviewed_at: completedAt } : null });
        delete item.source_basis_hash;
        return historyResponse([item]);
      }
      if (operation === "owner_reflection_history_read") {
        if (typeof options.historyResponse === "function") return options.historyResponse(payload);
        if (options.historyResponse) return options.historyResponse;
        if (!completion) return historyResponse([]);
        const item = historyEntry({ ...completion,
          last_review: ["accepted", "rejected"].includes(completion.status)
            ? { action: completion.status === "accepted" ? "accept" : "reject", reviewed_at: completedAt } : null,
        });
        delete item.source_basis_hash;
        return historyResponse([item]);
      }
      assert.equal(payload.date, date);
      if (options.grant?.status && options.grant.status !== "active"
        || options.grant?.actions && !options.grant.actions.includes("update")
        || options.grant?.ends_at && options.grant.ends_at <= new Date().toISOString()) {
        return { ok: true, result: { ...held, reason_code: "permission_denied" } };
      }
      const writing = writes.includes(operation);
      const writeCount = calls.filter(call => writes.includes(call.operation)).length;
      if (writing) {
        if (options.writeHeld) return { ok: true, result: held };
        if (options.writeFail) return { ok: false, error_code: "stale_source" };
        if (options.writeThrow) throw new Error("transport lost");
        if (options.uncertain) return { ok: true, result: { ...ready(options.uncertain), reason_code: "source_changed",
          fact_id: completion?.fact_id ?? null } };
        if (operation === "owner_reflection_lesson_register") {
          registered = true;
          const result = ready("registered");
          delete result.grant_version;
          if (options.writeThrowAfter) throw new Error("response lost after commit");
          return { ok: true, result: { ...result, replayed: false } };
        }
        if (operation === "owner_reflection_completion_capture") {
          if (!registered) return { ok: true, result: { ...held, reason_code: "lesson_not_registered" } };
          completion = { fact_id: "fact-completion", revision: 0, status: "pending_review", source_id: payload.source_id,
            source_revision: payload.source_revision, observation_id: "observation-completion", raw_text: payload.raw_text,
            completed_at: payload.completed_at, source_basis_hash: completionHash, ...options.capturedCompletion };
          if (options.writeThrowAfter) throw new Error("response lost after commit");
          return { ok: true, result: { ...ready("recorded"), completion: { ...completion }, replayed: false } };
        }
        if (operation === "owner_reflection_content_capture") {
          if (!registered) return { ok: true, result: { ...held, reason_code: "lesson_not_registered" } };
          content = { fact_id: "fact-content", revision: 0, status: "pending_review", source_id: payload.source_id,
            source_revision: payload.source_revision, observation_id: "observation-content", raw_text: payload.raw_text,
            predicate: payload.predicate, value: contentValue(payload.raw_text), source_basis_hash: completionHash,
            ...options.capturedContent };
          if (options.writeThrowAfter) throw new Error("response lost after commit");
          return { ok: true, result: { ...ready("recorded"), content: { ...content }, replayed: false } };
        }
        if (operation === "owner_reflection_content_review") {
          content = { ...content, revision: content.revision + (options.reviewRevisionStalled ? 0 : 1),
            status: payload.decision === "accept" ? "accepted" : "rejected", source_basis_hash: `sha256:${"d".repeat(64)}` };
          if (options.writeThrowAfter) throw new Error("response lost after commit");
          return { ok: true, result: { ...ready("reviewed"), content: { ...content } } };
        }
        completion = { ...completion, revision: completion.revision + (options.reviewRevisionStalled ? 0 : 1), status: payload.decision === "accept" ? "accepted" : "rejected",
          source_basis_hash: `sha256:${"d".repeat(64)}` };
        if (options.writeThrowAfter) throw new Error("response lost after commit");
        return { ok: true, result: { ...ready("reviewed"), completion: { ...completion } } };
      }
      if (options.readHeld || options.readbackHeld && writeCount) return { ok: true, result: held };
      if (options.readbackFail && writeCount) return { ok: false, error_code: "source_unavailable" };
      if (operation === "owner_reflection_completion_read") {
        if (!completion || payload.fact_id !== completion.fact_id) return { ok: true, result: { ...held, reason_code: "completion_source_unavailable" } };
        return { ok: true, result: { ...ready("ready"), completion: { ...completion,
          ...(options.readbackMismatch && writeCount ? { revision: completion.revision + 1 } : {}) } } };
      }
      if (operation === "owner_reflection_content_read") {
        if (!content || payload.fact_id !== content.fact_id) return { ok: true, result: { ...held, reason_code: "content_source_unavailable" } };
        return { ok: true, result: { ...ready("ready"), content: { ...content,
          ...(options.readbackMismatch && writeCount ? { revision: content.revision + 1 } : {}) } } };
      }
      assert.equal(operation, "owner_reflection_lesson_read");
      return { ok: true, result: ready("ready") };
    },
  };
  const modules = {
    "next/server": { NextResponse: { json: (body, init = {}) => Response.json(body, init) } },
    "node:util": { isDeepStrictEqual },
    "node:crypto": { createHash },
    "@/lib/edupi-proactivity-control": { lessonReflectionCompletionSourceId: ({ classId, subject }, lessonId) =>
      `lesson-completion:${createHash("sha256").update(JSON.stringify([classId, subject, lessonId])).digest("hex")}` },
    "@/lib/edupi-reflection-index": {
      appendEduPiReflectionIndex: (scope, entry, readback) => {
        if (options.indexWriteFail) throw new Error("index unavailable");
        assert.equal(readback.completion.fact_id, entry.factId);
        index.push({ ...entry, scope });
      },
      readEduPiReflectionIndex: (scope, query) => {
        if (options.indexReadFail) throw new Error("index unavailable");
        return index.filter(item => item.scope.ownerId === scope.ownerId && item.scope.grantId === scope.grantId
          && item.scope.classId === scope.classId && item.scope.subject === scope.subject
          && item.scope.rootRef === scope.rootRef && item.date === query.date
          && (query.slotId === undefined || item.slotId === query.slotId)
          && (query.lessonId === undefined || item.lessonId === query.lessonId));
      },
    },
    "@/lib/edupi-reflection-operation": operationModule,
    "@/lib/desktop-api-auth": { isDesktopApiRequestAllowed: () => options.allowed !== false },
    "@/lib/bounded-form-data": { RequestBodyTooLargeError: class extends Error {}, parseJsonWithinLimit: request => request.json() },
    "@/lib/edupi-core-snapshot": {
      resolveEduPiBridgeRoots: () => ({ dataRoot: { root: dataRoot } }),
      readEduPiEducationSnapshot: async () => ({ workspace: {
        timetable: options.slots ?? [{ slot_id: "slot-1", class_id: "class-1", subject: "math", day_of_week: 2 }],
        fact_spine: { projection_kind: "education_fact_v1", external_send: false,
          entities: registered && !options.registrationMissing ? [{ entity_id: "lesson-1", entity_kind: "lesson_occurrence", status: "active",
            external_refs: [{ namespace: occurrence.namespace, external_id: occurrence.external_id },
              ...(options.registrationSelectionMissing ? [] : [{ namespace: "edupi-timetable-selection-v1", external_id: occurrence.external_id }])] }] : [],
          accepted_facts: completion?.status === "accepted" ? [{ ...completion, entity_id: "lesson-1", predicate: "lesson.completed", subject_ref: "math" }] : [],
          fact_candidates: completion && ["candidate", "pending_review", "held"].includes(completion.status)
            ? [{ ...completion, entity_id: "lesson-1", predicate: "lesson.completed", subject_ref: "math" }] : [],
        },
      } }),
    },
    "@/lib/edupi-proactivity-config": { readEduPiProactivityActivation: () => options.persistedActivation
      ? configModule.readEduPiProactivityActivation({ stateDir, dataRoot: options.otherDataRoot ?? dataRoot,
        domain: "lesson_reflection", env: {} })
      : ({ enabled: options.enabled !== false, configurationStatus: "ready",
        grantId: "grant-reflection", ownerId: "owner-1", scope: { classId: "class-1", subject: "math" }, ...options.activation }) },
    "@/lib/edupi-runtime-supervisor": { ensureEduPiRuntime: async () => host },
    "@/lib/safe-mode": { canStartEduPiCapabilityDrafts: () => options.isolated !== false },
    "@/lib/edupi-ambient-session-lock": { withEduPiAmbientSessionLock: async (id, callback) => { locks.push(id); return callback(); } },
  };
  const routeModule = { exports: {} };
  const originalStateDir = process.env.PI_DESKTOP_STATE_DIR;
  process.env.PI_DESKTOP_STATE_DIR = stateDir;
  new Function("require", "module", "exports", compiled)(name => { assert.ok(modules[name], name); return modules[name]; }, routeModule, routeModule.exports);
  if (originalStateDir === undefined) delete process.env.PI_DESKTOP_STATE_DIR;
  else process.env.PI_DESKTOP_STATE_DIR = originalStateDir;
  // Each request needs a synthetic state path, never the caller's real desktop state.
  const withState = callback => async (...args) => {
    const previous = process.env.PI_DESKTOP_STATE_DIR;
    process.env.PI_DESKTOP_STATE_DIR = stateDir;
    try { return await callback(...args); }
    finally { if (previous === undefined) delete process.env.PI_DESKTOP_STATE_DIR; else process.env.PI_DESKTOP_STATE_DIR = previous; }
  };
  const request = (method, body) => routeModule.exports[method](new Request("http://localhost/api/edupi/proactivity/reflection",
    { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  return { calls, locks, index, dataRoot, stateDir, get: withState((query = `date=${date}`) => routeModule.exports.GET(new Request(`http://localhost/api/edupi/proactivity/reflection?${query}`))),
    raw: withState(request),
    post: withState(async (body = { ...base, action: "register" }) => {
      const operationId = randomUUID();
      const preflight = await request("PUT", { operationId, mutation: body });
      if (!preflight.ok) return preflight;
      const prepared = await preflight.json();
      return request("POST", { ...body, operationId, operationFingerprint: prepared.operation.fingerprint });
    }) };
}

test("GET lists scoped timetable occurrences without writing and returns CAS and available completion sources", async () => {
  const current = fixture({ slots: [
    { slot_id: "foreign", class_id: "other", subject: "math", day_of_week: 2 },
    { slot_id: "slot-1", class_id: "class-1", subject: "math", day_of_week: 2 },
    { slot_id: "tomorrow", class_id: "class-1", subject: "math", day_of_week: 3 },
  ] });
  const response = await current.get(), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.entries.length, 1);
  assert.equal(body.entries[0].registrationStatus, "unregistered");
  assert.equal(body.entries[0].sourceBasisHash, sourceBasisHash);
  assert.deepEqual(body.entries[0].completionSourceIds, [completionSourceId]);
  assert.equal(body.externalSend, false); assert.equal(body.truncated, false);
  assert.equal(current.calls.some(call => /register|capture|review/.test(call.operation)), false);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("content capture rejects a generic grant source without a matching lesson and text binding", async () => {
  const generic = "lesson-content:lesson-1";
  const current = fixture({ registered: true, grant: { source_ids: ["timetable-source", generic] } });
  const response = await current.post({ ...contentCapture, sourceId: generic });
  assert.equal(response.status, 409);
  assert.equal(current.calls.some(call => call.operation === "owner_reflection_content_capture"), false);
});

const registerContent = { ...base, action: "registerContentSource", predicate: contentCapture.predicate,
  rawText: contentCapture.rawText };

test("a teacher content submission registers its exact source by CAS and captures using the new version", async () => {
  const options = { registered: true, grant: { source_ids: ["timetable-source", completionSourceId],
    budget: { max_calls: 4, max_tokens: 8000 } } };
  const current = fixture(options);
  const response = await current.raw("POST", registerContent), saved = await response.json();
  assert.equal(response.status, 200, JSON.stringify(saved));
  assert.equal(saved.readbackConfirmed, true);
  assert.equal(saved.sourceId, contentSourceId);
  assert.equal(saved.entry.grantVersion, 2);
  assert.deepEqual(saved.entry.contentSourceIds, [contentSourceId]);
  assert.equal(current.calls.some(call => writes.includes(call.operation)), false);
  const update = current.calls.find(call => call.operation === "owner_control").payload;
  assert.equal(update.expected_version, 1);
  assert.deepEqual(update.spec, { scope: { class_id: "class-1", subject: "math" }, domains: ["lesson_reflection"],
    actions: ["update"], source_ids: ["timetable-source", completionSourceId, contentSourceId].sort(),
    starts_at: "2020-01-01T00:00:00.000Z", ends_at: "2099-01-01T00:00:00.000Z",
    budget: { max_calls: 4, max_tokens: 8000 } });
  const replay = await current.raw("POST", { ...registerContent, expectedGrantVersion: 2 });
  assert.equal(replay.status, 200);
  assert.equal(current.calls.filter(call => call.operation === "owner_control").length, 1);
  const captured = await current.post({ ...contentCapture, expectedGrantVersion: 2 });
  assert.equal(captured.status, 200, JSON.stringify(await captured.json()));
});

test("content registration rejects invalid, stale, foreign and unregistered submissions without grant writes", async () => {
  for (const [options, body, status] of [
    [{ allowed: false }, registerContent, 403],
    [{}, registerContent, 409],
    [{ registered: true }, { ...registerContent, classId: "other-class" }, 409],
    [{ registered: true }, { ...registerContent, expectedGrantVersion: 2 }, 409],
    [{ registered: true }, { ...registerContent, expectedSourceBasisHash: completionHash }, 409],
    [{ registered: true }, { ...registerContent, predicate: "lesson.completed" }, 400],
    [{ registered: true }, { ...registerContent, rawText: " \n " }, 400],
    [{ registered: true }, { ...registerContent, sourceId: "injected" }, 400],
  ]) {
    const current = fixture(options), response = await current.raw("POST", body);
    assert.equal(response.status, status, JSON.stringify(await response.json()));
    assert.equal(current.calls.some(call => call.operation === "owner_control"), false);
  }
});

test("uncertain source registration never claims success and a readback can recover it without another grant write", async () => {
  for (const failure of ["sourceUpdateThrowAfter", "sourceUpdateMismatch", "sourceUpdateDenied"]) {
    const options = { registered: true, grant: { source_ids: ["timetable-source", completionSourceId] }, [failure]: true };
    const current = fixture(options), response = await current.raw("POST", registerContent);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "content_source_unverified");
    assert.equal(current.calls.some(call => writes.includes(call.operation)), false);
    if (failure === "sourceUpdateThrowAfter") {
      const replay = await current.raw("POST", { ...registerContent, expectedGrantVersion: 2 });
      assert.equal(replay.status, 200);
      assert.equal(current.calls.filter(call => call.operation === "owner_control").length, 1);
    }
  }
});

test("content source selection and capture reject another lesson, predicate or raw text", async () => {
  for (const sourceId of [
    sourceFor(contentCapture.rawText, contentCapture.predicate, "lesson-2"),
    sourceFor(contentCapture.rawText, "lesson.feedback"),
    sourceFor(contentCapture.rawText.trim()),
    "lesson-content:lesson-1", "conversation:generic",
  ]) {
    const current = fixture({ registered: true, grant: { source_ids: ["timetable-source", sourceId] } });
    const listed = await (await current.get()).json();
    if (sourceId.includes(":lesson-1") || sourceId.startsWith("conversation:")
      || sourceId === sourceFor(contentCapture.rawText, contentCapture.predicate, "lesson-2"))
      assert.deepEqual(listed.entries[0].contentSourceIds, []);
    assert.equal((await current.post({ ...contentCapture, sourceId })).status, 409);
    assert.equal(current.calls.some(call => call.operation === "owner_reflection_content_capture"), false);
  }
});

test("register, capture, accepted review and subsequent GET preserve the same lesson and fact", async () => {
  const current = fixture();
  assert.equal((await (await current.post()).json()).readbackConfirmed, true);
  const captured = await (await current.post(capture)).json();
  assert.equal(captured.ok, true); assert.equal(captured.entry.completion.status, "pending_review");
  assert.equal(captured.entry.registrationStatus, "registered");
  const review = { ...base, action: "review", factId: captured.entry.completion.factId, expectedFactRevision: 0,
    expectedCompletionBasisHash: completionHash, decision: "accept" };
  const reviewed = await (await current.post(review)).json();
  assert.equal(reviewed.readbackConfirmed, true); assert.equal(reviewed.entry.completion.status, "accepted");
  const readback = await (await current.get()).json();
  assert.equal(readback.entries[0].completion.factId, "fact-completion");
  assert.equal(readback.entries[0].completion.revision, 1);
  const register = current.calls.find(call => call.operation === "owner_reflection_lesson_register");
  assert.deepEqual(register.payload, { root_ref: rootRef, expected_owner_id: "owner-1", grant_id: "grant-reflection",
    class_id: "class-1", subject: "math", date, slot_id: "slot-1", expected_source_basis_hash: sourceBasisHash, expected_grant_version: 1 });
  assert.equal(current.locks.length, 3);
});

test("owner, root, scope, domain, active grant and isolated mode fail closed", async () => {
  for (const options of [{ allowed: false }, { isolated: false }, { enabled: false }, { healthOk: false }, { ownerId: "other" },
    { ownerRoot: `sha256:${"e".repeat(64)}` }, { grant: { status: "revoked" } }, { grant: { domains: ["parent_communication"] } },
    { grant: { actions: ["prepare"] } }, { grant: { ends_at: "2021-01-01T00:00:00.000Z" } },
    { grant: { scope: { class_id: "other", subject: "math" } } }]) {
    const current = fixture(options);
    assert.notEqual((await current.post()).status, 200, JSON.stringify(options));
    assert.equal(current.calls.some(call => call.operation === "owner_reflection_lesson_register"), false);
  }
  const current = fixture();
  assert.equal((await current.post({ ...base, classId: "other", action: "register" })).status, 409);
  assert.equal(current.calls.some(call => call.operation === "owner_reflection_lesson_read"), false);
});

test("disabled GET remains read-only and does not start a runtime", async () => {
  for (const options of [{ enabled: false }, { isolated: false }]) {
    const current = fixture(options), body = await (await current.get()).json();
    assert.equal(body.enabled, false); assert.deepEqual(body.entries, []); assert.deepEqual(current.calls, []);
  }
});

test("stale lesson and completion CAS stop before mutation", async () => {
  for (const change of [{ expectedSourceBasisHash: `sha256:${"e".repeat(64)}` }, { expectedGrantVersion: 2 }]) {
    const current = fixture();
    assert.equal((await current.post({ ...base, action: "register", ...change })).status, 409);
    assert.equal(current.calls.some(call => call.operation === "owner_reflection_lesson_register"), false);
  }
  const current = fixture({ registered: true, completion: {} });
  assert.equal((await current.post({ ...base, action: "review", factId: "fact-completion", expectedFactRevision: 2,
    expectedCompletionBasisHash: completionHash, decision: "accept" })).status, 409);
  assert.equal(current.calls.some(call => call.operation === "owner_reflection_completion_review"), false);
});

test("inner held is never a success even when transport ok is true", async () => {
  for (const options of [{ readHeld: true }, { writeHeld: true }]) {
    const current = fixture(options), response = await current.post(), body = await response.json();
    assert.equal(response.status, 409); assert.equal(body.ok, false); assert.equal(body.result.status, "held");
    assert.equal(body.operation.status, "not_committed"); assert.equal(body.operation.terminal, true);
  }
  const current = fixture(), response = await current.post(capture);
  assert.equal(response.status, 409); assert.equal((await response.json()).result.reason_code, "lesson_not_registered");
});

test("uncertain or lost mutation responses remain uncertain and never repeat writes", async () => {
  for (const options of [{ uncertain: "commit_unknown" }, { uncertain: "committed_unverified" }, { writeThrow: true },
    { readbackHeld: true }, { readbackFail: true }]) {
    const current = fixture(options), response = await current.post(), body = await response.json();
    assert.equal(response.status, 409); assert.equal(body.ok, false); assert.equal(body.readbackConfirmed, false);
    assert.ok(["commit_unknown", "committed_unverified"].includes(body.result.status));
    assert.equal(current.calls.filter(call => call.operation === "owner_reflection_lesson_register").length, 1);
    assert.equal(current.calls.filter(call => call.operation === "owner_reflection_lesson_read").length, 2);
  }
});

test("completion capture checks the distinct authorized source and verifies exact readback", async () => {
  for (const sourceId of ["foreign", "timetable-source"]) {
    const current = fixture({ registered: true });
    assert.equal((await current.post({ ...capture, sourceId })).status, 409);
    assert.equal(current.calls.some(call => call.operation === "owner_reflection_completion_capture"), false);
  }
  const mismatch = fixture({ registered: true, readbackMismatch: true }), response = await mismatch.post(capture);
  assert.equal(response.status, 409); assert.equal((await response.json()).result.status, "committed_unverified");
  const wrongText = fixture({ registered: true, capturedCompletion: { raw_text: `另一份 ${completedAt} 正文。` } });
  assert.equal((await wrongText.post(capture)).status, 409);
});

test("registration requires an active persisted identity with matching external reference", async () => {
  const current = fixture({ registrationMissing: true }), response = await current.post();
  assert.equal(response.status, 409);
  assert.equal((await response.json()).result.status, "committed_unverified");
});

test("rejected completion remains in ordinary date GET after review or withdrawal", async () => {
  for (const decision of ["reject", "withdraw"]) {
    const current = fixture({ registered: true, completion: { status: decision === "withdraw" ? "accepted" : "pending_review" } });
    const response = await current.post({ ...base, action: "review", factId: "fact-completion", expectedFactRevision: 0,
      expectedCompletionBasisHash: completionHash, decision });
    assert.equal(response.status, 200); assert.equal((await response.json()).entry.completion.status, "rejected");
    const ordinary = await current.get();
    assert.equal(ordinary.status, 200);
    const entries = (await ordinary.json()).entries;
    assert.equal(entries.length, 1);
    assert.equal(entries[0].completion.factId, "fact-completion");
    assert.equal(entries[0].completion.status, "rejected");
    assert.equal(entries[0].completion.revision, 1);
    assert.equal(current.calls.filter(call => call.operation === "owner_reflection_completion_review").length, 1);
  }
});

test("review does not mutate when the completion index cannot be protected", async () => {
  const current = fixture({ registered: true, completion: {}, indexWriteFail: true });
  const response = await current.post({ ...base, action: "review", factId: "fact-completion", expectedFactRevision: 0,
    expectedCompletionBasisHash: completionHash, decision: "reject" });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "reflection_index_unavailable");
  assert.equal(current.calls.some(call => call.operation === "owner_reflection_completion_review"), false);
});

test("a review status change without a newer revision is unverified", async () => {
  for (const decision of ["accept", "reject", "withdraw"]) {
    const current = fixture({ registered: true, reviewRevisionStalled: true,
      completion: { status: decision === "withdraw" ? "accepted" : "pending_review" } });
    const response = await current.post({ ...base, action: "review", factId: "fact-completion", expectedFactRevision: 0,
      expectedCompletionBasisHash: completionHash, decision });
    const body = await response.json();
    assert.equal(response.status, 409);
    assert.equal(body.ok, false);
    assert.equal(body.result.status, "committed_unverified");
    assert.equal(body.readbackConfirmed, false);
    assert.equal(body.readback.completion.revision, 0);
    assert.equal(current.calls.filter(call => call.operation === "owner_reflection_completion_review").length, 1);
  }
});

test("strict input, dates, CAS, raw evidence and injected identity are validated before runtime", async () => {
  for (const body of [
    { ...base, action: "register", rootRef }, { ...base, action: "register", expectedGrantVersion: 1.5 },
    { ...base, action: "register", date: "2026-02-30" }, { ...capture, rawText: "本课完成" },
    { ...capture, rawText: "x".repeat(4001) }, { ...capture, sourceRevision: "\u0000" },
    { ...base, action: "review", factId: "f", expectedFactRevision: -1, expectedCompletionBasisHash: completionHash, decision: "accept" },
  ]) {
    const current = fixture(); assert.equal((await current.post(body)).status, 400); assert.deepEqual(current.calls, []);
  }
  for (const query of ["date=2026-02-30", `date=${date}&ownerId=other`, `date=${date}&date=${date}`]) {
    const current = fixture(); assert.equal((await current.get(query)).status, 400); assert.deepEqual(current.calls, []);
  }
});

test("mismatched Core occurrence cannot be presented as authorized ready", async () => {
  for (const occurrence of [{ class_id: "other" }, { subject: "other" }, { slot_id: "other" }, { source_event_date: "2026-11-09" }]) {
    const current = fixture({ occurrence });
    assert.equal((await current.get()).status, 503);
    assert.equal((await current.post()).status, 503);
    assert.equal(current.calls.some(call => call.operation === "owner_reflection_lesson_register"), false);
  }
});

test("durable preflight is required and resolve fences a delayed POST", async () => {
  const current = fixture(), mutation = { ...base, action: "register" }, operationId = randomUUID();
  assert.equal((await current.raw("POST", mutation)).status, 409);
  const prepared = await (await current.raw("PUT", { operationId, mutation })).json();
  assert.equal(prepared.operation.status, "prepared");
  const identity = { operationId, operationFingerprint: prepared.operation.fingerprint };
  const resolved = await (await current.raw("PATCH", identity)).json();
  assert.equal(resolved.operation.status, "not_committed");
  assert.equal(resolved.operation.terminal, true);
  assert.equal((await (await current.raw("POST", { ...mutation, ...identity })).json()).operation.status, "not_committed");
  assert.equal(current.calls.some(call => call.operation === "owner_reflection_lesson_register"), false);
});

test("lost HTTP response replays only the durable successful receipt", async () => {
  const current = fixture(), mutation = { ...base, action: "register" }, operationId = randomUUID();
  const prepared = await (await current.raw("PUT", { operationId, mutation })).json();
  const identity = { operationId, operationFingerprint: prepared.operation.fingerprint };
  await current.raw("POST", { ...mutation, ...identity });
  const resolved = await (await current.raw("PATCH", identity)).json();
  assert.equal(resolved.readbackConfirmed, true);
  assert.equal(resolved.operation.status, "committed");
  assert.equal(resolved.operation.terminal, true);
  assert.equal((await (await current.raw("POST", { ...mutation, ...identity })).json()).operation.status, "committed");
  assert.equal(current.calls.filter(call => call.operation === "owner_reflection_lesson_register").length, 1);
});

test("a transport loss after dispatch never becomes a terminal absence", async () => {
  const current = fixture({ writeThrow: true }), mutation = { ...base, action: "register" }, operationId = randomUUID();
  const prepared = await (await current.raw("PUT", { operationId, mutation })).json();
  const identity = { operationId, operationFingerprint: prepared.operation.fingerprint };
  await current.raw("POST", { ...mutation, ...identity });
  const resolved = await (await current.raw("PATCH", identity)).json();
  assert.equal(resolved.operation.status, "unknown"); assert.equal(resolved.operation.terminal, false);
  await current.raw("POST", { ...mutation, ...identity });
  assert.equal(current.calls.filter(call => call.operation === "owner_reflection_lesson_register").length, 1);
});

test("history read forwards bounded cursor scope and does not write", async () => {
  const current = fixture();
  const response = await current.get(`history=true&date=${date}&slotId=slot-1&pageSize=3&cursor=cursor-1`);
  const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.history, true); assert.equal(body.readOnly, true);
  assert.deepEqual(body.entries, []); assert.equal(body.nextCursor, null);
  assert.deepEqual(current.calls.find(call => call.operation === "owner_reflection_history_read").payload, {
    root_ref: rootRef, expected_owner_id: "owner-1", grant_id: "grant-reflection", class_id: "class-1",
    subject: "math", date, slot_id: "slot-1", page_size: 3, cursor: "cursor-1",
  });
  assert.equal(current.calls.some(call => /register|capture|review/.test(call.operation)), false);
});

test("history remains readable without execution activation or a currently writable grant", async () => {
  for (const options of [
    { enabled: false }, { isolated: false }, { processor: "inactive" },
    { grant: { status: "revoked" } }, { grant: { status: "paused" } },
    { grant: { ends_at: "2021-01-01T00:00:00.000Z" } },
    { grant: { starts_at: "2090-01-01T00:00:00.000Z" } },
    { grant: { actions: ["prepare"] } },
    { enabled: false, isolated: false, processor: "inactive",
      grant: { status: "revoked", actions: [], ends_at: "2021-01-01T00:00:00.000Z" } },
  ]) {
    const historical = historyEntry();
    const current = fixture({ activation: { historyBinding }, ...options, historyResponse: historyResponse([historical]) });
    const response = await current.get("history=true"), body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(options));
    assert.deepEqual(body.entries, [historical]);
    assert.equal(body.readOnly, true);
    assert.equal(body.externalSend, false);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(current.calls.map(call => call.operation), ["health", "owner_read", "owner_reflection_history_read"]);
    assert.notEqual((await current.post()).status, 200, JSON.stringify(options));
    assert.equal(current.calls.some(call => /_register$|_capture$|_review$/u.test(call.operation)), false);
  }
});

test("persisted stopped history survives cleared execution identity and never admits writes", async () => {
  const current = fixture({ persistedActivation: true, processor: "inactive", grant: { status: "paused" },
    historyResponse: historyResponse([historyEntry()]) });
  const storage = { stateDir: current.stateDir, dataRoot: current.dataRoot, domain: "lesson_reflection" };
  configModule.writeEduPiProactivityConfig({ enabled: false, scope: null, grantId: null, historyBinding }, storage);
  const persisted = configModule.readEduPiProactivityActivation({ ...storage, env: {} });
  assert.equal(persisted.enabled, false);
  assert.equal(persisted.scope, null);
  assert.equal(persisted.grantId, null);
  assert.equal(persisted.ownerId, undefined);
  assert.deepEqual(persisted.historyBinding, historyBinding);
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await current.get("history=true"), body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.entries, [historyEntry()]);
    assert.equal(body.readOnly, true);
    assert.equal(body.externalSend, false);
  }
  assert.equal((await current.post()).status, 409);
  for (const mutation of [
    { ...base, action: "register" },
    capture,
    { ...base, action: "review", factId: "fact-completion", expectedFactRevision: 0,
      expectedCompletionBasisHash: completionHash, decision: "accept" },
  ]) {
    const denied = await current.raw("POST", { ...mutation, operationId: randomUUID(), operationFingerprint: sourceBasisHash });
    assert.equal(denied.status, 409);
    assert.equal((await denied.json()).code, "activation_pending");
  }
  assert.equal(current.calls.some(call => /_register$|_capture$|_review$/u.test(call.operation)), false);
});

test("stop intent and foreign data roots suppress persisted history before Core is consulted", async () => {
  for (const blockedBy of ["stop_pending", "foreign_root"]) {
    const options = { persistedActivation: true };
    const current = fixture(options);
    const storage = { stateDir: current.stateDir, dataRoot: current.dataRoot, domain: "lesson_reflection" };
    configModule.writeEduPiProactivityConfig({ enabled: false, scope: null, grantId: null, historyBinding }, storage);
    assert.deepEqual(configModule.readEduPiProactivityActivation({ ...storage, env: {} }).historyBinding, historyBinding);
    if (blockedBy === "stop_pending") {
      configModule.writeEduPiProactivityStopIntent(historyBinding, storage);
    } else {
      options.otherDataRoot = fs.mkdtempSync(path.join(testRoot, "foreign-data-"));
    }
    const response = await current.get("history=true");
    assert.equal(response.status, 409, blockedBy);
    assert.equal((await response.json()).code, "activation_pending");
    assert.deepEqual(current.calls, [], blockedBy);
  }
});

test("an explicit stop_pending activation cannot reuse otherwise complete history credentials", async () => {
  const current = fixture({ activation: { enabled: false, configurationStatus: "stop_pending",
    historyBinding: { scope: { classId: "class-1", subject: "math" }, grantId: "grant-reflection", ownerId: "owner-1" } } });
  const response = await current.get("history=true");
  assert.equal(response.status, 409);
  assert.deepEqual(current.calls, []);
});

test("history still fails closed for desktop identity, owner, grant and scope mismatches", async () => {
  for (const options of [
    { allowed: false }, { healthOk: false }, { ownerId: "other" },
    { ownerRoot: sourceBasisHash }, { ownerIdentityRoot: sourceBasisHash },
    { activation: { ownerId: null } }, { activation: { grantId: null } }, { activation: { scope: null } },
    { grant: { id: "foreign" } }, { grant: { domains: ["parent_communication"] } },
    { grant: { scope: { class_id: "other", subject: "math" } } },
    { grant: { scope: { class_id: "class-1", subject: "other" } } },
    { grant: { source_ids: null } }, { grant: { source_ids: [""] } },
  ]) {
    const current = fixture({ enabled: false, isolated: false, processor: "inactive",
      activation: { historyBinding }, ...options });
    const response = await current.get("history=true");
    assert.equal(response.ok, false, JSON.stringify(options));
    assert.equal(current.calls.some(call => call.operation === "owner_reflection_history_read"), false);
  }
  const current = fixture({ enabled: false, isolated: false, processor: "inactive",
    activation: { historyBinding },
    grant: { status: "revoked", source_ids: ["timetable-source"] },
    historyResponse: historyResponse([historyEntry()]) });
  assert.equal((await current.get("history=true")).status, 503);
});

test("held, unavailable and changed history snapshots never look like an empty success", async () => {
  for (const historyResponse of [
    { ok: true, result: { status: "held", reason_code: "history_changed", read_only: true, external_send: false } },
    { ok: false, error_code: "history_changed" },
    { ok: true, result: { status: "ready", entries: [], next_cursor: null, snapshot_hash: sourceBasisHash, read_only: false, external_send: false } },
  ]) {
    const current = fixture({ historyResponse });
    const response = await current.get("history=true");
    assert.equal(response.ok, false); assert.equal((await response.json()).ok, false);
  }
  for (const query of ["history=true&pageSize=51", "history=true&date=2026-02-30", "history=true&ownerId=other", "history=true&cursor="]) {
    const current = fixture();
    assert.equal((await current.get(query)).status, 400); assert.deepEqual(current.calls, []);
  }
});

test("historical records remain visible without a current timetable row and have a strictly validated scope", async () => {
  const historical = historyEntry({ status: "rejected", revision: 2, last_review: { action: "reject", reviewed_at: completedAt } });
  const current = fixture({ slots: [], historyResponse: historyResponse([historical]) });
  const body = await (await current.get("history=true")).json();
  assert.equal(body.ok, true); assert.deepEqual(body.entries, [historical]);
  assert.equal(current.calls.some(call => call.operation === "owner_reflection_lesson_read"), false);
  for (const changes of [
    { owner_id: "other" }, { source_id: "foreign" }, { date: "2026-02-30" }, { revision: -1 },
    { slot_id: false }, { raw_text: "missing completion timestamp" }, { completed_at: "yesterday" },
    { status: "invented" }, { status: "accepted", last_review: null },
    { last_review: { action: "accept", reviewed_at: "not-a-time" } },
  ]) {
    const invalid = fixture({ historyResponse: historyResponse([historyEntry(changes)]) });
    assert.equal((await invalid.get("history=true")).status, 503, JSON.stringify(changes));
  }
  for (const changes of [{ date: "2026-11-09" }, { slot_id: "slot-2" }]) {
    const invalid = fixture({ historyResponse: historyResponse([historyEntry(changes)]) });
    assert.equal((await invalid.get(`history=true&date=${date}&slotId=slot-1`)).status, 503);
  }
});

test("history rejects duplicate facts, malformed cursors, mismatched snapshots and extra response fields", async () => {
  const cursor = fields => Buffer.from(JSON.stringify({ version: 1, snapshot_hash: sourceBasisHash, after: "fact-completion", ...fields })).toString("base64url");
  for (const response of [
    historyResponse([historyEntry(), historyEntry()]),
    historyResponse([historyEntry()], { next_cursor: "nonsense" }),
    historyResponse([historyEntry()], { next_cursor: cursor({ snapshot_hash: rootRef }) }),
    historyResponse([historyEntry()], { next_cursor: cursor({ after: "foreign" }) }),
    historyResponse([], { next_cursor: cursor({}) }),
    historyResponse([historyEntry()], { root_ref: rootRef }),
  ]) {
    const current = fixture({ historyResponse: response });
    assert.equal((await current.get("history=true")).status, 503);
  }
  const nextCursor = cursor({});
  const current = fixture({ historyResponse: historyResponse([historyEntry()], { next_cursor: nextCursor }) });
  assert.equal((await (await current.get("history=true&pageSize=1")).json()).nextCursor, nextCursor);
});

async function lostWrite(current, mutation) {
  const operationId = randomUUID();
  const prepared = await (await current.raw("PUT", { operationId, mutation })).json();
  const identity = { operationId, operationFingerprint: prepared.operation.fingerprint };
  const written = await (await current.raw("POST", { ...mutation, ...identity })).json();
  assert.equal(written.operation.status, "unknown");
  return identity;
}

test("authoritative readback recovers lost register, capture and each review decision without another write", async () => {
  const cases = [
    { options: { writeThrowAfter: true }, mutation: { ...base, action: "register" } },
    { options: { writeThrowAfter: true, registered: true }, mutation: capture },
    ...["accept", "reject", "withdraw"].map(decision => ({
      options: { writeThrowAfter: true, registered: true, completion: { status: decision === "withdraw" ? "accepted" : "pending_review" } },
      mutation: { ...base, action: "review", factId: "fact-completion", expectedFactRevision: 0,
        expectedCompletionBasisHash: completionHash, decision },
    })),
  ];
  for (const { options, mutation } of cases) {
    const current = fixture(options), identity = await lostWrite(current, mutation);
    const recovered = await (await current.raw("PATCH", identity)).json();
    assert.equal(recovered.operation.status, "committed", JSON.stringify(mutation));
    assert.equal(recovered.operation.terminal, true);
    assert.equal(recovered.readbackConfirmed, true);
    assert.equal(recovered.result.status, mutation.action === "register" ? "registered" : mutation.action === "capture" ? "recorded" : "reviewed");
    assert.equal(current.calls.filter(call => /_register$|_capture$|_review$/u.test(call.operation)).length, 1);
    assert.deepEqual(await (await current.raw("PATCH", identity)).json(), recovered);
  }
});

test("lost writes use persisted history binding after desktop execution is stopped", async () => {
  for (const mutation of [
    { ...base, action: "register" }, capture,
    { ...base, action: "review", factId: "fact-completion", expectedFactRevision: 0,
      expectedCompletionBasisHash: completionHash, decision: "accept" },
  ]) {
    const options = { writeThrowAfter: true, registered: mutation.action !== "register",
      ...(mutation.action === "review" ? { completion: {} } : {}) };
    const current = fixture(options), identity = await lostWrite(current, mutation);
    const storage = { stateDir: current.stateDir, dataRoot: current.dataRoot, domain: "lesson_reflection" };
    configModule.writeEduPiProactivityConfig({ enabled: false, scope: null, grantId: null, historyBinding }, storage);
    Object.assign(options, { persistedActivation: true, isolated: false, processor: "inactive" });
    const stopped = configModule.readEduPiProactivityActivation({ ...storage, env: {} });
    assert.equal(stopped.enabled, false);
    assert.equal(stopped.ownerId, undefined);
    assert.equal(stopped.grantId, null);
    assert.equal(stopped.scope, null);
    assert.deepEqual(stopped.historyBinding, historyBinding);
    const response = await current.raw("PATCH", identity), recovered = await response.json();
    assert.equal(response.status, 200, mutation.action);
    assert.equal(recovered.ok, true);
    assert.equal(recovered.operation.status, "committed");
    assert.equal(recovered.operation.terminal, true);
    assert.equal(recovered.readbackConfirmed, true);
    assert.equal(recovered.externalSend, false);
    assert.equal(recovered.result.status, mutation.action === "register" ? "registered" : mutation.action === "capture" ? "recorded" : "reviewed");
    assert.deepEqual(await (await current.raw("PATCH", identity)).json(), recovered);
    const denied = await current.raw("POST", { ...mutation, ...identity });
    assert.equal(denied.status, 409);
    assert.equal((await denied.json()).code, "activation_pending");
    assert.equal(current.calls.filter(call => /_register$|_capture$|_review$/u.test(call.operation)).length, 1);
  }
});

test("lost writes remain unknown while Core grant is paused or revoked and never dispatch again", async () => {
  for (const mutation of [
    { ...base, action: "register" }, capture,
    { ...base, action: "review", factId: "fact-completion", expectedFactRevision: 0,
      expectedCompletionBasisHash: completionHash, decision: "accept" },
  ]) {
    const options = { writeThrowAfter: true, registered: mutation.action !== "register",
      ...(mutation.action === "review" ? { completion: {} } : {}) };
    const current = fixture(options), identity = await lostWrite(current, mutation);
    Object.assign(options, { enabled: false, isolated: false, processor: "inactive",
      activation: { ownerId: null, grantId: null, scope: null, historyBinding },
      grant: { version: 2, status: "revoked" } });
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await current.raw("PATCH", identity), unresolved = await response.json();
      assert.equal(response.status, 409, mutation.action);
      assert.equal(unresolved.ok, false);
      assert.equal(unresolved.operation.status, "unknown");
      assert.equal(unresolved.operation.terminal, false);
      assert.equal(unresolved.readbackConfirmed, false);
      assert.equal(unresolved.externalSend, false);
    }
    Object.assign(options, { enabled: true, isolated: true, processor: "active", activation: {}, grant: { version: 2 } });
    const replay = await current.raw("POST", { ...mutation, ...identity });
    assert.equal(replay.status, 409);
    assert.equal((await replay.json()).operation.status, "unknown");
    assert.equal(current.calls.filter(call => /_register$|_capture$|_review$/u.test(call.operation)).length, 1);
  }
});

test("lost register, capture and review writes recover across versions of the same active grant", async () => {
  for (const version of [2, 4]) {
    for (const mutation of [
      { ...base, action: "register" }, capture,
      ...["accept", "reject", "withdraw"].map(decision => ({ ...base, action: "review",
        factId: "fact-completion", expectedFactRevision: 0, expectedCompletionBasisHash: completionHash, decision })),
    ]) {
      const options = { writeThrowAfter: true, registered: mutation.action !== "register",
        ...(mutation.action === "review" ? { completion: { status: mutation.decision === "withdraw" ? "accepted" : "pending_review" } } : {}) };
      const current = fixture(options), identity = await lostWrite(current, mutation);
      Object.assign(options, { enabled: false, isolated: false, processor: "inactive",
        activation: { ownerId: null, grantId: null, scope: null, historyBinding },
        grant: { version: version - 1, status: "paused" } });
      assert.equal((await (await current.raw("PATCH", identity)).json()).operation.status, "unknown");
      options.grant = { version, status: "active", source_ids: ["timetable-source", completionSourceId, "new-source"] };
      const response = await current.raw("PATCH", identity), recovered = await response.json();
      assert.equal(response.status, 200, JSON.stringify({ version, mutation, recovered }));
      assert.equal(recovered.operation.status, "committed");
      assert.equal(recovered.operation.terminal, true);
      assert.equal(recovered.entry.grantVersion, version);
      assert.equal(recovered.readbackConfirmed, true);
      assert.deepEqual(await (await current.raw("PATCH", identity)).json(), recovered);
      Object.assign(options, { enabled: true, isolated: true, processor: "active", activation: {} });
      const stale = await current.post(mutation), refused = await stale.json();
      assert.equal(stale.status, 409);
      assert.equal(refused.code, "source_changed");
      assert.equal(refused.operation.status, "not_committed");
      assert.equal(current.calls.filter(call => /_register$|_capture$|_review$/u.test(call.operation)).length, 1);
    }
  }
});

test("cross-version recovery requires the same owner, grant, scope, source basis and authorized sources", async () => {
  for (const change of [
    { ownerId: "other" }, { ownerRoot: sourceBasisHash }, { ownerIdentityRoot: sourceBasisHash },
    { activation: { grantId: "other" } }, { activation: { ownerId: "other" } },
    { grant: { version: 2, scope: { class_id: "other", subject: "math" } } },
    { grant: { version: 2, scope: { class_id: "class-1", subject: "other" } } },
    { grant: { version: 2, domains: ["parent_communication"] } },
    { grant: { version: 2, source_ids: [completionSourceId] } },
    { grant: { version: 2, source_ids: ["timetable-source"] } },
    { readGrantVersion: 1 },
    { occurrence: { source_basis_hash: rootRef } },
    { occurrence: { term_id: "other-term" } },
    { occurrence: { slot_id: "other-slot" } },
  ]) {
    const options = { registered: true, writeThrowAfter: true };
    const current = fixture(options), identity = await lostWrite(current, capture);
    Object.assign(options, { grant: { version: 2 } }, change);
    const response = await current.raw("PATCH", identity), recovered = await response.json();
    assert.equal(recovered.ok, false, JSON.stringify(change));
    assert.notEqual(recovered.operation?.status, "committed", JSON.stringify(change));
    assert.equal(current.index.length, 0);
    assert.equal(current.calls.filter(call => /_register$|_capture$|_review$/u.test(call.operation)).length, 1);
  }
});

test("cross-version recovery cannot confirm a write which never committed or a rolled back grant version", async () => {
  for (const mutation of [
    { ...base, action: "register" }, capture,
    { ...base, action: "review", factId: "fact-completion", expectedFactRevision: 0,
      expectedCompletionBasisHash: completionHash, decision: "accept" },
  ]) {
    const options = { writeThrow: true, registered: mutation.action !== "register",
      ...(mutation.action === "review" ? { completion: {} } : {}) };
    const current = fixture(options), identity = await lostWrite(current, mutation);
    options.grant = { version: 2 };
    const recovered = await (await current.raw("PATCH", identity)).json();
    assert.equal(recovered.operation.status, "unknown");
    assert.equal(recovered.operation.terminal, false);
    assert.equal(current.calls.filter(call => /_register$|_capture$|_review$/u.test(call.operation)).length, 1);
  }
  const options = { grant: { version: 2 }, writeThrowAfter: true };
  const current = fixture(options), identity = await lostWrite(current, { ...base, action: "register", expectedGrantVersion: 2 });
  options.grant = { version: 1 };
  assert.equal((await (await current.raw("PATCH", identity)).json()).operation.status, "unknown");
});

test("cross-version review recovery requires exact persisted history, not just a changed completion hash", async () => {
  for (const changes of [
    { fact_id: "other-fact" }, { lesson_id: "other-lesson" }, { term_id: "other-term" },
    { slot_id: null }, { observation_id: "other-observation" }, { revision: 2 },
    { source_revision: "other" }, { raw_text: `其他内容 ${completedAt}` },
    { last_review: { action: "modify", reviewed_at: completedAt } },
    { last_review: { action: "reject", reviewed_at: completedAt } },
  ]) {
    const options = { registered: true, completion: {}, writeThrowAfter: true };
    const current = fixture(options), identity = await lostWrite(current, { ...base, action: "review",
      factId: "fact-completion", expectedFactRevision: 0, expectedCompletionBasisHash: completionHash, decision: "accept" });
    Object.assign(options, { grant: { version: 2 }, historyResponse: historyResponse([historyEntry({
      revision: 1, status: "accepted", last_review: { action: "accept", reviewed_at: completedAt }, ...changes,
    })]) });
    const indexedBefore = current.index.length;
    assert.equal((await (await current.raw("PATCH", identity)).json()).operation.status, "unknown", JSON.stringify(changes));
    assert.equal(current.index.length, indexedBefore);
  }
});

test("recovery rechecks the current authorization and history before recording a committed receipt", async () => {
  for (const change of ["grant", "history"]) {
    const options = { registered: true, writeThrowAfter: true };
    const current = fixture(options), identity = await lostWrite(current, capture);
    options.grant = { version: 2 };
    let reads = 0;
    if (change === "grant") options.onCall = operation => {
      if (operation === "owner_read" && ++reads === 2) options.grant = { version: 3 };
    };
    else options.historyResponse = () => historyResponse([historyEntry()],
      { snapshot_hash: ++reads === 1 ? sourceBasisHash : rootRef });
    assert.equal((await (await current.raw("PATCH", identity)).json()).operation.status, "unknown", change);
    assert.equal(current.index.length, 0);
    delete options.onCall;
    delete options.historyResponse;
    assert.equal((await (await current.raw("PATCH", identity)).json()).operation.status, "committed");
    assert.equal(current.index.length, 1);
    assert.equal(current.calls.filter(call => /_register$|_capture$|_review$/u.test(call.operation)).length, 1);
  }
});

test("recovery leaves unknown when source, revision, history or exact capture evidence is inconclusive", async () => {
  for (const options of [
    { historyResponse: historyResponse([]) },
    { historyResponse: { ok: false, error_code: "history_changed" } },
    { historyResponse: historyResponse([historyEntry(), historyEntry({ fact_id: "fact-other" })]) },
    { capturedCompletion: { source_revision: "other" } },
    { capturedCompletion: { raw_text: `别的内容 ${completedAt}` } },
    { readbackFail: true },
  ]) {
    const current = fixture({ ...options, registered: true, writeThrowAfter: true });
    const identity = await lostWrite(current, capture), resolved = await (await current.raw("PATCH", identity)).json();
    assert.equal(resolved.operation.status, "unknown", JSON.stringify(options));
    assert.equal(resolved.operation.terminal, false);
  }
  const options = { writeThrowAfter: true }, current = fixture(options);
  const identity = await lostWrite(current, { ...base, action: "register" });
  options.occurrence = { source_basis_hash: rootRef };
  assert.equal((await (await current.raw("PATCH", identity)).json()).operation.status, "unknown");
  const incomplete = fixture({ writeThrowAfter: true, registrationSelectionMissing: true });
  const incompleteIdentity = await lostWrite(incomplete, { ...base, action: "register" });
  assert.equal((await (await incomplete.raw("PATCH", incompleteIdentity)).json()).operation.status, "unknown");
  const stalled = fixture({ registered: true, writeThrowAfter: true, reviewRevisionStalled: true, completion: {} });
  const stalledIdentity = await lostWrite(stalled, { ...base, action: "review", factId: "fact-completion",
    expectedFactRevision: 0, expectedCompletionBasisHash: completionHash, decision: "accept" });
  assert.equal((await (await stalled.raw("PATCH", stalledIdentity)).json()).operation.status, "unknown");
});

test("recovery performs bounded history scans and rejects snapshot changes across pages", async () => {
  for (const changed of [false, true]) {
    let calls = 0;
    const options = { registered: true, writeThrowAfter: true, historyResponse: () => {
      calls++;
      const entry = historyEntry({ fact_id: `fact-page-${calls}`, source_revision: "unrelated" });
      const snapshot = changed && calls > 1 ? rootRef : sourceBasisHash;
      const cursor = Buffer.from(JSON.stringify({ version: 1, snapshot_hash: snapshot, after: entry.fact_id })).toString("base64url");
      return historyResponse([entry], { next_cursor: cursor, snapshot_hash: snapshot });
    } };
    const current = fixture(options), identity = await lostWrite(current, capture);
    assert.equal((await (await current.raw("PATCH", identity)).json()).operation.status, "unknown");
    assert.equal(calls, changed ? 2 : 10);
  }
});

test("content capture, review, GET and history preserve raw evidence independently from completion", async () => {
  for (const decision of ["accept", "reject"]) {
    const current = fixture({ registered: true, completion: {} });
    const capturedResponse = await current.post(contentCapture), captured = await capturedResponse.json();
    assert.equal(capturedResponse.status, 200, JSON.stringify(captured));
    assert.equal(captured.entry.content.rawText, contentCapture.rawText);
    assert.equal(captured.entry.content.predicate, contentCapture.predicate);
    assert.equal(captured.result.content.value, contentValue(contentCapture.rawText));
    assert.deepEqual(captured.entry.contentSourceIds, [contentSourceId]);
    const reviewed = await (await current.post({ ...base, action: "contentReview", factId: "fact-content",
      expectedFactRevision: 0, expectedContentBasisHash: completionHash, decision })).json();
    assert.equal(reviewed.readbackConfirmed, true, JSON.stringify(reviewed));
    assert.equal(reviewed.entry.content.status, decision === "accept" ? "accepted" : "rejected");
    const list = await (await current.get()).json();
    assert.equal(list.entries.find(item => item.content)?.content.status, reviewed.entry.content.status);
    assert.equal(list.entries.find(item => item.completion)?.completion.status, "pending_review");
    const selected = await (await current.get(`date=${date}&slotId=slot-1&content=true&factId=fact-content`)).json();
    assert.equal(selected.entries[0].content.factId, "fact-content");
    const history = await (await current.get("history=true&content=true")).json();
    assert.equal(history.content, true);
    assert.equal(history.entries[0].raw_text, contentCapture.rawText);
    assert.equal(history.entries[0].last_review.action, decision);
    assert.equal(Object.hasOwn(history.entries[0], "completed_at"), false);
    assert.equal(current.index.length, 0);
    assert.equal(current.calls.filter(call => call.operation === "owner_reflection_completion_review").length, 0);
  }
});

test("content refuses malformed evidence, stale CAS, completion sources and unauthorized requests before writes", async () => {
  for (const mutation of [
    { ...contentCapture, predicate: "lesson.completed" },
    { ...contentCapture, rawText: " \n\t " }, { ...contentCapture, rawText: "bad\u0001text" },
    { ...contentCapture, rawText: "x".repeat(4001) }, { ...contentCapture, completedAt },
    { ...contentCapture, sourceRevision: " 1 " },
    { ...base, action: "contentReview", factId: "fact-content", expectedFactRevision: 0,
      expectedContentBasisHash: completionHash, decision: "withdraw" },
  ]) {
    const current = fixture({ registered: true, content: {} });
    assert.equal((await current.post(mutation)).status, 400, JSON.stringify(mutation));
    assert.equal(current.calls.some(call => writes.includes(call.operation)), false);
  }
  for (const [options, mutation] of [
    [{}, { ...contentCapture, sourceId: completionSourceId }],
    [{}, { ...contentCapture, sourceId: "timetable-source" }],
    [{}, { ...contentCapture, sourceId: "foreign" }],
    [{}, { ...contentCapture, expectedGrantVersion: 2 }],
    [{}, { ...contentCapture, expectedSourceBasisHash: rootRef }],
    [{ allowed: false }, contentCapture], [{ enabled: false }, contentCapture],
    [{ isolated: false }, contentCapture], [{ grant: { status: "paused" } }, contentCapture],
  ]) {
    const current = fixture({ registered: true, ...options });
    assert.ok((await current.post(mutation)).status >= 400);
    assert.equal(current.calls.some(call => writes.includes(call.operation)), false);
  }
});

test("content lost acknowledgements recover only through repeated authoritative reads", async () => {
  for (const mutation of [contentCapture, ...["accept", "reject"].map(decision => ({ ...base,
    action: "contentReview", factId: "fact-content", expectedFactRevision: 0, expectedContentBasisHash: completionHash, decision }))]) {
    const options = { registered: true, writeThrowAfter: true, ...(mutation.action === "contentReview" ? { content: {} } : {}) };
    const current = fixture(options), identity = await lostWrite(current, mutation);
    const recovered = await (await current.raw("PATCH", identity)).json();
    assert.equal(recovered.operation.status, "committed", JSON.stringify(recovered));
    assert.equal(recovered.entry.content.factId, "fact-content");
    assert.equal(recovered.readbackConfirmed, true);
    assert.deepEqual(await (await current.raw("PATCH", identity)).json(), recovered);
    assert.equal(current.calls.filter(call => writes.includes(call.operation)).length, 1);
    assert.equal(current.index.length, 0);
  }
});

test("content recovery keeps unknown for mismatched or absent exact evidence", async () => {
  for (const changes of [
    { contentHistoryResponse: historyResponse([]) },
    { capturedContent: { predicate: "lesson.feedback" } },
    { capturedContent: { raw_text: "其他内容", value: "其他内容" } },
    { capturedContent: { source_revision: "2" } },
    { capturedContent: { value: "未对应原文" } },
    { readbackFail: true },
  ]) {
    const current = fixture({ registered: true, writeThrowAfter: true, ...changes });
    const identity = await lostWrite(current, contentCapture);
    const recovered = await (await current.raw("PATCH", identity)).json();
    assert.notEqual(recovered.operation?.status, "committed", JSON.stringify(changes));
    assert.equal(current.calls.filter(call => writes.includes(call.operation)).length, 1);
  }
});

test("content history validates shape, order, source authorization and cursor binding", async () => {
  for (const entries of [
    [contentHistoryEntry({ value: "wrong" })],
    [{ ...contentHistoryEntry(), completed_at: completedAt }],
    [contentHistoryEntry({ source_id: "foreign" })],
    [contentHistoryEntry({ predicate: "lesson.completed" })],
    [contentHistoryEntry({ fact_id: "fact-z" }), contentHistoryEntry({ fact_id: "fact-a" })],
    [contentHistoryEntry(), contentHistoryEntry({ fact_id: "fact-new", date: "2026-11-11" })],
  ]) {
    const current = fixture({ contentHistoryResponse: historyResponse(entries) });
    assert.equal((await current.get("history=true&content=true")).status, 503);
    assert.equal(current.calls.some(call => writes.includes(call.operation)), false);
  }
  const current = fixture({ enabled: false, isolated: false, processor: "inactive",
    activation: { historyBinding }, grant: { status: "paused" }, content: {} });
  const response = await current.get("history=true&content=true");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).entries[0].fact_id, "fact-content");
  assert.equal((await current.get("history=true&content=false")).status, 400);
  assert.equal((await current.get("history=true&content=true&content=true")).status, 400);
});

test("content reads and capture preserve all five predicates with exact Core payloads", async () => {
  for (const predicate of ["lesson.observation", "lesson.feedback", "lesson.statistic", "lesson.outcome", "lesson.review"]) {
    const sourceId = sourceFor(contentCapture.rawText, predicate);
    const current = fixture({ registered: true, grant: { source_ids: ["timetable-source", completionSourceId, sourceId] } });
    const mutation = { ...contentCapture, predicate, sourceId };
    const result = await (await current.post(mutation)).json();
    assert.equal(result.ok, true, JSON.stringify(result));
    const payload = current.calls.find(call => call.operation === "owner_reflection_content_capture").payload;
    assert.deepEqual(payload, { root_ref: rootRef, expected_owner_id: "owner-1", grant_id: "grant-reflection",
      class_id: "class-1", subject: "math", date, slot_id: "slot-1", expected_source_basis_hash: sourceBasisHash,
      expected_grant_version: 1, source_id: sourceId, source_revision: "1", raw_text: contentCapture.rawText, predicate });
    assert.equal((await (await current.get()).json()).entries.find(item => item.content)?.content.predicate, predicate);
  }
});

test("content recovery retains stopped history binding and never bypasses a paused or changed grant", async () => {
  for (const mutation of [contentCapture, { ...base, action: "contentReview", factId: "fact-content",
    expectedFactRevision: 0, expectedContentBasisHash: completionHash, decision: "accept" }]) {
    const options = { registered: true, writeThrowAfter: true, ...(mutation.action === "contentReview" ? { content: {} } : {}) };
    const current = fixture(options), identity = await lostWrite(current, mutation);
    Object.assign(options, { enabled: false, isolated: false, processor: "inactive",
      activation: { ownerId: null, grantId: null, scope: null, historyBinding },
      grant: { version: 2, status: "paused" } });
    assert.equal((await (await current.raw("PATCH", identity)).json()).operation.status, "unknown");
    options.grant = { version: 3, source_ids: ["timetable-source", completionSourceId] };
    assert.notEqual((await (await current.raw("PATCH", identity)).json()).operation?.status, "committed");
    options.grant = { version: 3 };
    const recovered = await (await current.raw("PATCH", identity)).json();
    assert.equal(recovered.operation.status, "committed", JSON.stringify(recovered));
    assert.equal(recovered.entry.grantVersion, 3);
    assert.equal(current.calls.filter(call => writes.includes(call.operation)).length, 1);
  }
});

test("content readback mismatch or invalid proof never yields committed receipt", async () => {
  for (const options of [
    { readbackMismatch: true }, { capturedContent: { value: "unrelated" } },
    { capturedContent: { predicate: "lesson.completed" } }, { capturedContent: { completed_at: completedAt } },
    { capturedContent: { observation_id: "bad observation" } }, { writeHeld: true }, { writeThrow: true },
  ]) {
    const current = fixture({ registered: true, ...options }), response = await current.post(contentCapture);
    const result = await response.json();
    assert.equal(result.ok, false, JSON.stringify(options));
    assert.notEqual(result.operation?.status, "committed");
    assert.equal(current.calls.filter(call => writes.includes(call.operation)).length, 1);
  }
  const current = fixture({ registered: true, content: {} });
  const stale = await current.post({ ...base, action: "contentReview", factId: "fact-content",
    expectedFactRevision: 1, expectedContentBasisHash: completionHash, decision: "accept" });
  assert.equal((await stale.json()).code, "source_changed");
  assert.equal(current.calls.some(call => writes.includes(call.operation)), false);
});

test("content history supports bounded pagination and rejects cursor snapshot mismatch", async () => {
  const item = contentHistoryEntry();
  const cursor = Buffer.from(JSON.stringify({ version: 1, snapshot_hash: sourceBasisHash, after: item.fact_id })).toString("base64url");
  const current = fixture({ contentHistoryResponse: historyResponse([item], { next_cursor: cursor }) });
  const first = await current.get(`history=true&content=true&date=${date}&slotId=slot-1&pageSize=1`);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).nextCursor, cursor);
  assert.equal((await current.get(`history=true&content=true&cursor=${cursor}`)).status, 503);
  const invalid = fixture({ contentHistoryResponse: historyResponse([item], {
    next_cursor: Buffer.from(JSON.stringify({ version: 1, snapshot_hash: rootRef, after: item.fact_id })).toString("base64url") }) });
  assert.equal((await invalid.get("history=true&content=true")).status, 503);
  let pages = 0;
  const bounded = fixture({ contentHistoryResponse: () => {
    const entry = contentHistoryEntry({ fact_id: `fact-page-${++pages}`, status: "superseded" });
    return historyResponse([entry], { next_cursor: Buffer.from(JSON.stringify({
      version: 1, snapshot_hash: sourceBasisHash, after: entry.fact_id })).toString("base64url") });
  } });
  const result = await (await bounded.get()).json();
  assert.equal(result.code, "content_limit");
  assert.equal(pages, 10);
});
