import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { parseParentQuestionRecipientEntries, parentQuestionRefreshInput } = await jiti.import("./edupi-parent-question-recipient-client.ts");
const entry = { questionFactId: "question-1", questionRevision: 1, messageGeneration: 0, status: "needs_confirmation",
  candidate: { case_id: "case-1", question_fact_id: "question-1", question_revision: 1, student_id: "student-1",
    recipient_id: "parent-1", term_ref: "term-1", scope: { class_id: "class-1", subject: "math" },
    deadline_at: "2026-11-07T00:00:00.000Z", grant_version: 1,
    source_basis_hash: `sha256:${"a".repeat(64)}`, confirmation_plan_id: "plan-1",
    confirmation_text: "确认学生甲的家长沟通收件人是家长乙", confirmed_fact_id: null, message_ref: null } };

test("only source-bound Core question recipient entries are rendered", () => {
  assert.equal(parseParentQuestionRecipientEntries({ ok: true, externalSend: false, entries: [entry] }).length, 1);
  const stale = { ...entry, status: "stale_confirmed", candidate: { ...entry.candidate,
    confirmed_fact_id: "fact-confirmed", message_ref: `owner_message:${"b".repeat(64)}` } };
  assert.equal(parseParentQuestionRecipientEntries({ ok: true, externalSend: false, entries: [stale] })[0].status, "stale_confirmed");
  assert.throws(() => parseParentQuestionRecipientEntries({ ok: true, externalSend: true, entries: [entry] }));
  assert.throws(() => parseParentQuestionRecipientEntries({ ok: true, externalSend: false,
    entries: [{ ...entry, candidate: { ...entry.candidate, question_fact_id: "other" } }] }));
  assert.throws(() => parseParentQuestionRecipientEntries({ ok: true, externalSend: false,
    entries: [{ ...entry, status: "confirmed" }] }));
  assert.throws(() => parseParentQuestionRecipientEntries({ ok: true, externalSend: false,
    entries: [entry, entry] }));
});

test("source refresh reuses the current enabled parent scope and update token", () => {
  const state = { limits: { domain: "parent_communication" }, activation: { enabled: true,
    scope: { classId: "class-1", subject: "math" }, updatedAt: "2026-11-06T00:00:00.000Z" } };
  assert.deepEqual(parentQuestionRefreshInput(state), { enabled: true, domain: "parent_communication", classId: "class-1",
    subject: "math", expectedUpdatedAt: "2026-11-06T00:00:00.000Z" });
  assert.throws(() => parentQuestionRefreshInput({ ...state, activation: { ...state.activation, enabled: false } }));
  assert.throws(() => parentQuestionRefreshInput({ ...state, activation: { ...state.activation, scope: null } }));
  assert.throws(() => parentQuestionRefreshInput({ ...state, limits: { domain: "calendar_administration" } }));
});
