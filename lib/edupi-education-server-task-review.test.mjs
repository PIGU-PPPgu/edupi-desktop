import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createJiti } from "jiti";

const { hasCommittedTaskReview } = await createJiti(import.meta.url).import("./edupi-task-refresh.ts");
const source = ts.createSourceFile("server.ts", fs.readFileSync(new URL("./edupi-education-server.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "reviewEducationTask");
const code = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

function fixture({ pending = false, mutate = () => {} } = {}) {
  const before = { id: "task-1", revision: 0, trigger: null, sourceEventId: "source-1", evidence: {}, reviewHistory: [],
    status: "planned", title: "原任务", dueDate: null, deliverables: [], reviewedAt: null, reviewer: null, reviewNote: null };
  const receipt = { receipt_id: "receipt-1", command_type: "review_task", decision: "accept", status: "accepted", external_send: false,
    target: { target_id: before.id, target_kind: "task", command_type: "review_task" }, rollback: { rollback_id: "review-1" },
    teacher_review: { revision: 1, state: "accepted", reviewer_id: "teacher", reviewed_at: "2026-11-06T10:00:00.000Z", note: null } };
  const task = { ...before, revision: 1, status: "accepted", scope: "teacher_internal", externalSend: false, requiresTeacherReview: true,
    reviewer: "teacher", reviewedAt: receipt.teacher_review.reviewed_at, reviewNote: null,
    reviewHistory: [] };
  const snapshot = value => ({ status: value.status, title: value.title, due_date: value.dueDate,
    deliverables: value.deliverables, reviewed_at: value.reviewedAt, reviewer: value.reviewer,
    review_note: value.reviewNote, revision: value.revision });
  task.reviewHistory = [{ review_id: "review-1", action: "accept", reviewer: "teacher", reviewed_at: task.reviewedAt, note: null,
    previous_status: before.status, next_status: task.status, changed_fields: ["status"],
    before: snapshot(before), after: snapshot(task) }];
  const data = { tasks: [task] };
  mutate(data);
  let projections = 0;
  const context = { exports: {}, hasCommittedTaskReview,
    readEduPiEducationSnapshot: async () => ({ payload: {}, runtime: {}, dataRoot: {} }),
    issueTaskReview: async () => ({ receipt, data: pending ? null : {}, refreshPending: pending,
      refreshRequirement: { before, decision: "accept", receipt, patch: null } }),
    refreshEducationContractAfterMutation: async () => { projections++; return data; },
    readEducationContract: async () => { throw new Error("unverified fallback must not be read"); },
  };
  vm.runInNewContext(code, context);
  return { run: () => context.exports.reviewEducationTask({ taskId: before.id }), projections: () => projections, data };
}

test("pending review is returned without an unverified workspace fallback", async () => {
  const state = fixture({ pending: true });
  const result = await state.run();
  assert.equal(result.receipt.status, "accepted");
  assert.equal(result.refreshPending, true);
  assert.equal(result.data, null);
  assert.equal(state.projections(), 0);
});

test("the occurrence-aware reread must still prove this exact review", async () => {
  const valid = fixture();
  assert.equal((await valid.run()).data, valid.data);
  for (const mutate of [
    data => { data.tasks = []; },
    data => { data.tasks[0].revision = 2; },
    data => { data.tasks[0].reviewHistory[0].review_id = "unrelated"; },
    data => { data.tasks[0].reviewer = "other"; },
    data => { data.tasks[0].sourceEventId = "other"; },
    data => { data.tasks.push(structuredClone(data.tasks[0])); },
  ]) {
    const state = fixture({ mutate });
    const result = await state.run();
    assert.equal(state.projections(), 1);
    assert.equal(result.data, null, mutate.toString());
    assert.equal(result.refreshPending, true);
    assert.equal(result.receipt.status, "accepted");
  }
});
