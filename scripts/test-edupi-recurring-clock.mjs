import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const NativeDate = globalThis.Date;
let offset = 0;

export function setRecurringTestClockOffset(value) {
  assert.ok(Number.isSafeInteger(value) && value >= 0 && value <= 31 * 86_400_000);
  offset = value;
  globalThis.Date = class extends NativeDate {
    constructor(...args) {
      if (args.length) super(...args);
      else super(NativeDate.now() + offset);
    }
    static now() { return NativeDate.now() + offset; }
  };
}

export function restoreRecurringTestClock() {
  globalThis.Date = NativeDate;
}

if (process.env.EDUPI_RECURRING_TEST_CLOCK_OFFSET !== undefined) {
  const root = fs.realpathSync(process.env.EDUPI_PROJECT_ROOT);
  const temporary = fs.realpathSync(os.tmpdir());
  assert.equal(path.dirname(path.dirname(root)), temporary);
  assert.ok(path.basename(path.dirname(root)).startsWith("edupi-recurring-desktop-e2-"));
  assert.equal(path.basename(root), "data");
  setRecurringTestClockOffset(Number(process.env.EDUPI_RECURRING_TEST_CLOCK_OFFSET));
}
