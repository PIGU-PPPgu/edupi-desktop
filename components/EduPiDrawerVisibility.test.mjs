import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import postcss from "postcss";

const css = postcss.parse(fs.readFileSync(new URL("../app/edupi-workbench.css", import.meta.url), "utf8"));
const keyframes = new Map();
css.walkAtRules("keyframes", rule => keyframes.set(rule.params, rule));

for (const selector of [".edupi-workspace-drawer", ".edupi-task-detail-drawer"]) {
  test(`${selector} is opaque without advancing an entry animation`, () => {
    const declarations = new Map();
    for (const rule of css.nodes) {
      if (rule.type !== "rule" || !rule.selectors.includes(selector)) continue;
      rule.walkDecls(declaration => declarations.set(declaration.prop, declaration.value));
    }
    assert.equal(declarations.get("display"), "grid", "check the interactive drawer root");
    assert.equal(Number(declarations.get("opacity") ?? 1), 1);
    const animation = declarations.get("animation-name") ?? declarations.get("animation") ?? "none";
    for (const token of animation.split(/[\s,]+/)) {
      const frames = keyframes.get(token);
      if (!frames) continue;
      for (const frame of frames.nodes) {
        if (frame.type !== "rule" || !frame.selectors.some(position => position === "from" || position === "0%")) continue;
        frame.walkDecls("opacity", declaration => {
          assert.equal(Number(declaration.value), 1, "a suspended first frame must not hide the whole interaction surface");
        });
      }
    }
  });
}
