import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("read-only task review offers active EduPi collaboration", async () => {
  const source = await read("./EduPiTaskStage.tsx");

  assert.match(source, /在 AI 协作中处理/);
  assert.match(source, /onClick=\{onOpenAgent\}/);
  assert.match(source, /blocked: boolean/);
  assert.match(source, /enabled && !blocked \?/);
  assert.match(source, /const reviewFields = enabled && !blocked \? \(/);
  assert.match(source, /\) : blocked \? null : \(/);
  assert.match(source, /\{reviewFields\}/);
  assert.match(source, /taskSessionBusy: boolean/);
  assert.match(source, /disabled=\{taskSessionBusy\}/);
  assert.match(source, /taskSessionBusy \? "正在准备" : "在 AI 协作中处理"/);
  assert.match(source, /taskSessionError/);
  assert.match(source, /className="edupi-agent-session__error" role="alert"/);
});

test("context review stays receipt-bound and limits editing to the frozen five fields", async () => {
  const editor = await read("./EduPiContextEditor.tsx");

  assert.match(editor, /onAgentRequest\?: \(prompt: string\) => void/);
  assert.match(editor, /candidate\?: EducationTeacherContextCandidate \| null/);
  assert.match(editor, /capability\?: TeacherContextReviewCapability \| null/);
  assert.match(editor, /TEACHER_CONTEXT_FIELDS/);
  assert.match(editor, /当前生效/);
  assert.match(editor, /待确认更新/);
  assert.match(editor, /已变更/);
  assert.match(editor, /maxLength=\{120\}/);
  assert.match(editor, /verifyTeacherContextReview/);
  assert.match(editor, /targetId: candidate\.contextId/);
  assert.match(editor, /expectedSnapshotId: candidate\.snapshotId/);
  assert.match(editor, /expectedRevision: candidate\.revision/);
  assert.match(editor, /patch,/);
  assert.match(editor, /reviewerId: reviewer/);
  assert.doesNotMatch(editor, /externalSend|external_send/);
  assert.doesNotMatch(editor, /onSaved|school|roles|classCount|studentCount|painPoint|isHomeroom/);
  assert.match(editor, /起草更新/);
  assert.match(editor, /放入对话/);
  assert.match(editor, /method: "PUT"/);
});

test("the education panel routes a context draft into the existing Chat composer", async () => {
  const panel = await read("./EduPiEducationPanel.tsx");

  assert.match(panel, /onAgentRequest=\{\(prompt\) => \{/);
  assert.match(panel, /setContextOpen\(false\)/);
  assert.match(panel, /startAgent\(prompt, "replace"\)/);
  assert.doesNotMatch(panel, /onAgentRequest=\{\(prompt\) => \{[\s\S]*?setDrawer\("agent"\)/);
});
