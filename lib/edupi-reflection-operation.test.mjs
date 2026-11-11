import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const operations = await createJiti(import.meta.url).import("./edupi-reflection-operation.ts");
const mutation = { action: "register", date: "2026-11-10", classId: "class-1", subject: "math" };
const success = { status: 200, body: { ok: true, readbackConfirmed: true, value: "synthetic" } };

function fixture(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reflection-operation-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stateDir = path.join(root, "state"), dataRoot = path.join(root, "data");
  fs.mkdirSync(stateDir, { mode: 0o700 }); fs.mkdirSync(dataRoot, { mode: 0o700 });
  return { stateDir, dataRoot, rootRef: `sha256:${"a".repeat(64)}`,
    ownerId: "owner-1", grantId: "grant-1", classId: "class-1", subject: "math" };
}

function files(scope) {
  const root = path.join(scope.stateDir, "edupi-reflection-operations");
  const scoped = path.join(root, fs.readdirSync(root)[0]);
  return { root: scoped, record: path.join(scoped, fs.readdirSync(scoped).find(name => name.endsWith(".json"))) };
}

test("preflight binds exact action and scope before allowing one mutation", async context => {
  const scope = fixture(context), id = randomUUID();
  const prepared = await operations.prepareReflectionOperation(scope, id, mutation);
  assert.equal(prepared.status, "prepared");
  assert.deepEqual(await operations.prepareReflectionOperation(scope, id, { subject: "math", classId: "class-1", date: "2026-11-10", action: "register" }), prepared);
  await assert.rejects(operations.prepareReflectionOperation(scope, id, { ...mutation, action: "capture" }), { code: "operation_mismatch" });
  await assert.rejects(operations.runReflectionOperation(scope, id, prepared.fingerprint, { ...mutation, date: "2026-11-11" }, () => success),
    { code: "operation_mismatch" });
  let writes = 0;
  const execute = async dispatch => { dispatch(); writes += 1; return success; };
  const first = await operations.runReflectionOperation(scope, id, prepared.fingerprint, mutation, execute);
  assert.equal(first.operation.status, "committed");
  assert.deepEqual(await operations.runReflectionOperation(scope, id, prepared.fingerprint, mutation, execute), first);
  assert.deepEqual(await operations.resolveReflectionOperation(scope, id, prepared.fingerprint), first);
  assert.equal(writes, 1);
});

test("resolve before POST atomically fences late POST forever", async context => {
  const scope = fixture(context), id = randomUUID();
  const prepared = await operations.prepareReflectionOperation(scope, id, mutation);
  const resolved = await operations.resolveReflectionOperation(scope, id, prepared.fingerprint);
  assert.equal(resolved.operation.status, "not_committed"); assert.equal(resolved.operation.terminal, true);
  const late = await operations.runReflectionOperation(scope, id, prepared.fingerprint, mutation, async () => { assert.fail("late write"); });
  assert.deepEqual(late, resolved);
});

test("missing preflight and unknown identities cannot become absence claims", async context => {
  const scope = fixture(context), id = randomUUID(), fingerprint = `sha256:${"b".repeat(64)}`;
  await assert.rejects(operations.resolveReflectionOperation(scope, id, fingerprint), { code: "operation_not_prepared" });
  await assert.rejects(operations.runReflectionOperation(scope, id, fingerprint, mutation, async () => success), { code: "operation_not_prepared" });
});

test("dispatched failures remain unknown while validation failures fence unstarted writes", async context => {
  const scope = fixture(context);
  for (const dispatched of [false, true]) {
    const id = randomUUID(), prepared = await operations.prepareReflectionOperation(scope, id, mutation);
    await operations.runReflectionOperation(scope, id, prepared.fingerprint, mutation, async dispatch => {
      if (dispatched) dispatch();
      throw new Error("synthetic transport loss");
    });
    const resolved = await operations.resolveReflectionOperation(scope, id, prepared.fingerprint);
    assert.equal(resolved.operation.status, dispatched ? "unknown" : "not_committed");
    assert.equal(resolved.operation.terminal, !dispatched);
  }
});

