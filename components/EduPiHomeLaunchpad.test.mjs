import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { renderToStaticMarkup } from "react-dom/server";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } });
const React = await jiti.import("react");
const { DashboardView } = await jiti.import("./EduPiWorkspaceViews.tsx");
const { EduPiForegroundContext } = await jiti.import("./EduPiForeground.tsx");
const { buildEducationContract } = await jiti.import("../lib/edupi-education-contract.ts");
const noop = () => {};

function renderHomeTasks(tasks, policy = {}, tasksAvailable = true) {
  const data = buildEducationContract({ workspace: "/tmp/edupi-home-launchpad-test", tasks });
  data.dataSources.tasks.status = tasksAvailable ? data.tasks.length ? "ready" : "empty" : "unavailable";
  const before = JSON.stringify(data.tasks);
  const html = renderToStaticMarkup(React.createElement(EduPiForegroundContext.Provider, {
    value: { today: "2026-10-28", graceDays: 3, pinnedTaskIds: [], ...policy },
  }, React.createElement(DashboardView, {
    data, context: null, kernelState: { status: "empty", runs: [], running: 0, updatedAt: null },
    runningAgentCount: 0, selectedObjectId: null, onEducation: noop, onTaskDetail: noop,
    onNavigate: noop, onNewConversation: noop, onOpenContext: noop, onOpenQuickEntry: noop,
    onOpenFile: noop, onStartAgent: noop, onCalendarSelection: noop, onObject: noop,
  })));
  assert.equal(JSON.stringify(data.tasks), before, "render must not reorder or mutate source tasks");
  const start = html.indexOf('<section class="edupi-home-recent"');
  assert.notEqual(start, -1);
  return html.slice(start, html.indexOf("</section>", start));
}

test("home shortcuts keep future preparation available and exclude completed work", () => {
  const html = renderHomeTasks([
    { id: "done", title: "已完成任务", status: "accepted", due_date: "2026-10-28" },
    { id: "future", title: "明天的课前准备", status: "planned", due_date: "2026-10-29" },
  ]);
  assert.match(html, /aria-label="打开任务：明天的课前准备"/);
  assert.doesNotMatch(html, /已完成任务/);
});

test("old unpinned work is excluded while an explicitly pinned task remains reachable", () => {
  const tasks = [{ id: "old", title: "旧日期任务", status: "planned", due_date: "2026-09-01" }];
  assert.match(renderHomeTasks(tasks), /暂无待处理任务/);
  assert.match(renderHomeTasks(tasks, { pinnedTaskIds: ["old"] }), /aria-label="打开任务：旧日期任务"/);
});

test("a newer explicit reopen follows the same state as the task board", () => {
  const html = renderHomeTasks([{ id: "reopened", title: "重新打开的任务", status: "accepted", due_date: "2026-10-28", reviewed_at: "2026-10-27T01:00:00Z", board_stage: "progress", board_revision: 2, board_updated_at: "2026-10-28T01:00:00Z" }]);
  assert.match(html, /aria-label="打开任务：重新打开的任务"/);
});

test("empty shortcuts keep a real workspace action without fabricated tasks", () => {
  const html = renderHomeTasks([]);
  assert.match(html, /暂无待处理任务/);
  assert.match(html, /全部任务/);
  assert.doesNotMatch(html, /aria-label="打开任务：/);
});

test("unknown deadlines remain unknown and full task names remain accessible", () => {
  const title = "一项名称很长但仍需完整保留的真实教师任务";
  const html = renderHomeTasks([{ id: "unknown-date", title, status: "planned" }]);
  assert.ok(html.includes(`aria-label="打开任务：${title}"`));
  assert.match(html, /日期待确认/);
});

test("an unavailable task source is not presented as an empty completed queue", () => {
  const html = renderHomeTasks([], {}, false);
  assert.match(html, /任务暂不可用/);
  assert.doesNotMatch(html, /暂无待处理任务/);
});
