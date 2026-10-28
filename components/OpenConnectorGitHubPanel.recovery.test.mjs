import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createJiti } from "jiti";

const contract = await createJiti(import.meta.url).import("../lib/openconnector-github-contract.ts");
const source = await readFile(new URL("./OpenConnectorGitHubPanel.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
} }).outputText;
const tick = () => new Promise((resolve) => setImmediate(resolve));
const connected = {
  supported: true, clientConfigured: true, clientId: "a".repeat(20), callbackUrl: null, authorization: null,
  connection: { id: "10000000-0000-4000-8000-000000000001", accountId: "59789742", login: "PIGU-PPPgu", scopes: ["public_repo"], authType: "oauth2" },
  draft: null, receipt: null, health: { status: "ready", checkedAt: "2026-10-24T00:00:00.000Z" },
};
const reply = (data) => ({ ok: true, json: async () => ({ ok: true, data }) });
const textOf = (node) => node === null || node === undefined || typeof node === "boolean" ? ""
  : Array.isArray(node) ? node.map(textOf).join("") : typeof node === "object" ? textOf(node.props?.children) : String(node);
function nodes(node) {
  return !node || typeof node !== "object" || !node.props ? []
    : [node, ...[node.props.children].flat(Infinity).flatMap(nodes)];
}
function untilAborted(signal) {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

// Run the component's actual event handlers with isolated transport and manual
// deadlines, without starting a browser, native host, or network connection.
function mountPanel(transport, { initialStatus = connected, onConnectionChange } = {}) {
  const slots = [], effects = new Map(), deadlines = [], requests = [];
  let cursor = 0, dirty = false, tree;
  const sameDeps = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) {
        const slot = { value: initial };
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
  const modules = { react: hooks, "react/jsx-runtime": { jsx, jsxs: jsx },
    "@/lib/desktop-native": { fetchDesktopApi: async (_url, options) => { requests.push(options); return requests.length === 1 ? reply(await initialStatus) : transport(options, requests.length); } },
    "@/lib/openconnector-github-contract": contract,
  };
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: (name) => { assert.ok(modules[name], name); return modules[name]; },
    AbortController, AbortSignal: { any: (signals) => AbortSignal.any(signals), timeout: () => { const deadline = new AbortController(); deadlines.push(deadline); return deadline.signal; } },
    setTimeout, clearTimeout, Intl, Date });
  function render() {
    let attempts = 0;
    do {
      assert.ok(attempts++ < 20, "component effects should settle");
      cursor = 0; dirty = false; tree = exports.OpenConnectorGitHubPanel({ onConnectionChange });
      const pending = [...effects]; effects.clear();
      for (const [index, effect] of pending) { slots[index]?.cleanup?.(); slots[index] = { deps: effect.deps, cleanup: effect.callback() }; }
    } while (dirty);
    return tree;
  }
  return { requests, render,
    button(label) { return nodes(render()).find((node) => node.type === "button" && textOf(node) === label); },
    expireDeadlines() { for (const deadline of deadlines) deadline.abort(new DOMException("Request timed out", "TimeoutError")); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test("a timed-out operation and recovery GET release busy state without repeating POST", async () => {
  const panel = mountPanel(({ signal }) => untilAborted(signal));
  try {
    panel.render(); await tick();
    panel.button("检查连接").props.onClick(); await tick();
    panel.expireDeadlines(); await tick();
    assert.deepEqual(panel.requests.map((request) => request.method), ["GET", "POST", "GET"]);
    assert.equal(panel.button("正在检查…").props.disabled, true);
    panel.expireDeadlines(); await tick();
    assert.equal(panel.button("检查连接").props.disabled, false, "recovery GET must have a deadline and release busy state");
    assert.ok(panel.button("重新读取状态"));
    assert.deepEqual(panel.requests.map((request) => request.method), ["GET", "POST", "GET"]);
    assert.deepEqual(JSON.parse(panel.requests[1].body), { op: "checkConnection" });
  } finally { panel.unmount(); await tick(); }
});

test("a failed operation reloads durable health with one GET and keeps retry manual", async () => {
  const panel = mountPanel(async ({ method }) => {
    if (method === "POST") return { ok: false, json: async () => ({ ok: false, code: "github_connection_offline" }) };
    return reply({ ...connected, health: { status: "offline", checkedAt: "2026-10-24T00:01:00.000Z", code: "github_connection_offline" } });
  });
  try {
    panel.render(); await tick();
    panel.button("检查连接").props.onClick(); await tick();
    assert.equal(panel.button("重试连接").props.disabled, false);
    assert.match(textOf(panel.render()), /连接中断/u);
    await tick(); panel.render();
    assert.deepEqual(panel.requests.map((request) => request.method), ["GET", "POST", "GET"]);
  } finally { panel.unmount(); }
});


test("connection projection waits for loaded status and publishes safe identity and health", async () => {
  let resolveInitial;
  const changes = [];
  const initialStatus = new Promise((resolve) => { resolveInitial = resolve; });
  const disconnected = { ...connected, connection: null, health: { status: "unknown", checkedAt: null } };
  const panel = mountPanel(async () => reply(disconnected), { initialStatus, onConnectionChange: (...args) => changes.push(args) });
  try {
    panel.render(); await tick();
    assert.equal(changes.length, 0, "an unopened status projection must not announce a disconnect");
    resolveInitial(connected); await tick(); panel.render();
    assert.equal(changes.length, 1);
    assert.equal(changes[0][0], true);
    assert.equal(changes[0][1].connection.login, "PIGU-PPPgu");
    assert.equal(changes[0][1].health.status, "ready");
    assert.match(textOf(panel.render()), /PIGU-PPPgu.*连接正常/);
    panel.button("检查连接").props.onClick(); await tick(); panel.render();
    assert.equal(changes.at(-1)[0], false);
    assert.equal(changes.at(-1)[1].connection, null, "an actual empty connection response still propagates disconnect");
    assert.match(textOf(panel.render()), /未连接/);
  } finally { panel.unmount(); }
});
