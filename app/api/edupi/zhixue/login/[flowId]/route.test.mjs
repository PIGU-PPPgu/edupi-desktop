import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const { GET } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./route.ts");

test("only the desktop owner can read the exact flow, with no credentials in the reply", async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "edupi-zhixue-route-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, ".edupi", "zhixue");
  await mkdir(directory, { recursive: true });
  const flowId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
  const desktopToken = "synthetic-test-desktop-token".repeat(2);
  const environment = { EDUPI_DATA_ROOT: root, EDUPI_DATA_ALLOWED_ROOT: root, PI_DESKTOP_API_TOKEN: desktopToken };
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const write = (name, value) => writeFile(join(directory, name), JSON.stringify({ version: 1, flowId, ...value }));
  await write("login-state.json", { status: "authenticated" });
  await write("login_ok.json", {});
  await write("session.json", { token: "fixture-private-token", cookies: [{ name: "fixture", value: "fixture-private-cookie" }] });

  const get = (id = flowId, headers = {}) => GET(
    new Request("http://127.0.0.1:38471/api/edupi/zhixue/login", { headers: { host: "127.0.0.1:38471", ...headers } }),
    { params: Promise.resolve({ flowId: id }) },
  );
  const authorized = { "x-pi-desktop-token": desktopToken };
  assert.equal((await get()).status, 403);
  assert.equal((await get(flowId, { ...authorized, origin: "https://example.invalid" })).status, 403);
  assert.equal((await get(flowId, { ...authorized, host: "192.0.2.1:38471" })).status, 403);
  assert.equal((await get("../session.json", authorized)).status, 400);
  const stale = await get("bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb", authorized);
  assert.deepEqual(await stale.json(), { status: "not_current" });
  const reply = await get(flowId, authorized);
  assert.equal(reply.status, 200);
  assert.equal(reply.headers.get("cache-control"), "no-store, private");
  assert.deepEqual(await reply.json(), { status: "authenticated", needsSyncConfig: true });
});
