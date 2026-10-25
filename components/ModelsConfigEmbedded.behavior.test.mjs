import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const presets = await jiti.import("../lib/model-setup-presets.ts");
const normalize = await jiti.import("../lib/model-config-normalize.ts");
const source = await readFile(new URL("./ModelsConfig.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
} }).outputText;
const tick = () => new Promise((resolve) => setImmediate(resolve));
const initialConfig = { providers: {
  deepseek: { api: "openai-completions", models: [{ id: "deepseek-chat" }, { id: "deepseek-reasoner" }] },
  "local-lab": { api: "openai-completions", baseUrl: "http://127.0.0.1:12345/v1", models: [{ id: "classroom-model" }] },
} };
const overview = { defaultModel: { provider: "deepseek", modelId: "deepseek-chat" }, modelList: [
  { provider: "deepseek", id: "deepseek-chat" }, { provider: "openai-codex", id: "reasoning-model" },
] };
const reply = (data) => ({ ok: true, json: async () => data });
const textOf = (node) => node == null || typeof node === "boolean" ? ""
  : Array.isArray(node) ? node.map(textOf).join("") : typeof node === "object" ? textOf(node.props?.children) : String(node);
const nodes = (node) => Array.isArray(node) ? node.flatMap(nodes)
  : !node || typeof node !== "object" || !node.props ? [] : [node, ...nodes(node.props.children)];

