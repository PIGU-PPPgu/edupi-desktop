import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

test("staging DELETE is bounded, authorized, exact, and uses teacher cleanup", () => {
  assert.match(source, /export async function DELETE/);
  assert.match(source, /if \(!requestAllowed\(request\)\)/);
  assert.match(source, /hasJsonContentType\(request\)/);
  assert.match(source, /parseJsonWithinLimit\(request, MAX_CLEANUP_JSON_BYTES\)/);
  assert.match(source, /exactRecord\([^;]+\["stagingId"\]\)/s);
  assert.match(source, /settleStagedMaterial\(body\.stagingId, "teacher_cleanup"\)/);
  assert.match(source, /\{ staged: listStagedMaterials\(\) \}/);
  assert.doesNotMatch(source, /unlinkSync|rmSync|writeFileSync/);
});
