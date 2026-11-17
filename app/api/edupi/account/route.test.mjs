import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET, POST } = await jiti.import("./route.ts");
const url = "http://127.0.0.1:30141/api/edupi/account";
const request = (body, extra = {}) => new Request(url, { method: body ? "POST" : "GET",
  headers: { host: "127.0.0.1:30141", origin: "http://127.0.0.1:30141", ...(body ? { "Content-Type": "application/json" } : {}), ...extra },
  ...(body ? { body: JSON.stringify(body) } : {}) });

test("account endpoints reject cross-origin, non-loopback and missing native credentials", async () => {
  for (const headers of [{ origin: "https://example.org" }, { host: "192.168.1.10:30141", origin: "http://192.168.1.10:30141" }]) {
    assert.equal((await GET(request(null, headers))).status, 403);
    assert.equal((await POST(request({ action: "logout" }, headers))).status, 403);
  }
  const previous = process.env.PI_DESKTOP_API_TOKEN;
  const previousUrl = process.env.EDUPI_ACCOUNT_SERVICE_URL;
  process.env.PI_DESKTOP_API_TOKEN = "synthetic-private-desktop-token-1234567890";
  delete process.env.EDUPI_ACCOUNT_SERVICE_URL;
  try {
    assert.equal((await GET(request(null))).status, 403);
    const valid = await GET(request(null, { "x-pi-desktop-token": process.env.PI_DESKTOP_API_TOKEN }));
    assert.equal(valid.status, 200);
    assert.equal((await valid.json()).status.state, "unconfigured");
  } finally {
    if (previous === undefined) delete process.env.PI_DESKTOP_API_TOKEN; else process.env.PI_DESKTOP_API_TOKEN = previous;
    if (previousUrl !== undefined) process.env.EDUPI_ACCOUNT_SERVICE_URL = previousUrl;
  }
});

test("unconfigured account status is explicit and never cached", async () => {
  const previous = process.env.EDUPI_ACCOUNT_SERVICE_URL;
  delete process.env.EDUPI_ACCOUNT_SERVICE_URL;
  try {
    const response = await GET(request(null));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status.state, "unconfigured");
    assert.equal(body.status.localDataMode, "local");
    assert.match(response.headers.get("cache-control"), /no-store/u);
  } finally { if (previous !== undefined) process.env.EDUPI_ACCOUNT_SERVICE_URL = previous; }
});

test("account action schema rejects caller-supplied verified identities and credentials", async () => {
  for (const body of [{ action: "login", account_id: "fake" }, { action: "start", purpose: "login", accessToken: "fake" }, { action: "refresh", verified: true }]) {
    const response = await POST(request(body));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "invalid_request");
  }
});