// Exercise the actual parent component handlers. Provider/auth internals remain
// component boundaries; all transports stay isolated and never read credentials.
function mountModels({ embedded = true, readOverview = async () => overview } = {}) {
  const slots = [], effects = new Map(), requests = [], modalFlags = [], dirtyChanges = [];
  let cursor = 0, dirty = false, tree, savedCount = 0;
  const sameDeps = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) {
        const slot = { value: typeof initial === "function" ? initial() : initial };
        slot.set = (value) => { const next = typeof value === "function" ? value(slot.value) : value; if (!Object.is(next, slot.value)) { slot.value = next; dirty = true; } };
        slots[index] = slot;
      }
      return [slots[index].value, slots[index].set];
    },
    useRef(initial) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
    useCallback(callback, deps) { const index = cursor++; if (!slots[index] || !sameDeps(slots[index].deps, deps)) slots[index] = { value: callback, deps }; return slots[index].value; },
    useEffect(callback, deps) { const index = cursor++; if (!slots[index] || !sameDeps(slots[index].deps, deps)) effects.set(index, { callback, deps }); },
  };
  const jsx = (type, props) => ({ type, props: props || {} });
  const transport = async (url, options) => {
    requests.push({ url, options });
    if (url === "/api/models-config") return reply(options?.method === "PUT" ? { success: true } : structuredClone(initialConfig));
    if (url === "/api/auth/providers") return reply({ providers: [{ id: "openai-codex", name: "Codex", loggedIn: true }] });
    if (url === "/api/auth/all-providers") return reply({ providers: [
      { id: "deepseek", displayName: "DeepSeek", configured: true, modelCount: 2 },
      { id: "google", displayName: "Google Gemini", configured: false, modelCount: 4 },
    ] });
    throw new Error(`Unexpected transport ${url}`);
  };
  const modules = {
    react: hooks, "react/jsx-runtime": { jsx, jsxs: jsx },
    "@/hooks/useIsMobile": { useIsMobile: () => false },
    "@/hooks/useI18n": { useI18n: () => ({ t: (key) => key }) },
    "@/hooks/useModalDismiss": { useModalDismiss: (_callback, enabled = true) => { modalFlags.push(enabled); return hooks.useRef(null); } },
    "@/lib/desktop-native": {},
    "@/lib/fetch-timeout": { fetchJsonWithDeadline: async (url) => { requests.push({ url }); return { response: reply(null), body: await readOverview() }; } },
    "@/lib/model-config-normalize": normalize,
    "@/lib/model-setup-presets": presets,
    "./ConfirmDangerButton": { ConfirmDangerButton: () => null },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, require: (name) => {
      if (name.startsWith("@lobehub/icons/")) return { default: () => null };
      assert.ok(modules[name], `module ${name}`); return modules[name];
    }, fetch: transport, setTimeout: () => 0, clearTimeout() {}, console,
  });
  const props = { embedded, onClose() {}, onDirtyChange: (value) => dirtyChanges.push(value), onSaved: () => { savedCount += 1; } };
  function render() {
    let attempts = 0;
    do {
      assert.ok(attempts++ < 25, "effects should settle");
      cursor = 0; dirty = false; tree = exports.ModelsConfig(props);
      const pending = [...effects]; effects.clear();
      for (const [index, effect] of pending) { slots[index]?.cleanup?.(); slots[index] = { deps: effect.deps, cleanup: effect.callback() }; }
    } while (dirty);
    return tree;
  }
  return { requests, modalFlags, dirtyChanges, render,
    get savedCount() { return savedCount; },
    button(label) { const found = nodes(render()).find((node) => node.type === "button" && textOf(node) === label); assert.ok(found, `button ${label}`); return found; },
    service(label) { const found = nodes(render()).find((node) => node.type === "button" && node.props.className === "models-page__row" && textOf(node).includes(label)); assert.ok(found, `service ${label}`); return found; },
    component(name) { const found = nodes(render()).find((node) => typeof node.type === "function" && node.type.name === name); assert.ok(found, `component ${name}`); return found; },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test("embedded models starts with real default and deduplicated service rows without modal or provider tree", async () => {
  const panel = mountModels();
  try {
    panel.render(); await tick();
    const tree = panel.render(), all = nodes(tree);
    assert.match(textOf(tree), /DeepSeek · deepseek-chat/);
    assert.equal(all.filter((node) => node.type === "button" && node.props.className === "models-page__row").length, 3);
    assert.match(textOf(panel.service("DeepSeek")), /API Key · 2 个模型已连接/);
    assert.match(textOf(panel.service("Codex")), /OAuth · 1 个模型已连接/);
    assert.match(textOf(panel.service("local-lab")), /自定义服务 · 1 个模型已配置/);
    assert.equal(all.some((node) => node.props.role === "dialog"), false);
    assert.equal(all.some((node) => node.props.className?.includes("models-settings-sidebar")), false);
    assert.equal(all.some((node) => node.props.style?.height || node.props.style?.maxHeight), false);
    assert.equal(panel.modalFlags.some(Boolean), false, "embedded parent does not trap global modal keys");
    assert.equal(panel.requests.some((request) => request.options?.method === "PUT"), false);
  } finally { panel.unmount(); }
});

test("service details and adding a service remain inline and preserve dirty-change confirmation", async () => {
  const panel = mountModels();
  try {
    panel.render(); await tick();
    panel.button("添加模型服务").props.onClick();
    assert.equal(panel.component("AddProviderPicker").props.embedded, true);
    panel.button("← 返回模型服务").props.onClick();
    panel.service("local-lab").props.onClick();
    const detail = panel.component("ProviderDetail");
    detail.props.onChange({ ...detail.props.provider, baseUrl: "http://127.0.0.1:23456/v1" });
    panel.button("← 返回模型服务").props.onClick();
    assert.ok(nodes(panel.render()).some((node) => node.props.role === "alert" && node.props["aria-label"] === "未保存的模型更改"));
    assert.equal(panel.dirtyChanges.at(-1), true);
    panel.button("继续编辑").props.onClick();
    assert.equal(panel.component("ProviderDetail").props.provider.baseUrl, "http://127.0.0.1:23456/v1");
    panel.button("← 返回模型服务").props.onClick();
    panel.button("放弃更改").props.onClick();
    panel.render();
    assert.equal(panel.dirtyChanges.at(-1), false);
    panel.service("local-lab").props.onClick();
    assert.equal(panel.component("ProviderDetail").props.provider.baseUrl, "http://127.0.0.1:12345/v1");
    assert.equal(panel.requests.some((request) => request.options?.method === "PUT"), false);
  } finally { panel.unmount(); }
});

test("saving inline edits invokes the existing single configuration PUT and clears dirty state", async () => {
  const panel = mountModels();
  try {
    panel.render(); await tick();
    panel.service("local-lab").props.onClick();
    const detail = panel.component("ProviderDetail");
    detail.props.onChange({ ...detail.props.provider, baseUrl: "http://127.0.0.1:34567/v1" });
    await panel.button("保存更改").props.onClick(); await tick();
    panel.render();
    const writes = panel.requests.filter((request) => request.options?.method === "PUT");
    assert.equal(writes.length, 1);
    assert.equal(JSON.parse(writes[0].options.body).providers["local-lab"].baseUrl, "http://127.0.0.1:34567/v1");
    assert.equal(panel.dirtyChanges.at(-1), false);
    assert.equal(panel.savedCount, 1);
    panel.button("← 返回模型服务").props.onClick();
    assert.equal(nodes(panel.render()).some((node) => node.props.role === "alert"), false);
  } finally { panel.unmount(); }
});

test("unavailable overview is retryable and does not invent a default or OAuth model count", async () => {
  let online = false;
  const panel = mountModels({ readOverview: async () => { if (!online) throw new Error("offline"); return overview; } });
  try {
    panel.render(); await tick();
    assert.match(textOf(panel.render()), /暂时无法读取/);
    assert.match(textOf(panel.service("Codex")), /模型待读取/);
    online = true;
    panel.button("重新读取").props.onClick(); await tick();
    assert.match(textOf(panel.render()), /DeepSeek · deepseek-chat/);
    assert.match(textOf(panel.service("Codex")), /1 个模型/);
  } finally { panel.unmount(); }
});

test("standalone models retains its original dialog and provider editor", async () => {
  const panel = mountModels({ embedded: false });
  try {
    panel.render(); await tick();
    const all = nodes(panel.render());
    assert.ok(all.some((node) => node.props.role === "dialog" && node.props["aria-modal"] === true));
    assert.ok(all.some((node) => node.props.className?.includes("models-settings-sidebar")));
    assert.equal(panel.requests.some((request) => request.url === "/api/models"), false);
  } finally { panel.unmount(); }
});
