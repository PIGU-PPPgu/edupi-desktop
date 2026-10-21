import assert from "node:assert/strict";
import test from "node:test";
import { createMaterialScheduleTestClient, assertMaterialReceiptOnly } from "./material-schedule-e2-client.mjs";

const hash = value => `sha256:${value.repeat(64)}`;
function ready() {
  return { version: 1, source: { material_id: "material-fixture", source_hash: hash("a"), metadata_revision: 3 },
    parse_fingerprint: hash("b"), status: "ready", events: [{ event_id: "event-fixture" }], issues: [],
    read_only: true, automatic_import: false, external_send: false };
}
function transport(result = ready()) {
  const calls = [];
  const call = async (method, pathname, body) => {
    calls.push({ method, pathname, body });
    if (method === "GET") return { response: { status: 200 }, body: { ok: true, result: structuredClone(result), externalSend: false } };
    return { response: { status: 200 }, body: { ok: true, result: { material_id: "material-fixture", command_id: body.commandId,
      parse_fingerprint: body.expectedParseFingerprint, status: "accepted", applied_ids: ["event-fixture"],
      rejected_ids: [], external_send: false, automatic_import: false }, externalSend: false } };
  };
  return { call, calls };
}

test("material adoption reads current proof and requires explicit confirmation before the only apply", async () => {
  const api = transport();
  const client = createMaterialScheduleTestClient(api.call);
  const outcome = await client.adopt("material-fixture", "confirmed-command", async result => {
    assert.equal(api.calls.length, 1);
    assert.equal(result.source.metadata_revision, 3);
    return true;
  });
  assert.equal(outcome.status, "accepted");
  assert.deepEqual(api.calls.map(item => item.method), ["GET", "POST"]);
  assert.deepEqual(api.calls[1].body, { action: "apply", materialId: "material-fixture", expectedSourceHash: hash("a"),
    expectedMetadataRevision: 3, expectedParseFingerprint: hash("b"), commandId: "confirmed-command", confirm: true });
});

test("cancel and missing confirmation never submit a schedule mutation", async () => {
  for (const confirm of [undefined, async () => false]) {
    const api = transport();
    const outcome = await createMaterialScheduleTestClient(api.call).adopt("material-fixture", "cancelled-command", confirm);
    assert.equal(outcome.status, "cancelled");
    assert.deepEqual(api.calls.map(item => item.method), ["GET"]);
  }
});

test("proof is captured before confirmation and cannot be silently replaced by a changed read", async () => {
  const current = ready();
  const api = transport(current);
  await createMaterialScheduleTestClient(api.call).adopt("material-fixture", "captured-command", async result => {
    current.source.metadata_revision = 4;
    current.source.source_hash = hash("c");
    result.source.metadata_revision = 99;
    result.parse_fingerprint = hash("f");
    return true;
  });
  assert.equal(api.calls[1].body.expectedMetadataRevision, 3);
  assert.equal(api.calls[1].body.expectedSourceHash, hash("a"));
  assert.equal(api.calls[1].body.expectedParseFingerprint, hash("b"));
});

test("held, malformed or cross-material reads cannot reach confirmation or apply", async () => {
  for (const change of [result => { result.status = "unresolved"; }, result => { result.issues = [{ code: "missing_time_zone" }]; },
    result => { result.events = []; }, result => { result.source.material_id = "other-material"; },
    result => { result.source.metadata_revision = -1; }, result => { result.parse_fingerprint = "unbound"; },
    result => { result.read_only = false; }, result => { result.external_send = true; }]) {
    const value = ready(); change(value);
    const api = transport(value);
    let confirmations = 0;
    await assert.rejects(createMaterialScheduleTestClient(api.call).adopt("material-fixture", "invalid-command", async () => {
      confirmations += 1; return true;
    }));
    assert.equal(confirmations, 0);
    assert.equal(api.calls.length, 1);
  }
});

test("a rejected or uncertain apply is not retried or reported as accepted", async () => {
  for (const mode of ["stale", "network", "wrong-binding"]) {
    const api = transport();
    const client = createMaterialScheduleTestClient(async (...args) => {
      const response = await api.call(...args);
      if (args[0] === "POST") {
        if (mode === "network") throw new Error("synthetic connection lost");
        if (mode === "stale") return { response: { status: 409 }, body: { ok: false, errorCode: "material_schedule_stale", externalSend: false } };
        response.body.result.command_id = "another-command";
      }
      return response;
    });
    await assert.rejects(client.adopt("material-fixture", "one-shot-command", async () => true));
    assert.equal(api.calls.filter(item => item.method === "POST").length, 1);
  }
});

test("material receipt-only assertions reject a legacy automatic calendar or timetable write", () => {
  const value = { materialReceivedOnly: true, receipt: { command_type: "intake_material", external_send: false },
    receipts: [{ command_type: "intake_material", external_send: false }], recognition: { eventCount: 0, slotCount: 0 },
    scheduleNeedsReview: false };
  assertMaterialReceiptOnly(value);
  for (const changed of [{ ...value, calendarCommitted: true }, { ...value, documentCommitted: true },
    { ...value, receipts: [...value.receipts, { command_type: "import_calendar", external_send: false }] },
    { ...value, recognition: { eventCount: 0, slotCount: 1 } }]) {
    assert.throws(() => assertMaterialReceiptOnly(changed));
  }
});
