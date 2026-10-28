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

test("the actual home actions retain their supplied callbacks and open only the chosen task", async t => {
  const { create } = await jiti.import("react-test-renderer");
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer;
  t.after(async () => {
    if (renderer) await React.act(async () => renderer.unmount());
    if (previous === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    else globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  });
  const data = buildEducationContract({ workspace: "/tmp/edupi-home-launchpad-test", tasks: [
    { id: "synthetic-home-task", title: "合成近期任务", status: "planned", due_date: "2026-10-29" },
  ] });
  const calls = { search: 0, context: 0, conversation: 0, routes: [], tasks: [] };
  await React.act(async () => {
    renderer = create(React.createElement(EduPiForegroundContext.Provider, {
      value: { today: "2026-10-28", graceDays: 3, pinnedTaskIds: [] },
    }, React.createElement(DashboardView, {
      data, context: null, kernelState: { status: "empty", runs: [], running: 0, updatedAt: null }, runningAgentCount: 0,
      selectedObjectId: null, onEducation: noop, onObject: noop, onOpenFile: noop, onStartAgent: noop, onCalendarSelection: noop,
      onOpenQuickEntry: () => calls.search++, onOpenContext: () => calls.context++, onNewConversation: () => calls.conversation++,
      onNavigate: view => calls.routes.push(view), onTaskDetail: task => calls.tasks.push(task),
    })));
  });
  const text = node => typeof node === "string" ? node : Array.isArray(node) ? node.map(text).join("") : node?.children ? node.children.map(text).join("") : "";
  const buttons = () => renderer.root.findAllByType("button");
  const click = async predicate => {
    const button = buttons().find(predicate); assert.ok(button, "the actual requested home action exists");
    await React.act(async () => button.props.onClick());
  };
  await click(button => button.props["aria-label"] === "搜索任务与日程");
  await click(button => button.props["aria-label"] === "教学上下文");
  await click(button => text(button) === "新建对话");
  for (const label of ["打开对话", "课前准备", "学生档案", "材料整理", "工作区", "日程", "观察与洞察"]) await click(button => text(button).trim() === label);
  await click(button => button.props["aria-label"] === "打开任务：合成近期任务");
  assert.deepEqual([calls.search, calls.context, calls.conversation], [1, 1, 1]);
  assert.deepEqual(calls.routes, ["chat", "teaching", "students", "materials", "workspace", "calendar", "insights"]);
  assert.equal(calls.tasks.length, 1); assert.equal(calls.tasks[0], data.tasks[0]);
});
