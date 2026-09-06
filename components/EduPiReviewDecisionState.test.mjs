import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("recorded review decisions collapse actions and can be deliberately changed", async () => {
  const [today, taskStage, legacyTaskCard, css] = await Promise.all([
    read("./EduPiTodayWork.tsx"),
    read("./EduPiTaskStage.tsx"),
    read("./EduPiReviewTaskCard.tsx"),
    read("../app/edupi-workbench.css"),
  ]);

  assert.match(today, /candidate\.status !== "pending_review"/);
  assert.match(today, /changingDecisionId/);
  assert.match(today, />修改决定</);
  assert.match(today, /showActions && capability\.enabled/);
  assert.match(taskStage, /task\.status !== "planned"/);
  assert.match(taskStage, /decisionRecorded && !changingDecision/);
  assert.match(taskStage, />修改决定</);
  assert.match(taskStage, /blocked \|\| enabled \? null/);
  assert.match(legacyTaskCard, /decisionRecorded && !changingDecision/);
  assert.match(css, /\.edupi-review-decision\.is-accepted/);
  assert.match(css, /\.edupi-today-work__decision\.is-accepted/);
});
