import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("every directly editable teacher object exposes the shared Core delete action", async () => {
  const [panel, calendar, memories, students, tasks, materials, views] = await Promise.all([
    read("./EduPiEducationPanel.tsx"),
    read("./EduPiCalendarWorkspace.tsx"),
    read("./EduPiMemoryDatabase.tsx"),
    read("./EduPiStudentWorkspace.tsx"),
    read("./EduPiTaskDetailDrawer.tsx"),
    read("./EduPiMaterialsWorkspace.tsx"),
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
  assert.match(memories, /setPage\(\(current\) => Math\.min\(current, Math\.max\(0, pages - 1\)\)\)/);

  assert.match(students, /onDeleteEntity/);
  assert.match(students, /onDeleteEntity\("student", selectedName, selectedName\)/);
  assert.match(students, /"删除"/);

  assert.match(tasks, /onDelete/);
  assert.match(tasks, /onDelete\(task\)/);
  assert.match(tasks, />删除任务</);

  assert.match(materials, /onDeleteEntity/);
  assert.match(materials, /onDeleteEntity\("material", selected\.id, selected\.title\)/);
  assert.match(materials, /删除材料/);
});

test("delete controls require an explicit named confirmation and show progress", async () => {
  const [panel, calendar, students] = await Promise.all([read("./EduPiEducationPanel.tsx"), read("./EduPiCalendarWorkspace.tsx"), read("./EduPiStudentWorkspace.tsx")]);
  assert.match(panel, /window\.confirm\(`确定删除“\$\{label\}”吗？`\)/);
  assert.match(panel, /Promise<boolean>/);
  assert.match(panel, /window\.confirm[\s\S]+?return false/);
  assert.match(panel, /return true/);
  assert.match(calendar, /const deleted = await onDeleteEntity/);
  assert.match(calendar, /if \(deleted\) closeDetail\(\)/);
  assert.match(students, /const deleted = await onDeleteEntity/);
  assert.match(students, /if \(!deleted\) return/);
  assert.match(panel, /setDeleteBusy/);
  assert.match(panel, /删除中/);
  assert.match(panel, /setEducation\(result\.data\)/);
});
