import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";
import ts from "typescript";
import { createJiti } from "jiti";

const require = createRequire(import.meta.url);
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const security = await jiti.import("../../../../lib/request-security.ts");
const bounded = await jiti.import("../../../../lib/bounded-form-data.ts");
const compiled = ts.transpileModule(fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
function fixture() {
  let excerpt = null;
  const calls = [];
  const material = { material_id: "material", subject: "数学", class_id: "703", available: true };
  const dependencies = {
    "@/lib/edupi-education-server": { readEducationContract: async () => ({ teacherMaterials: [material] }) },
    "@/lib/edupi-core-snapshot": { resolveEduPiBridgeRoots: () => ({}) },
    "@/lib/request-security": security,
    "@/lib/bounded-form-data": bounded,
    "@/lib/edupi-core-process-client": { runCoreProcess: async ({ request }) => {
      calls.push(request);
      assert.equal(request.input.subject, "数学"); assert.equal(request.input.classId, "703");
      if (request.action === "review") {
        assert.equal(request.input.reviewer, "teacher");
        excerpt = { material_id: "material", revision: request.input.expectedRevision + 1, status: request.input.decision === "confirm" ? "confirmed" : "withdrawn", content: request.input.content };
      }
      return { ok: true, excerpt };
    } },
  };
  const route = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => dependencies[name] || require(name), route, route.exports);
  const post = body => route.exports.POST(new Request("http://localhost/api/edupi/material-excerpt", { method: "POST", headers: { "Content-Type": "application/json", host: "localhost" }, body: JSON.stringify(body) }));
  return { ...route.exports, post, calls, material };
}
test("confirmation and withdrawal bind authoritative scope and reread the resulting revision", async () => {
  const { post, calls } = fixture();
  const first = await post({ materialId: "material", expectedRevision: 0, content: "经教师核对的正文", decision: "confirm" });
  assert.equal(first.status, 200); assert.equal((await first.json()).excerpt.revision, 1);
  assert.deepEqual(calls.map(item => item.action), ["read", "review", "read"]);
  const conflict = await post({ materialId: "material", expectedRevision: 0, content: "保留草稿", decision: "confirm" });
  assert.equal(conflict.status, 409); assert.equal((await conflict.json()).conflict, true);
  assert.equal(calls.filter(item => item.action === "review").length, 1);
  const withdrawal = await post({ materialId: "material", expectedRevision: 1, content: "经教师核对的正文", decision: "withdraw" });
  assert.equal(withdrawal.status, 200); assert.equal((await withdrawal.json()).excerpt.status, "withdrawn");
});
test("rejects untrusted scope, oversized UTF8 content, missing material scope and foreign origins", async () => {
  const { post, material, calls, GET } = fixture();
  for (const extra of [{ subject: "语文" }, { classId: "704" }, { reviewer: "other" }, { path: "/tmp/file" }, { content: "字".repeat(6000) }]) assert.equal((await post({ materialId: "material", expectedRevision: 0, content: "正文", decision: "confirm", ...extra })).status, 400);
  assert.equal(calls.length, 0);
  material.subject = null;
  assert.equal((await post({ materialId: "material", expectedRevision: 0, content: "正文", decision: "confirm" })).status, 409);
  assert.equal((await GET(new Request("http://localhost/api/edupi/material-excerpt?materialId=material", { headers: { origin: "https://foreign.example" } }))).status, 403);
});
