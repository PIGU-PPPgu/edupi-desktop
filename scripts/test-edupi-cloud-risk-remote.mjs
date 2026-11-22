import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cleanupCloudTest } from "./cleanup-edupi-cloud-test.mjs";

const url = process.env.SUPABASE_URL || "https://edupi.intelliclass.online";
const anon = process.env.SUPABASE_ANON_KEY;
if (!anon) throw new Error("SUPABASE_ANON_KEY must be injected securely");
const email = `cloud-risk-${randomUUID()}@example.invalid`;
const password = `${randomUUID()}Aa!`;
const suffix = randomUUID();
let userId;
let workspaceId;
const contract = {
  contract_id: "edupi-cloud-sync-v1",
  contract_version: "1.0",
  schema_hash: "sha256:2ef7b7849941bc6fd1cb1cff884b9d5ba4f08b8cb83dadaf8968529f3509c197",
};
const pass = label => console.log(`PASS ${label}`);
async function call(path, body, token, workspace = workspaceId) {
  const response = await fetch(`${url}${path}`, {
    method: "POST",
    headers: {
      apikey: anon, Authorization: `Bearer ${token || ""}`, "content-type": "application/json",
      ...(workspace ? { "x-edupi-workspace-id": workspace } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
    redirect: "error",
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}
function expectStatus(label, response, status) {
  assert.equal(response.status, status, `${label}: ${JSON.stringify(response.data)}`);
  pass(label);
}
function expectContract(value) { assert.deepEqual(value.contract, contract); }
try {
  const signup = await call("/auth/v1/signup", { email, password }, null, null);
  expectStatus("risk-auth-signup", signup, 200);
  userId = signup.data.user.id;
  const provision = await call("/functions/v1/edupi-account", {
    action: "create_workspace", mode: "cloud", request_id: `risk-provision-${suffix}`,
  }, signup.data.access_token, null);
  expectStatus("risk-workspace-create", provision, 201);
  workspaceId = provision.data.workspace_id;
  const token = signup.data.access_token;

  const roster = await call("/functions/v1/edupi-students", {
    action: "import", request_id: `risk-student-import-${suffix}`, source_name: "risk.csv",
    students: [{ name: "Risk Student", class_name: "一班", traits: ["合成"], parent_notes: [] }],
  }, token);
  expectStatus("risk-student-import", roster, 200); expectContract(roster.data);
  const student = roster.data.students[0];
  assert.equal(student.name, "Risk Student");
  const replay = await call("/functions/v1/edupi-students", {
    action: "import", request_id: `risk-student-import-${suffix}`, source_name: "risk.csv",
    students: [{ name: "Risk Student", class_name: "一班", traits: ["合成"], parent_notes: [] }],
  }, token);
  expectStatus("risk-student-import-replay", replay, 200); assert.equal(replay.data.replayed, true);
  const update = await call("/functions/v1/edupi-students", {
    action: "update", request_id: `risk-student-update-${suffix}`, expected_revision: student.revision,
    expected_updated_at: student.updated_at,
    student: { student_id: student.student_id, name: student.name, class_name: "二班", traits: ["提问"], parent_notes: ["回读"] },
  }, token);
  expectStatus("risk-student-update-readback", update, 200); expectContract(update.data);
  const history = await call("/functions/v1/edupi-students", {
    action: "history", request_id: `risk-student-history-${suffix}`, student_id: student.student_id,
  }, token);
  expectStatus("risk-student-history", history, 200); assert.equal(history.data.student.class_name, "二班");
  pass("risk-student-write-and-history");

  const taskId = `risk-task-${suffix}`;
  const snapshot = await call("/functions/v1/edupi-core-broker", { operation: "snapshot" }, token);
  expectStatus("risk-snapshot", snapshot, 200);
  const task = await call("/functions/v1/edupi-core-broker", {
    operation: "command", envelope: {
      contract_version: "1.1",
      schema_hash: "sha256:2749b1208b47bf475bd30d266b5ca1b213aa78c6c8b4dcd53059c524400565c8",
      message_id: `risk-task-message-${suffix}`, request_id: `risk-task-request-${suffix}`,
      idempotency_key: `risk-task-key-${suffix}`, snapshot_id: snapshot.data.snapshot_id,
      issued_at: new Date().toISOString(), producer: "edupi-desktop", external_send: false,
      command: { command_type: "create_task", source: { source_id: `risk-source-${suffix}`, source_kind: "teacher_message",
        source_hash: `sha256:${"a".repeat(64)}`, evidence_ids: [] },
        task: { task_id: taskId, title: "Risk task", due_date: null, note: "cleanup" } },
    },
  }, token);
  expectStatus("risk-task-create", task, 200);
  const entityRead = await call("/functions/v1/edupi-entities",
    { action: "read", kind: "task", id: taskId }, token);
  expectStatus("risk-entity-read", entityRead, 200); expectContract(entityRead.data);
  const fingerprint = entityRead.data.state.fingerprint;
  const deleted = await call("/functions/v1/edupi-entities", {
    action: "delete", kind: "task", id: taskId, request_id: `risk-delete-${suffix}`,
    expected_fingerprint: fingerprint, note: "risk cleanup",
  }, token);
  expectStatus("risk-entity-delete", deleted, 200); expectContract(deleted.data);
  const deletedRead = await call("/functions/v1/edupi-entities",
    { action: "read", kind: "task", id: taskId }, token);
  expectStatus("risk-entity-deleted-read", deletedRead, 200);
  assert.equal(deletedRead.data.state.deleted, true);
  const restored = await call("/functions/v1/edupi-entities", {
    action: "restore", kind: "task", id: taskId, request_id: `risk-restore-${suffix}`,
    expected_fingerprint: fingerprint, tombstone_revision: deleted.data.tombstone_revision, note: "risk cleanup",
  }, token);
  expectStatus("risk-entity-restore", restored, 200); expectContract(restored.data);
  pass("risk-entity-delete-restore");

  const sessionId = `cloud-${suffix}`;
  const created = await call("/functions/v1/edupi-sessions", {
    action: "create", session_id: sessionId, request_id: `risk-create-${suffix}`, title: "Risk chat",
    model: null, thinking_level: "off",
  }, token);
  expectStatus("risk-chat-create", created, 200); expectContract(created.data);
  const requestId = `risk-prompt-${suffix}`;
  const queued = await call("/functions/v1/edupi-sessions", {
    action: "enqueue", session_id: sessionId, request_id: requestId,
    command: { type: "mobile_prompt", message: "只返回：已回读", clientRequestId: requestId },
  }, token);
  expectStatus("risk-chat-enqueue", queued, 200); expectContract(queued.data);
  const claim = await call("/functions/v1/edupi-core-runtime", {
    operation: "runtime", action: "register", instance_id: `risk-instance-${suffix}`,
    instance_nonce: `risk-nonce-${suffix}`, core_commit: "risk-test",
  }, token);
  expectStatus("risk-runtime-register", claim, 200);
  const generation = claim.data.fencing_generation;
  const acquired = await call("/functions/v1/edupi-core-runtime", {
    operation: "runtime", action: "lease_acquire", instance_id: `risk-instance-${suffix}`,
    instance_nonce: `risk-nonce-${suffix}`, fencing_generation: generation, lease_name: "cloud-chat",
    ttl_seconds: 60,
  }, token);
  expectStatus("risk-runtime-lease", acquired, 200);
  const proof = { instance_id: `risk-instance-${suffix}`, instance_nonce: `risk-nonce-${suffix}`,
    fencing_generation: generation, lease_name: "cloud-chat", lease_token: acquired.data.lease_token };
  const claimed = await call("/functions/v1/edupi-sessions", { action: "claim", runtime: proof }, token);
  expectStatus("risk-chat-claim", claimed, 200); assert.equal(claimed.data.request.request_id, requestId);
  const assistant = { role: "assistant", content: [{ type: "text", text: "已回读" }], timestamp: Date.now() };
  const complete = await call("/functions/v1/edupi-sessions", {
    action: "complete", session_id: sessionId, request_id: requestId, runtime: proof, message: assistant,
  }, token);
  expectStatus("risk-chat-complete", complete, 200); expectContract(complete.data);
  const read = await call("/functions/v1/edupi-sessions", { action: "read", session_id: sessionId }, token);
  expectStatus("risk-chat-readback", read, 200); assert.equal(read.data.messages.at(-1).message.content[0].text, "已回读");
  pass("risk-chat-queue-claim-complete-readback");
} finally {
  if (userId) cleanupCloudTest(userId, workspaceId);
}
