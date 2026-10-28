import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import postcss from "postcss";
import { parseHTML } from "linkedom";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const shellRoots = ["", "dark"].flatMap((theme) => ["", " is-navigation-collapsed", " has-desktop-drag-region", " is-navigation-collapsed has-desktop-drag-region"].map((state) =>
  parseHTML(`<html class="${theme}"><body><section class="edupi-teacher-shell${state}"></section></body></html>`).document.querySelector("section")));
const transitionKeywords = new Set(["ease", "ease-in", "ease-out", "ease-in-out", "linear", "step-start", "step-end", "normal", "allow-discrete"]);

function assertRootTransitions(text, file = "fixture") {
  postcss.parse(text).walkRules((rule) => {
    const declarations = rule.nodes.filter((node) => node.type === "decl" && ["transition", "transition-property"].includes(node.prop));
    if (!declarations.length) return;
    const shellSelectors = rule.selectors.filter((selector) => selector.includes("edupi-teacher-shell") && shellRoots.some((root) => root.matches(selector)));
    if (!shellSelectors.length) return;
    const reason = `${file}: ${shellSelectors.join(", ")} must apply its current rail width without advancing an animation frame`;
    for (const declaration of declarations) {
      // An unresolved var() can introduce another comma-separated transition.
      assert.ok(!/var\s*\(/i.test(declaration.value), `${reason}; unresolved transition variable`);
      const properties = declaration.prop === "transition-property" ? postcss.list.comma(declaration.value)
        : postcss.list.comma(declaration.value).flatMap((item) => {
          const explicit = postcss.list.space(item).filter((token) => /^-?[a-z][\w-]*$/i.test(token) && !transitionKeywords.has(token.toLowerCase()));
          return explicit.length ? explicit : ["all"];
        });
      for (const property of properties) assert.ok(!["all", "grid", "grid-template", "grid-template-columns", "inherit", "revert", "revert-layer"].includes(property.toLowerCase()), reason);
    }
  });
}

// Structural guard for the suspended-transition failure observed in WebKit.
// Actual rail/app rectangles still require the installed native CUA check.
test("primary rail geometry never waits on the root grid transition timeline", async () => {
  for (const file of ["../app/edupi-workbench.css", "../app/edupi-motion.css"]) assertRootTransitions(await read(file), file);
});

for (const [name, css] of [
  ["explicit grid", ".edupi-teacher-shell { transition: grid-template-columns 280ms ease; }"],
  ["implicit all", ".edupi-teacher-shell { transition: 280ms ease; }"],
  [":where root", ":where(.edupi-teacher-shell) { transition: grid-template-columns 280ms ease; }"],
  [":where implicit all", ":where(.edupi-teacher-shell) { transition: 280ms ease; }"],
  ["time-first grid", ".edupi-teacher-shell { transition: 280ms ease grid-template-columns; }"],
  ["mixed implicit all", ".edupi-teacher-shell { transition: opacity 100ms, 280ms ease; }"],
  ["shorthand variable", ":where(.edupi-teacher-shell) { transition: var(--root-transition); }"],
  ["property variable", ".edupi-teacher-shell { transition-property: var(--root-property); }"],
  ["unresolved duration variable", ".edupi-teacher-shell { transition: opacity var(--duration); }"],
]) {
  test(`root transition guard rejects ${name}`, () => {
    assert.throws(() => assertRootTransitions(css), /must apply its current rail width/);
  });
}

test("root transition guard allows none and explicit visual properties without targeting descendants", () => {
  for (const css of [
    ":where(.edupi-teacher-shell) { transition: none; }",
    ".edupi-teacher-shell { transition: opacity 280ms ease, color 100ms; }",
    ":where(.edupi-teacher-shell) { transition: 280ms cubic-bezier(.22, 1, .36, 1) opacity; }",
    ":is(.edupi-teacher-shell) { transition-property: opacity, color; }",
    ":where(.edupi-teacher-shell) button { transition: 280ms ease; }",
  ]) assert.doesNotThrow(() => assertRootTransitions(css));
});

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
  assert.match(panel, /EduPiObjectSider\b[^>]*hidden=\{!showObjectSider\}/);
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
