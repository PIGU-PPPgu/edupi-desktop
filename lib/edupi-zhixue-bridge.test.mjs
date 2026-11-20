import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createJiti } from "jiti";

const { createEduPiZhixueTools } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-zhixue-bridge.ts");

test("login bridge returns a QR receipt and reads the authenticated state", async t => {
  const root = await mkdtemp(join(tmpdir(), "edupi-zhixue-bridge-"));
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(root, { recursive: true, force: true });
  });
  const worker = join(root, "fake-worker.mjs");
  await writeFile(worker, `
    import { mkdirSync, writeFileSync } from "node:fs";
    import { dirname, join } from "node:path";
    const args = new Map();
    for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
    mkdirSync(dirname(args.get("--state")), { recursive: true });
    writeFileSync(args.get("--qr"), Buffer.from("fake-png"));
    writeFileSync(args.get("--session"), JSON.stringify({ version: 1, flowId: args.get("--flow-id"), token: "synthetic-token", cookies: [] }));
    writeFileSync(join(dirname(args.get("--session")), "login_ok.json"), JSON.stringify({ version: 1, flowId: args.get("--flow-id"), authenticatedAt: "2026-11-20T10:00:00.000Z" }));
    writeFileSync(args.get("--state"), JSON.stringify({ version: 1, flowId: args.get("--flow-id"), status: "authenticated", qrPath: args.get("--qr"), authenticatedAt: "2026-11-20T10:00:00.000Z" }));
  `);

  const syncWorker = join(root, "fake-sync-worker.mjs");
  await writeFile(syncWorker, `
    import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
    import { dirname } from "node:path";
    const args = new Map();
    for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
    const config = JSON.parse(readFileSync(args.get("--config"), "utf8"));
    mkdirSync(dirname(args.get("--snapshot")), { recursive: true });
    writeFileSync(args.get("--snapshot"), JSON.stringify({
      version: 1,
      flowId: args.get("--flow-id"),
      month: args.get("--month"),
      config,
      completeness: "base_performance",
      reports: [{ homeworkId: "synthetic-homework", title: "合成作业", students: [{ name: "合成学生", score: 96, scoreRate: 0.96 }] }],
      students: [{ name: "合成学生", averageScoreRate: 0.96, records: [] }],
    }));
    writeFileSync(args.get("--state"), JSON.stringify({
      version: 1,
      flowId: args.get("--flow-id"),
      status: "ok",
      completeness: "base_performance",
      month: args.get("--month"),
      config,
      counts: { reports: 1, students: 1 },
      message: "合成同步完成。",
    }));
  `);

  const [login, status, syncStatus, sync] = createEduPiZhixueTools(root, worker, syncWorker);
  const first = await login.execute("call-1", {}, undefined, undefined, { cwd: root });
  assert.match(first.content[0].text, /登录已完成/);
  assert.equal(first.details.visual.kind, "qr");
  assert.ok(existsSync(first.details.visual.path));

  const second = await status.execute("call-2", {}, undefined, undefined, { cwd: root });
  assert.match(second.content[0].text, /登录已完成/);
  const session = JSON.parse(await readFile(join(root, ".edupi", "zhixue", "session.json"), "utf8"));
  assert.equal(session.token, "synthetic-token");

  const held = await syncStatus.execute("call-3", {}, undefined, undefined, { cwd: root });
  assert.notEqual(held.isError, true);
  assert.match(held.content[0].text, /还没有同步配置/);

  const started = await sync.execute("call-4", {
    month: "2026-11",
    className: "合成班",
    subjectCode: "02",
    phaseCode: "04",
    gradeCode: "07",
  }, undefined, undefined, { cwd: root });
  assert.match(started.content[0].text, /已开始同步/);
  await new Promise(resolve => setTimeout(resolve, 250));
  const completed = await syncStatus.execute("call-5", {}, undefined, undefined, { cwd: root });
  assert.match(completed.content[0].text, /同步完成/);
  const snapshot = JSON.parse(await readFile(join(root, ".edupi", "zhixue", "sync-snapshot.json"), "utf8"));
  assert.equal(snapshot.config.className, "合成班");
});

test("login bridge waits for a delayed QR instead of returning without a visual", { timeout: 35_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), "edupi-zhixue-delayed-qr-"));
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    const lockPath = join(root, ".edupi", "zhixue", "login.lock");
    try {
      const lock = JSON.parse(await readFile(lockPath, "utf8"));
      if (Number.isInteger(lock.pid) && lock.pid > 0) process.kill(lock.pid, "SIGTERM");
    } catch {}
    await rm(root, { recursive: true, force: true });
  });
  const worker = join(root, "delayed-qr-worker.mjs");
  await writeFile(worker, `
    import { mkdirSync, writeFileSync } from "node:fs";
    import { dirname } from "node:path";
    const args = new Map();
    for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
    mkdirSync(dirname(args.get("--state")), { recursive: true });
    setTimeout(() => {
      writeFileSync(args.get("--qr"), Buffer.from("fake-png"));
      writeFileSync(args.get("--state"), JSON.stringify({
        version: 1,
        flowId: args.get("--flow-id"),
        status: "awaiting_scan",
        qrPath: args.get("--qr"),
      }));
    }, 9_000);
    setTimeout(() => {}, 30_000);
  `);

  const [login] = createEduPiZhixueTools(root, worker);
  const result = await login.execute("call-delayed-qr", {}, undefined, undefined, { cwd: root });
  assert.match(result.content[0].text, /二维码已显示/);
  assert.equal(result.details.visual.kind, "qr");
  assert.ok(existsSync(result.details.visual.path));

  const alreadyRunning = await login.execute("call-delayed-qr-again", {}, undefined, undefined, { cwd: root });
  assert.match(alreadyRunning.content[0].text, /登录窗口已经在运行/);

  const lockPath = join(root, ".edupi", "zhixue", "login.lock");
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  assert.ok(Number.isInteger(lock.pid) && lock.pid > 0);
  process.kill(lock.pid, "SIGTERM");
  for (let attempt = 0; attempt < 20 && existsSync(lockPath); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(existsSync(lockPath), false);

  const restarted = await login.execute("call-delayed-qr-restart", {}, undefined, undefined, { cwd: root });
  assert.match(restarted.content[0].text, /二维码已显示/);
  assert.equal(restarted.details.visual.kind, "qr");
});

