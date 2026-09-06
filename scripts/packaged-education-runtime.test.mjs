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
    const names = ["memory", "calendar", "profiles", "evolution_engine", "subject_knowledge", "timetable"];
    const extensions = names.map(name => path.join(core, "extensions", `${name}.ts`));
    for (const file of extensions) assert.ok(fs.existsSync(file), `missing education extension: ${path.basename(file)}`);
    const loader = new DefaultResourceLoader({ cwd: root, agentDir: path.join(root, "agent"), additionalExtensionPaths: extensions });
    await loader.reload();
    const result = loader.getExtensions();
    assert.deepEqual(result.errors, []);
    assert.equal(result.extensions.length, names.length);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
