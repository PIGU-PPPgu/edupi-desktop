import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createJiti } from "jiti";
import React from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { ProjectPicker, selectVisibleProjects, shouldShowProjectFilter } = await jiti.import("./ProjectPicker.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");
const { getLocalePlugin } = await jiti.import("../lib/i18n/registry.ts");
const { translateMessage } = await jiti.import("../lib/i18n/format.ts");
const { displayCwd, PathLabel } = await jiti.import("./path-ui.tsx");
const messages = Object.fromEntries(["zh-CN", "en"].map(locale => [locale, getLocalePlugin(locale).messages]));
const compiled = ts.transpileModule(readFileSync(new URL("./ProjectPicker.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value?.props ? [value, ...nodes(value.props.children)] : [];
const text = value => typeof value === "string" || typeof value === "number" ? String(value) : Array.isArray(value) ? value.map(text).join("") : value?.props ? text(value.props.children) : "";
const tick = () => new Promise(resolve => setImmediate(resolve));

const many = Array.from({ length: 12 }, (_, i) => `/work/project-${i}`);

test("caps the unfiltered list but offers a filter once projects exceed the cap", () => {
  assert.equal(shouldShowProjectFilter(many.slice(0, 7)), false);
  assert.equal(shouldShowProjectFilter(many), true);
  assert.equal(selectVisibleProjects(many, null, "").length, 7);
});

test("filtering searches the whole list, not just the capped rows", () => {
  // project-9 sits past the cap, so this is the regression that made every
  // project beyond the 7th unreachable when the filter box was dropped.
  assert.deepEqual(selectVisibleProjects(many, null, "project-9"), ["/work/project-9"]);
  assert.ok(!selectVisibleProjects(many, null, "").includes("/work/project-9"));
});

test("filtering is case-insensitive, trimmed, and returns every match", () => {
  assert.deepEqual(selectVisibleProjects(["/work/Alpha", "/work/beta"], null, "  ALP "), ["/work/Alpha"]);
  // project-1, project-10 and project-11 all match, and all three are returned
  // even though only project-1 is inside the cap.
  assert.deepEqual(
    selectVisibleProjects(many, null, "project-1"),
    ["/work/project-1", "/work/project-10", "/work/project-11"],
  );
  assert.deepEqual(selectVisibleProjects(many, null, "nothing"), []);
});

test("the selected project stays visible even when it falls outside the cap", () => {
  const visible = selectVisibleProjects(many, "/work/project-11", "");
  assert.equal(visible.length, 7);
  assert.ok(visible.includes("/work/project-11"));
});

test("a selected project already inside the cap is not duplicated", () => {
  const visible = selectVisibleProjects(many, "/work/project-2", "");
  assert.equal(visible.filter((p) => p === "/work/project-2").length, 1);
  assert.equal(visible.length, 7);
});

function mount({ locale = "zh-CN", desktop = true, nativePath = "/work/chosen", responses = [], ...props } = {}) {
  const slots = [], requests = [], nativeCalls = [], selected = [];
  let cursor = 0, tree;
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
    useCallback(callback) { return callback; }, useEffect() {},
  };
  const AnimatedDropdown = ({ open, children }) => open ? jsx("div", { children }) : null;
  const DirectoryPicker = () => jsx("div", { "data-directory-picker": true });
  const modules = {
    react: hooks, "react/jsx-runtime": { jsx, jsxs, Fragment: React.Fragment }, "./DirectoryPicker": { DirectoryPicker },
    "./path-ui": { AnimatedDropdown, PathLabel, displayCwd },
    "@/lib/desktop-updater": { isTauriDesktop: () => desktop },
    "@/lib/desktop-window": { selectDirectoryNative: async start => { nativeCalls.push(start); return nativePath; } },
    "@/hooks/useI18n": { useI18n: () => ({ t: key => translateMessage(locale, key, messages) }) },
  };
  const exports = {};
  vm.runInNewContext(compiled, { exports, window: { innerHeight: 900 }, Error,
    require(name) { assert.ok(modules[name], name); return modules[name]; },
    fetch: async (url, options) => {
      requests.push({ url, options }); const value = responses.shift(); assert.ok(value, `synthetic response for ${url}`);
      return { ok: !value.error, status: value.error ? 400 : 200, json: async () => value };
    },
  });
  const f = {
    requests, nativeCalls, selected,
    render() { cursor = 0; tree = exports.ProjectPicker({ recentProjects: many, selectedCwd: null, selectedProject: null, homeDir: "/home/teacher", onSelectCwd: path => selected.push(path), ...props }); return tree; },
    html() { return renderToStaticMarkup(tree); },
    panel() { return nodes(tree).find(node => node.type === AnimatedDropdown); },
    trigger() { return nodes(tree).find(node => node.type === "button" && ["native-toolbar-button", "sidebar-header-row"].includes(node.props.className)); },
    button(label) { const button = nodes(f.panel()).find(node => node.type === "button" && text(node) === label); assert.ok(button, `button ${label}`); return button; },
    open() { f.trigger().props.onClick({ currentTarget: { getBoundingClientRect: () => ({ top: 500, left: 20, width: 180 }) } }); f.render(); },
    click(label) { f.button(label).props.onClick({ stopPropagation() {} }); f.render(); },
    filter(value) { const input = nodes(f.panel()).find(node => node.type === "input"); assert.ok(input); input.props.onChange({ target: { value } }); f.render(); },
    async flush() { for (let i = 0; i < 4; i++) { await tick(); f.render(); } },
    switchLocale(next) { locale = next; f.render(); },
    directoryPicker() { const picker = nodes(tree).find(node => node.type === DirectoryPicker); assert.ok(picker); return picker; },
  };
  f.render(); return f;
}

test("both project trigger variants render through the real Chinese and English provider", () => {
  for (const locale of ["zh-CN", "en"]) for (const variant of ["block", "inline"]) {
    const html = renderToStaticMarkup(React.createElement(I18nProvider, { initialLocale: locale }, React.createElement(ProjectPicker, {
      recentProjects: many, selectedCwd: null, selectedProject: null, homeDir: "/home/teacher", onSelectCwd() {}, variant,
    })));
    assert.ok(html.includes(messages[locale]["sidebar.selectProject"]), `${locale} ${variant}`);
  }
});

test("the open project picker translates labels and filter empty states without changing list reachability", () => {
  const f = mount(); f.open();
  for (const locale of ["zh-CN", "en"]) {
    f.switchLocale(locale); f.filter("");
    const input = nodes(f.panel()).find(node => node.type === "input");
    assert.equal(input.props.placeholder, messages[locale]["sidebar.filterProjects"]);
    assert.equal(input.props["aria-label"], messages[locale]["sidebar.filterProjects"]);
    assert.ok(f.html().includes(messages[locale]["sidebar.useDefaultDirectory"]));
    assert.ok(f.html().includes(messages[locale]["sidebar.customPath"]));
    assert.equal(nodes(f.panel()).filter(node => node.type === "button" && node.props.title).length, 7);
    f.filter("project-9"); assert.ok(f.html().includes("/work/project-9"));
    f.filter("project-"); assert.equal(nodes(f.panel()).filter(node => node.type === "button" && node.props.title).length, 12);
    f.filter("not-in-list"); assert.ok(f.html().includes(messages[locale]["sidebar.noMatchingProjects"]));
  }
  assert.deepEqual(f.requests, []); assert.deepEqual(f.nativeCalls, []); assert.deepEqual(f.selected, []);
});

test("translated default-directory actions keep the existing POST and returned-directory contract", async () => {
  for (const locale of ["zh-CN", "en"]) {
    const f = mount({ locale, responses: [{ cwd: "/synthetic/default-folder" }] }); f.open(); f.click(messages[locale]["sidebar.useDefaultDirectory"]); await f.flush();
    assert.deepEqual(f.requests.map(({ url, options }) => [url, options.method]), [["/api/default-cwd", "POST"]]);
    assert.deepEqual(f.selected, ["/synthetic/default-folder"]); assert.equal(f.panel().props.open, false); assert.deepEqual(f.nativeCalls, []);
  }
});

test("translated native folder actions still validate trimmed paths and commit only the canonical success", async () => {
  for (const locale of ["zh-CN", "en"]) for (const error of [undefined, "合成目录不可用"]) {
    const f = mount({ locale, selectedCwd: "/synthetic/current", nativePath: "  /synthetic/picked  ", responses: [error ? { error } : { cwd: "/synthetic/canonical" }] });
    f.open(); f.click(messages[locale]["sidebar.customPath"]); await f.flush();
    assert.deepEqual(f.nativeCalls, ["/synthetic/current"]); assert.equal(f.requests[0].url, "/api/cwd/validate");
    assert.equal(f.requests[0].options.method, "POST"); assert.deepEqual(JSON.parse(f.requests[0].options.body), { cwd: "/synthetic/picked" });
    assert.deepEqual(f.selected, error ? [] : ["/synthetic/canonical"]); assert.equal(f.panel().props.open, Boolean(error));
    if (error) assert.ok(f.html().includes(error));
  }
});

test("localized folder cancel and web selection retain their existing boundaries", async () => {
  for (const locale of ["zh-CN", "en"]) {
    const canceled = mount({ locale, nativePath: null }); canceled.open(); canceled.click(messages[locale]["sidebar.customPath"]); await canceled.flush();
    assert.deepEqual(canceled.requests, []); assert.deepEqual(canceled.selected, []); assert.equal(canceled.panel().props.open, true);
    const web = mount({ locale, desktop: false, responses: [{ cwd: "/synthetic/web-canonical" }] }); web.open(); web.click(messages[locale]["sidebar.customPath"]);
    web.directoryPicker().props.onSelect("  /synthetic/web-picked  "); await web.flush();
    assert.deepEqual(web.nativeCalls, []); assert.deepEqual(JSON.parse(web.requests[0].options.body), { cwd: "/synthetic/web-picked" });
    assert.deepEqual(web.selected, ["/synthetic/web-canonical"]); assert.equal(web.panel().props.open, false);
  }
});
