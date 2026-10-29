import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";

const coreRoot = fs.realpathSync(process.env.EDUPI_CORE_ROOT);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-onboarding-roster-e2-"));
for (const name of ["memory", "output", "locks"]) fs.mkdirSync(path.join(root, ".edupi", name), { recursive: true });
Object.assign(process.env, {
  EDUPI_CORE_ROOT: coreRoot,
  EDUPI_CORE_ALLOWED_ROOT: path.dirname(coreRoot),
  EDUPI_DATA_ROOT: root,
  EDUPI_DATA_ALLOWED_ROOT: path.dirname(root),
  EDUPI_PROJECT_ROOT: root,
  EDUPI_MEMORY_DIR: path.join(root, ".edupi", "memory"),
  EDUPI_OUTPUT_DIR: path.join(root, ".edupi", "output"),
  EDUPI_LOCK_DIR: path.join(root, ".edupi", "locks"),
  PI_CODING_AGENT_DIR: path.join(root, "agent"),
});

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { POST } = await jiti.import(path.join(process.cwd(), "app/api/edupi/students/import/route.ts"));
const { GET } = await jiti.import(path.join(process.cwd(), "app/api/edupi/education/route.ts"));

function request(name, csv) {
  const form = new FormData();
  form.set("file", new File([csv], name, { type: "text/csv" }));
  return new Request("http://localhost/api/edupi/students/import?auto=1", {
    method: "POST", headers: { host: "localhost", origin: "http://localhost", "sec-fetch-site": "same-origin" }, body: form,
  });
}

try {
  const before = await GET();
  assert.equal(before.status, 200, JSON.stringify(await before.json()));
  const importedResponse = await POST(request("synthetic-roster.csv", "姓名,班级,特征,家校备注\n合成学生甲,测试班,专注、主动,家长希望每周沟通\n合成学生乙,测试班,,\n"));
  const imported = await importedResponse.json();
  assert.equal(importedResponse.status, 200, JSON.stringify(imported));
  assert.equal(imported.status, "imported");
  assert.equal(imported.verified, true);
  assert.equal(imported.result.imported, 2);
  const read = await GET();
  assert.equal(read.status, 200);
  const saved = await read.json();
  const names = saved.students.map((student) => student.name).sort();
  assert.deepEqual(names, ["合成学生甲", "合成学生乙"].sort());
  const first = saved.students.find((student) => student.name === "合成学生甲");
  assert.deepEqual(first.traits, ["专注", "主动"]);
  assert.deepEqual(first.parent_notes, ["家长希望每周沟通"]);
  const heldResponse = await POST(request("footer-roster.csv", "姓名,班级\n合成学生丙,测试班\n合计（1人）,测试班\n"));
  const held = await heldResponse.json();
  assert.equal(heldResponse.status, 200, JSON.stringify(held));
  assert.equal(held.status, "needs_review");
  const after = await GET();
  assert.equal(after.status, 200);
  const afterNames = (await after.json()).students.map((student) => student.name).sort();
  assert.deepEqual(afterNames, names);
  const manualResponse = await POST(new Request("http://localhost/api/edupi/students/import", {
    method: "POST", headers: { host: "localhost", origin: "http://localhost", "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: JSON.stringify({ sourceName: "footer-roster.csv", csv: "姓名,班级\n合成学生丙,测试班\n" }),
  }));
  const manual = await manualResponse.json();
  assert.equal(manualResponse.status, 200, JSON.stringify(manual));
  assert.equal(manual.verified, true);
  assert.equal(manual.result.imported, 1);
  const finalRead = await GET();
  assert.equal(finalRead.status, 200);
  const finalNames = (await finalRead.json()).students.map((student) => student.name).sort();
  assert.deepEqual(finalNames, ["合成学生甲", "合成学生乙", "合成学生丙"].sort());
  process.stdout.write(JSON.stringify({ status: "passed", core: coreRoot, automaticImported: 2, manualImported: 1, reread: finalNames.length, heldWithoutWrite: true, externalSend: false }) + "\n");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
