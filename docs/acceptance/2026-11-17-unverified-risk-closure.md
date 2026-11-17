# 未验收项与风险收口

## 当前状态

2026-11-17 本节取代下方全部阶段性状态。用户最新要求因费用停止 Windows 构建；本轮不再触发任何 Windows runner、打包、安装或升级重跑。已核对全部 queued／in_progress／waiting／requested／pending runs，均为空；旧 Windows 运行费用与失败不能撤销，原始记录保留。

Desktop `.117` 的冻结签名源为 `a55777400dea49f1ba3d953418b6965a41942c3e`，Core 为 `98e4f7cd0c31dd30954574d2040bb1b948cdd954`。签名 run43967319356 attempt1 的三平台 builder 与最终 draft-proof 全部成功。Release447680099 已执行一次受控公开，`draft=false`、`prerelease=true`、`make_latest=false`；九项资产集合指纹仍为 `sha256:47068a9d6613a4fb697db202ab874466782ff342d3e7fdea94902b34428e43c4`。正式 Latest `v0.3.70`、feed `7924328ee893c9527adb54e25b0023e9f2a26ff7` 以及已公开 `.115/.117` 的 tag／资产保持。

已完成一次新的说明专用PATCH，加入本机Mac原生升级/G3/G5冷启回读与Windows后续构建暂停，前后九资产、tag、正式Latest及feed均保持；此操作没有workflow dispatch或构建。首次准备误读不存在的feed tag在PATCH前拒绝，实际feed为 `refs/heads/updater-feed`，失败记录保留；修正引用后完成说明更新，没有重跑公开发布器。

后续 h 补验使用本机 macOS26.6／arm64、临时 `.115`／固定Core98和全新合成根。真实Core事项进入提醒，应用内“继续聊”打开精确task；普通草稿A和事项草稿B均在各自持久键中回读。系统通知开关与权限实际显示开启，但6次认领均延后、系统提交与打开均为0，具体延后原因尚未证明。Mac随后再次锁屏，未完成通知点击、发送、会话绑定及UI离开重入；未把SQLite回读替代这些交互。自有进程已停止，原UI及350项保护已恢复通过。

| 原任务 | 当前状态 | 实际证据与未覆盖范围 |
| --- | --- | --- |
| R15 Mac 公开下载、安装 | 验收通过，范围为隔离安装 | 三份公开Mac资产匿名完整size/SHA匹配；公开DMG run44011387309／harness cdd8cdc5 两次真实App/Core/HTTP启动、不同PID/nonce、同一SQLite持久记录和marker/model回读、清理通过。此前CI1／CI2失败保留；不是普通教师根迁移验收 |
| R15 Mac 原生升级 | 验收通过，范围为隔离cohort `.116→.117` | 本机旧116设置发现117，实际点击更新和继续，自动新App PID77828→30243／Core30799；About117、安全签名和冻结包全树核对通过。正常Cmd+Q后再冷启App68191／Core68492，G3/G5状态回读保持；两次正常退出后App/helper均0。正常 `/Applications/EduPi.app` 仍115；未证明正式70通道升级 |
| R15 Linux | Deb安装与AppImage隔离原生升级分别通过 | run44011387634 实际从旧116 UI触发公开117原生updater，新App PID3382→3503，HTTP3536／Core3588；同资料根、同SQLite记录、marker/model回读与清理通过，未手动launch117补证。升级后GUI、Deb升级、真实教师流程未操作 |
| R15 Windows | 用户因费用暂停构建与runner；修补源码保留Draft | 历史run43975180076的117 NSIS安装/Core smoke通过；run44022244522仍为非零blocked，不改为升级通过。PR504 head0a61c16e修复诊断token泄漏、环境读取数组展开、独占截图重名和资源journal前中断恢复误绿。本机WebDriver12项及PowerShell7.4.13支持检查24项通过；独立复审未见新增P1/P2，但其14项PowerShell因无pwsh未重跑。没有新Windows runner、构建或installer执行 |
| R18／R20 原生拖动 | 自动化输入限制已定位，人工持键鼠标未验 | CUA drag的原生pressedButtons和Web buttons均为0，命中把手后正确触发松键保护；真实hook12项回归通过。macOS权限probe44015411776仅读取且accessibility/screenRecording均true，未启动App；它不能证明持键拖动通过 |
| R03 提醒续聊与通知 | 事项路由、两份草稿持久化局部通过；完整流程未验 | h的G3仍未审核，seed模型调用0；应用内续聊到对应task，A/B在不同new/reminder键落盘。`taskSessionBinding=null`、没有发送。6次通知deferred、0 submitted／opened；系统菜单操作受CUA限制，后续又锁屏。原生通知点击、发送绑定及UI离开重入均未完成 |
| R04／L4 G3、G5 | 隔离安装版交互与冷启回读通过，完整L4未验收 | G3打开三份产物、接受草稿、材料确认及关联任务回读；G5错误短语disabled、精确短语enabled并确认，内部候选草稿在升级和冷启后保持。外发未授权，未执行外发；不证明真实模型或教学内容质量 |
| R04／完整L4其余项 | 外部条件与固定Core合同仍阻塞 | Main4在dispatch前拒绝generic `create_task`，周/月模板503／activation_pending；真实模型预检要求HTTPS，而当前默认模型为本机HTTP网关，0calls。自然跨期、实睡、通知实际点击、真实教师连续使用、正式盲测六域／双裁决者／预算配置冻结仍缺；未绕过门禁或切换账号／模型 |