test("does not expose a QR path outside the current login directory or through a symlink", async t => {
  const root = await mkdtemp(join(tmpdir(), "edupi-zhixue-qr-"));
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(root, { recursive: true, force: true });
  });
  const dataRoot = join(root, ".edupi", "zhixue");
  const outside = join(root, "outside.png");
  await (await import("node:fs/promises")).mkdir(dataRoot, { recursive: true });
  await writeFile(outside, "private");
  await writeFile(join(dataRoot, "login-state.json"), JSON.stringify({
    version: 1,
    flowId: "flow-outside",
    status: "awaiting_scan",
    qrPath: outside,
  }));
  const [, status] = createEduPiZhixueTools(root, join(root, "missing-worker.mjs"));
  const outsideResult = await status.execute("call-outside", {}, undefined, undefined, { cwd: root });
  assert.equal(outsideResult.details, undefined);

  const target = join(root, "target.png");
  await writeFile(target, "private");
  const qr = join(dataRoot, "login-qr.png");
  await symlink(target, qr);
  await writeFile(join(dataRoot, "login-state.json"), JSON.stringify({
    version: 1,
    flowId: "flow-symlink",
    status: "awaiting_scan",
    qrPath: qr,
  }));
  const symlinkResult = await status.execute("call-symlink", {}, undefined, undefined, { cwd: root });
  assert.equal(symlinkResult.details, undefined);
});

test("does not treat an old login receipt as the current authenticated flow", async t => {
  const root = await mkdtemp(join(tmpdir(), "edupi-zhixue-flow-"));
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(root, { recursive: true, force: true });
  });
  const dataRoot = join(root, ".edupi", "zhixue");
  const qr = join(dataRoot, "login-qr.png");
  await (await import("node:fs/promises")).mkdir(dataRoot, { recursive: true });
  await writeFile(qr, "fake-png");
  await writeFile(join(dataRoot, "login-state.json"), JSON.stringify({
    version: 1,
    flowId: "new-flow",
    status: "authenticated",
    qrPath: qr,
    authenticatedAt: "2026-11-20T10:00:00.000Z",
  }));
  await writeFile(join(dataRoot, "session.json"), JSON.stringify({ version: 1, flowId: "old-flow", token: "old-token" }));
  await writeFile(join(dataRoot, "login_ok.json"), JSON.stringify({ version: 1, flowId: "old-flow" }));
  const [, status] = createEduPiZhixueTools(root, join(root, "missing-worker.mjs"));
  const result = await status.execute("call-old-flow", {}, undefined, undefined, { cwd: root });
  assert.match(result.content[0].text, /回执与当前登录 flow 不一致/);
  assert.equal(result.details.visual.path, qr);
});

test("removes a dead login lock so a new flow can start", async t => {
  const root = await mkdtemp(join(tmpdir(), "edupi-zhixue-lock-"));
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(root, { recursive: true, force: true });
  });
  const dataRoot = join(root, ".edupi", "zhixue");
  await (await import("node:fs/promises")).mkdir(dataRoot, { recursive: true });
  await writeFile(join(dataRoot, "login.lock"), JSON.stringify({ version: 1, flowId: "dead-flow", pid: 999999 }));
  const worker = join(root, "dead-lock-worker.mjs");
  await writeFile(worker, `
    import { writeFileSync } from "node:fs";
    const args = new Map();
    for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
    writeFileSync(args.get("--state"), JSON.stringify({ version: 1, flowId: args.get("--flow-id"), status: "error", error: "synthetic failure" }));
  `);
  const [login] = createEduPiZhixueTools(root, worker);
  const result = await login.execute("call-dead-lock", {}, undefined, undefined, { cwd: root });
  assert.match(result.content[0].text, /登录失败/);
  assert.equal(existsSync(join(dataRoot, "login.lock")), false);
});

test("allows only one active login flow for a shared user data root", async t => {
  const root = await mkdtemp(join(tmpdir(), "edupi-zhixue-concurrent-"));
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(root, { recursive: true, force: true });
  });
  const worker = join(root, "slow-worker.mjs");
  await writeFile(worker, `
    import { writeFileSync } from "node:fs";
    const args = new Map();
    for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
    setTimeout(() => {
      writeFileSync(args.get("--state"), JSON.stringify({
        version: 1,
        flowId: args.get("--flow-id"),
        status: "error",
        error: "synthetic failure",
      }));
    }, 1_000);
  `);
  const [firstLogin, secondLogin] = [
    createEduPiZhixueTools(root, worker)[0],
    createEduPiZhixueTools(root, worker)[0],
  ];
  const first = firstLogin.execute("call-first", {}, undefined, undefined, { cwd: root });
  await new Promise(resolve => setTimeout(resolve, 50));
  const second = await secondLogin.execute("call-second", {}, undefined, undefined, { cwd: root });
  assert.match(second.content[0].text, /登录窗口已经在运行/);
  const firstResult = await first;
  assert.match(firstResult.content[0].text, /登录失败/);
});
