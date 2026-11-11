import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const index = await createJiti(import.meta.url).import("./edupi-reflection-index.ts");
const entry = { date: "2026-11-10", slotId: "slot-1", lessonId: "lesson-1", factId: "fact-1" };
const query = { date: entry.date };

function fixture(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reflection-index-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stateDir = path.join(root, "state"), dataRoot = path.join(root, "data");
  fs.mkdirSync(stateDir, { mode: 0o700 });
  fs.mkdirSync(dataRoot, { mode: 0o700 });
  return { stateDir, dataRoot, rootRef: `sha256:${"a".repeat(64)}`,
    ownerId: "owner-1", grantId: "grant-1", classId: "class-1", subject: "数学" };
}

function readback(options, reference = entry) {
  return { status: "ready", external_send: false, entity_id: reference.lessonId,
    occurrence: { entity_id: reference.lessonId, class_id: options.classId, subject: options.subject,
      source_event_date: reference.date, slot_id: reference.slotId },
    completion: { fact_id: reference.factId, raw_text: "不应复制的课堂原文" } };
}

function storedFile(options) {
  const directory = path.join(options.stateDir, "edupi-reflection-index");
  return path.join(directory, fs.readdirSync(directory).find(name => name.endsWith(".json")));
}

const unavailable = error => error?.code === "reflection_index_unavailable";

