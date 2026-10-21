import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";
import ts from "typescript";
import vm from "node:vm";

const connectionSource = new URL("./desktop-connection.ts", import.meta.url);
const nativeSource = new URL("./desktop-native.ts", import.meta.url);
const { readPackagedServerIdentity } = await createJiti(import.meta.url, { tsconfigPaths: true })
  .import("./desktop-connection-probe.ts");
const compiled = ts.transpileModule(await readFile(connectionSource, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const flush = () => new Promise(resolve => setImmediate(resolve));
const plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const identity = id => new Response(null, { status: 204, headers: { "x-pi-desktop-instance": id } });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function connectionHarness(t, { enabled = true, mount = true, ignoreAbort = false, relaunch = async () => {} } = {}) {
  const slots = [], timers = new Map(), listeners = new Map(), requests = [];
  let cursor = 0, timerId = 0, now = 0, wall = 1_700_000_000_000, visible = "visible", mounted = false;
  let pendingEffects = [], writes = 0, reloads = 0, relaunches = 0;
  const matches = (a, b) => a && a.length === b.length && a.every((value, index) => value === b[index]);
  const react = {
    useState(initial) {
      const index = cursor++;
      const slot = slots[index] ??= { value: typeof initial === "function" ? initial() : initial };
      slot.set ??= value => { writes++; slot.value = typeof value === "function" ? value(slot.value) : value; };
      return [slot.value, slot.set];
    },
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    useCallback(callback, dependencies) {
      const index = cursor++;
      if (!matches(slots[index]?.dependencies, dependencies)) slots[index] = { value: callback, dependencies };
      return slots[index].value;
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      if (matches(slots[index]?.dependencies, dependencies)) return;
      const old = slots[index];
      const slot = slots[index] = { dependencies };
      pendingEffects.push(() => { old?.cleanup?.(); slot.cleanup = effect(); });
    },
  };
  const setTimer = (callback, delay) => { const id = ++timerId; timers.set(id, { callback, at: now + delay }); return id; };
  const clearTimer = id => timers.delete(id);
  const events = prefix => ({
    addEventListener(name, callback) {
      const key = `${prefix}:${name}`;
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key).add(callback);
    },
    removeEventListener(name, callback) { listeners.get(`${prefix}:${name}`)?.delete(callback); },
  });
  const document = { ...events("document"), get visibilityState() { return visible; } };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, AbortController, setTimeout: setTimer, clearTimeout: clearTimer,
    Date: class extends Date { static now() { return wall; } },
    performance: { now: () => now, timeOrigin: 1_699_999_999_000 }, document,
    window: { ...events("window"), setTimeout: setTimer, clearTimeout: clearTimer, location: { reload() { reloads++; } } },
    fetch(url, options) {
      assert.equal(url, "/api/desktop/identity");
      const request = { ...deferred(), options };
      requests.push(request);
      if (!ignoreAbort) options.signal.addEventListener("abort", () => request.reject(new DOMException("Aborted", "AbortError")));
      return request.promise;
    },
    require(name) {
      if (name === "react") return react;
      if (name === "@/lib/desktop-connection-probe") return { readPackagedServerIdentity };
      if (name === "@/lib/desktop-native") return { relaunchAppNative: async () => { relaunches++; await relaunch(); } };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  const render = () => { cursor = 0; return exports.useDesktopConnection(enabled); };
  const commit = () => { const effects = pendingEffects; pendingEffects = []; for (const effect of effects) effect(); };
  const unmount = () => { for (const slot of slots) slot?.cleanup?.(); mounted = false; pendingEffects = []; };
  render();
  if (mount) { mounted = true; commit(); }
  t.after(unmount);
  return {
    requests, view: render, diagnostics: () => plain(render().diagnostics),
    counters: () => ({ writes, reloads, relaunches }),
    timerDeadlines: () => [...timers.values()].map(timer => timer.at).sort((a, b) => a - b),
    online: () => { for (const listener of listeners.get("window:online") ?? []) listener(); },
    visibility(value) { visible = value; for (const listener of listeners.get("document:visibilitychange") ?? []) listener(); },
    shiftWall(delta) { wall += delta; },
    setEnabled(value) { enabled = value; render(); if (mounted) commit(); },
    unmount,
    async advance(milliseconds) {
      const target = now + milliseconds;
      for (;;) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > target) break;
        wall += next[1].at - now;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
        await flush();
      }
      wall += target - now;
      now = target;
      await flush();
    },
  };
}

