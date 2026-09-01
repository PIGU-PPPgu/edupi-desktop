import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const memoryUpdate = await createJiti(import.meta.url).import("./edupi-memory-update.ts");
const commands = ["review_observation", "review_memory_candidate", "review_teacher_context", "review_work_candidate", "review_task", "import_calendar", "import_timetable", "intake_material", "create_task", "move_task_stage", "update_memory"];

function payload(content = "称呼我为吴老师", revision = 0) {
  return {
    snapshot_id: `snapshot-${revision}`,
    state_hash: `sha256:state-${revision}`,
    capabilities: { supported_commands: commands },
    education_workspace: { continuity: { memories: [{ memory_id: "pref-1", category: "preferences", content, student: null, tags: ["称呼"], count: 1, created_at: null, updated_at: null, state: "active", revision }] } },
  };
}

test("builds a direct Core memory update without opening Agent collaboration", () => {
  const envelope = memoryUpdate.buildMemoryUpdateCommandEnvelope({ memoryId: "pref-1", expectedRevision: 0, content: "称呼我为吴老师，教授七年级数学", payload: payload(), issuedAt: "2026-09-01T02:00:00.000Z" });
  assert.equal(envelope.command.command_type, "update_memory");
  assert.equal(envelope.command.memory_id, "pref-1");
  assert.equal(envelope.command.expected_revision, 0);
  assert.equal(envelope.command.content, "称呼我为吴老师，教授七年级数学");
  assert.equal(envelope.command.source.source_kind, "core_memory");
  assert.equal(envelope.command.source.source_hash, "sha256:state-0");
  assert.equal(envelope.teacher_review.state, "modified");
  assert.equal(envelope.external_send, false);
});

test("accepts only a receipt-bound refreshed memory revision", async () => {
  let sent;
  const result = await memoryUpdate.issueMemoryUpdate({ memoryId: "pref-1", expectedRevision: 0, content: "称呼我为吴老师，教授七年级数学", issuedAt: "2026-09-01T02:00:00.000Z" }, {
    supportedCommands: commands,
    readSnapshot: async () => ({ payload: payload(), roots: { runtime: {}, dataRoot: {} } }),
    dispatch: async (envelope) => {
      sent = envelope;
      return { ok: true, operation: "command", request_id: envelope.request_id, supported_commands: commands, supported_projections: ["education_workspace"], receipt: {
        contract_version: envelope.contract_version,
        message_id: "receipt-memory-update",
        request_id: envelope.request_id,
        issued_at: envelope.issued_at,
        producer: "edupi-core",
        schema_hash: envelope.schema_hash,
        snapshot_id: "snapshot-1",
        provenance: envelope.provenance,
        teacher_review: { state: "modified", reviewer_id: "teacher", reviewed_at: envelope.issued_at, note: null, revision: 1 },
        external_send: false,
        payload: { receipt_id: "receipt-memory-update", command_id: envelope.message_id, request_id: envelope.request_id, command_type: "update_memory", target: { target_kind: "memory", target_id: "pref-1", command_type: "update_memory" }, receipt_phase: "mutation", decision: "modify", status: "modified", applied_ids: ["pref-1"], rejected_ids: [], reason_code: null, evidence_ids: ["pref-1"], before_snapshot_id: "snapshot-0", after_snapshot_id: "snapshot-1", before_state_hash: "sha256:state-0", after_state_hash: "sha256:state-1", teacher_review: { state: "modified", reviewer_id: "teacher", reviewed_at: envelope.issued_at, note: null, revision: 1 }, external_send: false, rollback: { available: false, rollback_id: null, expires_at: null }, preview_token: null, action_authorization: null, created_at: envelope.issued_at },
      } };
    },
    refreshSnapshot: async () => payload("称呼我为吴老师，教授七年级数学", 1),
  });
  assert.equal(sent.command.command_type, "update_memory");
  assert.equal(result.memory.content, "称呼我为吴老师，教授七年级数学");
  assert.equal(result.memory.revision, 1);
});

test("rejects stale manual edits before dispatch", async () => {
  await assert.rejects(memoryUpdate.issueMemoryUpdate({ memoryId: "pref-1", expectedRevision: 0, content: "旧页面修改" }, {
    supportedCommands: commands,
    readSnapshot: async () => ({ payload: payload("新内容", 1), roots: { runtime: {}, dataRoot: {} } }),
    dispatch() { throw new Error("must not dispatch"); },
  }), (error) => error?.code === "stale_revision");
});
