import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const quick = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-quick-entry.ts");

function data() {
  return {
    tasks: [
      { id: "ready", title: "期中复习清单", dueDate: "2026-11-02", contentStatus: "draft_ready", deliverables: ["复习重点"], status: "planned", evidence: { file_path: "/private/ready.md", file_sha256: `sha256:${"a".repeat(64)}` } },
      { id: "planned", title: "家长会准备", dueDate: "2026-10-12", contentStatus: "not_generated", deliverables: ["会议提纲"], status: "planned", evidence: {} },
    ],
    calendar: [
      { id: "calendar-one", date: "2026-09-25", name: "中秋", type: "festival" },
      { id: null, date: null, name: "日期待定活动", type: "activity" },
    ],
  };
}

test("quick entry projects Chat, tasks, ready artifacts, and calendar without internals", () => {
  const items = quick.buildEduPiQuickEntryItems(data(), "", 20);
  assert.equal(items[0].kind, "chat");
  assert.equal(items.some((item) => item.kind === "task" && item.targetKey === "ready"), true);
  assert.equal(items.some((item) => item.kind === "artifact" && item.targetKey === "ready"), true);
  assert.equal(items.some((item) => item.kind === "artifact" && item.targetKey === "planned"), false);
  assert.equal(items.some((item) => item.kind === "calendar" && item.targetKey === "calendar-one"), true);
  assert.equal(JSON.stringify(items).includes("/private/ready.md"), false);
  assert.equal(JSON.stringify(items).includes("sha256:"), false);
});

test("quick entry search is normalized, ranked, stable, and bounded", () => {
  assert.deepEqual(quick.buildEduPiQuickEntryItems(data(), "  期中  ").map((item) => item.kind), ["task", "artifact"]);
  assert.deepEqual(quick.buildEduPiQuickEntryItems(data(), "复习重点").map((item) => item.kind), ["artifact"]);
  assert.equal(quick.buildEduPiQuickEntryItems(data(), "", 2).length, 2);
  assert.deepEqual(quick.buildEduPiQuickEntryItems(data(), "中秋"), quick.buildEduPiQuickEntryItems(data(), "中秋"));
});

test("calendar fallback keys remain stable within one projection", () => {
  const event = { id: null, date: null, name: "日期待定活动" };
  assert.equal(quick.calendarQuickEntryKey(event, 3), "undated:日期待定活动:3");
});

test("quick-entry calendar status matches the existing calendar contract", () => {
  assert.equal(quick.calendarQuickEntryStatusLabel({ confidence: "unknown", preparationStatus: "read_only" }), "已确认");
  assert.equal(quick.calendarQuickEntryStatusLabel({ confidence: "unknown", preparationStatus: "hold" }), "待确认");
  assert.equal(quick.calendarQuickEntryStatusLabel({ confidence: "inferred", preparationStatus: "read_only" }), "待确认");
});
