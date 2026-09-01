import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("every directly editable teacher object exposes the shared Core delete action", async () => {
  const [panel, calendar, memories, students, tasks, views] = await Promise.all([
    read("./EduPiEducationPanel.tsx"),
    read("./EduPiCalendarWorkspace.tsx"),
    read("./EduPiMemoryDatabase.tsx"),
    read("./EduPiStudentWorkspace.tsx"),
    read("./EduPiTaskDetailDrawer.tsx"),
    read("./EduPiWorkspaceViews.tsx"),
  ]);

  assert.match(panel, /deleteEducationEntity/);
  assert.match(panel, /deleteEntity/);
  assert.match(panel, /onDeleteEntity=\{deleteEntity\}/);
  assert.match(views, /onDeleteEntity/);

  assert.match(calendar, /onDeleteEntity/);
  assert.match(calendar, /"删除"/);
  assert.match(calendar, /selection\.kind, selection\.sourceId/);

  assert.match(memories, /onDeleteEntity/);
  assert.match(memories, /onDeleteEntity\("memory", memory\.id, memory\.content\)/);
  assert.match(memories, /"删除"/);

  assert.match(students, /onDeleteEntity/);
  assert.match(students, /onDeleteEntity\("student", selectedName, selectedName\)/);
  assert.match(students, /"删除"/);

  assert.match(tasks, /onDelete/);
  assert.match(tasks, /onDelete\(task\)/);
  assert.match(tasks, />删除任务</);
});

test("delete controls require an explicit named confirmation and show progress", async () => {
  const panel = await read("./EduPiEducationPanel.tsx");
  assert.match(panel, /window\.confirm\(`确定删除“\$\{label\}”吗？`\)/);
  assert.match(panel, /setDeleteBusy/);
  assert.match(panel, /删除中/);
  assert.match(panel, /setEducation\(result\.data\)/);
});
