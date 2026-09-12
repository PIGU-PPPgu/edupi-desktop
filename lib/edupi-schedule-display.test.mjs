import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const schedule = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-schedule-display.ts");

test("next schedule follows the Core morning brief and hourly windows", () => {
  const morning = schedule.nextScheduledRun(new Date("2026-09-12T07:29:30+08:00"));
  assert.equal(morning.schedule.id, "morning_brief");
  const afterBrief = schedule.nextScheduledRun(new Date("2026-09-12T07:31:00+08:00"));
  assert.equal(afterBrief.schedule.id, "rhythm");
  const hourly = schedule.nextScheduledRun(new Date("2026-09-12T08:06:00+08:00"));
  assert.equal(hourly.schedule.id, "proactive_engine");
  assert.match(schedule.formatNextScheduledRun(new Date("2026-09-12T07:29:30+08:00")), /下次早安简报/);
});
