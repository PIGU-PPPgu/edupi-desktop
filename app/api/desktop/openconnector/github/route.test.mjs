import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const route = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./route.ts");
const token = "native-oauth-test-token-that-is-not-a-real-token";
function request(method, body, headers = {}) {
  return new Request("http://127.0.0.1:30141/api/desktop/openconnector/github", { method,
    headers: { host: "127.0.0.1:30141", origin: "http://127.0.0.1:30141", "sec-fetch-site": "same-origin", "x-pi-desktop-token": token,
      ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
test("OAuth/write route requires native token, loopback and same origin", async () => {
  const old = process.env.PI_DESKTOP_API_TOKEN; process.env.PI_DESKTOP_API_TOKEN = token;
  try {
    for (const headers of [{ "x-pi-desktop-token": "wrong" }, { origin: "https://other.example", "sec-fetch-site": "cross-site" }, { host: "192.168.1.4:30141", origin: "http://192.168.1.4:30141" }]) {
      assert.equal((await route.GET(request("GET", undefined, headers))).status, 403);
      assert.equal((await route.POST(request("POST", { op: "prepareTestIssue" }, headers))).status, 403);
    }
    assert.equal((await route.POST(request("POST", { op: "startOAuth" }, { "content-type": "text/plain" }))).status, 415);
    for (const body of [{ op: "createTestIssue", input: { title: "anything" } }, { op: "startOAuth", scopes: ["repo"] },
      { op: "configureOAuth", clientId: "f".repeat(40), clientSecret: "fixture-secret-do-not-save" }]) assert.equal((await route.POST(request("POST", body))).status, 400);
    assert.equal((await route.POST(request("POST", { op: "configureOAuth", filler: "x".repeat(5000) }))).status, 413);
  } finally { if (old === undefined) delete process.env.PI_DESKTOP_API_TOKEN; else process.env.PI_DESKTOP_API_TOKEN = old; }
});
test("status without packaged host reports unsupported and returns no credentials", async () => {
  const oldToken = process.env.PI_DESKTOP_API_TOKEN, oldRoot = process.env.EDUPI_OPENCONNECTOR_CATALOG_ROOT;
  process.env.PI_DESKTOP_API_TOKEN = token; delete process.env.EDUPI_OPENCONNECTOR_CATALOG_ROOT;
  try {
    const response = await route.GET(request("GET"));
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json(); assert.equal(body.data.supported, false);
    assert.equal(JSON.stringify(body).includes("clientSecret"), false);
  } finally {
    if (oldToken === undefined) delete process.env.PI_DESKTOP_API_TOKEN; else process.env.PI_DESKTOP_API_TOKEN = oldToken;
    if (oldRoot === undefined) delete process.env.EDUPI_OPENCONNECTOR_CATALOG_ROOT; else process.env.EDUPI_OPENCONNECTOR_CATALOG_ROOT = oldRoot;
  }
});

test("acceptance expiry is unavailable unless the server explicitly enables it", async () => {
  const oldToken = process.env.PI_DESKTOP_API_TOKEN, oldGate = process.env.EDUPI_OPENCONNECTOR_GITHUB_ACCEPTANCE;
  process.env.PI_DESKTOP_API_TOKEN = token; delete process.env.EDUPI_OPENCONNECTOR_GITHUB_ACCEPTANCE;
  try {
    const response = await route.POST(request("POST", { op: "expireTokenForAcceptance" }));
    assert.equal(response.status, 403); assert.equal((await response.json()).code, "github_acceptance_disabled");
    for (const op of ["checkConnection", "refreshOAuth", "expireTokenForAcceptance"]) {
      assert.equal((await route.POST(request("POST", { op, acceptanceEnabled: true }))).status, 400);
      assert.equal((await route.POST(request("POST", { op }, { "x-pi-desktop-token": "wrong" }))).status, 403);
    }
  } finally {
    if (oldToken === undefined) delete process.env.PI_DESKTOP_API_TOKEN; else process.env.PI_DESKTOP_API_TOKEN = oldToken;
    if (oldGate === undefined) delete process.env.EDUPI_OPENCONNECTOR_GITHUB_ACCEPTANCE; else process.env.EDUPI_OPENCONNECTOR_GITHUB_ACCEPTANCE = oldGate;
  }
});
