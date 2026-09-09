import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } });
const { EduPiGrowthWorkspace } = await jiti.import("./EduPiGrowthWorkspace.tsx");
const { EduPiTeachingMethodEditor } = await jiti.import("./EduPiTeachingMethodEditor.tsx");

test("frozen growth renders existing evidence but no mutation entry points", () => {
  const data = { continuity: { documents: [] }, tasks: [], dataSources: { growth: { present: true } }, workspace: "/isolated" };
  const skill = { skillId: "test", title: "已保存方法", lifecycleState: "trial", trialCount: 1, evidenceIds: ["evidence"], updatedAt: null, canReuse: false, details: { content: "保留方法正文", trials: [{at:null,outcome:"routed",prompt:"保留试用请求",evidence:[]}], files: [] } };
  for (const mutationEnabled of [false, true]) {
    const html = renderToStaticMarkup(React.createElement(EduPiGrowthWorkspace, { data, teachingSkills: { status: "ready", skills: [skill], mutationEnabled }, query: "", selectedObjectId: "growth:edupi", onOpenFile() {}, onTask() {}, onStartAgent() {} }));
    assert.match(html, /保留方法正文/);
    assert.match(html, /保留试用请求/);
    for (const label of ["新增教学方法", "试用此方法", "填写使用反馈"]) assert.equal(html.includes(label), mutationEnabled);
  }
  const editor = renderToStaticMarkup(React.createElement(EduPiTeachingMethodEditor, {onSaved() {}}));
  assert.match(editor, /当前教学方法不可编辑/);
  assert.doesNotMatch(editor, /<form|<button/);
});
