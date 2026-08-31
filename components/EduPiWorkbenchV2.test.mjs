import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("education modules start directly below navigation without the global top strip", async () => {
  const [panel, sider, css] = await Promise.all([
    read("./EduPiEducationPanel.tsx"),
    read("./EduPiObjectSider.tsx"),
    read("../app/edupi-workbench.css"),
  ]);
  assert.doesNotMatch(panel, /edupi-teacher-topbar/);
  assert.match(sider, /edupi-object-sider__search/);
  assert.match(sider, /onQuery/);
  assert.match(css, /\.edupi-teacher-app\s*\{[^}]*grid-template-rows:\s*minmax\(0, 1fr\)/s);
});

test("calendar separates content type and keeps editing inside the detail drawer", async () => {
  const calendar = await read("./EduPiCalendarWorkspace.tsx");
  assert.match(calendar, /type CalendarContentMode = "summary" \| "calendar" \| "timetable"/);
  for (const label of ["汇总", "校历", "课程表"]) assert.match(calendar, new RegExp(`label: "${label}"`));
  assert.match(calendar, /edupi-calendar-content-segment/);
  assert.match(calendar, /entry\.kind === contentMode/);
  assert.match(calendar, /embedded/);
  assert.match(calendar, /editor=\{/);
  assert.doesNotMatch(calendar, /setComposer\("calendar"\);\s*onSelect\(null\)/);
  assert.doesNotMatch(calendar, /setComposer\("timetable"\);\s*onSelect\(null\)/);
});

test("task board and task sidebar expose the same teacher-facing categories", async () => {
  const [board, sider, categories] = await Promise.all([
    read("./EduPiWorkspaceBoard.tsx"),
    read("./EduPiObjectSider.tsx"),
    read("../lib/edupi-task-category.ts"),
  ]);
  assert.match(board, /TASK_CATEGORY_CONFIG/);
  assert.match(board, /edupi-task-category-segment/);
  assert.match(sider, /groupTasksByCategory/);
  for (const label of ["教学准备", "学生跟进", "校历节点", "材料证据", "活动安排"]) {
    assert.match(`${board}\n${sider}\n${categories}`, new RegExp(label));
  }
});

test("class and student modules select one student and expose real import and export actions", async () => {
  const [panel, sider, views, student, route] = await Promise.all([
    read("./EduPiEducationPanel.tsx"),
    read("./EduPiObjectSider.tsx"),
    read("./EduPiWorkspaceViews.tsx"),
    read("./EduPiStudentWorkspace.tsx"),
    read("../app/api/edupi/students/import/route.ts"),
  ]);
  assert.match(panel, /selectedStudentId/);
  assert.match(panel, /onStudent=\{selectStudent\}/);
  assert.match(sider, /edupi-object-student/);
  assert.doesNotMatch(sider, /<details className="edupi-object-person"/);
  assert.match(views, /mode=\{props\.view\}/);
  for (const label of ["导入名单", "导出档案", "导出轨迹", "学习模式", "成长轨迹", "家校记录", "相关任务"]) assert.match(student, new RegExp(label));
  assert.match(student, /\/api\/edupi\/students\/import/);
  assert.match(route, /importStudentRoster/);
  assert.match(route, /readEducationContract/);
});
