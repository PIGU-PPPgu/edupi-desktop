import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-workflow-route-"));
process.env.PI_DESKTOP_STATE_DIR = stateDir;
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET } = await jiti.import("./route.ts");
const { makeDynamicWorkflowRun, writeDynamicWorkflowRun } = await jiti.import("../../../../lib/edupi-dynamic-workflow.ts");
test.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));

test("workflow route returns only the public graph and rejects cross-origin reads", async () => {
  const run = makeDynamicWorkflowRun("workflow-route-test", "source-entry", { title: "合成流程", phases: [
    { name: "查阅", agents: [{ name: "资料", task: "只读合成秘密资料", output: "draft" }] },
  ] });
  run.results[0][0] = { ok: true, summary: "私有模型结果" };
  run.lastSummary = "私有模型结果";
  writeDynamicWorkflowRun(run);
  const url = "http://localhost:30141/api/edupi/workflows?sessionId=workflow-route-test";
  const headers = { host: "localhost:30141", origin: "http://localhost:30141" };
  const response = await GET(new Request(url, { headers }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.run.title, "合成流程");
  assert.equal(body.run.phases[0].name, "查阅");
  assert.equal(JSON.stringify(body).includes("只读合成秘密资料"), false);
  assert.equal(JSON.stringify(body).includes('"output"'), false);
  assert.equal(JSON.stringify(body).includes("私有模型结果"), false);
  assert.equal((await GET(new Request(url, { headers: { ...headers, origin: "https://other.example" } }))).status, 403);
  assert.equal((await GET(new Request("http://localhost:30141/api/edupi/workflows?sessionId=../bad", { headers }))).status, 400);
});
