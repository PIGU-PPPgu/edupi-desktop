import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { buildStudentProfileUpdateRequest } = await jiti.import("./edupi-student-roster-server.ts");
const { parseStudentProfileList } = await jiti.import("./edupi-student-profile-edit.ts");

test("builds one bounded Core student-profile replacement request", () => {
  assert.deepEqual(buildStudentProfileUpdateRequest({
    name: "李四",
    traits: ["耐心", "主动提问"],
    parentNotes: [],
    expectedUpdatedAt: "2026-09-01T07:00:00.000Z",
  }, "student-update-1"), {
    protocol: "edupi-desktop-bridge",
    protocol_version: 1,
    producer: "edupi-desktop",
    operation: "students",
    request_id: "student-update-1",
    action: "update",
    expected_updated_at: "2026-09-01T07:00:00.000Z",
    student: { name: "李四", traits: ["耐心", "主动提问"], parent_notes: [] },
  });
});

test("parses editable profile lists with removal, deduplication and Chinese separators", () => {
  assert.deepEqual(parseStudentProfileList("耐心、主动提问\n耐心；愿意表达"), ["耐心", "主动提问", "愿意表达"]);
  assert.deepEqual(parseStudentProfileList(""), []);
});
