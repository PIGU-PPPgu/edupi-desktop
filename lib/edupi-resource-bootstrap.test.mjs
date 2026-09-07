import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
const { prepareEducationResources } = await createJiti(import.meta.url).import("./edupi-runtime.ts");

test("resource setup preserves teacher skills and aligns extension storage with Core", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-resources-"));
  const keys = ["EDUPI_PROJECT_ROOT", "EDUPI_MEMORY_DIR", "EDUPI_OUTPUT_DIR", "EDUPI_LOCK_DIR", "EDUPI_SKILLS_DIR", "EDUPI_DATA_DIR", "EDUPI_CONFIG_DIR"];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    const data = path.join(root, "teacher"), code = path.join(root, "code");
    const local = path.join(data, "skills/01-test"), builtin = path.join(code, "skills/01-test");
    fs.mkdirSync(local, { recursive: true }); fs.mkdirSync(builtin, { recursive: true });
    fs.writeFileSync(path.join(local, "SKILL.md"), "teacher version");
    fs.writeFileSync(path.join(builtin, "SKILL.md"), "builtin version");
    fs.writeFileSync(path.join(builtin, "reference.md"), "reference");
    delete process.env.EDUPI_SKILLS_DIR;
    prepareEducationResources(data, code);
    assert.equal(fs.readFileSync(path.join(local, "SKILL.md"), "utf8"), "teacher version");
    assert.equal(fs.readFileSync(path.join(local, "reference.md"), "utf8"), "reference");
    assert.equal(process.env.EDUPI_MEMORY_DIR, path.join(data, ".edupi/memory"));
    assert.equal(process.env.EDUPI_LOCK_DIR, path.join(data, ".edupi/locks"));
  } finally { for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } fs.rmSync(root, { recursive: true, force: true }); }
});
