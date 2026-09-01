#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const keys = ["EDUPI_CORE_ROOT", "EDUPI_CORE_ALLOWED_ROOT", "EDUPI_DATA_ROOT", "EDUPI_DATA_ALLOWED_ROOT", "EDUPI_PROJECT_ROOT", "EDUPI_MEMORY_DIR", "EDUPI_OUTPUT_DIR", "EDUPI_LOCK_DIR", "EDUPI_HOME", "HOME"];
const previous = new Map(keys.map((key) => [key, process.env[key]]));
let temp = null;

function restore() {
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (temp) fs.rmSync(temp, { recursive: true, force: true });
}

try {
  const configured = process.env.EDUPI_CORE_ROOT;
  assert.ok(configured && path.isAbsolute(configured), "EDUPI_CORE_ROOT is required");
  const coreRoot = fs.realpathSync(configured);
  const parent = fs.realpathSync(os.tmpdir());
  temp = fs.mkdtempSync(path.join(parent, "edupi-memory-update-e2-"));
  const memoryDir = path.join(temp, ".edupi", "memory");
  const outputDir = path.join(temp, ".edupi", "output");
  const lockDir = path.join(temp, ".edupi", "locks");
  for (const dir of [memoryDir, outputDir, lockDir]) fs.mkdirSync(dir, { recursive: true });
  const sourcePath = path.join(memoryDir, "preferences.json");
  fs.writeFileSync(sourcePath, `${JSON.stringify({ entries: [{ id: "pref-1", content: "称呼我为吴老师", tags: ["称呼"], count: 1 }], updated_at: null }, null, 2)}\n`);
  const originalBytes = fs.readFileSync(sourcePath, "utf8");

  Object.assign(process.env, { EDUPI_CORE_ROOT: coreRoot, EDUPI_CORE_ALLOWED_ROOT: path.dirname(coreRoot), EDUPI_DATA_ROOT: temp, EDUPI_DATA_ALLOWED_ROOT: parent, EDUPI_PROJECT_ROOT: temp, EDUPI_MEMORY_DIR: memoryDir, EDUPI_OUTPUT_DIR: outputDir, EDUPI_LOCK_DIR: lockDir, EDUPI_HOME: temp, HOME: temp });
  const { createJiti } = await import("jiti");
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const snapshot = await jiti.import("../lib/edupi-core-snapshot.ts");
  const update = await jiti.import("../lib/edupi-memory-update.ts");
  const roots = snapshot.resolveEduPiBridgeRoots();
  const initial = await snapshot.readEduPiEducationSnapshot({ roots });
  const before = initial.payload.education_workspace.continuity.memories.find((item) => item.memory_id === "pref-1");
  assert.equal(before.content, "称呼我为吴老师");
  assert.equal(before.revision, 0);

  const result = await update.issueMemoryUpdate({ memoryId: "pref-1", expectedRevision: 0, content: "称呼我为吴老师，教授七年级数学", issuedAt: "2026-09-01T02:00:00.000Z" });
  assert.equal(result.receipt.status, "modified");
  assert.equal(result.memory.content, "称呼我为吴老师，教授七年级数学");
  assert.equal(result.memory.revision, 1);
  assert.equal(fs.readFileSync(sourcePath, "utf8"), originalBytes);
  assert.equal(JSON.parse(fs.readFileSync(path.join(outputDir, "memory_update_state.json"), "utf8")).overrides[0].history[0].content, "称呼我为吴老师");
  console.log(JSON.stringify({ status: "passed", memory_id: "pref-1", revision: 1, legacy_source_untouched: true }));
} finally {
  restore();
}
