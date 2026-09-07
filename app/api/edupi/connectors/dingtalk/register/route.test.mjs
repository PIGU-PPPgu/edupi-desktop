import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("DingTalk one-click registration keeps credentials server-side and uses the official fixed flow", () => {
  for (const value of ["/app/registration/init", "/app/registration/begin", "/app/registration/poll", "DING_DWS_CLAW", "official_template", "credentials_verified"]) assert.match(source, new RegExp(value.replaceAll("/", "\\/")));
  assert.match(source, /host\.endsWith\("\.dingtalk\.com"\)/);
  assert.match(source, /connector-setup/);
  assert.doesNotMatch(source, /NextResponse\.json\(\{[^\n]*client_secret/);
  assert.doesNotMatch(source, /REGISTRATION_ORIGIN\s*=\s*process\.env/);
});
