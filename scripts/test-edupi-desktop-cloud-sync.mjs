// Run against the existing cloud with an injected public key. This creates and
// removes its own account/workspace; no teacher data or credentials are logged.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createEduPiCloudClient } from "../lib/edupi-cloud-client.ts";
import { EDUPI_CLOUD_BRIDGE_CONTRACT } from "../lib/edupi-cloud-writer-contract.ts";

const url = process.env.SUPABASE_URL || "https://edupi.intelliclass.online";
const key = process.env.SUPABASE_ANON_KEY;
if (!key) throw new Error("SUPABASE_ANON_KEY must be injected securely");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-desktop-cloud-e2-"));
const email = `desktop-cloud-${randomUUID()}@example.invalid`;
const password = `${randomUUID()}Aa!`;
const suffix = randomUUID();
const workspaceIds = [];
const extraUserIds = [];
const storageKeys = [];
let userId;
let offline = false;
const env = { SUPABASE_URL: url, SUPABASE_ANON_KEY: key, PI_DESKTOP_STATE_DIR: root };
const pass = label => console.log(`PASS ${label}`);

async function request(endpoint, body, token, workspaceId) {
  const response = await fetch(`${url}${endpoint}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { apikey: key, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(workspaceId ? { "x-edupi-workspace-id": workspaceId } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20_000), redirect: "error",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`cloud fixture request failed (${response.status})`);
  return data;
}
const source = id => ({ source_id: `test-${id}`, source_kind: "teacher_message", source_hash: `sha256:${"a".repeat(64)}`, evidence_ids: [] });
const task = id => ({ command_type: "create_task", source: source(id),
  task: { task_id: id, title: "隔离云端同步验收", due_date: null, note: "测试后清理" } });

try {
  const client = createEduPiCloudClient({ env, fetchImpl: (...args) => {
    if (offline) return Promise.reject(new TypeError("isolated offline transport"));
    return fetch(...args);
  } });
  assert.equal((await client.state()).mode, "local");
  assert.equal(fs.existsSync(path.join(root, "cloud")), false);
  pass("local-default-without-login-or-network");
  const signup = await request("/auth/v1/signup", { email, password });
  userId = signup.user.id;
  const provision = await request("/functions/v1/edupi-account", {
    action: "create_workspace", mode: "cloud", request_id: `desktop-e2-${suffix}`,
  }, signup.access_token);
  const workspaceId = provision.workspace_id;
  workspaceIds.push(workspaceId);
  assert.match(workspaceId, /^[0-9a-f-]{36}$/u);
  await client.login(email, password);
  assert.equal((await client.state()).workspaceId, null);
  await client.selectWorkspace(workspaceId);
  assert.equal((await client.state()).workspaceId, workspaceId);
  pass("desktop-auth-explicit-workspace");
  const dashboard = await client.dashboard();
  assert.equal(dashboard.payload.workspace_id, workspaceId);
  for (const field of ["tasks", "students", "calendar", "timetable"]) assert.ok(Array.isArray(dashboard.payload[field]));
  pass("desktop-versioned-dashboard-and-four-collections");
  const id = `desktop-e2-${suffix}`;
  const create = await client.taskCommand(task(id), { requestId: `create-${suffix}`, idempotencyKey: `create-${suffix}` });
  assert.equal(create.queued, false);
  assert.equal(create.result.receipt.payload.target.target_id, id);
  const move = await client.taskCommand({ command_type: "move_task_stage", source: source(id),
    task_id: id, expected_revision: 0, to_stage: "progress", note: null,
  }, { requestId: `move-${suffix}`, idempotencyKey: `move-${suffix}` });
  assert.equal(move.queued, false);
  assert.equal((await client.snapshot()).payload.tasks.find(row => row.task_id === id).stage, "progress");
  pass("desktop-task-create-move-and-durable-readback");
  const peerRoot = path.join(root, "peer");
  const peer = createEduPiCloudClient({ env: { ...env, PI_DESKTOP_STATE_DIR: peerRoot } });
  await peer.login(email, password);
  await peer.selectWorkspace(workspaceId);
  assert.equal((await peer.dashboard()).payload.tasks.find(row => row.task_id === id).stage, "progress");
  pass("independent-client-reads-desktop-task-through-mobile-dashboard");

  const factId = `fact-${suffix}`;
  const capture = await client.operationWithOutbox("education-facts", {
    action: "capture", request_id: `capture-${suffix}`, fact_id: factId, entity_id: "synthetic-student",
    fact_kind: "academic", predicate: "验收", value: "隔离事实", confidence: { basis: "explicit", score: 1 },
    source_ids: [], observation_ids: [], conflict_ids: [], external_send: false,
  });
  assert.equal(capture.queued, false);
  let revision = 0;
  for (const action of ["modify", "delete", "restore"]) {
    const result = await client.operationWithOutbox("education-facts", {
      action, request_id: `${action}-${suffix}`, fact_id: factId, expected_revision: revision,
      reviewer: "synthetic-teacher", ...(action === "modify" ? { replacement_value: "隔离修订事实" } : {}), external_send: false,
    });
    assert.equal(result.queued, false);
    revision++;
  }
  assert.equal((await peer.operation("education-facts", { action: "read", fact_id: factId })).fact.value, "隔离修订事实");
  pass("desktop-fact-capture-modify-delete-restore-and-peer-readback");

  // Provision only the fixture through the existing broker. Desktop staging /
  // Storage upload is a separate, still-unverified product flow.
  const materialId = `material-${suffix}`;
  const materialRequest = `fixture-material-${suffix}`;
  const snapshot = await client.snapshot();
  await request("/functions/v1/edupi-core-broker", {
    operation: "command", envelope: {
      contract_version: EDUPI_CLOUD_BRIDGE_CONTRACT.contract_version,
      schema_hash: EDUPI_CLOUD_BRIDGE_CONTRACT.schema_hash,
      message_id: materialRequest, request_id: materialRequest, idempotency_key: materialRequest,
      snapshot_id: snapshot.snapshot_id, issued_at: new Date().toISOString(),
      producer: "edupi-desktop", external_send: false,
      command: { command_type: "intake_material", source: source(materialId), material: {
        material_id: materialId, title: "隔离材料", kind: "worksheet", subject: "数学", class_id: "synthetic-class",
        relative_path: `cloud-fixture/${materialId}.txt`, source_hash: `sha256:${"c".repeat(64)}`,
      } },
    },
  }, (await client.state()).session.accessToken, workspaceId);
  const metadata = await client.operationWithOutbox("material-metadata", {
    action: "update", request_id: `metadata-${suffix}`, material_id: materialId, expected_revision: 0,
    patch: { title: "隔离材料修订", class_id: "synthetic-class-two" }, external_send: false,
  });
  assert.equal(metadata.queued, false);
  assert.equal((await peer.snapshot()).payload.materials.find(row => row.material_id === materialId).title, "隔离材料修订");
  const restored = await client.operationWithOutbox("material-metadata", {
    action: "restore", request_id: `metadata-restore-${suffix}`, material_id: materialId,
    expected_revision: 1, version_id: metadata.result.version_id, version_side: "before", external_send: false,
  });
  assert.equal(restored.queued, false);
  assert.equal((await peer.snapshot()).payload.materials.find(row => row.material_id === materialId).class_id, "synthetic-class");
  pass("desktop-material-metadata-edit-history-restore-and-peer-readback");

  const calendarCommand = {
    command_type: "import_calendar",
    source: { source_id: `desktop-calendar-${suffix}`, source_kind: "teacher_message",
      source_hash: `sha256:${"d".repeat(64)}`, evidence_ids: [`calendar-evidence-${suffix}`] },
    events: [{ event_id: `calendar-event-${suffix}`, date: "2026-11-24", end_date: null,
      name: "云端阶段测验", type: "exam", confidence: "teacher_confirmed", notes: null }],
  };
  const calendarResult = await client.intakeCommand(calendarCommand, {
    requestId: `calendar-intake-${suffix}`, idempotencyKey: `calendar-intake-${suffix}`,
  });
  assert.equal(calendarResult.queued, false);
  const timetableCommand = {
    command_type: "import_timetable",
    source: { source_id: `desktop-timetable-${suffix}`, source_kind: "teacher_message",
      source_hash: `sha256:${"e".repeat(64)}`, evidence_ids: [`timetable-evidence-${suffix}`] },
    slots: [{ slot_id: `slot-${suffix}`, day_of_week: 1, period: 1, subject: "数学",
      class_name: "synthetic-class", kind: "class", notes: null }],
  };
  const timetableResult = await client.intakeCommand(timetableCommand, {
    requestId: `timetable-intake-${suffix}`, idempotencyKey: `timetable-intake-${suffix}`,
  });
  assert.equal(timetableResult.queued, false);
  const scheduleSnapshot = await peer.snapshot();
  assert.ok(scheduleSnapshot.payload.calendar.some(row => row.event_id === `calendar-event-${suffix}`));
  assert.ok(scheduleSnapshot.payload.timetable.some(row => row.slot_id === `slot-${suffix}`));
  pass("desktop-cloud-calendar-and-timetable-import-readback");

  const uploadedMaterialId = `material-upload-${suffix}`;
  const uploadedBytes = Buffer.from("desktop cloud binary material\n", "utf8");
  const uploadedHash = `sha256:${createHash("sha256").update(uploadedBytes).digest("hex")}`;
  const uploaded = await client.uploadMaterial({
    materialId: uploadedMaterialId,
    fileName: "desktop-upload.txt",
    contentType: "text/plain",
    sizeBytes: uploadedBytes.byteLength,
    sha256: uploadedHash,
    bytes: uploadedBytes,
  });
  storageKeys.push(uploaded.objectKey);
  const uploadedCommand = {
    command_type: "intake_material",
    source: { source_id: `desktop-upload-source-${suffix}`, source_kind: "teacher_file",
      source_hash: uploadedHash, evidence_ids: [`desktop-upload-evidence-${suffix}`] },
    material: {
      material_id: uploadedMaterialId, staging_id: `stg_${"a".repeat(32)}`,
      staging_path: "/private/local/path/desktop-upload.txt", source_path: null,
      source_hash: uploadedHash, expected_size_bytes: uploadedBytes.byteLength,
      kind: "worksheet", title: "桌面云端二进制材料", subject: "数学", class_id: "synthetic-class",
      source_scope: "desktop_staging",
    },
  };
  const uploadedReceipt = await client.intakeCommand(uploadedCommand, {
    requestId: `desktop-upload-intake-${suffix}`,
    idempotencyKey: `sha256:${uploadedHash.slice("sha256:".length)}`,
    storageObjectKey: uploaded.objectKey,
  });
  assert.equal(uploadedReceipt.queued, false);
  const uploadedRow = (await peer.snapshot()).payload.materials.find(row => row.material_id === uploadedMaterialId);
  assert.equal(uploadedRow.storage_object_key, uploaded.objectKey);
  assert.equal(uploadedRow.source_hash, uploadedHash);
  const downloaded = await fetch(`${url}/storage/v1/object/edupi-materials/${uploaded.objectKey.split("/").map(encodeURIComponent).join("/")}`, {
    headers: { apikey: key, Authorization: `Bearer ${(await client.state()).session.accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(downloaded.status, 200);
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), uploadedBytes);
  pass("desktop-staging-equivalent-upload-material-intake-and-storage-readback");

  if (process.env.EDUPI_TEST_STORAGE_SECURITY === "1") {
    const token = (await client.state()).session.accessToken;
    const uploadBody = { action: "create_upload", material_id: materialId, file_name: "isolated.txt",
      content_type: "text/plain", size_bytes: 8, sha256: `sha256:${createHash("sha256").update("isolated").digest("hex")}` };
    for (const material_id of ["../other-workspace", "%2e%2e%2fother-workspace", "material/child"]) {
      const denied = await fetch(`${url}/functions/v1/edupi-materials`, {
        method: "POST", headers: { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json",
          "x-edupi-workspace-id": workspaceId }, body: JSON.stringify({ ...uploadBody, material_id }),
        signal: AbortSignal.timeout(15_000),
      });
      assert.equal(denied.status, 400);
    }
    pass("deployed-upload-signer-rejects-path-traversal");
    const upload = await request("/functions/v1/edupi-materials", uploadBody, token, workspaceId);
    storageKeys.push(upload.object_key);
    assert.ok(upload.object_key.startsWith(`${workspaceId}/${materialId}/`));
    const objectPath = upload.object_key.split("/").map(encodeURIComponent).join("/");
    const uploaded = await fetch(`${url}/storage/v1/object/upload/sign/edupi-materials/${objectPath}?token=${encodeURIComponent(upload.token)}`, {
      method: "PUT", headers: { "Content-Type": "text/plain" }, body: "isolated", signal: AbortSignal.timeout(15_000),
    });
    assert.ok(uploaded.ok);
    const member = await request("/auth/v1/signup", { email: `storage-${randomUUID()}@example.invalid`, password: `${randomUUID()}Aa!` });
    extraUserIds.push(member.user.id);
    assert.match(member.user.id, /^[0-9a-f-]{36}$/u);
    assert.match(workspaceId, /^[0-9a-f-]{36}$/u);
    execFileSync("ssh", ["-o", "BatchMode=yes", process.env.EDUPI_REMOTE_HOST || "ubuntu@43.134.4.108",
      "docker exec -i supabase_db_edupi-desktop psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1"], {
      input: `insert into edupi.workspace_members(workspace_id,account_id,role) values('${workspaceId}','${member.user.id}','teacher');\n`,
      stdio: ["pipe", "pipe", "pipe"], timeout: 20_000,
    });
    const memberHeaders = { apikey: key, Authorization: `Bearer ${member.access_token}` };
    const read = () => fetch(`${url}/storage/v1/object/edupi-materials/${objectPath}`, { headers: memberHeaders, signal: AbortSignal.timeout(15_000) });
    assert.equal((await read()).status, 200);
    await request("/functions/v1/edupi-account", { action: "revoke_member", workspace_id: workspaceId,
      target_account: member.user.id, request_id: `revoke-${suffix}` }, token, workspaceId);
    assert.ok([400, 401, 403, 404].includes((await read()).status));
    for (const method of ["POST", "PUT"]) {
      const destination = method === "POST" ? `${objectPath}-denied` : objectPath;
      const denied = await fetch(`${url}/storage/v1/object/edupi-materials/${destination}`, {
        method, headers: { ...memberHeaders, "Content-Type": "text/plain" }, body: "denied",
        signal: AbortSignal.timeout(15_000),
      });
      assert.ok(!denied.ok);
    }
    await fetch(`${url}/storage/v1/object/edupi-materials`, {
      method: "DELETE", headers: { ...memberHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: [upload.object_key] }), signal: AbortSignal.timeout(15_000),
    });
    const ownerRead = await fetch(`${url}/storage/v1/object/edupi-materials/${objectPath}`, {
      headers: { apikey: key, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000),
    });
    assert.equal(ownerRead.status, 200, "revoked member cannot delete the owner's fixture");
    assert.equal(await ownerRead.text(), "isolated");
    pass("storage-http-active-member-read-and-revoked-read-insert-update-delete-denial");
  }

  offline = true;
  const offlineId = `offline-${suffix}`;
  assert.equal((await client.taskCommand(task(offlineId), { requestId: offlineId, idempotencyKey: offlineId })).queued, true);
  assert.equal((await client.outbox()).length, 1);
  offline = false;
  const restarted = createEduPiCloudClient({ env });
  assert.equal((await restarted.state()).workspaceId, workspaceId);
  assert.ok(Object.keys((await restarted.state()).cursors).length > 0);
  assert.deepEqual(await restarted.flushOutbox(), { flushed: 1, pending: 0 });
  await restarted.taskCommand(task(offlineId), { requestId: offlineId, idempotencyKey: offlineId });
  const after = await peer.dashboard();
  assert.equal(after.payload.tasks.filter(row => row.task_id === offlineId).length, 1);
  pass("offline-intent-restart-recovery-cursor-and-no-duplicate");
  await restarted.refresh();
  await restarted.logout();
  assert.equal((await restarted.state()).mode, "local");
  assert.equal((await restarted.state()).session, null);
  pass("refresh-and-logout-return-to-local");
} finally {
  offline = false;
  // Cleanup remains on the server; its service role key never enters Desktop.
  const uuid = /^[0-9a-f-]{36}$/u;
  if (workspaceIds.every(id => typeof id === "string" && uuid.test(id)) && (!userId || uuid.test(userId))
    && extraUserIds.every(id => uuid.test(id)) && storageKeys.every(key => /^[\p{L}\p{N}._/-]+$/u.test(key))) {
    const cleanup = [
      "set -euo pipefail",
      ". /srv/edupi-supabase/.supabase.env",
      ...storageKeys.map(key => `curl -fsS -o /dev/null -X DELETE "$API_URL/storage/v1/object/edupi-materials" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Content-Type: application/json" --data '${JSON.stringify({ prefixes: [key] })}' || true`),
      ...workspaceIds.map(id => `docker exec supabase_db_edupi-desktop psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "delete from edupi.workspaces where id = '${id}';" >/dev/null`),
      ...(userId ? [`curl -fsS -o /dev/null -X DELETE "$API_URL/auth/v1/admin/users/${userId}" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" || true`] : []),
      ...extraUserIds.map(id => `curl -fsS -o /dev/null -X DELETE "$API_URL/auth/v1/admin/users/${id}" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" || true`),
    ].join("\n");
    execFileSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10",
      process.env.EDUPI_REMOTE_HOST || "ubuntu@43.134.4.108", "bash", "-s"], { input: cleanup, stdio: ["pipe", "pipe", "pipe"], timeout: 30_000 });
  } else throw new Error("invalid fixture identity; cleanup requires inspection");
  fs.rmSync(root, { recursive: true, force: true });
  pass("isolated-account-workspace-and-state-cleanup");
}
