import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const api = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-capability-feedback.ts");
const { TeacherFeedbackError } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-teacher-feedback.ts");
const hash = `sha256:${"a".repeat(64)}`;
const task = { id: "capability_task_123", trigger: "capability_package", status: "accepted", revision: 3,
  reviewedAt: "2026-10-20T00:00:00.000Z", reviewer: "teacher", sourceEventId: "case-1", externalSend: false };
const workCase = { id: "capability_work_123", taskId: task.id, kind: "capability_package", triggerId: "case-1",
  currentState: "accepted", externalSend: false };
const binding = () => api.capabilityFeedbackBinding(task, workCase);
const target = { kind: "capability_work", target_id: workCase.id, revision: 3, fingerprint: hash, status: "accepted",
  domain: "parent_communication", scope: { class_id: "703", subject: "数学" }, evidence_ids: ["source-1"] };

test("capability feedback requires the reviewed task and matching Core work case", () => {
  assert.deepEqual(binding(), { taskId: task.id, workCaseId: workCase.id, revision: 3, decision: "accept", status: "accepted" });
  assert.equal(api.capabilityFeedbackBinding({ ...task, status: "planned" }, workCase), null);
  assert.equal(api.capabilityFeedbackBinding({ ...task, reviewedAt: null }, workCase), null);
  assert.equal(api.capabilityFeedbackBinding(task, { ...workCase, taskId: "other" }), null);
  assert.equal(api.capabilityFeedbackBinding(task, { ...workCase, triggerId: "other" }), null);
  assert.equal(api.capabilityFeedbackBinding(task, { ...workCase, currentState: "held" }), null);
  assert.equal(api.capabilityFeedbackBinding(task, { ...workCase, externalSend: true }), null);
  assert.equal(api.capabilityFeedbackBinding({ ...task, status: "hold" }, { ...workCase, currentState: "held" }).decision, "hold");
});

test("capability feedback derives domain and scope from the current authenticated target", async () => {
  const calls = [];
  const fetcher = async (_url, options) => { calls.push(JSON.parse(options.body)); return Response.json({ ok: true, result: target, externalSend: false }); };
  const capture = await api.prepareCapabilityFeedback(binding(), fetcher, async () => ({ "x-test": "private" }));
  assert.equal(capture.domain, "parent_communication");
  assert.deepEqual(capture.scope, { classId: "703", subject: "数学" });
  assert.deepEqual(capture.evidenceIds, ["source-1"]);
  assert.equal(capture.target.expectedRevision, 3);
  assert.equal(capture.target.expectedFingerprint, hash);
  assert.equal(capture.decision, "accept");
  assert.equal(capture.used, false);
  assert.equal(capture.sessionId, "desktop-capability-feedback");
  assert.deepEqual(calls, [{ action: "target_read", target: { kind: "capability_work", target_id: workCase.id } }]);
  for (const patch of [{ revision: 2 }, { domain: "teaching_preparation" }, { scope: null }, { evidence_ids: [] }, { external_send: true }, { status: "stale" }]) {
    await assert.rejects(api.prepareCapabilityFeedback(binding(), async () => Response.json({ ok: true, result: { ...target, ...patch }, externalSend: false }), async () => ({})), { code: "teacher_feedback_target_stale" });
  }
  await assert.rejects(api.prepareCapabilityFeedback(binding(), async () => Response.json({ ok: true, result: target, externalSend: true }), async () => ({})), { code: "teacher_feedback_target_stale" });
});

test("capability feedback readback is exact to the current target and revision", () => {
  const row = { feedback_id: "feedback-1", session_id: "desktop-capability-feedback", current: true, source_status: "current",
    target: { kind: "capability_work", target_id: workCase.id, revision: 3 } };
  assert.equal(api.currentCapabilityFeedback([row], binding()), row);
  assert.equal(api.currentCapabilityFeedback([{ ...row, current: false }], binding()), null);
  assert.equal(api.currentCapabilityFeedback([{ ...row, source_status: "stale" }], binding()), null);
  assert.equal(api.currentCapabilityFeedback([{ ...row, target: { ...row.target, revision: 2 } }], binding()), null);
});

test("a definitive source change asks for refresh while unknown replies keep the stable retry", () => {
  assert.equal(api.capabilityFeedbackMustRefresh(new TeacherFeedbackError("teacher_feedback_target_stale", "stale")), true);
  assert.equal(api.capabilityFeedbackMustRefresh(new TeacherFeedbackError("teacher_feedback_supersession_invalid", "superseded")), true);
  assert.equal(api.capabilityFeedbackMustRefresh(new TeacherFeedbackError("invalid_feedback_response", "unknown receipt")), false);
  assert.equal(api.capabilityFeedbackMustRefresh(new Error("readback unavailable")), false);
});

