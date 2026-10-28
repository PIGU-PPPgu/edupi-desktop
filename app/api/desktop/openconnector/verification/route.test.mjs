import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const route = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./route.ts");
const token = "desktop-test-token-that-is-not-a-real-token";
function request(method, body, extraHeaders = {}) {
  return new Request("http://127.0.0.1:30141/api/desktop/openconnector/verification", {
    method,
    headers: { host: "127.0.0.1:30141", origin: "http://127.0.0.1:30141", "sec-fetch-site": "same-origin", "x-pi-desktop-token": token,
      ...(body === undefined ? {} : { "content-type": "application/json" }), ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("GitHub verification route requires native token, same-origin and loopback", async () => {
  const previous = process.env.PI_DESKTOP_API_TOKEN;
  process.env.PI_DESKTOP_API_TOKEN = token;
  try {
    for (const headers of [{ "x-pi-desktop-token": "wrong" }, { origin: "https://attacker.example", "sec-fetch-site": "cross-site" }, { host: "192.168.1.1:30141", origin: "http://192.168.1.1:30141" }]) {
      assert.equal((await route.GET(request("GET", undefined, headers))).status, 403);
      assert.equal((await route.POST(request("POST", { op: "connect" }, headers))).status, 403);
    }
  } finally { if (previous === undefined) delete process.env.PI_DESKTOP_API_TOKEN; else process.env.PI_DESKTOP_API_TOKEN = previous; }
});

test("route rejects non-JSON, oversized, arbitrary operation/action/credential input before any CLI or host", async () => {
  const previous = process.env.PI_DESKTOP_API_TOKEN;
  process.env.PI_DESKTOP_API_TOKEN = token;
  try {
    assert.equal((await route.POST(request("POST", { op: "connect" }, { "content-type": "text/plain" }))).status, 415);
    for (const body of [{ op: "connect", apiKey: "do-not-accept" }, { op: "execute", actionId: "github.create_repository" }, { op: "verify" }]) {
      assert.equal((await route.POST(request("POST", body))).status, 400);
    }
    assert.equal((await route.POST(request("POST", { op: "connect", input: "x".repeat(2000) }))).status, 413);
  } finally { if (previous === undefined) delete process.env.PI_DESKTOP_API_TOKEN; else process.env.PI_DESKTOP_API_TOKEN = previous; }
});

test("authenticated status reports unsupported when packaged runtime is absent", async () => {
  const previous = { token: process.env.PI_DESKTOP_API_TOKEN, root: process.env.EDUPI_OPENCONNECTOR_CATALOG_ROOT };
  process.env.PI_DESKTOP_API_TOKEN = token;
  delete process.env.EDUPI_OPENCONNECTOR_CATALOG_ROOT;
  try {
    const response = await route.GET(request("GET"));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { ok: true, data: { supported: false, connection: null, receipt: null } });
  } finally {
    if (previous.token === undefined) delete process.env.PI_DESKTOP_API_TOKEN; else process.env.PI_DESKTOP_API_TOKEN = previous.token;
    if (previous.root === undefined) delete process.env.EDUPI_OPENCONNECTOR_CATALOG_ROOT; else process.env.EDUPI_OPENCONNECTOR_CATALOG_ROOT = previous.root;
  }
});
