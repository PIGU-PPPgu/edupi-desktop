import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cleanupRegisteredDirectories, registerCleanupDirectory } from "./macos-acceptance-cleanup.mjs";

const bundle = "com.abcwyc.pi-agent";
const nativePaths = ["Application Support", "Logs", "Caches", "WebKit", "HTTPStorages"]
  .map(category => `Library/${category}/${bundle}`)
  .concat(`Library/Saved Application State/${bundle}.savedState`);
const measureBytes = async () => 4096;

function temporary(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mac-cleanup-test-")));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function directory(root, relative) {
  const target = path.join(root, relative);
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(target, "marker"), "isolated synthetic fixture", { mode: 0o600 });
  return target;
}

function replacement(target) {
  const original = `${target}-original`;
  fs.renameSync(target, original); // Keep the original inode allocated.
  directory(path.dirname(target), path.basename(target));
  assert.notEqual(fs.lstatSync(target).ino, fs.lstatSync(original).ino);
  return original;
}

function fails(callback, code) {
  assert.throws(callback, error => error.code === code && error.message === code);
}

function assertKept(report, code, target, phase = "before_measure", scope = "leaf") {
  assert.equal(report.status, "failed");
  assert.equal(report.removedAllocatedBytes, 0);
  assert.equal(report.results.length, 1);
  assert.equal(report.results[0].status, "failed");
  assert.equal(report.results[0].code, code);
  assert.equal(report.results[0].phase, phase);
  assert.equal(report.results[0].scope, scope);
  assert.equal(report.results[0].allocatedBytes, 0);
  if (target) assert.ok(fs.lstatSync(target));
}

test("import performs no filesystem inspection, measurement, creation or deletion", async t => {
  // Load source before intercepting IO; Node's file-module loader itself calls realpath.
  const source = fs.readFileSync(new URL("./macos-acceptance-cleanup.mjs", import.meta.url), "utf8");
  const calls = [];
  for (const name of ["lstatSync", "statSync", "realpathSync", "existsSync", "readdirSync", "rmSync", "mkdirSync"]) {
    t.mock.method(fs, name, () => { calls.push(name); throw new Error("unexpected import IO"); });
  }
  await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  assert.deepEqual(calls, []);
});

test("registration is nondestructive and exposes only an immutable opaque role", t => {
  const root = temporary(t);
  const target = directory(root, "task");
  const entry = registerCleanupDirectory(target, { role: "task" });
  assert.deepEqual(entry, { role: "task" });
  assert.ok(Object.isFrozen(entry));
  assert.ok(fs.readFileSync(path.join(target, "marker"), "utf8"));
  assert.equal(JSON.stringify(entry).includes(root), false);
});

test("normal cleanup measures the original directory, removes it and reports full safe ancestry", async t => {
  const root = temporary(t);
  const target = directory(root, "task");
  directory(target, "EduPi.app/Contents");
  const stat = fs.lstatSync(target, { bigint: true });
  const entry = registerCleanupDirectory(target, { role: "task" });
  let measurements = 0;
  const report = await cleanupRegisteredDirectories([entry], { measureBytes: async observed => {
    measurements++;
    assert.equal(observed, target);
    assert.ok(fs.existsSync(path.join(target, "EduPi.app/Contents/marker")));
    return 8192;
  } });
  assert.equal(measurements, 1);
  assert.equal(fs.existsSync(target), false);
  assert.equal(report.status, "passed");
  assert.equal(report.removedAllocatedBytes, 8192);
  assert.deepEqual(report.progressFailures, []);
  const item = report.results[0];
  assert.equal(item.role, "task");
  assert.equal(item.status, "removed");
  assert.equal(item.phase, "after_remove");
  assert.equal(item.code, "cleanup_removed");
  assert.equal(item.errno, null);
  assert.equal(item.allocatedBytes, 8192);
  assert.deepEqual(item.expected.leaf, { type: "directory", canonical: true, noSymlink: true,
    dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs),
    owner: { uid: String(stat.uid), gid: String(stat.gid) }, mode: "0700" });
  const ancestors = [];
  for (let parent = path.dirname(target); ; parent = path.dirname(parent)) {
    ancestors.unshift(parent);
    if (parent === path.dirname(parent)) break;
  }
  assert.equal(item.expected.parents.length, ancestors.length);
  ancestors.forEach((ancestor, index) => {
    const parent = fs.lstatSync(ancestor, { bigint: true });
    assert.equal(item.expected.parents[index].ino, String(parent.ino));
    assert.equal(item.expected.parents[index].dev, String(parent.dev));
    assert.equal(item.expected.parents[index].canonical, true);
    assert.equal(item.expected.parents[index].noSymlink, true);
  });
  assert.deepEqual(item.current.parents, item.expected.parents);
  assert.equal(item.current.leaf, null);
  assert.ok(Object.isFrozen(report) && Object.isFrozen(item.expected.leaf.owner));
  assert.equal(JSON.stringify(report).includes(root), false);
});

