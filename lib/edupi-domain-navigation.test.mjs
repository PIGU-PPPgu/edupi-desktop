import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const navigation = await createJiti(import.meta.url).import("./edupi-domain-navigation.ts");

test("exposes the teacher-facing memory and teaching categories in order", () => {
  assert.deepEqual(navigation.MEMORY_CATEGORIES.map((item) => item.label), ["学期", "学生", "教学", "教师偏好", "学校"]);
  assert.deepEqual(navigation.TEACHING_SECTIONS.map((item) => item.label), ["教学首页", "课程表", "教学重点", "备课任务", "教学记忆"]);
});

test("classifies insights and materials into one stable category", () => {
  assert.equal(navigation.insightCategory("学生移项错因连续出现"), "learning");
  assert.equal(navigation.insightCategory("家校沟通与班级安全"), "class");
  assert.equal(navigation.insightCategory("下一节课堂教学调整"), "teaching");
  assert.equal(navigation.insightCategory("后台提醒策略"), "edupi");
  assert.equal(navigation.materialCategory({ materialKind: "assessment", title: "单元检测" }), "assessment");
  assert.equal(navigation.materialCategory({ title: "课堂观察记录" }), "classroom");
  const materials = [{ materialKind: "assessment", title: "单元检测" }, { title: "备课杂项" }];
  assert.equal(navigation.materialCategoryCount("all", materials, 2), 4);
  assert.equal(navigation.materialCategoryCount("assessment", materials, 2), 1);
  assert.equal(navigation.materialCategoryCount("other", materials, 2), 3);
});

test("parses category routes without exposing record ids", () => {
  assert.equal(navigation.routePart("memory:semester", "memory", "semester"), "semester");
  assert.equal(navigation.routePart("memory:item-1", "insights", "all"), "all");
});

test("keeps category routes for every database-style workspace", () => {
  for (const view of ["teaching", "memory", "insights", "growth", "materials"]) {
    assert.equal(navigation.viewKeepsObjectItem(view), true, view);
  }
  for (const view of ["home", "calendar", "students", "tasks", "review"]) {
    assert.equal(navigation.viewKeepsObjectItem(view), false, view);
  }
});

test("keeps confirmed EduPi growth themes visibly confirmed", () => {
  assert.equal(navigation.growthReviewStateLabel("accepted"), "已确认");
  assert.equal(navigation.growthReviewStateLabel("confirmed"), "已确认");
  assert.equal(navigation.growthReviewStateLabel("pending_review"), "待验证");
});