源码、发布和用户验收分开记录：PR501／502／503／505 已合并；这些验收器源码不改变冻结 `.117` 安装包。Windows PR504 的源码审查不等于Windows运行验收，完整 R04／R15／L4 保持未勾选。

### 资料保护与清理

本机新 cohort `native-l4-116-117-20261117g` 实际执行 snapshot→isolate→restore→check，350项按新基线逐字节相同，原三个LocalStorage和四份UI配置已归还。新基线保留当前全局models摘要 `222a6b2f95b67558cfbe7b9d58a0106919f37d4dab40fd0dc1411fa1db61fcec`；旧f基线七项元数据漂移及其 `original350ByteAuditPassed=false` 仍是历史事实，不回写旧配置。合成canary的agent配置未提前独立采集前后摘要，不能宣称该项已有完整快照比较；本机升级proof已明确false。

最新 h 在锁屏后仅对身份重核的自有App／Core发SIGTERM，不计正常Cmd+Q。当前隔离UI留下57712字节WAL；完整raw被保留，checkpoint只在stage副本执行，15行内容摘要、schema与quick_check前后相同。准备阶段实际复现umask077使普通复制的0644变成0600，改用已审的精确权限复制函数，8项恢复／复制回归及h独立复审通过；未改原保护器。随后原封不动的restore/check均通过，check SHA为 `4def72cad4fce1d9919efc3b7746ec1af3e76c4eabc512bad87cf3bd45e58fb4`。h隔离agent的settings/models保持，仅自动新建2字节空auth `{}`，所以canary配置全字节相等明确false；真实global auth/models/settings及350项不变。

已实际删除九份完成验收的包下载副本及SQLite诊断根，实际可用空间增加1,440,083,968字节；又删除临时升级App与旧／新已解包的三份测试App，增加3,124,912,128字节。正常115、114回退、教师资料、当前模型、G3/G5合成根、源码、备份、失败日志和JSON证据保留。临时PowerShell已删除；当前不为重跑Windows重新安装工具或申请runner。

本机源码修补曾临时使用macOS版PowerShell做纯mock检查，未使用Windows runner或installer；工具已清理，可用空间增加270,495,744字节。h验收结束后核对进程／FD、Git跟踪和ignore，再删除其临时App及旧Windows任务树中已不再使用的重复node_modules，可用空间实际增加2,763,821,056字节；源码、锁文件、主QA依赖、合成数据、UI备份和全部证据保留。两棵任务树的`.next`、`.next-desktop`、Rust target与列出的生成资源目录均不存在。

