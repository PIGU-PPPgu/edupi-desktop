export const CORE_RECALL_ANSWER_MESSAGE = "edupi_core_recall_answer_v1";

export type CoreRecallSource = { id: string; content: string; source_fingerprint: string };
export type CoreRecallFacet = {
  facet_id: string;
  question: string;
  kind: "person" | "ordinal" | "value";
  source_id: string;
  source_fingerprint: string;
  answer: string[];
  evidence: string[];
};
export type CoreRecallAnswer = {
  policy: "current-case-facets-v1";
  work_case_ref: string;
  anchor: string;
  text: string;
  question_case_verified: true;
  answer_verified: true;
  receipt_ref: string;
  valid_until: string;
  facets: CoreRecallFacet[];
};

/** Historical Core assertions are content, never a persisted UI authorization. */
export type CoreRecallAnswerDetails = {
  version: 1;
  receiptId: string;
  sessionId: string;
  userEntryId: string;
  clientRequestId: string;
  originalTextHash: string;
  issuedAt: string;
  answer: CoreRecallAnswer | null;
  sources: CoreRecallSource[];
  reasonCode: string | null;
};

export type CoreRecallAnswerState = {
  version: 1;
  status: "current" | "held" | "historical";
  reasonCode: string | null;
};

export type CoreRecallPersonState = {
  version: 1;
  status: "current" | "confirmed" | "replayed" | "held";
  reasonCode: string | null;
  personName: string;
  previewId: string | null;
  personId: string | null;
  personRevision: number | null;
  sourceFingerprint: string | null;
  factWrite: boolean | null;
};

const HASH = /^sha256:[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown, max: number, min = 1): value is string =>
  typeof value === "string" && value.length >= min && value.length <= max && !value.includes("\0");
const keys = (value: Record<string, unknown>, expected: string[]) =>
  Object.keys(value).sort().join(",") === expected.sort().join(",");
const strings = (value: unknown, max: number): value is string[] =>
  Array.isArray(value) && value.length >= 1 && value.length <= 4 && value.every(item => text(item, max));

export function parseCoreRecallAnswer(value: unknown, sources: readonly CoreRecallSource[]): CoreRecallAnswer | null {
  const answer = object(value);
  if (!answer || !keys(answer, ["policy", "work_case_ref", "anchor", "text", "question_case_verified", "answer_verified", "receipt_ref", "valid_until", "facets"])
    || answer.policy !== "current-case-facets-v1" || answer.question_case_verified !== true || answer.answer_verified !== true
    || typeof answer.receipt_ref !== "string" || !/^recall_answer:[a-f0-9]{64}$/u.test(answer.receipt_ref)
    || typeof answer.valid_until !== "string" || !Number.isFinite(Date.parse(answer.valid_until))
    || new Date(answer.valid_until).toISOString() !== answer.valid_until
    || !text(answer.work_case_ref, 160) || !text(answer.anchor, 80, 2) || !text(answer.text, 24_000)
    || !Array.isArray(answer.facets) || answer.facets.length < 2 || answer.facets.length > 3) return null;
  const ids = new Set<string>();
  for (const raw of answer.facets) {
    const facet = object(raw);
    if (!facet || !keys(facet, ["facet_id", "question", "kind", "source_id", "source_fingerprint", "answer", "evidence"])
      || !text(facet.facet_id, 7) || !/^facet_[0-2]$/u.test(facet.facet_id) || ids.has(facet.facet_id)
      || !text(facet.question, 256) || !["person", "ordinal", "value"].includes(String(facet.kind))
      || !text(facet.source_id, 160) || typeof facet.source_fingerprint !== "string" || !HASH.test(facet.source_fingerprint)
      || !strings(facet.answer, 2000) || !strings(facet.evidence, 2000)) return null;
    ids.add(facet.facet_id);
    const matches = sources.filter(source => source.id === facet.source_id);
    if (matches.length !== 1 || matches[0].source_fingerprint !== facet.source_fingerprint
      || facet.evidence.some(quote => !matches[0].content.includes(quote))) return null;
  }
  // Display this exact text. Desktop does not recombine facts or regenerate it.
  return answer as CoreRecallAnswer;
}

export function parseCoreRecallAnswerDetails(value: unknown): CoreRecallAnswerDetails | null {
  const details = object(value);
  if (!details || !keys(details, ["version", "receiptId", "sessionId", "userEntryId", "clientRequestId", "originalTextHash",
    "issuedAt", "answer", "sources", "reasonCode"]) || details.version !== 1
    || typeof details.receiptId !== "string" || !UUID.test(details.receiptId)
    || !text(details.sessionId, 160) || !text(details.userEntryId, 160) || !text(details.clientRequestId, 160)
    || typeof details.originalTextHash !== "string" || !HASH.test(details.originalTextHash)
    || typeof details.issuedAt !== "string" || !Number.isFinite(Date.parse(details.issuedAt))
    || new Date(details.issuedAt).toISOString() !== details.issuedAt
    || details.reasonCode !== null && !text(details.reasonCode, 80)
    || !Array.isArray(details.sources) || details.sources.length > 50) return null;
  const sources: CoreRecallSource[] = [];
  for (const raw of details.sources) {
    const source = object(raw);
    if (!source || !keys(source, ["id", "content", "source_fingerprint"]) || !text(source.id, 160)
      || !text(source.content, 12_000) || typeof source.source_fingerprint !== "string" || !HASH.test(source.source_fingerprint)
      || sources.some(previous => previous.id === source.id)) return null;
    sources.push(source as CoreRecallSource);
  }
  if (details.answer !== null && (!parseCoreRecallAnswer(details.answer, sources) || details.reasonCode !== null)
    || details.answer === null && sources.length !== 0) return null;
  return details as CoreRecallAnswerDetails;
}
