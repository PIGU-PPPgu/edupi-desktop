import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { reminderEvents } = await createJiti(import.meta.url).import("./edupi-reminder-events.ts");
test("today's brief becomes one stable reminder, older reports do not", () => {
  const doc = {id:"daily-1",kind:"daily",date:"2026-09-08",title:"早安简报",path:".edupi/output/daily/a.md",excerpt:"今天的安排"};
  const now = new Date("2026-09-07T16:01:00Z");
  const events = reminderEvents([],"/tmp/test",now,[doc,{...doc,id:"old",date:"2026-09-07"}]);
  assert.equal(Object.keys(events).length,1);
  assert.equal(events["document:daily-1"].completion,"brief");
  assert.equal(reminderEvents([],"/tmp/test",now,[{...doc,excerpt:"补充内容"}])["document:daily-1"].identity,events["document:daily-1"].identity);
});
test("due reminders use Shanghai dates and exclude handled or held tasks", () => {
  const base = { id: "a", title: "课前准备", status: "planned", contentStatus: null, dueDate: "2026-09-07" };
  const tasks = [base, { ...base, id: "b", status: "rejected" }, { ...base, id: "c", status: "hold" }, { ...base, id: "d", dueDate: "2026-09-08" }];
  const events = reminderEvents(tasks, "/tmp/test", new Date("2026-09-06T16:01:00Z"));
  assert.equal(events["due:a"].completion, "due");
  assert.equal(events["due:b"], undefined);
  assert.equal(events["due:c"], undefined);
  assert.equal(events["due:d"], undefined);
  const completed = reminderEvents([{ ...base, contentStatus: "draft_ready", boardStage: "done" }, { ...base, id: "accepted", contentStatus: "draft_ready", status: "accepted" }], "/tmp/test");
  assert.deepEqual(completed, {});
  assert.equal(reminderEvents(tasks, "/tmp/test", new Date("2026-09-06T15:59:00Z"))["due:a"], undefined);
  const nextDay = reminderEvents(tasks, "/tmp/test", new Date("2026-09-07T16:01:00Z"));
  assert.equal(nextDay["due:a"].identity, events["due:a"].identity);
  assert.equal(nextDay["due:a"].completion, "due");
});
