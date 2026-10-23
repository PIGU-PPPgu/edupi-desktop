import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postcss from "postcss";
import ts from "typescript";
import React, { act } from "react";
import { create } from "react-test-renderer";
import { createJiti } from "jiti";

const css = readFileSync(new URL("./edupi-disclosure.css", import.meta.url), "utf8");
const stylesheet = postcss.parse(css);
const exclusions = ":not(:where(.markdown-body *, .edupi-background-job-details > summary))";

test("shared disclosure styles preserve each summary's existing layout", () => {
  stylesheet.walkRules(rule => {
    if (!rule.selector.includes("summary") || rule.selector.includes("::")) return;
    rule.walkDecls(declaration => {
      assert.ok(!["display", "grid-template-columns", "grid-column", "flex-direction"].includes(declaration.prop), `${rule.selector} must preserve ${declaration.prop}`);
      assert.notEqual(declaration.important, true);
    });
  });
  const databaseRule = stylesheet.nodes.find(node => node.type === "rule" && node.selector.includes(".edupi-database-row > summary"));
  assert.ok(databaseRule);
  assert.equal(databaseRule.nodes.find(node => node.prop === "padding-inline-start")?.value, "14px");
});

test("marker, icon, and interaction rules exempt markdown and the icon-only trigger", () => {
  stylesheet.walkRules(rule => {
    if (!rule.selector.includes("summary")) return;
    for (const declaration of rule.nodes.filter(node => node.type === "decl")) {
      if (declaration.prop.startsWith("--")) continue;
      assert.ok(rule.selector.includes(exclusions), `${rule.selector} must exempt content-owned disclosures`);
    }
  });
  stylesheet.walkRules(rule => {
    if (!rule.selector.includes("[aria-expanded")) return;
    assert.ok(rule.selector.includes(".session-time-group__header[aria-expanded"));
  });
});

test("the single local chevron replaces old character arrows and respects reduced motion", () => {
  const variables = [];
  stylesheet.walkDecls("--edupi-disclosure-mask", declaration => variables.push(declaration.value));
  assert.equal(variables.length, 1);
  assert.ok(variables[0].startsWith('url("data:image/svg+xml,'));
  const svg = decodeURIComponent(variables[0].slice('url("data:image/svg+xml,'.length, -2));
  assert.match(svg, /fill='none'/);
  assert.match(svg, /stroke-width='1.5'/);
  assert.match(svg, /stroke-linecap='round'/);
  const workbench = postcss.parse(readFileSync(new URL("./edupi-workbench.css", import.meta.url), "utf8"));
  workbench.walkRules(rule => {
    if (!rule.selector.includes("summary::")) return;
    rule.walkDecls("content", declaration => assert.doesNotMatch(declaration.value, /[＋－›▶▼▸▾]/));
  });
  const reducedMotion = stylesheet.nodes.find(node => node.type === "atrule" && node.params === "(prefers-reduced-motion: reduce)");
  assert.ok(reducedMotion);
  let disabled = false;
  reducedMotion.walkDecls("transition", declaration => { disabled ||= declaration.value === "none"; });
  assert.equal(disabled, true);
});

test("the shared stylesheet loads after component styles", () => {
  const layout = readFileSync(new URL("./layout.tsx", import.meta.url), "utf8");
  const imports = [...layout.matchAll(/^import "(.+\.css)";/gm)].map(match => match[1]);
  assert.equal(imports.at(-1), "./edupi-disclosure.css");
});

test("reduced-motion chevrons override the existing important global duration precisely", () => {
  const nativeTheme = postcss.parse(readFileSync(new URL("./native-theme.css", import.meta.url), "utf8"));
  const globalDurations = [];
  nativeTheme.walkAtRules("media", media => {
    if (media.params !== "(prefers-reduced-motion: reduce)") return;
    media.walkDecls("transition-duration", declaration => {
      if (postcss.list.comma(declaration.parent.selector).includes("*::before")) globalDurations.push(declaration);
    });
  });
  assert.equal(globalDurations.length, 1);
  assert.equal(globalDurations[0].important, true);
  assert.ok(parseFloat(globalDurations[0].value) > 0, "the native theme's important duration is nonzero");
  assert.ok(postcss.list.comma(globalDurations[0].parent.selector).includes("*"), "the native duration also reaches the custom span icons");

  const overrides = [];
  stylesheet.walkDecls(declaration => { if (declaration.important) overrides.push(declaration); });
  assert.equal(overrides.length, 1, "only the chevron duration needs an important override");
  const override = overrides[0];
  assert.equal(override.prop, "transition-duration");
  assert.equal(override.value, "0s");
  assert.equal(override.parent.parent.params, "(prefers-reduced-motion: reduce)");
  for (const selector of postcss.list.comma(override.parent.selector)) {
    const customIcon = selector === ":root body button > .edupi-disclosure-icon:not(:where(.markdown-body *))";
    assert.ok(selector.startsWith(":root body ") && (selector.endsWith("::before") || customIcon), "a specific icon selector outranks the universal rule");
    assert.ok(selector.includes(`details > summary${exclusions}`) || selector.includes(".session-time-group__header[aria-expanded]") || customIcon, "the override only reaches shared chevrons");
  }
});

