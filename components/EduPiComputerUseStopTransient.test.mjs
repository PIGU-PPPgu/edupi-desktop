import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./EduPiComputerUseStop.tsx", import.meta.url), "utf8");
test("desktop control stop notice auto-collapses instead of permanently covering the workspace", () => {
  assert.match(source, /COMPUTER_USE_STOP_NOTICE_MS = 4_000/);
  assert.match(source, /setTimeout\(\(\) => setVisible\(false\)/);
  assert.match(source, /if \(!enabled \|\| !visible\) return null/);
  assert.match(source, /announceComputerUseChanged\(false\)/);
});
