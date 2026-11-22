import { strict as assert } from "node:assert";
import { materialUploadObjectKey, safeMaterialId } from "./material-path.ts";

const workspaceId = "5c8c6814-6ea2-488c-85b6-bf3d4914ed6d";

Deno.test("material IDs stay one literal path segment", () => {
  for (const value of ["material-1", "hash.2026", "_draft", "数学讲义-01", "a".repeat(160)]) {
    assert.equal(safeMaterialId(value), value);
  }
  for (const value of [
    ".", "..", "../elsewhere", "a/b", "a\\b", "%2e%2e", "%252e%252e",
    "id%2Fchild", "id%5Cchild", "id?", "id#", "id:other", "id\u0000",
    "id\r\n", " id", "id ", "a".repeat(161), "", null, {}, ["id"], 1,
  ]) {
    assert.equal(safeMaterialId(value), null);
  }
});

Deno.test("upload paths retain the exact workspace and material after URL normalization", () => {
  const key = materialUploadObjectKey(workspaceId, "数学讲义-01", "课前 讲义.pdf");
  assert.ok(key);
  const segments = key.split("/");
  assert.equal(segments.length, 3);
  assert.equal(segments[0], workspaceId);
  assert.equal(segments[1], "数学讲义-01");
  assert.match(segments[2], /^[0-9a-f-]{36}-课前 讲义\.pdf$/u);
  const normalizedPath = decodeURIComponent(
    new URL(`/object/upload/sign/edupi-materials/${key}`, "https://storage.invalid").pathname,
  );
  assert.equal(normalizedPath, `/object/upload/sign/edupi-materials/${key}`);
});

Deno.test("upload paths reject unsafe workspace and filename components", () => {
  for (const workspace of ["../other", `${workspaceId}/../other`, `${workspaceId}%2fother`, ""]) {
    assert.equal(materialUploadObjectKey(workspace, "material-1", "file.pdf"), null);
  }
  for (const fileName of ["../file", "folder/file", "folder\\file", "%2e%2e", "file?x", "file#x", "", ".", ".."]) {
    assert.equal(materialUploadObjectKey(workspaceId, "material-1", fileName), null);
  }
  assert.equal(materialUploadObjectKey(workspaceId, "../other-workspace", "file.pdf"), null);
});