test("task, canary, synthetic default and six native profiles clean independently with shared parents", async t => {
  const root = temporary(t);
  const home = directory(root, "synthetic-home");
  const targets = [
    ["canary", directory(home, "synthetic-canary"), false],
    ["synthetic_default", directory(home, "synthetic-default"), false],
    ...nativePaths.map((relative, index) => [`native_${index}`, directory(home, relative), true]),
    ["task", directory(root, "task"), false],
  ];
  directory(targets.at(-1)[1], "EduPi.app/Contents/Resources");
  const entries = targets.map(([role, target, nativeProfile]) =>
    registerCleanupDirectory(target, { role, nativeProfile }));
  const progress = [];
  const measured = [];
  const report = await cleanupRegisteredDirectories(entries, { measureBytes: async target => {
    measured.push(target);
    return 4096;
  }, onProgress: snapshot => { progress.push(snapshot); } });
  assert.equal(report.status, "passed");
  assert.equal(report.results.length, 9);
  assert.equal(report.removedAllocatedBytes, 9 * 4096);
  assert.deepEqual(measured, targets.map(([, target]) => target));
  for (const [role, target] of targets) {
    assert.equal(report.results.find(item => item.role === role).status, "removed");
    assert.equal(fs.existsSync(target), false);
  }
  assert.equal(progress.length, 9);
  progress.forEach((snapshot, index) => {
    assert.equal(snapshot.removedAllocatedBytes, (index + 1) * 4096);
    assert.equal(snapshot.status, index < 8 ? "in_progress" : "passed");
  });
  assert.ok(fs.existsSync(path.join(home, "marker")));
  assert.equal(JSON.stringify(report).includes(home), false);
});

for (const relative of nativePaths) {
  test(`only a registered native leaf may be already absent: ${relative}`, async t => {
    const root = temporary(t);
    const target = directory(root, relative);
    const entry = registerCleanupDirectory(target, { role: "native_profile", nativeProfile: true });
    fs.rmSync(target, { recursive: true });
    const report = await cleanupRegisteredDirectories([entry], { measureBytes: async () => {
      assert.fail("an absent leaf must not be measured");
    } });
    assert.equal(report.status, "passed");
    assert.equal(report.removedAllocatedBytes, 0);
    const item = report.results[0];
    assert.equal(item.status, "already_absent");
    assert.equal(item.phase, "before_measure");
    assert.equal(item.code, "cleanup_native_profile_already_absent");
    assert.equal(item.allocatedBytes, 0);
    assert.equal(item.errno, "ENOENT");
    assert.equal(item.current.leaf, null);
    assert.deepEqual(item.current.parents, item.expected.parents);
    assert.ok(fs.lstatSync(path.dirname(target)).isDirectory());
  });
}

