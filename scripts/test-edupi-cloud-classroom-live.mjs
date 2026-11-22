import assert from "node:assert/strict";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { createEduPiCloudClient } = await jiti.import("../lib/edupi-cloud-client.ts");
const { cloudClassroomService } = await jiti.import("../lib/edupi-cloud-classroom.ts");
if (process.env.EDUPI_CLOUD_ISOLATED_TEST !== "1") throw new Error("An isolated test workspace is required");
const client = createEduPiCloudClient();
const state = await client.state();
assert.match(state.session?.user.email || "", /@example\.invalid$/u);
const scope = await client.captureScope();
const suffix = process.env.EDUPI_CLASSROOM_LIVE_SUFFIX || "20261123";
const className = `合成云班-${suffix.slice(0, 8)}`;
const rosterRequest = {
  action: "import", request_id: `class-roster-${suffix}`, source_name: "live-synthetic.csv",
  students: Array.from({ length: 6 }, (_, index) => ({
    name: `合成学生${index + 1}`, class_name: className, traits: [], parent_notes: [],
  })),
};
let imported = await client.operationWithOutbox("students", rosterRequest, scope);
for (let attempt = 0; imported.queued && attempt < 3; attempt++) {
  await client.flushOutbox();
  imported = await client.operationWithOutbox("students", rosterRequest, scope);
}
assert.equal(imported.queued, false);
const roster = imported.result.students;
const grade = {
  title: "合成云端成绩", class_name: className, date: "2026-11-23",
  subjects: [{ name: "数学", max_score: 100 }],
  rows: roster.map((s, index) => ({
    row_id: `row-${index}`, student_id: s.student_id, name: s.name, scores: { 数学: 40 + index * 10 },
  })),
};
const seating = {
  title: "合成云端排座", class_name: className, mode: "seating", rows: 2, columns: 3, group_size: 3,
  student_ids: roster.map(s => s.student_id), features: {},
  constraints: { gender_strategy: "ignore", avoid_pairs: [], fixed_seats: [] },
};
const duty = {
  title: "合成云端值日", class_name: className, start_date: "2026-11-23", days: 5,
  weekdays: [1, 2, 3, 4, 5], student_ids: roster.map(s => s.student_id), exempt_ids: [],
  posts: [{ id: "floor", name: "扫地", count: 1, weight: 1, gender: "any" }],
  max_per_day: 1, max_days_per_week: 5,
};
for (const [domain, input] of [["grades", grade], ["seating", seating], ["duty", duty]]) {
  const id = `live-${domain}-${suffix}`;
  const preview = await cloudClassroomService({ domain, action: "preview", id, input }, client, scope);
  assert.ok(preview.result);
  assert.equal(preview.issues.some(item => item.severity === "error"), false);
  const source = { domain, action: "save", id, input, expected_revision: 0, request_id: `save-${domain}-${suffix}` };
  const saved = await cloudClassroomService(source, client, scope);
  assert.equal(saved.queued, undefined);
  assert.equal(saved.record.revision, 1);
  assert.equal((await client.outbox()).length, 0);
  const restarted = createEduPiCloudClient();
  const replay = await cloudClassroomService(source, restarted, scope);
  assert.equal(replay.record.revision, 1);
  if (domain === "duty") {
    const published = await cloudClassroomService({
      domain, action: "publish", id, expected_revision: 1, request_id: `publish-${suffix}`,
    }, client, scope);
    assert.equal(published.record.publication.state, "linked");
    const task = (await client.dashboard(scope)).payload.tasks.find(row => row.task_id === published.record.task_id);
    assert.ok(task);
    assert.equal(task.title, `${className} ${duty.title}`);
  }
  console.log(`PASS actual HTTPS ${domain} Core preview -> save -> restart replay -> readback${domain === "duty" ? " -> linked task" : ""}`);
}
assert.equal((await client.outbox()).length, 0);
console.log("PASS all classroom writes settled their durable outbox");
