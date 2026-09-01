import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("memory sidebar selects categories while the main database owns rows and pagination", async () => {
  const [sider, memory, navigation] = await Promise.all([
    read("./EduPiObjectSider.tsx"),
    read("./EduPiMemoryDatabase.tsx"),
    read("../lib/edupi-domain-navigation.ts"),
  ]);
  for (const label of ["学期", "学生", "教学", "教师偏好", "学校"]) assert.match(navigation, new RegExp(`label: "${label}"`));
  assert.match(sider, /MEMORY_CATEGORIES\.map/);
  assert.match(sider, /onObject\(`memory:\$\{category\.id\}`\)/);
  assert.doesNotMatch(sider, /onObject\(`memory:\$\{memory\.id\}`\)/);
  assert.match(memory, /PAGE_SIZE = 8/);
  assert.match(memory, /memoryCategoryRoute\(selectedObjectId\)/);
  assert.match(memory, /edupi-memory-db-grid/);
  assert.match(memory, /edupi-database-pagination/);
  assert.match(memory, /修订记忆/);
});

test("insights use primary categories, status filters, and a database table", async () => {
  const [sider, insights, navigation] = await Promise.all([
    read("./EduPiObjectSider.tsx"),
    read("./EduPiInsightDatabase.tsx"),
    read("../lib/edupi-domain-navigation.ts"),
  ]);
  for (const label of ["学情观察", "班级运行", "教学改进", "EduPi 后台", "已浮出", "酝酿中", "弱信号"]) assert.match(navigation, new RegExp(label));
  assert.match(sider, /INSIGHT_CATEGORIES\.map/);
  assert.match(sider, /INSIGHT_STATUSES\.map/);
  assert.match(insights, /edupi-insight-db-grid/);
  assert.match(insights, /PAGE_SIZE = 8/);
  assert.match(insights, /item\.evidence\.join\(" "\)/);
});

test("teaching, growth, and material sidebars expose domain categories instead of record cards", async () => {
  const [sider, navigation] = await Promise.all([read("./EduPiObjectSider.tsx"), read("../lib/edupi-domain-navigation.ts")]);
  assert.match(sider, /TEACHING_SECTIONS\.map/);
  assert.match(navigation, /教学首页/);
  assert.match(sider, /教师专业成长/);
  assert.match(sider, /EduPi 能力成长/);
  assert.match(sider, /MATERIAL_CATEGORIES\.map/);
  assert.match(sider, /const timetable = filterTimetableSlots\(data\.timetable, query\)/);
  assert.match(sider, /const subjectKnowledge = filterSubjectKnowledgeItems\(data\.continuity\.subjectKnowledge, query\)/);
  assert.match(sider, /section\.id === "schedule" \? timetable\.length/);
  assert.match(sider, /section\.id === "knowledge" \? subjectKnowledge\.length/);
});

test("teaching keeps a home route and the calendar exposes a ten-period weekday grid", async () => {
  const [teaching, timetable, calendar] = await Promise.all([
    read("./EduPiTeachingWorkspace.tsx"),
    read("./EduPiTimetableGrid.tsx"),
    read("./EduPiCalendarWorkspace.tsx"),
  ]);
  assert.match(teaching, /← 教学首页/);
  assert.match(teaching, /onObject\("teaching:home"\)/);
  assert.match(teaching, /本周课程/);
  assert.match(teaching, /EduPiTimetableGrid/);
  assert.match(teaching, /filterTimetableSlots\(data\.timetable, query\)/);
  assert.match(teaching, /onNavigate\("memory", "memory:teaching"\)/);
  assert.match(timetable, /length: 10/);
  for (const day of ["星期一", "星期二", "星期三", "星期四", "星期五"]) assert.match(timetable, new RegExp(day));
  assert.match(timetable, /period === 6 \? " is-afternoon-start"/);
  assert.match(timetable, /其他时段/);
  assert.match(timetable, /overflowSlots\.map/);
  assert.match(calendar, /contentMode === "timetable" \? <EduPiTimetableGrid/);
});

test("class workspace keeps the student directory mounted and opens a right drawer", async () => {
  const student = await read("./EduPiStudentWorkspace.tsx");
  assert.match(student, /localeCompare\(studentRecordName\(right\), "zh-CN"\)/);
  assert.match(student, /edupi-student-directory/);
  assert.match(student, /edupi-student-drawer/);
  assert.match(student, /EduPi 相关记忆/);
  assert.match(student, /补充学生档案/);
  assert.match(student, /onStudent\(null\)/);
  assert.doesNotMatch(student, /mode === "students" \? students\[0\] : null/);
  assert.match(student, /selected \? \[selected\] : data\.students/);
  assert.match(student, /const formElement = event\.currentTarget/);
  assert.match(student, /formElement\.reset\(\)/);
});

test("growth and materials use explicit databases and right-side material details", async () => {
  const [growth, materials, sider] = await Promise.all([read("./EduPiGrowthWorkspace.tsx"), read("./EduPiMaterialsWorkspace.tsx"), read("./EduPiObjectSider.tsx")]);
  assert.match(growth, /教师专业成长/);
  assert.match(growth, /EduPi 能力成长/);
  assert.match(growth, /用于改进 EduPi 的工作方式/);
  assert.match(growth, /confirmedTaskArtifacts\(data\.tasks, query\)/);
  assert.match(sider, /documents\.length \+ confirmedGrowthArtifacts\.length/);
  assert.match(materials, /edupi-material-db-grid/);
  assert.match(materials, /edupi-material-drawer/);
  assert.match(materials, /补充 \/ 修订/);
  assert.match(materials, /PAGE_SIZE = 8/);
});

test("review opens with a three-lane mini board and task stages are vertical on desktop", async () => {
  const [panel, board, task, css] = await Promise.all([read("./EduPiEducationPanel.tsx"), read("./EduPiReviewBoard.tsx"), read("./EduPiTaskWorkspace.tsx"), read("../app/edupi-workbench.css")]);
  assert.match(panel, /"board" \| "task" \| "c1"/);
  assert.match(panel, /reviewMode === "board" \? <EduPiReviewBoard/);
  assert.match(panel, /objectItemForView\(view, requestedObjectId \?\? selectedObjectId\)/);
  assert.match(panel, /<EduPiReviewBoard data=\{education\} query=\{query\}/);
  assert.match(board, /matchesWorkspaceQuery as match/);
  assert.match(board, /item\.evidenceIds\.join\(" "\)/);
  for (const label of ["任务审核", "观察确认", "记忆确认"]) assert.match(board, new RegExp(label));
  assert.match(task, /edupi-task-workspace__flow/);
  assert.match(css, /\.edupi-task-workspace__flow \{ display: grid; grid-template-columns: 180px minmax\(0, 1fr\)/);
  assert.match(css, /\.edupi-review-mini-board \{ display: grid; grid-template-columns: repeat\(3/);
});
