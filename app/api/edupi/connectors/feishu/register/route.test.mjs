import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
const source = fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8");
test("one-click Feishu registration uses the full PersonalAgent template without exposing credentials", () => {
  assert.match(source, /archetype: "PersonalAgent"/);
  assert.match(source, /preset: true/);
  assert.match(source, /createOnly/);
  assert.match(source, /authorization_required/);
  assert.match(source, /connector-setup/);
  assert.doesNotMatch(source, /client_secret:\s*polled\.client_secret.*NextResponse/s);
});
