import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { snapshotGeneratedFiles, generatedArtifactsRequest } = await jiti.import("./edupi-generated-artifacts.ts");

test("output snapshot detects new and revised teaching documents without scanning memory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-output-test-"));
  try {
    fs.mkdirSync(path.join(root, "deliverables"));
    fs.mkdirSync(path.join(root, ".edupi/memory"), { recursive: true });
    fs.writeFileSync(path.join(root, ".edupi/memory/private.md"), "private");
    assert.equal(snapshotGeneratedFiles(root).size, 0);
    const file = path.join(root, "deliverables/lesson.docx");
    fs.writeFileSync(file, "first");
    const before = snapshotGeneratedFiles(root);
    fs.writeFileSync(file, "revised document");
    assert.notEqual(snapshotGeneratedFiles(root).get(file), before.get(file));
    assert.equal(snapshotGeneratedFiles(root).size, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("real Core process registers and reads a generated file across separate invocations", { skip: !process.env.EDUPI_CORE_ROOT }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-artifact-bridge-"));
  const oldRoot = process.env.EDUPI_DATA_ROOT;
  const oldAllowed = process.env.EDUPI_DATA_ALLOWED_ROOT;
  process.env.EDUPI_DATA_ROOT = root;
  process.env.EDUPI_DATA_ALLOWED_ROOT = os.tmpdir();
  try {
    const file = path.join(root, "lesson.md");
    fs.writeFileSync(file, "# 教案");
    const response = await generatedArtifactsRequest("register", { file_path: file, session_id: "test-session" });
    const read = await generatedArtifactsRequest("list");
    assert.equal(read.artifacts[0].artifact_id, response.artifact.artifact_id);
    assert.equal(read.artifacts[0].title, "lesson.md");
  } finally {
    if (oldRoot === undefined) delete process.env.EDUPI_DATA_ROOT; else process.env.EDUPI_DATA_ROOT = oldRoot;
    if (oldAllowed === undefined) delete process.env.EDUPI_DATA_ALLOWED_ROOT; else process.env.EDUPI_DATA_ALLOWED_ROOT = oldAllowed;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
