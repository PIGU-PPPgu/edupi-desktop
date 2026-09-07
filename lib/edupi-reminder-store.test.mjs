import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
const { updateReminderStore } = await createJiti(import.meta.url).import("./edupi-reminder-store.ts");
test("reminders persist, deduplicate and separate snooze from handling", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "edupi-reminders-"));
  const file = path.join(root, "reminders.json");
  const snapshot = { a: { taskId: "a", title: "教案", completion: "ready", identity: "v1" } };
  try {
    const first = await updateReminderStore(file, snapshot, undefined, 1000);
    const id = first.items[0].id;
    const repeated = await Promise.all([updateReminderStore(file, snapshot), updateReminderStore(file, snapshot)]);
    assert.equal(repeated[1].items.length, 1);
    const claims = await Promise.all([updateReminderStore(file, snapshot, { id: "*", type: "claim_notifications" }), updateReminderStore(file, snapshot, { id: "*", type: "claim_notifications" })]);
    assert.equal(claims.reduce((sum, result) => sum + result.notifications.length, 0), 1);
    const read = await updateReminderStore(file, snapshot, { id, type: "read" }, 2000);
    assert.equal(read.items[0].read, true); assert.equal(read.items[0].handled, false);
    await updateReminderStore(file, snapshot, { id, type: "snooze" }, 3000);
    const due = await updateReminderStore(file, snapshot, undefined, 3603001);
    assert.equal(due.items[0].read, false); assert.equal(due.items[0].snoozedUntil, null);
    assert.equal((await updateReminderStore(file, snapshot, { id: "*", type: "claim_notifications" }, 3603002)).notifications.length, 1);
    await updateReminderStore(file, snapshot, { id, type: "handled" });
    assert.equal((await updateReminderStore(file, snapshot)).items[0].handled, true);
    await writeFile(file, "broken");
    await assert.rejects(updateReminderStore(file, snapshot));
    assert.equal(await readFile(file, "utf8"), "broken");
  } finally { await rm(root, { recursive: true, force: true }); }
});
