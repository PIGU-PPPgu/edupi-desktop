import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./EduPiConnectorSetup.tsx", import.meta.url), "utf8");
test("Feishu setup keeps the Mira-like flow actionable and secret-safe", () => {
  for (const label of ["打开飞书开放平台", "复制权限 JSON", "复制事件清单", "查看参考流程", "App ID", "App Secret", "验证并保存"]) assert.match(source, new RegExp(label));
  assert.match(source, /8 项/);
  assert.match(source, /2 个事件 · 1 个回调/);
  assert.match(source, /type="password"/);
  assert.match(source, /setAppSecret\(""\)/);
  assert.doesNotMatch(source, /localStorage/);
});
