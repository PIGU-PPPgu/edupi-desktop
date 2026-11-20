# 智学网 Desktop 登录桥接验收

## 结果

本轮完成智学网扫码登录桥接、可配置基础学情同步桥接的 Desktop 接线和 macOS DMG 构建。

- Desktop 提交：`cec89e2be9ef2bc1b73d704aac1b5dcb0689007e`
- 安全收紧提交：`6d54c7835ebea9b7ff9cbb2317a6a3d7638f8424`
- 绑定 Core：`fc89b3bc899a55b0fdad61b8f37e238d950f37c6`
- DMG 交付文件：`EduPi_0.3.120_aarch64.dmg`
- DMG SHA-256：`ef454a66b6d180075f9a1fa5444a2b54481bbe7e543b703c76651a1609983d4d`
- DMG 大小：`242473504` bytes
- Signed draft：`v0.3.120`
- GitHub Actions run：`44673379640`

## 已验证

- `node --test lib/edupi-zhixue-bridge.test.mjs`：5 passed
- `node --test lib/rpc-session-pi1.test.mjs lib/edupi-login-guard.test.mjs lib/edupi-mutation-guard.test.mjs`：30 passed
- `npm test`：4937 passed，57 skipped，0 failed
- `node_modules/.bin/tsc --noEmit`：通过
- 目标 ESLint：通过
- `npm audit --audit-level=high`：0 vulnerabilities
- `EDUPI_STAGED_IDENTITY_ONLY=1 npm run test:staged-desktop-runtime`：通过
- `npm run test:staged-desktop-runtime`：通过，Core `ready`，Core `fc89b3bc899a55b0fdad61b8f37e238d950f37c6`
- `EDUPI_CORE_ROOT=/private/tmp/edupi-core-fc89-20261120 npm run desktop:prepare`：通过，Core `fc89b3bc899a55b0fdad61b8f37e238d950f37c6`
- `node --test lib/edupi-zhixue-bridge.test.mjs`：5 passed，覆盖合成登录、同步配置、单实例锁和失败状态
- `node_modules/.bin/tsc --noEmit --pretty false`：通过
- 目标 ESLint：通过
- DMG 只读挂载后，worker 和 `playwright-core` 均存在
- DMG 中 worker 与源码 SHA-256 一致
- DMG 和 App 通过 `codesign --verify --deep --strict`

## 行为边界

当前桥接提供 `zhixue_login`、`zhixue_login_status`、`zhixue_sync_status` 和 `zhixue_sync` 四个工具。登录回执写入当前用户数据根的 `.edupi/zhixue`，二维码路径固定在该目录内并拒绝 symlink，旧 flow 回执不会冒充新登录，重复登录会被锁阻止。

`zhixue_sync` 现在接受班级、学科代码、学段代码和可选年级/学校/班级 ID，写入当前用户数据根的 `sync-config.json`，通过独占 `sync.lock` 启动隔离同步 worker，并原子写入 `sync-state.json` 与 `sync-snapshot.json`。登录失效、空结果、重复运行和网络/API 失败均保留明确状态，不把登录成功伪装成同步成功。当前同步产出为基础作业成绩和学生列表，完整知识图谱、错题库和真实 Core 学生档案写入仍需后续真实账号验收。

## 未验证和发布限制

- 本轮真实二维码已从公证包内 worker 生成，但 15 分钟内没有完成手机扫码，状态为 `expired`，没有产生登录回执；因此真实 Chrome 回调和登录态跨冷启动续接仍未通过。
- 同步 worker 已完成合成配置、锁和原子状态回归，真实学情抓取、班级/学科映射和真实 Core 学生档案写入仍未验证。
- 本轮 GitHub signed draft 已通过 Apple notarization、stapling、Gatekeeper 和 updater 签名校验。
- `v0.3.120` 已发布为正式 macOS-only Release，公开资产只有 DMG、updater tar 和 `.sig`。
- 未构建 Windows。

DMG 作为本轮待验收产物保留在本地交付目录。完成真实账号验收或清理本轮构建时再删除该文件及对应的生成资源。

本轮验收结束后已删除 `.next-desktop/`、`src-tauri/target/` 以及 staged server、Core、Node 和 OpenConnector 生成目录，保留最终 DMG。
