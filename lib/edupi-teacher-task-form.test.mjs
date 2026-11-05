import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const form = await createJiti(import.meta.url).import("./edupi-teacher-task-form.ts");

test("validates timetable weekday and derives the automatic deadline", () => {
  const slot = { slot_id: "slot-1", day_of_week: 3 };
  assert.equal(form.timetableSlotId(slot), "slot-1");
  assert.equal(form.lessonDateMatchesSlot("2026-09-16", slot), true);
  assert.equal(form.lessonDateMatchesSlot("2026-09-17", slot), false);
  assert.equal(form.lessonDateMatchesSlot("2026-02-31", slot), false);
  assert.equal(form.dateBefore("2026-09-16"), "2026-09-15");
});

test("validates the complete Core deliverable boundary", () => {
  assert.deepEqual(form.preparationDeliverables("教案\n学案"), { items: ["教案", "学案"], error: null });
  assert.match(form.preparationDeliverables("教案\n教案").error, /不能重复/);
  assert.match(form.preparationDeliverables(Array.from({ length: 21 }, (_, index) => `产物${index}`).join("\n")).error, /最多 20 项/);
  assert.match(form.preparationDeliverables("x".repeat(241)).error, /最多 240 个字/);
});

test("recurring internal materials require a bounded first period and end date", () => {
  const weekly = { kind: "teacher_internal_materials", cadence: "weekly", untilDate: "2026-12-04", leadDays: 2, deliverables: ["内部议程", "材料清单"] };
  assert.deepEqual(form.parseTeacherRecurringMaterials(weekly, "2026-11-06", false), { value: weekly, error: null });
  assert.equal(form.parseTeacherRecurringMaterials({ ...weekly, cadence: "monthly", leadDays: 7 }, "2026-11-06", false).error, null);
  for (const [candidate, dueDate, preparation] of [
    [weekly, null, false], [weekly, "2026-11-06", true],
    [{ ...weekly, untilDate: "2026-11-05" }, "2026-11-06", false],
    [{ ...weekly, leadDays: 7 }, "2026-11-06", false],
    [{ ...weekly, untilDate: "2028-01-01" }, "2026-11-06", false],
    [{ ...weekly, cadence: "monthly" }, "2026-11-29", false],
    [{ ...weekly, deliverables: ["内部议程", "内部议程"] }, "2026-11-06", false],
    [{ ...weekly, external_send: true }, "2026-11-06", false],
  ]) assert.ok(form.parseTeacherRecurringMaterials(candidate, dueDate, preparation).error);
});
