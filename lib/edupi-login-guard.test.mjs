import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { createZhixueLoginGuard } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-login-guard.ts");

test("one teacher request cannot launch repeated Zhixue login windows", () => {
  let handler;
  createZhixueLoginGuard()({ on(name, callback) { if (name === "tool_call") handler = callback; } });
  const branch = [{ type: "message", id: "user-1", message: { role: "user", content: "扫码" } }];
  const context = { sessionManager: { getBranch: () => branch } };
  assert.equal(handler({ toolName: "zhixue_login" }, context), undefined);
  const repeatedLogin = handler({ toolName: "zhixue_login" }, context);
  assert.equal(repeatedLogin.terminate, true);
  assert.match(repeatedLogin.reason, /不要再次弹窗/);
  assert.equal(handler({ toolName: "zhixue_sync" }, context), undefined);
  const repeatedSync = handler({ toolName: "zhixue_sync" }, context);
  assert.equal(repeatedSync.terminate, true);
  assert.match(repeatedSync.reason, /不要再次启动同步/);
  assert.equal(handler({ toolName: "zhixue_login_status" }, context), undefined);
  assert.equal(handler({ toolName: "zhixue_sync_status" }, context), undefined);
  const repeatedSyncStatus = handler({ toolName: "zhixue_sync_status" }, context);
  assert.equal(repeatedSyncStatus.terminate, false);
  assert.match(repeatedSyncStatus.reason, /刚刚已经读过/);
  const repeatedSyncStatusAgain = handler({ toolName: "zhixue_sync_status" }, context);
  assert.equal(repeatedSyncStatusAgain.terminate, true);
  assert.match(repeatedSyncStatusAgain.reason, /停止查询/);
  const repeatedLoginStatus = handler({ toolName: "zhixue_login_status" }, context);
  assert.equal(repeatedLoginStatus.terminate, false);
  assert.match(repeatedLoginStatus.reason, /刚刚已经读过/);
  const repeatedLoginStatusAgain = handler({ toolName: "zhixue_login_status" }, context);
  assert.equal(repeatedLoginStatusAgain.terminate, true);
  assert.match(repeatedLoginStatusAgain.reason, /停止查询/);
  assert.equal(handler({ toolName: "read" }, context), undefined);
  branch.push({ type: "message", id: "user-2", message: { role: "user", content: "重新扫码" } });
  assert.equal(handler({ toolName: "zhixue_login" }, context), undefined);
  assert.equal(handler({ toolName: "zhixue_sync" }, context), undefined);
  assert.equal(handler({ toolName: "zhixue_sync_status" }, context), undefined);
});
