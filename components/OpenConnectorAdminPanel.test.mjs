import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createJiti } from "jiti";

const { OpenConnectorAdminPanel, isCatalogResult } = await createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } }).import("./OpenConnectorAdminPanel.tsx");

test("admin accepts only bounded projected provider, action and inspect results", () => {
  const provider = { service: "npm", displayName: "npm", categories: ["Developer Tools"], authTypes: ["no_auth"], scenario: "development" };
  const action = { id: "npm.get_package", service: "npm", name: "get_package", description: "Read package" };
  assert.equal(isCatalogResult({ kind: "providers", providers: [provider], total: 1, limited: false }), true);
  assert.equal(isCatalogResult({ kind: "providers", providers: [{ ...provider, authTypes: "unsafe" }], total: 1, limited: false }), false);
  assert.equal(isCatalogResult({ kind: "actions", service: "npm", actions: [action], total: 1, limited: false }), true);
  assert.equal(isCatalogResult({ kind: "actions", service: "npm", actions: [{ ...action, service: "github" }], total: 1, limited: false }), false);
  assert.equal(isCatalogResult({ kind: "inspect", action, fields: [{ name: "packageName", type: "string", description: "Name", required: true }], limited: false }), true);
  assert.equal(isCatalogResult({ kind: "inspect", action, fields: [{ name: "packageName", type: { html: "bad" } }], limited: false }), false);
});

test("OpenConnector browsing stays inline with a separate bounded GitHub verification surface", async () => {
  const html = renderToStaticMarkup(React.createElement(OpenConnectorAdminPanel));
  const admin = await readFile(new URL("./EduPiAdminPanel.tsx", import.meta.url), "utf8");
  const catalog = await readFile(new URL("./OpenConnectorAdminPanel.tsx", import.meta.url), "utf8");
  assert.match(html, /aria-label="OpenConnector 目录"/);
  assert.match(html, /我的连接/);
  assert.match(html, /添加连接/);
  assert.match(catalog, /placeholder="搜索应用"/);
  assert.match(catalog, /placeholder="搜索操作"/);
  assert.match(catalog, /selectedApp\.id === "github"/);
  assert.match(catalog, /<OpenConnectorGitHubPanel onConnectionChange=/);
  assert.doesNotMatch(html, /<button[^>]*>执行<\/button>/);
  assert.match(admin, /<OpenConnectorAdminPanel/);
  assert.doesNotMatch(admin, /<OpenConnectorConsolePanel/);
  assert.doesNotMatch(admin, /OpenConnectorCatalogCard/);
});

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const discovery = await jiti.import("../lib/openconnector-discovery.ts");
const githubContract = await jiti.import("../lib/openconnector-github-contract.ts");
const directory = await jiti.import("../lib/edupi-connection-directory.ts");
const panelSource = await readFile(new URL("./OpenConnectorAdminPanel.tsx", import.meta.url), "utf8");
const compiledPanel = ts.transpileModule(panelSource, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
} }).outputText;
const tick = () => new Promise((resolve) => setImmediate(resolve));
const provider = (service, displayName, scenario) => ({ service, displayName, scenario, categories: ["Productivity"], authTypes: ["oauth2"] });
const fixtureProviders = [provider("github", "GitHub", "developer"), provider("feishu", "Feishu", "communication"),
  provider("dingtalk_bot", "DingTalk Bot", "communication"), provider("googledrive", "Google Drive", "docs")];
const emptyStatus = { supported: true, clientConfigured: false, clientId: null, callbackUrl: null,
  authorization: null, connection: null, draft: null, receipt: null };

function treeNodes(node, includeHidden = false) {
  if (!node || typeof node !== "object" || !node.props || !includeHidden && node.props.hidden) return [];
  return [node, ...[node.props.children].flat(Infinity).flatMap((child) => treeNodes(child, includeHidden))];
}
function textOf(value) {
  if (value === null || value === undefined || typeof value === "boolean") return "";
  if (Array.isArray(value)) return value.map(textOf).join("");
  return typeof value === "object" ? textOf(value.props?.children) : String(value);
}

