# 智学网登录与电脑操作

## 2026-11-04 `.105` 原生观察失败并回退，`.106` 修复候选

用户正常退出 `.104` 后，以唯一 `/Applications/EduPi.app` 原位安装同轮验签的 `.105` Mac 包；安装位的 strict codesign、Apple 装订和 Gatekeeper 通过。安装前备份真实资料及 Pi 配置，记录 346 个受保护文件与 3 个 WebView 来源；安装后 346 项逐字节摘要不变。隔离根 `edupi-route1-canary-computer-105-20261104-489b0f` 与实际 App/Core 双进程环境守卫通过，独立本机合成模型在可见 AI 对话中真实调用 `edupi_computer_use({"action":"observe"})`，原生逐次确认窗实际出现。

第一次等待人工点击超过 45 秒，Pi 工具返回误导性的“EduPi 桌面窗口未连接”，原生审计没有该次执行。新会话第二次在约 19 秒内由老师亲自允许，原生审计记录 `observe` 已开始并在约 284 毫秒后以错误结束；实际错误为 `AXFocusedApplication has no value: kAXErrorNoValue (trusted=true)`，没有截图或 `snapshot_id`。因此 `.105` **安装版电脑操作未通过**，Release `433119481` 保持 Draft，不能按源码测试推断可用。隔离 App 已正常退出，3 个 WebView 来源恢复到备份，唯一安装版按原二进制摘要、签名、公证和 Gatekeeper 回退 `.104`，安装后、隔离运行后、回退后的 346 项真实文件均与安装前一致。私有证据 `~/edupi-install-checkpoints/v0.3.105/evidence/native-observe-105-failure.json` 与原生审计记录保留；没有新扫码或学情拉取。

`.106` 源码只针对这一原生缺口：NomiFun 在 macOS 已授权而焦点应用无值时，经**同一次原生允许**退回截图，返回像素坐标与新快照；失败的读屏会使旧快照失效，权限拒绝、其他 AX 错误、截图失败及超期请求仍失败关闭。`observe`／`screenshot` 的人工确认期限为 90 秒，过期或断连不再误报确定的“窗口未连接”；模型提示在只有截图时使用坐标而非元素 ref。本机 `computer_use::tests` 8/8、Pi 桥接与工具定向 13/13、类型、目标 ESLint、单文件 rustfmt、组件版本核对通过；全仓 cargo fmt 因既有 vendored 文件差异未作为本轮门禁。`.106` 尚需源码 CI、Mac-only 签名 Draft、同身份原位安装及原生截图／快照复验。此段取代下方“`.105` 待原位安装”的阶段状态，Windows/Linux 仍不构建。

## 2026-11-04 `.105` 已签名待原位安装

