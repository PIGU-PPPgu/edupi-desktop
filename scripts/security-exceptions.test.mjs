import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);

async function rustFiles(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await rustFiles(path));
    else if (extname(path) === ".rs") paths.push(path);
  }
  return paths;
}

test("the documented glib exception remains unreachable and time-bounded", async () => {
  const document = await readFile(new URL("docs/SECURITY_EXCEPTIONS.md", root), "utf8");
  assert.match(document, /RUSTSEC-2024-0429/);
  assert.match(document, /状态：受影响代码不可达/);
  assert.match(document, /复审日期：2026-11-30/);
  assert.match(document, /Tauri 上游维护警告/);
  assert.match(document, /16 个 `unmaintained` 警告/);

  const sourceRoots = [
    fileURLToPath(new URL("src-tauri/src", root)),
    fileURLToPath(new URL("src-tauri/vendor/nomifun", root)),
  ];
  for (const sourceRoot of sourceRoots) {
    for (const path of await rustFiles(sourceRoot)) {
      const source = await readFile(path, "utf8");
      assert.doesNotMatch(source, /VariantStrIter|array_iter_str/, `${path} makes the glib exception reachable`);
    }
  }
});
