import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { buildEducationContract } = await jiti.import("./edupi-education-contract.ts");
const { projectTaskBoard, taskBoardLane, taskBoardTargets } = await jiti.import("./edupi-task-board.ts");

const contract = buildEducationContract({
  tasks: [
    { id: "todo-late", title: "整理下周学案", status: "planned", content_status: "not_generated", due_date: "2026-09-04", trigger: "calendar_event_internal", deliverables: ["学案核对清单"], evidence: {} },
    { id: "todo-early", title: "核对班级名单", status: "hold", content_status: "not_generated", due_date: "2026-09-01", trigger: "student_follow_up", student: "赵六", deliverables: [], evidence: {} },
    { id: "running", title: "分析第一次作业", status: "planned", content_status: "not_generated", due_date: "2026-09-02", trigger: "teaching_adjustment_candidate", topic: "移项", deliverables: [], evidence: {} },
    { id: "paused", title: "准备家长会材料", status: "planned", content_status: "not_generated", due_date: "2026-09-03", trigger: "student_follow_up", deliverables: [], evidence: {} },
    { id: "review", title: "形成下一课调整", status: "planned", content_status: "candidate_only", due_date: "2026-09-02", trigger: "teaching_adjustment_candidate", deliverables: ["调整候选"], evidence: {} },
    { id: "accepted", title: "中秋祝福准备", status: "accepted", content_status: "confirmed", reviewed_at: "2026-08-29T10:00:00.000Z", trigger: "festival", deliverables: ["祝福文字稿"], evidence: {} },
    { id: "rejected", title: "不再提醒工作总结", status: "rejected", content_status: "candidate_only", reviewed_at: "2026-08-28T10:00:00.000Z", trigger: "calendar_event_internal", deliverables: [], evidence: {} },
  ],
  taskSessions: {
    running: { taskId: "running", sessionId: "session-running", boundAt: "2026-08-30T08:00:00.000Z", status: "running" },
    paused: { taskId: "paused", sessionId: "session-paused", boundAt: "2026-08-29T08:00:00.000Z", status: "idle" },
  },
});

const pendingCandidate = { taskId: "paused", status: "pending_review" };
const completedCandidate = { taskId: "todo-late", status: "modified" };

test("derives task board lanes from canonical review, artifact, and agent-session state", () => {
  const byId = Object.fromEntries(contract.tasks.map((task) => [task.id, task]));
  assert.equal(taskBoardLane(byId.accepted, null), "done");
  assert.equal(taskBoardLane(byId.rejected, null), "done");
  assert.equal(taskBoardLane(byId.review, null), "review");
  assert.equal(taskBoardLane(byId.paused, contract.taskSessions.paused, pendingCandidate), "review");
  assert.equal(taskBoardLane(byId["todo-late"], null, completedCandidate), "done");
  assert.equal(taskBoardLane(byId.running, contract.taskSessions.running), "progress");
  assert.equal(taskBoardLane(byId.paused, contract.taskSessions.paused), "progress");
  assert.equal(taskBoardLane(byId["todo-early"], null), "todo");
});

test("projects four stable columns with useful ordering and no duplicate tasks", () => {
  const board = projectTaskBoard(contract.tasks, contract.taskSessions, [], "");
  assert.deepEqual(board.map((column) => [column.id, column.label, column.tasks.length]), [
    ["todo", "待处理", 2],
    ["progress", "进行中", 2],
    ["review", "待我确认", 1],
    ["done", "已完成", 2],
  ]);
  assert.deepEqual(board[0].tasks.map((task) => task.id), ["todo-early", "todo-late"]);
  assert.deepEqual(board[3].tasks.map((task) => task.id), ["accepted", "rejected"]);
  assert.equal(new Set(board.flatMap((column) => column.tasks.map((task) => task.id))).size, contract.tasks.length);
});

test("searches teacher-facing task context across every board column", () => {
  assert.deepEqual(projectTaskBoard(contract.tasks, contract.taskSessions, [], "赵六").flatMap((column) => column.tasks.map((task) => task.id)), ["todo-early"]);
  assert.deepEqual(projectTaskBoard(contract.tasks, contract.taskSessions, [], "移项").flatMap((column) => column.tasks.map((task) => task.id)), ["running"]);
  assert.deepEqual(projectTaskBoard(contract.tasks, contract.taskSessions, [], " 中秋 ").flatMap((column) => column.tasks.map((task) => task.id)), ["accepted"]);
});

