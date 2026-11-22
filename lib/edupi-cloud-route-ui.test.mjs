import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import React, { act } from "react";
import { create } from "react-test-renderer";
import ts from "typescript";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const require = createRequire(import.meta.url);
const compile = file => ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const sources = {
  educationClient: compile("./edupi-education-client.ts"),
  events: compile("./edupi-cloud-events.ts"),
  settings: compile("../components/EduPiCloudSettingsCard.tsx"),
  sync: compile("../components/EduPiCloudSync.tsx"),
};
const signedOut = () => ({
  mode: "local",
  configured: true,
  session: { state: "signed_out", user: null, expiresAt: null },
  workspaceId: null,
  sync: { pending: 0, conflict: 0, failed: 0 },
  error: null,
  workspaces: [],
});
const signedIn = () => ({
  ...signedOut(),
  mode: "cloud",
  session: { state: "signed_in", user: { id: "teacher-1", email: "teacher@example.invalid" }, expiresAt: "2030-01-01T00:00:00.000Z" },
  workspaceId: "workspace-1",
  workspaces: [{ id: "workspace-1", mode: "cloud" }, { id: "workspace-2", mode: "cloud" }],
});
const text = node => typeof node === "string" ? node : (node.children || []).map(text).join("");
const button = (renderer, label) => renderer.root.findAllByType("button").find(node => text(node) === label);
const input = (renderer, type) => renderer.root.findAllByType("input").find(node => node.props.type === type);
const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

function fixture(t, initial = signedOut()) {
  let status = initial;
  let clock = 0;
  let nextTimer = 0;
  const timers = new Map();
  const calls = [];
  const events = [];
  const renderers = new Set();
  const window = new EventTarget();
  const document = new EventTarget();
  document.visibilityState = "visible";
  const dispatch = window.dispatchEvent.bind(window);
  window.dispatchEvent = event => { events.push(event.type); return dispatch(event); };
  let handler = async body => {
    if (body?.action === "login") status = { ...signedIn(), mode: "local", workspaceId: null };
    if (body?.action === "select_workspace") status = { ...status, mode: "cloud", workspaceId: body.workspace_id };
    if (body?.action === "set_mode") status = { ...status, mode: body.mode };
    if (body?.action === "logout") status = signedOut();
    return reply(status);
  };
  const shared = {
    window, document, Event, CustomEvent, AbortController, DOMException, Error, TypeError,
    setTimeout: (callback, delay) => {
      const id = ++nextTimer;
      timers.set(id, { callback, due: clock + delay });
      return id;
    },
    clearTimeout: id => timers.delete(id),
  };
  const educationClient = {};
  vm.runInNewContext(sources.educationClient, { ...shared, exports: educationClient });
  const eventModule = {};
  vm.runInNewContext(sources.events, {
    ...shared, exports: eventModule,
    require: name => {
      assert.equal(name, "./edupi-education-client.ts");
      return educationClient;
    },
  });
  const modules = {
    "@/lib/edupi-cloud-events": eventModule,
    "@/lib/desktop-native": {
      fetchDesktopApi: async (url, init) => {
        assert.equal(url, "/api/edupi/cloud");
        const body = init.body ? JSON.parse(init.body) : null;
        calls.push(body?.action ?? "GET");
        return handler(body, init);
      },
    },
  };
  const components = {};
  for (const name of ["settings", "sync"]) {
    const exports = {};
    vm.runInNewContext(sources[name], {
      ...shared, exports,
      require: name => Object.hasOwn(modules, name) ? modules[name] : require(name),
    });
    components[name] = exports;
  }
  const f = {
    calls, events, timers,
    setHandler: next => { handler = next; },
    async mount(name) {
      let renderer;
      const Component = name === "sync" ? components.sync.EduPiCloudSync : components.settings.EduPiCloudSettingsCard;
      await act(async () => { renderer = create(React.createElement(Component)); });
      renderers.add(renderer);
      return renderer;
    },
    async unmount(renderer) {
      await act(async () => renderer.unmount());
      renderers.delete(renderer);
    },
    async advance(milliseconds) {
      await act(async () => {
        clock += milliseconds;
        for (const [id, timer] of [...timers]) {
          if (timer.due > clock || !timers.has(id)) continue;
          timers.delete(id);
          timer.callback();
        }
      });
    },
    async online() { await act(async () => window.dispatchEvent(new Event("online"))); },
    async visibility(value) {
      await act(async () => {
        document.visibilityState = value;
        document.dispatchEvent(new Event("visibilitychange"));
      });
    },
    async publish(next) { await act(async () => eventModule.announceEduPiCloudStatus(next)); },
  };
  t.after(async () => { for (const renderer of renderers) await f.unmount(renderer); });
  return f;
}