### 证据索引

下面路径均相对于本机私有证据根 `/Users/iguppp/edupi-install-checkpoints/`；原始教师资料与认证内容不提交仓库。

| 证据 | 位置 |
| --- | --- |
| 一次受控公开，9资产／tag／正式通道前后保持 | `v0.3.117/evidence/publish-117-20261117a.noindex/controlled-prerelease-117-proof.json` |
| 新Mac原生证据后的说明专用更新 | `v0.3.117/evidence/release-notes-after-native-mac-20261117b.noindex/proof.json`；首次准备拒绝为 `release-notes-after-native-mac.noindex/failure.json`，PATCH为0 |
| 三份Mac公开资产无凭证完整下载 | `v0.3.117/evidence/anonymous-public-117-download-proof.json` |
| 公开Mac安装及两次冷启 | `v0.3.117/evidence/macos-public-installed-117.noindex/e.JSON` |
| Linux原生升级及同库回读 | `v0.3.117/evidence/linux-native-upgrade-public1.noindex/linux-upgrade.json` |
| 本机Mac原生升级、G3/G5、g保护引用及边界 | `v0.3.116/evidence/native-116-117g-final-observed-proof.json` |
| 新g完整恢复及350项核对 | `v0.3.116/evidence/ui-data.noindex/protect-native-l4-116-117-20261117g/check.json`；SHA `8747356fe01fcabd733fb6d5ff77bc6a2e48a6eab41caa6c44280f4337365bc2` |
| Mac权限只读probe | `v0.3.117/evidence/macos-native-permissions-44015411776.noindex/macos-native-permissions.json` |
| 历史Windows executor定向29项／实际环境阻塞 | `v0.3.117/evidence/windows-upgrade-executor-verification.noindex.json` |
| 用户费用限制及无活跃作业核对 | `v0.3.117/evidence/windows-cost-stop-20261117.noindex/proof.json` |
| Windows本机风险修补与独立复审边界 | `v0.3.117/evidence/windows-local-safety-fixes-proof.json`；PR504保持Draft，head `0a61c16e6e833c6ad6da72d059134cd587a19e79` |
| h提醒／通知／草稿与原UI归还 | `v0.3.117/evidence/notify-115-20261117h.noindex/final-notification-draft-proof.json` |
| h的stage副本与两份草稿持久回读 | `v0.3.117/evidence/notify-115-20261117h.noindex/staged-wal-and-drafts-proof.json`；不是UI离开重入验收 |
| 已执行的下载／诊断及测试App清理 | `v0.3.117/evidence/completed-downloads-and-sql-cleanup.json`、`v0.3.117/evidence/completed-native-app-copies-cleanup.json` |
| h测试App及停止使用的重复依赖清理 | `v0.3.117/evidence/notify-h-and-duplicate-dependencies-cleanup.json` |

## 2026-11-17 早期安装记录

2026-11-17 当前安装证据取代上一轮：Mac CI3 run44007284437／harness bd87b1aa **真实临时安装、两次冷启、Core／投影、同一SQLite持久记录、marker/model回读和清理全部通过**，源仍a557。Linux116 AppImage前置run44004124512通过但截图中文方框；run44008633609补系统CJK字体后功能与实际中文截图均通过，原始字体列表由空变为包含Noto CJK。Windows run44004124764的同SID shell、116字节、WebView2和匹配驱动通过，真实WebView阶段泛化 `phase_failed`，当前blocked、清理通过，继续定位。117受控发布input的22项本地引用已核验，公开发布、匿名下载和旧客户端升级仍未执行；正式70/feed不变。

