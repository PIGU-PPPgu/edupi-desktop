import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const HASH = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,159}$/u;

export function assertMaterialReceiptOnly(body) {
  assert.equal(body.materialReceivedOnly, true);
  assert.equal(body.scheduleNeedsReview, false);
  assert.equal(body.calendarCommitted, undefined);
  assert.equal(body.documentCommitted, undefined);
  assert.deepEqual([body.recognition.eventCount, body.recognition.slotCount], [0, 0]);
  assert.equal(body.receipt.command_type, "intake_material");
  assert.equal(body.receipt.external_send, false);
  assert.equal(body.receipts.length, 1);
  assert.equal(body.receipts.every(receipt => receipt.command_type === "intake_material" && receipt.external_send === false), true);
}

export function snapshotScheduleState(home) {
  return ["output/education_intake_state.json", "output/entity_delete_state.json", "memory/calendar.json", "memory/timetable.json"]
    .map(relative => {
      const file = path.join(home, relative);
      if (!fs.existsSync(file)) return { relative, absent: true };
      const bytes = fs.readFileSync(file), stat = fs.statSync(file, { bigint: true });
      return { relative, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), size: stat.size, mtimeNs: stat.mtimeNs, ctimeNs: stat.ctimeNs };
    });
}

export function assertFileScheduleUpdateUnavailable(result) {
  assert.equal(result.response.status, 409, JSON.stringify(result.body));
  assert.equal(result.body.code, "file_schedule_update_unavailable");
  assert.equal(result.body.receipt, undefined);
}

function checkedRead(value, materialId) {
  assert.equal(value?.source?.material_id, materialId, "owner read must describe the selected accepted material");
  assert.match(value.source.source_hash, HASH);
  assert.equal(Number.isSafeInteger(value.source.metadata_revision) && value.source.metadata_revision >= 0, true);
  assert.match(value.parse_fingerprint, HASH);
  assert.equal(value.read_only, true);
  assert.equal(value.automatic_import, false);
  assert.equal(value.external_send, false);
  return value;
}

// Test transport for the existing Desktop owner endpoint, never a generic file
// import or a production pin override. Callers supply either real routes or HTTP.
export function createMaterialScheduleTestClient(call) {
  assert.equal(typeof call, "function");
  const read = async materialId => {
    assert.match(materialId, ID);
    const response = await call("GET", `/api/edupi/material-schedule?materialId=${encodeURIComponent(materialId)}`);
    assert.equal(response.response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.ok, true);
    assert.equal(response.body.externalSend, false);
    return checkedRead(response.body.result, materialId);
  };
  const apply = async (proof, commandId) => {
    const response = await call("POST", "/api/edupi/material-schedule", { ...proof, commandId, confirm: true });
    assert.equal(response.response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.ok, true);
    assert.equal(response.body.externalSend, false);
    const result = response.body.result;
    assert.equal(result.material_id, proof.materialId);
    assert.equal(result.command_id, commandId);
    assert.equal(result.parse_fingerprint, proof.expectedParseFingerprint);
    assert.equal(result.external_send, false);
    assert.equal(result.automatic_import, false);
    assert.ok(["accepted", "modified", "held"].includes(result.status));
    assert.ok(Array.isArray(result.applied_ids) && Array.isArray(result.rejected_ids));
    return result;
  };
  return {
    read,
    async adopt(materialId, commandId, confirm) {
      assert.match(commandId, ID);
      const current = await read(materialId);
      assert.equal(current.status, "ready", "unresolved files cannot be adopted");
      assert.deepEqual(current.issues, []);
      assert.ok(Array.isArray(current.events) && current.events.length > 0);
      const proof = { action: "apply", materialId, expectedSourceHash: current.source.source_hash,
        expectedMetadataRevision: current.source.metadata_revision, expectedParseFingerprint: current.parse_fingerprint };
      if (typeof confirm !== "function" || await confirm(structuredClone(current)) !== true) return { status: "cancelled" };
      // Do not refresh proof after confirmation and do not retry a write: the
      // real endpoint must reject a source changed while confirmation was open.
      return apply(proof, commandId);
    },
  };
}
