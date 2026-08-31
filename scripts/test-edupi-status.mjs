import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = await mkdtemp(join(tmpdir(), "edupi-desktop-status-"));
const memory = join(root, ".edupi", "memory");
const output = join(root, ".edupi", "output");
await mkdir(memory, { recursive: true });
await mkdir(output, { recursive: true });
await writeFile(join(memory, "preferences.json"), JSON.stringify({ config_done: true, entries: [{ content: "teacher_internal" }] }));
await writeFile(join(memory, "student_profiles.json"), JSON.stringify({ students: { "学生甲": {}, "学生乙": {} } }));
await writeFile(join(memory, "timetable.json"), JSON.stringify({ slots: [{ subject: "数学" }, { subject: "班会" }, { subject: "备课" }] }));
await writeFile(join(memory, "calendar.json"), JSON.stringify({ events: [{ name: "开学" }, { name: "校历节点" }, { name: "补课" }, { name: "寒假" }] }));
await writeFile(join(output, "rhythm_plan.json"), JSON.stringify({ tasks: [{ id: "t1" }, { id: "t2" }] }));

const previous = process.env.EDUPI_PROJECT_ROOT;
process.env.EDUPI_PROJECT_ROOT = root;
try {
  const routeSource = await import("node:fs/promises").then(({ readFile: read }) => read(new URL("../app/api/edupi/status/route.ts", import.meta.url), "utf8"));
  assert.match(routeSource, /student_profiles\.json/);
  assert.match(routeSource, /timetable\.json/);
  assert.match(routeSource, /calendar\.json/);
  assert.match(routeSource, /rhythm_plan\.json/);

  const files = {
    students: JSON.parse(await (await import("node:fs/promises")).readFile(join(memory, "student_profiles.json"), "utf8")),
    timetable: JSON.parse(await (await import("node:fs/promises")).readFile(join(memory, "timetable.json"), "utf8")),
    calendar: JSON.parse(await (await import("node:fs/promises")).readFile(join(memory, "calendar.json"), "utf8")),
    rhythmPlan: JSON.parse(await (await import("node:fs/promises")).readFile(join(output, "rhythm_plan.json"), "utf8")),
  };
  assert.equal(Object.keys(files.students.students).length, 2);
  assert.equal(files.timetable.slots.length, 3);
  assert.equal(files.calendar.events.length, 4);
  assert.equal(files.rhythmPlan.tasks.length, 2);
  console.log(JSON.stringify({ status: "passed", workspace: root, counts: { students: 2, timetable: 3, calendar: 4, rhythmPlan: 2 }, externalSend: false, requiresTeacherReview: true }, null, 2));
} finally {
  if (previous === undefined) delete process.env.EDUPI_PROJECT_ROOT;
  else process.env.EDUPI_PROJECT_ROOT = previous;
}
