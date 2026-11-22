# 智学网 Desktop 登录桥接验收

## 2026-11-23 macOS 0.3.123 安装验收与正式发布

`0.3.123` 于北京时间 11 月 23 日 01:31 发布到 Apple Silicon Mac 正式渠道。Release `454539958` 的公开 DMG 与安装验收使用的资产 ID 和 SHA-256 一致。正式 tag 指向 `adee2798c6b43a3602e7e5627489388d0228b6db`，更新源提交为 `3095c318335ff9a6138e560d2bc5129851400433`。匿名 Latest API 确认为正式版，公开 DMG 的前 64 KiB 返回 HTTP 206，Mac 更新元数据指向本次签名更新包。[正式 Release](https://github.com/PIGU-PPPgu/edupi-desktop/releases/tag/v0.3.123) · [发布流程](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/45049885288)

在隔离的 GitHub macOS 15.8.2 arm64 上，签名 App 打开合成聊天后显示等待提示和二维码。收到合成扫码成功回执后，聊天显示「已确认登录。同步前请确认班级、学科和学段。」，关闭扫码窗口后仍可见。退出并启动新进程，探针从侧栏重开原对话，同一画面出现原消息与登录结果，旧二维码与扫码入口已撤下。重启后的首次快照未观察到自动回到原对话，两次启动使用同一端口。合成资料及测试 App 在验收结束后清理。[安装证据](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/45049371990)

老师亲自扫码、真实班级学情同步和回读、旧安装版在 App 内自动升级、完整 L4 仍待验收。

GitHub 发布机器验证了公开更新源，本机通过 GitHub API 核对到源文件与 Release 的 `latest.json` 摘要一致。本机直读更新地址遇到连接重置或超时，公开 DMG 下载检查通过。

此前的正式版 `0.3.122` 在实际会话中收到了扫码成功回执，随后查到同步缺班级、学科和学段。重复查询被拦截后，聊天没有显示结果，同步没有开始。签名 `.122` 对照验收 `45029680645` 同样在打开合成对话后未看到等待提示。

#517 合并提交 `5c7ae60feedc422f242b1b492b2fc097e75be618` 的源码检查 `45000809380` 通过。早期签名 `.123` 在 GitHub Mac 的原生 App 中显示了等待提示、二维码、扫码成功与待配置信息，关闭扫码窗口后提示仍留在聊天中。冷启动验收 `45032543101` 在默认首页等提示后超时，未走到打开原对话的步骤。两次启动的端口均为 `38471`，测试未验证原对话回读。

复验候选 `adee2798c6b43a3602e7e5627489388d0228b6db` 来自 #517，带上主线 `5168149e` 的 Rust 依赖修复和两份验收脚本。签名构建 `45037880876` 使用 GitHub `macos-15` Apple Silicon runner，固定 Core `fc89b3bc899a55b0fdad61b8f37e238d950f37c6`。修订后的安装探针 `0fbff47fe20032b2c934670695090791fa6c19b3` 从「AI 协作」重开原合成对话，按需点击「查看扫码结果」，要求同一画面出现原消息和登录结果，并确认旧二维码及扫码入口已撤下。

11 月 23 日 00:03（北京时间），签名构建首次尝试因 `codesign` 未取得 Apple 时间戳，在签署 `darwin-platform.node` 时失败，未生成可验收 DMG。保留首次失败，第二次仅重跑同一提交的失败作业。

第二次构建通过配对 Core、包内运行、代码签名、公证和更新包验签。最终 DMG 资产 `779850956` 为 `242544070` 字节，SHA-256 为 `2dcf30d5af18886dbb6fc939343be049017c3e7cbdacbc97054a3bb2b4893de8`。发布前固定三份 Mac 资产的指纹 `sha256:0da35e9b9440e1c563256dd30cf8a646c21dff8dded397925ed09221bbed249a`。`url` 和 `form_urlencoded` 对应的锁文件与 Rust audit 通过的 #518 受测版本逐字节相同，早期审计失败的历史记录保留。[签名构建](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/45037880876)

本机已清除停用试构建 worktree 的 `src-tauri/target`，清理窗口实测可用空间增加约 3.5 GiB。该 worktree 的 `.next-desktop`、生成的 `server`、`Pi Agent Server.app` 和 `open-connector` 已移入废纸篓。清理前确认路径受 Git 忽略、没有跟踪文件和打开的文件句柄。旧验收证据、源码草案和本机 `.122` App 保留。

## 2026-11-22 扫码状态修复

11 月 22 日 12:03（北京时间），已安装的 `0.3.122` 收到了真实扫码成功回执，并查到同步尚缺配置。该轮在重复查询被拦截后结束，聊天未显示结果，也未启动同步。PR #516 已合入 `236eaf2dd66848848bd6d2ad87c63d9349733004`，给被拦截的模型一次收尾机会。本次修复让聊天直接显示工具回执，短路或结束的回复也有明确状态。

- 用实际 Pi SDK 和隔离文件复现重复查询，重开会话后确认保存了扫码成功与待配置状态。聊天组件回归验证同一轮可见，两次查询拦截继续有效。
- 在本机 Ego Lite 中运行真实扫码组件和状态接口，以合成回执验证打开提示、延迟二维码、确认登录、缺配置提示、旧扫码流程退场和超时。组件回归还覆盖旧 WebView、关闭后不反复弹窗、切换聊天时取消请求。保护二维码的接口校验本机地址、桌面令牌和流程编号。
- 同步 worker 的失败会关联发起同步的登录。相同登录失效时提示重新扫码，新登录不受旧回执影响。缺班级、学科和学段时显示待配置。既有同步文件保留。
- 完整源码测试 4,953 通过、57 条条件测试跳过。首次并行测试出现超时及 OCR 空结果，降低并发后通过。类型检查、lint 和 npm 安全审计通过，lint 有一条既有未使用变量警告。

验收范围为开发版与隔离数据。包含此修复的 macOS 签名 DMG、实际教师账号扫码后同步、登录态冷启动回读和学情写入仍待验。Ego Lite 用于本机界面验收，EduPi 仍使用自己的隔离 Chrome 会话。完整 R04／L4 继续待验。

## 结果

本轮完成智学网扫码登录桥接、可配置基础学情同步桥接的 Desktop 接线和 macOS DMG 构建。

- Desktop 提交：`cec89e2be9ef2bc1b73d704aac1b5dcb0689007e`
- 安全收紧提交：`6d54c7835ebea9b7ff9cbb2317a6a3d7638f8424`
- 绑定 Core：`fc89b3bc899a55b0fdad61b8f37e238d950f37c6`
- DMG 交付文件：`EduPi_0.3.120_aarch64.dmg`
- DMG SHA-256：`ce4af04dd75c28145c4a6fcfb9d767143e3dae17f3ba4140f586b14aafa66c71`
- DMG 大小：`242493309` bytes
- 正式 Release：`v0.3.120`
- GitHub Actions run：`44726825034`

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
- `v0.3.120` 已公开为 macOS-only Latest Release，资产只有 DMG、updater tar 和 `.sig`。
- 未构建 Windows。

DMG 作为本轮待验收产物保留在本地交付目录。完成真实账号验收或清理本轮构建时再删除该文件及对应的生成资源。

本轮验收结束后已删除 `.next-desktop/`、`src-tauri/target/` 以及 staged server、Core、Node 和 OpenConnector 生成目录，保留最终 DMG。
