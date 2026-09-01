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
});

test("teaching, growth, and material sidebars expose domain categories instead of record cards", async () => {
  const [sider, navigation] = await Promise.all([read("./EduPiObjectSider.tsx"), read("../lib/edupi-domain-navigation.ts")]);
  assert.match(sider, /TEACHING_SECTIONS\.map/);
  assert.match(navigation, /教学首页/);
  assert.match(sider, /教师专业成长/);
  assert.match(sider, /EduPi 能力成长/);
  assert.match(sider, /MATERIAL_CATEGORIES\.map/);
});
