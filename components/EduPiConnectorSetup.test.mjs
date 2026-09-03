import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./EduPiConnectorSetup.tsx", import.meta.url), "utf8");
test("Feishu and DingTalk setup keep full onboarding actionable and secret-safe", () => {
  for (const label of ["完整权限一键接入", "一键创建并授权", "复制完整权限", "打开开放平台", "App ID", "App Secret", "验证并保存", "官方 Agent 自动连接", "打开钉钉 AI 连接", "复制安装命令", "Client ID", "Client Secret"]) assert.match(source, new RegExp(label));
  assert.match(source, /preset: true/);
  assert.match(source, /2 个事件 · 1 个回调/);
  assert.match(source, /type="password"/);
  assert.match(source, /setAppSecret\(""\)/);
  assert.doesNotMatch(source, /localStorage/);
});
