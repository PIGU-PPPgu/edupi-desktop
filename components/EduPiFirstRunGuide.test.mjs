import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import vm from "node:vm";

const guide = await readFile(new URL("./EduPiFirstRunGuide.tsx", import.meta.url), "utf8");
const shell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const prefs = await readFile(new URL("../lib/app-prefs.ts", import.meta.url), "utf8");
const css = await readFile(new URL("../app/edupi-first-run.css", import.meta.url), "utf8");
const rail = await readFile(new URL("./EduPiNavigationRail.tsx", import.meta.url), "utf8");

test("a resumed guide keeps its step while inline setup and back navigation work", async () => {
  let savedStep = "1", modelOpened = 0;
  const mount = () => {
    const values = []; let cursor = 0;
    const react = { useState(initial) { const i = cursor++; if (!(i in values)) values[i] = typeof initial === "function" ? initial() : initial; return [values[i], next => { values[i] = typeof next === "function" ? next(values[i]) : next; }]; }, useRef(value) { const i = cursor++; values[i] ??= { current: value }; return values[i]; }, useCallback(callback) { return callback; }, useEffect() {} };
    const jsx = (type, props) => ({ type, props }); const exports = {};
    vm.runInNewContext(ts.transpileModule(guide, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require: name => name === "react" ? react : name === "next/dynamic" ? { default: () => () => null } : name.includes("jsx-runtime") ? { jsx, jsxs: jsx } : name.includes("app-prefs") ? { APP_PREF_KEYS: { edupiFirstRunGuideStep: "step", edupiFirstRunWelcomeSeen: "welcome", edupiFirstRunGuideComplete: "complete" }, getPref: key => key === "step" ? savedStep : key === "welcome" ? "true" : "false", setPref: (key, value) => { if (key === "step") savedStep = value; } } : { readEduPiWorkspace: async () => ({ context: { configured: false } }) } });
    const render = () => { cursor = 0; return exports.EduPiFirstRunGuide({ onOpenModels: () => modelOpened++, onOpenContext() {}, onSkip() {} }); };
    const nodes = value => !value || typeof value !== "object" ? [] : Array.isArray(value) ? value.flatMap(nodes) : [value, ...nodes(value.props?.children)];
    return { render, button: text => nodes(render()).find(node => node.type === "button" && node.props.children === text), nodes: () => nodes(render()) };
  };
  const component = mount();
  component.button("填写教师资料").props.onClick();
  assert.equal(component.render().props.className, "edupi-first-run is-inline");
  component.button("跳过此步").props.onClick();
  assert.equal(savedStep, "2");
  component.button("上一步").props.onClick();
  assert.equal(savedStep, "1");
  component.button("上一步").props.onClick();
  assert.equal(savedStep, "0");
  assert.equal(component.button("上一步"), undefined);
  assert.equal(component.render().props.className, "edupi-first-run");
  const resumed = mount(); resumed.button("选择模型").props.onClick();
  assert.equal(resumed.render().props.className, "edupi-first-run is-inline");
  assert.equal(modelOpened, 0);
});

test("setup readiness follows saved roster and actual preparation artifacts", async () => {
  const { isGuideStepReady } = await createJiti(import.meta.url, {jsx:{runtime:"automatic"},tsconfigPaths:true}).import("./EduPiFirstRunGuide.tsx");
  const bundle = {context:{configured:false,checklist:[]},data:{students:[],timetable:[],workCases:[]}};
  assert.equal(isGuideStepReady(1,bundle),false);
  assert.equal(isGuideStepReady(2,bundle),false);
  bundle.data.students.push({name:"测试学生"});
  assert.equal(isGuideStepReady(2,bundle),true);
  bundle.data.workCases.push({kind:"teaching_before_class",artifactIds:[],currentState:"planned"});
  assert.equal(isGuideStepReady(5,bundle),false);
  bundle.data.workCases[0].artifactIds.push("artifact-1");
  bundle.data.workCases[0].currentState="draft_ready";
  assert.equal(isGuideStepReady(5,bundle),true);
});

test("first visit shows the product tour before setup and previews real destinations", async () => {
  const jiti = createJiti(import.meta.url, {jsx:{runtime:"automatic"},tsconfigPaths:true});
  const { EduPiFirstRunGuide } = await jiti.import("./EduPiFirstRunGuide.tsx");
  const { EduPiFirstRunPreview } = await jiti.import("./EduPiFirstRunPreview.tsx");
  const props = {onOpenModels(){},onOpenContext(){},onOpenCalendar(){},onOpenMaterials(){},onOpenStudents(){},onOpenTeaching(){},onEnterToday(){},onComplete(){},onSkip(){}};
  const first = renderToStaticMarkup(React.createElement(EduPiFirstRunGuide, props));
  assert.match(first, /role="dialog" aria-modal="true"/);
  assert.match(first, /Welcome To Edupi/);
  assert.match(first, /开始探索/);
  assert.doesNotMatch(first, /第 1 步，共 8 步/);
  assert.match(first, /data-shape="shelf"/);
  assert.match(first, /edupi-first-run__welcome-script/);
  assert.match(first, /你好，我是 EduPi。/);
  assert.match(first, /我想做你身边的教师助理/);
  assert.match(first, /希望你少一点赶工/);
  for (const [step, name] of [[-1,"EduPi"],[0,"AI 协作"],[2,"班级"],[3,"日程"],[4,"材料"],[5,"教学"]]) {
    const html = renderToStaticMarkup(React.createElement(EduPiFirstRunPreview, {step}));
    assert.match(html, new RegExp(name));
  }
});

