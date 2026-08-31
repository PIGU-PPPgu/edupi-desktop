import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const guide = await readFile(new URL("./EduPiFirstRunGuide.tsx", import.meta.url), "utf8");
const shell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const prefs = await readFile(new URL("../lib/app-prefs.ts", import.meta.url), "utf8");
const css = await readFile(new URL("../app/edupi-first-run.css", import.meta.url), "utf8");

test("the first-run guide has exactly three teacher-facing steps and can be skipped", () => {
  assert.match(guide, /"连接模型"/);
  assert.match(guide, /"确认教师资料"/);
  assert.match(guide, /"进入今天"/);
  assert.match(guide, /STEPS\.length/);
  assert.match(guide, />跳过</);
  assert.doesNotMatch(guide, /功能|价值|安全边界|工作原理|详细说明/);
});

test("AppShell persists completion, uses existing surfaces, and reopens from help", () => {
  assert.match(prefs, /edupiFirstRunGuideComplete: "edupi-first-run-guide-complete"/);
  assert.match(shell, /getPrefBool\(APP_PREF_KEYS\.edupiFirstRunGuideComplete, false\)/);
  assert.match(shell, /setPrefBool\(APP_PREF_KEYS\.edupiFirstRunGuideComplete, true\)/);
  assert.match(shell, /<EduPiFirstRunGuide/);
  assert.match(shell, /onOpenModels=\{\(\) => setModelsConfigOpen\(true\)\}/);
  assert.match(shell, /suspended=\{modelsConfigOpen \|\| edupiAdminOpen\}/);
  assert.match(shell, /onOpenContext=\{\(\) => setEduPiAdminOpen\(true\)\}/);
  assert.match(shell, /onEnterToday=\{\(\) => openEducationModule\("home"\)\}/);
  assert.match(shell, /id: "help-primary"[\s\S]*setFirstRunGuideOpen\(true\)/);
});

test("the guide captures and restores invoking focus, contains keyboard navigation, and reduces motion", () => {
  assert.match(guide, /primaryRef\.current\?\.focus\(\)/);
  assert.match(guide, /returnFocusRef\.current = document\.activeElement/);
  assert.match(guide, /requestAnimationFrame\(\(\) => returnTarget\?\.focus\(\)\)/);
  assert.match(guide, /event\.key === "Escape"/);
  assert.match(guide, /event\.key !== "Tab"/);
  assert.match(guide, /role="dialog"/);
  assert.match(guide, /aria-modal="true"/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.edupi-first-run__primary:focus-visible/);
});
