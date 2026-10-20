import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { loadTeacherUsageDocuments, teacherUsageDigest } = await jiti.import("./edupi-teacher-usage-documents.ts");
const { TeacherUsageOutbox } = await jiti.import("./edupi-teacher-usage-outbox.ts");
const { validateTeacherUsageRequest } = await jiti.import("./edupi-teacher-usage-service.ts");
const client = await jiti.import("./edupi-teacher-usage.ts");
const hash = `sha256:${"a".repeat(64)}`;
const event = { event_id: "usage-click-1", session_id: "trial-1", domain: "teaching_preparation", scope: { class_id: "class-1", subject: "math" },
  target: { kind: "work_candidate", target_id: "work-1", expected_revision: 2, expected_fingerprint: hash }, action: "draft_opened", surface: "task", occurred_at: "2026-10-20T01:00:00.000Z" };

test("usage request schemas reject raw content, root/owner overrides, invalid times and unbounded fields", () => {
  assert.deepEqual(validateTeacherUsageRequest({ action: "record", event }), { action: "record", event });
  for (const value of [null, [], { action: "record", root_ref: hash, event }, { action: "record", event: { ...event, prompt: "private" } },
    { action: "record", event: { ...event, occurred_at: "2026-02-31T01:00:00.000Z" } },
    { action: "record", event: { ...event, target: { ...event.target, target_id: "x".repeat(301) } } },
    { action: "record", event: { ...event, target: { ...event.target, kind: "missed_opportunity" } } },
    { action: "read", expected_owner_id: "other" }, { action: "read", limit: 101 }, { action: "upload_batch_read", through_revision: -1 },
    { action: "consent_set", command_id: "consent", decision: "accept", at: event.occurred_at, policy_ref: hash, checked: false, viewed: true }]) {
    assert.throws(() => validateTeacherUsageRequest(value), error => error.code === "teacher_usage_invalid_request");
  }
});
test("host registry is unconfigured by default and serves only digest-matched exact UTF-8 bytes", () => {
  assert.deepEqual(loadTeacherUsageDocuments(""), { configured: false, policy_ref: null });
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "desktop-usage-documents-")));
  try {
    const privacy = path.join(root, "privacy.txt"), agreement = path.join(root, "agreement.txt"), registry = path.join(root, "registry.json");
    fs.writeFileSync(privacy, "SYNTHETIC policy fixture only\n"); fs.writeFileSync(agreement, "SYNTHETIC agreement fixture only\n");
    const config = { version: 1, privacy_policy: { version: "fixture-1", file: privacy, sha256: teacherUsageDigest(fs.readFileSync(privacy)) },
      user_agreement: { version: "fixture-1", file: agreement, sha256: teacherUsageDigest(fs.readFileSync(agreement)) } };
    fs.writeFileSync(registry, JSON.stringify(config));
    const docs = loadTeacherUsageDocuments(registry, true);
    assert.equal(docs.configured, true); assert.equal(docs.privacy_policy.text, fs.readFileSync(privacy, "utf8"));
    assert.equal(docs.policy_ref, loadTeacherUsageDocuments(registry).policy_ref);
    assert.equal(loadTeacherUsageDocuments(registry).privacy_policy.text, undefined);
    fs.appendFileSync(privacy, "changed");
    assert.throws(() => loadTeacherUsageDocuments(registry), error => error.code === "usage_documents_invalid");
    fs.writeFileSync(privacy, Buffer.alloc(129 * 1024));
    assert.throws(() => loadTeacherUsageDocuments(registry), error => error.code === "usage_documents_invalid");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test("private outbox separates roots and owners, rejects corruption and caps observations", () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "desktop-usage-outbox-")));
  fs.chmodSync(root, 0o700);
  try {
    const options = { stateDir: root, dataRoot: root, rootRef: hash, ownerId: "owner-1", maxEvents: 1 };
    const box = new TeacherUsageOutbox(options), state = box.read();
    const entry = { id: event.event_id, operation: "teacher_usage_record", input_digest: hash,
      payload: { ...event, root_ref: hash, expected_owner_id: "owner-1", consent_ref: hash }, status: "pending", result: null, reason: null, policy_ref: hash };
    box.add(state, entry);
    assert.deepEqual(new TeacherUsageOutbox(options).read().entries[0], entry);
    if (process.platform !== "win32") assert.equal(fs.statSync(box.file).mode & 0o777, 0o600);
    assert.equal(new TeacherUsageOutbox({ ...options, ownerId: "owner-2" }).read().entries.length, 0);
    assert.equal(new TeacherUsageOutbox({ ...options, rootRef: `sha256:${"b".repeat(64)}` }).read().entries.length, 0);
    const otherOwner = new TeacherUsageOutbox({ ...options, ownerId: "owner-2" });
    const otherRoot = new TeacherUsageOutbox({ ...options, rootRef: `sha256:${"b".repeat(64)}` });
    otherOwner.save(otherOwner.read()); otherRoot.save(otherRoot.read());
    box.eraseOtherOwners();
    assert.equal(fs.existsSync(otherOwner.file), false); assert.equal(fs.existsSync(otherRoot.file), true, "root-wide queue erasure preserves other roots");
    assert.throws(() => box.add(state, { ...entry, id: "usage-2", payload: { ...entry.payload, event_id: "usage-2" } }), error => error.code === "usage_outbox_capacity");
    assert.equal(box.read().entries.length, 1);
    fs.writeFileSync(box.file, "{broken");
    assert.throws(() => box.read(), error => error.code === "usage_outbox_invalid");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test("client passes exact stable event bytes without root, owner or consent and bounds unknown replies", async () => {
  const calls = [];
  const options = { headersProvider: async headers => ({ ...headers, "x-pi-desktop-token": "synthetic" }), fetcher: async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return Response.json({ ok: true, result: { sequence: 1, event_ref: hash, replayed: calls.length > 1, external_send: false } });
  } };
  await client.recordTeacherUsageEvent(event, options); await client.recordTeacherUsageEvent(event, options);
  assert.deepEqual(calls[0], calls[1]); assert.deepEqual(calls[0], { action: "record", event });
  await assert.rejects(client.recordTeacherUsageEvent(event, { ...options, timeoutMs: 5, fetcher: async () => new Promise(() => {}) }), error => error.code === "usage_reply_unknown");
  const prepared = await client.prepareTeacherUsageEvent({ eventId: event.event_id, sessionId: event.session_id, target: { kind: "work_candidate", targetId: "work-1", expectedRevision: 2 }, action: "draft_opened", surface: "task", occurredAt: event.occurred_at },
    { ...options, fetcher: async () => Response.json({ ok: true, result: { event, status: "pending", external_send: false } }) });
  assert.deepEqual(prepared, event);
});