Desktop [PR467](https://github.com/PIGU-PPPgu/edupi-desktop/pull/467) 和 [PR468](https://github.com/PIGU-PPPgu/edupi-desktop/pull/468) 已合 main `9c2cc154d4ac7ef44a6a6e047daab7460e40dcda`，固定 Core `008d3e63cc1ab4fa2adfba4817241720408dc6fb`；版本 PR 的三项源码 CI 成功。唯一 [Mac-only Draft run41702073796](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/41702073796) attempt1 成功，Release `433119481` 保持 Draft；最终 DMG／更新包／签名资产 ID `706975224/706936153/706936812` 均完整下载并按大小和 SHA-256 核对，Mac-only 指纹 `sha256:48527954c77980d1879da3fff6a0459aab1a5df3b8dd954f29fa33ba0c4259ed`。App／DMG 公证 Accepted（`37d0e3fc-919b-4ec3-a4eb-74ca894c9523`／`1d0fdaea-46e2-406c-ac37-0d9dce082220`）、装订、strict codesign、Gatekeeper、Minisign／篡改拒绝，DMG 与更新包 App 同身份和 18 项固定源码文件均通过；`draft-proof` 因仅构建 Mac 按 workflow 跳过。证据在私有 `~/edupi-install-checkpoints/v0.3.105/evidence/`。

目前唯一 `/Applications/EduPi.app` 仍为运行中的 `.104`；已请用户保存并正常退出，**尚未安装 `.105`、未做原生 observe、未重新扫码、未公开 Release 或切换 feed**。签名 DMG、更新包、`.104` 当前安装位及真实资料均保持。此段取代下文 `.105`“尚未自身 CI／签名”的阶段状态；后续原位安装和权限验证仍需实际证据。

## 2026-11-04 源码候选

老师的真实 EduPi `.104` 会话中，近期 14 次 `edupi_computer_use` 全部只传 `action=status`，实际状态回执已显示桌面控制、辅助功能和屏幕录制均开启／授权；没有一次 `observe`，所以 Agent 声称“直接上手”时并未看到桌面。该 App 的工具提示原先要求先查 status，又要求网页交互使用“受管理浏览器工具”，但当前会话没有调用此类工具。Desktop 源码现让明确的电脑操作请求优先 `observe`；status 回执明确说明没有看屏幕，给出下一步工具参数；已打开的浏览器可由现有 NomiFun 操作，仍保留每次原生确认、快照绑定及拒绝外部 URL 的边界。本轮没有拷入另一套 GUI；当前已 vendored 的 NomiFun 来源固定在 `src-tauri/resources/third-party/nomifun/SOURCE.md`，智学网代码使用 Playwright。

同一会话中的 `zhixue_login` 曾返回二维码，日志在 2026-11-04 02:07 北京时间记录服务端登录成功；之后 `zhixue_sync` 多次返回“正在进行”，实际状态文件为 `error`。代码原因是 `syncRunning()` 只看十分钟内的时间戳，把 `error` 也当运行中；登录、检查、同步共用一个 Playwright 持久 Chrome profile，日志出现 `ProcessSingleton` 冲突；旧 `zhixue_check.js` 在 `try` 中直接 `process.exit`，`finally` 的浏览器关闭不会可靠执行。当前本地自定义扩展已改为运行状态加 PID 判定、登录与同步互斥、独立查询扫码／同步状态，登录检查先关闭 context 再退出且不删除过期会话快照。Desktop 同一教师请求的登录和同步各限一次。

本机自定义代码与原 `session.json`／`cookies.json` 已在私有 checkpoint `~/edupi-install-checkpoints/zhixue-login-computer-20261104/backup/` 按 SHA-256 备份；只修改 `extensions/zhixue_bridge.ts`、`scripts/zhixue_sync.sh` 及 `data/zhixue/scripts/` 下的 `zhixue_check.js`、`zhixue_login_headful.js`、`zhixue_login.js`、`sync_zhixue.js` 六个代码文件，真实会话令牌与 Cookie 文件的内容未改。备份、测试与差异未进入 GitHub。模拟 Playwright 的有效／过期两条路径均证明 context 先关闭，过期快照保留；合成同步脚本证明先写 `running` 再写终态；隔离扩展测试证明登录占用时不抢 profile，旧 `error` 不再伪装运行。本机把原令牌快照复制到私有临时 profile，对智学网服务端连续两次校验均为有效，分别约 4.3／2.7 秒，两个 Chrome 进程均正常退出；原会话文件字节不变，临时克隆已删除。以上只验证当时的登录有效性和同步入口，**未拉取真实学生数据，也未用真实模型触发 native observe**。

后续在 2026-11-04 03:34 北京时间，同一备份快照的隔离服务端复查返回登录已过期，故并未启动数据拉取；保留旧有效结论的发生时间，不把它外推到当前。失败的私有克隆经无句柄检查已清除。另发现真实 `session.json`／`cookies.json` 原为 `0644`、资产目录为 `0755`；在逐字节私有备份后仅将两文件收紧为 `0600`、目录为 `0700`，文件内容 SHA-256 未变，并给本机自定义登录／同步脚本的新建凭据文件加上同样的私有权限。确认原件保持后，又只删除本轮新建的两份凭据备份副本，保留代码备份与哈希记录；相关回执在私有 checkpoint 的 `credential-permissions-after.json`、`credential-copies-cleanup.json`、`live-sync-clone-result.json`、`cleanup-sync-clone.json`。这一轮不声称真实学情已刷新；需要一次新的扫码才能继续实际同步。

为验证模型选择而不读取真实屏幕，另以只含合成桌面工具的隔离 Pi 会话向现有 `magpie/workbuddy/auto` 发了一次合成请求；模型的**第一个工具动作就是 `observe`**，随后完成回复，未进入真实 Native/TCC 或读取教师资料。临时复制的模型凭据目录在会话结束后删除，仅保留不含凭据的动作序列回执 `workbuddy-observe-result.json`。这证明新工具提示在该隔离请求下生效，安装版原生弹窗与长期真实会话仍需单独验。

Desktop 电脑操作／防重复源码 [PR467](https://github.com/PIGU-PPPgu/edupi-desktop/pull/467) 已合 main `6d866f3d33230aa7cceb8f2a02ce2a616413204a`。主要改动 head `5ec3bccc` 的[手动源码 CI41698331354](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/41698331354) 三项成功；后续只补权限未知时仍引导 observe 的 1 行判断与目标测试，最终 PR head `2e6af44c` 的 6 项目标测试、类型和差异检查通过，没有把旧 CI 冒充最终 head 的 CI。主要改动本机目标测试 10/10、完整 `npm test` 3562 通过／48 条件跳过／0 失败、类型、release:verify、lint 0 错误／1 条既有警告通过；最终 `.105` 工作树的 Mac `desktop:prepare` 重新完成并固定 Core `008d3e63` 的 13,337 文件闭包，隔离 staged 冷启动 Core 与投影 ready、`externalSend=false`。当前唯一 `/Applications/EduPi.app` 仍为运行中的 `.104`；`.105` 版本候选尚未自身 CI、签名、安装或公开。Windows/Linux 本轮不构建。后续需 `.105` 精确源码 CI 与 Mac-only 签名，再在隔离安装版验证原生 observe 确实弹确认并返回快照；真实智学网数据刷新须另按最小权限和资料保护执行。