test("a validated authoritative refusal is terminal without replaying a dispatched operation", async context => {
  const scope = fixture(context), id = randomUUID(), prepared = await operations.prepareReflectionOperation(scope, id, mutation);
  const response = { status: 409, noCommitConfirmed: true, body: { ok: false, readbackConfirmed: false,
    result: { status: "held", reason_code: "source_changed", entity_id: null, occurrence: null, external_send: false } } };
  const outcome = await operations.runReflectionOperation(scope, id, prepared.fingerprint, mutation, async dispatch => { dispatch(); return response; });
  assert.equal(outcome.operation.status, "not_committed"); assert.equal(outcome.operation.terminal, true);
  assert.deepEqual(await operations.resolveReflectionOperation(scope, id, prepared.fingerprint), outcome);
  assert.deepEqual(await operations.runReflectionOperation(scope, id, prepared.fingerprint, mutation, async () => assert.fail("refused operation replayed")), outcome);
});

test("same-process concurrent resolve is busy until the writer settles", async context => {
  const scope = fixture(context), id = randomUUID(), prepared = await operations.prepareReflectionOperation(scope, id, mutation);
  let settle;
  const pending = operations.runReflectionOperation(scope, id, prepared.fingerprint, mutation, async dispatch => {
    dispatch();
    return new Promise(resolve => { settle = resolve; });
  });
  await assert.rejects(operations.resolveReflectionOperation(scope, id, prepared.fingerprint), { code: "reflection_operation_busy" });
  settle(success);
  await pending;
  assert.equal((await operations.resolveReflectionOperation(scope, id, prepared.fingerprint)).operation.status, "committed");
});

