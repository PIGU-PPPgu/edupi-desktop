import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8");
test("Feishu connector setup is same-origin, bounded and Core-owned", () => {
  assert.match(source, /isApiRequestAllowed/);
  assert.match(source, /hasJsonContentType/);
  assert.match(source, /length > 4096/);
  assert.match(source, /operation: "connector-setup"/);
  assert.match(source, /timeoutMs: 10_000/);
  assert.doesNotMatch(source, /writeFile|FEISHU_APP_SECRET=/);
  assert.match(source, /connectorId: "feishu", status: "configured"/);
});
