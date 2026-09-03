import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
test("the desktop cold start ensures the DingTalk Stream runtime without blocking web mode", () => {
  assert.match(source, /if \(!desktopMode\) return/);
  assert.match(source, /\/api\/edupi\/connectors\/dingtalk\/runtime/);
  assert.match(source, /JSON\.stringify\(\{ action: "ensure" \}\)/);
});