async function holder(context, scope, id, fingerprint, dispatched) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import { createJiti } from "jiti";
    const operations = await createJiti(process.cwd() + "/operation-child.mjs").import("./lib/edupi-reflection-operation.ts");
    await operations.runReflectionOperation(JSON.parse(process.argv[1]), process.argv[2], process.argv[3], JSON.parse(process.argv[4]), async dispatch => {
      if (process.argv[5] === "true") dispatch();
      process.stdout.write("locked\\n");
      await new Promise(() => { setInterval(() => {}, 1000); });
    });
  `, JSON.stringify(scope), id, fingerprint, JSON.stringify(mutation), String(dispatched)],
  { cwd: path.resolve(import.meta.dirname, ".."), stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  context.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
    }
  });
  const [output] = await Promise.race([
    once(child.stdout, "data", { signal: AbortSignal.timeout(15_000) }),
    once(child, "exit").then(([code]) => { throw new Error(`Holder exited ${code}: ${stderr}`); }),
  ]);
  assert.equal(output.toString(), "locked\n");
  return child;
}

test("cross-process locking survives a dead writer and never infers absence after dispatch", async context => {
  const scope = fixture(context);
  for (const dispatched of [false, true]) {
    const id = randomUUID(), prepared = await operations.prepareReflectionOperation(scope, id, mutation);
    const child = await holder(context, scope, id, prepared.fingerprint, dispatched);
    await assert.rejects(operations.resolveReflectionOperation(scope, id, prepared.fingerprint), { code: "reflection_operation_busy" });
    const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
    const recovered = await operations.resolveReflectionOperation(scope, id, prepared.fingerprint);
    assert.equal(recovered.operation.status, dispatched ? "unknown" : "not_committed");
    assert.equal(recovered.operation.terminal, !dispatched);
    await operations.runReflectionOperation(scope, id, prepared.fingerprint, mutation, async () => assert.fail("replayed dead writer"));
  }
});

test("corrupt, symlink and writable receipts fail closed", async context => {
  for (const mode of ["corrupt", "symlink", "writable"]) {
    const scope = fixture(context), id = randomUUID(), prepared = await operations.prepareReflectionOperation(scope, id, mutation);
    const { record } = files(scope);
    if (mode === "corrupt") fs.writeFileSync(record, "{}");
    if (mode === "writable") fs.chmodSync(record, 0o666);
    if (mode === "symlink") {
      fs.renameSync(record, `${record}.original`);
      fs.symlinkSync(`${record}.original`, record);
    }
    await assert.rejects(operations.resolveReflectionOperation(scope, id, prepared.fingerprint), { code: "reflection_operation_unavailable" });
  }
});

test("capacity refuses new operations without deleting delayed-POST fences", async context => {
  const scope = fixture(context), id = randomUUID(), prepared = await operations.prepareReflectionOperation(scope, id, mutation);
  await operations.resolveReflectionOperation(scope, id, prepared.fingerprint);
  const { root } = files(scope);
  for (let index = 0; index < 1024; index++) fs.writeFileSync(path.join(root, `${index}.capacity`), "");
  await assert.rejects(operations.prepareReflectionOperation(scope, randomUUID(), mutation), { code: "reflection_operation_capacity" });
  assert.equal((await operations.resolveReflectionOperation(scope, id, prepared.fingerprint)).operation.status, "not_committed");
});

test("a completed lock released to an empty directory is atomically recoverable", async context => {
  const scope = fixture(context), id = randomUUID(), prepared = await operations.prepareReflectionOperation(scope, id, mutation);
  const { root } = files(scope), lockPath = path.join(root, "writer.lock");
  fs.mkdirSync(lockPath, { mode: 0o700 });
  const original = fs.statSync(lockPath);
  const outcome = await operations.resolveReflectionOperation(scope, id, prepared.fingerprint);
  assert.equal(outcome.operation.status, "not_committed");
  assert.equal(fs.existsSync(lockPath), false);
  assert.ok(original.ino);
});

test("SIGKILL in the empty-lock release window preserves the committed receipt", async context => {
  const scope = fixture(context), id = randomUUID(), prepared = await operations.prepareReflectionOperation(scope, id, mutation);
  const { root } = files(scope);
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import fs from "node:fs";
    import { createJiti } from "jiti";
    const operations = await createJiti(process.cwd() + "/operation-release-child.mjs").import("./lib/edupi-reflection-operation.ts");
    const original = fs.rmdirSync;
    fs.rmdirSync = function(input, ...args) {
      if (input === process.argv[5]) {
        process.stdout.write("empty-lock\\n");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
      }
      return original.call(this, input, ...args);
    };
    await operations.runReflectionOperation(JSON.parse(process.argv[1]), process.argv[2], process.argv[3], JSON.parse(process.argv[4]), async dispatch => {
      dispatch(); return { status: 200, body: { ok: true, readbackConfirmed: true } };
    });
  `, JSON.stringify(scope), id, prepared.fingerprint, JSON.stringify(mutation), path.join(fs.realpathSync(root), "writer.lock")],
  { cwd: path.resolve(import.meta.dirname, ".."), stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  context.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
    }
  });
  const [output] = await Promise.race([
    once(child.stdout, "data", { signal: AbortSignal.timeout(15_000) }),
    once(child, "exit").then(([code]) => { throw new Error(`Release holder exited ${code}: ${stderr}`); }),
  ]);
  assert.equal(output.toString(), "empty-lock\n");
  const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
  assert.deepEqual(fs.readdirSync(path.join(root, "writer.lock")), []);
  const recovered = await operations.resolveReflectionOperation(scope, id, prepared.fingerprint);
  assert.equal(recovered.operation.status, "committed");
  assert.equal(recovered.operation.terminal, true);
  assert.equal(fs.existsSync(path.join(root, "writer.lock")), false);
});

test("a verified recovery persists before returning and inconclusive recovery never fences absence", async context => {
  const scope = fixture(context), id = randomUUID(), prepared = await operations.prepareReflectionOperation(scope, id, mutation);
  await operations.runReflectionOperation(scope, id, prepared.fingerprint, mutation, async dispatch => { dispatch(); throw new Error("lost"); });
  for (const reconcile of [
    async () => null,
    async () => { throw new Error("Core unavailable"); },
    async () => ({ status: 200, body: { readbackConfirmed: true, ok: false } }),
  ]) {
    const result = await operations.resolveReflectionOperation(scope, id, prepared.fingerprint, reconcile);
    assert.equal(result.operation.status, "unknown");
    assert.equal(result.operation.terminal, false);
  }
  const confirmed = await operations.resolveReflectionOperation(scope, id, prepared.fingerprint, async storedMutation => {
    assert.deepEqual(storedMutation, mutation);
    return success;
  });
  assert.equal(confirmed.operation.status, "committed");
  assert.deepEqual(await operations.resolveReflectionOperation(scope, id, prepared.fingerprint), confirmed);
});
