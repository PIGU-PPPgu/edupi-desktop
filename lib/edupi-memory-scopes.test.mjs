import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { scopedMemoryIds } = await jiti.import("./edupi-memory-scopes.ts");
const { memoryCategoryRoute, memorySemesterRoute, memoryObjectId } = await jiti.import("./edupi-domain-navigation.ts");

const projection = {
  projection_kind: "scoped_education_memory",
  projection_version: 1,
  active_semester_id: "semester-current",
  bindings: [
    { memory_id: "global", category: "preferences", scope_path: { semester_id: null } },
    { memory_id: "current", category: "class", scope_path: { semester_id: "semester-current" } },
    { memory_id: "previous", category: "class", scope_path: { semester_id: "semester-previous" } },
  ],
};

test("memory routes keep old category links and add semester/category links", () => {
  assert.equal(memoryCategoryRoute("memory:class"), "class");
  assert.equal(memorySemesterRoute("memory:class", "semester-current"), "semester-current");
  assert.equal(memoryCategoryRoute("memory:semester-previous:teaching"), "teaching");
  assert.equal(memorySemesterRoute("memory:semester-previous:teaching", "semester-current"), "semester-previous");
  assert.equal(memoryObjectId("semester-current", "preferences"), "memory:semester-current:preferences");
});

test("semester visibility inherits global memories without leaking other terms", () => {
  assert.deepEqual([...scopedMemoryIds(projection, "semester-current")], ["global", "current"]);
  assert.deepEqual([...scopedMemoryIds(projection, "semester-previous", "class")], ["previous"]);
});
