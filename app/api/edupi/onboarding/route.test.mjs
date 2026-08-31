import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const { GET, PUT } = await createJiti(import.meta.url, { tsconfigPaths: true })
  .import("./route.ts");
const coreRoot = process.env.EDUPI_CORE_ROOT;
const dataRoot = process.env.EDUPI_DATA_ROOT;

test("returns the read-only teacher context from Core", { skip: !coreRoot || !dataRoot }, async () => {
  const response = await GET();
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.name, "吴老师");
  assert.equal(body.subject, "数学");
  assert.equal(body.grade, "七年级");
  assert.equal(body.editable, false);
  assert.equal(body.memoryDirectory, ".edupi/memory");
});

test("fails closed when the Core snapshot is missing", async () => {
  const previous = process.env.EDUPI_DATA_ROOT;
  process.env.EDUPI_DATA_ROOT = "/definitely/missing/edupi-data";
  try {
    const response = await GET();
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.match(body.error, /不可用/);
  } finally {
    if (previous === undefined) delete process.env.EDUPI_DATA_ROOT;
    else process.env.EDUPI_DATA_ROOT = previous;
  }
});

test("PUT rejects unknown fields before reaching Core", async () => {
  const response = await PUT(new Request("http://localhost/api/edupi/onboarding", { method: "PUT", body: JSON.stringify({ name: "不应写入", provider: "secret" }) }));
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.code, "invalid_envelope");
});

test("PUT rejects credential and malformed patch fields", async () => {
  for (const value of [
    { targetId: "context-1", expectedSnapshotId: "snapshot-1", expectedRevision: 0, decision: "modify", patch: { api_key: "secret" }, reviewerId: "teacher" },
    { targetId: "context-1", expectedSnapshotId: "snapshot-1", expectedRevision: 0, decision: "modify", patch: { name: "x".repeat(121) }, reviewerId: "teacher" },
    { targetId: "context-1", expectedSnapshotId: "snapshot-1", expectedRevision: 0, decision: "hold", patch: null, reviewerId: "teacher", external_send: false },
  ]) {
    const response = await PUT(new Request("http://localhost/api/edupi/onboarding", { method: "PUT", body: JSON.stringify(value) }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "invalid_envelope");
  }
});

test("PUT maps a valid review request to Core availability", async () => {
  const response = await PUT(new Request("http://localhost/api/edupi/onboarding", {
    method: "PUT",
    body: JSON.stringify({ targetId: "context-1", expectedSnapshotId: "snapshot-1", expectedRevision: 0, decision: "hold", patch: null, reviewerId: "teacher" }),
  }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "unavailable");
});

test("onboarding route has no parser, direct file access, or save import", async () => {
  const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(source, /readTeacherContext/);
  assert.match(source, /reviewTeacherContextCandidate/);
  assert.doesNotMatch(source, /saveTeacherContext|readFile|writeFile|copyFile|rename|mkdir|preferences\.json|calendar\.json|timetable\.json|student_profiles\.json|teaching\.json/);
  assert.match(source, /invalid_teacher_context_review/);
});
