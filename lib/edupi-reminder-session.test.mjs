import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { bindReminderSession } = await createJiti(import.meta.url).import("./edupi-reminder-session.ts");
test("reminder continuation binds the real session to its task", async () => {
  let request;
  await bindReminderSession("task/a", "session-1", async (url, init) => { request = { url, init }; return { ok: true }; });
  assert.equal(request.url, "/api/edupi/tasks/task%2Fa/session");
  assert.equal(request.init.method, "PUT");
  assert.deepEqual(JSON.parse(request.init.body), { sessionId: "session-1" });
  await assert.rejects(bindReminderSession("task/a", "session-1", async () => ({ ok: false })), /任务关联失败/);
});
