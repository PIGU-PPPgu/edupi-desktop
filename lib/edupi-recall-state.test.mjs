import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createJiti } from "jiti";

const state = await createJiti(import.meta.url).import("./edupi-recall-state.ts");
const queryHash = `sha256:${"1".repeat(64)}`;
const root = () => `/synthetic/r04-${randomUUID()}`;

test("private model correlation claims one exact active question and never authorizes a second IPC", () => {
  const project = root();
  try {
    const token = state.beginEduPiRecallQuestion(project, "intent-a", queryHash);
    assert.equal(state.claimEduPiRecallQuestion(project, `sha256:${"2".repeat(64)}`, "ipc-a"), null);
    assert.equal(state.claimEduPiRecallQuestion(root(), queryHash, "ipc-a"), null);
    assert.deepEqual(state.claimEduPiRecallQuestion(project, queryHash, "ipc-a"), { token, intentId: "intent-a" });
    assert.equal(state.claimEduPiRecallQuestion(project, queryHash, "ipc-a"), null);
    assert.equal(state.claimEduPiRecallQuestion(project, queryHash, "ipc-b"), null);
    state.finishEduPiRecallQuestion(token, true);
    assert.equal(state.claimEduPiRecallQuestion(project, queryHash, "ipc-b"), null);
    state.settleEduPiRecallModel(token, "wrong-ipc");
    assert.equal(state.claimEduPiRecallQuestion(project, queryHash, "ipc-b"), null);
    state.settleEduPiRecallModel(token, "ipc-a");
    assert.equal(state.claimEduPiRecallQuestion(project, queryHash, "ipc-b"), null);
    const next = state.beginEduPiRecallQuestion(project, "intent-b", queryHash);
    assert.deepEqual(state.claimEduPiRecallQuestion(project, queryHash, "ipc-b"), { token: next, intentId: "intent-b" });
  } finally { state.clearEduPiRecallQuestions(project); }
});

test("an unclaimed settled held answer releases correlation without consuming an intent", () => {
  const project = root();
  try {
    const held = state.beginEduPiRecallQuestion(project, "held-intent", queryHash);
    state.finishEduPiRecallQuestion(held, true);
    const next = state.beginEduPiRecallQuestion(project, "next-intent", queryHash);
    assert.deepEqual(state.claimEduPiRecallQuestion(project, queryHash, "next-ipc"), { token: next, intentId: "next-intent" });
  } finally { state.clearEduPiRecallQuestions(project); }
});

test("a cancelled unclaimed call cannot lend a late model packet to an identical next question", () => {
  const project = root();
  try {
    const cancelled = state.beginEduPiRecallQuestion(project, "cancelled", queryHash);
    state.finishEduPiRecallQuestion(cancelled, false);
    assert.equal(state.claimEduPiRecallQuestion(project, queryHash, "late-old-ipc"), null);
    state.beginEduPiRecallQuestion(project, "new-question", queryHash);
    assert.equal(state.claimEduPiRecallQuestion(project, queryHash, "late-or-new-ipc"), null);
    state.clearEduPiRecallQuestions(project);
    const fresh = state.beginEduPiRecallQuestion(project, "fresh-runtime-question", queryHash);
    assert.deepEqual(state.claimEduPiRecallQuestion(project, queryHash, "fresh-ipc"), { token: fresh, intentId: "fresh-runtime-question" });
  } finally { state.clearEduPiRecallQuestions(project); }
});

test("two same-text active questions fail closed and root draining preserves another root", () => {
  const first = root(), other = root();
  try {
    state.beginEduPiRecallQuestion(first, "first", queryHash);
    state.beginEduPiRecallQuestion(first, "second", queryHash);
    const separate = state.beginEduPiRecallQuestion(other, "other-owner", queryHash);
    assert.equal(state.claimEduPiRecallQuestion(first, queryHash, "ambiguous"), null);
    state.clearEduPiRecallQuestions(first);
    assert.deepEqual(state.claimEduPiRecallQuestion(other, queryHash, "other-ipc"), { token: separate, intentId: "other-owner" });
  } finally {
    state.clearEduPiRecallQuestions(first);
    state.clearEduPiRecallQuestions(other);
  }
});
