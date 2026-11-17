import fs from "node:fs";
import path from "node:path";

// Entries are capabilities for this process, not serializable cleanup requests.
// Importing this module performs no filesystem operations.
const registrations = new Map();
const nativeParents = new Set(["Application Support", "Logs", "Caches", "WebKit", "HTTPStorages"]);
const safeErrnos = new Set(["EACCES", "EBUSY", "EEXIST", "EINTR", "EINVAL", "EIO", "EISDIR",
  "ELOOP", "EMFILE", "ENAMETOOLONG", "ENFILE", "ENOENT", "ENOMEM", "ENOSPC", "ENOTDIR",
  "ENOTEMPTY", "ENOTSUP", "EPERM", "EROFS", "ETIMEDOUT", "EXDEV"]);

function errno(error) {
  return safeErrnos.has(error?.code) ? error.code : "UNKNOWN";
}

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function identity(stat, canonical = null) {
  return Object.freeze({
    type: stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other",
    canonical,
    noSymlink: !stat.isSymbolicLink(),
    dev: String(stat.dev),
    ino: String(stat.ino),
    birthtimeNs: String(stat.birthtimeNs),
    owner: Object.freeze({ uid: String(stat.uid), gid: String(stat.gid) }),
    mode: (stat.mode & 0o7777n).toString(8).padStart(4, "0"),
  });
}

function observe(directory, scope) {
  let stat;
  try {
    stat = fs.lstatSync(directory, { bigint: true });
  } catch (error) {
    return { identity: null, code: `cleanup_${scope}_${error.code === "ENOENT" ? "missing" : "inspect_failed"}`,
      errno: errno(error) };
  }
  if (stat.isSymbolicLink())
    return { identity: identity(stat), code: `cleanup_${scope}_symlink`, errno: null };
  if (!stat.isDirectory())
    return { identity: identity(stat), code: `cleanup_${scope}_not_directory`, errno: null };
  try {
    const canonical = fs.realpathSync(directory) === directory;
    return { identity: identity(stat, canonical),
      code: canonical ? null : `cleanup_${scope}_not_canonical`, errno: null };
  } catch (error) {
    // Only lstat ENOENT above can establish an absent native-profile leaf.
    return { identity: identity(stat), code: `cleanup_${scope}_inspect_failed`, errno: errno(error) };
  }
}

function changed(expected, current, scope) {
  if (expected.dev !== current.dev || expected.ino !== current.ino || expected.birthtimeNs !== current.birthtimeNs)
    return `cleanup_${scope}_identity_changed`;
  if (expected.owner.uid !== current.owner.uid || expected.owner.gid !== current.owner.gid)
    return `cleanup_${scope}_owner_changed`;
  return expected.mode === current.mode ? null : `cleanup_${scope}_mode_changed`;
}

function verify(record) {
  const parents = [];
  for (const [index, parent] of record.parents.entries()) {
    const current = observe(parent.directory, "parent");
    parents.push(current.identity);
    const code = current.code || changed(parent.identity, current.identity, "parent");
    if (code) return { code, errno: current.errno, scope: "parent", parentIndex: index,
      current: Object.freeze({ parents: Object.freeze(parents), leaf: null }) };
  }
  const leaf = observe(record.directory, "leaf");
  return { code: leaf.code || changed(record.leaf, leaf.identity, "leaf"), errno: leaf.errno,
    scope: "leaf", current: Object.freeze({ parents: Object.freeze(parents), leaf: leaf.identity }) };
}

function sameInode(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.birthtimeNs === right.birthtimeNs;
}

function overlaps(left, right) {
  return left.directory === right.directory || left.directory.startsWith(`${right.directory}${path.sep}`)
    || right.directory.startsWith(`${left.directory}${path.sep}`)
    || sameInode(left.leaf, right.leaf)
    || left.parents.some(parent => sameInode(parent.identity, right.leaf))
    || right.parents.some(parent => sameInode(parent.identity, left.leaf));
}

function isNativeProfile(directory) {
  const category = path.dirname(directory);
  if (path.basename(path.dirname(category)) !== "Library") return false;
  return nativeParents.has(path.basename(category)) && path.basename(directory) === "com.abcwyc.pi-agent"
    || path.basename(category) === "Saved Application State"
      && path.basename(directory) === "com.abcwyc.pi-agent.savedState";
}

/**
 * Register a newly created, task-owned directory before handing it to the App.
 * The caller establishes freshness/ownership; this helper never discovers paths.
 * Returns an opaque, frozen entry. Paths and the original full ancestry stay private.
 * Registration errors expose fixed codes only.
 */
