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

  const [login, status, syncStatus] = createEduPiZhixueTools(root, worker);
  const first = await login.execute("call-1", {}, undefined, undefined, { cwd: root });
  assert.match(first.content[0].text, /登录已完成/);
  assert.equal(first.details.visual.kind, "qr");
  assert.ok(existsSync(first.details.visual.path));

  const second = await status.execute("call-2", {}, undefined, undefined, { cwd: root });
  assert.match(second.content[0].text, /登录已完成/);
  const session = JSON.parse(await readFile(join(root, ".edupi", "zhixue", "session.json"), "utf8"));
  assert.equal(session.token, "synthetic-token");

  const sync = await syncStatus.execute("call-3", {}, undefined, undefined, { cwd: root });
  assert.equal(sync.isError, true);
  assert.match(sync.content[0].text, /学情数据同步桥接尚未接入/);
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