本段取代下方早期“源码准备中、等待重跑”的阶段状态。Desktop PR498、PR499、PR500 已正常合并；真正 `.117` 签名源为 `a55777400dea49f1ba3d953418b6965a41942c3e`，与受测 `2b1f0c14adba71fc95012b30cd453b0f6f2f6df3` 整树相同，Core 仍固定 `98e4f7cd0c31dd30954574d2040bb1b948cdd954`。旧 `2618757a` 仅为未使用准备源，没有移动旧分支。正式 Latest `.70` 与 feed `7924328ee893c9527adb54e25b0023e9f2a26ff7` 保持；完整 L4 不放行。

| 项目 | 当前结论 | 针对性证据与边界 |
| --- | --- | --- |
| R18／R20 原生鼠标 | 自动化输入限制已定位，人工鼠标未验 | 原生 `pressedMouseButtons=0`、Web `buttons=0`，实际命中把手并成功 capture 后触发松键保护；真实 hook 回归12项通过。未删保护 |
| R15 Linux `.116`／`.117` | Draft 构建、真实 `.deb` 安装与两次启动通过 | `.117` 源 a557 的签名 run43967319356 Linux job成功；两个不同实例 ID、bundled Core/投影 ready、同一 SQLite 只读完整性通过。不是教师全流程、GUI 鼠标或 AppImage 自动升级验收 |
| R15 Windows `.116` | 原 all-platform run 中 Windows 实际重跑通过 | 初次 npm `ECONNRESET` 失败保留；单平台 run43919850507 的 build 被跳过，不作证据。原 run43913704753 重跑后实际 Windows job成功 |
| R15 Windows `.117` | 精确 Draft NSIS 安装、启动与隔离 Core 验收通过 | run43975180076／job133677226510，asset756730447，140263717字节，SHA `5c7dab4a4966333228771bc5b8f43953d4df191bd187dc33779034d1d6fbeb6f`；正常模式守卫、单实例、Safe Mode Core/投影ready、Core98和G1 pending均通过。未验公开下载、GUI或旧客户端升级 |
| R15 Mac `.116` | 私有完整资产与原生安全 gate通过 | Release447334004／源13de；三包完整size/SHA、Minisign及篡改拒绝、Developer ID、票据、Gatekeeper、arm64、DMG/updater整App树及30份包内源文件匹配；未启动或安装116 |
| R15 Mac `.117` | 私有临时安装与两次真实冷启验收通过 | CI3 run44007284437／job133785571292，harness bd87b1aa，Release447680099／源a557／DMG756856348。App PID2987→3185、不同nonce、Core/投影ready、native guard、同SQLite记录／marker/model、包内Node22.23.4只读均通过；八目录实际删除，native_saved_state已缺失单列，清理通过。本机正常App仍115；失败1/2保留 |
| R15 `.116` 整轮发布 proof | 未通过，保持 Draft | 选择性重跑更新 `run_started_at`，旧代码误拒绝保留的早期Mac/Linux资产。最终整体success发布门未跳过；修复进入PR500，不将历史run failure改绿 |
| R15 `.117` 整轮 Draft proof与版本签名 | 三平台真实签名构建和最终发布身份gate通过，仍Draft | run43967319356 attempt1／source a557：Mac、Windows、Linux builder与draft-proof均success；九资产指纹 `sha256:47068a9d6613a4fb697db202ab874466782ff342d3e7fdea94902b34428e43c4`。CLI2.12.4、最终签名精确版本117、原公钥／TLS／禁止降级均保留；安装、公开下载和升级另验 |
| G3／G5 原生流程 | 合成根与后端重启回读通过，GUI外部阻塞 | `.115`临时副本实际启动，Core/投影ready、隔离guard通过；CUA返回Mac锁屏、自动解锁失败，实际点击0。未接受G3、未确认G5、未发送消息 |
| 周期模板／完整L4 | 固定Core合同限制与正式样本前置仍在 | Main4拒绝泛用 `create_task`，周/月模板503/activation_pending，未绕过；真实模型、自然跨期、通知点击、实睡和真实教师长期试用不标绿 |

### 原 UI 归还与模型元数据

