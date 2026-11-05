import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { currentSourceAdminNotificationActivation, readCurrentSourceAdminNotificationAuthority } = await jiti.import("./edupi-admin-notification-authority.ts");
const { writeEduPiProactivityConfig } = await jiti.import("./edupi-proactivity-config.ts");

test("G3 notification authority follows the exact isolated admin activation and current Core grant", { skip: process.platform !== "darwin" }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-admin-notification-"));
  const dataRoot = path.join(root, "teacher"), stateDir = path.join(root, "state");
  fs.mkdirSync(dataRoot); fs.mkdirSync(stateDir);
  const previousCanary = process.env.EDUPI_DESKTOP_ISOLATED_CANARY;
  const previousStateDir = process.env.PI_DESKTOP_STATE_DIR;
  process.env.EDUPI_DESKTOP_ISOLATED_CANARY = "1";
  process.env.PI_DESKTOP_STATE_DIR = stateDir;
  const scope = { classId: "class-1", subject: "administration" };
  const options = { stateDir, dataRoot, domain: "calendar_administration" };
  try {
    assert.equal(currentSourceAdminNotificationActivation(dataRoot), null);
    writeEduPiProactivityConfig({ enabled: true, scope, grantId: "grant-1", ownerId: "owner-1" },
      { ...options, now: "2026-11-05T00:00:00.000Z" });
    assert.deepEqual(currentSourceAdminNotificationActivation(dataRoot), {
      classId: "class-1", grantId: "grant-1", ownerId: "owner-1", updatedAt: "2026-11-05T00:00:00.000Z",
    });
    const rootRef = `sha256:${"a".repeat(64)}`, now = Date.parse("2026-11-05T00:30:00.000Z");
    let ownerId = "owner-1";
    let grant = { id: "grant-1", version: 1, status: "active", ends_at: "2026-11-12T00:00:00.000Z" };
    const host = { call: async (operation, payload) => {
      assert.equal(operation, "owner_read"); assert.deepEqual(payload, { root_ref: rootRef });
      return { ok: true, result: { root_ref: rootRef, owner: { id: ownerId }, grants: [grant] } };
    } };
    assert.deepEqual(await readCurrentSourceAdminNotificationAuthority(host, rootRef, dataRoot, now), {
      classId: "class-1", grantId: "grant-1", ownerId: "owner-1", updatedAt: "2026-11-05T00:00:00.000Z",
      grantVersion: 1, endsAt: grant.ends_at,
    });
    for (const status of ["paused", "revoked"]) {
      grant = { ...grant, status };
      assert.equal(await readCurrentSourceAdminNotificationAuthority(host, rootRef, dataRoot, now), null);
    }
    grant = { ...grant, status: "active", ends_at: "2026-11-05T00:29:00.000Z" };
    assert.equal(await readCurrentSourceAdminNotificationAuthority(host, rootRef, dataRoot, now), null);
    grant = { ...grant, ends_at: "2026-11-12T00:00:00.000Z" }; ownerId = "other-owner";
    assert.equal(await readCurrentSourceAdminNotificationAuthority(host, rootRef, dataRoot, now), null);
    delete process.env.EDUPI_DESKTOP_ISOLATED_CANARY;
    assert.equal(currentSourceAdminNotificationActivation(dataRoot), null);
    process.env.EDUPI_DESKTOP_ISOLATED_CANARY = "1";
    writeEduPiProactivityConfig({ enabled: false, scope, grantId: "grant-1", ownerId: "owner-1" },
      { ...options, now: "2026-11-05T00:01:00.000Z" });
    assert.equal(currentSourceAdminNotificationActivation(dataRoot), null);
    writeEduPiProactivityConfig({ enabled: true, scope: { ...scope, subject: "数学" }, grantId: "grant-1", ownerId: "owner-1" },
      { ...options, now: "2026-11-05T00:02:00.000Z" });
    assert.equal(currentSourceAdminNotificationActivation(dataRoot), null);
  } finally {
    if (previousCanary === undefined) delete process.env.EDUPI_DESKTOP_ISOLATED_CANARY;
    else process.env.EDUPI_DESKTOP_ISOLATED_CANARY = previousCanary;
    if (previousStateDir === undefined) delete process.env.PI_DESKTOP_STATE_DIR;
    else process.env.PI_DESKTOP_STATE_DIR = previousStateDir;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