test("all six custom chevrons share the native mask and keep their existing button state", () => {
  const sharedMaskRule = stylesheet.nodes.find(node => node.type === "rule" && node.nodes.some(declaration => declaration.prop === "mask"));
  assert.ok(sharedMaskRule.selector.includes("summary"));
  assert.ok(sharedMaskRule.selector.includes(".edupi-disclosure-icon"));
  assert.equal(sharedMaskRule.nodes.find(declaration => declaration.prop === "width")?.value, "12px");
  assert.equal(sharedMaskRule.nodes.find(declaration => declaration.prop === "height")?.value, "12px");
  assert.equal(sharedMaskRule.nodes.find(declaration => declaration.prop === "transition")?.value, "transform 140ms ease");

  const cases = [["ChatWindow.tsx", "ProcessDetailsGroup", "first"], ["MessageView.tsx", "UserMessageView", "last"], ["MessageView.tsx", "CollapsibleUserText", "first"], ["MessageView.tsx", "ToolCallBlock", "last"], ["MessageView.tsx", "ThinkingBlock", "first"], ["SkillsConfig.tsx", "SkillsConfig", "first"]];
  for (const [file, name, position] of cases) {
    const source = ts.createSourceFile(file, readFileSync(new URL(`../components/${file}`, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const component = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(component, name);
    const icons = [];
    const visit = node => {
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === "span" && node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "className" && attribute.initializer?.getText(source) === '"edupi-disclosure-icon"')) icons.push(node);
      ts.forEachChild(node, visit);
    };
    visit(component);
    assert.equal(icons.length, 1, `${name} has one shared decorative icon`);
    const icon = icons[0];
    assert.ok(icon.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "aria-hidden" && attribute.initializer?.getText(source) === '"true"'));
    const button = icon.parent;
    assert.ok(ts.isJsxElement(button) && button.openingElement.tagName.getText(source) === "button");
    const attributes = button.openingElement.attributes.properties.filter(ts.isJsxAttribute);
    assert.equal(attributes.find(attribute => attribute.name.getText(source) === "aria-expanded")?.initializer?.getText(source), name === "SkillsConfig" ? "{dormantOpen}" : "{expanded}");
    assert.match(attributes.find(attribute => attribute.name.getText(source) === "onClick")?.initializer?.getText(source) || "", name === "ThinkingBlock" ? /void toggle\(\)/ : name === "SkillsConfig" ? /setDormantGroupsOpen/ : /setExpanded/);
    if (name === "SkillsConfig") assert.equal(attributes.find(attribute => attribute.name.getText(source) === "type")?.initializer?.getText(source), '"button"');
    const children = button.children.filter(child => !ts.isJsxText(child) || child.text.trim());
    assert.equal(position === "first" ? children[0] : children.at(-1), icon, `${name} keeps its icon placement`);
    assert.ok(!button.getText(source).includes("<svg"), `${name} has no second chevron`);
  }
});

test("the real thinking disclosure reads deferred content only when opened and reuses it", async t => {
  const original = { fetch: globalThis.fetch, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  const urls = [];
  let renderer;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.document = { documentElement: { lang: "en" }, compatMode: "CSS1Compat" };
  globalThis.fetch = async url => { urls.push(String(url)); return Response.json({ thinking: "隔离测试思考内容" }); };
  t.after(async () => {
    if (renderer) await act(async () => renderer.unmount());
    globalThis.fetch = original.fetch;
    if (original.document === undefined) delete globalThis.document; else globalThis.document = original.document;
    if (original.act === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT; else globalThis.IS_REACT_ACT_ENVIRONMENT = original.act;
  });
  const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
  const { MessageView } = await jiti.import("../components/MessageView.tsx");
  const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");
  await act(async () => {
    renderer = create(React.createElement(I18nProvider, null, React.createElement(MessageView, {
      message: { role: "assistant", provider: "test", model: "test", content: [{ type: "thinking", thinking: "", deferred: true }] },
      sessionId: "synthetic-disclosure-session", entryId: "synthetic-disclosure-entry",
    })));
  });
  const trigger = () => renderer.root.findAllByType("button").find(button => button.props["aria-expanded"] !== undefined);
  const click = async () => { await act(async () => { trigger().props.onClick(); await new Promise(resolve => setImmediate(resolve)); }); };
  assert.ok(trigger());
  assert.equal(trigger().props["aria-expanded"], false);
  assert.equal(urls.length, 0);
  assert.equal(trigger().findByProps({ className: "edupi-disclosure-icon" }).props["aria-hidden"], "true");
  await click();
  assert.equal(trigger().props["aria-expanded"], true);
  assert.deepEqual(urls, ["/api/sessions/synthetic-disclosure-session/entries/synthetic-disclosure-entry/thinking?blockIndex=0"]);
  assert.ok(JSON.stringify(renderer.toJSON()).includes("隔离测试思考内容"));
  await click();
  assert.equal(trigger().props["aria-expanded"], false);
  assert.ok(!JSON.stringify(renderer.toJSON()).includes("隔离测试思考内容"));
  await click();
  assert.equal(trigger().props["aria-expanded"], true);
  assert.ok(JSON.stringify(renderer.toJSON()).includes("隔离测试思考内容"));
  assert.equal(urls.length, 1, "reopening must not repeat deferred reads");
});