test("the first-run guide includes roster and preparation and checks saved results", () => {
  assert.match(guide, /"连接模型"/);
  assert.match(guide, /"确认教师资料"/);
  assert.match(guide, /"导入行事历与课表"/);
  assert.match(guide, /<EduPiOnboardingCalendarUpload/);
  assert.match(guide, /"上传第一份材料"/);
  assert.match(guide, /"进入首页"/);
  assert.match(guide, /onOpenCalendar/);
  assert.match(guide, /onOpenMaterials/);
  assert.match(guide, /检查并继续/);
  assert.match(guide, /"导入学生名单"/);
  assert.match(guide, /"第一次备课"/);
  assert.match(guide, /const \[opened, setOpened\] = useState\(false\)/);
  assert.match(guide, /STEPS\.length/);
  assert.match(guide, />稍后再说</);
  assert.match(guide, /role=\{opened \? "region" : "dialog"\}/);
  assert.match(guide, /aria-modal=\{opened \? undefined : true\}/);
  assert.doesNotMatch(guide, /功能|价值|安全边界|工作原理|详细说明/);
});

test("AppShell persists completion, uses existing surfaces, and reopens from help", () => {
  assert.match(prefs, /edupiFirstRunGuideComplete: "edupi-first-run-guide-complete"/);
  assert.match(shell, /getPrefBool\(APP_PREF_KEYS\.edupiFirstRunGuideComplete, false\)/);
  assert.match(shell, /useEffect\(\(\) => \{\s*setFirstRunGuideOpen\(!getPrefBool\(APP_PREF_KEYS\.edupiFirstRunGuideComplete, false\)\);\s*\}, \[\]\)/s);
  assert.doesNotMatch(shell, /useState\(\(\) => \(\s*!getPrefBool/);
  assert.match(shell, /setPrefBool\(APP_PREF_KEYS\.edupiFirstRunGuideComplete, true\)/);
  assert.match(shell, /const pauseFirstRunGuide = useCallback\(\(\) => setFirstRunGuideOpen\(false\), \[\]\)/);
  assert.match(shell, /onComplete=\{finishFirstRunGuide\}/);
  assert.match(shell, /onSkip=\{pauseFirstRunGuide\}/);
  assert.match(shell, /<EduPiFirstRunGuide/);
  assert.match(shell, /onOpenModels=\{\(\) => openEduPiAdmin\("models"\)\}/);
  assert.match(shell, /onOpenContext=\{\(\) => \{ setEduPiAdminOpen\(false\); openEducationModule\("context"\); \}\}/);
  assert.match(shell, /onOpenCalendar=\{\(\) => openEducationView\("calendar"\)\}/);
  assert.match(shell, /onOpenMaterials=\{\(\) => openEducationView\("materials"\)\}/);
  assert.match(shell, /onEnterToday=\{\(\) => openEducationModule\("home"\)\}/);
  assert.match(shell, /id: "help-primary"[\s\S]*setFirstRunGuideOpen\(true\)/);
  assert.match(shell, /onOpenGuide=\{\(\) => setFirstRunGuideOpen\(true\)\}/);
  assert.match(rail, /aria-label="新手教程"/);
});

test("the guide restores invoking focus, supports Escape, and does not trap focus away from setup pages", () => {
  assert.match(guide, /primaryRef\.current\?\.focus\(\)/);
  assert.match(guide, /inlineRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(guide, /returnFocusRef\.current = document\.activeElement/);
  assert.match(guide, /requestAnimationFrame\(\(\) => returnTarget\?\.focus\(\)\)/);
  assert.match(guide, /event\.key === "Escape"/);
  assert.match(guide, /event\.key !== "Tab" \|\| opened/);
  assert.match(guide, /role=\{opened \? "region" : "dialog"\}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.edupi-first-run :is\(button\):focus-visible/);
  assert.match(css, /\.edupi-first-run\.is-opened \{[^}]*width: min\(650px, calc\(100vw - 32px\)\)/);
  assert.match(css, /\.edupi-first-run\.is-opened \{[^}]*inset: auto 16px 16px auto/);
  assert.match(css, /@media \(max-width: 760px\) \{[\s\S]*\.edupi-first-run\.is-opened[\s\S]*bottom: 8px/);
});
