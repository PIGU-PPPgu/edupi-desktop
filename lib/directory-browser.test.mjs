import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

async function loadSubject() {
  return import("./directory-browser.ts");
}

test("lists directories and directory symlinks without returning files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-web-browse-"));
  try {
    await mkdir(path.join(root, "project"));
    await writeFile(path.join(root, "notes.txt"), "test", "utf8");
    await symlink(path.join(root, "project"), path.join(root, "linked-project"));

    const { listDirectories } = await loadSubject();
    const directories = await listDirectories(root);

    assert.deepEqual(directories.map((entry) => entry.name), ["linked-project", "project"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("expands home-relative paths and rejects missing directories", async () => {
  const {
    getBrowseStartDirectory,
    normalizeDirectory,
    resolveDirectory,
    shouldShowWindowsDrivePicker,
  } = await loadSubject();
  assert.equal(getBrowseStartDirectory(), homedir());
  assert.equal(getBrowseStartDirectory("/project"), "/project");
  assert.equal(shouldShowWindowsDrivePicker(undefined, "win32"), true);
  assert.equal(shouldShowWindowsDrivePicker(undefined, "darwin"), false);
  assert.equal(shouldShowWindowsDrivePicker(undefined, "linux"), false);
  assert.equal(shouldShowWindowsDrivePicker("C:\\Projects", "win32"), false);
  assert.equal(normalizeDirectory("~/project"), path.join(homedir(), "project"));
  await assert.rejects(resolveDirectory(path.join(tmpdir(), `pi-web-missing-${Date.now()}`)));
});

test("builds every Windows drive-letter candidate", async () => {
  const { getWindowsDriveCandidates } = await loadSubject();
  const drives = getWindowsDriveCandidates();

  assert.equal(drives.length, 26);
  assert.deepEqual(drives[0], { name: "A:", path: "A:\\" });
  assert.deepEqual(drives.at(-1), { name: "Z:", path: "Z:\\" });
});

test("finds parent directories across POSIX and Windows paths", async () => {
  const { getParentDirectory } = await loadSubject();

  assert.equal(getParentDirectory("/Users/alex/project"), "/Users/alex");
  assert.equal(getParentDirectory("/"), null);
  assert.equal(getParentDirectory("C:\\Users\\Alex\\project"), "C:\\Users\\Alex");
  assert.equal(getParentDirectory("C:\\"), null);
});

test("classifies permission errors separately from missing paths", async () => {
  const { isPermissionError } = await loadSubject();
  const eacces = Object.assign(new Error("permission denied"), { code: "EACCES" });
  const eperm = Object.assign(new Error("operation not permitted"), { code: "EPERM" });
  const enoent = Object.assign(new Error("not found"), { code: "ENOENT" });

  assert.equal(isPermissionError(eacces), true);
  assert.equal(isPermissionError(eperm), true);
  assert.equal(isPermissionError(enoent), false);
  assert.equal(isPermissionError(new Error("boom")), false);
  assert.equal(isPermissionError("EACCES"), false);
  assert.equal(isPermissionError(null), false);
});

test("permission guidance is actionable on macOS and generic elsewhere", async () => {
  const { directoryPermissionMessage } = await loadSubject();

  const mac = directoryPermissionMessage("/Users/wu/Desktop", "darwin");
  assert.match(mac, /\/Users\/wu\/Desktop/);
  assert.match(mac, /系统设置.*隐私与安全性/);

  const linux = directoryPermissionMessage("/home/wu/lessons", "linux");
  assert.match(linux, /\/home\/wu\/lessons/);
  assert.match(linux, /读写权限/);
  assert.doesNotMatch(linux, /macOS|系统设置|隐私与安全性/);
});