export function registerCleanupDirectory(directory, { role, nativeProfile = false } = {}) {
  if (typeof role !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/u.test(role))
    throw failure("cleanup_invalid_role");
  if (typeof directory !== "string" || !path.isAbsolute(directory) || path.normalize(directory) !== directory
    || path.resolve(directory) !== directory || path.dirname(directory) === directory || directory.includes("\0"))
    throw failure("cleanup_invalid_directory");
  if (typeof nativeProfile !== "boolean") throw failure("cleanup_invalid_native_profile");
  if (nativeProfile && !isNativeProfile(directory)) throw failure("cleanup_native_profile_path_not_allowed");
  const chain = [];
  for (let parent = path.dirname(directory); ; parent = path.dirname(parent)) {
    chain.unshift(parent);
    if (path.dirname(parent) === parent) break;
  }
  const parents = chain.map(parent => ({ directory: parent }));
  for (const parent of parents) {
    const observed = observe(parent.directory, "parent");
    if (observed.code) throw failure(observed.code);
    parent.identity = observed.identity;
  }
  const leaf = observe(directory, "leaf");
  if (leaf.code) throw failure(leaf.code);
  const record = { directory, role, nativeProfile, parents, leaf: leaf.identity, cleaning: false };
  // A second full check prevents adopting changes made while capturing ancestry.
  const checked = verify(record);
  if (checked.code) throw failure(checked.code);
  for (const existing of registrations.values()) {
    if (overlaps(record, existing)) throw failure("cleanup_directory_overlap");
  }
  record.expected = Object.freeze({ parents: Object.freeze(parents.map(parent => parent.identity)), leaf: record.leaf });
  const entry = Object.freeze({ role });
  registrations.set(entry, record);
  return entry;
}

function result(record, phase, checked, status, code, allocatedBytes = 0, errorNumber = checked.errno) {
  return Object.freeze({
    role: record.role, phase, status, code, expected: record.expected, current: checked.current,
    scope: checked.scope, ...(checked.parentIndex === undefined ? {} : { parentIndex: checked.parentIndex }),
    allocatedBytes, errno: errorNumber,
  });
}

function absent(record, checked) {
  return record.nativeProfile && checked.code === "cleanup_leaf_missing" && checked.errno === "ENOENT";
}

async function cleanupOne(record, measureBytes, removedAllocatedBytes) {
  let phase = "before_measure";
  let checked = verify(record);
  if (absent(record, checked))
    return result(record, phase, checked, "already_absent", "cleanup_native_profile_already_absent");
  if (checked.code) return result(record, phase, checked, "failed", checked.code);
  phase = "measure";
  let bytes;
  try {
    bytes = await measureBytes(record.directory);
  } catch (error) {
    return result(record, phase, checked, "failed", "cleanup_measure_failed", 0, errno(error));
  }
  if (!Number.isSafeInteger(bytes) || bytes < 0)
    return result(record, phase, checked, "failed", "cleanup_invalid_measurement");
  if (!Number.isSafeInteger(removedAllocatedBytes + bytes))
    return result(record, phase, checked, "failed", "cleanup_allocated_bytes_overflow");
  phase = "before_remove";
  checked = verify(record);
  if (absent(record, checked))
    return result(record, phase, checked, "already_absent", "cleanup_native_profile_already_absent");
  if (checked.code) return result(record, phase, checked, "failed", checked.code);
  // No await, progress callback, retry, force, or baseline update between this
  // full synchronous validation and rmSync. External OS races are not atomic.
  try {
    fs.rmSync(record.directory, { recursive: true, force: false, maxRetries: 0 });
  } catch (error) {
    return result(record, "remove", checked, "failed", "cleanup_remove_failed", 0, errno(error));
  }
  checked = verify(record);
  if (checked.code === "cleanup_leaf_missing" && checked.errno === "ENOENT")
    return result(record, "after_remove", checked, "removed", "cleanup_removed", bytes, null);
  return result(record, "after_remove", checked, "failed", checked.code || "cleanup_directory_still_present");
}

/**
 * Call only after the caller proves App/helpers stopped and the DMG unmounted.
 * measureBytes(directory) returns a nonnegative safe integer of allocated bytes.
 * onProgress receives an immutable cumulative report after every settled entry;
 * its errors are recorded without interrupting the other independent entries.
 * Reports contain no paths, exception messages, argv, env, or file contents.
 * Any failed entry/progress delivery makes status "failed"; successful removals
 * alone contribute to removedAllocatedBytes. already_absent records no deletion.
 */
export async function cleanupRegisteredDirectories(entries, { measureBytes, onProgress } = {}) {
  if (!Array.isArray(entries)) throw failure("cleanup_invalid_entries");
  if (typeof measureBytes !== "function" || onProgress !== undefined && typeof onProgress !== "function")
    throw failure("cleanup_invalid_options");
  const records = Array.from(entries, entry => {
    const record = registrations.get(entry);
    if (!record) throw failure("cleanup_unregistered_entry");
    return record;
  });
  if (new Set(records).size !== records.length) throw failure("cleanup_duplicate_entry");
  if (records.some(record => record.cleaning)) throw failure("cleanup_entry_in_use");
  const results = [];
  const progressFailures = [];
  let removedAllocatedBytes = 0;
  const report = () => Object.freeze({
    status: results.some(item => item.status === "failed") || progressFailures.length ? "failed"
      : results.length < records.length ? "in_progress" : "passed",
    results: Object.freeze([...results]), removedAllocatedBytes,
    progressFailures: Object.freeze([...progressFailures]),
  });
  for (const record of records) record.cleaning = true;
  try {
    for (const record of records) {
      const item = await cleanupOne(record, measureBytes, removedAllocatedBytes);
      results.push(item);
      removedAllocatedBytes += item.allocatedBytes;
      if (onProgress) {
        try { await onProgress(report()); }
        catch (error) {
          progressFailures.push(Object.freeze({ role: record.role, phase: "progress",
            code: "cleanup_progress_failed", errno: errno(error) }));
        }
      }
    }
    return report();
  } finally {
    for (const record of records) record.cleaning = false;
  }
}
