import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("student profile update route is strict, bounded and Core-owned", async () => {
  const [route, server] = await Promise.all([
    read("./[name]/route.ts"),
    read("../../../../lib/edupi-student-roster-server.ts"),
  ]);
  assert.match(route, /export async function PUT/);
  assert.match(route, /isApiRequestAllowed/);
  assert.match(route, /hasJsonContentType/);
  assert.match(route, /parseJsonWithinLimit/);
  assert.match(route, /BODY_KEYS/);
  assert.match(route, /updateStudentProfile/);
  assert.match(route, /stale_student[\s\S]*409/);
  assert.doesNotMatch(route, /writeFile|safeSave|student_profiles\.json/);
  assert.match(server, /action: "update"/);
  assert.match(server, /expected_updated_at/);
  assert.match(server, /external_send !== false/);
});
