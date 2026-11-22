import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const staging = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-material-staging.ts");
const intake = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-cloud-intake.ts");
const { createEduPiCloudClient } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-cloud-client.ts");

const account = "11111111-1111-4111-8111-111111111111";
const workspace = "22222222-2222-4222-8222-222222222222";
const png = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03,
]);

function fixture(t) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-cloud-material-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const env = {
    PI_DESKTOP_STATE_DIR: stateDir,
    SUPABASE_URL: "https://materials.example.invalid",
    SUPABASE_ANON_KEY: "public-test-key",
  };
  const previousStateDir = process.env.PI_DESKTOP_STATE_DIR;
  process.env.PI_DESKTOP_STATE_DIR = stateDir;
  t.after(() => {
    if (previousStateDir === undefined) delete process.env.PI_DESKTOP_STATE_DIR;
    else process.env.PI_DESKTOP_STATE_DIR = previousStateDir;
  });
  const descriptor = staging.stageMaterialInputs([{
    name: "合成讲义.png", mimeType: "image/png", bytes: png,
  }], { stateDir, idFactory: () => `stg_${"a".repeat(32)}` })[0];
  const sourceHash = descriptor.source_hash;
  let online = false;
  let stored = false;
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    const requestUrl = String(url);
    const body = init.body && String(init.headers?.["Content-Type"] || init.headers?.get?.("Content-Type") || "").includes("json")
      ? JSON.parse(String(init.body)) : null;
    requests.push({ url: requestUrl, body, init });
    if (requestUrl.includes("/auth/v1/token")) {
      return Response.json({
        access_token: `access-${account}`, refresh_token: `refresh-${account}`,
        expires_in: 3600, user: { id: account, email: "synthetic@example.invalid" },
      });
    }
    if (requestUrl.includes("/functions/v1/edupi-account")) {
      return Response.json({ ok: true, workspaces: [{ id: workspace, mode: "cloud" }] });
    }
    if (!online) throw new TypeError("offline");
    if (requestUrl.includes("/functions/v1/edupi-materials")) {
      if (body.action === "create_upload") {
        return Response.json({
          ok: true, action: "create_upload", object_key: `${workspace}/${body.material_id}/${sourceHash.slice(7)}-${body.file_name}`,
          token: "upload-token", external_send: false,
        });
      }
      if (body.action === "verify_upload") {
        if (!stored) return Response.json({ code: "material_not_uploaded" }, { status: 409 });
        return Response.json({
          ok: true, action: "verify_upload", object_key: body.object_key,
          sha256: sourceHash, size_bytes: png.byteLength, verified: true, external_send: false,
        });
      }
    }
    if (requestUrl.includes("/storage/v1/object/upload/sign/")) {
      stored = true;
      return new Response(null, { status: 200 });
    }
    if (requestUrl.includes("/functions/v1/edupi-core-broker")) {
      if (body.operation === "snapshot") {
        return Response.json({
          ok: true, operation: "snapshot", snapshot_id: "snapshot-material", state_hash: `sha256:${"a".repeat(64)}`,
          payload: {
            workspace_id: workspace, tasks: [], facts: [], materials: [{
              material_id: "material-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              title: "合成讲义", source_hash: sourceHash,
              storage_object_key: `${workspace}/material-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/${sourceHash.slice(7)}-合成讲义.png`,
            }],
          }, external_send: false,
        });
      }
      if (body.operation === "command") {
        const envelope = body.envelope;
        const command = envelope.command;
        return Response.json({
          ok: true, operation: "command", request_id: envelope.request_id,
          replayed: false, external_send: false,
          receipt: {
            contract_version: envelope.contract_version, schema_hash: envelope.schema_hash,
            request_id: envelope.request_id, external_send: false,
            payload: {
              command_id: envelope.message_id, request_id: envelope.request_id, status: "accepted",
              target: { target_kind: "material_intake", target_id: command.material.material_id },
              applied_ids: [command.material.material_id], rejected_ids: [], external_send: false,
            },
          },
        });
      }
    }
    throw new Error(`unexpected cloud request ${requestUrl}`);
  };
  const client = createEduPiCloudClient({ env, fetchImpl });
  const command = {
    command_type: "intake_material",
    source: { source_id: descriptor.staging_id, source_kind: "teacher_file", source_hash: sourceHash, evidence_ids: [descriptor.staging_id] },
    material: {
      material_id: "material-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", staging_id: descriptor.staging_id,
      staging_path: descriptor.staging_path, source_path: null, source_hash: sourceHash,
      expected_size_bytes: png.byteLength, kind: "other", title: "合成讲义",
      subject: "数学", class_id: "703", source_scope: "desktop_staging",
    },
  };
  return { stateDir, env, descriptor, client, command, fetchImpl, requests, setOnline: value => { online = value; } };
}

test("material upload keeps one durable intent and retains staging while offline", async t => {
  const f = fixture(t);
  await f.client.login("synthetic@example.invalid", "synthetic");
  await f.client.selectWorkspace(workspace);
  const identity = intake.cloudMaterialIntakeIdentity(f.command);
  const queued = await f.client.uploadMaterial({
    materialId: f.command.material.material_id, fileName: f.descriptor.original_name,
    contentType: "image/png", sizeBytes: png.byteLength, sha256: f.descriptor.source_hash,
    bytes: png, staging: f.descriptor, command: f.command,
    requestId: identity.requestId, idempotencyKey: identity.idempotencyKey,
  });
  assert.equal(queued.queued, true);
  assert.equal((await f.client.outbox()).length, 1);
  assert.equal((await f.client.outbox())[0].operation, "material-intake");
  assert.equal(fs.existsSync(f.descriptor.staging_path), true);
  assert.equal((await f.client.outbox())[0].body.envelope, undefined);
  assert.equal(identity.requestId, intake.cloudMaterialIntakeIdentity(f.command).requestId);
});

test("material retry reuses the durable intent, verifies real binary state, then clears only the outbox", async t => {
  const f = fixture(t);
  await f.client.login("synthetic@example.invalid", "synthetic");
  await f.client.selectWorkspace(workspace);
  const identity = intake.cloudMaterialIntakeIdentity(f.command);
  await f.client.uploadMaterial({
    materialId: f.command.material.material_id, fileName: f.descriptor.original_name,
    contentType: "image/png", sizeBytes: png.byteLength, sha256: f.descriptor.source_hash,
    bytes: png, staging: f.descriptor, command: f.command,
    requestId: identity.requestId, idempotencyKey: identity.idempotencyKey,
  });
  const restarted = createEduPiCloudClient({ env: f.env, fetchImpl: f.fetchImpl });
  f.setOnline(true);
  const result = await restarted.flushOutbox();
  assert.deepEqual(result, { flushed: 1, pending: 0 });
  assert.equal((await restarted.state()).completed.length, 1);
  assert.equal(fs.existsSync(f.descriptor.staging_path), false, "verified replay settles its exact staging entry");
  assert.equal((await restarted.state()).completed[0].result.staging_settled, true);
  assert.deepEqual(await restarted.flushOutbox(), { flushed: 0, pending: 0 });
  assert.ok(f.requests.some(request => request.body?.action === "verify_upload"));
  assert.ok(f.requests.some(request => request.url.includes("/storage/v1/object/upload/sign/")));
  assert.ok(f.requests.some(request => request.body?.operation === "command"));
});
