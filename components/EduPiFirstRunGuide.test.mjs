import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const guide = await readFile(new URL("./EduPiFirstRunGuide.tsx", import.meta.url), "utf8");
const shell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const prefs = await readFile(new URL("../lib/app-prefs.ts", import.meta.url), "utf8");
const css = await readFile(new URL("../app/edupi-first-run.css", import.meta.url), "utf8");
const rail = await readFile(new URL("./EduPiNavigationRail.tsx", import.meta.url), "utf8");

test("the first-run guide walks through five real setup surfaces without blocking them", () => {
  assert.match(guide, /"连接模型"/);
  assert.match(guide, /"确认教师资料"/);
  assert.match(guide, /"导入校历与课表"/);
  assert.match(guide, /"上传第一份材料"/);
  assert.match(guide, /"进入今天"/);
  assert.match(guide, /onOpenCalendar/);
  assert.match(guide, /onOpenMaterials/);
  assert.match(guide, /完成，下一步/);
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
