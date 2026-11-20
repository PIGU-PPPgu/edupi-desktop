# 智学网 Desktop 登录桥接验收

## 结果

本轮完成智学网扫码登录桥接的 Desktop 接线和 macOS DMG 构建。

- Desktop 提交：`cec89e2be9ef2bc1b73d704aac1b5dcb0689007e`
- 安全收紧提交：`6d54c7835ebea9b7ff9cbb2317a6a3d7638f8424`
- 绑定 Core：`fc89b3bc899a55b0fdad61b8f37e238d950f37c6`
- DMG 交付文件：`EduPi_0.3.119_aarch64.dmg`
- DMG SHA-256：以本轮 signed draft 产物为准
- DMG 大小：以本轮 signed draft 产物为准

## 已验证

- `node --test lib/edupi-zhixue-bridge.test.mjs`：5 passed
- `node --test lib/rpc-session-pi1.test.mjs lib/edupi-login-guard.test.mjs lib/edupi-mutation-guard.test.mjs`：30 passed
- `npm test`：4937 passed，57 skipped，0 failed
- `node_modules/.bin/tsc --noEmit`：通过
- 目标 ESLint：通过
- `npm audit --audit-level=high`：0 vulnerabilities
- `EDUPI_STAGED_IDENTITY_ONLY=1 npm run test:staged-desktop-runtime`：通过
- `npm run test:staged-desktop-runtime`：通过，Core `ready`，Core `fc89b3bc899a55b0fdad61b8f37e238d950f37c6`
- DMG 只读挂载后，worker 和 `playwright-core` 均存在
- DMG 中 worker 与源码 SHA-256 一致
- DMG 和 App 通过 `codesign --verify --deep --strict`

## 行为边界

当前桥接提供 `zhixue_login`、`zhixue_login_status`、`zhixue_sync_status` 和 `zhixue_sync` 四个工具。登录回执写入当前用户数据根的 `.edupi/zhixue`，二维码路径固定在该目录内并拒绝 symlink，旧 flow 回执不会冒充新登录，重复登录会被锁阻止。

`zhixue_sync` 当前明确返回“学情数据同步尚未接入”，不会把登录成功伪装成学情同步完成。

## 未验证和发布限制

- 未使用真实智学网账号扫码，未验证真实 Chrome 回调和登录态续接。
- 未验证学情数据抓取和班级、学科配置。
- App 通过 Developer ID 证书签名，但本机没有 Apple notarization 凭据，`spctl` 会报告 `Unnotarized Developer ID`。
- Tauri updater 私钥未在本地构建环境注入，正式 signed draft 由 GitHub 发布工作流负责完成。
- 未构建 Windows。

DMG 作为本轮待验收产物保留在上述路径。完成正式公证、真实账号验收或清理本轮构建时再删除该文件及对应的生成资源。

本轮验收结束后已删除 `.next-desktop/`、`src-tauri/target/` 以及 staged server、Core、Node 和 OpenConnector 生成目录，保留最终 DMG。
