import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { readSavedUpdateProxy, getLatestAppReleaseWithConfiguredProxy } = await jiti.import("./update-proxy-server.ts");
const { APP_UPDATE_PROJECTS } = await jiti.import("./app-updates.ts");

test("server reads only a valid dedicated loopback proxy file", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "edupi-update-proxy-server-"));
  const file = path.join(dir, "updater-proxy.json");
  try {
    assert.equal(await readSavedUpdateProxy(dir), null);
    await writeFile(file, JSON.stringify({ updateProxy: "http://127.0.0.1:7897" }));
    assert.equal(await readSavedUpdateProxy(dir), "http://127.0.0.1:7897");
    for (const bad of ['{}', '{"updateProxy":""}', '{"updateProxy":"http://evil.example:7897"}', '{"updateProxy":"http://user:secret@127.0.0.1:7897"}', '{broken']) {
      await writeFile(file, bad);
      await assert.rejects(readSavedUpdateProxy(dir), /更新代理设置不可用/);
    }
    await rm(file);
    await symlink(path.join(dir, "missing"), file);
    await assert.rejects(readSavedUpdateProxy(dir), /更新代理设置不可用/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("release check scopes ProxyAgent to one request and closes it", async () => {
  const source = await readFile(new URL("./update-proxy-server.ts", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/updates/route.ts", import.meta.url), "utf8");
  assert.match(source, /new ProxyAgent\(proxy\)/);
  assert.match(source, /dispatcher: agent/);
  assert.match(source, /finally \{[\s\S]*await agent\.close\(\)/);
  assert.doesNotMatch(source, /setGlobalDispatcher/);
  assert.match(route, /getLatestAppReleaseWithConfiguredProxy\(project\)/);
});

test("configured release check sends CONNECT only to its loopback proxy", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "edupi-update-proxy-connect-"));
  let firstLine = "";
  const server = createServer((socket) => socket.once("data", (chunk) => {
    firstLine = chunk.toString("utf8").split("\r\n")[0];
    socket.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
  }));
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    await writeFile(path.join(dir, "updater-proxy.json"), JSON.stringify({ updateProxy: `http://127.0.0.1:${port}` }));
    await assert.rejects(getLatestAppReleaseWithConfiguredProxy(APP_UPDATE_PROJECTS[0], dir), /更新代理连接失败/);
    assert.match(firstLine, /^CONNECT api\.github\.com:443 HTTP\//);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test("the server discovery uses the native-admitted cohort without changing the normal release path", async t => {
  const dir = await mkdtemp(path.join(tmpdir(), "edupi-update-cohort-"));
  const keys = ["EDUPI_ISOLATED_UPDATE_FEED", "EDUPI_DESKTOP_ISOLATED_CANARY"];
  const saved = keys.map(key => process.env[key]);
  const feed = `https://raw.githubusercontent.com/PIGU-PPPgu/edupi-desktop/${"a".repeat(40)}/docs/acceptance/update-cohorts/test.json`;
  const requests = [];
  t.mock.method(globalThis, "fetch", async url => {
    requests.push(url);
    return Response.json({ version: "0.3.117" });
  });
  try {
    process.env.EDUPI_ISOLATED_UPDATE_FEED = feed;
    delete process.env.EDUPI_DESKTOP_ISOLATED_CANARY;
    await assert.rejects(getLatestAppReleaseWithConfiguredProxy(APP_UPDATE_PROJECTS[0], dir), /独立验收资料目录/);
    assert.equal(requests.length, 0);
    process.env.EDUPI_DESKTOP_ISOLATED_CANARY = "1";
    const release = await getLatestAppReleaseWithConfiguredProxy({ ...APP_UPDATE_PROJECTS[0], currentVersion: "0.3.116" }, dir);
    assert.equal(release.updateAvailable, true);
    assert.deepEqual(requests, [feed]);
  } finally {
    keys.forEach((key, index) => {
      if (saved[index] === undefined) delete process.env[key];
      else process.env[key] = saved[index];
    });
    await rm(dir, { recursive: true, force: true });
  }
});