test("recorded unverified capability feedback stays distinct from current source proof", () => {
  const row = { feedback_id: `sha256:${"b".repeat(64)}`, session_id: "desktop-capability-feedback", current: true, source_status: "unverified", decision: "accept",
    target: { kind: "capability_work", target_id: workCase.id, revision: 3, status: "accepted" } };
  const before = JSON.stringify(row);
  assert.equal(api.currentCapabilityFeedback([row], binding()), null);
  const stored = api.recordedCapabilityFeedback([row], binding(), row.feedback_id);
  assert.equal(stored.sourceStatus, "unverified");
  assert.equal(stored.record, row);
  assert.equal(JSON.stringify(row), before);
  for (const patch of [
    { source_status: "historical" }, { current: false }, { session_id: "other-session" }, { decision: "reject" },
    { target: { ...row.target, target_id: "other-case" } }, { target: { ...row.target, revision: 2 } }, { target: { ...row.target, status: "rejected" } },
  ]) assert.equal(api.recordedCapabilityFeedback([{ ...row, ...patch }], binding()), null);
  assert.equal(api.recordedCapabilityFeedback([row], binding(), "wrong-feedback-id"), null);
});

test("real Core durable capability feedback preserves its source status without duplicate writes", { skip: !process.env.EDUPI_CORE_ROOT }, async t => {
  const rootPath = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-capability-feedback-read-")));
  let admission;
  t.after(async () => { try { await admission?.release(); } finally { fs.rmSync(rootPath, { recursive: true, force: true }); } });
  const from = name => import(pathToFileURL(path.join(process.env.EDUPI_CORE_ROOT, "scripts", name)).href);
  const { prepareCoreRuntimeRoot } = await from("core_runtime_root.mjs");
  const { acquireCoreRuntimeWriterAdmission } = await from("core_runtime_writer_admission.mjs");
  const { createTeacherFeedbackStore } = await from("teacher_feedback_store.mjs");
  for (const name of ["memory", "output", "locks"]) fs.mkdirSync(path.join(rootPath, ".edupi", name), { recursive: true, mode: 0o700 });
  const root = prepareCoreRuntimeRoot(rootPath);
  admission = await acquireCoreRuntimeWriterAdmission({ root, kind: "legacy_desktop_capability_feedback_read_test", busyTimeoutMs: 250 });
  const owner = { owner_id: "isolated-feedback-owner", root_ref: root.dataRootFingerprint };
  const resolver = request => {
    assert.equal(request.target_id, target.target_id);
    return { ...target, source_ids: ["isolated-case"] };
  };
  const store = createTeacherFeedbackStore({ root, clock: () => "2026-10-20T01:00:00.000Z", resolveTarget: resolver });
  const capture = await api.prepareCapabilityFeedback(binding(), async () => Response.json({ ok: true, result: target, externalSend: false }), async () => ({}));
  const { buildTeacherFeedbackRecord } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-teacher-feedback.ts");
  const command = { ...buildTeacherFeedbackRecord({ ...capture, evidenceLevel: "synthetic", usefulness: "partial", used: false, note: "隔离来源重验回归", occurredAt: "2026-10-20T01:00:00.000Z" }),
    root_ref: owner.root_ref, expected_owner_id: owner.owner_id };
  const receipt = store.record(command, owner);
  const bytes = fs.readFileSync(store.filePath);
  const read = store.read({ root_ref: owner.root_ref, expected_owner_id: owner.owner_id }, owner);
  assert.equal(receipt.current, true);
  assert.equal(read.feedback.length, 1);
  assert.equal(read.feedback[0].current, true);
  const sourceStatus = read.feedback[0].source_status;
  assert.ok(["current", "unverified"].includes(sourceStatus));
  assert.equal(api.currentCapabilityFeedback(read.feedback, binding()), sourceStatus === "current" ? read.feedback[0] : null);
  t.diagnostic(`persisted=${read.feedback.length}, current=${receipt.current}, source_status=${read.feedback[0].source_status}, current_source_samples=${read.summary.real_teacher_current}`);
  const recorded = api.recordedCapabilityFeedback(read.feedback, binding(), receipt.feedback_id);
  assert.equal(recorded.sourceStatus, sourceStatus);
  assert.equal(recorded.record.feedback_id, receipt.feedback_id);
  assert.equal(store.record(command, owner).replayed, true);
  assert.deepEqual(fs.readFileSync(store.filePath), bytes);
  assert.equal(store.read({ root_ref: owner.root_ref, expected_owner_id: owner.owner_id }, owner).feedback.length, 1);
  assert.equal(read.summary.real_teacher_current, 0);
  assert.equal(read.summary.unverified_records, sourceStatus === "unverified" ? 1 : 0);
});
