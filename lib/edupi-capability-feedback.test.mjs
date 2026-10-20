import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

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
