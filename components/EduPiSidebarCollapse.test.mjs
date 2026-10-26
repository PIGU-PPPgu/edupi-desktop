import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("primary and secondary EduPi sidebars collapse in place", async () => {
  const [panel, rail, prefs, css, restore, content] = await Promise.all([
    read("./EduPiEducationPanel.tsx"),
    read("./EduPiNavigationRail.tsx"),
    read("../lib/app-prefs.ts"),
    read("../app/edupi-workbench.css"),
    read("./EduPiObjectNavigationRestore.tsx"),
    read("./EduPiContentSider.tsx"),
  ]);

  assert.match(prefs, /edupiNavigationRailCollapsed/);
  assert.match(panel, /APP_PREF_KEYS\.edupiNavigationRailCollapsed/);
  assert.match(panel, /is-navigation-collapsed/);
  assert.match(rail, /aria-label=\{collapsed \? "展开主导航" : "收起主导航"\}/);
  assert.match(rail, /title=\{config\.label\}/);
  assert.match(rail, /aria-label="设置"/);
  assert.doesNotMatch(rail, /管理中心/);

  assert.doesNotMatch(panel, /edupi-object-sider-strip/);
  assert.match(panel, /EduPiObjectNavigationRestore/);
  assert.match(panel, /EduPiObjectSider hidden=\{!showObjectSider\}/);
  assert.match(content, /hidden=\{hidden\}/);
  assert.match(content, /inert=\{hidden\}/);
  assert.match(restore, /aria-label="展开列表"/);
  assert.match(restore, /createPortal\(button, header\)/);
  assert.match(panel, /is-object-sider-collapsed/);
  assert.doesNotMatch(panel, />列表<\/button>/);

  assert.match(css, /\.edupi-teacher-shell\.is-navigation-collapsed\s*\{[^}]*grid-template-columns:\s*58px minmax\(0, 1fr\)/s);
  assert.match(css, /\.edupi-teacher-rail\.is-collapsed \.edupi-teacher-rail__items\s*\{[^}]*display:\s*block/s);
  assert.match(css, /\.edupi-teacher-rail\.is-collapsed button\s*\{[^}]*min-height:\s*40px/s);
  assert.match(css, /\.edupi-teacher-rail\.is-collapsed \.edupi-teacher-rail__text\s*\{[^}]*display:\s*none/s);
  assert.doesNotMatch(css, /\.edupi-teacher-rail\.is-collapsed\s*>\s*:not\([^)]*restore[^)]*\)\s*\{[^}]*display:\s*none/s);
  assert.match(css, /\.edupi-teacher-body\.has-object-sider\.is-object-sider-collapsed\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.doesNotMatch(css, /edupi-object-sider-strip|grid-template-columns:\s*18px/);
  assert.match(css, /\.edupi-content-sider\[hidden\]\s*\{[^}]*display:\s*none !important/s);
  assert.match(css, /\[data-object-navigation-toolbar\]/);
});
