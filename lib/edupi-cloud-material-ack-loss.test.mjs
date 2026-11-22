import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { createEduPiCloudClient } = await jiti.import("./edupi-cloud-client.ts");
const { stageMaterialInputs, listStagedMaterials } = await jiti.import("./edupi-material-staging.ts");
const { cloudMaterialIntakeIdentity } = await jiti.import("./edupi-cloud-intake.ts");
const account = "11111111-1111-4111-8111-111111111111";
const workspace = "22222222-2222-4222-8222-222222222222";
const materialId = "synthetic-ack-loss-material";
const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

async function fixture(t) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-material-ack-unit-"));
  const previous = process.env.PI_DESKTOP_STATE_DIR;
  process.env.PI_DESKTOP_STATE_DIR = stateDir;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_DESKTOP_STATE_DIR;
    else process.env.PI_DESKTOP_STATE_DIR = previous;
    fs.rmSync(stateDir, { recursive: true, force: true });
  });
  const staging = stageMaterialInputs([{ name: "synthetic.png", mimeType: "image/png", bytes }], { stateDir })[0];
  const objectKey = `${workspace}/${materialId}/${staging.source_hash.slice(7)}-synthetic.png`;
  const remote = { stored: null, material: null, lostAck: false, signCalls: 0, putCalls: 0, envelopes: [], verifyError: null };
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname.startsWith("/auth/v1/token")) return Response.json({
      access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: 3600, user: { id: account },
    });
    if (url.pathname === "/functions/v1/edupi-account") return Response.json({ workspaces: [{ id: workspace, mode: "cloud" }] });
    if (url.pathname.startsWith("/storage/v1/object/upload/sign/")) {
      remote.putCalls++;
      remote.stored = Buffer.from(init.body);
      return new Response(null, { status: 200 });
    }
    const body = JSON.parse(String(init.body));
    if (url.pathname === "/functions/v1/edupi-materials") {
      if (body.action === "create_upload") {
        remote.signCalls++;
        // The deployed signer rejects a second signature for an existing object.
        if (remote.stored) return Response.json({ code: "material_storage_unavailable" }, { status: 503 });
        return Response.json({ object_key: objectKey, token: "synthetic-upload-signature", external_send: false });
      }
      assert.equal(body.action, "verify_upload");
      if (remote.verifyError) return Response.json({ code: remote.verifyError.code }, { status: remote.verifyError.status });
      if (!remote.stored) return Response.json({ code: "material_not_uploaded" }, { status: 409 });
      if (!remote.stored.equals(bytes)) return Response.json({ code: "material_integrity_conflict" }, { status: 409 });
      return Response.json({ object_key: objectKey, verified: true, sha256: staging.source_hash, size_bytes: bytes.length, external_send: false });
    }
    assert.equal(url.pathname, "/functions/v1/edupi-core-broker");
    if (body.operation === "snapshot") return Response.json({
      ok: true, operation: "snapshot", snapshot_id: "synthetic-snapshot", state_hash: `sha256:${"a".repeat(64)}`,
      payload: { workspace_id: workspace, tasks: [], facts: [], materials: remote.material ? [remote.material] : [] }, external_send: false,
    });
    assert.equal(body.operation, "command");
    remote.envelopes.push(JSON.stringify(body.envelope));
    const replayed = Boolean(remote.material);
    remote.material = { material_id: materialId, title: "合成材料", source_hash: staging.source_hash, storage_object_key: objectKey };
    const response = Response.json({
      ok: true, operation: "command", request_id: body.envelope.request_id, replayed, external_send: false,
      receipt: { contract_version: body.envelope.contract_version, schema_hash: body.envelope.schema_hash,
        request_id: body.envelope.request_id, external_send: false, payload: {
          command_id: body.envelope.message_id, request_id: body.envelope.request_id, status: "accepted",
          target: { target_kind: "material_intake", target_id: materialId }, applied_ids: [materialId], rejected_ids: [], external_send: false,
        } },
    });
    if (!remote.lostAck) {
      await response.json();
      remote.lostAck = true;
      throw new TypeError("synthetic ACK loss after committed command");
    }
    return response;
  };
  const env = { PI_DESKTOP_STATE_DIR: stateDir, SUPABASE_URL: "https://material-ack.example.invalid", SUPABASE_ANON_KEY: "synthetic-public-key" };
  const client = createEduPiCloudClient({ env, fetchImpl });
  await client.login("synthetic@example.invalid", "synthetic");
  await client.selectWorkspace(workspace);
  const command = { command_type: "intake_material",
    source: { source_id: staging.staging_id, source_kind: "teacher_file", source_hash: staging.source_hash, evidence_ids: [staging.staging_id] },
    material: { material_id: materialId, title: "合成材料", kind: "other", subject: "数学", class_id: "synthetic-class",
      source_hash: staging.source_hash, expected_size_bytes: bytes.length, staging_id: staging.staging_id,
      staging_path: staging.staging_path, source_path: null, source_scope: "desktop_staging" } };
  const identity = cloudMaterialIntakeIdentity(command);
  const first = await client.uploadMaterial({ materialId, fileName: staging.original_name, contentType: "image/png",
    sizeBytes: bytes.length, sha256: staging.source_hash, bytes, staging, command, ...identity });
  assert.equal(first.queued, true);
  assert.equal(remote.lostAck, true);
  assert.equal((await client.outbox()).length, 1);
  assert.equal(listStagedMaterials({ stateDir }).length, 1);
  return { remote, stateDir, staging, client, identity, restart: () => createEduPiCloudClient({ env, fetchImpl }) };
}

