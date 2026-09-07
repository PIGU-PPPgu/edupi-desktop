import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { reminderEvents } = await createJiti(import.meta.url).import("./edupi-reminder-events.ts");
test("due reminders use Shanghai dates and exclude handled or held tasks", () => {
  const base = { id: "a", title: "课前准备", status: "planned", contentStatus: null, dueDate: "2026-09-07" };
  const tasks = [base, { ...base, id: "b", status: "rejected" }, { ...base, id: "c", status: "hold" }, { ...base, id: "d", dueDate: "2026-09-08" }];
  const events = reminderEvents(tasks, "/tmp/test", new Date("2026-09-06T16:01:00Z"));
  assert.equal(events["due:a"].completion, "due");
  assert.equal(events["due:b"], undefined);
  assert.equal(events["due:c"], undefined);
  assert.equal(events["due:d"], undefined);
  assert.equal(reminderEvents(tasks, "/tmp/test", new Date("2026-09-06T15:59:00Z"))["due:a"], undefined);
});
