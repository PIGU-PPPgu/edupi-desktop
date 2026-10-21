import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import semver from "semver";
import { createConsoleHttpServer } from "../desktop/open-connector-console-host.mjs";
import { handleCatalogLine, readCatalogLines } from "../desktop/open-connector-catalog-host.mjs";

const connectorEntry = import.meta.resolve("@oomol-lab/open-connector");
const connectorRequire = createRequire(connectorEntry);
const desktopRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { withMcpClient } = await import(new URL("../providers/mcp-client.js", connectorEntry));
const { createProviderFetch } = await import(new URL("../providers/provider-runtime.js", connectorEntry));
const installedVersion = name => JSON.parse(fs.readFileSync(path.resolve(path.dirname(connectorRequire.resolve(name)), "..", "package.json"), "utf8")).version;

test("OpenConnector resolves patched MCP server and client at the real package boundary", () => {
  for (const name of ["@modelcontextprotocol/server", "@modelcontextprotocol/client"]) {
    assert.ok(semver.gte(installedVersion(name), "2.3.0"), name + " must close the reviewed 2.3.0 advisories");
  }
});

test("the actual console listener denies MCP and writes before runtime.fetch", { timeout: 10000 }, async () => {
  const forwarded = [];
  const server = await createConsoleHttpServer({ assetRoot: path.join(desktopRoot, "desktop", "open-connector-console-assets"),
    runtime: { fetch: async request => { forwarded.push({ method: request.method, pathname: new URL(request.url).pathname }); return Response.json({ synthetic: true }); } } });
  try {
    for (const [method, pathname] of [["GET", "/mcp"], ["POST", "/mcp"], ["DELETE", "/mcp"],
      ["GET", "/mcp/tools"], ["GET", "/mcp?probe=1"], ["GET", "/v1/actions/synthetic.read"],
      ["POST", "/api/actions/synthetic.read"], ["POST", "/api/connections"], ["DELETE", "/api/connections"]]) {
      const response = await fetch(new URL(pathname, server.url), { method, signal: AbortSignal.timeout(3000),
        ...(method === "POST" ? { headers: { "content-type": "application/json" }, body: "{}" } : {}) });
      await response.arrayBuffer();
      assert.ok([403, 404].includes(response.status), method + " " + pathname + " must remain unavailable");
      assert.deepEqual(forwarded, [], "rejected paths must not enter the package runtime or MCP parser");
    }
    const foreignOrigin = await fetch(new URL("/api/providers", server.url), { headers: { origin: "https://synthetic.invalid" }, signal: AbortSignal.timeout(3000) });
    assert.equal(foreignOrigin.status, 403);
    await foreignOrigin.arrayBuffer();
    assert.deepEqual(forwarded, []);
    const allowed = await fetch(new URL("/api/providers", server.url), { signal: AbortSignal.timeout(3000) });
    assert.equal(allowed.status, 200);
    await allowed.arrayBuffer();
    assert.deepEqual(forwarded, [{ method: "GET", pathname: "/api/providers" }], "the read-only catalog remains usable");
  } finally { await server.close(); }
});

test("catalog stdio frames can invoke only bounded fixed GET discovery paths", async () => {
  const calls = [];
  const runtime = { fetch: async request => { calls.push({ method: request.method, url: new URL(request.url) }); return Response.json({ success: true, data: [] }); } };
  for (const value of [{ id: "probe", op: "mcp" }, { id: "probe", op: "execute", actionId: "synthetic.read" },
    { id: "probe", op: "inspect", actionId: "../mcp" }, { id: "probe", op: "providers", method: "POST" }]) {
    assert.equal((await handleCatalogLine(runtime, JSON.stringify(value))).ok, false);
  }
  assert.equal((await handleCatalogLine(runtime, "x".repeat(8 * 1024 + 1))).ok, false);
  const oversizedFrames = [];
  for await (const line of readCatalogLines(Readable.from([Buffer.alloc(8 * 1024 + 1, 0x61), Buffer.from("\n")]))) oversizedFrames.push(line);
  assert.deepEqual(oversizedFrames, [null]);
  assert.deepEqual(calls, []);
  for (const request of [{ id: "providers", op: "providers" }, { id: "actions", op: "actions", service: "synthetic" },
    { id: "search", op: "search", query: "synthetic /mcp", service: "synthetic" },
    { id: "inspect", op: "inspect", actionId: "synthetic.read" }]) {
    assert.equal((await handleCatalogLine(runtime, JSON.stringify(request))).ok, true);
  }
  assert.deepEqual(calls.map(row => row.method), ["GET", "GET", "GET", "GET"]);
  assert.deepEqual(calls.map(row => row.url.pathname), ["/v1/providers", "/v1/actions", "/v1/actions/search", "/v1/actions/synthetic.read"]);
  assert.equal(calls.every(row => row.url.origin === "http://127.0.0.1:32999"), true);
  assert.equal(calls[2].url.searchParams.get("query"), "synthetic /mcp");
});

