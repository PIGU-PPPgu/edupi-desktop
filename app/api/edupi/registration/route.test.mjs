import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const { GET, POST } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./route.ts");

function request(method, body, headers = {}) {
  return new Request("http://localhost/api/edupi/registration", {
    method,
    headers: {
      host: "localhost",
      origin: "http://localhost",
      "sec-fetch-site": "same-origin",
      ...(method === "POST" ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    ...(method === "POST" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
}

async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), "edupi-registration-route-"));
  const previous = process.env.EDUPI_REGISTRATION_FILE;
  process.env.EDUPI_REGISTRATION_FILE = join(directory, "registration.json");
  globalThis.__edupiRegistrationAttempts = undefined;
  try {
    await run(process.env.EDUPI_REGISTRATION_FILE);
  } finally {
    if (previous === undefined) delete process.env.EDUPI_REGISTRATION_FILE;
    else process.env.EDUPI_REGISTRATION_FILE = previous;
    globalThis.__edupiRegistrationAttempts = undefined;
    await rm(directory, { recursive: true, force: true });
  }
}

test("registration rejects cross-site, non-JSON, oversized and unknown inputs", async () => {
  await fixture(async () => {
    assert.equal((await POST(request("POST", { inviteCode: "x" }, { origin: "https://evil.example", "sec-fetch-site": "cross-site" }))).status, 403);
    assert.equal((await POST(request("POST", { inviteCode: "x" }, { "content-type": "text/plain" }))).status, 415);
    assert.equal((await POST(request("POST", { inviteCode: "x", admin: true }))).status, 400);
    assert.equal((await POST(request("POST", "{"))).status, 400);
    assert.equal((await POST(request("POST", { inviteCode: "x".repeat(900) }))).status, 413);
  });
});

test("wrong codes are generic and a correct code registers idempotently", async () => {
  await fixture(async () => {
    const wrong = await POST(request("POST", { inviteCode: "wrong" }));
    assert.equal(wrong.status, 401);
    assert.doesNotMatch(JSON.stringify(await wrong.json()), /welcometoedupi/);

    const created = await POST(request("POST", { inviteCode: "welcometoedupi" }));
    assert.equal(created.status, 201);
    assert.equal((await created.json()).registered, true);

    const current = await GET(request("GET"));
    assert.equal(current.status, 200);
    assert.equal((await current.json()).registered, true);
    assert.equal(current.headers.get("cache-control"), "no-store");

    const repeated = await POST(request("POST", { inviteCode: "anything" }));
    assert.equal(repeated.status, 200);
  });
});

test("repeated wrong codes are rate limited", async () => {
  await fixture(async () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      assert.equal((await POST(request("POST", { inviteCode: "wrong" }))).status, 401);
    }
    const blocked = await POST(request("POST", { inviteCode: "welcometoedupi" }));
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get("retry-after"), "60");
  });
});

test("a corrupt registration file fails closed without exposing internals", async () => {
  await fixture(async (path) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "{broken", { mode: 0o600 });
    const response = await GET(request("GET"));
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: "registration_unavailable",
      reason: "本机注册状态暂不可用。",
    });
  });
});