test("native already_absent during measurement records no removal or allocated bytes", async t => {
  const root = temporary(t);
  const target = directory(root, nativePaths[0]);
  const entry = registerCleanupDirectory(target, { role: "native_profile", nativeProfile: true });
  const report = await cleanupRegisteredDirectories([entry], { measureBytes: async observed => {
    fs.rmSync(observed, { recursive: true });
    return 4096;
  } });
  assert.equal(report.status, "passed");
  assert.equal(report.removedAllocatedBytes, 0);
  assert.equal(report.results[0].status, "already_absent");
  assert.equal(report.results[0].phase, "before_remove");
  assert.deepEqual(report.results[0].current.parents, report.results[0].expected.parents);
});

test("missing task, canary, default and undeclared native profiles fail without measurement", async t => {
  const root = temporary(t);
  for (const role of ["task", "canary", "synthetic_default", "native_profile"]) {
    const target = directory(root, role === "native_profile" ? nativePaths[0] : role);
    const entry = registerCleanupDirectory(target, { role });
    fs.rmSync(target, { recursive: true });
    const report = await cleanupRegisteredDirectories([entry], { measureBytes: async () => assert.fail("measure called") });
    assertKept(report, "cleanup_leaf_missing", null);
    assert.equal(report.results[0].errno, "ENOENT");
  }
});

for (const mutation of ["missing", "replaced", "symlink", "dangling", "file"]) {
  test(`native absence never excuses a ${mutation} parent`, async t => {
    const root = temporary(t);
    const target = directory(root, nativePaths[1]);
    const parent = path.dirname(target);
    const entry = registerCleanupDirectory(target, { role: "native_logs", nativeProfile: true });
    fs.renameSync(parent, `${parent}-original`);
    if (mutation === "replaced") fs.mkdirSync(parent);
    if (mutation === "file") fs.writeFileSync(parent, "synthetic file");
    if (mutation === "symlink" || mutation === "dangling") {
      const outside = mutation === "symlink" ? directory(root, "outside") : path.join(root, "nonexistent");
      fs.symlinkSync(outside, parent, "dir");
    }
    const report = await cleanupRegisteredDirectories([entry], { measureBytes: async () => assert.fail("measure called") });
    const code = mutation === "missing" ? "cleanup_parent_missing" : mutation === "replaced"
      ? "cleanup_parent_identity_changed" : mutation === "file" ? "cleanup_parent_not_directory" : "cleanup_parent_symlink";
    assertKept(report, code, mutation === "missing" ? null : parent, "before_measure", "parent");
    assert.equal(report.results[0].parentIndex, report.results[0].current.parents.length - 1);
    assert.ok(fs.existsSync(path.join(`${parent}-original`, bundle, "marker")));
  });
}

for (const mutation of ["dangling", "external", "file", "new_inode"]) {
  test(`leaf ${mutation} is retained even for an explicitly declared native profile`, async t => {
    const root = temporary(t);
    const target = directory(root, nativePaths[2]);
    const entry = registerCleanupDirectory(target, { role: "native_cache", nativeProfile: true });
    fs.renameSync(target, `${target}-original`);
    const outside = directory(root, "outside");
    if (mutation === "file") fs.writeFileSync(target, "synthetic file");
    else if (mutation === "new_inode") fs.mkdirSync(target);
    else fs.symlinkSync(mutation === "external" ? outside : path.join(root, "missing"), target, "dir");
    const report = await cleanupRegisteredDirectories([entry], { measureBytes: async () => assert.fail("measure called") });
    const code = mutation === "file" ? "cleanup_leaf_not_directory" : mutation === "new_inode"
      ? "cleanup_leaf_identity_changed" : "cleanup_leaf_symlink";
    assertKept(report, code, target);
    assert.equal(report.results[0].current.leaf.type,
      mutation === "file" ? "file" : mutation === "new_inode" ? "directory" : "symlink");
    assert.ok(fs.existsSync(path.join(outside, "marker")));
    assert.ok(fs.existsSync(path.join(`${target}-original`, "marker")));
  });
}

