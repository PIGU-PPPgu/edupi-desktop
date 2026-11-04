# 智学网登录与电脑操作

## 2026-11-05 `.107` Mac 安装与受控续验

源码 [PR471](https://github.com/PIGU-PPPgu/edupi-desktop/pull/471) 合 main `80066ecbff5cda4e24328094add884339745228d`，固定 Core `008d3e63cc1ab4fa2adfba4817241720408dc6fb`；[Mac-only 签名 run41812467078](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/41812467078) attempt1 的三项资产及指纹仍与下节相同。老师正常退出 `.106` 后，以唯一 `/Applications/EduPi.app` 原位安装验签的 `.107`；安装位版本、strict codesign、装订、Gatekeeper、二进制和 CodeResources 与已验 DMG App 一致，`.106` 原包保留在私有回退目录。安装前备份真实 `.edupi` 178 文件、Pi 会话 164 文件、4 份配置，合计受保护 346 项；**文件安装后 346/346 字节不变**，3 个 WebView 来源亦先行备份。

**原始全程资料门失败，不能追认为通过。**首次测试虽把 `EDUPI_DATA_ROOT`／`EDUPI_PROJECT_ROOT` 指向合成根，却漏传 Tauri 要求的 `EDUPI_ROUTE1_ISOLATED_CANARY=1`，导致 App 使用普通桌面私有状态目录；点隔离班级试用后该目录出现两份指向合成根的 `edupi-proactivity*.json`。其后在原生 Quit 后读取旧 CUA App 绑定，工具重新启动了默认普通 App 及 DingTalk bridge。原 346 项中有 5 个真实根运行态文件变化：`dingtalk_bridge_status.json`、`runtime_events.jsonl`、`runtime_state.json`、`runtime_state.json.bak`、`core-runtime-writer-admission-v1.sqlite`；其他 341 项包括学生档案、Pi 会话和模型配置未变。事件日志仅新增 `runtime_started`、`channel_connected`、`runtime_closed` 三条，writer-admission SQLite 两张表行数与逻辑值相同；这不证明未建立过外部连接。原始和变化后的文件均私有封存，不以旧备份覆盖当前运行态。两份误落普通目录的合成配置在确认根哈希、权限和内容边界后原子移至可恢复的 `~/edupi-install-checkpoints/v0.3.107/evidence/incident-normal-state-20261105/`；普通目录现无这两份配置。安装前没有它们的独立快照，不能证明更早是否存在正常配置。本机 Time Machine 未提供可读取的旧快照。失败回执与私有事故清单保留在同一 checkpoint，原始 `allBytesPreserved=false` 不能改写。

随后以事故后的当前真实资料新建 348 项续验基线，额外把普通目录两份配置的“缺席”纳入检查。两次测试均从唯一已验 `.107` App、同一明确合成根和本机回环模型启动；每次绑定原生 CUA 前实际运行 `node scripts/assert-macos-isolated-edupi.mjs before-cua <隔离根>`，确认 App／Core host 的进程与环境；原生 Quit 后不再读取旧绑定，仅运行同脚本 `stopped` 确认进程为零。首次受控运行和同根冷启动后，续验基线均 **348/348 逐字节不变，`changedFiles=[]`**；3 个 WebView 来源两轮均恢复并核对一致。合成授权已停止、普通目录两份配置仍缺席，测试 App 与假模型均已退出。

受控原生聊天中，第一条合成慢回复被“停止并发送”中断，第二条合成消息与回复各出现一次；同一会话 3 个 Core-first 持久 outbox 均 `captured=true`、`pi_accepted`。本机假登录状态先返回旧回执过期，Agent 仅调用一次 `zhixue_login_status` 和一次 `zhixue_login`；合成二维码实际弹窗、可打开右栏、展开／恢复，文件在假登录进程结束后移除，冷启动重开原会话时显示“二维码已失效”。引用弹窗在右栏打开时仍位于顶层；关于页实际显示 `.107`、最新正式版 `.70`。合成过程没有调用真实智学网、真实模型凭据或外发。私有证据包括 `controlled-before-cua.json`、`controlled-stopped.json`、`controlled-cold-before-cua.json`、`controlled-cold-stopped.json`、两份 `protected-data-continuation-after-*-guarded.json`、两份 WebView 复核与 `controlled-native-acceptance.json`。**真实智学网扫码、登录和学情同步仍未验证。**

此时 Release `433770628` 仍为 Draft，正式 Latest/feed 仍 `.70`，Windows/Linux 未构建；独立只读审查建议在保留上述原始失败及续验边界的条件下仅公开 Mac Apple Silicon 预发布，不走要求全平台证明的 `phase=publish`。本段取代下方 `.107`“安装待验”的阶段状态；公开与匿名下载另记，不能由本段预先宣称完成。

## 2026-11-04 `.107` Mac 签名 Draft 待安装

Desktop [PR471](https://github.com/PIGU-PPPgu/edupi-desktop/pull/471) 已普通合并为 main `80066ecbff5cda4e24328094add884339745228d`，与本机受测 head `fed261365d5978935a745216e6e60754ef1e6cc4` 同 tree `a66c0d12ef00a68857d03675d1a5a535377f9ac9`；[源码 CI41811049005](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/41811049005) 的 audit、rust-audit、linux-source 三项成功。唯一 [Mac-only Draft run41812467078](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/41812467078) attempt1 固定上述 main 和 Core `008d3e63`，notary-preflight、release、Mac build 全成功；draft-proof、manifest、notify 因仅构建 Mac 按 workflow 跳过。Release ID `433770628`、tag `v0.3.107`、target 精确 `80066ecb`，保持 Draft。

最终资产仅三项且均属同一 run，Mac 集合指纹 `sha256:7e102c312fc8842c087a4bbc290bba5a087914c1a44d9b767b2e0830be86d233`：

| 资产 | ID | 字节 | SHA-256 |
| --- | ---: | ---: | --- |
| `EduPi_0.3.107_aarch64.dmg` | `709242553` | `238536739` | `8f2648e8923849a3c68954c918fb023ddfd794e32b952745dbb9d200cf0642b0` |
| `EduPi_aarch64.app.tar.gz` | `709243590` | `236170178` | `e8ad74dd53b34643cd948ecd67569c20fda20b94e3b4bbf0b0fd765357ff38b9` |
| `EduPi_aarch64.app.tar.gz.sig` | `709244436` | `404` | `67ba78ff731d2f0b3662d5e0f90ea8308ec6cd59bbd1b476a005a190beee0ee3` |

CI 记录 App 公证 Accepted `ea6b7d6c-d272-4315-a602-ad602e6c7024`、DMG Accepted `65d186a4-a3db-4965-b54e-264b631cf97a`，最终 App／DMG 装订、Gatekeeper、Minisign `verified=true tamper_rejected=true` 和三封装同一签名身份通过；本轮公证后 App 重包，CI 只在同轮替换并验真最终三资产。本机完整下载摘要与远端逐项一致，保留的 updater 公钥 SHA-256 `1e4dfd5ed31ca46ee167654232980397ffbd9f0ba5ddaf03d57201e3af859de6` 验签且篡改拒绝。只读 DMG、其中 App 与解包更新 App 分别通过 strict codesign、票据和 Gatekeeper，二进制／CodeResources 身份一致，18 项固定源码逐字节匹配。私有核验记录位于 `~/edupi-install-checkpoints/v0.3.107/evidence/`；分段传输曾两次超时，最终仅在本机完整摘要通过后计为资产已验。

唯一 `/Applications/EduPi.app` 目前仍为运行中的 `.106`，**未安装或公开 `.107`，未做 `.107` 冷启动、Core-first 原生插队、真实智学网扫码或资料保持验收**；正式 Latest/feed 仍 `.70`，Windows/Linux 未构建。已请老师保存并正常退出 `.106`，待进程停止后才能记录稳定资料指纹、建立回退备份和原位安装。签名 DMG、更新包、测试解包副本与分段片暂保留于上述私有 checkpoint，用于安装验收；验收或回退后按精确路径核对并清理生成副本，不碰真实资料、源码与原包。本段取代下方 `.107`“尚未源码 PR／CI／Mac 签名”的阶段状态。

## 2026-11-04 `.107` 聊天扫码与插队源码候选

老师最新的真实 `.106` 会话再次出现循环：同一条请求约 64 秒内调用 `zhixue_login_status` 16 次、`zhixue_sync_status` 18 次，却没有调用 `zhixue_login`，所以没有新二维码。前者引用旧 `login_ok.json` 称“最近登录完成”，后者的当前同步状态却为 `needs_login`。本机自定义 `extensions/zhixue_bridge.ts` 在逐字节私有备份后仅修代码：以更晚的 `needs_login` 判定旧回执已失效，死 PID 锁不再阻止新登录，并明确要求发出新码后停止查询等待老师扫码。模拟根测试覆盖旧回执、新回执、死锁和临时二维码可见／进程退出失效；没有调用真实模型、打开真实登录页或写教师资料。私有备份及测试证据位于 `~/edupi-install-checkpoints/zhixue-chat-20261104/`，该自定义扩展仍是本机未跟踪代码，不进入 Desktop 签名包。

Desktop `codex/chat-visuals-qr-20261103` 从 main `107c457a` 建 `.107` 候选：同一教师请求合并限制两种状态读取；运行中的聊天框显示“排队／插队”，Core 主动运行时提供“停止并发送”，先核对上一条 Core 捕获／持久回执已确定，再中断并确认旧 Pi 已停止，最后经原有捕获路径提交新消息。旧排队消息、会话切换、旧回执未定或停止失败时保留草稿且不抢发。扫码窗口可将当前二维码打开右栏；引用弹窗移至顶层，右栏可展开／恢复。NomiFun 是原生电脑操作引擎，不是聊天界面，此处无替换；Pi SDK 和 Core 捕获协议没有降级。

本机在合成根的开发页面实际打开引用弹窗及图片右栏，弹窗未被聊天容器裁剪；1728、1024、320 像素视口检查了侧栏展开／恢复和横向溢出。审查修复后，在右栏已打开的 800 像素视口，弹窗 `z-index=300` 高于面板 `250`，中心命中弹窗、无横向溢出；扫码侧栏按钮实际宽 78 像素，文字完整。源码完整 `npm test` 在版本元数据及审查补丁前为 3569 通过／48 条件跳过／0 失败；补丁后相关测试 77/77、TypeScript、lint 0 错误／1 条既有警告、`release:verify`、Cargo metadata 与差异检查通过。magpie 审查工具因当前 ChatGPT 账号不支持 `group/auto-coding` 而失败；独立只读回退审查指出 Core 捕获中途不能安全打断及两处 CSS 问题，均已补丁并复验。隔离浏览器 `/api/edupi/materials/staging` 返回 503，未将材料服务判为通过。当前唯一 `/Applications/EduPi.app` 仍是运行中的 `.106`，**未安装 `.107`、未真实扫码或对话插队**；本段是源码候选，不能追认安装版可用。Windows/Linux 不构建。

## 2026-11-04 `.106` macOS 安装与预发布

Desktop [PR469](https://github.com/PIGU-PPPgu/edupi-desktop/pull/469) 已普通合并为 main `d0e44750db1ca344dcde3970ab23c57518fe258a`，与受测 head `31d0e9303c8eda532e91c5b7927f9ce178583cfa` 文件树相同；[源码 CI41770386535](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/41770386535) 的 audit、rust-audit、linux-source 三项成功。唯一 [Mac-only 签名 run41771302378](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/41771302378) attempt1 成功，固定 Core `008d3e63cc1ab4fa2adfba4817241720408dc6fb`；同轮 DMG／更新包／签名资产 ID `708327092/708299455/708299713` 的本机完整 SHA-256、Minisign／篡改拒绝和集合指纹 `sha256:2b34496400ba832384c97225085ea636a489d542d8729989f939a1237c58d9af` 通过。App/DMG 公证 Accepted ID `0b50edac-3cc1-4015-8e51-650395b8bcec`／`17bd4d31-78a9-4767-98e3-22c7880fda81`，本机只读 DMG 与更新包 App 严格签名、装订、Gatekeeper、二进制身份和 18 项冻结源码一致；`draft-proof` 因只构建 Mac 按 workflow 跳过。

用户正常退出后，唯一 `/Applications/EduPi.app` 从已验签 `.104` 原位安装 `.106`。安装前做真实资料和 Pi 配置备份；安装后、隔离首次运行、同根冷重启及清理后，346 个受保护文件逐字节摘要均与安装前一致，3 个 WebView 来源恢复原值。`.106` 设置页实际显示桌面总开关、辅助功能、屏幕录制均已开启／授权。隔离本机合成模型在可见对话中调用 `observe`，由老师亲自允许后，原生审计 `isError:false`、`pixelFallback:true`；Pi 工具结果有一张 1568×882 PNG（271,179 字节）和新的 `snapshot_id`，图片在聊天与右侧面板可见。同一快照的第一次无点击 `mouse_move` 等待人工确认超过 45 秒而超时，审计无执行；第二次老师及时允许后，原生移动成功并报告截图坐标 `(900,400)` 对应屏幕 `(1470,653)`，没有点击或输入。退出隔离 App 后以同根冷启动，原会话自动恢复，原图片再次在右侧打开；最终隔离 App 已退出，真实资料和界面偏好复核不变。私有操作证据保存在 `~/edupi-install-checkpoints/v0.3.106/evidence/`，截图内容和认证值未写进仓库。

[v0.3.106](https://github.com/PIGU-PPPgu/edupi-desktop/releases/tag/v0.3.106) 已由 Draft 公开为 Mac-only `prerelease:true`、非 Latest；匿名 API 可见 3 资产，公开 DMG 的 64 KiB 范围下载与本机验签包前缀一致。正式 Latest 仍 `v0.3.70`，`updater-feed` 的提交 `7924328e` 与 `latest.json` blob `ea4b91ba` 均未变；Windows/Linux 安装包未构建，旧客户端不会从正式 feed 自动发现 `.106`。`.105` 保持失败 Draft。清理前核对挂载、进程、Git 跟踪和回退身份后，仅移除 16 处旧版 App／下载分段／解压副本与本工作树生成缓存，清单原分配 `10,215,988 KiB`，同卷可用实增 `11,261,272,064` 字节；保留唯一安装 App、`.106` 签名 DMG、`.104` 回退 App／DMG、两次真实资料备份、源码和证据。真实智学网旧登录快照已过期，本轮没有新扫码或真实学情同步；本机自定义登录修复代码不属于 `.106` 签名源码，不能凭本次 Mac 发布声称其他机器的智学网登录已验收。此段取代下方“`.106` 源码候选”状态。

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
