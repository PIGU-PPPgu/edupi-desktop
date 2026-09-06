import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const eventSource = fs.readFileSync(new URL("./EduPiComputerUseStop.tsx", import.meta.url), "utf8");
const shellSource = fs.readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
test("desktop control consent does not leave a stop control over the workspace", () => {
  assert.match(eventSource, /announceComputerUseChanged/);
  assert.doesNotMatch(eventSource, /EduPiComputerUseStop\(/);
  assert.doesNotMatch(shellSource, /<EduPiComputerUseStop/);
});
