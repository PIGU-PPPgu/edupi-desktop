import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { readEduPiZhixueLoginStatus } = await jiti.import("./edupi-zhixue-bridge.ts");
const { zhixueTurnStatus, zhixueStatusText } = await jiti.import("./edupi-zhixue-status.ts");
const flowId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const nextFlow = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const png = Buffer.from("89504e470d0a1a0a", "hex");

test("the same flow reports scan completion after the worker removes the QR", async t => {
  const root = await mkdtemp(join(tmpdir(), "edupi-zhixue-status-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, ".edupi", "zhixue");
  const qrPath = join(directory, "login-qr.png");
  const put = (name, data) => writeFile(join(directory, name), JSON.stringify({ version: 1, ...data }));
  await mkdir(directory, { recursive: true });
  await put("login-state.json", { flowId, status: "starting" });
  assert.deepEqual(readEduPiZhixueLoginStatus(root, flowId), { status: "starting" });
  await writeFile(qrPath, png);
  await put("login-state.json", { flowId, status: "awaiting_scan", qrPath });
  assert.deepEqual(readEduPiZhixueLoginStatus(root, flowId), { status: "awaiting_scan", qr: png.toString("base64") });
  assert.deepEqual(readEduPiZhixueLoginStatus(root, nextFlow), { status: "not_current" });
  await unlink(qrPath);
  await put("login-state.json", { flowId, status: "authenticated" });
  await put("session.json", { flowId, token: "synthetic-only", cookies: [] });
  await put("login_ok.json", { flowId: nextFlow });
  assert.deepEqual(readEduPiZhixueLoginStatus(root, flowId), { status: "error" });
  await put("login_ok.json", { flowId });
  assert.deepEqual(readEduPiZhixueLoginStatus(root, flowId), { status: "authenticated", needsSyncConfig: true });
  await put("sync-config.json", { className: "合成班", subjectCode: "02", phaseCode: "04" });
  assert.deepEqual(readEduPiZhixueLoginStatus(root, flowId), { status: "authenticated", needsSyncConfig: false });
  await put("login-state.json", { flowId: nextFlow, status: "expired" });
  assert.deepEqual(readEduPiZhixueLoginStatus(root, nextFlow), { status: "expired" });
  assert.deepEqual(readEduPiZhixueLoginStatus(root, flowId), { status: "not_current" });
  await put("login-state.json", { flowId, status: "awaiting_scan", updatedAt: new Date(Date.now() - 20 * 60_000).toISOString() });
  assert.deepEqual(readEduPiZhixueLoginStatus(root, flowId), { status: "expired" });
  await put("login-state.json", { flowId, status: "awaiting_scan", qrPath });
  const outside = join(root, "outside.png");
  await writeFile(outside, png);
  await symlink(outside, qrPath);
  assert.deepEqual(readEduPiZhixueLoginStatus(root, flowId), { status: "awaiting_scan" });
});

test("a stopped turn keeps the trusted login and sync results from before the duplicate calls", () => {
  const tool = (toolName, details, isError = false) => ({ role: "toolResult", toolName, details, isError, content: [] });
  const authenticated = { version: 1, flowId, status: "authenticated" };
  const result = zhixueTurnStatus([
    tool("zhixue_sync_status", { zhixue: { ...authenticated, sync: "needs_config" } }),
    tool("zhixue_login_status", { zhixue: authenticated }),
    tool("zhixue_login_status", undefined, true),
    tool("zhixue_sync_status", undefined, true),
  ]);
  assert.deepEqual(result, { ...authenticated, sync: "needs_config" });
  assert.match(zhixueStatusText(result), /已确认登录.*班级、学科和学段/);
  assert.equal(zhixueTurnStatus([tool("read", { zhixue: authenticated })]), null);
  const newLogin = zhixueTurnStatus([
    tool("zhixue_sync_status", { zhixue: { ...authenticated, sync: "needs_config" } }),
    tool("zhixue_login", { zhixue: { ...authenticated, flowId: nextFlow, status: "awaiting_scan" } }),
  ]);
  assert.equal(newLogin.sync, undefined);
  assert.match(zhixueStatusText(newLogin), /等待扫码/);
});
