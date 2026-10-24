# 管理中心与设置重做验收

## 2026-10-24 GitHub OAuth 写入与重启验收通过

本节取代下方首次安装的外部阻塞状态。用户已在 GitHub 注册 OAuth 客户端、生成并在真实应用保存凭据、完成授权；本机应用随后完成 **OAuth → 明确标记的测试 issue → 独立回读 → 真退出重启 → 同一回执保留 → 再次回读且无重复创建**。此管理页固定测试子项验收通过，R23 通用 Core grant/Receipt 和其他服务不因此完成。

### 真实故障与修复

- 浏览器实际返回的 loopback 回调包含 `code`、`state`、`iss=https://github.com/login/oauth`，旧宿主因未知 `iss` 参数显示“授权状态无效”。没有把授权码、state、Client Secret 或 token 写入证据。源码 `45abdc9ef920ea5a94fd321c4113f42a93310e25` 仅补上单一、精确匹配的 GitHub 发行方校验；错误/空/重复 issuer、未知参数、伪造 state 和重放继续在 token 交换前拒绝。`iss` 的校验依据 [RFC 9207](https://www.rfc-editor.org/rfc/rfc9207.html#section-2.4)，本次 GitHub 具体取值来自真实回调；无 issuer 的兼容路径仍受固定 GitHub endpoint、state 与 PKCE 保护。
- 新回归先以 `400 !== 303` 复现，再 7/7 通过、0 跳过；独立只读复核重跑同组 7/7 通过，源码和测试副本摘要一致，语法检查及 diff 检查通过。测试使用已安装 OpenConnector `1.6.5` 依赖闭包的隔离副本，没有安装重复依赖。未为这两份 `.mjs` 修改重跑全套/typecheck/lint；下方 2492/40 和 531 项结果属于 `ac693c14` 基线，不能当成本补丁全套结果。

### 本机实际操作

| 操作 | 预期 | 实际结果 |
| --- | --- | --- |
| 修复后从应用点击授权 GitHub | 真实 OAuth 连接，正确账号与 scope | 页面显示 `PIGU-PPPgu · OAuth 已授权`，账号 ID `59789742`，连接 `6ad11879-eac9-4678-8a81-c20f65f9c05d`，`authType:oauth2`，仅 `public_repo`。未使用已有 gh token 代替应用 OAuth。 |
| 应用创建预览 → 确认创建一次 | 固定仓库、明确 TEST 和唯一标记，实际写入后回读 | 创建 [测试 issue #379](https://github.com/PIGU-PPPgu/edupi-desktop/issues/379)，标题 `[EduPi OAuth TEST] 5c4c664a-b81d-41cc-830a-57c8809b689c`，正文仅为测试说明与 `edupi-openconnector-test:5c4c664a-b81d-41cc-830a-57c8809b689c`。应用显示“已创建并回读”，状态打开、创建者 `PIGU-PPPgu`，正文逐项核对。 |
| 读取写入与回读执行记录 | 两次独立 Action 与审计 | 写入 `f69373e7-d729-48d5-997d-9c34365824e1`，首次回读 `9c74b4ea-188a-4e0d-8c1a-e342b7b4d457`；`auditPersisted:true`、`readbackVerified:true`，原生界面显示“已保存并核对”。 |
| 正常退出并重新启动 App | 冷进程恢复同一 OAuth、issue 和回执，无启动重发 | 退出前无运行中的 Agent；正常 Quit 后 App 与 helper 进程为 0，通过原生应用入口重新启动，主进程 PID `13429 → 23413`。冷启动快照和重开的 GitHub 页面保留同一连接、回执、#379、写入 ID 与首次回读 ID，持久 dispatch 仍为 1。 |
| 重启后点击重新读取结果 | 实际 GET 回读，不能再 POST | 回读 ID 更新为 `d69e2c83-7b4e-4550-81a0-e6793911d67c`，写入 ID、issue、回执 ID 和正文保持，审计再次核对。独立只读 GitHub 列表在重启前后均仅有一个本次标记/TEST issue #379；没有重复创建。独立 gh 检查只用于远端核对，不代替应用调用。 |

### 安装、资料与清理

- 唯一 `/Applications/EduPi.app` 仍为本地 `0.3.77` Developer ID 预览。只替换 `open-connector/github-host.mjs` 并重签，server 基线 `ac693c14`、Core03 和其余 **53,588 个文件**内容摘要一致；没有重复构建 Next 或 Rust。Team `BY3XZG2839`，CDHash `579b10bfb551b2b5590bf696ad4f4b1262de31d6`，主程序 SHA-256 `e90925c4cac191eb2d76fe6f3d3adb59061670ffa2894745ef61d11140db73ed`，宿主 SHA-256 `68f245c67faa7cf6efa3b91fda8120f6d618157a64ca253badeba75cd6574425`。安装与原生操作后 strict codesign 通过，原更新公钥保持；未公证、合并或公开发布。
- 重启后实际回读 Core/投影/Kernel ready，正常资料 51 学生、160 任务、24 校历、6 课表，Core `03bbb893bb609eb68513a65cf4fd808ab8aa30ed`，`externalSend:false`。317 个保护文件无增删，教师记录和模型/认证/JEV/GitHub/UI 配置逐字节保持；Runtime 元数据及提醒运行状态文件的变化单列，没有把整棵资料目录记为不变。原会话仅追加 1062 字节、4 条 custom，原前缀摘要保持。新 OAuth 状态在原独立私有目录，Keychain、加密凭据和回执保留。
- 实服验收通过后已删除 `EduPi-before-oauth.app`、`EduPi-before-issuer-fix.app` 和 `issuer-fix-test/` 三个任务生成目录；删除前核对精确路径、两份旧主程序摘要、无进程使用及测试依赖链接目标。删除占用约 **1.81 GiB**，观测可用空间增加约 **1.85 GiB**；本轮临时 App 副本为 0。保留已安装新版、原 `.70` 回退、源码、原数据备份、Keychain、真实 OAuth 回执及证据。
- 本次所要求的 macOS OAuth/写入/回读/真重启/无重复流程已验证。长期 token 到期续期、真实凭据轮换、断网/响应丢失的实服恢复和其他平台未验；隔离测试覆盖不能替代这些实服条件。测试 issue 按用户要求保持公开、打开、明确标记，没有附加关闭或删除操作。

证据沿用本轮私有 `oauth-issue-20261024/evidence/`：`issuer-failure-diagnosis.json`、`issuer-regression-before.log`、`issuer-regression-after.log`、`issuer-installed-preview.json`、`oauth-live-connected.json`、`test-issue-preview.json`、`issue-write-receipt.json`、`receipt-before-restart.json`、`receipt-native-quit.json`、`receipt-cold-start.json`、`receipt-after-restart-read.json`、`remote-before-restart.json`、`remote-after-restart.json`、`oauth-issue-native-acceptance.json`、`issue-after-restart-native.png`、`issuer-data-protection.json` 和 `issuer-cleanup.json`。此前无客户端、无效 issuer 和其他失败记录保留，不计为通过。

## 2026-10-24 OAuth 与测试 Issue 初次安装历史

本节为 `ac693c14` 初装时的历史快照，当前验收以上方 `45abdc9e` 实服结果为准。当时 GitHub OAuth → 明确标记的测试 issue → 应用内结果回读已实现并安装，但客户端和授权缺失，真实流程外部阻塞，尚无连接、草稿、回执或 issue。前轮通过已有 GitHub CLI 登录读取账号的证据不算 OAuth 验收；后续没有据此补称实服通过。

### 已安装代码与边界

- 安装源码 `ac693c14bb80969a0c7d02e63b106ee693a32e9a`，含安全补丁 `ef1a4e3a`；固定 Core `03bbb893bb609eb68513a65cf4fd808ab8aa30ed`。唯一 `/Applications/EduPi.app` 为本机 `0.3.77` Developer ID 预览，复用未变原生壳并替换 server/OpenConnector 资源，6 个原生资源与整 App 重签。Team `BY3XZG2839`，CDHash `8fadb3c3fa8243ac7d0d2914325ba8457bbdf1a4`，主程序 SHA-256 `7247ff850cd8c27e28ecfa02ea4f084d4d804a83d09363648641d3f5f7639a16`。未公证、合并、公开发布或修改 feed。
- GitHub 使用官方 OpenConnector `1.6.5` 的授权码流程，包含 S256 PKCE、state 和仅 loopback 的回调。只请求 `public_repo`；该 scope 是 GitHub 公开仓库读写权限，不能描述为仅 issue 权限。宿主将实际操作进一步固定为公开仓库 `PIGU-PPPgu/edupi-desktop` 的唯一测试 issue，标题为 `[EduPi OAuth TEST] <requestId>`，正文包含 `edupi-openconnector-test:<requestId>`；预览后的确认只提交 draftId，不能替换仓库或内容。
- Client Secret 和 OAuth token 经官方 runtime 的 AES-GCM 密文字段存储；加密钥匙保存在 macOS Keychain，经私有 stdin 进入宿主，不返回 WebView、日志或模型。未将整个 SQLite 文件称为加密数据库。长期状态仅保存公开账号、授权状态和脱敏回执，目录 0700、状态文件 0600。
- 写入前保存 pending 回执并持久化独占 dispatch 标记；未知结果只按标记查询恢复，不重发 POST。创建后独立调用 `github.get_issue`，核对仓库、编号、标题、正文、作者、标记和两次执行的审计。此处是管理页手动测试边界；生产 Agent 的旧执行入口和 Core `external_send:false` 保持，R23 通用 Core grant/Receipt 尚未完成。

### 本轮实际检查

| 操作 | 预期 | 实际结果 |
| --- | --- | --- |
| 真实安装 App 打开连接 → OpenConnector → GitHub | 展示 OAuth 客户端配置，初始化真实 Keychain 与宿主 | 原生页面实际显示 Client ID、保密 Client Secret 字段和 loopback 回调；Keychain 初始化成功。只诊断固定条目元数据，未读取或输出钥匙值。当前 `clientConfigured:false`、OAuth 未授权。 |
| 已安装宿主的 HTTP 边界 | 伪造 OAuth 回调与直接 HTTP Action 被拒绝 | 伪造 state/code 返回 400，Action 路径返回 404；无 query 的静态完成页为 200，属于预期落地页，不是授权成功证据。 |
| 真实 OAuth、测试 issue 创建与回读 | 原生授权后确认一次，产生真实 issue 与可重新读取回执 | **外部阻塞**：GitHub 个人 OAuth Apps 页面未有可用客户端，应用未配置 Client ID/Secret；已交接用户生成/填写新凭据并确认 `public_repo`。没有借用旧 gh token 冒充 OAuth，没有实际 issue URL/编号或写入执行 ID。 |
| 源码与依赖检查 | 受影响行为与安全补丁通过检查 | `npm test` 为 2492 通过、40 环境跳过、0 失败；本功能及组件定向 531 通过、0 跳过、0 失败；`tsc --noEmit`、完整 lint、diff 检查通过。独立复核 23/23，manager 7/7；另验取消 token 交换不存连接、48 小时重启同请求仅一次 POST。这些使用隔离数据，不代替真实 GitHub 验收。 |
| 准备资源、签名与清理后启动 | 已安装 App 自包含，正常资料可继续使用 | 完整 `desktop:prepare`、包内启动/Core、目录/inspect/旧执行阻断通过；安装与清理后 `codesign --verify --deep --strict --verbose=2 /Applications/EduPi.app` 均通过。清理后实际 API 回读 Core/投影/Kernel ready，51 学生、160 任务、24 校历、6 课表。 |

### 安全、数据和清理

- Next `16.4.3`、DOMPurify `3.4.17`、Hono `4.13.13`、ip-address `10.7.4` 消除本轮发现的严重/中危依赖公告；最终 `npm audit --audit-level=high` 通过，仍有 6 条既有数学渲染链低危公告。eslint-config-next 保留原 `16.3.8`，其 react-hooks 精确固定原 `7.0.1`；尝试升级导致的 18 条既有模块 lint 失败保留日志，没有关闭规则。
- 317 个保护文件无增删，模型、认证、JEV、GitHub CLI 和 UI 配置逐字节保持，教师记录文件保持。Runtime 元数据随启动更新；一个原会话追加 531 字节、2 条 custom，原前缀摘要保持。提醒运行状态文件从 430776 变为 430674 字节；记录到旧 App 在安装前的正常 notification_claimed/deferred 活动，已单列变化，不把整棵 `.edupi` 记为字节未变，也未回写真实提醒来消除差异。
- 已精确删除 7 个可重建目录：Desktop/Core 两处本轮依赖、`.next-desktop`、生成的 server、Pi Agent Server、Core 和 OpenConnector 资源。删除目录占用约 3.60 GiB，观测可用空间增加约 3.70 GiB；安装资源无外部依赖符号链接，已安装 App、源码、Keychain 与 OAuth 状态保留。
- 当时保留临时回退 `~/edupi-install-checkpoints/settings-redesign-20261023/oauth-issue-20261024/EduPi-before-oauth.app` 等待真实 OAuth/写入验收；该条件已由上方实服结果满足，副本现已删除。原 `.70` 回退 App 与原私有数据备份继续保留。
- 前轮 JEV 原生连接成功证据仍有效。本轮依赖升级后已安装后端真实测试返回 200、`jev-1.14.0`、535ms；这是后端回归，没有再计一次原生 JEV 按钮验收。

初装时 Client Secret 保存、GitHub OAuth、issue 创建与回读、真重启回读均未验；后续已由用户按浏览器 credential hand-off 规则完成新凭据填写，并在上方真实应用流程逐项通过。真实 OAuth 凭据轮换/网络中断及 Windows/Linux 仍未验，不能把当前 macOS 结果扩展到这些条件。

私有证据根：`~/edupi-install-checkpoints/settings-redesign-20261023/oauth-issue-20261024/evidence/`。主要文件：`installed-preview.json`、`installed-client-setup.json`、`oauth-setup.png`、`after-cleanup.json`、`after-cleanup-oauth-state.json`、`after-cleanup-signature.json`、`packaged-oauth-host.json`、`final-tests.log`、`all-tests-after-deps.log`、`types-final.log`、`lint-final.log`、`audit-final.log`、`data-protection-final.json`、`reminder-operational-summary.json`、`cleanup.json`。其中首次过宽的数据摘要比较及静态完成页负测的原始失败保留，后续记录已明确修正判断。

## 2026-10-24 JEV 与 GitHub 只读续验历史

本节记录前轮 JEV 连接修复和通过本机已有 GitHub CLI 登录执行固定只读调用的结果；当前安装和新增 OAuth/写入状态以上方记录为准。R23 通用外部执行、其他服务和跨平台不因此完成。

- 安装源码 `468f82e8c99414ed7ebb6df1773cb71b3d1b6d3e`，固定 Core `03bbb893bb609eb68513a65cf4fd808ab8aa30ed`，版本仍为本地预览 `0.3.77`。完整 `desktop:prepare` 通过；复用未改动的原生壳，替换本轮生成的 server/OpenConnector 资源，6 个原生资源及整 App 重新 Developer ID 签名。Team `BY3XZG2839`、CDHash `45d22da015f6c806028a1c9388c01ac34263cd90`，主程序 SHA-256 `0b532d475cfede13ee601d7022c532e74b97061e02b9ba63abc44ebc8f4d54e1`。唯一安装路径 `/Applications/EduPi.app`；未公证、未公开发布或修改 feed。
- JEV 451 已定位：同一密钥的 Python 默认 macOS 网络请求返回有效模型/选择结果；Node 直连的响应明确为 `Typesafe is not available in your region.`。系统已有本机 HTTP 代理 `127.0.0.1:7897`，Node 原来只读取代理环境变量，没有使用该系统设置。读取既有系统代理并传入 Undici 后，源码真实请求返回 200；已安装 App 的“AI 与模型 → 浏览器决策 → 测试连接”显示 **连接成功 · 1198ms**。未更改系统代理、节点、DNS、密钥或 JEV 配置。
- OpenConnector 已连接本机 GitHub 登录 `PIGU-PPPgu`。应用内先显示账号和读取范围；第一次进入确认页后取消，实际回执数仍为 0。再次确认 `github.get_current_user`、输入 `{}` 后真实调用成功，显示账号 ID `59789742`、公开仓库 `42`，执行 ID `cc322af0-dec0-4452-bb71-b21f4315249e`，并显示“审计已保存并核对”。调用经过固定上游 1.6.5 的连接 API、Action API 和按 executionId 的审计回读。
- 正常退出并通过 Launch Services 真正重启，原生 App PID `84597 → 93715`；同一账号、连接 ID、第一份回执和执行 ID 均在页面重新打开，回执数保持 1，无启动自动重发。重启后再次明确确认读取成功，第二份执行 ID `38c800ce-2b83-4992-bfc6-a499f5e4894e`，总回执数为 2。
- 这是管理页固定只读验证：只允许读取当前 GitHub 账号，其他 Action 和通用代理保持阻断；生产 Agent 的旧执行门未打开。凭据从本机已有 GitHub CLI 登录取回，经 stdin 进入一次性加密 runtime，结束删除临时数据库；长期仅存账号、凭据指纹及脱敏回执。实际状态目录权限 0700、回执 0600。规格见 [R23 管理页验证边界](../architecture/R23-external-action-authority-spec.md#管理页-github-只读验证)。
- 最终源码 TypeScript、完整 lint、diff 检查和 528 项组件/定向测试通过，0 失败、0 跳过；独立只读复核通过。覆盖真实上游 runtime 的隔离认证/Action/审计、写入阻断、加密无明文、请求去重、凭据轮换拒绝、unknown 恢复和代理生命周期。签名包启动/Core、目录/inspect/旧执行阻断通过，原生操作后 strict codesign 再次通过。
- 正常资料的 Core/投影/Kernel 重启后 ready，51 学生、160 任务、24 校历、6 课表保持。317 个保护文件无增删；模型、认证、JEV、GitHub CLI 与 UI 配置逐字节保持。Runtime 元数据随启动更新，原会话追加 1062 字节、4 条 custom，原前缀摘要保持。首次严格文件比较发现提醒文件增加 18 字节，已确认仅是既有到期提醒在正常轮询时补入 `withdrawn:false`；只在内存去除该字段后，整文件 SHA-256 精确匹配本轮基线。没有修改教师业务记录来消除差异。
- 清理本轮 8 个生成目录：Desktop/Core 重装依赖、`.next-desktop`、生成的 server/helper/Core/OpenConnector 资源和上一份 `.77` 临时预览。删除目录占用约 4.51 GiB，观测可用空间增加约 4.60 GiB；保留已安装新版、一份原 `.70` 回退 App、源码、原始备份与验收记录。安装资源无外部依赖符号链接。
- 本次未验：GitHub OAuth、新密钥录入、其他服务和写入 Action、真实凭据轮换/网络中断，以及 Windows/Linux。本地用量授权、系统通知、手机继续沿用原未验状态；JEV 直连仍受上游地区限制，当前成功路径使用用户已有系统代理。

私有证据根沿用 `~/edupi-install-checkpoints/settings-redesign-20261023/evidence/`：`jev-451-diagnosis-live.json`、`jev-451-node-diagnosis.json`、`jev-system-proxy-source-live.json`、`jev-installed-native-success.json`、`github-installed-connected-cancelled.json`、`github-installed-after-execute.json`、`github-installed-after-restart.json`、`github-installed-after-restart-read.json`、`connection-followup-protection-final.json`、`connection-followup-reminder-normalization-proof.json`、`installed-connection-preview.json` 和 `connection-followup-cleanup.json`。原生 AX/截图操作记录在本聊天。

## 2026-10-23 首版预览历史

- 2026-10-23 当前状态：新版已安装并运行于唯一 `/Applications/EduPi.app`，已切回教师正常资料。R14 本次管理/设置页面、R23 的配置保存与只读目录交互已通过本机原生验收；JEV 真服务连接仍为外部阻塞，不能计为连接通过。R14/R23 的其他路线图欠项不因此完成。
- 当轮源码 `f3c09cd653245f26013c59f1cddf6c4e3538c2bb`，分支 `codex/settings-admin-redesign`；初版实现 `b86569fb` 和字段上限修复 `19ac62f8` 保留历史。固定 Core `03bbb893bb609eb68513a65cf4fd808ab8aa30ed`，版本 `0.3.77`。
- 本地 Developer ID 签名预览，Team `BY3XZG2839`，CDHash `4f2bc0e81b5f3f97d601dc842a0e056b7b0c59ea`，主程序 SHA-256 `687d3f5e5af805d17f6b5bfc65977a81005b48674b7d73a58dc9f1e77cc9c5b7`。保留原 updater 公钥；未公证、未合并、未公开发布或更新 feed。
- 私有证据与回退副本在 `~/edupi-install-checkpoints/settings-redesign-20261023/`。隔离验收根 `~/edupi-route1-canary-settings-20261023` 仅复制 JEV 自身配置/凭据；正式资料下没有提交合成教师或学生记录，也没有调用对话模型。

## 本机安装操作

| 操作 | 预期 | 实际结果与证据 |
| --- | --- | --- |
| 本地构建、嵌套资源签名、替换唯一安装路径 | 新 UI 与固定 Core 同包，保留旧 App 和更新公钥 | 完整 Next/13309 文件 Core 打包、两轮包内服务/目录检查、原生 arm64 编译和 strict codesign 均通过。最终签名包实际安装；`evidence/installed-final-preview.json`、`final-app-runtime.log`、`final-app-openconnector.log`。 |
| 原生设置中的明暗、语言、天数、更新、教师资料取消与权限读取 | 可操作、可返回、设置真正持久化 | 深色/5 天保存后真正退出重启，页面回读深色/5；恢复浅色/3 天、中文。更新检查有忙碌/完成态；教师信息“编辑 → 手动填写 → 取消 → 关闭”正常；权限重新读取显示当前应用已授权，未新增权限或开放手机网络。原生截图/AX 操作记录在本聊天。 |
| 原生 AI 与模型中的 JEV 保存与重启回读 | 只更新配置，密钥不显示；保存值跨进程保持 | 超时 3000→4000 保存并在真实重启后回读 4000，再恢复 3000；密钥始终为占位提示，原 auth/JEV 配置摘要不变。`isolated-after-jev-save.json`、`isolated-after-restart.json`、`final-isolated-state.json`。 |
| JEV 真服务测试、超时与重试 | 明确区分配置与连接状态，失败后可以重试 | 上游实际返回 HTTP 451；最终包首次 3000ms 测试超时，随后单次重试显示“JEV 服务返回 HTTP 451，请联系服务提供方”。连接未通过。修复测试期限未读取保存配置和错误原因过泛；真实 loopback 的 451/100ms 超时回归先红后绿，未记录上游正文或密钥。`jev-upstream-status.json`、`jev-route-regression-before.log`、`jev-route-regression-after.log`。 |
| 连接 → OpenConnector → npm → 操作搜索 → 参数 → 返回 | 不弹独立窗口，目录与参数真实可用 | 最终安装包在页内显示 1554 服务；搜索 npm 得 1 服务，读取 8 操作，搜索 get_package、打开 npm.get_package，显示必填 packageName，再返回列表。正常资料下也实际读到同一目录。没有运行账号写入或 Action。 |
| 正常资料升级、受控恢复与重启 | 教师业务与模型配置保留，正常 Core 就绪 | 首次正常启动遇旧目录绑定不符；只读检查确认 APFS 合法、两库旧指纹一致且恢复状态 stale。经应用内“修复 Core Runtime”事务备份并重绑后，Core/投影/Kernel ready；再次真正重启仍 ready，51 学生/160 任务/24 校历/6 课表、17 个模型与默认模型保持。`normal-root-diagnostic.json`、`runtime-table-repair-comparison.json`、`final-normal-restart.json`、`normal-model-status.json`。 |

## 数据保护

- 正常启动前保留完整旧 0.3.70 App、教师 `.edupi`、六份配置和 WebKit 备份。隔离验收后的 310 个保护文件逐项完全一致。
- 正常恢复后业务文件、模型/认证/JEV 文件、原 UI 偏好均保持；Runtime 变化为两库指纹与进程元数据，表级比较仅 `authority`、`runtime_meta`、`admission_meta` 变化，原表行数保持，并新增自动修复备份及 SQLite 工作文件。
- 原会话追加 1062 字节、4 条 `custom` 事件，原字节前缀 SHA 保持；未将整个根宣称为未变化。完整记录为 `evidence/final-data-protection-proof.json`。

## 开发页历史操作

| 操作 | 预期 | 实际结果 |
| --- | --- | --- |
| 从隔离工作区的“打开管理中心”进入，切换概览、工作与资源、AI 与模型、连接、设置、系统 | 同一导航内完成管理与设置；概览含自动运行；各页可返回 | 七个入口同处管理工作区；概览内显示准备状态和自动运行；资源改为分行列表；系统页只呈现运行健康与兼容性。隔离 Core 的 `/api/edupi/workspace` 返回 503，故未把真实运行数据记为通过。 |
| 在 AI 与模型切换“对话模型”与“浏览器决策”，临时改写 JEV URL 再切回 | JEV 与对话模型同页；未保存草稿不丢 | JEV 表单在类别切换后仍保留临时 URL；测试结束已恢复原输入，未提交设置。API Key 仍只通过服务端接口保存。 |
| 打开连接页的 OpenConnector | 直接在本页展示，只读目录且不再自动启动原生弹窗 | 管理导航直接渲染目录组件；非 Tauri 开发浏览器显示“仅桌面应用可查询”的紧凑状态，没有新窗口。桌面目录查询、操作搜索与参数查看需安装版复验。 |
| 查看设置页和 800×900、520×800 窗口 | 更新、偏好与设备设置在同一管理页；无横向裁切 | 设置页显示版本检查、语言、外观、教师信息和前台收起；非桌面环境隐藏空的设备分组。800 与 520 视口的 `body.scrollWidth`、`documentElement.scrollWidth` 均等于视口宽度。520 像素下 AI/JEV 与连接页均可操作，返回按钮保留可访问名称。 |

## 检查与边界

- 最终源码 `tsc --noEmit`、`npm run lint`、`git diff --check` 通过；组件、JEV route/provider/settings 合计 484 项通过、0 失败、0 跳过。两项新增连接错误/超时回归先失败后通过。初版的 460/29 项记录是历史结果，不替代原生操作。
- 最终包的嵌套资源签名、strict codesign、包内 Core/投影 ready、OpenConnector provider/search/inspect 与执行阻断均通过。原生操作后再次 strict codesign 通过。
- 早期开发页的 Core 503 保留为历史失败；固定完整 Core 资源后，包内与真实资料的运行证据以上方记录为准。
- 未验证 JEV 真服务成功响应、OpenConnector 账号/OAuth/Action、系统通知点击、手机第二设备、Windows/Linux 原生界面；本地预览没有 Apple 公证或公开升级发布证明。
- 最后显示动作的锁屏阻塞已解除：用户回复“已解锁”后，CUA 重新绑定唯一安装 App，原生 AX 回读确认设置页为 0.3.77、浅色、中文、3 天及正常资料目录；执行窗口 `Raise` 后截图成功，设置页已显示。此前 `IOConsoleLocked=Yes` / `cgWindowNotFound` 保留为历史限制，不再是当前阻塞；`evidence/final-display-state.json` 记录最终状态。
- 最后原生回读的“本地用量”显示“未收集 / 教师授权尚未就绪”；本次没有将用量授权或采集流程计为通过。

## 生成产物

- 初版开发页的 `.next/`、重复依赖与 `/tmp/edupi-settings-ui.pUeiUj/` 已在上一轮清理，约 2.1 GiB；本轮新的精确清理结果记录于 `evidence/cleanup-products.json`。
- 本轮已删除 `.next-desktop/`、`src-tauri/target/`，资源目录中的 `server/`、`Pi Agent Server.app/`、`edupi-core/`、`open-connector/`，Desktop/Core 两处重复依赖、任务 Cargo 缓存、第一预览 App 与隔离资料/状态。15 个生成目录及一个签名探针已回查不存在；另将两份旧 App 合并为一个回退副本。合计目录占用约 8.21 GiB，实测可用空间增加 7.40 GiB；两个源码工作树保持，原 Core 脏工作树未改动。
- 保留已安装新版、一个旧版回退 App 和本任务私有数据/偏好备份，供本机预览确认后回退使用；不删除其他任务、真实资料、原 Core 脏工作树或废纸篓。
