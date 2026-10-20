import { fetchDesktopApi } from "./desktop-native";
type Identity = { entity_id: string; label: string; revision: number };
export type ParentRecipientCandidate = { root_ref: string; owner_id: string; message_ref: string; grant_id: string; grant_version: number;
  scope: { class_id: string; subject: string }; student: Identity; recipient: Identity; term: Identity;
  evidence_ids: string[]; source_fingerprint: string; confirmed_fact_id: string | null };
export type ParentRecipientEntry = { sessionId: string; clientRequestId: string; occurredAt: string;
  status: "ready" | "confirmed" | "held" | "needs_input"; reason: string; candidate: ParentRecipientCandidate | null };
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const id = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/u.test(value);
const hash = (value: unknown) => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
function candidate(value: unknown): value is ParentRecipientCandidate {
  const item = record(value), scope = record(item?.scope);
  return Boolean(item && hash(item.root_ref) && id(item.owner_id) && id(item.grant_id) && hash(item.source_fingerprint)
    && typeof item.message_ref === "string" && /^owner_message:[a-f0-9]{64}$/u.test(item.message_ref)
    && Number.isSafeInteger(item.grant_version) && Number(item.grant_version) > 0
    && scope && id(scope.class_id) && typeof scope.subject === "string" && scope.subject.length > 0 && scope.subject.length <= 128
    && [item.student, item.recipient, item.term].every(value => { const person = record(value); return person && id(person.entity_id)
      && typeof person.label === "string" && person.label.length > 0 && person.label.length <= 240 && Number.isSafeInteger(person.revision) && Number(person.revision) >= 0; })
    && Array.isArray(item.evidence_ids) && item.evidence_ids.length > 0 && item.evidence_ids.length <= 49 && item.evidence_ids.every(id)
    && (item.confirmed_fact_id === null || id(item.confirmed_fact_id)));
}
export function parseParentRecipientEntries(value: unknown): ParentRecipientEntry[] {
  const body = record(value);
  if (body?.ok !== true || body.externalSend !== false || !Array.isArray(body.entries) || body.entries.length > 20) throw new Error("收件人确认暂不可用");
  for (const raw of body.entries) {
    const entry = record(raw);
    if (!entry || typeof entry.sessionId !== "string" || !entry.sessionId || typeof entry.clientRequestId !== "string" || !entry.clientRequestId
      || typeof entry.occurredAt !== "string" || !Number.isFinite(Date.parse(entry.occurredAt))
      || !["ready", "confirmed", "held", "needs_input"].includes(String(entry.status)) || typeof entry.reason !== "string"
      || !["ready", "confirmed"].includes(String(entry.status)) && entry.candidate !== null
      || ["ready", "confirmed"].includes(String(entry.status)) && !candidate(entry.candidate)) throw new Error("收件人确认依据无效");
  }
  return body.entries as ParentRecipientEntry[];
}
export async function readParentRecipientEntries(signal?: AbortSignal): Promise<ParentRecipientEntry[]> {
  const response = await fetchDesktopApi("/api/edupi/proactivity/parent-recipient", { cache: "no-store", signal });
  const body = await response.json(); if (!response.ok) throw new Error("收件人确认暂不可用"); return parseParentRecipientEntries(body);
}
export async function confirmParentRecipientEntry(entry: ParentRecipientEntry, commandId: string): Promise<void> {
  const proof = entry.candidate;
  if (entry.status !== "ready" || !proof) throw new Error("收件人依据已变化，请刷新");
  const response = await fetchDesktopApi("/api/edupi/proactivity/parent-recipient", { method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: entry.sessionId, clientRequestId: entry.clientRequestId,
      commandId, expectedGrantVersion: proof.grant_version, expectedSourceFingerprint: proof.source_fingerprint,
      studentId: proof.student.entity_id, recipientId: proof.recipient.entity_id, termRef: proof.term.entity_id }) });
  const body = record(await response.json());
  if (!response.ok || body?.ok !== true || body.externalSend !== false || body.readbackConfirmed !== true) {
    throw new Error(response.status === 409 ? "收件人依据已变化，请刷新后重试" : "确认尚未完成，请重试");
  }
}
