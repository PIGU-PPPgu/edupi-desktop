import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(fs.readFileSync(new URL("./SkillsConfig.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const skill = patch => ({ name: "fixture", description: "fixture", filePath: "/synthetic/skills/fixture/SKILL.md",
  baseDir: "/synthetic/skills/fixture", disableModelInvocation: false, sourceInfo: { source: "path" }, ...patch });

function fixture(selectedSkill) {
  const states = [[selectedSkill], false, null, selectedSkill.filePath, new Set(), null, false, {}, new Set(), false, null, null, true, {}];
  const requests = [];
  let cursor = 0;
  const exports = {};
  vm.runInNewContext(compiled, { exports, Set, fetch: async (url, options) => {
    requests.push({ url, ...options });
    return Response.json({ success: true });
  }, require(name) {
    if (name === "react") return { useState: () => {
      const index = cursor++;
      return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
    }, useCallback: callback => callback, useEffect() {}, useRef: value => ({ current: value }) };
    if (name === "react/jsx-runtime") return require(name);
    if (name === "@/hooks/useI18n") return { useI18n: () => ({ t: key => ({
      "i18n.skillReadOnly": "内置技能只读", "i18n.visibleInPrompt": "点击禁用", "i18n.hiddenFromPrompt": "点击启用",
    })[key] ?? key }) };
    if (name === "@/hooks/useIsMobile") return { useIsMobile: () => false };
    if (name === "@/hooks/useModalDismiss") return { useModalDismiss: () => ({ current: null }) };
    if (name === "@/lib/desktop-native") return { handleExternalLinkClick() {} };
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  cursor = 0;
  const tree = exports.SkillsConfig({ cwd: "/synthetic", onClose() {} });
  return { tree, requests };
}

function detail(element) {
  if (!React.isValidElement(element)) return null;
  if (element.type.name === "SkillDetail") return element;
  return React.Children.toArray(element.props.children).map(detail).find(Boolean);
}

test("read-only Core skills show a disabled toggle and a short read-only label", async () => {
  const selected = skill({ readOnly: true });
  const f = fixture(selected);
  const html = renderToStaticMarkup(f.tree);
  assert.ok(/disabled=""[^>]*title="内置技能只读"/.test(html), "Core toggle must be disabled and labelled read-only");
  await detail(f.tree).props.onToggle(selected);
  assert.deepEqual(f.requests, [], "a stale click handler must not submit a read-only mutation");
});

test("ordinary and legacy skills retain their editable toggle", async () => {
  for (const patch of [{ readOnly: false }, {}]) {
    const selected = skill(patch), f = fixture(selected);
    const html = renderToStaticMarkup(f.tree);
    assert.ok(html.includes('title="点击禁用"'));
    assert.ok(!html.includes('title="内置技能只读"'));
    await detail(f.tree).props.onToggle(selected);
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].method, "PATCH");
    assert.deepEqual(JSON.parse(f.requests[0].body), { filePath: selected.filePath, disableModelInvocation: true });
  }
});
