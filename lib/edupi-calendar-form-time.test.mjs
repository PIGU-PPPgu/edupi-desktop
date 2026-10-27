import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { CalendarFormTimeError, calendarFormTime, calendarTimeZoneOptions, createCalendarTimeDraft } = await jiti.import("./edupi-calendar-form-time.ts");
const input = (overrides = {}) => ({ date: "2026-10-27", endDate: null, allDay: false, startTime: "09:00", endTime: "10:00", timeZone: "Asia/Shanghai", ...overrides });
const saved = (overrides = {}) => ({ date: "2026-10-27", endDate: null, startsAt: "2026-10-27T09:00-04:00", endsAt: "2026-10-27T10:00-04:00", timeZone: "US/Eastern", ...overrides });

test("calendar time drafts initialize from the saved wall clock and zone rather than the machine zone", () => {
  assert.deepEqual(createCalendarTimeDraft(saved(), "Asia/Shanghai"), { allDay: false, startTime: "09:00", endTime: "10:00", timeZone: "US/Eastern" });
  assert.deepEqual(createCalendarTimeDraft(null, "Europe/London"), { allDay: true, startTime: "", endTime: "", timeZone: "Europe/London" });
  assert.equal(createCalendarTimeDraft(saved({ startsAt: null, endsAt: null, timeZone: null }), "UTC").allDay, true);
  assert.equal(createCalendarTimeDraft(saved({ endsAt: null })).allDay, false, "an incomplete existing interval must not silently become all-day");
});

test("the timezone picker retains a stored alias alongside UTC and supported zones", () => {
  const options = calendarTimeZoneOptions("US/Eastern");
  assert.equal(options[0], "US/Eastern");
  assert.ok(options.includes("UTC"));
  assert.ok(options.includes("Asia/Shanghai"));
  assert.equal(new Set(options).size, options.length);
});

test("all-day values omit the interval while preserving valid inclusive multi-day dates", () => {
  for (const endDate of [null, "2026-10-27", "2026-10-30"]) {
    assert.deepEqual(calendarFormTime(input({ allDay: true, endDate })), { startAt: null, endAt: null, timeZone: null });
  }
  assert.throws(() => calendarFormTime(input({ allDay: true }), saved()), /已有定时日程/);
});

test("time controls produce the current wire format with actual IANA offsets", () => {
  for (const [date, timeZone, offset] of [["2026-01-15", "America/New_York", "-05:00"], ["2026-07-15", "America/New_York", "-04:00"], ["2026-10-27", "Asia/Kathmandu", "+05:45"], ["2026-10-27", "UTC", "+00:00"]]) {
    const result = calendarFormTime(input({ date, timeZone }));
    assert.deepEqual(result, { startAt: `${date}T09:00${offset}`, endAt: `${date}T10:00${offset}`, timeZone });
    assert.equal(result.startAt.length, 22);
    assert.equal(result.endAt.length, 22);
  }
});

test("nonexistent and repeated DST times are rejected at either endpoint", () => {
  for (const overrides of [
    { date: "2026-03-08", startTime: "02:30", endTime: "03:30" },
    { date: "2026-03-08", startTime: "01:30", endTime: "02:30" },
    { date: "2026-11-01", startTime: "01:30", endTime: "02:30" },
    { date: "2026-11-01", startTime: "00:30", endTime: "01:30" },
  ]) assert.throws(() => calendarFormTime(input({ timeZone: "America/New_York", ...overrides })), error => error instanceof CalendarFormTimeError && /不存在或不唯一/.test(error.message));
  assert.deepEqual(calendarFormTime(input({ date: "2026-03-08", startTime: "01:30", endTime: "03:30", timeZone: "America/New_York" })), { startAt: "2026-03-08T01:30-05:00", endAt: "2026-03-08T03:30-04:00", timeZone: "America/New_York" });
});

test("metadata-only edits return the original strings and preserve null or explicit end dates", () => {
  for (const endDate of [null, "2026-10-27"]) {
    const original = saved({ endDate });
    assert.deepEqual(calendarFormTime(input({ ...createCalendarTimeDraft(original), endDate }), original), { startAt: original.startsAt, endAt: original.endsAt, timeZone: original.timeZone });
  }
  const original = saved();
  const changed = calendarFormTime(input({ ...createCalendarTimeDraft(original), startTime: "09:15" }), original);
  assert.equal(changed.startAt, "2026-10-27T09:15-04:00");
  assert.equal(changed.endAt, original.endsAt);
  const zoneChange = calendarFormTime(input({ ...createCalendarTimeDraft(original), timeZone: "Europe/London" }), original);
  assert.equal(zoneChange.startAt, "2026-10-27T09:00+00:00", "zone changes retain the chosen local clock, not the old instant");
});

test("timed intervals cannot cross days or infer a next day from reversed clocks", () => {
  for (const overrides of [{ endDate: "2026-10-28" }, { startTime: "23:00", endTime: "01:00" }, { startTime: "10:00", endTime: "10:00" }]) {
    assert.throws(() => calendarFormTime(input(overrides)), CalendarFormTimeError);
  }
  assert.equal(calendarFormTime(input({ endDate: "2026-10-27" })).endAt, "2026-10-27T10:00+08:00");
});

test("date, clock and timezone validation is explicit and never silently normalizes invalid input", () => {
  for (const overrides of [
    { date: "2026-02-29" }, { date: "2026-13-01" }, { date: "2026-2-01" }, { endDate: "2026-02-30" }, { endDate: "2026-10-26" },
    { startTime: "" }, { endTime: "24:00" }, { startTime: "09:00:30" }, { endTime: "9:30" }, { timeZone: "Invalid/Zone" }, { timeZone: "" }, { timeZone: "+08:00" },
  ]) assert.throws(() => calendarFormTime(input(overrides)), CalendarFormTimeError);
  assert.equal(calendarFormTime(input({ date: "2028-02-29" })).startAt, "2028-02-29T09:00+08:00");
});