test("uses the receipt-bound work-candidate lifecycle when task rows have not caught up", () => {
  const board = projectTaskBoard(contract.tasks, contract.taskSessions, [pendingCandidate, completedCandidate], "");
  assert.equal(board.find((column) => column.id === "review").tasks.some((task) => task.id === "paused"), true);
  assert.equal(board.find((column) => column.id === "done").tasks.some((task) => task.id === "todo-late"), true);
});

test("uses an explicit Core board stage and revision before derived Desktop state", () => {
  const task = buildEducationContract({ tasks: [{
    id: "core-board-stage",
    title: "Core 阶段任务",
    status: "planned",
    content_status: "not_generated",
    board_stage: "review",
    board_revision: 4,
    board_updated_at: "2026-08-30T09:30:00.000Z",
    deliverables: [],
    evidence: {},
  }] }).tasks[0];
  assert.equal(task.boardStage, "review");
  assert.equal(task.boardRevision, 4);
  assert.equal(task.boardUpdatedAt, "2026-08-30T09:30:00.000Z");
  assert.equal(taskBoardLane(task, { taskId: task.id, sessionId: "running", boundAt: "2026-08-30T09:00:00.000Z", status: "running" }, null), "review");
});

test("allows explicit completion from todo and progress without requiring a review move", () => {
  assert.deepEqual(taskBoardTargets("todo"), ["progress", "review", "done"]);
  assert.deepEqual(taskBoardTargets("progress"), ["todo", "review", "done"]);
  assert.deepEqual(taskBoardTargets("review"), ["progress", "done"]);
  assert.deepEqual(taskBoardTargets("done"), ["progress"]);
});

test("new reviews supersede old board stages while later manual reopening remains visible", () => {
  const base = contract.tasks[0];
  for (const status of ["accepted", "modified"]) {
    const task = { ...base, status, boardStage: "progress", boardRevision: 1, boardUpdatedAt: "2026-09-01T08:00:00Z", reviewedAt: "2026-09-01T09:00:00Z" };
    assert.equal(taskBoardLane(task, null), "done");
    assert.equal(taskBoardLane({ ...task, boardUpdatedAt: "2026-09-01T10:00:00Z" }, null), "progress");
  }
  assert.equal(taskBoardLane({ ...base, boardStage: "todo", boardRevision: 0, contentStatus: "draft_ready" }, null), "review");
  assert.equal(taskBoardLane({ ...base, boardStage: "done", boardRevision: 1 }, null), "done");
  assert.equal(base.status, "planned");
});

test("execution progress and failures do not masquerade as generated review drafts", () => {
  const base = { ...contract.tasks[0], boardStage: "todo", boardRevision: 0 };
  for (const contentStatus of ["generating", "running", "queued", " GENERATING "]) {
    assert.equal(taskBoardLane({ ...base, contentStatus }, null, { status: "pending_review" }), "progress");
    assert.equal(taskBoardLane({ ...base, boardStage: "progress", contentStatus }, null), "progress");
  }
  for (const contentStatus of ["generation_failed", "failed", "error"]) {
    assert.equal(taskBoardLane({ ...base, contentStatus }, null), "todo");
    assert.equal(taskBoardLane({ ...base, boardStage: "review", contentStatus }, null, { status: "pending_review" }), "todo");
    assert.equal(taskBoardLane({ ...base, boardStage: "progress", contentStatus }, null), "progress");
  }
  for (const contentStatus of ["unavailable", "unknown_state"]) assert.equal(taskBoardLane({ ...base, contentStatus }, null), "todo");
  for (const contentStatus of ["candidate_only", "draft_ready", "candidate_ready", "ready", "confirmed"]) assert.equal(taskBoardLane({ ...base, contentStatus }, null), "review");
});

test("manual board moves and accepted reviews retain priority over execution labels", () => {
  for (const contentStatus of ["generating", "generation_failed"]) {
    const base = { ...contract.tasks[0], contentStatus };
    assert.equal(taskBoardLane({ ...base, boardStage: "done", boardRevision: 1 }, null), "done");
    assert.equal(taskBoardLane({ ...base, boardStage: "review", boardRevision: 1 }, null), "review");
    assert.equal(taskBoardLane({ ...base, status: "accepted" }, null), "done");
    assert.equal(taskBoardLane(base, null, { status: "modified" }), "done");
  }
});

test("an explicit todo choice overrides the session-derived progress lane after reread", () => {
  const task = { ...contract.tasks[0], boardStage: "todo", boardRevision: 0 };
  const session = { taskId: task.id, sessionId: "bound-session", status: "idle", boundAt: "2026-09-09T10:00:00Z" };
  assert.equal(taskBoardLane(task, session), "progress");
  assert.equal(taskBoardLane({ ...task, boardRevision: 1, boardUpdatedAt: "2026-09-09T11:00:00Z" }, session), "todo");
});
