import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const connectionSource = new URL("./desktop-connection.ts", import.meta.url);
const nativeSource = new URL("./desktop-native.ts", import.meta.url);
const { readPackagedServerIdentity } = await createJiti(import.meta.url, { tsconfigPaths: true })
  .import("./desktop-connection-probe.ts");

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

test("desktop health probes ignore superseded wake-up requests", async () => {
  const source = await readFile(connectionSource, "utf8");
  assert.match(source, /readPackagedServerIdentity\(fetch, controller\.signal\)/);
  assert.match(source, /instanceIdRef\.current !== instanceId/);
  assert.match(source, /probeControllerRef\.current\?\.abort\(\)/);
  assert.match(source, /probeControllerRef\.current !== controller/);
  assert.match(source, /probeControllerRef\.current === controller/);
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
