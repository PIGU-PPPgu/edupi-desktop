import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

test("RPC sessions can use a configured loopback model without an API key", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-rpc-loopback-"));
  const agentDir = path.join(root, "agent");
  fs.mkdirSync(agentDir, { recursive: true });
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousOffline = process.env.PI_OFFLINE;
  let calls = 0;
  const server = http.createServer(async (_request, response) => {
    calls += 1;
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end([
      `data: ${JSON.stringify({ id: "local", object: "chat.completion.chunk", created: 1, model: "local", choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: null }] })}`,
      "",
      `data: ${JSON.stringify({ id: "local", object: "chat.completion.chunk", created: 1, model: "local", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`,
      "",
      "data: [DONE]",
      "",
    ].join("\n"));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_OFFLINE = "1";
  fs.writeFileSync(path.join(agentDir, "models.json"), JSON.stringify({ providers: {
    local: {
      api: "openai-completions",
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      models: [{ id: "local", name: "local", input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000, maxTokens: 16 }],
    },
  } }));

  let session;
  try {
    const { startRpcSession } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./rpc-manager.ts");
    ({ session } = await startRpcSession("__loopback_e2__", "", root, { toolNames: [], initialModel: { provider: "local", modelId: "local" } }));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("loopback RPC prompt timed out")), 20_000);
      const unsubscribe = session.onEvent((event) => {
        if (event.type === "prompt_done") { clearTimeout(timer); unsubscribe(); resolve(); }
        if (event.type === "prompt_error") { clearTimeout(timer); unsubscribe(); reject(new Error(String(event.errorMessage))); }
      });
      void session.send({ type: "prompt", message: "回复 OK" }).catch((error) => { clearTimeout(timer); unsubscribe(); reject(error); });
    });
    assert.equal(calls, 1);
  } finally {
    session?.destroy();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousOffline === undefined) delete process.env.PI_OFFLINE;
    else process.env.PI_OFFLINE = previousOffline;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
