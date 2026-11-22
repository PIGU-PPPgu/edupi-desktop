import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createJiti } from "jiti";

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr1sAAAAASUVORK5CYII=", "base64");
const digest = value => `sha256:${createHash("sha256").update(value).digest("hex")}`;
function check(condition, label) {
  if (!condition) throw Object.assign(new Error(label), { check: label });
}

/** The write and its complete response happen before the single simulated loss. */
export function commandAckLossFetch(materialId, onCommitted, transport = fetch) {
  let dropped = false;
  return {
    get dropped() { return dropped; },
    fetchImpl: async (input, init = {}) => {
      const response = await transport(input, init);
      const endpoint = new URL(String(input)).pathname;
      if (dropped || endpoint !== "/functions/v1/edupi-core-broker" || !response.ok) return response;
      let body;
      try { body = JSON.parse(String(init.body)); } catch { return response; }
      if (body.operation !== "command" || body.envelope?.command?.material?.material_id !== materialId) return response;
      const wire = await response.json();
      check(["accepted", "modified"].includes(wire.receipt?.payload?.status), "command-really-accepted");
      check(wire.receipt.payload.applied_ids?.includes(materialId), "command-really-applied-material");
      check(wire.request_id === body.envelope.request_id, "committed-request-identity");
      await onCommitted({ envelope: body.envelope, wire, status: response.status, bodyConsumed: response.bodyUsed });
      dropped = true;
      throw new TypeError("synthetic ACK loss after a complete real command response");
    },
  };
}

function publicAnon() {
  try {
    const value = execFileSync("ssh", [
      "-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10",
      process.env.EDUPI_REMOTE_HOST || "ubuntu@43.134.4.108", "bash -s",
    ], {
      input: 'set -euo pipefail\n. /srv/edupi-supabase/.supabase.env\nprintf "%s" "$ANON_KEY"\n',
      encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 20_000,
    }).trim();
    check(value.length > 20 && !value.startsWith("sb_secret_"), "public-anon-only");
    return value;
  } catch {
    throw Object.assign(new Error("public key unavailable"), { check: "ssh-public-anon" });
  }
}