const listen = server => new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
const close = server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });

test("provider egress rejects reserved loopback before transport, independently of MCP redirects", async () => {
  let calls = 0;
  const guarded = createProviderFetch({ fetch: async () => { calls += 1; return new Response(null, { status: 204 }); }, skipDnsValidation: true });
  await assert.rejects(guarded("http://127.0.0.1:12345/mcp", { redirect: "manual" }), /private or reserved/u);
  assert.equal(calls, 0, "an SSRF refusal must not be mistaken for a successful client redirect test");
});

test("OpenConnector MCP HTTP transport cannot forward synthetic headers or RPC bodies across origins", { timeout: 10000 }, async () => {
  const destinationRequests = [];
  const redirectRequests = [];
  const destination = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) {
      body += chunk;
      if (Buffer.byteLength(body) > 8192) { response.writeHead(413); response.end(); return; }
    }
    destinationRequests.push({ method: request.method, hasSyntheticHeader: request.headers["x-synthetic-probe"] === "synthetic-only", body });
    if (request.method === "GET") { response.writeHead(405); response.end(); return; }
    const message = JSON.parse(body);
    if (message.id === undefined) { response.writeHead(202); response.end(); return; }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: message.method === "server/discover"
      ? { supportedVersions: ["2026-07-28"], capabilities: { tools: {} } }
      : { resultType: "complete", content: [{ type: "text", text: "synthetic result" }] } }));
  });
  let redirectStatus = 307;
  const redirector = http.createServer((request, response) => {
    redirectRequests.push(request.method);
    response.writeHead(redirectStatus, { location: "http://127.0.0.1:" + destination.address().port + "/mcp" });
    response.end();
  });
  try {
    await listen(destination);
    await listen(redirector);
    const directUrl = "http://127.0.0.1:" + destination.address().port + "/mcp";
    const redirectUrl = "http://127.0.0.1:" + redirector.address().port + "/mcp";
    assert.notEqual(new URL(directUrl).origin, new URL(redirectUrl).origin);
    // Use the real MCP helper with a native fetch transport. The production
    // provider guard intentionally refuses these loopback fixture addresses;
    // bypassing its SSRF policy would not test the actual production policy.
    const call = endpoint => withMcpClient({ endpoint, transport: "streamable_http", protocolVersion: "modern", fetcher: fetch,
      headers: { "X-Synthetic-Probe": "synthetic-only" }, signal: AbortSignal.timeout(3000) },
    client => client.callTool({ name: "synthetic_read", arguments: { syntheticValue: "synthetic-only" } }, { timeout: 2000 }));
    const positive = await call(directUrl);
    assert.equal(positive.content[0].text, "synthetic result");
    assert.ok(destinationRequests.some(row => row.hasSyntheticHeader && row.body.includes("tools/call")), "the same-origin positive must exercise the real client");
    destinationRequests.length = 0;
    for (const status of [307, 308]) {
      redirectStatus = status;
      await assert.rejects(call(redirectUrl));
      assert.deepEqual(destinationRequests, [], "the other origin must receive neither a header nor an RPC body");
    }
    assert.ok(redirectRequests.length >= 2, "both redirects must actually be encountered");
  } finally {
    await close(redirector);
    await close(destination);
  }
});
