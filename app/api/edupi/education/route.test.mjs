import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const { GET, POST } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./route.ts");
const coreRoot = process.env.EDUPI_CORE_ROOT;
const dataRoot = process.env.EDUPI_DATA_ROOT;

test("projects the real Core education workspace without Desktop task synthesis", { skip: !coreRoot || !dataRoot }, async () => {
  const response = await GET();
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.workspace, dataRoot);
  assert.equal(body.students.length, 5);
  assert.equal(body.calendar.length, 28);
  assert.equal(body.tasks.length, 30);
  assert.equal(body.tasks.some((task) => task.title.includes("教师内部") && task.sourceEventId === null), false);
  assert.equal(body.capabilities.taskReview.enabled, false);
  assert.equal(body.capabilities.taskReview.mode, "read_only");
  assert.equal(body.capabilities.calendar.enabled, false);
  assert.equal(body.capabilities.timetable.enabled, false);
  assert.equal(body.capabilities.materialIntake.enabled, false);
});

test("POST rejects empty and legacy education writes before Core", async () => {
  const response = await POST(new Request("http://localhost/api/edupi/education", { method: "POST", body: "{}" }));
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.code, "invalid_envelope");
  const legacy = await POST(new Request("http://localhost/api/edupi/education", { method: "POST", body: JSON.stringify({ taskId: "task", action: "accept" }) }));
  assert.equal(legacy.status, 400);
});

test("POST rejects unknown, source, credential, and invalid decision fields", async () => {
  const base = { commandType: "review_work_candidate", candidateId: "work", expectedSnapshotId: "snapshot", expectedRevision: 0, decision: "accept" };
  for (const value of [
    { ...base, unknown: true },
    { ...base, source: {} },
    { ...base, provider: "secret" },
    { ...base, token: "secret" },
    { ...base, externalSend: false },
    { ...base, decision: "approve" },
    { ...base, decision: "modify", patch: { provider: "secret" } },
    { ...base, decision: "snooze", patch: { snoozeUntil: "2026-09-01T09:00:00.000Z" } },
    { ...base, decision: "suppress", patch: { suppressionScope: "bad" }, note: "原因" },
  ]) {
    const response = await POST(new Request("http://localhost/api/edupi/education", { method: "POST", body: JSON.stringify(value) }));
    assert.equal(response.status, 400);
  }
  const malformed = await POST(new Request("http://localhost/api/edupi/education", { method: "POST", body: "not-json" }));
  assert.equal(malformed.status, 400);
});

test("valid-shaped work review reaches the server boundary and reports unavailable Core", async () => {
  const response = await POST(new Request("http://localhost/api/edupi/education", {
    method: "POST",
    body: JSON.stringify({ commandType: "review_work_candidate", candidateId: "work", expectedSnapshotId: "snapshot", expectedRevision: 0, decision: "accept" }),
  }));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, "unavailable");
});

test("fails closed when the snapshot cannot be read", async () => {
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

test("route source has no direct education writer or JSON fallback", () => {
  const source = fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /importCalendar|importTimetable|reviewEducationTask|teacher_task_review|readFile|loadJson|memoryDir|outputDir/);
  assert.match(source, /readEducationContract|reviewWorkCandidate/);
});