test("a new task inode is rejected and cannot be re-registered to adopt the replacement", async t => {
  const root = temporary(t);
  const target = directory(root, "task");
  const entry = registerCleanupDirectory(target, { role: "task" });
  replacement(target);
  const report = await cleanupRegisteredDirectories([entry], { measureBytes });
  assertKept(report, "cleanup_leaf_identity_changed", target);
  fails(() => registerCleanupDirectory(target, { role: "task" }), "cleanup_directory_overlap");
  const retried = await cleanupRegisteredDirectories([entry], { measureBytes });
  assert.equal(retried.results[0].expected.leaf.ino, report.results[0].expected.leaf.ino);
  assertKept(retried, "cleanup_leaf_identity_changed", target);
});

for (const mutation of ["new_inode", "dangling", "external", "file", "missing", "parent_replaced", "ancestor_symlink"]) {
  test(`measurement-time ${mutation} is rechecked synchronously before removal`, async t => {
    const root = temporary(t);
    const target = directory(root, "container/task");
    const entry = registerCleanupDirectory(target, { role: "task" });
    const outside = directory(root, "outside");
    const report = await cleanupRegisteredDirectories([entry], { measureBytes: async observed => {
      assert.equal(observed, target);
      await Promise.resolve();
      if (mutation === "parent_replaced") replacement(path.dirname(target));
      else if (mutation === "ancestor_symlink") {
        const parent = path.dirname(target);
        fs.renameSync(parent, `${parent}-original`);
        fs.symlinkSync(outside, parent, "dir");
      } else {
        fs.renameSync(target, `${target}-original`);
        if (mutation === "new_inode") directory(path.dirname(target), path.basename(target));
        if (mutation === "file") fs.writeFileSync(target, "new synthetic file");
        if (mutation === "dangling" || mutation === "external")
          fs.symlinkSync(mutation === "external" ? outside : path.join(root, "missing"), target, "dir");
      }
      return 65536;
    } });
    const parentChanged = mutation === "parent_replaced" || mutation === "ancestor_symlink";
    const code = { new_inode: "cleanup_leaf_identity_changed", dangling: "cleanup_leaf_symlink",
      external: "cleanup_leaf_symlink", file: "cleanup_leaf_not_directory", missing: "cleanup_leaf_missing",
      parent_replaced: "cleanup_parent_identity_changed", ancestor_symlink: "cleanup_parent_symlink" }[mutation];
    assertKept(report, code, mutation === "missing" || parentChanged ? null : target,
      "before_remove", parentChanged ? "parent" : "leaf");
    assert.ok(fs.existsSync(path.join(outside, "marker")));
    const original = parentChanged ? path.join(`${path.dirname(target)}-original`, "task") : `${target}-original`;
    assert.ok(fs.existsSync(path.join(original, "marker")));
  });
}

for (const scope of ["leaf", "parent"]) {
  test(`changed ${scope} permissions are rejected against the original mode`, async t => {
    const root = temporary(t);
    const target = directory(root, "container/task");
    const entry = registerCleanupDirectory(target, { role: "task" });
    fs.chmodSync(scope === "leaf" ? target : path.dirname(target), 0o755);
    const report = await cleanupRegisteredDirectories([entry], { measureBytes });
    assertKept(report, `cleanup_${scope}_mode_changed`, target, "before_measure", scope);
  });
}

test("an unrelated parent marker change is allowed; directory times are not identity", async t => {
  const root = temporary(t);
  const target = directory(root, "container/task");
  const entry = registerCleanupDirectory(target, { role: "task" });
  const marker = path.join(path.dirname(target), "sibling");
  fs.writeFileSync(marker, "synthetic sibling");
  const report = await cleanupRegisteredDirectories([entry], { measureBytes });
  assert.equal(report.status, "passed");
  assert.ok(fs.existsSync(marker));
});