test("settings clear a successful login password and require an explicit workspace choice", async t => {
  const f = fixture(t);
  const card = await f.mount("settings");
  await act(async () => {
    input(card, "email").props.onChange({ target: { value: "teacher@example.invalid" } });
    input(card, "password").props.onChange({ target: { value: "synthetic-password" } });
  });
  await act(async () => card.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  assert.equal(button(card, "云端模式").props.disabled, true);
  assert.equal(card.root.findByType("select").props.value, "");
  await act(async () => card.root.findByType("select").props.onChange({ target: { value: "workspace-2" } }));
  assert.equal(card.root.findByType("select").props.value, "workspace-2");
  assert.equal(button(card, "云端模式").props["aria-pressed"], true);
  assert.ok(f.events.includes("edupi-education-refresh"));
  await act(async () => button(card, "本地模式").props.onClick());
  assert.equal(button(card, "本地模式").props["aria-pressed"], true);
  await act(async () => button(card, "退出云端").props.onClick());
  assert.equal(input(card, "password").props.value, "");
  assert.equal(f.events.filter(event => event === "edupi-education-refresh").length, 4);
});

test("settings show expired login and pending/conflict/failure counts while leaving local mode available", async t => {
  const f = fixture(t, {
    ...signedIn(),
    session: { ...signedIn().session, state: "expired" },
    sync: { pending: 2, conflict: 1, failed: 3 },
    error: { code: "network_unavailable", message: "无法连接云端，待同步记录已保留。" },
  });
  const card = await f.mount("settings");
  const content = text(card.toJSON());
  assert.match(content, /登录已过期/);
  assert.match(content, /待同步 2.*冲突 1.*失败 3/);
  assert.match(content, /无法连接云端/);
  assert.equal(button(card, "本地模式").props.disabled, false);
  assert.equal(button(card, "云端模式").props.disabled, true);
  assert.doesNotMatch(content, /SUPABASE_ANON_KEY|默认使用本地 Core/);
});

test("resident sync continues after settings close, uses only POST sync polls, and pauses when hidden", async t => {
  const f = fixture(t, signedIn());
  await f.mount("sync");
  const card = await f.mount("settings");
  await f.unmount(card);
  assert.equal(f.calls.filter(call => call === "GET").length, 2);
  await f.advance(15_000);
  assert.equal(f.calls.filter(call => call === "sync").length, 1);
  assert.equal(f.calls.filter(call => call === "GET").length, 2);
  await f.online();
  assert.equal(f.calls.filter(call => call === "sync").length, 2);
  await f.visibility("hidden");
  await f.advance(60_000);
  await f.online();
  assert.equal(f.calls.filter(call => call === "sync").length, 2);
  await f.visibility("visible");
  assert.equal(f.calls.filter(call => call === "sync").length, 3);
  await f.publish({ ...signedIn(), mode: "local" });
  await f.advance(30_000);
  await f.online();
  assert.equal(f.calls.filter(call => call === "sync").length, 3);
});

test("slow sync requests never overlap and cannot restore cloud mode after a local-mode switch", async t => {
  const f = fixture(t, signedIn());
  await f.mount("sync");
  let finish;
  f.setHandler(async () => new Promise(resolve => { finish = resolve; }));
  await f.advance(15_000);
  await f.online();
  await f.visibility("hidden");
  await f.visibility("visible");
  assert.equal(f.calls.filter(call => call === "sync").length, 1);
  await f.publish({ ...signedIn(), mode: "local" });
  const published = f.events.filter(event => event === "edupi-cloud-status-changed").length;
  await act(async () => finish(reply({ ...signedIn(), flushed: 1 })));
  assert.equal(f.events.filter(event => event === "edupi-cloud-status-changed").length, published);
  assert.equal(f.events.includes("edupi-education-refresh"), false);
  await f.advance(30_000);
  assert.equal(f.calls.filter(call => call === "sync").length, 1);
});

test("a successful flush refreshes the main UI and updates an open card without workspace discovery", async t => {
  const f = fixture(t, signedIn());
  await f.mount("sync");
  const card = await f.mount("settings");
  f.setHandler(async () => reply({ ...signedIn(), workspaces: undefined, flushed: 1, sync: { pending: 0, conflict: 1, failed: 0 } }));
  await f.advance(15_000);
  assert.equal(f.events.filter(event => event === "edupi-education-refresh").length, 1);
  assert.match(text(card.toJSON()), /冲突 1/);
  assert.equal(card.root.findByType("select").props.children.at(-1).length, 2);
  assert.equal(f.calls.filter(call => call === "GET").length, 2);
});

test("signed-out local mode does not start sync timers or POST requests", async t => {
  const f = fixture(t);
  await f.mount("sync");
  await f.advance(60_000);
  await f.online();
  await f.visibility("hidden");
  await f.visibility("visible");
  assert.deepEqual(f.calls, ["GET"]);
  assert.equal(f.timers.size, 0);
});

test("a late settings GET cannot overwrite the resident component's newer cloud status", async t => {
  const f = fixture(t);
  let finish;
  f.setHandler(async () => new Promise(resolve => { finish = resolve; }));
  const card = await f.mount("settings");
  await f.publish(signedIn());
  await act(async () => finish(reply(signedOut())));
  assert.equal(button(card, "云端模式").props["aria-pressed"], true);
  assert.equal(card.root.findByType("select").props.value, "workspace-1");
});

test("a failed initial settings request exposes a usable status retry", async t => {
  const f = fixture(t);
  f.setHandler(async () => { throw new TypeError("synthetic offline"); });
  const card = await f.mount("settings");
  assert.match(text(card.toJSON()), /未读取/);
  f.setHandler(async () => reply(signedOut()));
  await act(async () => button(card, "刷新状态").props.onClick());
  assert.match(text(card.toJSON()), /未登录/);
  assert.equal(card.root.findAllByProps({ role: "alert" }).length, 0);
});