新保护工具最初的进程正则误中Codex工作目录参数、G4锚误用真实教师同名文件、可索引备份被Spotlight占用，均在真实UI隔离前被拒绝并保留a–e现场。修复保留FD检查；两根分别校验，备份与回执放入 `ui-data.noindex`，53项回归及独立审查通过，f 的真实snapshot/isolate成功。

Mac锁屏阻止交互后，仅对自有隔离App发送SIGTERM，App/HTTP/Core三个PID均退出；这不计正常Cmd+Q通过。WebKit留下8272字节WAL，原helper按规则拒绝普通恢复。随后全局 `~/.pi/agent/models.json` 在2026-11-17 05:02:22发生七处价格／maxTokens元数据变化，来源未确认，没有密钥或端点变化；旧配置不能恢复回写。

采用独立UI-only归还：原三个LocalStorage的完整inventory、模式、schema及逐行BLOB长度/SHA与snapshot相同，行数1／19／11；四份UI配置保持原值；当前三个目录与WAL完整保留。其余349项和G4两份全文件匹配，当前models保留 `9585226b7bf8e8c4acaa44f57559b3691b54ece086f4e5507516251a809508d4`。独立只读复核通过；8项中断、目标拒绝和复制权限回归通过。

`original350ByteAuditPassed=false`、`originalRestoreAndCheckPassed=false`、`installationOrUpgradeProved=false` 均保留。UI归还不能替代旧数据审计、GUI或升级验收。实际回执为 `v0.3.116/evidence/ui-data.noindex/protect-g3g5-115-20261117f/ui-return-preserving-models.noindex/returned.json`，SHA `c71882b155ad7f68a0ac1119bf369dcc327dcae40c7bc6dea6ed8e2a8645ab52`。

### 发布修复与验收入口

