import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("primary and secondary EduPi sidebars collapse in place", async () => {
  const [panel, rail, prefs, css] = await Promise.all([
    read("./EduPiEducationPanel.tsx"),
    read("./EduPiNavigationRail.tsx"),
    read("../lib/app-prefs.ts"),
    read("../app/edupi-workbench.css"),
  ]);

  assert.match(prefs, /edupiNavigationRailCollapsed/);
  assert.match(panel, /APP_PREF_KEYS\.edupiNavigationRailCollapsed/);
  assert.match(panel, /is-navigation-collapsed/);
  assert.match(rail, /aria-label="收起主导航"/);
  assert.match(rail, /aria-label="展开主导航"/);

  assert.match(panel, /edupi-object-sider-strip/);
  assert.match(panel, /aria-label="展开列表"/);
  assert.match(panel, /is-object-sider-collapsed/);
  assert.doesNotMatch(panel, />列表<\/button>/);

  assert.match(css, /\.edupi-teacher-shell\.is-navigation-collapsed\s*\{[^}]*grid-template-columns:\s*22px minmax\(0, 1fr\)/s);
  assert.match(css, /\.edupi-teacher-body\.has-object-sider\.is-object-sider-collapsed\s*\{[^}]*grid-template-columns:\s*18px minmax\(0, 1fr\)/s);
  assert.match(css, /\.edupi-object-sider-strip\s*\{[^}]*border-right:\s*1px solid var\(--ep-border\)/s);
});
