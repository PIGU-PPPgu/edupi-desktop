import assert from "node:assert/strict";
import test from "node:test";

const { isEduPiManagedPath, resolveEduPiManagedRoot } = await import("./edupi-managed-path.ts");

test("resolves only the configured data root", () => {
  const previous = process.env.EDUPI_DATA_ROOT;
  try {
    delete process.env.EDUPI_DATA_ROOT;
    assert.equal(resolveEduPiManagedRoot(undefined), null);
    assert.equal(isEduPiManagedPath("/srv/edupi-data/.edupi"), false);

    process.env.EDUPI_DATA_ROOT = "/srv/edupi-data";
    assert.equal(resolveEduPiManagedRoot(undefined), "/srv/edupi-data/.edupi");
    assert.equal(isEduPiManagedPath("/srv/edupi-data/.edupi/file.md"), true);
    assert.equal(resolveEduPiManagedRoot("/srv/edupi-data"), "/srv/edupi-data/.edupi");
  } finally {
    if (previous === undefined) delete process.env.EDUPI_DATA_ROOT;
    else process.env.EDUPI_DATA_ROOT = previous;
  }
});

test("blocks the managed root and descendants but not siblings or ordinary hidden folders", () => {
  const root = "/tmp/teacher-data";

  assert.equal(isEduPiManagedPath(root + "/.edupi", root), true);
  assert.equal(isEduPiManagedPath(root + "/.edupi/inbox/teacher-material.md", root), true);
  assert.equal(isEduPiManagedPath(root + "/.edupi-other/file.md", root), false);
  assert.equal(isEduPiManagedPath(root + "/.config/file.md", root), false);
  assert.equal(isEduPiManagedPath("/tmp/teacher-data-sibling/.edupi/file.md", root), false);
});

test("normalizes parent traversal without treating an escaped path as managed", () => {
  const root = "/tmp/teacher-data";

  assert.equal(isEduPiManagedPath(root + "/.edupi/../ordinary/file.md", root), false);
  assert.equal(isEduPiManagedPath(root + "/.edupi/records/../file.md", root), true);
  assert.equal(isEduPiManagedPath(root + "/.edupi/../../outside/file.md", root), false);
  assert.equal(
    isEduPiManagedPath("/tmp/ordinary/link/file.md", root, root + "/.edupi/link/file.md"),
    true,
  );
  assert.equal(
    isEduPiManagedPath(root + "/.edupi/link/file.md", root, "/tmp/outside/file.md"),
    true,
  );
});

test("normalizes Windows paths case-insensitively and with either separator", () => {
  const root = "C:\\Users\\Teacher\\Data";

  assert.equal(resolveEduPiManagedRoot(root), "C:\\Users\\Teacher\\Data\\.edupi");
  assert.equal(isEduPiManagedPath("c:/users/teacher/data/.EDUPI/memory/state.json", root), true);
  assert.equal(isEduPiManagedPath("C:\\Users\\Teacher\\Data\\.edupi\\..\\notes.txt", root), false);
  assert.equal(isEduPiManagedPath("C:\\Users\\Teacher\\Data\\.edupi-other\\file.txt", root), false);
  assert.equal(isEduPiManagedPath("C:\\Users\\Teacher\\Data-sibling\\.edupi\\file.txt", root), false);
});
