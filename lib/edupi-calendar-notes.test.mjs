import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { issueCalendarNotes } = await createJiti(import.meta.url).import("./edupi-calendar-notes.ts");
const rootRef = `sha256:${"a".repeat(64)}`, contentHash = `sha256:${"b".repeat(64)}`;
const input = { canonicalId: "calendar-canonical", expectedNotes: "原备注", notes: "原备注\n\n补充", evidenceIds: ["merge-evidence"] };
const snapshot = { envelope: { provenance: [{ source_kind: "core_event", source_id: "education_intake_state", source_hash: contentHash }] },
  payload: { snapshot_id: "snapshot-original" }, roots: { runtime: { root: "runtime" }, dataRoot: { root: "synthetic-data" } } };
function harness(change = {}) {
  const calls = [];
  const host = {
    call: async (operation, payload) => { calls.push([operation, payload]); return { ok: true, result: { data_root_fingerprint: rootRef } }; },
    callOwnerControl: async (operation, payload) => {
      calls.push([operation, payload]);
      if (operation === "owner_read") return { ok: true, result: { root_ref: rootRef, owner: { id: "owner-test" } } };
      const result = { update_id: "notes-receipt", command_id: payload.command_id, canonical_id: payload.canonical_id,
        root_ref: rootRef, owner_id: "owner-test", status: "accepted", reason_code: null, before_revision: 1, after_revision: 2,
        before_content_hash: contentHash, after_content_hash: contentHash, notes: payload.notes,
        evidence_ids: payload.evidence_ids, updated_at: "2026-10-28T00:00:00.000Z", external_send: false, replayed: false };
      return change.error_code ? { ok: false, error_code: change.error_code } : { ok: true, result: { ...result, ...change } };
    },
  };
  return { host, calls };
}
test("canonical notes command binds current root, owner, snapshot and original notes without sending an issuer", async () => {
  const h = harness();
  await issueCalendarNotes(input, { snapshot, host: h.host });
  const [operation, command] = h.calls.at(-1);
  assert.equal(operation, "calendar_notes_update");
  assert.deepEqual({ ...command, command_id: "deterministic" }, { command_id: "deterministic", root_ref: rootRef,
    expected_owner_id: "owner-test", expected_snapshot_id: "snapshot-original", expected_intake_hash: contentHash, canonical_id: input.canonicalId,
    expected_notes: "原备注", notes: "原备注 补充", evidence_ids: ["merge-evidence"] });
  await issueCalendarNotes(input, { snapshot: { ...snapshot, payload: { snapshot_id: "snapshot-retry" } }, host: h.host });
  assert.equal(h.calls.at(-1)[1].command_id, command.command_id);
});
for (const [name, change] of [
  ["different canonical", { canonical_id: "another" }], ["different owner", { owner_id: "another" }],
  ["different root", { root_ref: `sha256:${"c".repeat(64)}` }], ["different notes", { notes: "other" }],
  ["external send", { external_send: true }], ["missing evidence", { evidence_ids: [] }],
  ["contradictory reason", { reason_code: "review_required" }], ["missing timestamp", { updated_at: "" }],
]) test(`${name} receipt cannot approve the merge`, async () => {
  const h = harness(change);
  await assert.rejects(issueCalendarNotes(input, { snapshot, host: h.host }), /回执/);
});
test("held notes and stale CAS stay visible as incomplete operations", async () => {
  const held = harness({ status: "held", reason_code: "review_required" });
  await assert.rejects(issueCalendarNotes(input, { snapshot, host: held.host }), /待确认/);
  for (const error_code of ["calendar_notes_stale", "calendar_notes_source_deleted", "calendar_notes_held"]) {
    const h = harness({ error_code });
    await assert.rejects(issueCalendarNotes(input, { snapshot, host: h.host }), /暂停|待确认/);
  }
});
test("missing or ambiguous formal intake hash fails before contacting the runtime", async () => {
  for (const provenance of [[], [snapshot.envelope.provenance[0], snapshot.envelope.provenance[0]]]) {
    const h = harness();
    await assert.rejects(issueCalendarNotes(input, { snapshot: { ...snapshot, envelope: { provenance } }, host: h.host }), /来源快照/);
    assert.deepEqual(h.calls, []);
  }
});
