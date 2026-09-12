import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("student record writes and agent tool completion share one refresh event", async () => {
  const [events, studentEvents, observationRows, agentSession] = await Promise.all([
    read("../lib/edupi-ui-events.ts"),
    read("./EduPiStudentEvents.tsx"),
    read("../hooks/useStudentObservationRows.ts"),
    read("../hooks/useAgentSession.ts"),
  ]);
  assert.match(events, /EDUPI_STUDENT_RECORDS_UPDATED_EVENT\s*=\s*"edupi-student-records-updated"/);
  for (const source of [studentEvents, observationRows, agentSession]) assert.match(source, /EDUPI_STUDENT_RECORDS_UPDATED_EVENT/);
  assert.doesNotMatch(studentEvents, /edupi-student-records-changed/);
  assert.doesNotMatch(agentSession, /edupi-student-records-changed/);
});
