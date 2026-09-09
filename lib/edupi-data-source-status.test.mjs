import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { buildEducationContractFromWorkspace } = await createJiti(import.meta.url).import("./edupi-education-contract.ts");

test("distinguishes connected data, connected empty sources, and unavailable sources", () => {
  const source = (source_id, present, item_count, observed_at = null) => ({ source_id, present, item_count, observed_at });
  const data = buildEducationContractFromWorkspace({
    source_summaries: [
      source("student_profiles", true, 1, "2026-09-06T08:00:00.000Z"),
      source("timetable", false, 0),
      source("calendar", true, 0, "2026-09-06T08:00:00.000Z"),
      source("rhythm_plan", true, 0, "2026-09-06T08:00:00.000Z"),
      source("class_memory", false, 0), source("teaching_memory", false, 0), source("semester_memory", true, 0), source("preferences_memory", false, 0), source("school_memory", false, 0),
      source("subconscious", true, 0, "2026-09-06T09:00:00.000Z"),
      source("material_candidates", false, 0),
      source("documents", true, 1, "2026-09-06T10:00:00.000Z"),
    ],
    students: [{ student_id: "student-1", name: "学生甲" }],
    timetable: [], calendar: [], tasks: [],
    continuity: { memories: [], signals: [], insights: [], themes: [], documents: [{ document_id: "daily-1", kind: "daily", title: "早安简报", path: ".edupi/output/daily/2026-09-06.md", excerpt: "今日安排" }] },
  }, { workspacePath: "/tmp/edupi", supportedCommands: [] });

  assert.deepEqual(data.dataSources.students, { path: ".edupi/memory/student_profiles.json", present: true, count: 1, observedAt: "2026-09-06T08:00:00.000Z", status: "ready" });
  assert.equal(data.dataSources.calendar.status, "empty");
  assert.equal(data.dataSources.insights.status, "empty");
  assert.equal(data.dataSources.timetable.status, "unavailable");
  assert.equal(data.dataSources.materials.status, "ready");
  assert.equal(data.dataSources.growth.status, "ready");
  assert.equal(data.dataSources.growth.observedAt, "2026-09-06T10:00:00.000Z");
  assert.equal(data.continuity.documents[0].id, "daily:2026-09-06");
  assert.equal(data.continuity.documents[0].date, "2026-09-06");
});
