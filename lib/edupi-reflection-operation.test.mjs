import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const operations = await createJiti(import.meta.url).import("./edupi-reflection-operation.ts");
const mutation = { action: "register", date: "2026-11-10", classId: "class-1", subject: "math" };
const success = { status: 200, body: { ok: true, readbackConfirmed: true, value: "synthetic" } };
const execFileAsync = promisify(execFile);
const receiptLimit = 512 * 1024;

// Match the handler's contentCapture response, including its repeated occurrence,
// raw_text/value, entry projection, and separately persisted request mutation.
function largeContent(rawText, escapedSources = false, sourceCount = 128) {
  const hash = `sha256:${"b".repeat(64)}`;
  const idText = "i".repeat(160);
  const metadataText = escapedSources ? "\ud800".repeat(160) : idText;
  const sourceIds = Array.from({ length: sourceCount }, (_, index) =>
    `${String(index).padStart(3, "0")}${(escapedSources ? "\ud800" : "中").repeat(157)}`);
  const prefix = `lesson-content:${createHash("sha256")
    .update(JSON.stringify([mutation.classId, mutation.subject, idText])).digest("hex").slice(0, 24)}:`;
  const sourceId = `${prefix}${createHash("sha256").update(JSON.stringify(["lesson.observation", rawText])).digest("hex")}`;
  const operationMutation = { ...mutation, action: "contentCapture", slotId: metadataText,
    expectedSourceBasisHash: hash, expectedGrantVersion: 1, sourceId, sourceRevision: metadataText,
    predicate: "lesson.observation", rawText };
  const occurrence = { namespace: "edupi-timetable-occurrence-v1", entity_id: idText,
    class_id: mutation.classId, subject: mutation.subject, source_event_date: mutation.date,
    slot_id: metadataText, slot_revision: 1, slot_content_hash: hash, source_basis_hash: hash,
    lesson_at: "2026-11-10T10:00:00.000Z", external_id: metadataText, task_id: metadataText, term_id: metadataText,
    time_zone: (escapedSources ? "\ud800" : "中").repeat(100), source_ids: sourceIds };
  const content = { fact_id: idText, revision: 0, status: "pending_review", source_id: sourceId,
    source_revision: metadataText, observation_id: idText, raw_text: rawText,
    predicate: operationMutation.predicate, value: rawText.normalize("NFKC").replace(/\s+/gu, " ").trim(),
    source_basis_hash: hash };
  const readback = { status: "ready", reason_code: null, entity_id: idText, occurrence,
    content, grant_version: 1, external_send: false };
  // Distinct content sources share the handler's fixed prefix and 64 hex suffix.
  const contentSourceIds = Array.from({ length: sourceCount }, (_, index) =>
    index === 0 ? sourceId : `${prefix}${index.toString(16).padStart(64, "0")}`);
  const response = { status: 200, body: { ok: true, readbackConfirmed: true, externalSend: false,
    result: { ...readback, status: "recorded", replayed: false }, readback,
    entry: { classId: mutation.classId, subject: mutation.subject, date: mutation.date,
      slotId: metadataText, lessonId: idText, lessonAt: occurrence.lesson_at, registrationStatus: "registered",
      status: "ready", reasonCode: null, sourceBasisHash: hash, grantVersion: 1,
      completionSourceIds: [], contentSourceIds, completion: null,
      content: { factId: idText, revision: 0, status: content.status, predicate: content.predicate,
        rawText, sourceBasisHash: hash, sourceId, sourceRevision: metadataText } } } };
  return { operationMutation, response };
}

