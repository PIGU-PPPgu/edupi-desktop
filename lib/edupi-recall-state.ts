import type { CoreRecallAnswerDetails } from "./edupi-recall-answer";

type IssuedRecall = { root: string; epoch: number; details: CoreRecallAnswerDetails; termRef: string | null;
  request: Record<string, unknown> | null; invalidated: string | null };
type State = { epochs: Map<string, number>; issued: Map<string, IssuedRecall>;
  lastChanges?: Map<string, { epoch: number; reason: string; operation?: string }> };
const globalState = globalThis as typeof globalThis & { __edupiRecallState?: State };
const state = (): State => globalState.__edupiRecallState ??= { epochs: new Map(), issued: new Map() };

/** This fence can only withdraw a Core assertion; it cannot establish one. */
export function invalidateEduPiRecallRoot(root: string, reason = "source_changed", operation?: string): void {
  const current = state();
  const epoch = (current.epochs.get(root) ?? 0) + 1;
  current.epochs.set(root, epoch);
  (current.lastChanges ??= new Map()).set(root, { epoch, reason, operation });
  for (const issued of current.issued.values()) if (issued.root === root) issued.invalidated = reason;
}

export function eduPiRecallRootEpoch(root: string): number {
  return state().epochs.get(root) ?? 0;
}

export function eduPiRecallRootLastChange(root: string): Readonly<{ epoch: number; reason: string; operation?: string }> | null {
  return state().lastChanges?.get(root) ?? null;
}

export function issueEduPiRecall(root: string, epoch: number, details: CoreRecallAnswerDetails, termRef: string | null = null,
  request: Record<string, unknown> | null = null): boolean {
  const current = state();
  if (epoch !== eduPiRecallRootEpoch(root) || current.issued.has(details.receiptId)) return false;
  for (const previous of current.issued.values()) {
    if (previous.details.sessionId === details.sessionId) previous.invalidated = "turn_changed";
  }
  current.issued.set(details.receiptId, { root, epoch, details: structuredClone(details), termRef,
    request: request ? structuredClone(request) : null, invalidated: null });
  while (current.issued.size > 200) current.issued.delete(current.issued.keys().next().value!);
  return true;
}

export function readIssuedEduPiRecall(receiptId: string): Readonly<IssuedRecall> | null {
  return state().issued.get(receiptId) ?? null;
}

export function invalidateEduPiRecallSession(sessionId: string, reason = "turn_changed"): void {
  for (const issued of state().issued.values()) if (issued.details.sessionId === sessionId) issued.invalidated = reason;
}