test("desktop health checks the shell-verified identity route", async () => {
  const controller = new AbortController();
  const request = async (url, options) => {
    assert.equal(url, "/api/desktop/identity");
    assert.equal(options.method, "GET");
    assert.equal(options.cache, "no-store");
    assert.equal(options.signal, controller.signal);
    return new Response(null, { status: 204, headers: { "x-pi-desktop-instance": "test-instance" } });
  };
  assert.equal(await readPackagedServerIdentity(request, controller.signal), "test-instance");
});

test("desktop health rejects a response without the packaged identity", async () => {
  const signal = new AbortController().signal;
  assert.equal(await readPackagedServerIdentity(async () => new Response(null, { status: 200 }), signal), null);
  assert.equal(await readPackagedServerIdentity(async () => new Response(null, { status: 204 }), signal), null);
});

test("desktop identity observation distinguishes HTTP failure from a missing header without reading a body", async () => {
  const results = [];
  for (const status of [503, 204]) {
    const response = { status, headers: new Headers(), get body() { throw new Error("body must remain unread"); } };
    assert.equal(await readPackagedServerIdentity(async () => response, new AbortController().signal, result => results.push(result)), null);
  }
  assert.deepEqual(results, [{ outcome: "http", httpStatus: 503 }, { outcome: "missing_header", httpStatus: 204 }]);
});

test("desktop probe preserves the 4s deadline, two-failure threshold and 8s interval", async t => {
  const fixture = connectionHarness(t);
  assert.equal(fixture.requests.length, 1);
  await fixture.advance(3_999);
  assert.equal(fixture.view().state, "checking");
  await fixture.advance(1);
  assert.equal(fixture.view().state, "checking");
  await fixture.advance(7_999);
  assert.equal(fixture.requests.length, 1);
  await fixture.advance(1);
  assert.equal(fixture.requests.length, 2);
  await fixture.advance(23);
  fixture.requests[1].resolve(new Response(null, { status: 503 }));
  await flush();
  assert.equal(fixture.view().state, "offline");
  assert.deepEqual(fixture.diagnostics().map(row => [row.outcome, row.httpStatus, row.durationMs]), [["timeout", null, 4_000], ["http", 503, 23]]);
});

test("desktop diagnostics retain fixed failure reasons, monotonic timing and anonymous instance continuity", async t => {
  const secret = "private-instance-token-/Users/private-teacher?https://secret.invalid/body";
  const fixture = connectionHarness(t);
  const body = { status: 200, headers: new Headers(), get body() { throw new Error(secret); } };
  const outcomes = [
    () => fixture.requests.at(-1).resolve(body),
    () => fixture.requests.at(-1).resolve(new Response(null, { status: 204 })),
    () => fixture.requests.at(-1).reject(new Error(secret)),
    () => fixture.requests.at(-1).resolve(identity(secret)),
    () => fixture.requests.at(-1).resolve(identity(secret)),
    () => fixture.requests.at(-1).resolve(identity("different-private-instance")),
    () => fixture.requests.at(-1).resolve(identity(secret)),
  ];
  for (let index = 0; index < outcomes.length; index++) {
    if (index) fixture.online();
    await fixture.advance(12);
    if (index === 0) { fixture.visibility("hidden"); fixture.shiftWall(-60_000); }
    outcomes[index]();
    await flush();
  }
  const records = fixture.diagnostics();
  assert.deepEqual(records.map(row => row.outcome), ["http", "missing_header", "network", "ok", "ok", "identity_mismatch", "ok"]);
  assert.deepEqual(records.map(row => row.instance), ["unavailable", "unavailable", "unavailable", "pinned", "same", "changed", "same"]);
  assert.equal(records[0].visibility, "visible");
  assert.equal(records[0].settledVisibility, "hidden");
  assert.ok(records.every(row => row.durationMs === 12 && row.documentStartedAt === 1_699_999_999_000));
  assert.equal(fixture.view().state, "online");
  const allowedKeys = ["documentStartedAt", "durationMs", "httpStatus", "instance", "outcome", "sequence", "settledVisibility", "startedAt", "visibility"].sort();
  for (const record of records) assert.deepEqual(Object.keys(record).sort(), allowedKeys);
  for (const forbidden of [secret, "different-private-instance", "secret.invalid", "/Users/", "body", "error", "token"]) assert.ok(!JSON.stringify(records).includes(forbidden));
});

