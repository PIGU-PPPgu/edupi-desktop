# macOS 0.3.97 正式版状态与预发布交付

## 当前状态

R04／R12／R17：用户要求交付，并指出安装版 `.96` 将 `.70` 显示为“最新版本”。实际数值由 GitHub `/releases/latest` 返回，未硬编码；该接口仅返回正式版。现已修正正式版名称、高于正式版、无发布信息及检查失败的状态，安装版本仍从原生 host 读取。`.97` 继承 `.96` 档案与 Core 配对，Core 固定 `56c7ed54cbe65af6b6526eb4f5ac556e9c88e00d`。

当前为已实现待验收；签名构建、安装、macOS 预发布公开及资产摘要将在执行后记录。发布沿用用户已授权的 macOS-only prerelease，正式 `updater-feed` 保持 `7924328ee893c9527adb54e25b0023e9f2a26ff7`，Windows/Linux 不构建。

## 验证

- 实际 React 组件覆盖 native `.96` 高于正式版 `.70`、相等、落后、unknown、unpublished 和请求失败。定向命令 `node --test components/AppSettingsNativeHost.test.mjs components/AppSettingsUpdate.test.mjs lib/app-updates.test.mjs lib/desktop-updater.test.mjs`：75 passed，0 failed，0 skipped。
- 更新候选仍只来自正式版接口，签名升级仍使用既有更新源；预发布高于正式版时不显示降级按钮。
- `node_modules/.bin/tsc --noEmit` 通过；`npm run lint` 为 0 errors、1 warning，警告位于既有 `test-edupi-core-history-e2.mjs` 的未使用变量。
- `node --test lib/branding.test.mjs scripts/release-components.test.mjs scripts/release-workflows.test.mjs`：54 passed，0 failed，0 skipped。
- 两个只读探索与必需的 `magpie_reviewer` 均因当前账户不支持 `group/auto-coding` 失败，独立审查不可用；主 Agent 已人工核对完整 diff、原生版本读取、正式版接口与构建矩阵，`git diff --check` 通过。

## 已知限制

继承 [0.3.96 安装验收](2026-11-01-macos096-update.md) 的证据边界。Core 精确 Main G1 CI 超时记录与跨类别来源遗漏报告仍未在此版本修复，不能把后续候选补丁追认到此包。Windows/Linux 安装和完整旧客户端自动升级不在本轮通过范围。
