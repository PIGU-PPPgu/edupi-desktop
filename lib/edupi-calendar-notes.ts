import { createHash } from "node:crypto";
import type { EduPiBridgeRoots } from "./edupi-core-snapshot";
import type { EduPiRuntimeHandle } from "./edupi-runtime-supervisor";

type Row = Record<string, unknown>;
type Input = { canonicalId: string; expectedNotes: string | null; notes: string | null; evidenceIds: string[] };
type Snapshot = { envelope: Row; payload: Row; roots: EduPiBridgeRoots };
const record = (value: unknown): Row | null => value && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
const HASH = /^sha256:[a-f0-9]{64}$/;
const normalizedNotes = (value: string | null) => value?.replace(/\s+/g, " ").trim() || null;

export async function issueCalendarNotes(input: Input, dependencies: {
  snapshot: Snapshot;
  host?: Pick<EduPiRuntimeHandle, "call" | "callOwnerControl">;
}): Promise<void> {
  const { snapshot } = dependencies;
  if (typeof snapshot.payload.snapshot_id !== "string" || !snapshot.payload.snapshot_id || !input.canonicalId) throw new Error("计划快照不可用。");
  const provenance = Array.isArray(snapshot.envelope.provenance) ? snapshot.envelope.provenance.map(record).filter(item =>
    item?.source_kind === "core_event" && item.source_id === "education_intake_state") : [];
  const intakeHash = provenance.length === 1 ? provenance[0]?.source_hash : null;
  if (typeof intakeHash !== "string" || !HASH.test(intakeHash)) throw new Error("计划来源快照未能核对。");
  const host = dependencies.host || await (await import("./edupi-runtime-supervisor")).ensureEduPiRuntime(snapshot.roots);
  const health = await host.call("health", null);
  const rootRef = record(health.result)?.data_root_fingerprint;
  if (health.ok !== true || typeof rootRef !== "string" || !HASH.test(rootRef)) throw new Error("计划服务不可用。");
  const authorization = await host.callOwnerControl("owner_read", {});
  const owner = record(authorization.result), ownerId = record(owner?.owner)?.id;
  if (authorization.ok !== true || owner?.root_ref !== rootRef || typeof ownerId !== "string" || !ownerId) throw new Error("请先完成日程确认设置。");
  const notes = normalizedNotes(input.notes);
  const token = createHash("sha256").update(JSON.stringify([input.canonicalId, input.expectedNotes, notes])).digest("hex");
  const commandId = `plan-notes-${token}`;
  const response = await host.callOwnerControl("calendar_notes_update", {
    command_id: commandId, root_ref: rootRef, expected_owner_id: ownerId,
    expected_snapshot_id: snapshot.payload.snapshot_id, expected_intake_hash: intakeHash, canonical_id: input.canonicalId,
    expected_notes: input.expectedNotes, notes, evidence_ids: input.evidenceIds,
  });
  if (response.ok !== true) {
    const code = String(response.error_code || "calendar_notes_unavailable");
    if (code === "calendar_notes_held") throw new Error("计划待确认，请在日程中核对后继续合并。");
    if (["calendar_notes_stale", "calendar_notes_source_deleted"].includes(code)) throw new Error("计划已变化，合并已暂停。");
    throw new Error("计划备注未能保存，请重试。");
  }
  const receipt = record(response.result);
  if (!receipt || typeof receipt.update_id !== "string" || !receipt.update_id
    || receipt.command_id !== commandId || receipt.canonical_id !== input.canonicalId
    || receipt.root_ref !== rootRef || receipt.owner_id !== ownerId || receipt.external_send !== false
    || !["accepted", "held"].includes(String(receipt.status)) || receipt.notes !== notes
    || (receipt.status === "held" ? receipt.reason_code !== "review_required" : receipt.reason_code !== null && receipt.reason_code !== "already_applied")
    || !Number.isSafeInteger(receipt.before_revision) || Number(receipt.before_revision) < 1
    || !Number.isSafeInteger(receipt.after_revision) || Number(receipt.after_revision) < Number(receipt.before_revision)
    || typeof receipt.before_content_hash !== "string" || !HASH.test(receipt.before_content_hash)
    || typeof receipt.after_content_hash !== "string" || !HASH.test(receipt.after_content_hash)
    || typeof receipt.replayed !== "boolean"
    || typeof receipt.updated_at !== "string" || !Number.isFinite(Date.parse(receipt.updated_at))
    || JSON.stringify(receipt.evidence_ids) !== JSON.stringify(input.evidenceIds)) throw new Error("计划备注回执未能核对。");
  if (receipt.status === "held") throw new Error("合并备注待确认，请在日程中核对后继续合并。");
}
