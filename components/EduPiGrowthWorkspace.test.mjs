import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } });
const { EduPiGrowthWorkspace } = await jiti.import("./EduPiGrowthWorkspace.tsx");
const { EduPiTeachingMethodEditor } = await jiti.import("./EduPiTeachingMethodEditor.tsx");

test("teacher growth lists reflections without reclassifying background reports as growth", () => {
  const data = { continuity: { documents: [
    { id: "weekly", kind: "weekly", title: "教学复盘", excerpt: "复盘", path: ".edupi/output/weekly/a.md", date: "2026-09-09" },
    { id: "insight", kind: "insight", title: "观察分析报告", excerpt: "观察", path: ".edupi/output/insight/a.md" },
    { id: "other", kind: "other", title: "后台运行日志", excerpt: "日志", path: ".edupi/output/other/a.md" },
  ] }, tasks: [], dataSources: { growth: { present: true } }, workspace: "/isolated" };
  const html = renderToStaticMarkup(React.createElement(EduPiGrowthWorkspace, { data, teachingSkills: { status: "ready", skills: [], mutationEnabled: false }, query: "", selectedObjectId: "growth:teacher", onOpenFile() {}, onTask() {}, onStartAgent() {} }));
  assert.match(html, /教学复盘/);
  assert.doesNotMatch(html, /观察分析报告|后台运行日志/);
});

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

test("growth feedback exposes a saved status callback", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("./EduPiGrowthWorkspace.tsx", import.meta.url), "utf8");
  assert.match(source, /savedFeedbackSkillId/);
  assert.match(source, /反馈已保存/);
  assert.match(source, /onSaved=\{\(\) => setSavedFeedbackSkillId\(item\.skillId\)\}/);
});