- PR500 的真实CLI小payload验证、版本和payload篡改拒绝共24项；独立13项crypto探针、55项配置回归、57项最终proof/workflow回归通过。source CI43962527784三项成功，网络ECONNRESET失败另存，未降安全检查。
- 新 `scripts/create-native-l4-acceptance-fixture.mjs` 强制显式建根、lowercase独占HOME子目录、0700权限及Main4迁移；8项回归和独立只读检查通过。现有合法根 `~/edupi-route1-canary-l4-116-20261117-66195f63234b37ec4848ad1f` 的G3为3份未审核draft、G5为needs_confirmation，模型调用0；40个seed host均退出。
- 周期创建的确切阻断位于Core `scripts/core_runtime_daemon.mjs:697–706` 的Main4命令门禁，早于正式dispatch；补bootstrap/grant或开启G1不能解除。未手写taskboard或放开门禁。
- Mac资产工具的symlink/casefold越界和receipt快照漂移已修复，99项与4项Draft URL增量通过；本机case-insensitive卷和正常Framework链接另有实测。真实116已完成安全解包、只读挂载与卸载。117仍须基于实际新源、CI、asset ID和认证版本重新验收。
- `.116` Draft 更新说明后，真实API的 `tag_name` 变为 `untagged-df41d75c4b0cbd7734b1`，使版本定位失配。已显式恢复 `v0.3.116` 并复核Git tag仍为13de、九项资产ID／size／digest完全一致、仍Draft、Latest/feed未变。Draft的 `browser_download_url` 仍可能使用 `untagged-*` 占位地址；下载信任继续绑定API asset ID，不用该占位地址代替资产身份。
- 新增独立 `macos-installed-acceptance.yml`：只在全新 macOS15 arm64 hosted runner 上按精确DMG资产安装临时App，实际两次冷启动，分别绑定App／HTTP／Core进程，核对固定Core、同一SQLite／合成marker／模型配置后清理。20项helper/mock与实际Python SQLite／CFData plist回归、ESLint和actionlint通过；真实CI安装尚未执行，GUI、正常Cmd+Q、教学内容和升级没有通过声明。
- Mac独立审查发现只比SQLite文件和schema会漏报同inode记录丢失。已改为只读逐条主键／内容摘要比较，允许正常新增；authority仅比较稳定root身份，events比较不可变内容。真实SQLite删除、同ID修改、正常owner／settlement变化及内容保持反例均复验，29项含隔离守卫通过，P2独立复审关闭。当前`.117`原生安全证明为 `v0.3.117/evidence/mac117-private-platform-verification.json`，安装和GUI状态仍未因此改变。
- PR501 已正常合并为4ffb2833，与受测d120feb8整树相等。首次Mac安装run43982417466／job133701966537在 `bundled_core_exact_source_contract` 失败：新验收脚本错误要求包内存在 `command-unsupported.json` 等开发fixture示例，而既有 `packaged-core-bundle.mjs` 明确只分发两个运行闭包、对应manifest和fixture索引。临时App已验签，未启动；挂载、App／数据／原生临时profile清理通过，回执与失败日志保留。修复按原分发合同校验精确文件清单，保留全部运行文件字节及fixture索引自hash；缺失运行文件、额外文件和索引篡改均拒绝。对同一签名117包实际核对13359运行文件通过，30项含隔离守卫通过；独立复审与新CI冷启仍待完成。
- 新Windows入口只执行冻结116的真实WebView前置验收；`upgrade` 尚未实现时明确非零blocked、`actualUpgradePassed=false`。独立审查的PID误认领／树清理P1、只比属性宽度和冷启动过早判断两个P2均已修复并复审关闭：保留Windows进程句柄逐个清理，实际测量面板几何尺寸，等待Core／投影ready。实际PowerShell7.4.13 AST与隔离mock及W3C helper共16项通过、0跳过；临时工具已删除，实际可用空间增加270417920字节。尚无该新入口的Windows运行结果，不以既有117安装smoke替代。
- 新Linux AppImage入口支持冻结116前置验收和受控公开117原生升级。Xvfb私有cookie复制、HTTP socket到新App／Core PID与出生时间绑定、取消请求和禁止中断写绿均已有定向回归，12项通过，独立复审待完成；尚未在Linux实跑。升级只允许旧App界面触发原生updater，观察自动重启后再核对新包、同一SQLite持久记录、合成marker和模型配置，不手动启动117补证。
- `update-cohorts/all-116-117-20261117.json` 由真实九资产及四份精确签名生成，包含7个updater平台键，已随PR503提交；固定URL使用受测commit `c8bc4aff57f06062ff8bf4e0c56c11b6d74580bd`。目标117仍须先通过受控公开门，清单仅供明确canary环境使用，正式Latest70/feed792不变。首次GitHub元数据GET的EOF在任何签名写入前发生并留证，后续同ID／size／digest读取已通过。
- Mac系统Python读取器的失败已用同一包内Core实际复现：两次干净关闭后，数据库为WAL模式且sidecar已清理，系统Python只读报无法打开；包内Node22.23.4／SQLite3.53.4两次只读读取和quick_check通过，数据库字节不变。新 `NODE_STORAGE_PROGRAM` 使用包内Node、`readOnly:true`、`query_only`及禁扩展读取，逐记录／同inode核对保留；Linux原Python helper保持。新目录helper逐项保留角色和父链／leaf身份、测量前后复核、失败继续独立目录，native叶已缺失单列 `already_absent`，新inode仍拒绝。inode回收误重叠和创建后登记失败漏报的P2已修复并独立复审，78项通过；CI2实际坏目录仍未知，不归因于App重建。
- CI3全部通过，数据位于 `v0.3.117/evidence/macos-installed-attempt3.noindex/e.JSON`；只读版本为Node22.23.4／SQLite3.53.4，九项readback均true，registrationFailures为空。`native_saved_state`本轮已经缺失，未执行删除；其余八项删除allocated1255870464字节，实际可用空间增加1237778432字节。该事实不倒推CI2坏目录。当前完整Node回归4324 passed／0 failed／51 skipped，功能定向78项另有实际数据及独立审查，skipped不算验收。
- Linux带字体前置run44008633609保存了字体列表和真实About截图；安装前可用CJK family为空，安装 `fonts-noto-cjk` 后中文正常。冻结116/117未因此内置字体，系统CJK字体仍是运行前提，已写入更新文档。前置验收不是原生升级通过。

