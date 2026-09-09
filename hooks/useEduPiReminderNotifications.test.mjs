import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { reminderNotificationAction } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./useEduPiReminderNotifications.ts");
test("notification activation routes each reminder to its actual object", () => {
  assert.equal(reminderNotificationAction(null), null);
  assert.deepEqual(reminderNotificationAction({ taskId: "task-1", kind: "ready" }), { action: "open_task", taskId: "task-1", stage: "artifact" });
  assert.deepEqual(reminderNotificationAction({ taskId: "task-1", kind: "failed" }), { action: "open_task", taskId: "task-1", stage: "run" });
  assert.deepEqual(reminderNotificationAction({ taskId: "task-1", kind: "due" }), { action: "open_task", taskId: "task-1", stage: "brief" });
  assert.deepEqual(reminderNotificationAction({ taskId: "document:daily-1", kind: "brief" }), { action: "open_document", documentId: "daily-1" });
  assert.equal(reminderNotificationAction({ taskId: "invalid", kind: "brief" }), null);
});