test("one entry failure does not prevent a later independent App directory removal", async t => {
  const root = temporary(t);
  const bad = directory(root, "native/Library/WebKit/com.abcwyc.pi-agent");
  const good = directory(root, "task");
  directory(good, "EduPi.app/Contents/Resources");
  const entries = [registerCleanupDirectory(bad, { role: "native_webkit", nativeProfile: true }),
    registerCleanupDirectory(good, { role: "task" })];
  replacement(bad);
  const progress = [];
  const measured = [];
  const report = await cleanupRegisteredDirectories(entries, { measureBytes: async target => {
    measured.push(target);
    return 12288;
  }, onProgress: snapshot => {
    progress.push(snapshot);
    assert.ok(Object.isFrozen(snapshot.results));
  } });
  assert.deepEqual(measured, [good]);
  assert.equal(report.status, "failed");
  assert.deepEqual(report.results.map(item => item.status), ["failed", "removed"]);
  assert.equal(report.removedAllocatedBytes, 12288);
  assert.equal(progress.length, 2);
  assert.equal(progress[0].results.length, 1);
  assert.equal(progress[0].removedAllocatedBytes, 0);
  assert.deepEqual(progress[1], report);
  assert.ok(fs.existsSync(path.join(bad, "marker")));
  assert.equal(fs.existsSync(good), false);
});

test("successful progress is persisted before a subsequent measurement and its failure", async t => {
  const root = temporary(t);
  const good = directory(root, "task");
  const bad = directory(root, "canary");
  const entries = [registerCleanupDirectory(good, { role: "task" }), registerCleanupDirectory(bad, { role: "canary" })];
  const progress = [];
  const report = await cleanupRegisteredDirectories(entries, { measureBytes: async target => {
    if (target === bad) {
      assert.equal(progress.length, 1);
      assert.equal(progress[0].results[0].status, "removed");
      assert.equal(progress[0].removedAllocatedBytes, 4096);
      assert.equal(progress[0].status, "in_progress");
      throw Object.assign(new Error(`private ${root} argv=synthetic env=synthetic`), { code: "EIO" });
    }
    return 4096;
  }, onProgress: snapshot => { progress.push(snapshot); } });
  assert.equal(report.status, "failed");
  assert.equal(report.removedAllocatedBytes, 4096);
  assert.equal(report.results[1].code, "cleanup_measure_failed");
  assert.equal(report.results[1].errno, "EIO");
  assert.equal(report.results[1].phase, "measure");
  assert.ok(fs.existsSync(bad));
  const serialized = JSON.stringify(report);
  for (const secret of [root, "argv", "env", "private ", "isolated synthetic fixture"])
    assert.equal(serialized.includes(secret), false);
});

test("progress callbacks cannot mutate evidence and errors do not stop independent cleanup", async t => {
  const root = temporary(t);
  const targets = ["task", "canary"].map(role => directory(root, role));
  const entries = targets.map((target, index) => registerCleanupDirectory(target, { role: index ? "canary" : "task" }));
  const report = await cleanupRegisteredDirectories(entries, { measureBytes, onProgress: snapshot => {
    if (snapshot.results.length !== 1) return;
    assert.throws(() => { snapshot.results[0].expected.leaf.owner.uid = "replacement"; }, TypeError);
    throw Object.assign(new Error(`private ${root}`), { code: `${root}/not-an-errno` });
  } });
  assert.equal(report.status, "failed");
  assert.deepEqual(report.results.map(item => item.status), ["removed", "removed"]);
  assert.equal(report.removedAllocatedBytes, 8192);
  assert.deepEqual(report.progressFailures,
    [{ role: "task", phase: "progress", code: "cleanup_progress_failed", errno: "UNKNOWN" }]);
  targets.forEach(target => assert.equal(fs.existsSync(target), false));
  assert.equal(JSON.stringify(report).includes(root), false);
});

test("onProgress replacement of the next directory cannot update its original baseline", async t => {
  const root = temporary(t);
  const first = directory(root, "task");
  const next = directory(root, nativePaths[3]);
  const entries = [registerCleanupDirectory(first, { role: "task" }),
    registerCleanupDirectory(next, { role: "native_webkit", nativeProfile: true })];
  const report = await cleanupRegisteredDirectories(entries, { measureBytes, onProgress: snapshot => {
    if (snapshot.results.length === 1) replacement(next);
  } });
  assert.equal(report.status, "failed");
  assert.equal(report.results[0].status, "removed");
  assert.equal(report.results[1].code, "cleanup_leaf_identity_changed");
  assert.ok(fs.existsSync(path.join(next, "marker")));
});

