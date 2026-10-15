import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { fetchStagedGetAfterReset } from "./staged-read-retry.mjs";

const reset = () => Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });

test("retries one reset on a packaged-server GET with a fresh deadline", async () => {
  const calls = [];
  const response = { status: 503 };
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) throw reset();
    return response;
  };

  assert.equal(await fetchStagedGetAfterReset("http://127.0.0.1:1/read", { origin: "test" }, fetchImpl), response);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, calls[1].url);
  assert.deepEqual(calls[0].options.headers, calls[1].options.headers);
  assert.notEqual(calls[0].options.signal, calls[1].options.signal);
  assert.equal(calls[0].options.method, undefined);
});

test("a second reset remains a failure", async () => {
  let calls = 0;
  await assert.rejects(fetchStagedGetAfterReset("http://127.0.0.1:1/read", {}, async () => {
    calls += 1;
    throw reset();
  }), (error) => error.cause?.code === "ECONNRESET");
  assert.equal(calls, 2);
});

test("a real socket reset can recover on the same read-only route", async () => {
  let calls = 0;
  const server = createServer((request, response) => {
    calls += 1;
    if (calls === 1) request.socket.destroy();
    else { response.statusCode = 503; response.end("unavailable"); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetchStagedGetAfterReset(`http://127.0.0.1:${server.address().port}/read`, {});
    assert.equal(response.status, 503);
    assert.equal(calls, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("other failures and HTTP responses are not retried", async () => {
  let calls = 0;
  await assert.rejects(fetchStagedGetAfterReset("http://127.0.0.1:1/read", {}, async () => {
    calls += 1;
    throw new Error("unexpected failure");
  }), /unexpected failure/);
  assert.equal(calls, 1);

  const response = { status: 500 };
  assert.equal(await fetchStagedGetAfterReset("http://127.0.0.1:1/read", {}, async () => {
    calls += 1;
    return response;
  }), response);
  assert.equal(calls, 2);
});