test("a rebuilt material client verifies the existing object before signing and replays the exact durable envelope", async t => {
  const f = await fixture(t);
  const original = JSON.stringify((await f.client.outbox())[0].body.envelope);
  const restarted = f.restart();
  assert.deepEqual(await restarted.flushOutbox(), { flushed: 1, pending: 0 });
  assert.equal(f.remote.signCalls, 1, "an already uploaded object must not require a new signature");
  assert.equal(f.remote.putCalls, 1, "a verified object must not be uploaded again");
  assert.deepEqual(f.remote.envelopes, [original, original]);
  assert.equal((await restarted.outbox()).length, 0);
  assert.equal(listStagedMaterials({ stateDir: f.stateDir }).length, 0);
  const complete = (await restarted.state()).completed;
  assert.equal(complete.length, 1);
  assert.equal(complete[0].result.response.replayed, true);
  assert.equal(complete[0].result.staging_settled, true);
  assert.equal(complete[0].entry.body.request_id, f.identity.requestId);
});

test("changed remote bytes stay in conflict without overwriting the object or settling staging", async t => {
  const f = await fixture(t);
  f.remote.stored = Buffer.from("changed object");
  const restarted = f.restart();
  assert.deepEqual(await restarted.flushOutbox(), { flushed: 0, pending: 1 });
  const pending = await restarted.outbox();
  assert.equal(pending[0].status, "conflict");
  assert.equal(pending[0].lastError, "material_integrity_conflict");
  assert.equal(f.remote.signCalls, 1);
  assert.equal(f.remote.putCalls, 1);
  assert.equal(f.remote.envelopes.length, 1);
  assert.equal(listStagedMaterials({ stateDir: f.stateDir }).length, 1);
});

test("a missing durable object is re-signed and re-uploaded with the same persisted command", async t => {
  const f = await fixture(t);
  f.remote.stored = null;
  const restarted = f.restart();
  assert.deepEqual(await restarted.flushOutbox(), { flushed: 1, pending: 0 });
  assert.equal(f.remote.signCalls, 2);
  assert.equal(f.remote.putCalls, 2);
  assert.deepEqual(f.remote.stored, bytes);
  assert.equal(f.remote.envelopes[0], f.remote.envelopes[1]);
  assert.equal(listStagedMaterials({ stateDir: f.stateDir }).length, 0);
});

test("an existing-object verification denial retains the intent and never falls back to signing", async t => {
  const f = await fixture(t);
  f.remote.verifyError = { code: "permission_denied", status: 403 };
  const restarted = f.restart();
  assert.deepEqual(await restarted.flushOutbox(), { flushed: 0, pending: 1 });
  assert.equal((await restarted.outbox())[0].lastError, "permission_denied");
  assert.equal(f.remote.signCalls, 1);
  assert.equal(f.remote.putCalls, 1);
  assert.equal(listStagedMaterials({ stateDir: f.stateDir }).length, 1);
});
