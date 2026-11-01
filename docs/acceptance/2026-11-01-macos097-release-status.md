# macOS 0.3.97 正式版状态与预发布交付

## 当前状态

2026-11-02，R04／R12／R17 本轮 macOS 交付已完成：源码 PR #449 已合并，`v0.3.97` 已公开为 macOS Apple Silicon 预发布；从公开 Release 下载、校验并安装至 `/Applications/EduPi.app`，安装版“关于与更新”原生验收通过，随后恢复原 WebView 偏好并在正常资料根启动，应用留在运行状态供用户查看。用户验收仍待，不代表完整跨平台发布升级流程验收通过。

用户指出 `.96` 将 `.70` 显示为“最新版本”。实际数值由 GitHub `/releases/latest` 返回，未硬编码；该接口仅返回正式版。此次修正正式版名称、高于正式版、无发布信息及检查失败的状态，当前版本继续从原生 host 读取。安装版实际显示“当前版本 v0.3.97 / 最新正式版 v0.3.70”，检查完成状态为“当前版本高于最新正式版。”，没有降级按钮。

发布沿用已授权的 macOS-only prerelease，Release `430592158` 为 `draft: false / prerelease: true`，未设为 Latest。最新正式版继续为 `v0.3.70`，正式 `updater-feed` 保持 `7924328ee893c9527adb54e25b0023e9f2a26ff7`；Windows/Linux 未构建。此状态取代此前 `.97` 待安装、待公开的阶段快照。

## 代码与构建

- Desktop 签名源码：`14a79350ff57bec8014cbb22eabe1356d531eebc`；PR #449 合并提交 `a417e70acffb35c576bd418bb72f7a5117f2db2f` 与其同 tree。
- Core：`56c7ed54cbe65af6b6526eb4f5ac556e9c88e00d`；`.97` 继承 `.96` 的档案界面与 Core 配对，没有加入后续来源合同补丁。
- 签名构建 `41309796894` attempt 2 成功，preflight、macOS 和 release 三项通过；全平台 draft proof、正式 manifest 和失败通知三项依条件跳过，不计为通过。
- attempt 1 的应用编译、签名与公证提交已完成，但 `Ensure macOS App ticket before final packaging` 因 CloudKit 票据下载连续三次 `NSURLErrorDomain -1005`、stapler exit 68 失败；保留该失败记录。相同源码重跑后完成票据、签名与发布，不以本地结果替代该次失败。

## 验证

- `node --test components/AppSettingsNativeHost.test.mjs components/AppSettingsUpdate.test.mjs lib/app-updates.test.mjs lib/desktop-updater.test.mjs`：75 passed，0 failed，0 skipped。实际 React 组件覆盖原生版本高于、等于、落后于正式版，以及 unknown、unpublished 和请求失败。
- `node_modules/.bin/tsc --noEmit` 通过；`npm run lint` 为 0 errors、1 warning，警告位于既有 `test-edupi-core-history-e2.mjs` 的未使用变量。
- `node --test lib/branding.test.mjs scripts/release-components.test.mjs scripts/release-workflows.test.mjs`：54 passed，0 failed，0 skipped。更新候选仍只来自正式版接口，签名升级保留既有更新源。
- 公开下载的三个资产与 Release 摘要一致；updater 签名校验通过，篡改样本被拒绝。包内 17 个冻结文件与 Desktop/Core 配对来源一致；应用和 DMG 的签名、Apple 公证票据、Gatekeeper 检查通过。
- 从公开 DMG 安装后，以显式隔离根启动，`before-cua` 核对 App 与 Core host 进程和环境通过；实际操作“设置 → 关于与更新”，等待 GitHub 检查结束，观察当前 `.97`、最新正式版 `.70`、高于正式版状态与无降级操作，并保存原生截图与可访问性文本。
- 原生 Command-Q 后 `stopped` 核对零 App/helper 进程；恢复三个原有 WebView origin 偏好。安装与隔离原生验收前后，336 个受保护真实资料文件的字节均保持一致；升级前资料备份保留。
- 正常启动后核对 `/Applications/EduPi.app` 版本 `.97`，Core host 使用正常资料根且没有隔离标记，App 子进程的 `38471` 服务 `/api/home` 返回 HTTP 200；正常 App 留在运行状态。正常窗口没有重复进行目视验收，原生版本页证据来自同一安装 App 的隔离验收。
- 两个只读探索与必需的 `magpie_reviewer` 均因当前账户不支持 `group/auto-coding` 失败，独立审查不可用；主 Agent 已人工核对完整 diff、原生版本读取、正式版接口与构建矩阵，`git diff --check` 通过。

## 公开资产

[macOS 预发布](https://github.com/PIGU-PPPgu/edupi-desktop/releases/tag/v0.3.97) · [签名构建](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/41309796894)

| 资产 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `EduPi_0.3.97_aarch64.dmg` | 238327294 | `433b3e4b90b69b7ba0cd685d3af4fbce640cbf28559e5f62ffc5859f81960a6a` |
| `EduPi_aarch64.app.tar.gz` | 239655105 | `8bd5131d4fb2f4a7a6e663d9667d8a0d953f9abc8da74c9b5747a5f246220107` |
| `EduPi_aarch64.app.tar.gz.sig` | 404 | `2f7b7eb2dad709a1a47cbe13d60590c68f1cf16ae05e52fbf2efcad5b91c1207` |

## 清理与证据

本轮下载副本、分块缓存、解包副本、已卸载挂载目录和隔离夹具，以及已被后续回退取代的 `.93`、`.94` App 副本共十个精确路径已清理。清理前核对版本、无进程句柄与无挂载；删除前分配空间合计 4,894,638,080 字节，约 4.56 GiB。清理后逐一路径不存在且当前 App 保留，`df` 同卷可用空间从 872471356 KiB 增至 877334076 KiB。

唯一当前回退 App 为 `/Users/iguppp/edupi-install-checkpoints/v0.3.97/rollback/EduPi-before-097.saved-bundle`，版本 `.96`，保留至用户验收 `.97` 后清理。既有真实资料备份、源码与在用依赖未清理。

本机证据目录：`/Users/iguppp/edupi-install-checkpoints/v0.3.97/evidence/`。关键记录为 `public-download-verification.json`、`local-bundle-identity.json`、`mac-installation.json`、`native-about-acceptance.json`、`native-about-097.png`、`native-about-097.ax.txt`、`normal-startup-097.json`、`cleanup-delivered-097.json`。这些记录分别覆盖公开资产、包内来源、实际安装、原生界面、资料保持、正常启动与实际清理，不把前序阶段记录中的“尚未启动”状态当作最终状态。

## 已知限制

继承 [0.3.96 安装验收](2026-11-01-macos096-update.md) 的证据边界。Core 精确 Main G1 CI 超时记录与跨类别来源遗漏报告仍未在此版本修复，不能把后续候选补丁追认到此包。Windows/Linux 安装、完整旧客户端自动升级，以及用户对正常资料下新档案界面的最终验收不在本轮通过范围。
