import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const guide = await readFile(new URL("./EduPiFirstRunGuide.tsx", import.meta.url), "utf8");
const shell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const prefs = await readFile(new URL("../lib/app-prefs.ts", import.meta.url), "utf8");
const css = await readFile(new URL("../app/edupi-first-run.css", import.meta.url), "utf8");
const rail = await readFile(new URL("./EduPiNavigationRail.tsx", import.meta.url), "utf8");

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

test("the first-run guide includes roster and preparation and checks saved results", () => {
  assert.match(guide, /"连接模型"/);
  assert.match(guide, /"确认教师资料"/);
  assert.match(guide, /"导入校历与课表"/);
  assert.match(guide, /"上传第一份材料"/);
  assert.match(guide, /"进入今天"/);
  assert.match(guide, /onOpenCalendar/);
  assert.match(guide, /onOpenMaterials/);
  assert.match(guide, /检查并继续/);
  assert.match(guide, /"导入学生名单"/);
  assert.match(guide, /"第一次备课"/);
  assert.match(guide, /const \[opened, setOpened\] = useState\(false\)/);
  assert.match(guide, /STEPS\.length/);
  assert.match(guide, />稍后再说</);
  assert.match(guide, /role="region"/);
  assert.doesNotMatch(guide, /aria-modal="true"/);
  assert.doesNotMatch(guide, /功能|价值|安全边界|工作原理|详细说明/);
});

test("AppShell persists completion, uses existing surfaces, and reopens from help", () => {
  assert.match(prefs, /edupiFirstRunGuideComplete: "edupi-first-run-guide-complete"/);
  assert.match(shell, /getPrefBool\(APP_PREF_KEYS\.edupiFirstRunGuideComplete, false\)/);
  assert.match(shell, /useEffect\(\(\) => \{\s*setFirstRunGuideOpen\(!getPrefBool\(APP_PREF_KEYS\.edupiFirstRunGuideComplete, false\)\);\s*\}, \[\]\)/s);
  assert.doesNotMatch(shell, /useState\(\(\) => \(\s*!getPrefBool/);
  assert.match(shell, /setPrefBool\(APP_PREF_KEYS\.edupiFirstRunGuideComplete, true\)/);
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
  assert.match(guide, /returnFocusRef\.current = document\.activeElement/);
  assert.match(guide, /requestAnimationFrame\(\(\) => returnTarget\?\.focus\(\)\)/);
  assert.match(guide, /event\.key !== "Escape"/);
  assert.doesNotMatch(guide, /event\.key !== "Tab"/);
  assert.match(guide, /role="region"/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.edupi-first-run__primary:focus-visible/);
});
