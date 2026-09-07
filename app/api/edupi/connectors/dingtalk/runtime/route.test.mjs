import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8");
test("DingTalk runtime start is same-origin, bounded, and Core-owned", () => {
  assert.match(source, /isApiRequestAllowed/);
  assert.match(source, /hasJsonContentType/);
  assert.match(source, /start_runtime/);
  assert.match(source, /runCoreProcess/);
  assert.doesNotMatch(source, /child_process|spawn\(|exec\(/);
});