async function holdLock(context, options, reference) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import fs from "node:fs";
    import { createJiti } from "jiti";
    const index = await createJiti(process.cwd() + "/index-test.mjs").import("./lib/edupi-reflection-index.ts");
    const open = fs.openSync;
    const indexFile = fs.realpathSync(process.argv[4]);
    fs.openSync = function(file, ...args) {
      if (file === indexFile) {
        process.stdout.write("locked\\n");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
      }
      return open.call(this, file, ...args);
    };
    index.appendEduPiReflectionIndex(JSON.parse(process.argv[1]), JSON.parse(process.argv[2]), JSON.parse(process.argv[3]));
  `, JSON.stringify(options), JSON.stringify(reference), JSON.stringify(readback(options, reference)), storedFile(options)],
  { cwd: path.resolve(import.meta.dirname, ".."), stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  context.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }
  });
  const [output] = await Promise.race([
    once(child.stdout, "data", { signal: AbortSignal.timeout(10_000) }),
    once(child, "exit").then(([code]) => { throw new Error(`Lock holder exited ${code}: ${stderr}`); }),
  ]);
  assert.equal(output.toString(), "locked\n");
  return child;
}

function expireLock(lock) {
  const expired = new Date(Date.now() - 10 * 60_000);
  for (const name of fs.readdirSync(lock)) fs.utimesSync(path.join(lock, name), expired, expired);
  fs.utimesSync(lock, expired, expired);
}

test("a crashed lock holder is recovered and the next append preserves committed entries", async context => {
  const options = fixture(context);
  index.appendEduPiReflectionIndex(options, entry, readback(options));
  const second = { ...entry, factId: "fact-2" };
  const child = await holdLock(context, options, second);
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
  const lock = `${storedFile(options)}.lock`;
  assert.throws(() => index.appendEduPiReflectionIndex(options, second, readback(options, second)), unavailable);
  expireLock(lock);
  index.appendEduPiReflectionIndex(options, second, readback(options, second));
  assert.deepEqual(index.readEduPiReflectionIndex(options, query), [entry, second]);
  assert.equal(fs.existsSync(lock), false);
});

test("an expired lock still owned by a live process cannot be reclaimed", async context => {
  const options = fixture(context);
  index.appendEduPiReflectionIndex(options, entry, readback(options));
  const second = { ...entry, factId: "fact-2" };
  await holdLock(context, options, second);
  const lock = `${storedFile(options)}.lock`;
  expireLock(lock);
  assert.throws(() => index.appendEduPiReflectionIndex(options, second, readback(options, second)), unavailable);
  assert.equal(fs.existsSync(lock), true);
  assert.deepEqual(index.readEduPiReflectionIndex(options, query), [entry]);
});

test("an expired empty lock is preserved while its creator might still initialize", context => {
  const options = fixture(context);
  index.appendEduPiReflectionIndex(options, entry, readback(options));
  const lock = `${storedFile(options)}.lock`;
  fs.mkdirSync(lock, { mode: 0o700 });
  expireLock(lock);
  const second = { ...entry, factId: "fact-2" };
  assert.throws(() => index.appendEduPiReflectionIndex(options, second, readback(options, second)), unavailable);
  assert.equal(fs.existsSync(lock), true);
  assert.deepEqual(index.readEduPiReflectionIndex(options, query), [entry]);
});

test("a paused creator retains the only lock when another writer sees an expired empty directory", context => {
  const options = fixture(context);
  index.appendEduPiReflectionIndex(options, entry, readback(options));
  const file = storedFile(options);
  const lock = path.join(fs.realpathSync(path.dirname(file)), `${path.basename(file)}.lock`);
  const first = { ...entry, factId: "fact-2" };
  const second = { ...entry, factId: "fact-3" };
  const mkdir = fs.mkdirSync;
  let interleaved = false;
  fs.mkdirSync = function (target, ...args) {
    const result = mkdir.call(this, target, ...args);
    if (target === lock && !interleaved) {
      interleaved = true;
      expireLock(lock);
      assert.throws(() => index.appendEduPiReflectionIndex(options, second, readback(options, second)), unavailable);
      assert.deepEqual(fs.readdirSync(lock), []);
    }
    return result;
  };
  try { index.appendEduPiReflectionIndex(options, first, readback(options, first)); }
  finally { fs.mkdirSync = mkdir; }
  assert.equal(interleaved, true);
  assert.equal(fs.existsSync(lock), false);
  index.appendEduPiReflectionIndex(options, second, readback(options, second));
  assert.deepEqual(index.readEduPiReflectionIndex(options, query), [entry, first, second]);
});

test("unsafe lock directories and owner files are preserved without following links", context => {
  const options = fixture(context);
  index.appendEduPiReflectionIndex(options, entry, readback(options));
  const lock = `${storedFile(options)}.lock`;
  const second = { ...entry, factId: "fact-2" };
  const owner = "2147483647.12345678-1234-4123-8123-123456789012.owner";
  const outside = path.join(options.stateDir, "outside");
  fs.mkdirSync(outside, { mode: 0o700 });
  fs.symlinkSync(outside, lock);
  assert.throws(() => index.appendEduPiReflectionIndex(options, second, readback(options, second)), unavailable);
  assert.equal(fs.lstatSync(lock).isSymbolicLink(), true);
  fs.unlinkSync(lock);
  fs.mkdirSync(lock, { mode: 0o700 });
  for (const name of ["invalid", "0.12345678-1234-4123-8123-123456789012.owner", owner]) {
    fs.writeFileSync(path.join(lock, name), "invalid", { mode: 0o600 });
    expireLock(lock);
    assert.throws(() => index.appendEduPiReflectionIndex(options, second, readback(options, second)), unavailable);
    assert.equal(fs.readFileSync(path.join(lock, name), "utf8"), "invalid");
    fs.unlinkSync(path.join(lock, name));
  }
  const externalFile = path.join(outside, owner);
  fs.writeFileSync(externalFile, "", { mode: 0o600 });
  fs.symlinkSync(externalFile, path.join(lock, owner));
  expireLock(lock);
  assert.throws(() => index.appendEduPiReflectionIndex(options, second, readback(options, second)), unavailable);
  assert.equal(fs.lstatSync(path.join(lock, owner)).isSymbolicLink(), true);
  fs.unlinkSync(path.join(lock, owner));
  fs.linkSync(externalFile, path.join(lock, owner));
  expireLock(lock);
  assert.throws(() => index.appendEduPiReflectionIndex(options, second, readback(options, second)), unavailable);
  assert.equal(fs.statSync(externalFile).nlink, 2);
  fs.unlinkSync(path.join(lock, owner));
  fs.writeFileSync(path.join(lock, owner), "", { mode: 0o644 });
  expireLock(lock);
  assert.throws(() => index.appendEduPiReflectionIndex(options, second, readback(options, second)), unavailable);
  fs.unlinkSync(path.join(lock, owner));
  fs.chmodSync(lock, 0o755);
  expireLock(lock);
  assert.throws(() => index.appendEduPiReflectionIndex(options, second, readback(options, second)), unavailable);
  assert.deepEqual(index.readEduPiReflectionIndex(options, query), [entry]);
});

test("an inconclusive process probe or replaced lock identity cannot authorize recovery", async context => {
  const options = fixture(context);
  index.appendEduPiReflectionIndex(options, entry, readback(options));
  const second = { ...entry, factId: "fact-2" };
  const child = await holdLock(context, options, second);
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
  const lock = `${storedFile(options)}.lock`;
  expireLock(lock);
  const owner = fs.readdirSync(lock)[0];
  context.mock.method(process, "kill", () => { throw Object.assign(new Error("Permission denied"), { code: "EPERM" }); });
  assert.throws(() => index.appendEduPiReflectionIndex(options, second, readback(options, second)), unavailable);
  assert.deepEqual(fs.readdirSync(lock), [owner]);
  context.mock.restoreAll();
  context.mock.method(process, "kill", () => {
    fs.renameSync(lock, `${lock}-previous`);
    fs.mkdirSync(lock, { mode: 0o700 });
    fs.writeFileSync(path.join(lock, owner), "", { mode: 0o600 });
    throw Object.assign(new Error("No process"), { code: "ESRCH" });
  });
  assert.throws(() => index.appendEduPiReflectionIndex(options, second, readback(options, second)), unavailable);
  assert.deepEqual(fs.readdirSync(lock), [owner]);
  assert.deepEqual(fs.readdirSync(`${lock}-previous`), [owner]);
  assert.deepEqual(index.readEduPiReflectionIndex(options, query), [entry]);
});

test("index persists references only, reads fresh, deduplicates captures and filters lessons", context => {
  const options = fixture(context);
  assert.deepEqual(index.readEduPiReflectionIndex(options, query), []);
  assert.equal(fs.existsSync(path.join(options.stateDir, "edupi-reflection-index")), false);
  index.appendEduPiReflectionIndex(options, entry, readback(options));
  index.appendEduPiReflectionIndex(options, entry, readback(options));
  const second = { ...entry, lessonId: "lesson-2", slotId: "slot-2", factId: "fact-2" };
  index.appendEduPiReflectionIndex(options, second, readback(options, second));
  assert.deepEqual(index.readEduPiReflectionIndex(options, query), [entry, second]);
  assert.deepEqual(index.readEduPiReflectionIndex(options, { ...query, slotId: "slot-1", lessonId: "lesson-1" }), [entry]);
  assert.deepEqual(index.readEduPiReflectionIndex(options, { date: "2026-11-11" }), []);
  const file = storedFile(options);
  const stored = fs.readFileSync(file, "utf8");
  assert.equal(stored.includes("不应复制的课堂原文"), false);
  assert.equal(stored.includes(options.dataRoot), false);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
  assert.equal(fs.readdirSync(path.dirname(file)).length, 1);
});

test("owner, grant, fingerprint, class, subject and roots independently isolate references", context => {
  const options = fixture(context);
  index.appendEduPiReflectionIndex(options, entry, readback(options));
  for (const change of [
    { ownerId: "owner-2" }, { grantId: "grant-2" }, { rootRef: `sha256:${"b".repeat(64)}` },
    { classId: "class-2" }, { subject: "英语" },
    { dataRoot: fixture(context).dataRoot }, { stateDir: fixture(context).stateDir },
  ]) assert.deepEqual(index.readEduPiReflectionIndex({ ...options, ...change }, query), []);
});

test("capture requires matching authoritative readback and rejects unverified or foreign facts", context => {
  const options = fixture(context);
  for (const change of [
    value => { value.status = "committed_unverified"; },
    value => { value.external_send = true; },
    value => { value.entity_id = "lesson-other"; },
    value => { value.occurrence.entity_id = "lesson-other"; },
    value => { value.occurrence.class_id = "class-other"; },
    value => { value.occurrence.subject = "英语"; },
    value => { value.occurrence.source_event_date = "2026-11-11"; },
    value => { value.occurrence.slot_id = "slot-other"; },
    value => { value.completion.fact_id = "fact-other"; },
  ]) {
    const value = readback(options);
    change(value);
    assert.throws(() => index.appendEduPiReflectionIndex(options, entry, value), unavailable);
  }
  assert.deepEqual(index.readEduPiReflectionIndex(options, query), []);
});

test("corrupt, excessive, extra-field and conflicting stored entries fail closed without overwrite", context => {
  const options = fixture(context);
  index.appendEduPiReflectionIndex(options, entry, readback(options));
  const file = storedFile(options), original = fs.readFileSync(file, "utf8");
  for (const invalid of [
    "{broken", " ".repeat(1_048_577),
    JSON.stringify({ ...JSON.parse(original), rawText: "unexpected" }),
    JSON.stringify({ ...JSON.parse(original), entries: [{ ...entry, rawText: "unexpected" }] }),
    JSON.stringify({ ...JSON.parse(original), entries: [entry, entry] }),
    JSON.stringify({ ...JSON.parse(original), entries: [{ ...entry, date: "2026-02-30" }] }),
  ]) {
    fs.writeFileSync(file, invalid);
    assert.throws(() => index.readEduPiReflectionIndex(options, query), unavailable);
    assert.throws(() => index.appendEduPiReflectionIndex(options, entry, readback(options)), unavailable);
    assert.equal(fs.readFileSync(file, "utf8"), invalid);
  }
});

test("unsafe state, index directory, file modes, symlinks and hardlinks fail closed", context => {
  const options = fixture(context);
  index.appendEduPiReflectionIndex(options, entry, readback(options));
  const file = storedFile(options);
  fs.chmodSync(file, 0o644);
  assert.throws(() => index.readEduPiReflectionIndex(options, query), unavailable);
  fs.chmodSync(file, 0o600);
  const linked = `${file}.link`;
  fs.linkSync(file, linked);
  assert.throws(() => index.appendEduPiReflectionIndex(options, entry, readback(options)), unavailable);
  fs.unlinkSync(linked);
  fs.renameSync(file, linked);
  fs.symlinkSync(linked, file);
  assert.throws(() => index.readEduPiReflectionIndex(options, query), unavailable);
  fs.unlinkSync(file);
  fs.renameSync(linked, file);
  const directory = path.dirname(file);
  fs.chmodSync(directory, 0o755);
  assert.throws(() => index.readEduPiReflectionIndex(options, query), unavailable);
  fs.chmodSync(directory, 0o700);
  fs.renameSync(directory, `${directory}-real`);
  fs.symlinkSync(`${directory}-real`, directory);
  assert.throws(() => index.readEduPiReflectionIndex(options, query), unavailable);
  const linkedState = `${options.stateDir}-linked`;
  fs.symlinkSync(options.stateDir, linkedState);
  assert.throws(() => index.readEduPiReflectionIndex({ ...options, stateDir: linkedState }, query), unavailable);
  fs.chmodSync(options.stateDir, 0o777);
  assert.throws(() => index.readEduPiReflectionIndex(options, query), unavailable);
});

test("invalid arguments and reused fact IDs cannot create ambiguous references", context => {
  const options = fixture(context);
  for (const reference of [
    { ...entry, date: "2026-02-30" }, { ...entry, factId: "../bad" },
    { ...entry, slotId: "" }, { ...entry, rawText: "extra text" },
  ]) assert.throws(() => index.appendEduPiReflectionIndex(options, reference, readback(options, reference)), unavailable);
  index.appendEduPiReflectionIndex(options, entry, readback(options));
  const conflict = { ...entry, slotId: "slot-2", lessonId: "lesson-2" };
  assert.throws(() => index.appendEduPiReflectionIndex(options, conflict, readback(options, conflict)), unavailable);
  assert.throws(() => index.readEduPiReflectionIndex(options, { date: "2026-02-30" }), unavailable);
  assert.deepEqual(index.readEduPiReflectionIndex(options, query), [entry]);
});

test("a fresh process reads committed references and lock contention cannot lose writes", context => {
  const options = fixture(context);
  index.appendEduPiReflectionIndex(options, entry, readback(options));
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", `
    import { createJiti } from "jiti";
    const index = await createJiti(process.cwd() + "/index-test.mjs").import("./lib/edupi-reflection-index.ts");
    process.stdout.write(JSON.stringify(index.readEduPiReflectionIndex(JSON.parse(process.argv[1]), JSON.parse(process.argv[2]))));
  `, JSON.stringify(options), JSON.stringify(query)], { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8" });
  assert.deepEqual(JSON.parse(output), [entry]);
  const file = storedFile(options), lock = `${file}.lock`;
  fs.mkdirSync(lock, { mode: 0o700 });
  const second = { ...entry, factId: "fact-2" };
  assert.throws(() => index.appendEduPiReflectionIndex(options, second, readback(options, second)), unavailable);
  assert.equal(fs.existsSync(lock), true);
  assert.deepEqual(index.readEduPiReflectionIndex(options, query), [entry]);
  fs.rmdirSync(lock);
  index.appendEduPiReflectionIndex(options, second, readback(options, second));
  assert.deepEqual(index.readEduPiReflectionIndex(options, query), [entry, second]);
});

test("capacity is bounded and copied scope partitions cannot reveal references", context => {
  const options = fixture(context);
  index.appendEduPiReflectionIndex(options, entry, readback(options));
  const file = storedFile(options), original = JSON.parse(fs.readFileSync(file, "utf8"));
  const other = { ...options, grantId: "other-grant" };
  index.appendEduPiReflectionIndex(other, entry, readback(other));
  const otherFile = fs.readdirSync(path.dirname(file)).find(name => name.endsWith(".json") && name !== path.basename(file));
  fs.copyFileSync(file, path.join(path.dirname(file), otherFile));
  assert.throws(() => index.readEduPiReflectionIndex(other, query), unavailable);
  const entries = Array.from({ length: 2000 }, (_, position) => ({ ...entry, factId: `fact-${position}` }));
  fs.writeFileSync(file, JSON.stringify({ ...original, entries }));
  const over = { ...entry, factId: "fact-over-capacity" };
  assert.throws(() => index.appendEduPiReflectionIndex(options, over, readback(options, over)), unavailable);
  assert.equal(index.readEduPiReflectionIndex(options, query).length, 2000);
  fs.writeFileSync(file, JSON.stringify({ ...original, entries: [...entries, over] }));
  assert.throws(() => index.readEduPiReflectionIndex(options, query), unavailable);
});