## 早期阶段记录

当前基线为 Desktop `7e24ffca4b23b70ec4cb7372bd4423b254388a49`，已安装 Mac `.115` 的冻结源码仍为 `6d14dbba928db133b87aa10d947214b5ba062089`，Core `98e4f7cd0c31dd30954574d2040bb1b948cdd954`。用户要求继续处理未验证项和风险，Windows/Linux 安装与启动重新进入本轮范围，旧记录中的“暂缓”不再代表当前任务范围。`.115` 资产和标签保持冻结。

## R18／R20 原生鼠标

状态：**已定位当前自动化输入限制，安装版人工鼠标仍未验收**。

2026-11-17 在本机 arm64 创建独立、非持久化的 WKWebView 诊断窗口。该窗口没有加载 EduPi，也没有读取教师资料或配置；只记录原生鼠标事件和 Web 指针事件。诊断采用与 resize hook 相同的捕获和鼠标松键判断，用于定位输入链，不能代替实际产品验收。

CUA `App.drag([520,700],[720,700])` 确实命中把手，Web 坐标由 `260` 移动至 `360`，`setPointerCapture` 成功。原生 `leftMouseDown`、`leftMouseDragged`、`leftMouseUp` 的 `NSEvent.pressedMouseButtons` 全为 `0`，Web 的 `pointerdown`、`pointermove`、`pointerup` 的 `buttons` 也全为 `0`；首次移动触发 `lost-buttons`，宽度保持 `260`。因此上轮“把手获焦、宽度不变”有可复现的自动化输入解释，不能据此判为实际人工鼠标故障，也不能标为安装版鼠标通过。

生产 hook 不作修改，保留松键、取消、失焦与丢失捕获保护。新增真实 hook 回归覆盖上述无按键序列、释放捕获与恢复 body 状态，并验证后续有按键的有效手势仍能将宽度改为 `360`、持久化回读一致。命令 `/opt/homebrew/opt/node@24/bin/node --test hooks/useResizablePanel.behavior.test.mjs` 为 12 passed、0 failed、0 skipped。

本轮诊断窗口第一次启动后已退出，首次 CUA 绑定返回 `-10005 timeoutReached`。改为保持任务进程存活后，绑定与事件采集成功；该失败保留，不能归为 EduPi 运行失败。诊断结束实际关闭窗口，进程退出码为 `0`。本轮没有启动 EduPi，独立 `assert-macos-isolated-edupi.mjs stopped` 返回 App/helper `0`，应用日志最后更新时间仍为 2026-11-16 21:04。

证据根：`~/edupi-install-checkpoints/native-pointer-20261117/`，包括 `PointerProbe.swift`、`events.jsonl`、`resize-behavior.log` 和绑定各文件 SHA-256 的 `pointer-diagnostic.json`。截图实际在 CUA 中观察，未冒称有落盘截图。

尚需实际持有鼠标键的原生输入或人工鼠标完成安装版拖动；现有 CUA API 仅提供整段 `drag`，没有独立鼠标按下／抬起或按键状态参数。禁止移除产品保护来迁就该输入。

## R15 发布升级与 R04／L4

状态：**新候选 `.116` 源码准备中，未构建、未安装、未发布**。旧 `.115` 已完成的签名、公开匿名下载、公开重装和资料保护证据继续有效；它们不证明这些剩余验收项通过。

独立只读检查确认 GitHub Windows/Linux runner 可执行实际安装和启动。旧 Windows `.109` 已有 Draft 安装启动记录，旧 Linux 的一次打包在 staged manifest 校验失败，不能称为缺执行环境。`.115` 只有 Mac 资产，不能向已冻结版本追加新产物。