async function coldReplay(scope, id, fingerprint, recover = false) {
  const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import fs from "node:fs";
    import path from "node:path";
    import { createJiti } from "jiti";
    const operations = await createJiti(process.cwd() + "/cold-operation.mjs").import("./lib/edupi-reflection-operation.ts");
    const scope = JSON.parse(process.argv[1]), id = process.argv[2], fingerprint = process.argv[3];
    const core = JSON.parse(fs.readFileSync(path.join(scope.dataRoot, "synthetic-core.json"), "utf8"));
    const resolved = await operations.resolveReflectionOperation(scope, id, fingerprint, async mutation => {
      assert.equal(process.argv[4], "true", "terminal receipt must use its cache");
      assert.deepEqual(mutation, core.mutation);
      return core.response;
    });
    const replayed = await operations.runReflectionOperation(scope, id, fingerprint, core.mutation,
      async () => assert.fail("cold replay must not write Core again"));
    assert.deepEqual(replayed, resolved);
    process.stdout.write(JSON.stringify(resolved));
  `, JSON.stringify(scope), id, fingerprint, String(recover)],
  { cwd: path.resolve(import.meta.dirname, ".."), maxBuffer: 1024 * 1024, timeout: 20_000 });
  return JSON.parse(stdout);
}

for (const [name, rawText, escapedSources, sourceCount] of [
  ["4000 Chinese characters with one source", "中".repeat(4000), false, 1],
  ["4000 Chinese characters with maximum source arrays", "中".repeat(4000), false, 128],
  ["4000 UTF-16 units near the HTTP byte limit", "\ud800".repeat(1800) + "中".repeat(2200), true],
  ["NFKC expansion to 3996 characters", "\ufdfa".repeat(222), true],
]) {
  for (const recover of [false, "response-loss", "persist-loss"]) {
    test(`large durable content: ${name}, ${recover || "cold cached replay"}`, async context => {
      const scope = fixture(context), id = randomUUID();
      const { operationMutation, response } = largeContent(rawText, escapedSources, sourceCount);
      assert.ok(rawText.length <= 4000);
      assert.ok(response.body.readback.content.value.length <= 4000);
      const prepared = await operations.prepareReflectionOperation(scope, id, operationMutation);
      const requestBytes = Buffer.byteLength(JSON.stringify({ ...operationMutation,
        operationId: id, operationFingerprint: prepared.fingerprint }));
      assert.ok(requestBytes <= 20_000, `HTTP envelope is ${requestBytes} bytes`);
      let writes = 0;
      const originalRename = fs.renameSync;
      try {
        fs.renameSync = function(from, to) {
          if (recover === "persist-loss" && String(from).endsWith(".tmp")
            && JSON.parse(fs.readFileSync(from, "utf8")).receipt.status === "committed")
            throw Object.assign(new Error("synthetic terminal persistence failure"), { code: "EIO" });
          return originalRename.call(this, from, to);
        };
        const run = operations.runReflectionOperation(scope, id, prepared.fingerprint, operationMutation, async dispatch => {
          dispatch();
          writes++;
          fs.writeFileSync(path.join(scope.dataRoot, "synthetic-core.json"),
            JSON.stringify({ writes, mutation: operationMutation, response }));
          if (recover === "response-loss") throw new Error("synthetic response loss after Core commit");
          return response;
        });
        if (recover === "persist-loss") {
          await assert.rejects(run, { code: "reflection_operation_unavailable" });
          assert.equal(JSON.parse(fs.readFileSync(files(scope).record, "utf8")).receipt.status, "running");
        } else {
          assert.equal((await run).operation.status, recover ? "unknown" : "committed");
        }
      } finally { fs.renameSync = originalRename; }
      const cold = await coldReplay(scope, id, prepared.fingerprint, !!recover);
      assert.equal(cold.operation.status, "committed");
      assert.equal(cold.operation.terminal, true);
      assert.deepEqual(cold.response, response);
      const { record, root } = files(scope), bytes = fs.statSync(record).size;
      assert.ok(bytes > 65_536 && bytes < receiptLimit);
      assert.equal(JSON.parse(fs.readFileSync(record, "utf8")).version, 1);
      if (process.platform !== "win32") assert.equal(fs.statSync(record).mode & 0o777, 0o600);
      assert.deepEqual(fs.readdirSync(root), [`${id}.json`]);
      // A second fresh process must read the terminal cache without reconciliation.
      assert.deepEqual(await coldReplay(scope, id, prepared.fingerprint), cold);
      assert.equal(JSON.parse(fs.readFileSync(path.join(scope.dataRoot, "synthetic-core.json"), "utf8")).writes, 1);
      assert.equal(writes, 1);
      context.diagnostic(JSON.stringify({ name, recover, requestBytes,
        responseBytes: Buffer.byteLength(JSON.stringify(response)), receiptBytes: bytes, receiptLimit }));
    });
  }
}

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

test("the original 20 KB mutation bound is unchanged", async context => {
  const scope = fixture(context);
  await assert.rejects(operations.prepareReflectionOperation(scope, randomUUID(), { ...mutation, rawText: "中".repeat(7000) }),
    { code: "invalid_operation", status: 400 });
  assert.equal(fs.existsSync(path.join(scope.stateDir, "edupi-reflection-operations")), false);
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
  for (const mode of ["corrupt", "utf8", "symlink", "hardlink", "writable", "oversize"]) {
    const scope = fixture(context), id = randomUUID(), prepared = await operations.prepareReflectionOperation(scope, id, mutation);
    const { record } = files(scope);
    if (mode === "corrupt") fs.writeFileSync(record, "{}");
    if (mode === "utf8") fs.writeFileSync(record, Buffer.from([0xff, 0xfe]));
    if (mode === "hardlink") fs.linkSync(record, `${record}.linked`);
    if (mode === "oversize") fs.appendFileSync(record, " ".repeat(receiptLimit + 1 - fs.statSync(record).size));
    if (mode === "writable") fs.chmodSync(record, 0o666);
    if (mode === "symlink") {
      fs.renameSync(record, `${record}.original`);
      fs.symlinkSync(`${record}.original`, record);
    }
    await assert.rejects(operations.resolveReflectionOperation(scope, id, prepared.fingerprint), { code: "reflection_operation_unavailable" });
  }
});

test("the same finite byte limit accepts the exact boundary and rejects larger writes atomically", async context => {
  for (const extra of [0, 1]) {
    const scope = fixture(context), id = randomUUID();
    const prepared = await operations.prepareReflectionOperation(scope, id, mutation);
    const { record, root } = files(scope);
    const stored = JSON.parse(fs.readFileSync(record, "utf8"));
    const response = { status: 200, body: { ok: true, readbackConfirmed: true, padding: "" } };
    stored.receipt = { ...prepared, status: "committed", terminal: true };
    stored.dispatched = true;
    stored.response = response;
    response.body.padding = "x".repeat(receiptLimit + extra - Buffer.byteLength(`${JSON.stringify(stored)}\n`));
    const run = operations.runReflectionOperation(scope, id, prepared.fingerprint, mutation, async dispatch => {
      dispatch();
      return response;
    });
    if (!extra) {
      const outcome = await run;
      assert.equal(fs.statSync(record).size, receiptLimit);
      assert.deepEqual(await operations.resolveReflectionOperation(scope, id, prepared.fingerprint), outcome);
    } else {
      await assert.rejects(run, { code: "reflection_operation_capacity" });
      const running = JSON.parse(fs.readFileSync(record, "utf8"));
      assert.equal(running.receipt.status, "running");
      assert.equal(running.dispatched, true);
      assert.equal(running.response, null);
      await assert.rejects(operations.resolveReflectionOperation(scope, id, prepared.fingerprint, async () => response),
        { code: "reflection_operation_capacity" });
      const unknown = await operations.resolveReflectionOperation(scope, id, prepared.fingerprint);
      assert.equal(unknown.operation.status, "unknown");
      assert.equal(unknown.operation.terminal, false);
      assert.equal(unknown.response, null);
      assert.deepEqual(await operations.runReflectionOperation(scope, id, prepared.fingerprint, mutation,
        async () => assert.fail("oversize persistence must not dispatch again")), unknown);
    }
    assert.deepEqual(fs.readdirSync(root), [`${id}.json`]);
  }
});

test("scope bindings and unsafe directories still fail closed", async context => {
  const scope = fixture(context), id = randomUUID();
  const prepared = await operations.prepareReflectionOperation(scope, id, mutation);
  const { root, record } = files(scope), before = fs.readFileSync(record);
  for (const field of ["ownerId", "grantId", "classId", "subject", "rootRef", "stateDir", "dataRoot"]) {
    const replacement = field === "rootRef" ? `sha256:${"f".repeat(64)}`
      : ["stateDir", "dataRoot"].includes(field) ? fs.mkdtempSync(path.join(scope.stateDir, "scope-")) : "other";
    await assert.rejects(operations.resolveReflectionOperation({ ...scope, [field]: replacement }, id, prepared.fingerprint),
      { code: "operation_not_prepared" });
  }
  fs.chmodSync(root, 0o777);
  await assert.rejects(operations.resolveReflectionOperation(scope, id, prepared.fingerprint), { code: "reflection_operation_unavailable" });
  fs.chmodSync(root, 0o700);
  fs.renameSync(root, `${root}.original`);
  fs.symlinkSync(`${root}.original`, root);
  await assert.rejects(operations.resolveReflectionOperation(scope, id, prepared.fingerprint), { code: "reflection_operation_unavailable" });
  assert.deepEqual(fs.readFileSync(record), before);
});

test("permission and rename failures never publish a successful receipt", async context => {
  for (const failure of ["permission", "rename", "owner"]) {
    const scope = fixture(context), id = randomUUID();
    const prepared = await operations.prepareReflectionOperation(scope, id, mutation);
    const { record, root } = files(scope), before = fs.readFileSync(record);
    const originalOpen = fs.openSync, originalRename = fs.renameSync, originalStat = fs.fstatSync;
    try {
      fs.openSync = function(input, ...args) {
        if (failure === "permission" && String(input).endsWith(".tmp")) throw Object.assign(new Error("synthetic EACCES"), { code: "EACCES" });
        return originalOpen.call(this, input, ...args);
      };
      fs.renameSync = function(from, to) {
        if (failure === "rename" && to === fs.realpathSync(record)) throw Object.assign(new Error("synthetic EIO"), { code: "EIO" });
        return originalRename.call(this, from, to);
      };
      fs.fstatSync = function(...args) {
        const stat = originalStat.apply(this, args);
        if (failure === "owner") stat.uid = process.getuid() + 1;
        return stat;
      };
      await assert.rejects(operations.runReflectionOperation(scope, id, prepared.fingerprint, mutation,
        async () => assert.fail("failed persistence must not dispatch")), { code: "reflection_operation_unavailable" });
    } finally {
      fs.openSync = originalOpen;
      fs.renameSync = originalRename;
      fs.fstatSync = originalStat;
    }
    assert.deepEqual(fs.readFileSync(record), before);
    assert.deepEqual(fs.readdirSync(root), [`${id}.json`]);
    assert.equal((await operations.resolveReflectionOperation(scope, id, prepared.fingerprint)).operation.status, "not_committed");
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
