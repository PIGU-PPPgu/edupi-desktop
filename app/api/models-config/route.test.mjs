import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

test("credential-bearing model configuration rejects LAN and tokenless requests before reading or writing", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-model-api-"));
  const oldAgent = process.env.PI_CODING_AGENT_DIR;
  const oldToken = process.env.PI_DESKTOP_API_TOKEN;
  const token = "synthetic-private-model-token-12345678901234567890";
  process.env.PI_CODING_AGENT_DIR = root;
  process.env.PI_DESKTOP_API_TOKEN = token;
  fs.writeFileSync(path.join(root, "models.json"), JSON.stringify({ providers: { fixture: { apiKey: "synthetic-private-key" } } }));
  try {
    const { GET, PUT } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./route.ts");
    const make = (host, method = "GET", authorized = false, body = undefined) => new Request(`http://${host}/api/models-config`, {
      method,
      headers: { host, ...(authorized ? { "x-pi-desktop-token": token } : {}), ...(method === "PUT" ? { "content-type": "application/json" } : {}) },
      ...(body === undefined ? {} : { body }),
    });
    assert.equal((await GET(make("127.0.0.1:30141"))).status, 403);
    assert.equal((await GET(make("192.168.1.10:30141", "GET", true))).status, 403);
    assert.equal((await PUT(make("127.0.0.1:30141", "PUT", false, "{}"))).status, 403);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, "models.json"), "utf8")).providers.fixture.apiKey, "synthetic-private-key");
    const allowed = await GET(make("127.0.0.1:30141", "GET", true));
    assert.equal(allowed.status, 200);
    assert.equal((await allowed.json()).providers.fixture.apiKey, "synthetic-private-key");
    assert.equal((await PUT(make("127.0.0.1:30141", "PUT", true, "x".repeat(1_500_001)))).status, 413);
  } finally {
    if (oldAgent === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldAgent;
    if (oldToken === undefined) delete process.env.PI_DESKTOP_API_TOKEN; else process.env.PI_DESKTOP_API_TOKEN = oldToken;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