已为 `.116` 补充 Linux `.deb` 安装验收：校验安装版本、架构、包内两个 Core manifest 和 schema，隔离 HOME/XDG/资料目录启动、退出、重启并只读核对同一 SQLite；失败保留脱敏证据。Windows Draft 复验改为额外 checkout 候选精确 SHA 的合同，修复旧包被当前源码合同误报的问题。上述源码与脚本测试不能代替真实 runner 安装结果。

旧 `.114/.115` 的版本显示和原生 updater 都固定读取正式 `.70`，没有现成的预发布发现入口。因此 `.116` 补充 `EDUPI_ISOLATED_UPDATE_FEED`：原生明确隔离标记、原有合法资料根守卫、固定本仓库 commit 的 HTTPS 清单；设置页和插件使用同一清单，公钥不变，隔离模式额外要求签名版本一致。普通启动不设置变量，正式更新源不变。完整 `.116 → 后续签名版本` 的发现、下载、验签、安装、自动重启与数据回读仍须实测，尚未记为通过。具体契约见[更新文档](../desktop-updates.md)。

本轮完整源码回归首次为 4085 tests、3986 passed、54 failed、45 skipped。旧任务 `node_modules` 链接指向 `.114` 依赖，52处错误为缺少 `qrcode`，另有旧 OpenConnector 依赖版本断言失败。已保留原链接目标和失败日志，仅将本任务链接替换为按现有锁文件安装的独立依赖，等待同源重跑；不能将首次失败改记通过。

真实模型的只读预检命令为 `node scripts/run_g1_real_model_rehearsal.mjs --preflight --max-calls 2 --max-cost-usd 0.20 --only positive`，实际返回 `blocked/invalid_model_endpoint`，模型调用为0。当前默认模型是已配置的本机 HTTP 网关，该验收器明确要求 HTTPS；未改变模型、账户、密钥或放宽现有守卫。此结果不是模型推理失败，也不证明真实内容质量。

Core `l4_formal_blind_prepare.mjs --check` 实际为 `prepared_not_frozen`、`declaration_complete=false`、安装六域记录为空、provider/model calls为0。缺少同源安装六域、双裁决者、配置和预算冻结，不能把形式准备脚本退出0当成正式盲测通过。真实教师连续使用、自然跨期、系统睡眠与通知点击继续保留为独立条件。

## Windows/Linux 原生验收入口

R15 状态为**已实现待验收**。实现7ef20ede将两个入口从Mac验收修补中独立出来，便于在全新runner实际运行；签名源a557、Core98、九资产和正式Latest70/feed792保持。Mac run43991025944已两次启动App、Core/投影ready并回读同marker/model，但第二只读探针和目录cleanup仍失败，发布继续保持Draft，不能将平台入口合并当作发布验收。

- Windows `windows-upgrade-acceptance.yml` 安装冻结116，核对同SID shell、真实WebView2及匹配驱动，使用可信W3C鼠标测量实际面板宽度并刷新回读草稿。进程清理保留Windows句柄、拒绝过期PID/父子出生时间；这些P1/P2已独立复审关闭。当前只实现 `preflight`，`upgrade` 未实现时明确非零blocked且 `actualUpgradePassed=false`。
- Linux `linux-upgrade-acceptance.yml` 安装冻结116 AppImage，可在公开117与固定commit cohort可用后由旧界面触发原生升级；仅观察自动重启，再核对新App、HTTP socket owner、Core进程、同SQLite持久记录、合成marker和模型配置。Xvfb认证、中断取消和进程归属的P1/P2均已修复并独立复审。
- 当前分支在macOS arm64／Node24.22.2运行两平台helper：27 passed、0 failed、1 skipped；跳过项是本机未安装PowerShell，不算通过。相同Windows源码此前由主线程和独立审查实际使用PowerShell7.4.13运行16/16通过，临时runtime随后清理；Linux12/12通过，均不能替代真实Windows/Linux运行。
- `update-cohorts/all-116-117-20261117.json` 由真实九资产及四签名生成，七平台键均使用API asset ID；仅供显式原生canary使用。目标Release仍须通过独立发布门，正式更新源未改变。