export async function runMaterialAckLoss({ fixturePath = "/tmp/edupi-risk-ui-20261123/fixture.json", resume } = {}) {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  check(typeof fixture.email === "string" && fixture.email.endsWith("@example.invalid")
    && typeof fixture.password === "string" && uuid.test(fixture.userId) && uuid.test(fixture.workspaceId), "isolated-fixture");
  const root = fs.realpathSync(resume || fs.mkdtempSync(path.join(os.tmpdir(), "edupi-material-ack-loss-")));
  check(path.basename(root).startsWith("edupi-material-ack-loss-")
    && path.dirname(root) === fs.realpathSync(os.tmpdir()), "owned-private-temporary-root");
  fs.chmodSync(root, 0o700);
  const evidencePath = path.join(root, "evidence.json");
  const stateDir = path.join(root, "state");
  const dataRoot = path.join(root, "data");
  const evidence = resume ? JSON.parse(fs.readFileSync(evidencePath, "utf8")) : {
    workspaceId: fixture.workspaceId, userId: fixture.userId, materialId: `ack-loss-material-${randomUUID()}`,
    fileName: "synthetic-ack-loss.png", contentType: "image/png", sizeBytes: bytes.length, sha256: digest(bytes), checks: [],
  };
  if (resume && evidence.status === "failed") fs.copyFileSync(evidencePath, path.join(root, "baseline-failure.json"));
  check(evidence.workspaceId === fixture.workspaceId && evidence.userId === fixture.userId, "resume-same-isolated-scope");
  let phase = "initializing";
  const save = () => fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  const passed = label => {
    evidence.checks = [...new Set([...evidence.checks, label])];
    save();
    console.log(`PASS ${label}`);
  };
  const previousState = process.env.PI_DESKTOP_STATE_DIR;
  process.env.PI_DESKTOP_STATE_DIR = stateDir;
  try {
    const env = {
      SUPABASE_URL: process.env.SUPABASE_URL || "https://edupi.intelliclass.online",
      SUPABASE_ANON_KEY: publicAnon(), PI_DESKTOP_STATE_DIR: stateDir,
    };
    check(new URL(env.SUPABASE_URL).protocol === "https:", "real-https-only");
    const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
    const { createEduPiCloudClient } = await jiti.import("../lib/edupi-cloud-client.ts");
    const { stageMaterialInputs, listStagedMaterials } = await jiti.import("../lib/edupi-material-staging.ts");
    const { cloudMaterialIntakeIdentity } = await jiti.import("../lib/edupi-cloud-intake.ts");
    evidence.clientSourceHash = digest(fs.readFileSync(new URL("../lib/edupi-cloud-client.ts", import.meta.url)));
    save();
    const storageBytes = async client => {
      const current = await client.state();
      check(current.session?.user.id === fixture.userId && current.workspaceId === fixture.workspaceId, "storage-read-scope");
      const response = await fetch(`${env.SUPABASE_URL}/storage/v1/object/edupi-materials/${evidence.objectKey.split("/").map(encodeURIComponent).join("/")}`, {
        headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${current.session.accessToken}` },
        signal: AbortSignal.timeout(20_000), redirect: "error",
      });
      check(response.ok, "authenticated-storage-read");
      const actual = Buffer.from(await response.arrayBuffer());
      check(actual.equals(bytes) && digest(actual) === evidence.sha256, "exact-storage-bytes");
    };

    if (!resume) {
      fs.mkdirSync(stateDir, { mode: 0o700 });
      fs.mkdirSync(dataRoot, { mode: 0o700 });
      let committed;
      const loss = commandAckLossFetch(evidence.materialId, value => { committed = value; });
      const client = createEduPiCloudClient({ env, fetchImpl: loss.fetchImpl });
      phase = "normal-login-and-workspace-selection";
      await client.login(fixture.email, fixture.password);
      await client.selectWorkspace(fixture.workspaceId);
      const current = await client.state();
      check(current.session?.user.id === fixture.userId && current.workspaceId === fixture.workspaceId, "authenticated-isolated-scope");
      check((fs.statSync(stateDir).mode & 0o077) === 0, "private-client-state");
      passed("normal-login-in-new-private-state-and-existing-isolated-workspace");

      const descriptor = stageMaterialInputs([{ name: evidence.fileName, mimeType: evidence.contentType, bytes }], { stateDir, dataRoot })[0];
      const command = {
        command_type: "intake_material",
        source: { source_id: descriptor.staging_id, source_kind: "teacher_file", source_hash: descriptor.source_hash, evidence_ids: [descriptor.staging_id] },
        material: {
          material_id: evidence.materialId, staging_id: descriptor.staging_id, staging_path: descriptor.staging_path,
          source_path: null, source_hash: descriptor.source_hash, expected_size_bytes: bytes.length, kind: "other",
          title: "合成材料 ACK 丢失恢复验收", subject: "数学", class_id: "synthetic-ack-loss", source_scope: "desktop_staging",
        },
      };
      const identity = cloudMaterialIntakeIdentity(command);
      evidence.requestId = identity.requestId;
      evidence.idempotencyKey = identity.idempotencyKey;
      evidence.stagingId = descriptor.staging_id;
      save();
      phase = "real-upload-and-command-before-losing-ack";
      const outcome = await client.uploadMaterial({
        materialId: evidence.materialId, fileName: evidence.fileName, contentType: evidence.contentType,
        sizeBytes: bytes.length, sha256: descriptor.source_hash, bytes, staging: descriptor, command, ...identity,
      });
      check(outcome.queued === true && loss.dropped && committed?.bodyConsumed, "only-ack-was-lost");
      const pending = await client.outbox();
      check(pending.length === 1 && pending[0].operation === "material-intake" && pending[0].status === "pending", "one-durable-pending-material");
      check(pending[0].attempts === 1 && pending[0].lastError === "network_unavailable", "recorded-ack-loss");
      const durable = pending[0].body;
      check(JSON.stringify(durable.envelope) === JSON.stringify(committed.envelope), "persisted-exact-first-envelope");
      check(durable.request_id === identity.requestId && durable.idempotency_key === identity.idempotencyKey, "durable-request-identity");
      check(listStagedMaterials({ stateDir, dataRoot }).length === 1 && fs.existsSync(descriptor.staging_path), "staging-retained-before-ack");
      evidence.objectKey = durable.object_key;
      evidence.envelopeHash = digest(JSON.stringify(durable.envelope));
      evidence.firstCommandId = committed.wire.receipt.payload.command_id;
      evidence.firstCommandStatus = committed.status;
      save();
      await storageBytes(client);
      const rows = (await client.snapshot()).payload.materials.filter(row => row.material_id === evidence.materialId);
      check(rows.length === 1 && rows[0].storage_object_key === evidence.objectKey && rows[0].source_hash === evidence.sha256, "command-persisted-before-ack-loss");
      passed("real-https-upload-and-command-committed-response-consumed-ack-lost");
      passed("durable-envelope-and-staging-retained-with-exact-remote-bytes");

      phase = "signing-an-already-existing-object";
      try {
        const result = await client.edge("edupi-materials", { body: {
          action: "create_upload", request_id: identity.requestId, material_id: evidence.materialId,
          file_name: evidence.fileName, content_type: evidence.contentType, size_bytes: bytes.length,
          sha256: evidence.sha256, object_key: evidence.objectKey,
        } });
        check(result.object_key === evidence.objectKey && typeof result.token === "string", "existing-object-signature-response");
        evidence.existingObjectSigning = { succeeded: true };
      } catch (error) {
        evidence.existingObjectSigning = { succeeded: false,
          code: /^[a-z0-9_]+$/u.test(error.code || "") ? error.code : "unclassified", status: Number(error.status) || null };
      }
      save();
    }

    phase = "new-default-fetch-client-exact-replay";
    const restarted = createEduPiCloudClient({ env });
    const before = await restarted.outbox();
    check(before.length === 1 && before[0].body.request_id === evidence.requestId, "rebuilt-client-durable-intent");
    check(digest(JSON.stringify(before[0].body.envelope)) === evidence.envelopeHash, "rebuilt-client-exact-envelope");
    const flushed = await restarted.flushOutbox();
    evidence.flush = flushed;
    const pending = await restarted.outbox();
    evidence.pendingAfterFlush = pending.map(entry => ({ id: entry.id, status: entry.status, attempts: entry.attempts, lastError: entry.lastError }));
    save();
    check(flushed.flushed === 1 && flushed.pending === 0 && pending.length === 0, "replay-clears-material-outbox");
    const complete = (await restarted.state()).completed.filter(item => item.entry.body.request_id === evidence.requestId);
    check(complete.length === 1 && complete[0].result.upload_verified === true && complete[0].result.staging_settled === true, "one-verified-settled-completion");
    check(digest(JSON.stringify(complete[0].entry.body.envelope)) === evidence.envelopeHash, "completed-exact-envelope");
    check(complete[0].result.response?.replayed === true && complete[0].result.response.request_id === evidence.requestId
      && complete[0].result.response.receipt?.payload?.command_id === evidence.firstCommandId, "server-replayed-original-command");
    check(listStagedMaterials({ stateDir, dataRoot }).length === 0, "staging-empty-after-confirmed-replay");
    passed("new-default-fetch-client-exact-replay-same-request-envelope-and-receipt");
    passed("outbox-zero-and-staging-zero-after-verified-settlement");

    phase = "final-remote-readback";
    await storageBytes(restarted);
    const rows = (await restarted.snapshot()).payload.materials.filter(row => row.material_id === evidence.materialId);
    check(rows.length === 1 && rows[0].storage_object_key === evidence.objectKey && rows[0].source_hash === evidence.sha256, "one-unchanged-material-after-replay");
    const again = await restarted.flushOutbox();
    check(again.flushed === 0 && again.pending === 0, "repeat-flush-has-no-work");
    passed("remote-object-bytes-unchanged-and-no-duplicate-material");
    evidence.status = "passed";
    delete evidence.failure;
    fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(dataRoot, { recursive: true, force: true });
    evidence.privateStateRemoved = true;
    save();
    console.log(JSON.stringify({ status: evidence.status, evidencePath, workspaceId: evidence.workspaceId,
      materialId: evidence.materialId, requestId: evidence.requestId, objectKey: evidence.objectKey,
      existingObjectSigning: evidence.existingObjectSigning, flush: evidence.flush, staging: 0 }));
    return evidence;
  } catch (error) {
    evidence.status = "failed";
    evidence.failure = {
      phase, check: /^[a-z0-9-]+$/u.test(error.check || "") ? error.check : null,
      code: /^[a-z0-9_]+$/u.test(error.code || "") ? error.code : null, httpStatus: Number(error.status) || null,
    };
    save();
    console.error(JSON.stringify({ status: "failed", evidencePath, materialId: evidence.materialId, ...evidence.failure }));
    process.exitCode = 1;
    return evidence;
  } finally {
    if (previousState === undefined) delete process.env.PI_DESKTOP_STATE_DIR;
    else process.env.PI_DESKTOP_STATE_DIR = previousState;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const resumeIndex = process.argv.indexOf("--resume");
    await runMaterialAckLoss({ ...(resumeIndex >= 0 ? { resume: process.argv[resumeIndex + 1] } : {}) });
  } catch {
    console.error(JSON.stringify({ status: "failed", phase: "fixture-or-private-state-initialization" }));
    process.exitCode = 1;
  }
}