// Exercises real handlers and effect lifetimes with isolated transport and host
// refs. DOM layout, native keyboard events, and installed-app behavior are E2E checks.
function mountPanel({ providers = fixtureProviders, status = emptyStatus, catalogTransport, managedConnections = [] } = {}) {
  const slots = [], effects = new Map(), layoutEffects = new Map(), requests = [], focus = [];
  const scroll = { scrollTop: 0 };
  let cursor = 0, dirty = false, tree;
  const sameDeps = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const schedule = (queue, callback, deps) => {
    const index = cursor++;
    if (!slots[index] || !sameDeps(slots[index].deps, deps)) queue.set(index, { callback, deps });
  };
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) {
        const slot = { value: typeof initial === "function" ? initial() : initial };
        slot.set = (next) => { const value = typeof next === "function" ? next(slot.value) : next; if (!Object.is(value, slot.value)) { slot.value = value; dirty = true; } };
        slots[index] = slot;
      }
      return [slots[index].value, slots[index].set];
    },
    useRef(initial) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
    useMemo(factory, deps) { const index = cursor++; if (!slots[index] || !sameDeps(slots[index].deps, deps)) slots[index] = { value: factory(), deps }; return slots[index].value; },
    useCallback(callback, deps) { return hooks.useMemo(() => callback, deps); },
    useEffect(callback, deps) { schedule(effects, callback, deps); },
    useLayoutEffect(callback, deps) { schedule(layoutEffects, callback, deps); },
  };
  const jsx = (type, props) => ({ type, props: props || {} });
  const response = (data) => ({ ok: true, status: 200, json: async () => ({ ok: true, data }) });
  const fetcher = async (url, options = {}) => {
    if (url.endsWith("/github")) return response(await status);
    const query = JSON.parse(options.body);
    requests.push({ query, signal: options.signal });
    if (catalogTransport) return response(await catalogTransport(query, options.signal));
    if (query.op === "providers") return response({ kind: "providers", providers, total: providers.length, limited: false });
    if (query.op === "actions") return response({ kind: "actions", service: query.service,
      actions: [{ id: `${query.service}.read`, service: query.service, name: "读取材料", description: "读取一项测试材料" }], total: 1, limited: false });
    if (query.op === "search") return response({ kind: "search", actions: [], limited: false });
    return response({ kind: "inspect", action: { id: query.actionId, service: query.actionId.split(".")[0], name: "读取材料", description: "读取一项测试材料" }, fields: [], limited: false });
  };
  const modules = { react: hooks, "react/jsx-runtime": { jsx, jsxs: jsx },
    "@/lib/desktop-native": { fetchDesktopApi: fetcher }, "@/lib/desktop-updater": { isTauriDesktop: () => true },
    "@/lib/openconnector-discovery": discovery, "@/lib/openconnector-github-contract": githubContract,
    "@/lib/edupi-connection-directory": directory, "./EduPiConnectorSetup": { EduPiConnectorSetup: "managed-setup" },
    "./OpenConnectorGitHubPanel": { OpenConnectorGitHubPanel: "github-panel" },
    "./OpenConnectorProviderIcon": { OpenConnectorProviderIcon: "provider-icon" },
  };
  const exports = {};
  vm.runInNewContext(compiledPanel, { exports, require: (name) => { assert.ok(modules[name], name); return modules[name]; },
    AbortController, AbortSignal, DOMException, setTimeout, clearTimeout, requestAnimationFrame: (callback) => callback() });
  function flush(queue) {
    const pending = [...queue]; queue.clear();
    for (const [index, effect] of pending) { slots[index]?.cleanup?.(); slots[index] = { deps: effect.deps, cleanup: effect.callback() }; }
  }
  function render() {
    let attempts = 0;
    do {
      assert.ok(attempts++ < 30, "component effects should settle");
      cursor = 0; dirty = false; tree = exports.OpenConnectorAdminPanel({ managedConnections });
      for (const node of treeNodes(tree, true)) {
        if (node.props.ref) node.props.ref.current = node.props.className === "openconnector-admin__catalog"
          ? { closest: () => scroll } : { focus: (options) => focus.push({ type: node.type, options }) };
      }
      flush(layoutEffects); flush(effects);
    } while (dirty);
    return tree;
  }
  return { render, scroll, focus, requests,
    find(predicate, includeHidden = false) { return treeNodes(render(), includeHidden).find(predicate); },
    buttons() { return treeNodes(render()).filter((node) => node.type === "button"); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test("Chinese search and scenario selection survive detail navigation with scroll and focus restored", async () => {
  const panel = mountPanel(); panel.render(); await tick();
  panel.buttons().find((node) => textOf(node) === "添加连接").props.onClick();
  panel.find((node) => node.type === "input" && node.props["aria-label"] === "搜索服务").props.onChange({ target: { value: "谷歌云盘" } });
  panel.buttons().find((node) => textOf(node.props.children) === "文档").props.onClick();
  const trigger = { focus: (options) => panel.focus.push({ type: "provider", options }) };
  const card = panel.find((node) => node.props.className === "openconnector-admin__provider");
  assert.match(textOf(card), /Google Drive/);
  assert.equal(card.type, "button"); assert.equal(card.props.type, "button");
  panel.scroll.scrollTop = 735;
  card.props.onClick({ currentTarget: trigger }); panel.render();
  assert.equal(panel.scroll.scrollTop, 0);
  assert.equal(panel.focus.at(-1).type, "h2");
  assert.equal(panel.requests.filter((request) => request.query.op === "actions").length, 0, "catalog metadata is lazy");
  assert.match(textOf(panel.render()), /只读目录/);
  assert.ok(!panel.find((node) => node.type === "github-panel"));
  panel.buttons().find((node) => textOf(node.props.children).includes("返回应用")).props.onClick(); panel.render();
  assert.equal(panel.scroll.scrollTop, 735);
  assert.equal(panel.focus.at(-1).type, "provider");
  assert.equal(panel.find((node) => node.type === "input" && node.props["aria-label"] === "搜索服务").props.value, "谷歌云盘");
  assert.equal(panel.buttons().find((node) => textOf(node.props.children) === "文档").props["aria-pressed"], true);
  panel.unmount();
});

test("expanded provider pages survive returning and action details restore their trigger focus", async () => {
  const providers = Array.from({ length: 60 }, (_, index) => provider(`service_${String(index).padStart(2, "0")}`, `Service ${String(index).padStart(2, "0")}`, "other"));
  const panel = mountPanel({ providers }); panel.render(); await tick();
  panel.buttons().find((node) => textOf(node) === "添加连接").props.onClick();
  assert.equal(panel.buttons().filter((node) => node.props.className === "openconnector-admin__provider").length, 48);
  panel.buttons().find((node) => node.props.className === "openconnector-admin__more").props.onClick();
  const last = panel.buttons().find((node) => node.props.className === "openconnector-admin__provider" && textOf(node).includes("Service 59"));
  last.props.onClick({ currentTarget: { focus() {} } }); panel.render();
  const operations = panel.find((node) => node.type === "details");
  assert.equal(operations.props.open, false);
  operations.props.onToggle({ currentTarget: { open: true } }); panel.render(); await tick();
  const actionFocus = { focus: (options) => panel.focus.push({ type: "action", options }) };
  panel.buttons().find((node) => textOf(node.props.children).includes("读取材料")).props.onClick({ currentTarget: actionFocus });
  panel.render(); await tick(); panel.render();
  assert.equal(panel.focus.at(-1).type, "h3");
  panel.buttons().find((node) => textOf(node.props.children).includes("返回操作")).props.onClick(); panel.render();
  assert.equal(panel.focus.at(-1).type, "action");
  panel.buttons().find((node) => textOf(node.props.children).includes("返回应用")).props.onClick();
  assert.equal(panel.buttons().filter((node) => node.props.className === "openconnector-admin__provider").length, 65);
  panel.unmount();
});

test("connection callback marks only GitHub and wins over a stale passive status response", async () => {
  let resolveStatus;
  const status = new Promise((resolve) => { resolveStatus = resolve; });
  const panel = mountPanel({ status }); panel.render(); await tick();
  panel.buttons().find((node) => textOf(node) === "添加连接").props.onClick();
  const github = panel.buttons().find((node) => node.props.className === "openconnector-admin__provider" && textOf(node).includes("GitHub"));
  github.props.onClick({ currentTarget: { focus() {} } }); panel.render();
  panel.find((node) => node.type === "github-panel").props.onConnectionChange(true); panel.render();
  resolveStatus(emptyStatus); await tick();
  panel.buttons().find((node) => textOf(node.props.children).includes("返回应用")).props.onClick();
  const cards = panel.buttons().filter((node) => node.props.className === "openconnector-admin__provider");
  assert.match(textOf(cards[0]), /GitHub.*已授权/);
  assert.equal(cards.filter((node) => textOf(node).includes("已授权")).length, 1);
  panel.unmount();
});

test("returning cancels an in-flight action list and ignores its late response", async () => {
  let resolveActions;
  const panel = mountPanel({ catalogTransport: async (query) => query.op === "providers"
    ? { kind: "providers", providers: fixtureProviders, total: fixtureProviders.length, limited: false }
    : new Promise((resolve) => { resolveActions = resolve; }) });
  panel.render(); await tick();
  panel.buttons().find((node) => textOf(node) === "添加连接").props.onClick();
  panel.find((node) => node.props.className === "openconnector-admin__provider" && textOf(node).includes("Google Drive")).props.onClick({ currentTarget: { focus() {} } });
  panel.find((node) => node.type === "details").props.onToggle({ currentTarget: { open: true } }); panel.render();
  const request = panel.requests.at(-1);
  panel.buttons().find((node) => textOf(node.props.children).includes("返回应用")).props.onClick(); panel.render();
  assert.equal(request.signal.aborted, true);
  resolveActions({ kind: "actions", service: request.query.service, actions: [], total: 0, limited: false }); await tick();
  assert.ok(panel.find((node) => node.props.className === "openconnector-admin__provider"));
  assert.ok(!panel.find((node) => node.type === "details"));
  panel.unmount();
});

test("admin reads only desktop-token-gated catalog operations and aborts stale calls", async () => {
  const source = await readFile(new URL("./OpenConnectorAdminPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /fetchDesktopApi\("\/api\/desktop\/openconnector\/catalog"/);
  for (const op of ["providers", "actions", "search", "inspect"]) assert.match(source, new RegExp(`op: "${op}"`));
  assert.match(source, /controllerRef\.current\?\.abort\(\)/);
  assert.match(source, /if \(controller\.signal\.aborted\) return/);
  assert.match(source, /isTauriDesktop\(\)/);
  assert.doesNotMatch(source, /op: "execute"|<input[^>]*type="password"|fetch\("https?:\/\//);
});


test("saved connections lead with truthful state and do not expose the whole catalog by default", async () => {
  const panel = mountPanel({ managedConnections: [{ connector_id: "feishu", status: "configured" },
    { connector_id: "dingtalk", status: "credentials_verified" }, { connector_id: "email", status: "not_configured" }] });
  panel.render(); await tick();
  const saved = panel.buttons().filter((node) => node.props.className === "connection-settings__saved-app");
  assert.equal(saved.length, 2);
  assert.match(textOf(saved[0]), /飞书.*已配置/);
  assert.match(textOf(saved[1]), /钉钉.*凭据已验证/);
  assert.equal(saved.some((node) => textOf(node).includes("已连接")), false);
  assert.equal(panel.find((node) => node.props.className === "openconnector-admin__provider"), undefined);
  assert.ok(panel.buttons().some((node) => textOf(node) === "添加连接"));
  assert.ok(panel.requests.every((request) => request.query.op === "providers"));
  panel.unmount();
});

test("one Feishu brand leads to native setup or the chosen exact catalog service", async () => {
  const providers = [provider("feishu", "Feishu", "communication"), provider("feishu_app_bot", "Feishu App Bot", "communication"), provider("feishu_custom_bot", "Feishu Custom Bot", "communication")];
  const panel = mountPanel({ providers, managedConnections: [{ connector_id: "feishu", status: "credentials_verified" }] });
  panel.render(); await tick();
  panel.buttons().find((node) => textOf(node) === "添加连接").props.onClick();
  panel.find((node) => node.type === "input" && node.props["aria-label"] === "搜索服务").props.onChange({ target: { value: "飞书" } });
  const apps = panel.buttons().filter((node) => node.props.className === "openconnector-admin__provider");
  assert.equal(apps.length, 1);
  apps[0].props.onClick({ currentTarget: { focus() {} } }); panel.render();
  assert.equal(panel.find((node) => node.type === "details"), undefined);
  panel.buttons().find((node) => textOf(node).startsWith("机器人对话")).props.onClick({ currentTarget: { focus() {} } }); panel.render();
  const setup = panel.find((node) => node.type === "managed-setup");
  assert.equal(setup.props.connectorId, "feishu");
  assert.equal(setup.props.status, "credentials_verified");
  assert.equal(setup.props.embedded, true);
  assert.equal(panel.requests.filter((request) => request.query.op !== "providers").length, 0);
  panel.buttons().find((node) => textOf(node).includes("返回用途")).props.onClick(); panel.render();
  panel.buttons().find((node) => textOf(node).startsWith("应用机器人")).props.onClick({ currentTarget: { focus() {} } }); panel.render();
  panel.find((node) => node.type === "details").props.onToggle({ currentTarget: { open: true } }); panel.render(); await tick();
  assert.deepEqual(panel.requests.at(-1).query, { op: "actions", service: "feishu_app_bot" });
  panel.unmount();
});

test("saved GitHub opens its receipt panel even when provider catalog is unavailable", async () => {
  const status = { ...emptyStatus, clientConfigured: true, clientId: "aaaaaaaaaaaaaaaaaaaa", connection: { id: "6ad11879-eac9-4678-8a81-c20f65f9c05d", login: "example", accountId: "1234", scopes: ["public_repo"], authType: "oauth2" } };
  const panel = mountPanel({ status, catalogTransport: async () => { throw new Error("offline catalog"); } });
  panel.render(); await tick();
  const github = panel.buttons().find((node) => node.props.className === "connection-settings__saved-app");
  assert.match(textOf(github), /GitHub.*example.*已授权/);
  github.props.onClick({ currentTarget: { focus() {} } }); panel.render();
  assert.ok(panel.find((node) => node.type === "github-panel"));
  assert.equal(panel.find((node) => node.type === "details"), undefined);
  panel.unmount();
});


test("failed saved-connection projection shows an error instead of an empty-account claim", async () => {
  const panel = mountPanel({ status: { malformed: true } }); panel.render(); await tick();
  const htmlText = textOf(panel.render());
  assert.match(htmlText, /连接状态暂不可用/);
  assert.match(htmlText, /暂时无法读取已保存的连接/);
  assert.doesNotMatch(htmlText, /还没有添加连接/);
  assert.ok(panel.buttons().some((node) => textOf(node) === "重新读取"));
  panel.unmount();
});


test("opening an existing connection does not cancel the independent app catalog load", async () => {
  let resolveProviders;
  const panel = mountPanel({ managedConnections: [{ connector_id: "feishu", status: "configured" }],
    catalogTransport: async () => new Promise((resolve) => { resolveProviders = resolve; }) });
  panel.render(); await tick();
  const request = panel.requests[0];
  panel.buttons().find((node) => node.props.className === "connection-settings__saved-app").props.onClick({ currentTarget: { focus() {} } }); panel.render();
  assert.equal(request.signal.aborted, false);
  resolveProviders({ kind: "providers", providers: fixtureProviders, total: fixtureProviders.length, limited: false }); await tick(); panel.render();
  panel.buttons().find((node) => textOf(node).includes("返回我的连接")).props.onClick(); panel.render();
  panel.buttons().find((node) => textOf(node) === "添加连接").props.onClick(); panel.render();
  assert.ok(panel.buttons().some((node) => node.props.className === "openconnector-admin__provider" && textOf(node).includes("Google Drive")));
  panel.unmount();
});


test("opening GitHub details preserves loaded account and health until a real disconnect", async () => {
  const ready = { ...emptyStatus, clientConfigured: true, clientId: "aaaaaaaaaaaaaaaaaaaa",
    connection: { id: "6ad11879-eac9-4678-8a81-c20f65f9c05d", login: "PIGU-PPPgu", accountId: "59789742", scopes: ["public_repo"], authType: "oauth2" },
    health: { status: "ready", checkedAt: "2026-10-24T00:00:00.000Z" } };
  const panel = mountPanel({ status: ready }); panel.render(); await tick();
  const saved = () => panel.buttons().find((node) => node.props.className === "connection-settings__saved-app" && textOf(node).includes("GitHub"));
  assert.match(textOf(saved()), /GitHub.*PIGU-PPPgu.*已连接/);
  saved().props.onClick({ currentTarget: { focus() {} } }); panel.render();
  const notify = panel.find((node) => node.type === "github-panel").props.onConnectionChange;
  notify(true, ready); panel.render();
  notify(true); panel.render(); // A legacy boolean-only callback must not discard known metadata.
  panel.buttons().find((node) => textOf(node).includes("返回我的连接")).props.onClick(); panel.render();
  assert.match(textOf(saved()), /GitHub.*PIGU-PPPgu.*已连接/);
  saved().props.onClick({ currentTarget: { focus() {} } }); panel.render();
  const notifyAgain = panel.find((node) => node.type === "github-panel").props.onConnectionChange;
  notifyAgain(false, { ...ready, health: { status: "authorization_required", checkedAt: null } }); panel.render();
  panel.buttons().find((node) => textOf(node).includes("返回我的连接")).props.onClick(); panel.render();
  assert.match(textOf(saved()), /GitHub.*PIGU-PPPgu.*需要重新授权/);
  saved().props.onClick({ currentTarget: { focus() {} } }); panel.render();
  panel.find((node) => node.type === "github-panel").props.onConnectionChange(false, emptyStatus); panel.render();
  panel.buttons().find((node) => textOf(node).includes("返回我的连接")).props.onClick(); panel.render();
  assert.equal(saved(), undefined);
  assert.doesNotMatch(textOf(panel.render()), /PIGU-PPPgu/);
  panel.unmount();
});
