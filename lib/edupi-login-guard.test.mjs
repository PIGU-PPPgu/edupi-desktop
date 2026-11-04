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
  assert.match(handler({ toolName: "zhixue_login" }, context).reason, /不要再次弹窗/);
  assert.equal(handler({ toolName: "zhixue_sync" }, context), undefined);
  assert.match(handler({ toolName: "zhixue_sync" }, context).reason, /不要再次启动同步/);
  assert.equal(handler({ toolName: "zhixue_login_status" }, context), undefined);
  assert.match(handler({ toolName: "zhixue_sync_status" }, context).reason, /停止查询/);
  assert.match(handler({ toolName: "zhixue_login_status" }, context).reason, /停止查询/);
  assert.equal(handler({ toolName: "read" }, context), undefined);
  branch.push({ type: "message", id: "user-2", message: { role: "user", content: "重新扫码" } });
  assert.equal(handler({ toolName: "zhixue_login" }, context), undefined);
  assert.equal(handler({ toolName: "zhixue_sync" }, context), undefined);
  assert.equal(handler({ toolName: "zhixue_sync_status" }, context), undefined);
});
