import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } });
const { buildEducationContract } = await jiti.import("../lib/edupi-education-contract.ts");
const { EduPiReviewBoard } = await jiti.import("./EduPiReviewBoard.tsx");
const { EduPiMemoryDatabase } = await jiti.import("./EduPiMemoryDatabase.tsx");
const { EduPiGrowthWorkspace } = await jiti.import("./EduPiGrowthWorkspace.tsx");
const { EduPiMaterialsWorkspace } = await jiti.import("./EduPiMaterialsWorkspace.tsx");
const { EduPiObjectSider } = await jiti.import("./EduPiObjectSider.tsx");
const noop = () => {};
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));
const review = (data, query = "", selectedObjectId = "review:board") => render(EduPiReviewBoard, {
  data, query, selectedObjectId, reviewer: "synthetic-teacher", onTask: noop, onReviewTarget: noop, onEducation: noop, onObject: noop,
});

test("an empty review page has one status instead of five empty groups", () => {
  const html = review(buildEducationContract());
  assert.match(html, /role="status">暂无待确认事项/);
  assert.doesNotMatch(html, /edupi-review-mini-board|<h2>/);
  assert.doesNotMatch(review(buildEducationContract(), "", "review:list:facts"), /列表分页|上一页|下一页/);
});

test("review navigation keeps its entry points while omitting empty content groups", () => {
  const data = buildEducationContract();
  const props = { view: "review", data, context: null, memoryScopes: null, teachingSkills: { skills: [], teacherGrowth: [] }, query: "", selectedStudentId: null, selectedObjectId: null, selectedTaskKey: null, onQuery: noop, onStudent: noop, onObject: noop, onTask: noop, onUpload: noop, onCollapse: noop };
  const empty = render(EduPiObjectSider, props);
  assert.match(empty, /审核看板|事实确认/);
  assert.doesNotMatch(empty, /暂无待确认内容|暂无待审核任务|审核内容|任务审核/);
  data.observations = [{ observationId: "synthetic-observation", text: "合成课堂观察", studentIds: [], evidenceIds: [], provenance: [], teacherReview: { state: "pending_review" } }];
  const pending = render(EduPiObjectSider, props);
  assert.match(pending, /审核内容/);
  assert.match(pending, /合成课堂观察/);
});

test("review groups contain only available work and search keeps a distinct empty state", () => {
  const data = buildEducationContract();
  data.observations = [{ observationId: "synthetic-observation", text: "合成课堂观察", evidenceIds: [], teacherReview: { state: "pending_review" } }];
  const html = review(data);
  assert.match(html, /<h2>观察确认<\/h2>/);
  assert.match(html, /合成课堂观察/);
  assert.doesNotMatch(html, /<h2>任务审核|<h2>事实确认|<h2>记忆确认/);
  assert.match(review(data, "不存在"), /未找到待确认事项/);
});

test("reviewed follow-ups remain reachable when no pending group exists", () => {
  const data = buildEducationContract();
  data.followUps = [{ followUpId: "synthetic-follow-up", title: "合成跟进", internalDraftSummary: "已处理", teacherReview: { state: "accepted" } }];
  const html = review(data);
  assert.match(html, /跟进历史/);
  assert.doesNotMatch(html, /edupi-review-mini-board/);
  assert.match(review(data, "", "review:list:followups-history"), /合成跟进/);
});

test("memory search does not claim its category is empty or show a dead pager", () => {
  const html = render(EduPiMemoryDatabase, { data: buildEducationContract(), memoryScopes: null, query: "不存在", selectedObjectId: "memory:teaching", onEducation: noop, onStartAgent: noop, onDeleteEntity: noop });
  assert.match(html, /未找到匹配记忆/);
  assert.doesNotMatch(html, /此分类暂无记忆|edupi-database__head|aria-label="记忆分页"/);
});

const readySkills = { status: "ready", skills: [], teacherGrowth: [], mutationEnabled: true };
function growth(teachingSkills, query, selectedObjectId) {
  return render(EduPiGrowthWorkspace, { data: buildEducationContract(), teachingSkills, query, selectedObjectId, onOpenFile: noop, onTask: noop, onStartAgent: noop, onTeachingSkills: noop });
}
test("growth search and unavailable methods produce different states", () => {
  assert.match(growth(readySkills, "不存在", "growth:teacher"), /未找到匹配记录/);
  const methods = growth(readySkills, "不存在", "growth:edupi");
  assert.match(methods, /未找到匹配方法/);
  assert.doesNotMatch(methods, /edupi-database__head/);
  const unavailable = growth({ ...readySkills, status: "unavailable", mutationEnabled: false }, "不存在", "growth:edupi");
  assert.match(unavailable, /教学方法暂不可用/);
  assert.doesNotMatch(unavailable, /未找到匹配方法/);
});

function materials(data, query) {
  return render(EduPiMaterialsWorkspace, { data, context: null, query, selectedObjectId: "materials:all", onObject: noop, stagedMaterials: [], stagingBusy: false, stagingMessage: null, onTask: noop, onUpload: noop, onIntakeMaterial: noop, onRemoveStagedMaterial: noop, onOpenFile: noop, onStartAgent: noop, onEducation: noop, onDeleteEntity: noop });
}
test("material search distinguishes unavailable indexing and hides an empty table header", () => {
  const data = buildEducationContract();
  assert.match(materials(data, "不存在"), /材料索引尚未接入/);
  data.dataSources.materials.present = true;
  const html = materials(data, "不存在");
  assert.match(html, /未找到匹配材料/);
  assert.doesNotMatch(html, /edupi-database__head|aria-label="材料分页"|数据已连接/);
  assert.match(html, /class="is-primary"[^>]*>上传材料/);
});
