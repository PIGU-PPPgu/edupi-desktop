import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";

test("clean user profile loads education extensions from the packaged Core", { skip: !process.env.EDUPI_PACKAGED_CORE_ROOT }, async () => {
  const core = process.env.EDUPI_PACKAGED_CORE_ROOT;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-clean-runtime-"));
  try {
    // These are the extensions that the reviewed packaged component exposes.
    // Retired direct writers stay outside the bundle and are intentionally not
    // loaded into a clean profile.
    const names = ["memory", "calendar", "diagnosis", "education_article", "execution_engine", "layers", "timetable"];
    for (const retired of ["profiles", "evolution_engine", "subject_knowledge"]) {
      assert.equal(fs.existsSync(path.join(core, "extensions", `${retired}.ts`)), false, `retired extension must stay outside the packaged Core: ${retired}`);
    }
    const extensions = names.map(name => path.join(core, "extensions", `${name}.ts`));
    for (const file of extensions) assert.ok(fs.existsSync(file), `missing education extension: ${path.basename(file)}`);
    const loader = new DefaultResourceLoader({ cwd: root, agentDir: path.join(root, "agent"), additionalExtensionPaths: extensions });
    await loader.reload();
    const result = loader.getExtensions();
    assert.deepEqual(result.errors, []);
    assert.equal(result.extensions.length, names.length);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
