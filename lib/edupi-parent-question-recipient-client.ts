import { fetchDesktopApi } from "./desktop-native";
import { readEduPiProactivity, updateEduPiProactivity, type EduPiProactivityState } from "./edupi-proactivity-client";

export type ParentQuestionRecipientCandidate = {
  case_id: string; question_fact_id: string; question_revision: number; student_id: string; recipient_id: string;
  term_ref: string; scope: { class_id: string; subject: string }; deadline_at: string;
  grant_version: number; source_basis_hash: string;
  confirmation_plan_id: string; confirmation_text: string; confirmed_fact_id: string | null; message_ref: string | null;
};
export type ParentQuestionRecipientEntry = {
  questionFactId: string; questionRevision: number; messageGeneration: number;
  status: "needs_confirmation" | "confirmed" | "stale_confirmed";
  candidate: ParentQuestionRecipientCandidate;
};

const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const id = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_][A-Za-z0-9_.:@/+~-]{0,159}$/u.test(value);
const hash = (value: unknown) => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const ref = (value: unknown) => typeof value === "string" && /^owner_message:[a-f0-9]{64}$/u.test(value);

export function parseParentQuestionRecipientEntries(value: unknown): ParentQuestionRecipientEntry[] {
  const body = object(value);
  if (body?.ok !== true || body.externalSend !== false || !Array.isArray(body.entries) || body.entries.length > 128) throw new Error("家长问题确认暂不可用");
  const seen = new Set<string>();
  for (const raw of body.entries) {
    const entry = object(raw), proof = object(entry?.candidate);
    const scope = object(proof?.scope);
    if (!entry || !id(entry.questionFactId) || !Number.isSafeInteger(entry.questionRevision) || Number(entry.questionRevision) < 1
      || !Number.isSafeInteger(entry.messageGeneration) || Number(entry.messageGeneration) < 0 || Number(entry.messageGeneration) > 500
      || !["needs_confirmation", "confirmed", "stale_confirmed"].includes(String(entry.status)) || !proof
      || proof.question_fact_id !== entry.questionFactId || proof.question_revision !== entry.questionRevision
      || !id(proof.case_id) || !id(proof.student_id) || !id(proof.recipient_id) || !id(proof.term_ref)
      || !scope || !id(scope.class_id) || typeof scope.subject !== "string" || !scope.subject.trim() || scope.subject.length > 128
      || typeof proof.deadline_at !== "string" || !Number.isFinite(Date.parse(proof.deadline_at))
      || new Date(proof.deadline_at).toISOString() !== proof.deadline_at
      || !Number.isSafeInteger(proof.grant_version) || Number(proof.grant_version) < 1
      || !hash(proof.source_basis_hash) || !id(proof.confirmation_plan_id)
      || typeof proof.confirmation_text !== "string" || !proof.confirmation_text.trim() || proof.confirmation_text.length > 500
      || ["confirmed", "stale_confirmed"].includes(String(entry.status)) && (!id(proof.confirmed_fact_id) || !ref(proof.message_ref))
      || entry.status === "needs_confirmation" && (proof.confirmed_fact_id !== null || proof.message_ref !== null)) throw new Error("家长问题确认依据无效");
    const key = `${entry.questionFactId}:${entry.questionRevision}:${entry.messageGeneration}:${proof.source_basis_hash}`;
    if (seen.has(key)) throw new Error("家长问题确认依据重复");
    seen.add(key);
  }
  return body.entries as ParentQuestionRecipientEntry[];
}

export async function readParentQuestionRecipientEntries(signal?: AbortSignal): Promise<ParentQuestionRecipientEntry[]> {
  const response = await fetchDesktopApi("/api/edupi/proactivity/parent-question-recipient", { cache: "no-store", signal });
  const body = await response.json();
  if (response.status === 409 && object(body)?.code === "owner_history_upgrade_required") {
    throw new Error("当前资料尚不能使用家长问题确认");
  }
  if (!response.ok) throw new Error("家长问题确认暂不可用");
  return parseParentQuestionRecipientEntries(body);
}

export const comparableParentQuestionConfirmation = (value: string) => value.normalize("NFKC").replace(/\s+/gu, "");

export async function updateParentQuestionRecipient(entry: ParentQuestionRecipientEntry, action: "confirm" | "cancel", confirmationText?: string): Promise<void> {
  if (action === "confirm" && entry.status !== "needs_confirmation" || action === "cancel" && !["confirmed", "stale_confirmed"].includes(entry.status)) {
    throw new Error("确认依据已变化，请刷新");
  }
  if (action === "confirm" && (typeof confirmationText !== "string" || !confirmationText.trim() || confirmationText.length > 500
    || comparableParentQuestionConfirmation(confirmationText) !== comparableParentQuestionConfirmation(entry.candidate.confirmation_text))) {
    throw new Error("请输入与待确认内容一致的文字");
  }
  const response = await fetchDesktopApi("/api/edupi/proactivity/parent-question-recipient", { method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, questionFactId: entry.questionFactId,
      questionRevision: entry.questionRevision, messageGeneration: entry.messageGeneration, sourceBasisHash: entry.candidate.source_basis_hash,
      confirmationPlanId: entry.candidate.confirmation_plan_id, ...(action === "confirm" ? { confirmationText } : {}) }) });
  const body = object(await response.json());
  if (!response.ok || body?.ok !== true || body.externalSend !== false || body.readbackConfirmed !== true
    || body.status !== (action === "confirm" ? "confirmed" : "cancelled")) {
    throw new Error(response.status === 409 ? "确认依据已变化，请刷新后重试" : "操作尚未完成，请重试");
  }
}

export function parentQuestionRefreshInput(state: EduPiProactivityState) {
  const activation = state.activation, scope = activation.scope;
  if (state.limits.domain !== "parent_communication" || !activation.enabled || !scope || !activation.updatedAt) {
    throw new Error("请先启用家长沟通");
  }
  return { enabled: true, domain: "parent_communication" as const, classId: scope.classId, subject: scope.subject,
    expectedUpdatedAt: activation.updatedAt };
}

export async function refreshParentQuestionSources(): Promise<void> {
  const current = await readEduPiProactivity(undefined, "parent_communication");
  const next = await updateEduPiProactivity(parentQuestionRefreshInput(current));
  if (!next.activation.enabled || !next.activation.scope) throw new Error("来源刷新未完成");
}