test("desktop diagnostics keep only the newest eight accepted probes", async t => {
  const fixture = connectionHarness(t);
  for (let index = 0; index < 10; index++) {
    if (index) fixture.online();
    await fixture.advance(1);
    fixture.requests.at(-1).resolve(identity("private-instance"));
    await flush();
  }
  const records = fixture.diagnostics();
  assert.deepEqual(records.map(row => row.sequence), [3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(records.every(row => row.outcome === "ok" && row.instance === "same"));
});

test("superseded success and failure cannot pin identity, write diagnostics or reschedule a newer probe", async t => {
  for (const lateFailure of [false, true]) {
    const fixture = connectionHarness(t, { ignoreAbort: true });
    fixture.online();
    assert.equal(fixture.requests[0].options.signal.aborted, true);
    await fixture.advance(20);
    fixture.requests[1].resolve(identity("new-private-instance"));
    await flush();
    const timers = fixture.timerDeadlines().filter(deadline => deadline >= 8_000);
    await fixture.advance(10);
    if (lateFailure) fixture.requests[0].reject(new Error("late private error"));
    else fixture.requests[0].resolve(identity("old-private-instance"));
    await flush();
    assert.equal(fixture.view().state, "online");
    assert.deepEqual(fixture.timerDeadlines().filter(deadline => deadline >= 8_000), timers, "a superseded completion must not move the current 8s timer");
    assert.deepEqual(fixture.diagnostics().map(row => [row.sequence, row.instance]), [[2, "pinned"]]);
    fixture.online();
    fixture.requests[2].resolve(identity("new-private-instance"));
    await flush();
    assert.equal(fixture.diagnostics().at(-1).instance, "same");
  }
});

test("unmounted and disabled probes cannot write state, diagnostics or schedule new work", async t => {
  for (const disable of [false, true]) {
    const fixture = connectionHarness(t, { ignoreAbort: true });
    if (disable) fixture.setEnabled(false);
    else fixture.unmount();
    const writes = fixture.counters().writes;
    fixture.requests[0].resolve(identity("late-private-instance"));
    await flush();
    fixture.online();
    fixture.view().retry();
    await flush();
    assert.equal(fixture.counters().writes, writes);
    assert.equal(fixture.requests.length, 1);
    assert.deepEqual(fixture.timerDeadlines(), []);
    assert.deepEqual(fixture.diagnostics(), []);
  }
});

test("a hook that has not mounted does not start a retry or record a probe", async t => {
  const fixture = connectionHarness(t, { mount: false });
  fixture.view().retry();
  await flush();
  assert.equal(fixture.requests.length, 0);
  assert.deepEqual(fixture.diagnostics(), []);
});

test("a superseded native reconnect failure cannot overwrite a later successful probe", async t => {
  const relaunch = deferred();
  const fixture = connectionHarness(t, { relaunch: () => relaunch.promise });
  fixture.requests[0].reject(new Error("first network failure"));
  await flush();
  fixture.view().retry();
  fixture.requests[1].reject(new Error("retry network failure"));
  await flush();
  assert.equal(fixture.counters().relaunches, 1);
  fixture.online();
  fixture.requests[2].resolve(identity("current-instance"));
  await flush();
  const timers = fixture.timerDeadlines();
  relaunch.reject(new Error("late native failure"));
  await flush();
  assert.equal(fixture.view().state, "online");
  assert.deepEqual(fixture.timerDeadlines(), timers);
  assert.deepEqual(fixture.diagnostics().map(row => row.outcome), ["network", "network", "ok"]);
});

test("a current successful reconnect still reloads existing HTTP and SSE connections", async t => {
  const fixture = connectionHarness(t);
  fixture.requests[0].reject(new Error("network failure"));
  await flush();
  fixture.view().retry();
  fixture.requests[1].resolve(identity("current-instance"));
  await flush();
  assert.equal(fixture.counters().reloads, 1);
  assert.equal(fixture.counters().relaunches, 0);
});

test("Reconnect refreshes healthy connections and relaunches a dead local server", async () => {
  const [connection, native] = await Promise.all([
    readFile(connectionSource, "utf8"),
    readFile(nativeSource, "utf8"),
  ]);
  assert.match(connection, /window\.location\.reload\(\)/);
  assert.match(connection, /await relaunchAppNative\(\)/);
  assert.match(native, /import\("@tauri-apps\/plugin-process"\)/);
  assert.match(native, /await relaunch\(\)/);
});