test("measurement values must be nonnegative safe integers and errors expose only safe errno", async t => {
  const root = temporary(t);
  const target = directory(root, "task");
  const entry = registerCleanupDirectory(target, { role: "task" });
  for (const value of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "4096", 1n, undefined]) {
    const report = await cleanupRegisteredDirectories([entry], { measureBytes: async () => value });
    assertKept(report, "cleanup_invalid_measurement", target, "measure");
  }
  const report = await cleanupRegisteredDirectories([entry], { measureBytes: async () => {
    throw Object.assign(new Error(root), { code: `EACCES ${root}` });
  } });
  assertKept(report, "cleanup_measure_failed", target, "measure");
  assert.equal(report.results[0].errno, "UNKNOWN");
});

test("allocated-byte overflow retains the affected directory and the prior successful result", async t => {
  const root = temporary(t);
  const first = directory(root, "task");
  const next = directory(root, "canary");
  const report = await cleanupRegisteredDirectories(
    [registerCleanupDirectory(first, { role: "task" }), registerCleanupDirectory(next, { role: "canary" })],
    { measureBytes: async target => target === first ? Number.MAX_SAFE_INTEGER : 1 });
  assert.equal(report.status, "failed");
  assert.equal(report.removedAllocatedBytes, Number.MAX_SAFE_INTEGER);
  assert.equal(report.results[0].status, "removed");
  assert.equal(report.results[1].code, "cleanup_allocated_bytes_overflow");
  assert.ok(fs.existsSync(next));
});

test("a zero allocated-byte measurement is valid", async t => {
  const target = directory(temporary(t), "task");
  const report = await cleanupRegisteredDirectories([registerCleanupDirectory(target, { role: "task" })],
    { measureBytes: async () => 0 });
  assert.equal(report.status, "passed");
  assert.equal(report.results[0].status, "removed");
  assert.equal(report.removedAllocatedBytes, 0);
});

test("registration rejects overlapping paths in either order and allows sibling names", t => {
  const root = temporary(t);
  const first = directory(root, "first");
  const nested = directory(first, "nested");
  registerCleanupDirectory(first, { role: "task" });
  fails(() => registerCleanupDirectory(first, { role: "duplicate" }), "cleanup_directory_overlap");
  fails(() => registerCleanupDirectory(nested, { role: "nested" }), "cleanup_directory_overlap");
  const second = directory(root, "second");
  const child = directory(second, "nested");
  registerCleanupDirectory(child, { role: "child" });
  fails(() => registerCleanupDirectory(second, { role: "parent" }), "cleanup_directory_overlap");
  assert.ok(registerCleanupDirectory(directory(root, "first-sibling"), { role: "sibling" }));
});

test("registration rejects unsafe paths, roles, native flags and profile lookalikes", t => {
  const root = temporary(t);
  const target = directory(root, "task");
  for (const unsafe of ["/", "relative/task", `${target}/`, `${root}//task`, `${root}/../task`, `${target}\0`])
    fails(() => registerCleanupDirectory(unsafe, { role: "task" }), "cleanup_invalid_directory");
  for (const role of [undefined, "", root, "$TASK", "task\nTOKEN", "x".repeat(65)])
    fails(() => registerCleanupDirectory(target, { role }), "cleanup_invalid_role");
  fails(() => registerCleanupDirectory(target, { role: "task", nativeProfile: "true" }), "cleanup_invalid_native_profile");
  for (const relative of ["Library/Preferences/com.abcwyc.pi-agent", "Other/Caches/com.abcwyc.pi-agent",
    "Library/Caches/com.abcwyc.pi-agent.extra", "Library/Caches/com.abcwyc.pi-agent/child",
    "Library/Caches/com.abcwyc.pi-agent.savedState", "Library/Saved Application State/com.abcwyc.pi-agent",
    "Library/Saved Application State/com.abcwyc.pi-agent.savedState/child"]) {
    fails(() => registerCleanupDirectory(directory(root, relative), { role: "native_profile", nativeProfile: true }),
      "cleanup_native_profile_path_not_allowed");
  }
});

