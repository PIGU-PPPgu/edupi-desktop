import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { parseMacSystemProxy, readDesktopSystemProxy } = await jiti.import("./desktop-system-proxy.ts");
const settings = (port) => `<dictionary> {
  HTTPEnable : 1
  HTTPPort : ${port}
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : ${port}
  HTTPSProxy : 127.0.0.1
}`;

test("macOS proxy parsing preserves explicit settings and local bypass", () => {
  assert.deepEqual(parseMacSystemProxy(settings(7897), "*.internal"), {
    httpProxy: "http://127.0.0.1:7897",
    httpsProxy: "http://127.0.0.1:7897",
    noProxy: "localhost,127.0.0.1,::1,[::1],*.internal",
  });
  for (const value of ["", settings(0), settings(65536), settings("7897/anything"),
    settings(7897).replaceAll("127.0.0.1", "untrusted.example"),
    settings(7897).replaceAll("Enable : 1", "Enable : 0")]) {
    assert.equal(parseMacSystemProxy(value), undefined);
  }
});

test("system lookup only applies to the desktop on macOS and respects proxy environment", async () => {
  let reads = 0;
  const read = async () => { reads += 1; return settings(7897); };
  const desktop = { PI_DESKTOP_STATE_DIR: "/private/state" };
  for (const options of [{ platform: "linux", env: desktop }, { platform: "darwin", env: {} },
    ...["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"]
      .map((key) => ({ platform: "darwin", env: { ...desktop, [key]: "http://explicit.example:8080" } }))]) {
    assert.equal(await readDesktopSystemProxy({ ...options, read }), undefined);
  }
  assert.equal(reads, 0);
  assert.ok(await readDesktopSystemProxy({ platform: "darwin", env: desktop, read }));
  assert.equal(reads, 1);
  assert.ok(await readDesktopSystemProxy({ platform: "darwin", env: { ...desktop, ALL_PROXY: "socks5://127.0.0.1:9999" }, read }));
  assert.equal(reads, 2, "unsupported ALL_PROXY does not suppress the existing macOS proxy");
  assert.equal(await readDesktopSystemProxy({ platform: "darwin", env: desktop, read: async () => { throw Error("unavailable"); } }), undefined);
});

test("desktop system proxy actually receives global fetch while loopback stays direct", async () => {
  const forwarded = [];
  const proxy = http.createServer((req, res) => { forwarded.push(req.url); res.writeHead(204); res.end(); });
  const local = http.createServer((_req, res) => { res.end("local"); });
  await Promise.all([proxy, local].map((server) => new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))));
  const { getGlobalDispatcher, setGlobalDispatcher } = await import("undici");
  const originalDispatcher = getGlobalDispatcher();
  const originalFetch = globalThis.fetch;
  try {
    const { configureHttpDispatcher } = await jiti.import("./http-dispatcher.ts");
    configureHttpDispatcher(2000, parseMacSystemProxy(settings(proxy.address().port)));
    const response = await fetch("http://upstream.invalid/system-proxy", { signal: AbortSignal.timeout(2000) });
    assert.equal(response.status, 204);
    assert.deepEqual(forwarded, ["http://upstream.invalid/system-proxy"]);
    assert.equal(await (await fetch(`http://127.0.0.1:${local.address().port}/api/home`)).text(), "local");
    assert.equal(forwarded.length, 1);
    await getGlobalDispatcher().close();
  } finally {
    setGlobalDispatcher(originalDispatcher);
    globalThis.fetch = originalFetch;
    delete globalThis.__piWebHttpDispatcherConfigured;
    for (const server of [proxy, local]) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  }
});