test("registration refuses missing leaves, dangling/outside symlinks and symlinked ancestors", t => {
  const root = temporary(t);
  const outside = directory(root, "outside");
  const missing = path.join(root, "missing");
  fails(() => registerCleanupDirectory(missing, { role: "task" }), "cleanup_leaf_missing");
  for (const [label, destination] of [["dangling", missing], ["alias", outside]]) {
    const link = path.join(root, label);
    fs.symlinkSync(destination, link, "dir");
    fails(() => registerCleanupDirectory(link, { role: "task" }), "cleanup_leaf_symlink");
    fails(() => registerCleanupDirectory(path.join(link, "child"), { role: "task" }), "cleanup_parent_symlink");
  }
  const file = path.join(root, "file");
  fs.writeFileSync(file, "synthetic");
  fails(() => registerCleanupDirectory(file, { role: "task" }), "cleanup_leaf_not_directory");
  const native = directory(root, nativePaths[0]);
  fs.rmSync(native, { recursive: true });
  fails(() => registerCleanupDirectory(native, { role: "native_support", nativeProfile: true }), "cleanup_leaf_missing");
});

test("unregistered, cloned and duplicate entries reject the entire request before any cleanup", async t => {
  const root = temporary(t);
  const target = directory(root, "task");
  const entry = registerCleanupDirectory(target, { role: "task" });
  for (const foreign of [{ role: "task" }, { ...entry }, root, null]) {
    await assert.rejects(cleanupRegisteredDirectories([entry, foreign], { measureBytes }),
      { code: "cleanup_unregistered_entry" });
    assert.ok(fs.existsSync(target));
  }
  await assert.rejects(cleanupRegisteredDirectories([entry, entry], { measureBytes }), { code: "cleanup_duplicate_entry" });
  await assert.rejects(cleanupRegisteredDirectories(new Array(1), { measureBytes }), { code: "cleanup_unregistered_entry" });
  await assert.rejects(cleanupRegisteredDirectories(entry, { measureBytes }), { code: "cleanup_invalid_entries" });
  await assert.rejects(cleanupRegisteredDirectories([entry], {}), { code: "cleanup_invalid_options" });
  assert.ok(fs.existsSync(target));
});

test("overlapping concurrent cleanup calls cannot delete a replacement or consume the same entry", async t => {
  const root = temporary(t);
  const target = directory(root, "task");
  const entry = registerCleanupDirectory(target, { role: "task" });
  let finishMeasurement;
  const running = cleanupRegisteredDirectories([entry], {
    measureBytes: () => new Promise(resolve => { finishMeasurement = resolve; }),
  });
  await assert.rejects(cleanupRegisteredDirectories([entry], { measureBytes }), { code: "cleanup_entry_in_use" });
  replacement(target);
  finishMeasurement(4096);
  assertKept(await running, "cleanup_leaf_identity_changed", target, "before_remove");
});

test("an unrelated directory with a recycled inode and a new birth is not an overlap", async t => {
  const root = temporary(t);
  const first = directory(root, "first"), later = directory(root, "later");
  const original = fs.lstatSync(first, { bigint: true });
  const entry = registerCleanupDirectory(first, { role: "first" });
  assert.equal((await cleanupRegisteredDirectories([entry], { measureBytes })).status, "passed");
  const lstat = fs.lstatSync.bind(fs);
  t.mock.method(fs, "lstatSync", (filename, options) => {
    const stat = lstat(filename, options);
    if (filename !== later || options?.bigint !== true) return stat;
    return Object.assign(Object.create(stat), { dev: original.dev, ino: original.ino,
      birthtimeNs: original.birthtimeNs + 1n });
  });
  assert.doesNotThrow(() => registerCleanupDirectory(later, { role: "later" }));
  directory(root, "first");
  fails(() => registerCleanupDirectory(first, { role: "replaced_first" }), "cleanup_directory_overlap");
});
