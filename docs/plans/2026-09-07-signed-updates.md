# 自动下载安装

2026-10-30 新Core `86ef6c98676789e61dec81594c75968922a964e3` 的消费准备：Core Main CI `41020434456` 成功，Bridge/Runtime schema/命令不变，但生产PDF可见来源增加原14秒围栏内的限时重试，双组件清单身份变为 Desktop `sha256:0b3ab7b12788ace1395dcc29ee64242de35f777637e5f6c60c4ad18da6de5ab1`（文件SHA `96cd146a54499884047396367c220934e6204b34fd0d76dffc757e9c05a177f7`）、Runtime `sha256:162e231dbf3c47509ae97e2d0140bf65a4cf8b5d87208d0c6acae581a1317313`（文件SHA `1a35b5edae4151e54f14996f1aecdd79c318ff972aff068e57a0993e37ffcda0`）。Desktop固定pin/双manifest源码更新；精确Core配对43通过／1环境跳过，真实隔离路由PDF/PNG/JPEG来源读取/采用及PDF/JPEG完整备课与冷启回读通过，无外发。源码PR/CI、`.90`版本与签名Draft尚未执行；唯一安装`.89`、其Draft三资产和公开`.70` feed均不改写。证据在 `~/edupi-install-checkpoints/v0.3.90/evidence/`。此段只是新候选源码配对，不冒充安装版。

2026-10-30 `.89` Mac-only 安装验收：本段取代下方“.89来源/CI待跑”的阶段状态。Core 首次行事历 owner 接线 [PR406](https://github.com/PIGU-PPPgu/edupi-desktop/pull/406) 已合，版本与新高危传递依赖修补 [PR407](https://github.com/PIGU-PPPgu/edupi-desktop/pull/407) 合为精确 Desktop Main `02ee02ffe99d25397124850d1df663268687fa71`／tree `3aa7280d0f4ad24189f00fd1661bb2f2d5581926`，固定 Core `f599fc389eecde7de4718a731e8304524c11dc72`。PR407 源码CI [41011700612](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/41011700612) 的 audit、rust-audit、linux-source 均成功；首轮因新发布的 decode-uri-component 高危失败并在修补后取消，不记通过。唯一[Mac签名Draft run41012563998](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/41012563998)/attempt1 完整成功；Mac-only 的 draft-proof/manifest/notify 条件跳过。Release `428706250` 保持 Draft，tag `v0.3.89` 和 target 精确指向上述 Main，三资产本机下载摘要与远端一致：DMG `691293443`／`235387035`／`4745b7d09227acdcc664f8311fc153909ea335b0572044ec614e18d653e8b7c8`，更新tar `691262556`／`236678071`／`e433ef1fc9c58b4ab74279758deda754427fc75e2bc1ed8613e030fa6fd17e20`，签名 `691262868`／`404`／`8de06cc30914197c9d20f9db974b3fb16402cd97760fb5374412374d37b50454`；Mac集合指纹 `sha256:264d82631806fad7159a20eed8f6e5c786c3439d14327f41c863738ce1381fb2`。App Apple Accepted `43517753-2f1b-4565-abdb-ce37d39ad216`、DMG Accepted `b6a1b8bf-dddb-42dd-9baa-016348edfd3e`；CI和本机对最终 App/DMG strict codesign、装订、Gatekeeper、更新包Minisign/篡改拒绝通过，同轮 App／DMG／tar三份身份核对通过，包内 Core 双manifest/schema与固定源码字节一致。

唯一 `/Applications/EduPi.app` 已从 `.88` 替换为 `.89`，旧 `.88` 与真实资料备份保留回退。新建隔离根中原生先读到“本机身份尚未建立”，确认采用禁用；仅点“建立本机身份”后读到单项提案，第一次原生采用弹窗取消仍不写，第二次确认后材料显示“已采用1项安排”，日程页只出现一条 `2026-10-31 隔离安排89`，操作历史“写入校历”一次。正常退出再冷启后教师资料、单条日程和材料采用回执仍可见；日程来源仍标“推断／待确认”，没有代替教师最终核对。真实资料根 `.edupi`175文件、Pi会话146文件及4配置共325项逐字节相同，原3个WebView origin已恢复，App已退出。白名单删除停用且无句柄的 `.next/`、`.next-desktop/`、本轮下载与分段副本四目录，分配量 `1,799,340 KiB`，同卷可用字节增量 `1,845,583,872`；未动正式App/源码/原诊断/回退/备份。私有证据为 `~/edupi-install-checkpoints/v0.3.89/evidence/` 中 `mac-asset-verification.json`、`mac-installation.json`、`installed-gui-089.json`、`protected-data-after.json`、`webview-prefs-restore.json`、`cleanup-after.json`。公开Release/feed仍为`.70`，未构建Windows/Linux、未用真实模型或启动真实教师根。**新 Core Main `86ef6c98676789e61dec81594c75968922a964e3` 在本候选构建后合入，改PDF可见来源重试及组件清单；其 Main CI `41020434456` 仍在运行。它未被`.89`消费，需单独配对验证，不改写本轮固定身份。**

2026-10-30 `.89` 来源CI修复：版本PR407首轮 [run41011239372](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/41011239372) 的 `audit` 在新公布的高危 `decode-uri-component@0.5.0` 告警处失败；这轮不用于签名候选。来源链为 `@lobehub/icons → @lobehub/ui → query-string → decode-uri-component`，父依赖允许 `^0.5.0`；仅将锁文件解析到官方修补版 `0.5.1`，未改产品调用或框架。更新后本机 `npm run security:audit` 退出0，高危0，仍有一条独立的 `@hono/node-server` 中危告警；更新后的PR检查待跑。[官方告警](https://github.com/advisories/GHSA-qr28-fpjm-wq7f)及私有 `~/edupi-install-checkpoints/v0.3.89/evidence/security-audit-after-lockfix.log` 记录边界。

2026-10-30 `.89` Mac-only 来源准备：Core首次行事历 owner 接线 [PR406](https://github.com/PIGU-PPPgu/edupi-desktop/pull/406) 已合 Main `468ce72e964327d066af44cd88cbceade03db9ac`；最新 Core pin仍为 `f599fc389eecde7de4718a731e8304524c11dc72`。全新隔离根经明确动作建立 owner 后，合成ICS提案ready、单项确认采用accepted，跨进程回执匹配；28项定向及完整3479通过／48条件跳过／0失败，本机`.89`生产Next构建、typegen、类型、lint、release:verify和Cargo锁校验通过。`.89`版本元数据与说明已准备，尚未签名或安装；当前唯一App仍是`.88`，公开Release/feed仍`.70`。版本PR源码CI及新Mac唯一Draft需后续同候选验证，不复用`.88`资产；Windows/Linux未构建。私有合成证据见 `~/edupi-install-checkpoints/v0.3.88/evidence/owner-bootstrap-source-e2.json` 和 `owner-bootstrap-cold-reread-e2.json`。

2026-10-30 `.88` Mac-only 安装验收：本段取代下方“.88源码/签名/安装待执行”的阶段快照。源码 [PR404](https://github.com/PIGU-PPPgu/edupi-desktop/pull/404) 已合 Main `133c657be73a897c77539302ac8dcd34e0c8ba21`，固定最新 Core Main `f599fc389eecde7de4718a731e8304524c11dc72`；源码 CI `40909157695` 三项成功。唯一[签名 Draft run40911065931](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/40911065931)/attempt1 完成 Mac job、notary-preflight 和 release；Mac-only 的 draft-proof、manifest、notify 条件跳过，Windows/Linux 未构建。Draft Release `428114206` 仍指向精确源码，三资产同轮且本机下载摘要、大小一致：DMG `689359680`／`235362090`／`c9a8a68916ce71cde3c3d6ca86618333e7670f839fbd3a684f474014acbd499d`，更新 tar `689320226`／`236662250`／`cc449bd6310b52802d6f4273ff22c978d52f688303b806cc02277205329b50a0`，签名 `689320849`／`404`／`2598c1feb7e304372907135ef12b6a1139a03ccc94bdd1b9f4a2f16c9f10bf37`；Mac 集合指纹 `sha256:7fa2ccf3b65885f72faf4ec0974b42564fb1d2cc537451a51717b0c975f2d197`。App Apple Accepted `b72898e9-11e0-440a-a8bf-3e9cfc31ef7e`、DMG Accepted `f2361c9c-760f-4da2-94d2-a31b7382f02c`；CI 及本机对最终 DMG/App 的装订、strict codesign、Gatekeeper 和更新包 Minisign/篡改拒绝通过，同一 CI 的 App／DMG／tar 三份 App 身份核对通过。

唯一 `/Applications/EduPi.app` 已由 `.83` 正常退出后替换为 `.88`，旧 App 保存于私有回退路径；安装后签名、公证票据和 Gatekeeper 再通过。原真实数据根 `.edupi`175文件、Pi 会话146文件、四份配置共325项安装及两次冷启动后逐字节相同；原三个 WebView origin 已恢复。以明确隔离根 `edupi-route1-canary-088-20261030` 原生操作了全屏欢迎、模型表单、教师资料保存、两名合成学生导入及跨班级入口回读；冷启动后教师与两名学生、ICS暂存材料仍在，引导没有重复弹出。ICS 的安排提案在该全新隔离根显示“教师身份暂不可用”，**未采用/未排课**，不能记为行事历完整接线通过。正式 App 已退出，真实模型未调用；公开最新 Release/feed 已分别回读为 `.70`，未发布 `.88`。私有证据位于 `~/edupi-install-checkpoints/v0.3.88/evidence/` 的 `mac-asset-verification.json`、`mac-installation.json`、`installed-gui-088.json`、`protected-data-after.json` 和 `webview-prefs-restore.json`。

本轮清理仅删除已停用、无句柄且 Git 未跟踪的四个精确生成目录：原工作树 `.next/`、`.next-desktop/`，`.88/macos-assets/` 的三份已验下载副本，以及 `.87/experiment/` 的旧 `.83` tar/解包测试副本；另卸载已验 DMG、移除空挂载点。删除前分配量合计 `3,503,924 KiB`，删除前后同卷可用字节增量 `3,612,721,152`（受同时磁盘活动影响）；回读正式 App `.88`、远端 Draft 三资产、原分支和原两项诊断改动均保留。私有回退 `.83` App 与真实资料备份保留至下一次受信安装稳定后再评估；108 KiB 合成根保留至新根 owner/安排提案的待核对问题定位完成，不能误作真实教师数据。证据为 `cleanup-before.json`、`cleanup-after.json`；未动其他废纸篓或项目。

2026-10-29 `.88` Mac-only 源码候选：`.87` 源码 PR403 已合 Main `ea844f329835d34b888ba6f3177ac2917f82f753`，三项CI通过。[唯一 `.87` run40880339423](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/40880339423) 中 App 公证 Accepted（ID `18b2baec-bca8-45a3-a9f0-a60cc779b6be`）、DMG 公证 Accepted/装订/Gatekeeper通过，但最终本地 App `stapler validate` 返回65“无票”；Tauri CLI 2.11.4 的 `staple_app` 吞掉子进程退出状态，不能把日志的“Stapling app...”当成功。Release `427888411` 的三资产保持 Draft，run失败、App/更新包无同轮装订证明，未安装、未公开，绝不与下一候选混用。`.88` 源码已接入来自 UI 工作树的五文件清单 `cf6f07ca…d4575edc`，全屏玻璃欢迎、同节点转场和放大字号；合并生产模式在1280px与320px实际操作模型、教师、名单、行事历，修复表单聚焦使外层舞台滚动80px的缺陷，复验scrollTop=0、窄窗无横向溢出且底部操作可滚动到达。最新 Core Main `f599fc389eecde7de4718a731e8304524c11dc72` 的现行教学题召回与双组件清单已成组配对，Bridge/Runtime schema不变；Core定向及Desktop真实Core 45pass/1条件skip、打包闭包3/3通过。Mac流程拟在同一job核实/补 App票据、重制 DMG与更新tar并重签、核本地/DMG/tar票据与签名，再以批量事务替换Draft三资产；代码/本机复验在执行。`.88` 源码PR/CI、签名Draft、唯一App安装/冷启/数据保持未执行；公开feed和现有App未改，Windows延期。[引导证据](../acceptance/2026-10-29-r18-onboarding.md)沿用。

2026-10-29 `.83` Mac 安装验收与清理**完成**；本段取代紧随其后的“原生复验/恢复/清理正在执行”阶段状态。唯一 `/Applications/EduPi.app` 为签名公证的0.3.83，固定 Desktop `f164abb76c7d4392817e14581edaa978cae71678`、Core `810455114565bab788cf89eb2524a995713ad3f3`。真实原生2880×1800画面里主导航展开/收起至少1.2秒/恢复的边界分别为415/115/413物理像素，内容同步移动；正常退出再冷启后收起仍为115，图标导航、二级对象栏收起/恢复均通过，`.82` 的主导航P2已关闭。合成根中的3条活跃记忆（其中`.82`同消息幂等新增只有1条）、旧revision2/history2、已接受任务4份旧备课产物及其历史只读、日程A合并备注一次/B软删和active18/raw20，在冷启后回读保持；本轮`.83`原生检查没有再调用模型或写业务数据。设置显示0.3.83、JEV/OpenConnector及现有辅助功能/录屏授权。原生证据为 `~/edupi-install-checkpoints/v0.3.83/evidence/gui-completion-083.json`、`gui-083-navigation-geometry.json`及相邻截图/冷启回读记录。

App已正常退出，原`ui-prefs.json`与3个WebView origin逐字节恢复；安装前备份的真实教师`.edupi`175文件、Pi会话146文件及4配置共**325文件**在安装、原生验收及清理后全部字节一致。安装版再次通过strict codesign/Gatekeeper，binary与CodeResources SHA未变。按逐项白名单卸载4个只读DMG映像并删除38条已核实可重建生成路径：4组本地重复资产、Desktop的`.next`与`src-tauri/target`、Core398的20条及Core402的12条已结束runner缓存；保留源码/工作树、runner控制、正式App、回退包、私有资料备份、远端4个Draft、8份小型公钥/签名证据和废纸篓。删除路径的allocated合计20,603,296KiB，逐步`df`可用量增量合计19,941,660KiB（可能含并发文件系统活动）；末次可用空间约888–890GiB。Core398三份普通文件的单文件`lsof +D`用法无效，**不计为单文件检查通过**；删除前对三个所属根目录的独立`lsof +D`、进程/CWD与runner注销检查有效且均无占用，纠正记录为`cleanup-core398-file-lsof-correction.json`。最终证据为同目录`cleanup-total-final.json`、`cleanup-final-verification.json`、`protected-data-after.json`。Release `v0.3.83`仍是Draft、公开feed未变；Mac-only的draft-proof/manifest/notify条件跳过，不冒充七平台publish证明。Windows按用户要求延期；真实教师根未启动、跨到期睡眠未在本次执行。

2026-10-29 `.83` Mac签名包与唯一应用文件安装已完成，原生主导航几何复验及最终资料/界面状态恢复正在串行执行，取代下方“尚未构建/安装”的阶段快照。源码PR398已普通合为Desktop Main `f164abb76c7d4392817e14581edaa978cae71678`/tree `a04fbe28a4336fa07936b3543e6567e2da0e8f48`，与受测head336129c1同tree；audit、rust-audit、linux-source三项源CI成功。仅删主导航根grid列宽过渡、补结构回归及版本0.3.83，Core仍固定受测 `810455114565bab788cf89eb2524a995713ad3f3`/Main4fad同tree。纯源码/受限无窗WK证据不视为原生宽度验收。

唯一[Mac-only signed Draft run40740037970](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/40740037970)/attempt1/headf164整轮success，notary-preflight/release/Mac build全success；Mac-only的manifest/draft-proof/notify条件skipped，不计七平台publish proof。Draft Release427004734/tag v0.3.83/targetf164未公开、feed未改。最终三资产同轮官方ID/bytes/SHA及本机回读一致：DMG `686020813`/`235169768`/`8e5398f0b55b4f98af705bc1f45fa8a793f10dc1dacbee32cb1cecacc572061a`，app.tar.gz `685998981`/`236481260`/`e6ed236f4c11cf351321946bed22d4a8379ed1a123c2bcd3233cddc1d9f0ee6a`，sig `685999539`/`404`/`0f39be68530a2934c9cdc26d4a2d0068900de4f30922a763bd0dd142eea0ace7`；Mac-only集合指纹 `sha256:27d94602f8918bea3898984aa10fc4f14300bc27d3ee54bb0c0de8fb5aee9e7a`。永久updater公钥/真实Minisign及篡改拒、App与DMG各自strict codesign/Apple Accepted/装订/Gatekeeper、tar11逐文件、Core双完整闭包及资源820份package.json只有一份qs6.16.1（Core qs/Lark 0）均独立通过。App Apple公证ID `77bbc56e-8482-4cef-9d95-8898e21864f1`、DMG `dbdf4980-45ef-4f7b-a07b-728bf5250be5`，原Job全文SHA `d5f51f5f3a10f34fffaa60387b1e669438219bd7a37c5767f77f4a1008bbfefd`，未借旧attempt。

`/Applications/EduPi.app`已在App/helpers停止态唯一安装0.3.83，binary SHA `592789f36f0c22bbe674f5f7506aea9e1f45bd78104e7cfd33bc1013996efdd9`、CDHash `c59312b73060d0342de2b37634a514bf646110ba`，安装后strict codesign/Gatekeeper再次通过，原.82整包在`.83/rollback`可回退。安装前原教师.edupi175文件、Pi全会话146文件和四配置共325个对象已在私有700目录按基线逐字节备份，文件替换后325全部字节一致；合成UI根247文件也单独备份，原3WebView origin已备份并只暂隔离workspace/draft/unread。当前唯一原生CUA操作权已交“重做设置与管理中心”任务，只核导航收起至少1秒后轨道应由约208CSS缩到58CSS、主内容同步移动及展开/冷启恢复，顺带被动确认既有4产物/日程/记忆未失；没有结果前不能勾选主导航P2关闭。结束须正常退出App、原ui-prefs/WebView归位、真实资料最终分类并按精确白名单清理。Windows没有构建，Release仍Draft。证据 `~/edupi-install-checkpoints/v0.3.83/evidence/` 中signed83-package-handoff、signed83-notary-accepted-proof、preinstall-real-profile-backup、protected-data-after-file-installation、mac-installation。

2026-10-29 `.83` 来源准备中，取代下方`.82`尚待导航P2修补的当前状态。`.82` 真实安装版已通过旧备课4产物当前/历史只读、旧A/B日程合并与同消息两次同参记忆写入单行/冷启保持；主导航收起后约55秒仍占约208CSS像素，二级栏折叠正常，真实对照图与mtime已存 `~/edupi-install-checkpoints/v0.3.82/evidence/gui-082-navigation-width-persistent.json`。私有无窗口WebKit夹具遇框架自行创建窗口后按守卫exit2，只是受限诊断，未做ablation或代替安装版。源码原分支仅取消根`grid-template-columns`几何过渡，保留已存在的高优先级collapsed 58px规则；PostCSS结构回归先RED后定向21/21、0skip，独立审阅继续。Core受测pin仍 `810455114565bab788cf89eb2524a995713ad3f3`（Main4fad同tree），五处版本元数据与发行说明已改0.3.83；源码PR/CI、新Mac-only Draft/安装和真实CUA宽度复验尚未进行，不能把源码改动当修复完成，也不重复构建Windows或公开feed。`.82` Draft与签名证据保留，当前安装版已正常退出、原Root/ui-prefs及3WebView origin恢复；安装前324原受保护文件逐字节不变，严格after仅因一份本次授权合成Pi会话exit1，分类证据已封存。只有下一次候选技术门与原生宽度复验通过后才按精确清单清理。

2026-10-29 `.82` 原生验收阶段结论，取代下一段“GUI仍在执行”的当前状态。唯一已安装 `/Applications/EduPi.app` 在明确合成根里实际完成：原同一accepted任务4份备课产物当前及历史版本可读、只读无保存；原A/B计划合并且冷启后A时间地点与唯一备注保持、B软删、active日程18/raw20，无旧意图重现；一次Native Send使真实模型连续2次同参`memory_write`，回执同ID、第二次replayed=true、仅1新增活跃记忆，正常退出重启后两原工具结果及同ID/唯一条仍在。旧.81保留的记忆ID/rev2/history2和旧132 marker仍在；首页/设置管理与权限状态实际打开，辅助功能和录屏显示已授权。证据 `~/edupi-install-checkpoints/v0.3.82/evidence/gui-completion-082.json` 及相邻原生截图/AX记录；没有写入真实教师业务资料。

**未通过的单项P2**：主导航“收起”后标签隐藏/按钮可恢复，但在真实2880物理截图里左栏仍接近展开宽（源码应约58CSS）；二级对象栏的收起/恢复正常。截图 `gui-082-main-nav-collapsed.jpg` 与 restored 对照已保留，当前没有computedStyle证明，不能把源码CSS规则当作运行修复。源修复仅在原分支导航CSS与直接回归范围内调查，拟把其余Native结论作为固定已验事实，定位后只建下一次Mac签名候选，再以原生CUA复验本P2；`.82`不记UI全通过、不公开Release/feed，也不提前清理。

GUI操作者已正常Cmd+Q、App/helpers与bundle句柄0、原`ui-prefs.json`逐字节恢复且没有重开真实根。parent已恢复原3个WebView origin，全部与原备份相同；严格`protected-data-after.json`按设计exit1且证据保留，独立分类确认差异只是一份本次授权的合成Pi会话：原324个真实业务/会话/四配置文件逐字节不变，来源、两同参工具调用与冷启会话已逐项核实（`protected-data-after-gui-classified.json`）。原正式82 App及.81回退、私有220MB原资料备份和所有签名包/缓存均保留；只有新候选本P2复验和最终资料/回退条件满足后才执行精确清理。Windows按要求延期。

2026-10-29 Mac .82 已完成源码合并、签名包和唯一应用文件安装；原生GUI串行验收、最终资料复核与清理仍在执行，取代下方“候选未构建/未安装”状态。Core PR402正常合 Main `4fad3d7cd774569af958a55476d7b962ed9fb615` 与固定受测 `810455114565bab788cf89eb2524a995713ad3f3` 同tree `229ff8931c47786f232a9b81a24c0225a321f6af`；受测CI `40707976667` 与Main push CI `40713863110` 均成功，research64/64、Windows job skipped。Desktop统一UI PR396/Main `4f824f1e` 的源码/主线各三CI成功；最终严格Core pin PR397/Main `f3c528b2e590cdd72693dd4b32b62cf181128bfb` 与本地受测head同tree `f7b1ebde`，31条Core定向真合同0skip、type与release:verify通过；最终源带原诊断两文件SHA不变。

唯一[Mac-only签名Draft run40714440977](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/40714440977)/attempt1/headf3c整轮成功，notary-preflight/release/Mac build全success；按平台条件draft-proof/manifest/notify均skipped，不能算七平台publish门。Draft Release426835465/tag v0.3.82/target f3c保持未公开、feed未改。该轮最终3资产ID/bytes/官方SHA逐项下载回读匹配：DMG `685607755`/`235176528`/`19c0b1d74fbd9610f20d32e18cabc6a1b5209b595ddda820b99ceda89adeb58c`，app.tar.gz `685581064`/`236481506`/`e05e4e0bba19057361734a347c0907d07e338862c377961cf50c8b3f5658c0ec`，sig `685581622`/`404`/`4a3bb83eb9f74e11b97af7e79e35cb8de0b8e538aa42cc1bec51d8f048feb167`。真实Minisign及篡改拒绝、永久updater公钥、App/DMG各自Apple Accepted/装订/strict codesign/Gatekeeper、tar11身份逐文件、双完整Core闭包、资源820份package.json内唯一named qs6.16.1且Core qs/Lark未进入Mac闭包均已验；App notary ID `4a8b1281-9ed7-4c91-a0bd-f2a4438a729b`、DMG `5183d480-58f7-417c-af57-0809b835f3c7`。同轮Mac-only资产指纹 `sha256:51d26965f8b3aafb4f9244da5ca528301a82cf8e9e3ca3841ddc08ac9bbe468c`。这些是Mac-only包技术证据，不代表Windows/Linux安装或已公开发布。

`/Applications/EduPi.app` 已在停止态安装0.3.82， binary SHA `5fef328558f1f5bc15e68e6de151d8b6677163693f97f36cd6dd3fdd2661f9e2`、CDHash `80b74350e9340c3fc8bcf7634f66c41aa927eff5`，安装后strict codesign/Gatekeeper再验通过，原0.3.81整包保留回退。安装前原教师`.edupi`175文件、Pi全会话145文件与四配置/凭据经私有备份按旧baseline逐字节核对；文件替换后324保护文件全部字节相同。原3 WebView origin已备份并仅暂隔离workspace/draft/unread，当前由“重做设置与管理中心”独占.82原生CUA启动、同已存在备课产物/日程/记忆的版本读回与新双调用幂等/冷启核对。未完成该GUI报告前不写“安装版全通过”，不提前恢复原UI状态或清理本轮包/缓存；真实教师资料根、模型认证、系统TCC/launchd/时钟能源未改。Windows按要求不构建，Release保持Draft。证据 `~/edupi-install-checkpoints/v0.3.82/evidence/` 下的 signed82-package-handoff、mac-package-verification、preinstall-real-profile-backup、mac-installation 与 protected-data-after-file-installation。

2026-10-28 Mac .82 最新配对状态，取代下方 cc1d 临时候选。Desktop UI/设置统一源码 PR #396 已按原分支正常合并为 `4f824f1ea9bd78fb811562cd19c1ed529e04791a`，受测源head `cd13e525` 与merge tree同为 `a6190fc1`；其 audit、rust-audit、linux-source 三个源码CI均成功，原两诊断SHA未变。Core主线新 `ecf245c7` 的v16召回来源判定确会改变Mac双闭包，故Core原分支普通合并为 `810455114565bab788cf89eb2524a995713ad3f3` / tree `229ff8931c47786f232a9b81a24c0225a321f6af`，保留原备课历史只读与同消息记忆幂等修补。schema仍8701，Desktop component `5609d8bf`/raw `806e3ff4`，Runtime component `e804c300`/raw `a1d78292`。旧cc1d完整Core CI成功只证明旧头；新8104的10条合并定向命令通过，新头完整CI/PR402合并待完成。Desktop目前已把严格身份改为8104，type与release:verify通过，实际Core合同组合仍在执行；新的小范围pin PR尚未创建，Mac.82标签/签名构建/安装尚未执行。

本次私有Mac验包脚本的4项实证假通过缺口已保留RED反例，修补后13/13定向guard测试与独立只读复核无剩余确定P0–P2；涉及真实schema/raw清单实体比对、job attempt强制匹配、当前App原生签名/装订/Gatekeeper命令及tar11逐文件校验。当前没有用这份脚本验.82包，也没有下载新资产或写通过报告。原.81 App正常停止后，原3 WebView origin恢复且与备份一致，真实教师资料和四固定配置保持；.82已备份现存合成资料247文件逐字节相同，建干净私有source-only源副本但不替代原分支。后续按实际同一run资产、签名、公证及唯一App安装/冷启复核后才清理。

Core统一修补已固定为 `cc1d11940430792a7e30d2f552a964b980ee9794` / tree `d05107af699c36c73d24fb4a220d0db274b0cc9c`，schema仍8701，Desktop component d5070654、Runtime74640e84；原57b之后仅旧备课投影历史只读兼容、同消息记忆幂等及直接回归/生成清单，无新增数量推断实验。旧来源revision仅允许初始两个epoch、完整未截断Core回执，回溯日期的ABA和满100审计记录均拒；记忆同消息不同call精确参数复用回执，改参冲突/跨消息隔离/已删除事实不复活。memory最终13/13、实际冷进程与并行writer通过；artifact现场冻结4文件及r1/r2读回SHA正确、原记录无修改。统一官方生成/type/protocol/双closure/writerC3七命令均过，正常源PR/完整CI仍待；Desktop已消费三严格身份，Mac新包仍未构建。

原生GUI已正式归还。parent在App/helpers停止态恢复原3 WebView origin，全部matchesBackup且无新增origin；strict全字节保护检查如实exit1保留，补充分类证明323原文件321不变、2个后台日志原前缀SHA不变仅追加788/553B，另1份新会话严格是本次授权合成CWD/一个user/两次memory_write。原教师业务/会话0改、四固定配置字节同，不覆写并发日志去制造零差异。证据 `protected-data-after-gui-classified.json`、`webview-prefs-restore-before-install.json` 及 `gui-completion.json`；该次.81结论不替代.82安装复验，尚未清理。

2026-10-28 Mac .82 统一交付进行中，取代下方 .81“GUI继续”的当前状态。新首页、统一组件/动效及设置管理中心源码已普通合并到原分支，原 UI 工作树/index/mv 未动；3476 项本地测试为3428通过、48条件跳过、0失败，type与lint通过，不能替代新安装版视觉验收。版本准备0.3.82，尚未创建tag、构建、安装或公开feed。

.81 实机已完成原计划合并并实际CUA冷启动回读：A原时间/地点保持、备注只合并一次，B软删，日程19→18、原始20行未新增；同一accepted备课任务保留。实机又发现两项待修：原4份备课产物文件及SHA均完整，但新来源投影导致API409 stale_source；一次Send后模型两次相同memory_write落2个独立ID，冷启动后重复仍存在。两项已在Core原分支完成针对性源码修补与负例验证，最终清单、独立审阅及源CI继续；旧receipt不重种、不静默改写。Native随后已对重复合成记忆执行可见删除、编辑和历史恢复，保留原ID/原文/版本2及两条历史；二次正常退出后由CUA冷启回读、主动rescan均通过，日程仍18条、原意图不再出现。该记忆恢复证据不是旧备课产物写权限，后者只恢复历史只读。新.82仍须核对同对象跨版本保持、四份旧产物阅读及同消息两次写入只落一条，当前不得记新安装通过。证据为~/edupi-install-checkpoints/v0.3.81/evidence/gui-081-{artifact-upgrade-regression,memory-double-write-owner,plan-merge-owner,cold-retention-owner}.json。

当前Native GUI由“重做设置与管理中心”串行独占，Mac实际锁屏时等待用户自行解锁，parent不绕过或同时操作App。Core与Desktop源门通过后只构建Mac；Windows延期。未清理本轮下载/回退/编译目录；最终App停止、原Root/WebView恢复和真实资料/配置保持复核后，才按精确路径清理可重建生成物。

2026-10-28 Mac.81 已完成签名包与唯一应用文件安装，GUI串行验收继续。固定Desktop `a78303e53e9b986a9b942994b77f796081456b50`、Core `57b6c1fd754e69b3f04d50f39fa07fc1e9b3bad2`；Core398正常合main7d659且同tree d5f，官方完整CI40652352539/attempt1通过、research63/63。Desktop394/395已正常合并；395仅三身份+账本，按paths不触发额外CI，新增真实合同12/Corebroker1/type与独立清单核验通过。

唯一Mac签名Draft run40657262218/attempt1全success，Draft426417109保持。三资产最终ID/bytes/官方SHA、永久updater公钥锚/Minisign与篡改拒绝、App/DMG各自签名/装订/Gatekeeper、tar与DMG11身份文件、两Core完整闭包均实际通过。资源实扫820份package.json，仅OpenConnector一份named qs6.16.1；Core的qs/Lark中危不被组件闭包消费。Mac-only指纹 `sha256:673f489d18ab38eec956347499fcc747f4e3ee964ffe427646b2e84f56adb519`，不构成七平台publish证明。

/Applications/EduPi.app 已真实替换为0.3.81，binary SHA256 `a994020a9782b6912142d956b56b68b878fdd6a841eafbb275deef57767c0d07`，CDHash4d2f238833cab53c611a2ed412b6571b5225f843、TeamBY3XZG2839；安装后strict codesign/Gatekeeper再验通过。旧.77整体保留为配对回退，原Root/会话/模型与认证323保护文件在文件安装前后逐字节一致。原3个WebView origin已备份并仅暂隔离workspace/draft/unread，结束需恢复复核。10:34Z文件安装后App/helpers仍停止，installation-handoff已具体交给另一UI任务独占真实流程，parent不并发操作GUI。

历史显式恢复、原A/B计划合并、记忆新marker与冷重启去重仍在实际执行，文件安装不代替这些流程通过；完成后再保护复核和清理，当前未清理下载/回退/构建产物。原UI-Test-Data244文件快照已保护，旧已保存记忆不重试、原intent不重建。Windows延期；Release/feed未公开或改写。本节取代下方旧候选“未构建/未安装”状态，后续真实GUI结果另记。

2026-10-28 Core主线同步追补：此前固定ABA的完整CI40633463071/attempt2已通过，但正常合并398时主线新03ffd造成生成件冲突。现普通组合57b6c1fd保留两父，原样消费已合主线的召回时段/叙事数值边界、连续原文与多日持续事项；未追加数量算法或真实模型实验。新19条定向命令通过；Runtime schema仍8701，回复decoder/status/reason/shape不变，Desktop只更新三严格身份至57b6、component d09ae44a/6cd5b247和raw清单。完整新CI与Core合并仍待，不能沿用ABA通过替代新组合。全Core开发依赖2条qs/Lark中危在双manifest/严格复制闭包中均未消费，Desktop实际qs为6.16.1，待最终包遍历补证。Mac.81仍未创建tag或构建，Windows延期，原改动和资料保护保持。

2026-10-28 R04/R15/R18 统一源码检查：原适配分支已普通合入 UI `132a806e` 和最后 `1409dd6e`，保留双方历史。固定 Core `aba5ffa7019c24a917726ffa4baef37242bc704d` 包含本次主线6225与UI两项日程修补，schema8701c073、Desktop component441ac188、Runtime02fefc91；独立审阅、Main1/Main3备注/身份/鉴权与Desktop实际合同/API通过。本地完整Core首轮在旧手写能力清单漏列新命令处保留失败，修正后daemon与原链余下16项、research62/62全过，不改写首轮exit1；远端完整质量门继续。Desktop完整3417通过/48条件skip/0失败，type/lint通过、npm审计各级0。合并时保留最新安全依赖并补当前SDK记忆写入/遗忘回执；原历史/重播/编辑/压缩隔离不放宽。原教师目录、会话、配置已恢复且App正常退出，旧合成资料244文件已保护。版本.81只准备源码，当前CI与合并未完成，尚未打包、安装、清理或公开feed；窗口验收仍需实际执行。此记录取代下方“正在合并”与旧交接待授权状态。

2026-10-28 当前合并状态：人类已授权直接交接，统一 UI 与 Core 后串行完成 Mac 安装、冷启动、数据保持及精确清理，Windows 延期。正在将原适配分支与设置重设计分支合并；Core 以本次读到的 main 6225be76 加上 UI 所需的两项既有日程修补为固定范围。下方各候选与 UI 快照保留历史证据，不能视为统一源码或新安装已通过。冻结 .80 包不改写，新的组合源码尚未打包或安装。

## 2026-10-27 十一条召回空返与Mac交付

- **最新.80交付状态，取代下方准备及运行中快照**：Desktop PR392已正常合为9039d7e4b35ecab3c2bc2b7927e2c0dafd9ea223，与source83e1a83e/实际CI Checkout7a38c210同tree0bfe71fb8978854a4c100bc2c95c4bee741f49b7；源码CI40557788634三job全success，Core9a26/qs6.16.1保持。唯一[Mac .80签名run40559942024](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/40559942024)/attempt1整轮success，Release425835563仍Draft/tag v0.3.80/target9039。macOnlyFingerprint为`sha256:7a7f815d405f75c0e92278c54634abfda9406b5eff3381b67c820b331e970d5b`；该值不构成七平台publish proof，不公开Release/feed。
- Mac应用套2590pass/47条件skip/0fail，types/lint/高危门过；配对Core运行、修正后的host wiring及全部暂存运行/OCR/DOCX/OpenConnector/macOS集成过。完整非symlink SDK实际复制/隔离localhost执行组3pass、0skip，原未暂存SDK条件已补；签名后node JIT、Runtime/OCR/DOCX/catalog再次过。App Apple Accepted `ef1dd365-851c-404f-8df1-341acf26cf93`，DMG Apple Accepted `59b6599a-7caf-4e58-bde9-88830e6292e8`；同轮App/DMG装订、签名与Gatekeeper CI证据均保存，不与.79或更早attempt混用。
- 三项最终资产已按同一run的ID、大小和官方digest逐项下载回读，全部匹配：

| 资产 | ID | 字节 | SHA256 |
| --- | --- | --- | --- |
| EduPi_0.3.80_aarch64.dmg | 682634950 | 234492992 | b0de93c146e4d8c6d3eb39dd5553ac85fa1d4f63b5a3f3e8f924a12aed4c1210 |
| EduPi_aarch64.app.tar.gz | 682613531 | 235814487 | 20ce49bcfe58d85c053fa6407f7462b14409fe4a296e68342d124496cc2d271d |
| EduPi_aarch64.app.tar.gz.sig | 682613892 | 404 | e373eefa3918bba01641e09d3c46827294e7763e9d0f4616e5a18376776a3d2a |

- 本机只读挂载后，App版本0.3.80、Bundle ID/arm64/Team BY3XZG2839、strict deep codesign、已有App staple及Gatekeeper均通过；DMG本体也实际执行stapler validate与spctl type=open/primary-signature，退出0，并把绝对路径、asset ID/size/SHA、run/attempt/source、精确命令、原日志摘要绑定到dmg-security-verification.json。永久公钥以旧已验证Release的SHA256 1e4dfd5ed31ca46ee167654232980397ffbd9f0ba5ddaf03d57201e3af859de6为锚，候选内嵌key一致；真实Minisign验证与篡改拒绝通过，不依赖另一UI任务正在改写的旧App来建立信任。updater与DMG内二进制/签名资源/版本/兼容清单/两漏包模块/双清单/schema共11文件逐字节一致。
- 包内Core双清单与固定source逐字节一致、官方generator(write:false)完整重算相等：Desktop145 modules/200 assets/109 runtime dependencies，Runtime219/203/110；component669fe/7afc和schema1d7保持。App二进制SHA256 f60a8386d7e7fe7e0264a68f8c34ab104af3ff6eba00eb0cc5f53a158c180979，CDHash3b5f1f9b1bbb277d41d6e7c30947f62d03de40bf。实际脚本输出macDraftEligible=true/fullMacDraftProof=true/publishProof=false，证据保存在~/edupi-install-checkpoints/v0.3.80/evidence。
- 原host wiring的1项条件skip已另行补验：在全新/tmp/edupi-mac080-one-shot-bfbp6fp4隔离根经官方create_task及重新读取，再运行Core health/snapshot/native task-review handler，实际1pass/0skip，模型0、真实资料0。原26pass/1skip日志仍保留，独立绿色不改写原结果。seed助手现严格绑定该唯一canonical根/Core/元数据且原报告存在即拒重跑；WebView助手固定backup origin manifest并保留新增origin；DMG证据缺失不得置通过。三处保护修补纯离线guard6/6过，未操作实际App/Library数据库。
- **安装尚未执行，不能记为安装版通过**。19:30UTC只读核实另一任务“重做设置与管理中心”仍active且正在准备重装同一/Applications/EduPi.app，已通过异步问题请求明确跨聊天交接授权；未获直接人类授权不发送消息、不抢占App或覆盖其UI构建。新包源、安装脚本、DataRoot/UI偏好保护方案已具体可验，后续待交接后执行。真实模型调用仍0，当前App/原资料/模型配置/TCC/launchd/时钟能源未改；公开feed未写。
- 为待安装保留本轮下载目录~/edupi-install-checkpoints/v0.3.80/macos-assets约448.5MiB及只读mount，下一步技术安装/回退结束后按白名单清理；不能为了清理删掉尚在使用的候选。三个已结束自有Core391 runner的指定二进制/externals/工具/npm及重复node_modules缓存已完成清理：11个明确目录原占2.086GiB，4个目标原不存在；33个内部链接只unlink未跟随，30份control/诊断元数据已归档，根路径/预期repo-run-head/无注册凭据/无在用进程均核实。源码/checkouts/.git、retained fixtures、别人的Core390目录、原树依赖/target、App/Library/下载包/mount/Trash均未动。df可用净增约2.241GiB含并发活动，不将它全部归因本轮；实际删除归属以各路径du及本轮目录core391-own-ci-cleanup-20261028/summary.json为准。原树target和其余候选产物清理待安装交接后继续，未记整轮清理完成。

- **当前状态取代下方.79准备快照**：qs追补已由Desktop PR391正常合为56de91121cab2d34161f34bfc28eba9104edce5b，与源head e1bc680c/CI实际Checkout a5ef7d83同tree53e66d3998f785b981f1cb365f0e79be50c5d26c；源CI40552172778三job全success，应用2589pass/48条件skip/0fail、type/lint、高危门、Rust审计零告警、Linux源检查均过。GitHub告警35实际state=fixed/fixed_at2026-10-27T17:43:52Z。唯一.79 Mac签名run40553664101/attempt1已失败，详见下方夹具追补；现准备.80，不改Core9a26或qs6.16.1，不重跑/改写旧tag与Draft，不将源通过记为签名或安装通过。
- 10月28日状态：R04源码与Core及Desktop集成通过，R15新qs安全追补及Mac签名安装继续。用户只允许的一次追加数量修补已完成，未追加真实模型调用；通过技术门后继续Mac打包、隔离安装及精确生成产物清理。Windows延期，不自动公开Release/feed，不改真实资料、模型凭据、TCC、launchd、时钟或能源设置。原.78准备已按授权提交，两个原升级诊断脚本逐字节保留；新安全修补使用.79，不改写已推.78标签。
- 原十一held逐项已核：8有答案、3应空。七busy源于前次15秒超时后未等真实completion回收，Core producer390只机械恢复原未发模型的七条，5正例/6来源正确，2无答案中一次raw误返由联系证据veto覆盖，原恢复失败和首分不改。数量题54克/20立方厘米被旧数学规范化当54*g/20*cm^3，本轮只加明确g/克、cm³/cm^3/立方厘米组合的当前正文核对，不缩放、不算答案、不借旧标签；异量/维度/日期/标识符/伪造/撤回删除和冷重启负例通过。另一个无候选问题没有本周书名库存来源，继续空返。
- 原invalid输出把U+201D引号改为ASCII引号，答案非原文substring，继续拒绝；正确evidence不能替代错误answer。原第40次已fetch，15.025秒后deadline取消，HTTP status/output/usage均无，外部慢因未知，失败计一次不重试。原额度163/200的记录已冻结，本任务新增真实模型调用0，不把余量当自动许可。逐ID表在Core `docs/loop/2026-10-27-recall-held-diagnosis.md`，原11不从首测报表删除。
- 额外发现并修复生产取消：HTTP响应提前断开才将私有signal传到Core召回controller；完整响应不误取消，忽略abort的backend仍占槽至真实完成。实际HTTP旧RED/新GREEN，随后查询、source bytes/mtime保持、drain围栏及Desktop真host→私有IPC→隔离worker连接回收通过。没有新增wire授权字段或放宽调用预算。
- Desktop补齐Core新`assessed/requested_contact_evidence_missing`白名单，保留其他独立支持结果，未知原因仍held；临时超时/busy/坏输出不再误报成缺会话范围。打包server脚本漏掉`recall_source_support.mjs`及`model_json.mjs`已补，原实际复制后import RED→GREEN；完整实际SDK复制运行仍须随包暂存门。两处静态审查无新增确定P0–P2。Core迁移quiescence不接受通用IPC模型runner品牌，但当前Desktop无该迁移入口；继续验证Main1/已激活Main3，不借测试primitive自动迁移真实资料。
- Core [PR391](https://github.com/PIGU-PPPgu/edupi/pull/391)已普通合入精确main `9a26adb825b4f6803d0e79a36576e074d431f59a`，与受测head `9a574c9f2c268848e8868be1f35121d82537c8f7`同tree `32aa2a7838a2e8eaf96097511e206a8a8f8e4d1d`。已正常消费PR390最终50a9；其合并main daa9e6d7与50a9无文件差异，不存在尚未消费的新生产改动。唯一最终Core Quality [40530149184](https://github.com/PIGU-PPPgu/edupi/actions/runs/40530149184)/attempt3/job122316182300成功，实际Checkout为9a574c9f；完整npm test、research58/58、type、protocol、双closure、全依赖audit0与tracked clean均过，Windows job skipped不计pass。正常合并及原Core分支FF/push已完成，无admin、auto或规则豁免。
- Core前两次同source手动CI因完整Git历史传输在Checkout取消，未执行源码检查；原40500391059误分配到其他任务runner也未执行Checkout。第三次复用非hardlink同source Git副本、官方Node22.23.1及同锁公共npm缓存，保留正常远端Checkout及所有质量命令，运行30分51秒。独立task-mac标签、精确repo/ref/head/run/job/attempt guard和ephemeral注册/注销实际核实，不动其他runner、launchd或用户全局Git。原失败不改记成功，未创建额外付费构建。
- 正式Core身份：Runtime schema `sha256:1d7ea8b9090dd4b13f093ae91db0b0e16fe061b814a3df7477c0d605fabc393f`，Desktop component `sha256:669fe05f9c6d7da1fd76276242012ca336ab83871c870ffd8264cc565d3a6d10`，Runtime component `sha256:7afc489e86dde97a6e4c6ae83cd868f68f132513b12bccf2c7ff225b49aa31a0`，Desktop清单文件SHA256 `c15c260dc7c43af2d88899fe3b049551a2f2159d09c49aab8e01c9699a499b98`。双清单与受测候选逐字节相同；Bridge/occurrence/fixtures/Pi1.0.2不变。
- Desktop实现为176aa982，.78版本准备为1d13b9ea，原源CI40531611437三job成功；应用2588pass/46条件skip/0fail、type/lint/security0，组合107pass/2条件skip及候选最后32pass/1条件skip分别保留。改为最终9a26后，本机Mac26.6/arm64、Node22.23.1的严格身份/实际Core host与私有IPC/隔离worker/当前来源/复制后import组17pass、1完整SDK尚未暂存的条件skip，type通过；真实上游请求仍temperature0/maxTokens4096、取消连接已回收、后续冷查询成功。该条件skip须在实际包资源门补验，不能计pass。Desktop [PR390](https://github.com/PIGU-PPPgu/edupi-desktop/pull/390)已正常合为80f424169a1b4d640c7b539fe960817e2084dfa5，与最终source head c702d0fb、实际CI Checkout a893b34a同treea8f5fa6e20f5b133cd012d42297c153ad3cf9335；CI40546928341三job成功。Linux主机应用2586pass/48条件skip/0fail，type/lint/高危门过，完整Rust audit --deny warnings零告警；Linux all-targets、GLib/D-Bus实际10项及可选编解码编译过。该主机缺Core/原生工具的skip不冒充Mac运行证据。原分支FF/push及独立最终pin复核通过，原两诊断保持。
- 原新旧证据位于 `~/edupi-install-checkpoints/v0.3.77/evidence/core-recall-gap-install-20261027/`，包括逐项诊断、原RED/新GREEN、最终CI完整日志与same-tree绑定。Core第一轮60查询及恢复7条的原始分数不变；57成功捕获回放为47正确支持来源、0禁例，原非法引号仍held；没有成功捕获的数量题及超时不冒充新模型复测。前轮实际513/515正文17页认证与JPEG两调用四产物证据仍保留，其历史实现本轮没有变化。
- 当前唯一 `/Applications/EduPi.app` 实际仍为另一UI测试任务的0.3.77/Core03，源码与公证状态不能沿用旧公开70快照。安装前重新核对使用状态，保护当前App、资料与WebView草稿/导航偏好，最后恢复这些偏好；候选仅在明确合成根运行本机模型。签名秘密仅查名称不读值，永久updater公钥仍以旧已验签Release的SHA256 `1e4dfd5ed31ca46ee167654232980397ffbd9f0ba5ddaf03d57201e3af859de6`为锚。v0.3.78标签已固定80f42416，但本任务尚未派签名run、创建Release或资产；发现下项新告警后保留原标签并改准备.79，打包、安装、清理均未开始。未构建.78的记录保留在原目录，新交付证据改放 `~/edupi-install-checkpoints/v0.3.79/evidence/`；回退副本用非App后缀避免新增LaunchServices重复登记。

### qs追补

- 10月28日推送80f42416时新增GitHub告警35；[官方公告GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw)在16:10UTC刚进入GitHub数据库，影响qs6.7.0至6.16.0，修复版6.16.1。依赖链实际为OpenConnector1.6.5→ali-oss6.23.0/urllib2.44.1→qs6.16.0，不是新增框架或已证实的桌面外部可利用路径；目录及外发deny-all保持。此前高危门通过和旧audit0不覆盖此新披露。
- 锁仅更新qs一条目的version/resolved/integrity，使用官方npm6.16.1的SHA512；其dependencies/engines/license及其他全部锁记录深比较相同，Core9a26/Pi1.0.2/React保持。npm update最初选到较新的6.17.0，未采用该minor，随后只固定官方修复patch并实际安装6.16.1；原锁和旧包副本保留。原有emoji-mart的React peer警告不改为本次新风险或擅自升级框架。
- 旧安装版三个新回归全部RED，含真实本机HTTP子进程被toString毒化输入终止；新6.16.1的来源解析/JSON/嵌套/null-prototype两comma路径、合法数组/可调用toString/默认序列化和后续健康请求均过，整个依赖安全23/23、0skip/0fail，npm audit各级0、type/lint、release:manifest/verify通过。所有用例仅本机合成输入，无真实模型或外发。证据为本轮目录qs-*，源码CI/正常PR合并及.79签名安装仍待；告警35后台关闭状态未提前宣称。

### Mac身份夹具追补

- .79唯一Mac run40553664101/attempt1，精确source56de9112；Apple notary-preflight、应用质量和配对Core runtime检查均成功，在后续Verify macOS Core host wiring失败。唯一失败是lib/edupi-reminder-notification-proof.test.mjs:191仍硬编码未合候选9a574c9f；190的严格compat比较已通过，实际Core身份9a26正确。此处是本轮pin迁移遗漏，不是Apple网络、产品运行时身份错配或签名失败；后续capability命令、包资源准备/编译/签名均未执行。Draft425795064保持原target56de和零资产，公开feed及实际App未动。
- 修补只给该测试新增git读取，并以实际EDUPI_REMINDER_PROOF_CORE_TEST_ROOT的checkout HEAD作为独立第二身份比较，保留与严格activeBridgeIdentity的第一比较。原15秒期限、取消、业务字节、无Runtime/model启动断言和其他测试体均不改；非历史文档已无旧候选SHA残留。独立复核确认未降级门槛、无新增确定P0–P2。为保持tag/Release目标不可变，新版本使用.80，原.79失败不改记成功、不rerun。
- Mac26.6/arm64、Node22.23.1，在所有五个Core测试环境变量均指向最终9a26时，按release.yml原三命令实际执行：memory-recall-access及teacher-usage首组3/3；process-client/reminder-proof/execution中组26pass、1缺独立种子数据的条件skip、0fail；capability canary --require-recipient-confirmation通过三域9产物、持久outbox、审核/合成反馈、取消/收窄/冷恢复及收件人拒绝与公开确认，3次本机合成聊天、capabilityModelCalls0、externalSend=false。type/lint/release:manifest/verify通过；原CI红日志和全部新结果保留在本轮目录mac080-*及.79/evidence/signed-*，不能把条件skip或未暂存SDK改记通过。
- .80四份版本元数据和发布说明已准备；私有验签/安装/fixture/WebView/原数据保护助手复制到~/edupi-install-checkpoints/v0.3.80/evidence，尚未执行主体。实际唯一App仍属于另一UI任务的.77，未退出/替换、未创建新canary或清理。后续须精确源码CI/正常合并、同attempt Mac三资产及签名公证、实际隔离安装和数据保持，再精确清理生成产物；Windows延期，不公开Release/feed，不调用真实模型。

## 2026-10-27 召回与大历史认证追补

- 最终Core155真实Desktop host另补默认16完整链、18正文/3页认证、冷重启身份保持及幂等通过，modelRequests0、所有host关闭；最终配对28/28、type/lint通过。该轻量最终身份补验与原513压力分开记录，未把16条改记513。
- 本轮源码实现与Mac本机补验通过。Core PR389已正常合为固定155275d1155d0cb5003574c2ee8fa35f0f353add，Desktop PR388已普通合为e623f4a4f785ec060220d35fd3bc6977adb4773a，source head7d8f03c1与合并同tree6bfd3cab，交付本轮消费者；本段覆盖下方849e及本轮中间候选状态。原任务仍为R03/R04，不替换旧失败或另立验收账本。不打包、不安装/操作正式App、不清理、不做Windows，不碰真实教师资料/模型凭据/TCC/launchd/时钟能源/Release/feed。
- Core性能只从独立实验中提取最终历史修补到官方562f3123基线的PR389，未混入三轮未过的启发式召回代码。非Windows完整ACK正常写复用已认证事务，逐次全历史认证、同inode/权限/Root/lease/authority检查及prewrite fsync保留；pending ACK独立修补，Windows沿旧两事务路径。codec仅省去JSON.parse产物的等价重排，公共strict检查/HMAC/AEAD/AAD不变。故障注入覆盖旧record/action/anchor篡改、同端口和其他已有端口的postcommit fsync失败围栏，并由实际新Node进程恢复未刷ACK且不重复动作。canonical record/action各168组等价、31组拒绝输入通过。
- Mac26.6/arm64、Node22.23.1同根交替7组最终登记→捕获→精读，历史实际524/531增至538/559：组合p50 1470.24→740.81ms、p95 1625.47→981.55ms；固定538/559同锚15组精读p50 79.99→69.84ms、HTTP health 92.31→78.78ms。仍O(history)，早期省掉prewrite fsync的中间数字无效且保留，不外推普遍SLA。
- Desktop实际513压力已通过：`desktop-core-history-2026-10-27T08-33-48-323Z-51051a79.json`，261.546秒；513新增登记/捕获后records515/gate516，17页共515唯一认证正文、撤回正文null及最后来源精确读回。实际host冷重启generation3→5、nonce变化而owner/root/登记保持，stale settle拒绝、重放计数不变；全轮modelRequests0、所有host关闭。登记最大455ms、捕获最大462ms、health最大102ms，只代表本根实测。初次补跑在约64条时发生617秒系统睡眠，原failed和pmset日志保留；唤醒后才用新根补跑，未改原15秒请求/20分钟总时限，也不把该次睡眠叫作跨到期业务验收。
- JPEG完整链通过：5份干扰后显式第6图片→当前可见来源及正文确认→严格source grant→公开选定task→真实registered owner自然Goal/队列→默认Desktop isolated Durable plan/draft共2调用/4产物→实际API读取/审核及synthetic反馈→真实host冷重启；产物、反馈和预算保持，无重复生成。根`edupi-visible-preparation-jpeg-rmyuVf`保留，证据副本`desktop-jpeg-evidence-copy.json`。只有本机合成provider，无真实模型外发或安装版操作。
- 新召回消费者同时校验query的`model_execute`与`source_support`中的`source-support-v1`，无当前assessed支持不能让非空结果通过；Core先核对captured turn/owner/班级/学期/当前来源，返回后Desktop再次核对当前turn。模型只在实际query时读取父端现有安全配置，通过私有IPC/隔离worker执行；parent跨host/重载按工作区/model累计64次，单次4096tokens/12秒、取消后等待实际完成才释放槽和退出。真实SDK工具/变造结果拒绝、真实Core host/IPC/worker本机4调用、cold restart和共享预算均通过；明确为接口和隔离证据，语义新未见分数另核验。旧候选bc1142b7不转发temperature0，新增wire断言已RED；Core388正常合为6e11f120后，性能树正常merge并官方重生双清单/matrix，组合9b760fa4的真实SDK上游请求temperature0/maxTokens4096已GREEN。新的JPEG同链在组合版本再次通过，根edupi-visible-preparation-jpeg-PHAGDV与两个默认Durable调用均保留。
- Core独立新未见v11首测由另一个Core任务在当次200次固定GLM套餐总额度授权内完成；本任务只读核验、零新增真实模型调用。60查询/45正例，queryhit37/45=0.822、来源recall41/50=0.82、precision1、禁例/无答案误返/跨班/跨期均0，预设工程门通过；51次实际请求与不可变首预测数组摘要绑定。原11held包括7个busy未调用、1超时、1无效输出及2个无候选，保持原分，不把后续补核对记为第二次盲测，也不称全召回或正式L4。首summary摘要52508767、预测摘要756c7dd4，13份冻结源码摘要与组合Core全同；私有core-v11-source-evidence-binding.json及原三文件副本保留。三轮自有启发式失败仍封存，消费官方共享来源判别不等于将它们改记通过。
- 组合本机完整Core测试首次被visible-source资产守卫正确拒绝node_modules symlink。保留原symlink及共享目标，将同锁文件复制为真实348MiB依赖目录后，原完整命令重跑及最终tracked无变化检查通过；未放宽symlink/Root守卫、未npm ci删除现有依赖，原失败日志和复制布局记录保留。没有清理任何用户资料或生成产物。
- 应用完整2588pass/45条件skip/0fail、typecheck/lint通过；组合实际Core配对105pass/1条件skip，源码运行的scope、删除、续聊、cold和失败围栏继续成立。独立只读审查其余新接线无新增P0–P2，参数版本依赖已由真实请求补绿；正式Core pin155275d1与受测9b760fa4整树396e8eca相同。Core完整本机npm test、58条research(0fail/0skip)、typecheck、CI环境、contract、双closure与226依赖审计各级0均通过；本机无lint脚本，未记为lint通过。GitHub组合CI40479526735/job122106220751已success，实际checkout46680e4b79fc778997d833167b47249b579ea235与source9b760fa4、最终Core155同tree396e8eca；type/contract/closure/完整test/58条research/全依赖audit0/最终tracked无变化均真实通过。Windows job122106222619及retention条件skip不计pass，未派Windows构建。普通merge不使用admin/auto或规则豁免。全部证据归档`~/edupi-install-checkpoints/v0.3.77/evidence/core-recall-history-20261027/`，原7项工作文件逐一SHA全同；测试包、缓存、历史失败根和新手工fixture保留。

## 2026-10-27 当前Core消费者源码配对

- 状态：R03/R04/P1-N02/P1-N03的本次消费者实现与源码验证通过；GitHub集成为[PR387](https://github.com/PIGU-PPPgu/edupi-desktop/pull/387)，提交依次为`5a9c8d31`、`fa90ab28`、`c323dfc3`、`b30b1fc8`。安装、签名包、Windows及真实数据迁移未执行，发布/feed未改。此次不清理，原7项改动逐文件SHA保持；不触旧封存升级根、真实模型凭据、TCC、launchd、时钟或能源设置。
- 固定Core为已合main`849e4a08a0f6bdb3e41e5e28ac72c51f104fb96d`，精确main Core Quality `40438813363`成功；该Core PR的Windows/retention检查跳过不计通过。Runtime schema `9a833c339c40e65d6f71d74bccd050cfb0a78630f5f519887d02b97f06bf2ae5`、Runtime component `c6063959c59c9efb6d0a1a5066131ba492a107b830abdc14a588219fc5bc1629`、Desktop component `345f9e3378db01c2bde9b003a178280000792b5c5de3a19878f61dc4a5829885`、Desktop清单文件`3d11acd4b1feee6df48b7ef938f4baae29545aede8c73f81b797d9ff43d8c3b1`均为SHA256。同版官方`generateComponentManifest(write:false)`重算及全部模块/资产/依赖的大小和摘要匹配，未生成bundle。Bridge/occurrence/fixtures及Pi/PiDurable1.0.2保持；已有清单复制逻辑会包含固定JXA/worker/PDF preparer与v3模块，不引入Swift编译器。
- 消费实现：去掉PDF永久拒绝，保持Core当前来源、opaque proof、owner、字节和metadata围栏。图片须独立核对正文，再显式采用安排或确认G1片段；上传和章节建议不自动采用或准备。可见片段使用真实页码/像素区域与UTF-16半开区间，读回核对内容和来源身份。DOCX/ICS兼容，旧文件更新/取消/配对/课表写入拒绝不放宽；超限或文字不可核实显示当前Core原因。现有host动态使用配对protocol，兼容Main1及已激活Main3，null历史上限不转换为0，不新增调度或自动激活/迁移。
- 取消/退出补线：`material_schedule_read/apply`及G1 `source_preview/review_source`沿用既有38秒completion关闭窗口，单次请求仍15秒。真实Core FIFO coordinator配合模拟transport/时间，四项原代码均在`5000 !== 38000`失败；修补后含旧intake和health/invalid/pre-aborted负例共7pass/0skip。不是实际OS睡眠或安装App关闭证据；独立只读审查未发现新增P0–P2。
- 本机环境Mac26.6/arm64、Node22.23.1。`npm test`最终2587pass/44条件skip/0fail/0cancel，`tsc --noEmit --incremental false`与完整lint通过；材料focused51项、Bridge实际12项通过。配对root/process/supervisor/health/snapshot/host组55pass、2项因缺含学生/校历/任务的单独种子根skip，不计通过；修改pin的提醒只读证明单独1pass/0skip，未发系统通知。依赖/Rust实现未改，沿用上轮证据；本次源路径没有触发现有远端CI，不派发额外付费构建或伪记新CI成功。
- 新合成根实际Core/API E2：PDF/PNG/JPEG收件仅给只读候选→当前read→取消零写/图片缺正文确认拒绝→显式apply→重复/副本仅同一事项→G1原文确认/重读→真实daemon重启→metadata与同长度字节变化拒旧证明；4页PDF保持held并显示Core具体原因。PDF与PNG各另验5份干扰后显式选第6份，生产`registerAndCapturePrompt`触发自然Goal/队列，默认Desktop isolated Durable plan/draft各一次、共2调用生成4产物，实际API读取/审核及`synthetic`反馈后冷重启：nonce/fencing变化，产物hash、workCase/artifact修订和transitions不变，反馈current、预算仍2调用。无`prepare_task`/intent apply或手写canonical冒充自然来源；不证明JPEG完整备课链或教学语义质量。
- Main3新根：实际Desktop supervisor/host验证旧128与新`sqlite_stream_v1`/两null容量、登记/捕获/未捕获封存、撤回/重放。原513压力探针在自设8分钟时限结束，实际457新增捕获；失败报告保持。独立正常host冷启证明同owner/root、generation3→4和459来源/461身份；其后测试误将停止态candidate容量当stream导致断言失败，亦保留。改用normal-v3品牌Runtime的独立认证分页15页/459条正文、4次精读/2登记读及撤回正文null通过，generation5正常关闭，没有新增消息。新脚本默认16条，显式压力513条；新版完整默认/压力循环未重跑，不能记为通过或用Core自身513测试代填。全历史认证开销仍随历史增长。
- 浏览器实际操作真实React源码组件，验证未核对禁用、独立采用取消/确认、重读撤销核对，以及图片片段选择后仍需正文核对；API与系统确认是合成适配器，截图`source-preview-image-check.png`仅为源码交互证据。原Helvetica字形触发`pdf_native_text_mismatch`保留，清晰排版的原生读通过后才继续；PNG首轮provider引用空格不符被Core拒绝，修复合成provider后通过，未放宽来源证明。Core R04 v9原禁例失败与L4父状态不改记成功。
- 私有证据统一在`~/edupi-install-checkpoints/v0.3.77/evidence/core-latest-adaptation-20261027/`：`source-identity.log`、`application-tests-final.log`、`paired-runtime-tests.log`、`visual-completion-{red,green,final}.log`、`material-source-final.json`、`preparation-{pdf,png}-final.json`、history各原始失败/冷恢复/分页报告、截图及最终状态归档。新旧测试根、下载依赖和编译缓存保留；本轮任务拥有的host/provider/源码预览均关闭。公开App未操作，不追认任何新安装/TCC/真实升级验证。

## 2026-10-26 完整Rust依赖告警源码修复

- 本项覆盖下方“3ZIP漏洞/7非Mac警告延期”的旧源码状态，R15/R22/R23为源码验证通过、安装仍暂停。[PR385](https://github.com/PIGU-PPPgu/edupi-desktop/pull/385)正常合入`77b8b081f249960eed844d72616502cd5a79e758`；head `96d71daa5c2e5f1642c9fed7d8c12b81d5c2bf06`、实际CI checkout `058ed4c63845f64ee42e703e81b6bb517cb5a8fe`与合并同树`7e56d2795b9ec0b55c16247df4329982f6bd9b85`。ZIP锁9.0.5，chacha20锁0.10.2、clipboard-win锁5.4.3；GTK0.19/GLib0.22及zbus6.1替代旧unsound/退休宏与分拆类型库，不通过删平台功能、改名或伪造版本隐藏告警。
- 已发布父库尚未配套维护绑定，22个原版本父源码按官方归档SHA/VCS/许可证保留，实际修改限于依赖/必要API接线及测试。ZIP仅移植上游ba98bfa；Tao通道用维护实现保留主线程/FIFO/优先级/关闭语义，GTK/portal/X11/Wayland、通知、单实例、AT-SPI/P2P及lockstep验证保留。测试workspace明确5包加根包，默认仅根包；开发依赖中新引入的async-std/paste曾被严格门实际拒绝，改为现有Tokio和维护pastey别名后重新通过，xcap可选全图像格式仍保留。根Rust floor保持Mac1.90，Linux绑定按1.92验证；Core9f/Pi1.0.2、钥匙/更新源/权限不改。
- 最终[CI40223742082](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/40223742082)三job全部成功，独立日志/受测树复核无新增P0–P2。Rust job121260657010实际`cargo audit --file src-tauri/Cargo.lock --deny warnings`检查720包，漏洞/维护/unsound/yank告警均0，无ignore、target过滤或降级。应用job121260656764：npm各级0、安全20pass、全套2573pass/42skip/0fail/0cancel、type/lint/branding2pass；42项保留Core/隔离runtime条件及工具缺项，不计通过。普通ready/merge无admin/force/保护规则变化。
- Linux job121260656996使用Ubuntu24.04/Rust1.92，实际all-targets源码检查2m13s通过；GLib通道5、AT-SPI wire1、私有总线通知2、重复单实例回调1、portal成功/取消/失败1，合计10pass/0ignored，其他1147filtered未运行。通知含两种Tokio运行时中的同步show/update/close，不触真实通知；portal不调用真实屏幕捕获。xcap全功能源检查25.70s通过。Mac本机Rust1.90生产默认check19.59s与6项内存签名/安装前拒绝通过；上游和条件编译的rustc警告另有日志，不将“RustSec零告警”写成“编译零警告”。
- 保留所有先前失败：首轮GTK私有trait路径失败已修，第二轮生产编译过但测试包非workspace未执行，第三轮运行前9项通过但portal因缺GBM开发库未链接、审计拒绝新dev警告；最终补齐测试workspace、维护开发依赖、GBM/NASM和sudo环境后才记通过。ZIP私有真实库旧4.6.1为2fail/3pass，新9.0.5为5pass；旧0369流病例未重现，不能宣称三公告均红→绿，库测试也不替代Windows updater运行。原日志和所有合成fixture保留，未重试被平台中断的旧复现。
- 来源/差异/移除条件见`src-tauri/vendor/security-patches/`四份说明。私有证据为`.77/evidence/rust-remaining-verification-20261026.json`、最终三job完整日志、CI checkout JSON和各早期失败日志。源码和许可证按记录差异保留；独立Cargo.lock及缓存标记未纳入，统一使用根锁。独立归档差异复核通过，原有上游空白保留，不改Git规则压掉检查。已有未使用的异步创建后混合同步通知API限制不声称修复；本项不扩大为完整GUI验收。
- 原5个非Cargo路径字节保持，两个Cargo原`.78`准备差异保留未提交；本轮未Windows构建、未打包/安装或操作真实客户端、未清理，不改真实资料/模型凭据/TCC/launchd/时钟能源/Release/feed。所有旧新源码、编译缓存及fixture保留；旧升级根封存、心跳暂停。Windows运行、真实升级/失败恢复及图像格式运行仍未验，按用户本轮源码范围后置。

## 2026-10-25 Mac更新路径源码风险

- R15/R22状态为源码验证通过、安装暂停，取代下方同项旧依赖状态。[PR383](https://github.com/PIGU-PPPgu/edupi-desktop/pull/383)正常合入`2d4fdce60d614e02f8528364d1becde6f4fbe40b`；head `e9de2b27fbed6d8aca7d716ae2c42fdaf64eb588`、实际CI checkout `fdc60d1e86bb78e750c0c47adda8c5667654cdff`与合并同树`5a6e6ef554c2d1ab1e8131af2f286b133d868a27`。正式Rust/JS updater2.14.0补安装入口复验及上游Mac旧App交换/恢复保护，必要同步Tauri2.12.5/API2.12.0及其原生依赖；无新缓存恢复入口，Core9f/Pi1.0.2及授权配置不改。失败恢复仍须实际安装验证，不把上游实现和编译当成安装验收。
- 本机macOS arm64/Node22.23.1/Rust1.90，固定锁离线生产默认features的`cargo check`27.17s通过；平台metadata348节点，无原8个Rust finding包、声明MSRV均≤1.90。独立安全审阅后的`cargo test --test updater_security`实际6pass/0fail/0ignored：有效公开测试签名仅verify，篡改字节和签名版本不符的install均在文件安装前拒绝；未运行EduPi main/setup、有效安装、网络、UI/TCC或删除。过程配置只禁bundle/resources暂存，custom-protocol与安全配置保持。新fixture私有API/空配置/空endpoint和JS缺省header的早期失败保留，修正后才记通过。
- 真实JavaScript SDK的两分支包含乱序Channel进度、下载资源身份、安装拒绝不重启及接受后才重启，相关10/10、依赖门4/4、类型/完整lint/branding2通过。新[CI40177375623](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/40177375623)的应用job121120900162成功：Ubuntu24.04/Node22.19、npm各级0、安全20/20、全套2567pass/42skip/0fail/0cancel/type/lint通过；42项保留Core/隔离runtime条件和pdftotext缺项，不计通过。完整日志及受测树独立复核通过，没有重跑旧源码套或派发签名构建。
- 同轮Rust job121120900273仍因zip4.6.1的0367/0368/0369失败，另有原7条非Mac警告；所有finding与新Mac图交集0，不称全仓/整轮绿、不ignore或改规则。正式updater2.14仍声明Windows-only zip^4，上游分支zip9尚不在已发布crate，不能强塞大版本或伪称修复；Windows/Linux特有链延期。当前npm及GitHub open alerts均0，旧Zod34已由GitHub自动fixed于`2026-10-24T18:59:53Z`，未手动dismiss，覆盖下方平台状态滞后记录。
- 准确兼容边界：旧minisign0.2.5已严格检查S<L，0.3不是本项目新增非规范签名修补；`requireSignedVersion`仍默认false兼容旧无version签名，但新版对带可信version的comment新增一致性拒绝。上游默认新增system-proxy，空代理时会读取OS代理，显式loopback代理转发已测，不能说路由语义完全不变；未改钥匙/更新源/系统代理设置。npm仅两目标条目及声明变化，Cargo变化为必要Tauri链与测试依赖；28个新registry版本、23份可用归档/777源码文件及两npm包的官方摘要/安装文件已独立核对。
- 私有证据为`.77/evidence/risk-followup-verification-20261025.json`、`risk-followup-mac-{metadata,check}-20261025.*`、`risk-followup-native-updater-tests-final-20261025.log`、`risk-followup-updater-source-green-20261025.log`、`risk-followup-mac-guards-final-20261025.log`、完整CI两job日志及checkout JSON。原5个非Cargo路径逐字保持，两个Cargo原`.78`准备差异保留未提交；本轮不打包、安装/操作真实App或清理，不改真实资料/模型凭据/TCC/launchd/时钟能源/Release/feed。target约7.9GiB、私有Cargo缓存1.5GiB与全部旧新证据均保留，可用约999GiB；原合成升级根封存、心跳暂停。

## 2026-10-24 HTTP与邮件依赖安全修补

- 本项取代下方Undici/Nodemailer待处理及npm仍有告警的旧状态。[PR381](https://github.com/PIGU-PPPgu/edupi-desktop/pull/381)已正常合入`3c57391a72331deaf3466b0c9d9e3acc730a4bb8`；head `2ca7f52699b7b3588152a934f622ecf28c65a973`、CI实际checkout `a84dacc0e9cf8fed677b357ed2f2f365f9ec9c7a`与合并同树`5c76d30345f9b7ac69dc4170d22f9dfc58eff5f6`。仅4文件，Undici8.10.2→8.12.2直接依赖及原override、Nodemailer10.0.10→10.1.4原scoped override、安全回归与现有说明文档；未引入新框架、改Pi1.0.2/Core9f身份或放开连接器权限。
- 来源已按代码核对：`instrumentation.ts → lib/http-dispatcher.ts`在Node后台配置Undici代理/全局fetch，`lib/update-proxy-server.ts`也直接使用；Pi/OpenAI路径共享解析到该npm包，Node内嵌副本不因本次npm升级而改变。Nodemailer来自OpenConnector1.6.5完整目录及mailparser，提供邮件解析/MIME/SMTP实现；catalog宿主仍Action/Proxy deny-all、Console仅GET，包存在不等于自动发送。完整目录带入未启用实现扩大维护面，是既有R23取舍，本轮不裁剪或新增邮件功能。告警是已知版本风险，不是攻击取证结论；同一leaf还会沿多条SDK依赖链显示。
- 本机macOS arm64/Node22.23.1/npm10.9.8；CI Ubuntu x64/Node22.19.0。两包Node engines分别≥22.19/≥20，MIT与MIT-0；registry/tarball摘要和4条npm ECDSA签名均实际匹配，官方gitHead一致。只以ignore-scripts更新2包，根Undici声明及两个leaf的version/resolved/integrity以外，全部锁元数据与原快照deepEqual，无包增删，OTEL/Zod4.6.7/SDK保持；原7项未提交路径逐项SHA仍同。
- 旧包8项真实反例失败已保留：SRI算法大小写绕过、实际Desktop dispatcher在>5enc截断响应下导致独立child退出、3类EventSource保留状态上限、4类地址/MIME误路由及版本门。补丁后最终定向12/12通过、0skip，涵盖真实代理、Pi SDK、MCP、Zod和普通MIME正例；只用loopback/禁网MockAgent/内存MIME，无真实SMTP或模型调用。初轮11pass/1fail不是新依赖回归：旧10.0.10与新10.1.4均实际复现quoted local-part中角字符的既有MimeNode归一化，最终parser仍严格原完整地址，MIME检查既定exact canonical单收件人，不宣称完整邮箱保真；未改包代码、删除病例或把原失败记pass。
- 新[CI40106979190](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/40106979190)应用job120910588876成功：npm审计各级0，安全回归20/20且0skip，应用套2605项中2563pass/0fail/42skip，type/lint/branding通过；42项含Core/隔离runtime条件和pdftotext缺项，不计通过。本地完整lint/branding2及tsc也实际exit0。Rust job120910588670仍失败于旧zip4.6.1三项0367/0368/0369与7条warning，未豁免或称整轮绿；这些包名与保持不变的已验Mac依赖图交集0，没有派Windows构建。
- npm本地原锁1high/7moderate→新锁各级0，属于已知依赖告警清零，不保证不存在未知风险。独立供应链/冻结diff/完整CI证据审阅无P0–P2；普通merge无admin/force/规则修改。私有证据为`.77/evidence/http-mail-regression-{red,fixed-green}-20261024.log`、初轮失败green日志、`http-mail-mime-baseline-20261024.json`、`http-mail-audit-{before,after}-20261024.json`、`http-mail-installed-tree-20261024.json`、`http-mail-ci-{app,rust}-20261024.log`、`http-mail-ci-summary-20261024.json`与`http-mail-review-20261024/`。
- 未打包/安装或操作已装客户端、未重跑native编译、未清理、未改真实资料/模型凭据/TCC/launchd/时钟能源/Release/feed；Windows继续延期。既有5.8GiB target与所有新旧fixture、包资料及日志保留，约1TiB可用；源码修补不代表已装客户端已更新或真实SMTP/远程模型流程通过。

## 2026-10-24 Zod高危修补

- 本项取代下方Zod待处理记录。现有[PR377](https://github.com/PIGU-PPPgu/edupi-desktop/pull/377)在原分支验证后正常合入`b260e91973e125b44d35837b271831fe57a593b7`；最终head `a57513f1fc8d3c0c5ef46df2ed906dc8647fb7dc`与合并树均为`d2b1b780d24082a8cb3722bc6d6ccb5a13dac968`。相对实际main基线`ebe59381`仅修改Zod锁项和安全回归；保留原bot ancestry，以普通FF更新原feature和既有bot分支，没有替代分支、force/admin/审计豁免或规则变更。原7项未提交修改逐项SHA不变，Core9f/SDK身份及Cargo锁保持。
- Zod4.6.5→4.6.7只改version/resolved/integrity，原PR顺带删除的OpenTelemetry optional peer1.9.0已保留，其他锁元数据与包清单不变。官方tarball的SHA512/SHA1、锁及npm registry ECDSA验签相符，MIT、无安装生命周期；8个关键文件与官方`b500a2ee`相同。源码依赖安装使用ignore-scripts，仅changed1package，既有React peer警告未规避；不是安装客户端。
- 本地环境macOS arm64/Node22.23.1/npm10.9.8，CI Ubuntu24.04.5/Node22.19.0/npm10.9.3。实际旧版三项红、新版定向四项通过：所有Zod消费者解析到同一补丁包，classic/Mini×array/set/map六例超上界时从128/256次元素校验及对应issues变为0次/1条too_big；正常边界保留、内界非法拒绝，真实OpenConnector内存MCP调用通过。子进程限制96MiB/5秒，不制造真实OOM，不声称无界集合也受保护。最终完整lint/branding两项及tsc均exit0，独立冻结diff/供应链/证据审阅无新增P0–P2。
- 新[CI40097755762](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/40097755762)实际checkout `26bebb537bf4afca0886bc27f89184642cb0c144`与head/合并同树。audit job120883470970实际失败于独立Undici高危，报告1high/4moderate包项、无Zod，安装树和应用兼容步骤明确skipped，不计通过；Rust job120883471207仍3旧zip漏洞/7warning、exit1。旧bot头CI的2556pass/42skip不替代本次跳过步骤，整轮不记绿。
- 同公告的原锁只读audit对照为2high/7moderate，新锁1high/7moderate；移除旧报告中的Zod后，其他findings逐字段完全相同。Undici、Nodemailer及派生项为独立基线风险，本次未扩大修补或隐藏失败。Zod在当前npm审计中已消失，GitHub SBOM也已识别4.6.7；但告警34回读仍open/fixed_at null，未手动dismiss或提前记关闭。
- 私有证据为`.77/evidence/zod377-regression-{red,green}-20261024.log`、`zod377-npm-audit-{before-refreshed,after}-20261024.json`、`zod377-final-{lint,typecheck}-20261024.log`、`zod377-final-{audit,rust}-job-20261024.log`及`zod377-review-*-summary.json`。最终锁SHA`13e11b65d702ae929e4bc6cf8d95fcbdde6f14814d82d0df7c1dc0fa68a6cf32`、test SHA`bb812d55c5a89b43df8e3c1a366b122a71298bf91ee2b962c10e6780722cb305`。未重复native编译、未打包/安装客户端或清理、未派Windows/安装包CI；已装App未操作，真实数据/凭据/TCC/launchd/时钟能源/Release/feed不改，既有5.8GiB target及新增审计快照均保留。

## 2026-10-24 Rust1.90与Mac原生编译

- 本项取代下方同日的工具链/原生编译暂停状态。用户本轮恢复工具链升级和原生编译，继续禁止打包、安装客户端和清理，Windows延期。原树`5deaabf5`加原有`.78`版本准备实际受验；原七项未提交文件的前后SHA逐项相同，未更改Rust源码、Cargo清单或依赖锁，不将本地`.78`称为发布候选。官方rustup安装精确Rust1.90.0并设为默认，原stable1.88保留；首次直连超时经系统既有代理解决，未修改全局网络/镜像或更新rustup。
- 环境为本机arm64/macOS26.6/Xcode26.6/SDK26.5。Rust1.90.0执行`cargo build --locked --offline --target aarch64-apple-darwin`，调试及`--release`两轮均退出0、无编译警告或错误；release使用项目现有thin LTO/单codegen unit/opt-level=s/strip设置。实际产生并核对arm64 Mach-O主程序、动态库及静态库，链接的最低macOS为11.0；这不是macOS11实机运行证明。
- 两轮保留默认`custom-protocol`和全部security/capability配置，仅用进程级`TAURI_CONFIG={"bundle":{"active":false,"resources":[]}}`关闭打包及包资源暂存；不生成Next服务器包、不执行Tauri bundler，也不运行产出的客户端。完整test targets实际编译和链接成功；独立审阅后精确执行37项无文件删除/无真实UI副作用的原生测试，37pass/0fail/0ignored，其余21项只编译、未执行，不能计通过。涵盖原生宿主身份、权限输入/快照边界、通知目标与门禁等局部逻辑，不冒充真实TCC或通知交互。
- 私有证据为`.77/evidence/mac-native-rust190-verification-20261024.json`及所列build/test/link/toolchain日志。原Cargo锁SHA仍`0270941a27fc153655a0b36c6175b2fd4cab45f8153f90b7f8da0d3eae2d7813`；调试主程序SHA`2cf9259d673dff0a54d6eaf834b0b665545a3b50919798eda1de99a0b643db07`，release主程序SHA`cd365663a4b83a17a3df84bb81fdcbb64774a19f82e1e05af388bfad05e509fd`。当前原生编译/链接门通过；打包资源、签名公证、客户端安装运行及真实ACL/TCC仍不在本轮证据内，旧全仓Rust审计结果不改记绿。`src-tauri/target`约5.8GiB、生成schema388KiB及新工具链506MiB按用户要求保留，可用空间约1TiB；正式App进程未操作、Core9f及旧根封存边界不变，未清理、未派发安装包CI。
- 新增风险另记待处理：本轮推送时只读核实[Dependabot告警34](https://github.com/PIGU-PPPgu/edupi-desktop/security/dependabot/34)为运行时Zod4.6.5的[高危资源消耗公告](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)，当前锁和本地安装均为4.6.5，补丁门槛为4.6.6；已有[Dependabot PR377](https://github.com/PIGU-PPPgu/edupi-desktop/pull/377)提供4.6.7更新。该PR未消费或验收，本轮未改npm依赖、不将之前npm报告0当成当前结论；原生编译证据不覆盖此Node运行时风险。

## 2026-10-24 Mac依赖树与共享渲染风险

- 当前源码head `ed57ed1f6c60fc31acf600280e6474d038c3c9db`/tree `2f8da7fca26d32139e8a993c165e53b488c44b9a`经[PR375](https://github.com/PIGU-PPPgu/edupi-desktop/pull/375)正常合入 `a6abeba9beface90170b19d2d4e1deee199202da`。唯一源码[CI40004124906](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/40004124906)实际checkout `5a43b648765fcd7dbf3302a517d1554ad7d9849b`与head/合并同树；应用job120587561902成功2556pass/42条件skip/0fail/0cancel/type/lint，安全回归13/13、npm报告0。Rust job120587562211仍失败，实际仅3旧zip错误及7条warning，其对应8个包名均不在frozen Mac图；不改称全仓或整轮CI全绿，无admin/auto/规则更改。未打包或安装，Core pin9f、feed、唯一App及真实资料不改。原.78准备和私有诊断未提交；Windows延期、不清理。
- 原Mac离线树缺包已定位为任务缓存缺旧crate归档。只按`--locked --target aarch64-apple-darwin`补齐下载，没有编译或改全局Cargo配置；随后原锁离线normal/build树和完整platform metadata均实际通过。原树343唯一包/358 metadata；更新后frozen树346唯一包/359 metadata，两次`--locked --offline`均退出0。CLI只做fetch/tree/metadata，不能据此声称Rust编译、链接或安装通过。
- 逐包核对原12条warning与3zip：只有5个UNIC0.9.0进入旧Mac normal/build，路径为tauri2.11.5→tauri-utils2.9.3→urlpattern0.3.0；该链实际用于Tauri回环URL权限匹配，不能当作未使用。它们是停止维护报告，未证明本项目已可利用。采用已发布[tauri-utils2.10.2](https://github.com/tauri-apps/tauri/releases/tag/tauri-utils-v2.10.2)及urlpattern0.6的维护实现后，5UNIC从完整锁及Mac图均移除；无git/vendor替身或audit ignore。其他7条warning对应包与zip也均不在最终Mac图，但仍保留于全仓锁，不改称漏洞不存在或全仓Rust通过。
- 该发布版要求Rust1.90，源码`rust-version`和构建指南已明确对齐；所有Mac metadata声明均≤1.90。本机仅有Rust1.88，未更新或安装工具链，原生编译/ACL允许拒绝/Unicode行为仍待恢复构建窗口后验证。旧1.85声明原本已低于若干已锁1.88依赖，不能拿作旧编译通过证据。静态核对`Origin::matches → RemoteUrlPattern::test`及Mac effects分支未见明确API接线阻断；新guard两项先红后绿，不冒充原生测试。
- npm原6low均来自[KaTeX继承原型信任绕过](https://github.com/KaTeX/KaTeX/security/advisories/GHSA-238p-pmpm-9mq7)。只将一个实际包统一至官方0.18.2，根声明/override和锁记录同步，无Mermaid、remark、rehype、React或Pi升级；registry/tarball/lock/installed摘要与MIT一致。独立child中原型污染能在旧版产生javascript链接，修后拒绝，explicit false/true对照及父无污染核对保留；3项安全/API+33项数学/预览回归通过，fresh npm audit各级0。既有peer告警未改依赖规避。
- 原生CUA只操作隔离source-web实际组件/CSS/字体，未触TCC或正式App：聊天/文件预览分数根式矩阵正常，实际Mermaid SVG含2个MathML公式、pending/error0；两管线安全负例无script/事件/javascript链接/外部图，console0。临时页和服务正常退出，文件保留。安全+Macguard15/15、独立9项及8个trust输出探针、type/lint/diff通过，独立641锁包/2145引用检查闭合；所有原共同包的Windows依赖引用与基线一致。
- 证据为私有`.77/evidence/mac-risk-arm64-{tree,metadata}-frozen-20261024*`、`mac-risk-katex-*20261024*`、`mac-risk-maintained-url-{red,green}-20261024.log`和`mac-risk-katex-browser-facts-20261024.json`。本地Cargo锁含原root.78，SHA `0270941a27fc153655a0b36c6175b2fd4cab45f8153f90b7f8da0d3eae2d7813`；正式提交仅排除该原版本hunk，锁SHA `a5bc62936eabf226b268f0c1c8c766e9fa021ff7a3fa00406993ee2b88d6ae51`，实际依赖图一致。新增工具链、App构建安装、真实native ACL验证与清理均未执行，不重复催教师主观验收。

## 2026-10-24 原生身份与权限进度

- 当前源码状态取代下方同项快照：原分支 `e95400b4` 实现R06/R14/R15原生身份/权限进度，`e98c7303`补Tokio，`0930349d`仅接通旧测试夹具的真实身份hook；远端三项P2由 `13a377ddcfa95765257dcbe9c6912c19a634face` 补修。[PR373](https://github.com/PIGU-PPPgu/edupi-desktop/pull/373)已正常合入 `dd4ea313012491a6520d95addfcfb9fbef754d4f`，最终[CI39996430535](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/39996430535)实际checkout `c8d24f3b385994b484d36a55c07da6133a9acded`、head13a及合并dd4同树 `c433182ae6073b1b9907f033380263755959306b`。应用job120561034658成功2547pass/42条件skip/0fail/0cancel/type/lint；三评论在实际修复/独立复核/CUA和最终CI后精确关闭，正常merge，无admin/auto或保护规则变更。没有新打包，Core严格pin仍9f1292b4；原.78准备、release notes及私有升级诊断未混入产品提交。
- 设置页显示与更新比较、管理页版本均读取 `computer_use_status` 返回的原生host；源版本不同、身份缺失、加载或IPC失败不再伪称当前安装版本，网页明确标为网页版本。权限只记窗口会话内的申请进度，精确绑定PID/版本/platform/bundle/exe，不能充当TCC授权；同进程关闭重开不再丢失录屏等待状态，新进程/身份变化清除。旧实例迟到响应、恢复后迟到focus不发下一次TCC；权限重启不写true或覆盖原桌面控制偏好。
- 三项P2逐项补真实反例：失败请求按host+request身份比较撤销标记，不清新请求；旧页面卸载后失败也通知当前页面，用非变异peek避免清其他host。身份hook提供稳定只读refresh，设置“检查更新”和管理“刷新状态”可原地恢复，不申请TCC。控制回执用独立窗口序号和hook/设置卡共同观察的可信host；读取不废弃确定回执，原页面卸载仍可保存同host最新结果，新控制/新host/外部stop拒旧ACK，各busy分开结算，临时监听随promise结算移除。
- 本机macOS arm64/Node22.23.1：原18项实际React测试体保持，新增25项行为回归，连相关项67/67，父再含更新比较合组76/76，均无skip/cancel；独立新增25/25及额外6个跨生命周期探针通过，最终五SHA一致，无剩余P0–P2发现，type/定向eslint通过。最新CUA使用原组件和原序CSS、合成native/HTTP：两个入口首次IPC失败后原页面刷新恢复.77，失败申请重开仍可重试、显式重试成功后进度保留，stop在ACK前插focus仍off/pref false/事件false，真实浏览器文档reload后false保持。console0error/warn，自有页与服务退出、文件保留；不是安装版/TCC/原生重启证明。最初夹具JSON导入错误和每轮红日志保留。
- 首次CI39984236658实际应用2521pass/1fail/42skip，唯一失败为旧AppShell vm夹具将新hook替成noop；本地原name复现红后只加真实hook编译/require映射，原七项测试体和断言逐字不变，独立7/7通过。第二次CI39993116759应用job120549651007已成功2522pass/42skip/0fail/type/lint，实际checkoutc558a5e/head093同树e7df2e44；但远端三个有效P2未解决，正常merge被conversation保护拒绝，未加admin/auto或改规则。以上为修前历史，不替代最终13a的CI。
- Tokio由Cargo官方索引精确解析1.53.1→1.53.3，下载crate SHA-256 `ce3335fa71841cda333a58d7615b03901380ecf09d59b3296d21f8bbac0dde4e`与索引、锁一致；仅Tokio条目变化，Windows依赖边保持，原根版本准备不进入提交。回归修补[0386](https://github.com/RustSec/advisory-db/blob/main/crates/tokio/RUSTSEC-2026-0386.md)，并排除另受[0384](https://github.com/RustSec/advisory-db/blob/main/crates/tokio/RUSTSEC-2026-0384.md)影响的1.54.0。安全先红后10/10、独立14个semver边界及锁引用核对、root metadata通过；fresh Mac locked offline tree缺旧adler2归档退出101，不记新完整闭包通过。最终13a完整Rust job120561034325仍仅原zip0367/0368/0369三个错误、12条allowed warning，0386已消除；不豁免或称全仓安全绿。
- 用户暂停边界保持：没有构建/安装/启动或退出唯一App、没有TCC/真实数据/模型凭据/launchd/能源时钟/Release/feed变更，没有清理；Windows安装继续延期。任务Cargo缓存与预览夹具留在私有checkpoint，不删除已有文件。证据为本机`.77/evidence/desktop-078-permission-*20261024*`、`desktop-078-macos-permission-ui-*20261023*`、`desktop-078-tokio-*`及原生版本管理页PNG；不向产品PR上传私有环境资料。

## 2026-10-23 macOS适配恢复

- 最新门状态取代下方中间快照：Core[#351](https://github.com/PIGU-PPPgu/edupi/pull/351)已正常合入9f1292b4/tree77edf626，最终main CI39971800148成功、Windows job条件skip；实际PR CI39934743106 checkout02965f0/treeeba0c94a与head92608同树，最终新增R03#350/#352十文件经独立评估均在生产图外。官方write:false重算双清单完全相等，Runtime d9813e4e、Desktop fcb83831/raw f0adb340、schema09752不变。Desktop固定身份96a99e1b经独立审阅和实测后，已由[#371](https://github.com/PIGU-PPPgu/edupi-desktop/pull/371)正常合入a6993d08；实际应用CI39973535197 checkout fa32fcb、head96a及合并a699同树f0ff6d8e。应用job2504pass/42条件skip/0fail/0cancel及type/lint通过；全仓Rust job仍失败，见下项，不能称整轮CI全绿。与产品无关的本机CLI排查仅留私有checkpoint，不外发账户或模型配置。
- 同根升级已实测通过，不再以纯函数绿替代：用户对LOOP三次上限外明确允许修复后仅追加一次，attempt4在保留的edupi-schedule-upgrade-ekA3Jg执行，原seed SHA6153ca54、4份原输入与activation保持。原owner/root/grant及到期日不变；旧source读取stale/retry=false、4旧产物读写均拒绝、旧反馈写拒绝且原回执幂等重放为historical；自动plan/draft两次本机合成模型调用生成4份新产物，当前反馈current、candidate revision0→1、manual tasks0、Runtime/model正常关闭。没有续grant、重种、改时钟或手动任务代替。证据desktop-078-schedule-upgrade-seed.json.current-attempt4.json及fixed-once日志；原三次失败保留，额外授权已用尽。私有脚本消费后又补统一spent-claim护栏阻断所有旧参数入口，静态复核，不再运行该根；本地诊断/例外补丁未进入产品PR。
- 本轮9f其余实际源码门：host/proof/执行路由先38pass/0fail/0cancel/1缺数据根skip；该1项初用空任务DOCX夹具在tasks.length>0失败，仅用Desktop任务POST为这个新根补前置后，同一原health/snapshot/kernel/memory-scopes/task-review handler通过1pass/0skip，原红证据保留。真实SDK召回/压缩与用量同意/重试/冷恢复/来源围栏/撤回/擦除另3pass/0skip。DOCX当前owner明确采用/取消零写/篡改拒绝/冷读、slot-alias文件课表拒写及零课表冷读均通过，type/lint通过；两新合成root保留，不清理既有包/缓存/废纸篓。这些源码及旧根升级证据不替代签名安装；新包、安装和正式App/真实根保持不动。
- Rust剩余项按原延期范围保留：CI实际3个error为zip4.6.1的RUSTSEC-2026-0367/0368/0369，另13条allowed warning，不把警告数算漏洞数或改记通过。已有aarch64 normal/build闭包不含zip，其Cargo.lock SHA0c35e9ea与当前已提交锁完全一致；本机fresh offline cargo tree因tuna索引缺已锁rustls0.23.46而退出101，未改registry/lock或冒称新环境重算通过。Tokio1.53.1的新增informational unsound警告RUSTSEC-2026-0386也未修复或证明可利用，原生后续需单列；本轮不进行依赖大版本迁移、Windows构建、豁免审计或新打包。完整证据desktop371-{app-quality-direct,rust-audit-failed}-20261023.log、core9f-main-quality-20261023.log及desktop-078-core9f-pairing-20261023.json。
- 当前安装现场仅只读核对：`/Applications/EduPi.app` Info.plist显示0.3.77；早先公开70/已退出/PID/TCC记录只属于当时快照，不能当作本机当前状态。本轮未启动、退出、替换或回退这个App；新源码尚未构建安装。后续恢复安装前必须以实际现装版本重新保护App、资料和偏好，不沿用旧70恢复基线。
- 同日较早快照：Core[#321](https://github.com/PIGU-PPPgu/edupi/pull/321)已完整Mac CI39924858338并正常合入65eb4d92，其main CI39931485031也成功；实际CI merge5e1487a4与head5ea同树8d226524，最终65eb仅多两份R03规划docs、整树d7738528不同，双生产闭包字节相同。当时Desktop严格pin工作修改已对齐65eb，尚未提交或打包；现已由本节顶部9f取代。
- 同根升级实际失败，不能记适配完成：原03真实自动G1/四产物/反馈基线保留；65eb三次诊断启动均正常退出，原source/artifact/feedback拒旧与自动再生成尚未执行。SQL没有异常，真实原因是rhythm_planner合并旧task漏刷新class_id/subject/source_slot_fingerprint，导致新semantic指纹配旧slot指纹，normalizer在写closure前拒绝，错误被泛化为database_unavailable。未迁移或重置数据库、改权限、续grant、重种或触碰真实资料。
- 该缺陷最小修复92608b21已推原Core分支，独立反例红→绿及七种来源变化场景、既有planner、canonical/heartbeat/calendar recovery/execution、type/contract/writer矩阵522、官方双清单重生与独立write:false深比较均通过。[Draft Core #351](https://github.com/PIGU-PPPgu/edupi/pull/351)的精确Mac CI39934743106尚待；新组件d9813e4e/fcb83831、原Desktop清单f0adb340，schema/capability无变，未提前固定未合提交。原合成根已停止重复启动，额外一次修复后同根复验正在等用户答复。
- 65eb其他技术门：五项材料source E2退出0，ICS/DOCX的当前owner来源/明确采用/取消/篡改/冷读通过；OCR仅收件、识别未运行，旧文件更新/配对/EXDATE/取消/课表仍409，不计支持。组合全套2535pass/10skip/0fail/1个15s reminder-proof超时cancel，原日志保留；同一原时限用例隔离复测4.72s/1pass，无放宽deadline，不据此定论超时原因。type/lint通过。这些结果不替代同根升级或安装。
- 安全追补4a8b7aea已推Desktop原分支：Hono4.13.13、ip-address10.7.4仅兼容锁更新，真实双编码静态边界和SOCKS地址异常子进程回归、独立10/10通过。当前npm审计6low/0moderate/0high/0critical，原含中危快照保留；修补门槛见[Hono公告](https://github.com/honojs/hono/security/advisories/GHSA-5r4p-p66f-jhc7)和[ip-address公告](https://github.com/beaugunderson/ip-address/security/advisories/GHSA-rxp7-6hxx-x8q5)。没有重启用户正式App、新签名包、清理或外发。
- 用户确认迁移过Mac，要求非系统旧数据不继续扩展恢复，主要做好适配。原事故与调查证据保留、不改记成功；恢复源码修复与配对测试，暂不触发新签名包，清理继续禁止，Windows/Linux仍延期。正式App当前由用户运行，不擅自退出或沿用旧PID/TCC/隔离模型；后续安装须全新数据基线与实际桌面核对。
- 原三类失败已逐项修正并独立复核：跨导航已确认回执只结算完整匹配的原pending，空白任务键已被新任务复用时仍拒迟到成功，实际React+SDK和旧回归58/58；共享单composer结构哨兵同步，不以正则代交互，提交5241f8e3。缺owner key时增加仅当前真实SDK轮次的内存来源证明，普通/虚拟路由两步工具结果可续跑，手动压缩/下一轮/冷恢复/fork不复用，凭据不创建，40/40通过，提交ed63c868。没有将源码回归记为安装通过。
- 同名B新增实际SDK验证避免把来源全文放进查询：旧Core03复现删除A后B结果缺失；新Core补丁下真实两个模型调用、稳定B ID与冷重启保持，2/2无跳过。Core已正常同步冻结main `f59eea96`（完整Mac CI39921209093成功）到自有PR321，生成冲突只用官方双清单生成器解决，独立闭包重算保留全部main资产；新头 `5ea0cb49` 已推送，需精确CI后正常合并，Desktop正式pin仍03。
- 最新main的Runtime/Bridge/occurrence/schema/SDK合同未变，组件身份变化；R03 v3 capsule/typed claim/PDF-image诊断仍无生产入口，不据换pin宣称已上线。继续补日程_revision使旧备课来源stale后的拒旧、当前目标/反馈接续证据；真实睡眠仍按用户选择另约。新Mac Node22.23.1/arm64、约1TiB可用，未做新打包或清理。
- 依赖门新增两项critical后作最小安全更新7399317e：Next/SWC/eslint-config-next16.4.2、DOMPurify3.4.17，Pi1.0.2及React19.2.4锁记录保持。配套hooks lint新增14条诊断由effect顺序和局部派生memo修正，未关规则或改布局；104项针对与独立检查通过。实际安装依赖安全测试8/8，审计6low/2moderate/0high/0critical，保留原红日志；未声称低中危已消除。
- 当前8f0dd532组合源码：全套2531通过/13条件跳过/0失败/0cancel，typecheck与完整lint通过。此轮正式适配pin仍03，真实召回测试显式使用新Core5ea，其他13项正式Core/包依赖条件未启用；不能把该结果称最终新pin完整安装门。实际隔离Next16.4.2页面中，公式、Mermaid预览、summary键盘开合、命令筛选、首条发送一次后清空、切会话及刷新后未发草稿保持均已操作；实体会话JSONL回读为1条user/1条assistant，班级空态及工作区取消表单无控制台错误。证据均在本机`.77/evidence/desktop-078-*20261023*`、`desktop-078-browser-ui-facts.json`，未触及用户正在使用的公开70。

## 2026-10-21 v0.3.78 源码收口

- 当前停止条件：本机清理发生单项目授权越界，Finder实际进入整篓清倒后已停止，184→68顶层项目，不能记“只删除测试包”。已通知用户，正在等待恢复方向；本轮打包/安装/写测试均停止，自有排队Core CI39547253513因保护现场取消、零步骤，不算产品失败。公开70及311个受保护文件与恢复后快照逐字节一致；其他Trash内容没有完整事前清单，恢复未验证。详情只保存在本机 `.77/evidence/077-cleanup-scope-incident.md`，不将清理事件标为验收通过。
- 原始完整源码测试在得到最终总结前中止，当前至少三类失败待定位：旧composer高度正则、切会话时resolved-intent旧预期、新隐私投影过滤当轮computer工具结果。最后一项已定向复现但尚未完成缺key反证，不能仅改断言或宣称全套通过；`.78` 尚无tag、签名run或安装。
- 本节取代下方同项中间状态。Desktop 原分支已提交首条输入框 `1a3c6897`、记忆摘要与路由来源 `b35f7ef3`、准确 AX 错误 `08125e0a`、连接失败记录与设置详情 `b3ed2f6c`、统一折叠 `a191c1c5`。已检查 `.78` tag/Release 均不存在，版本文件准备为 `.78`；尚未创建 tag、签名 run 或资产，正式 Core pin 仍为03，不能据此打包。
- 折叠切片为已实现待安装验收。共享细线箭头覆盖79个 summary 入口及六类自定义折叠；28项针对测试、真实 React 首开读取一次、独立16项与类型/lint通过。父任务在真实浏览器用同一生产CSS验证 Enter/Space、嵌套、明暗、320/768/1024/1440尺寸与数据库列对齐、减少动态0秒和强制颜色；控制台错误0。证据 `disclosure-ui-verification.md` 与 `disclosure-final-{light,dark,contrast,detail}.jpg`，均在 `.77/evidence/`。预览标签与只读服务已关闭，这不是安装版新样式。
- Core [#321](https://github.com/PIGU-PPPgu/edupi/pull/321) 已正常同步已合并的来源安全#314与只读原生诊断#308，最终PR头 `1da9cb71862850edb8196075bd40d4ce374b1bcf`，仍只四文件同名召回修复。新精确 Mac CI `39547253513` 排队；旧83头的零步骤 run `39541987317` 因新push取消，不计产品失败或重跑。双生成清单与writer矩阵本机检查通过；尚未正常合并和正式消费，不追未合Draft#324或新格式capsule。
- `.77` 的真实用量擦除已获当次授权并执行：8条合成记录归零，重试及真正冷启动后仍0记录/0pending/未收集；九产物、三域审核与已有反馈摘要保持。ICS从“今天”冷读同一日程的时间、时区、地点保持。主机退出探针旧样本仍无效，不追认；新的候选身份门工具仅纯测试和编译，未arm或发信号。
- 唯一 `/Applications/EduPi.app` 已恢复原签名公开 `.70` 并停止，strict codesign/Gatekeeper/原二进制SHA通过。新安装前后311文件中310原字节一致，仅版本记账变化，业务/模型/认证及原三origin偏好保持，见 `public-070-restoration.json`、`real-077-restore-comparison.json`。结束的 `.77` 包、副本与私有编译缓存已可恢复移至单一废纸篓目录，约2.65GiB；尚待当次永久删除答复，不称空间已释放。
- `.78` 后续门仍须最终Core合并/pin、源码CI、同轮Mac签名公证和唯一安装路径复验；不构建Windows/Linux、不公开Release或更新feed。Native observe只增加准确诊断，尚未成功读取；DOCX原生班级选择因用户不便仍暂存，真实睡眠另约，不将教师主观质量作为发布阻塞。

## 2026-10-21 v0.3.77 安装实测追补

- 本节记录 `.77` 安装期间实测，下方“待确认/修复中”由顶部 `.78` 收口记录取代；测试结束后唯一安装路径已恢复原签名公开 `.70` 并停止。`.77` 源码 `128a19d3`、Core `03bbb893` 的整轮DMG/Draft仍失败，不重跑、改写身份或更新feed。
- 旧 `.70` 原生新建未发送稿后升级 `.77`，A/B各自原会话、独立fork边界、三条消息单次物理落盘/肯定Pi ACK、导航期间新编辑、真正退出冷启动及两项未发稿保持均通过。该upgrade根无教育捕获绑定，Core ACK明确不适用，不以Pi ACK代称Core。证据 `native-upgrade-077-observations.md`、`check-upgrade-077-state-1792548147495.json`。
- 正常/空工具/空工具冷启动/显式恢复/安全模式/正常恢复的真实SDK工具和资源过滤已实测；原生软删甲班同名A后普通回合不见A，乙班B不串档。实际自动压缩却把旧A标记带入本机合成模型，另有B被显示名称围栏误杀，均为真实缺陷，不能记完整隐私通过。Desktop `b35f7ef3` 补公开SDK摘要/路由当前来源重验、持久派生证明与当前普通工具来源窗口，33项针对/真实Core03两项及独立17项+Core一项通过、类型/lint通过；无来源旧摘要、shell/custom和未知工具跨轮明确hold，原盘/UI保留。源码未进签名 `.77`，新安装复验仍待。
- 首条已发送文字残留输入框由真实React+Pi持久回执复现；Desktop `1a3c6897` 保持单一composer，精确当前ACK迁移新编辑并拒迟到旧任务回执。最终41项/独立3项通过，不削弱未知结果保稿；仍需新签名安装，不能把旧 `.77` 改记已修。
- Core同名修复独立反证发现旧式tombstone缺可选student_id会使已删A复活，已最小修正并由原反证冷启动证明A拒绝/B可召回，六合法变体/正文姓名与原始ID围栏通过。正常合入已核实main#314 `e1539bb4` 后，最终 `83f518a4`/tree `b70d59e4` 的owner/source/SDK/type/manifest门均通过；双生成清单独立重算确认main资产完整。新[Core PR #321](https://github.com/PIGU-PPPgu/edupi/pull/321) / Mac CI `39541987317` 待结果，Desktop正式pin仍03，尚未消费该未合补丁。
- 三域审核原生接受、取消离开不改决定、材料打开与本地导出已完成；真实App冷启动后工作区三项已完成，三域各自accepted/rev3/历史1回读，行政已有评价显示已评价，九原产物字节保持。用量撤回后显示未收集，后续原生导出新409B文件成功且事件仍8/outbox10confirmed/0pending，擦除取消保留记录；永久擦除仅待当次确认。提交后主机退出的探针未命中严格PID身份，未发STOP/CONT，不算未知回执冷恢复通过。
- ICS只收件时calendar保持0；Core当前读取提案后用户亲自原生确认采用，日程同event的日期/时间/时区/地点一致，重复采用无新增。另一次CUA实际点取消后完整canonical文件及六集合摘要不变。采用记录仍inferred/pending_review，不能改称confirmed。DOCX章节与安排两份文件均仅暂存，原生select未选定班级，用户暂不方便，不后台代写或重复催问；真实睡眠按用户选择另约。
- Native observe由用户亲自点允许后进入Rust/AX、324ms失败，无图像。当前进程TCC两项仍granted，原代码丢失AXError后错误统称权限未生效；准确错误分类正修复，不重置权限、增加目标参数或绕保护。总开关已实际恢复off。冷启动短暂断连再次出现后自行恢复，原始probe未留证，不能归因为睡眠或假断线；正补有界失败记录/设置详情入口，不放宽判定。
- 安装证据与代码交接位于 `~/edupi-install-checkpoints/v0.3.77/evidence/`：`native-material-schedule-077-observations.md`、`native-capability-077-observations.md`、`native-memory-077-observations.md`、`native-observe-077-observations.md`、`privacy-review-final.md`、`core-same-name-review-merge-83f518a4.md`。上述源码/针对证据不是最终完整套、精确新pin、CI、签名或安装复验；本轮继续这些可执行项，不构建Windows/Linux。

2026-10-28 R18 串行交接：本机唯一安装为 Desktop `132a806e`／Core `4b3ba5e5` 的本地 .77 预览，未公开发布。新版抽屉实际可见，三份教学产物修订保存及跨材料入口回读、教师接受一次均已原生操作；历史菜单选择和合并冲突恢复尚未完成。历史版本按钮组与日程直接单选已源码实现并通过独立复核；最终源码检查 3288 通过／14 环境门控跳过，类型／定向 lint 通过，这两项尚未安装。真实 memory_write 一次已持久化一条隔离偏好，但模型收到失效提示，未重试，故障证据保留。按 Core 适配任务的串行交接要求暂停新打包、应用替换及生成物清理；原资料与原会话正在恢复收口。固定源码、App 身份、Core 两项修补、回退和未验项写入私有检查点 `subfeature-audit-20261027/handoff-20261028.json`。R18 完整范围仍部分完成。

2026-10-28 R18 当前续验：唯一安装版为 `b02375d3`／Core `af19ac04`，本段取代下方旧版当前快照。原生已验证新会话发送清稿、下一条草稿跨模块保持、已接受事项调整仅一条决定、方法停用及第二方法试用后验证拒绝。正式备课由同一测试任务产出四份 MD，参考 DOCX 的八段来源已确认；初稿只含两题，教师补齐第三题与审核尚未通过。实际发现材料抽屉不可见、800px 方法详情溢出，以及旧重复日程别名阻挡明确冲突处理；新源码已完成抽屉、聊天窄窗菜单、嵌入预览、编辑焦点和任务提示修正，配对 Core `4b3ba5e5`，独立复核闭环。Desktop 3282 通过／14 环境门控跳过，完整类型／lint及配对 Core 30/30 通过；原失败哨兵和动画反例保留。新源码尚未安装，以上修正不计原生通过。完整子功能范围仍部分完成；当前隔离数据，结束前恢复原目录、原会话及试用前配置。未公开发布或更新 feed。

2026-10-28 R18 源码检查点：安装版仍为 `d0e33c08`／Core03；待安装源码已完成聊天清稿、窄窗对象栏、成长六模式、今天判断表单与目录代次、材料稳定班级 ID／名称，以及正式计划备注更新。六份独立复核均已闭环；最终 Desktop 3201 通过／40 环境门控跳过、完整类型／lint 通过，实际配对 Core 闭包／运行／防篡改 30/30。Core 本地提交 `af19ac04`，Bridge v1.1／安排 v1.2 身份不变；新版 notes audit 状态降级 Core03 需配套数据恢复。D0 实机已完成六种 Today 决定、两页列表、成长验证发布和一份方程参考的接入／预览；仍需新版真实发送、缩窗、合并 held／恢复／重启，以及备课生成与人工核答。内部哈希预览标题等子功能欠项继续保留，R18 整体仍部分完成，未公开发布。

2026-10-28 R18 当前状态：唯一安装版为 `d0e33c08` 本地 .77 预览，Core `03bbb893`；本段取代下方旧版当前快照。已原生回读新对话身份、后台取消同 ID 重试与自然完成焦点、工作区创建/状态/回收恢复及日程成功删除回焦。实际发现首次发送清稿失败、800px 对象栏遮挡事实编辑、成长表单焦点/双主动作，以及带时间计划合并生成第三项；第三测试项已原生软删，原两项保持，合并未判通过。聊天清稿已源码复核；导航仍在独立反例闭环，成长表单和 Core 正式备注更新在实现。完整子功能验收仍部分完成，未公开发布；当前隔离目录，结束前恢复原教师目录和原会话。证据位于私有检查点 `subfeature-audit-20261027/evidence/` 与 `native-action-results.json`。

2026-10-28 R18 当前状态：唯一安装版为 `066840c2` 本地 .77 预览，Core03 保持；本段取代下方旧版“当前/最新”快照。冷启八组数据一致、strict/deep通过。暗色按钮、设备检测/启停键盘回焦、新日程held自动展开精确候选及明确采用/保留后回读、删除取消、回收站恢复回焦均已原生复验。后台四字段草稿取消重开、真实Word生成/系统预览、运行取消→同job重试→文本产物实际打开通过，原教师会话无新增测试消息。成功删除及任务自动完成后的焦点、后台表单布局/滚动等新增源码在独立审查中，尚未安装。全部子功能范围仍**部分完成**，当前仍在隔离资料，结束前必须恢复原教师目录；未发布或更新feed。

2026-10-27 R18 最新状态：唯一安装版已为 `a1641f6a` 本地 .77 预览，学生编辑、记录分页／筛选／修订／恢复、图谱操作、同伴跨入口回读及教师直接审核已有新增原生证据；完整子功能仍部分完成。另复现保存失焦、转班标签缓存、折叠历史反向 Tab，源码已修复待新包；家校与材料补正另列。窗口再次全局不可读，IAB 仅连接安装包本地服务补充预检，不计原生通过；当前隔离根结束前必须恢复。

2026-10-27 R18 当前安装为 `2f599f21` 本地 0.3.77，Core03、GitHub 宿主和 updater 公钥保持；新学生详情与审核焦点源码已合并检查 70/70，仍待签名安装及原生验收。未发布、合并、公证或改 feed；当前隔离根必须在结束前恢复。

2026-10-27 R18 当前唯一安装 `/Applications/EduPi.app` 为 `cb6aa7be` 本地 0.3.77 预览，Core03、33,709 非 server 文件、GitHub 宿主和 updater 公钥保持；正常 Quit 到进程 0 后替换并冷启，28 名合成学生及档案历史保留。没有发布、合并、公证或更新 feed；完整子功能仍部分验收，焦点源码补丁待下一本机预览，结束前必须切回原教师目录。

2026-10-27当前范围：用户澄清全部子页与子功能均须实际操作，R18完整验收仍部分完成。唯一App维持`4e75ad52`，上轮页面实测保留为部分证据。已用正式目录选择器切到明确隔离资料执行子功能，原目录/配置已备份，结束前必须切回并回读；没有新打包或发布，不能将下方代表性验收读成全功能通过。

## 2026-10-26至27日 逐页UI本机验收

- 唯一App为`4e75ad52`本地0.3.77预览，Core03、33,709非server文件、GitHub宿主与原公钥保持。Team`BY3XZG2839`、CDHash`61b3d3f42a1f33e8ae86991f58068b6ef526b1c2`，最终清理后strict/deep与主程序摘要通过；未公证、合并、发布或改feed/tag。
- macOS26.6 arm64宽窄窗完成名单/非空日期/任务单击和Enter/历史分类/日程切换与周文字/表格横滚/空态/抽屉实际滚动/列表Tab/Escape。54d9逻辑全套2602通过、40环境跳过、0失败；之后仅CSS，最终4e prepare/type通过。工具输入曾失效，代理经访达正常打开恢复；同版本正常Quit至0、冷启PID65907→93586，默认模型、偏好和51/160/24/6保持；日程已置前台。
- 最终314保护文件无增删，业务/模型/认证/JEV/UI配置保持，运行态/3日志及10条会话custom追加单列。累计清理6类生成目录的两批产物与5临时App，占用11.16GiB；各批观测空闲增量之和11.42GiB，其他磁盘活动不计为本任务净释放。临时App0，原.70保留，安装版无已删路径依赖。既有Core/用量异常、Windows/Linux、40环境跳过与公开升级未验，没有新OAuth、JEV或GitHub写入。[逐项证据与剩余边界](../acceptance/2026-10-23-admin-settings-redesign.md#2026-10-26-逐页面组件与交互优化)。

## 2026-10-26 主导航与全应用折叠本机验收

- 当前唯一`/Applications/EduPi.app`为`cafce3a4`本地0.3.77预览，替代下方`cd14396d`；保留自适应居中，统一97个原生details站点及聊天自定义披露，主导航移除蓝色粗条，二级栏收起完全隐藏并由标题栏恢复。
- macOS宽窗2880×1800、窄窗1612×1612，主/二级导航、搜索/滚动恢复、焦点/Tab/Escape、学生与日程详情、跨模块、深浅色、模型草稿、记忆表格和聊天过程实际通过；正常Quit至App进程0，冷启动PID77713，模型/偏好和51/160/24/6保持。最终2575通过、40环境跳过、0失败，类型/完整lint及只读复核后的回归通过。
- Core03、33,709个非server文件、GitHub宿主及原公钥保持，Team`BY3XZG2839`、CDHash`13e25553d191b3cd56cdd4a990b362099849fff6`，安装和清理后strict/deep通过。314保护文件无增删，业务与配置摘要保持，运行态/日志/custom追加单列；清理6生成目录和2临时App约5.12GiB，观测空闲增约5.15GiB，临时App副本0，原.70回退保留。
- 既有Runtime根目录/用量校验异常未修复；Windows/Linux、40环境跳过、所有披露数据分支与公开升级未验。本轮没有新OAuth、JEV调用或GitHub写入，未合并、发布、公证或改feed/tag，用户视觉认可待用户判断。[逐项证据](../acceptance/2026-10-23-admin-settings-redesign.md#2026-10-26-主导航与全应用折叠重做)。

## 2026-10-26 设置自适应居中本机验收

- 当前唯一 `/Applications/EduPi.app` 为 `cd14396d` 的本地.77预览，取代上轮紧凑方向；恢复正文居中与正常行距，细化自动运行、设备、数据页层级，模型详情高级项按需展开，修正深色选中态。
- macOS实际核对逐页、2880×1800与1612×1612窗口、键盘、深浅色、模型草稿切页/放弃、中文连接搜索和JEV定位；38项针对性和另14项重叠模型检查、类型/定向lint/CSS/diff通过，不冒称全套。Core03与33,709个非server文件/原公钥保持，strict签名通过，CDHash `b77ff728017dfaa54d557d2fadc6cc3ce0d0123d`。
- 314个保护文件无增删，业务记录与配置保持，桥接运行态/日志和4条custom追加单列；6个生成目录与2个旧App已清理，约5.13GiB，临时App副本0。未发布、合并、公证或改feed/tag。
- 改版前已有Runtime数据目录校验失败，用量正常分支本机验证受阻；投影温读51/160/24/6保持。Windows/Linux、全套与公开升级未复验，用户观感待判断。[逐项证据](../acceptance/2026-10-23-admin-settings-redesign.md#2026-10-26-自适应居中与页内布局复核)。

## 2026-10-26 设置间距本机验收

- 当前唯一 `/Applications/EduPi.app` 为 `25f799bd` 的 `.77` 本地预览；仅更新 4 份 CSS，Core03、原 updater 公钥和 33,709 个非 server 文件保持，未发布或改 feed/tag。
- 常规页 640px 固定列、正文左对齐，侧栏及模型/连接行距收紧；实际检查宽窄窗、深浅色、Tab 顺序及最终常规/数据/模型的边界。23 项针对性、CSS 解析、类型和 diff 检查通过；本轮未重复全套检查。
- 最终 PID28800，51/160/24/6和317个受保护文件保持；清理6个生成目录、2个临时App，约5.12GiB，观测可用空间增加5.21GiB，临时App副本0。
- CDHash `d0049cb76a6999a4a6bbb17f4c5594cd834f40ca`，strict签名通过。末次前置时锁屏，已请求解锁；不能把该显示动作计通过。Windows/Linux及公开升级未复验。[逐项证据](../acceptance/2026-10-23-admin-settings-redesign.md#2026-10-26-设置间距收敛)。

## 2026-10-25 设置结构本机验收

- 当前唯一 `/Applications/EduPi.app` 为 `f7224b98` 本地 `.77` 预览，取代下方 `fd007801` 的当前界面；公开更新渠道未改动，未合并、发布、公证或修改 feed/tag。
- 设置按个人、AI 与服务、本机分组，统一入口和设置搜索；模型和连接改为列表/页内详情。macOS 已实际完成 JEV/代理定位、模型默认回读、品牌目录及键盘返回、代理草稿保留、目录选择取消、外观还原、冷启和账号往返；Core03、数据根、51/160/24/6及317个受保护文件保持。
- 最终 2561 通过、40 环境跳过、0 失败；签名 strict/deep、Team BY3XZG2839，CDHash `ecf91a3cc5cc1160800dfc522058176cbd65107b`。33,709 个 Core/壳/连接运行时文件和原 updater 公钥保持。6 个生成目录、3 个临时 App 已清理，目录占用6.04 GiB，临时 App 副本0；保留原回退和用户配置。
- Windows/Linux及公开升级链路本轮未复验，R23整体仍部分实现。[逐项证据与参考依据](../acceptance/2026-10-23-admin-settings-redesign.md#2026-10-25-设置结构重排)。

## 2026-10-24 官方目录与恢复本机验收通过

- 唯一 `/Applications/EduPi.app` 已换入正常 `.77` 预览 `fd007801`，Core03、原updater公钥和13326个Core/壳文件保持。Team BY3XZG2839，CDHash `ee251e2a50819bd5ad313532e664efa0bffc35d8`，主程序SHA `345f533347c53fbbb375f3226518b5a61970c05144f00a77805fa8345599c08b`，7个原生资源与整App签名/操作后strict通过；未公证、合并、发布或修改feed/tag。
- 官方Logo/中文分类搜索/详情键盘返回与单结果布局实机通过。真实手动refresh、受控本地到期真实SDK自动refresh、GitHub路径断网失败保留回执、离线冷启/恢复、同连接重新授权与原请求去重均完成；#379、写入审计、dispatch始终各1。自然等待8小时、首次未知写响应丢失等边界未计通过。
- 最终验收环境键移除、到期测试按钮消失、中继停止；停掉后正常App检查/回读/去重仍通过。2526通过/40环境跳过、类型/lint/独立复核、高危补丁门通过，剩6low。Core/投影/Kernel ready、51/160/24/6与教师记录/配置保持，运行日志和custom追加另记。
- 共清理8个本轮生成目录/临时旧App，约5.13GiB、观测空闲增5.25GiB；临时App副本0，原`.70`及数据/证据/源码保留。中途锁屏为已解除的历史限制，未停在目录或模拟端点。[逐项验收](../acceptance/2026-10-23-admin-settings-redesign.md#2026-10-24-官方目录与连接恢复验收通过)。

## 2026-10-24 GitHub OAuth 写入与重启通过

- 当前唯一 `/Applications/EduPi.app` 为源码补丁 `45abdc9e` 的本地 `.77` 签名预览；server 基线 `ac693c14`、Core03 与其余 53,588 文件保持，实际只更换 GitHub host 并重签。修复 GitHub 真回调的固定 `iss` 被未知参数门误拒；回归先红后绿 7/7，无跳过，独立复核同组通过。Team `BY3XZG2839`，CDHash `579b10bfb551b2b5590bf696ad4f4b1262de31d6`，主程序 SHA-256 `e90925c4cac191eb2d76fe6f3d3adb59061670ffa2894745ef61d11140db73ed`，安装及操作后 strict codesign 通过；未公证、合并、发布或改 feed。
- 用户完成客户端和 OAuth 授权后，真实应用创建并回读 [TEST issue #379](https://github.com/PIGU-PPPgu/edupi-desktop/issues/379)。正常退出至进程 0，再真正启动 PID `13429 → 23413`，同一 OAuth/回执/issue 保留；再次实际回读产生新 read execution ID，写入 ID 保持。持久 dispatch 和远端明确 TEST issue 数均为 1，没有重复创建。当前完整管理页 GitHub 手动测试子项验收通过；R23 通用权限合同与其他服务仍分别保留。
- Core/投影/Kernel ready，51/160/24/6、配置和教师记录保持，Runtime/提醒状态及会话 custom 追加另记。验收后清理两份旧 `.77` 临时 App 与测试副本约 1.81 GiB，观测可用空间增约 1.85 GiB；只保留已安装新版、原 `.70` 回退和必要数据/证据。长期 token 续期、实服断网恢复等未验；[完整证据](../acceptance/2026-10-23-admin-settings-redesign.md#2026-10-24-github-oauth-写入与重启验收通过)。

## 2026-10-24 GitHub OAuth 与写入初装历史

- 此初装历史对应源码 `ac693c14bb80969a0c7d02e63b106ee693a32e9a`，含安全提交 `ef1a4e3a`、Core03，曾准备完整资源并安装到唯一 `/Applications/EduPi.app` 本机 `.77`；当前安装由上方 issuer 补丁取代。复用未变原生壳，6 个原生资源和整 App Developer ID 重签；Team `BY3XZG2839`、CDHash `8fadb3c3fa8243ac7d0d2914325ba8457bbdf1a4`，主程序 SHA-256 `7247ff850cd8c27e28ecfa02ea4f084d4d804a83d09363648641d3f5f7639a16`。当时安装及清理后 strict codesign、Core/投影/Kernel ready 和 51/160/24/6 回读通过；未公证、合并、发布或改 feed。
- 当时新增 GitHub OAuth/PKCE、Keychain 加密钥匙、固定测试 issue 预览确认、单次 dispatch 与独立 Action/审计回读，真实 Keychain 和回调边界通过；客户端/授权、实际 issue 和回执当时均未完成。后续用户完成客户端和同意后，实服流程才按上方结果验收通过；既有 gh 登录读取账号与隔离测试始终不代替 OAuth 验收。
- 本功能及组件定向 531 通过/0 跳过；全套 2492 通过/40 环境跳过/0 失败，类型/lint/独立复核通过。补丁将高危审计门清零，剩 6 条既有数学链低危。已精确删除 7 个生成目录约 3.60 GiB，可用空间观测增约 3.70 GiB；当时保留的上一份 `.77` 临时回退，已在上方实服验收通过后删除。原 `.70` 与私有备份保留；[初装历史](../acceptance/2026-10-23-admin-settings-redesign.md#2026-10-24-oauth-与测试-issue-初次安装历史)。

## 2026-10-24 JEV 与 GitHub 本机真实连接

- 源码 `468f82e8c99414ed7ebb6df1773cb71b3d1b6d3e`、Core03 的本机 `.77` 预览已替换唯一安装路径。完整 Desktop 资源准备通过，未变化的原生壳复用；6 个新原生资源与整 App 重新 Developer ID 签名，CDHash `45d22da015f6c806028a1c9388c01ac34263cd90`，主程序 SHA-256 `0b532d475cfede13ee601d7022c532e74b97061e02b9ba63abc44ebc8f4d54e1`。原 updater 公钥保持，包内启动/Core/目录与原生操作后 strict codesign 通过；不作为 Apple 公证或公开发布证明。
- 已安装 App 的 JEV 真服务连接成功1198ms，修复的是读取已有系统代理；GitHub 实际连接、取消确认、固定只读调用、executionId审计核对、真正重启回读及重启后再次调用均通过。第一份执行 `cc322af0-dec0-4452-bb71-b21f4315249e`，第二份 `38c800ce-2b83-4992-bfc6-a499f5e4894e`，没有自动重发或外部写入。
- 正常资料、原模型/认证/JEV/GitHub/UI配置保持；提醒正常轮询补入一个状态字段已通过基线摘要精确解释，Runtime元数据和会话custom追加有记录。清理本轮8个生成目录和上一份`.77`预览，目录占用约4.51GiB，可用空间观测增4.60GiB；原`.70`回退及原私有备份保留。仍无新tag、公开Release或feed变更；[逐项验收](../acceptance/2026-10-23-admin-settings-redesign.md#2026-10-24-jev-与-github-只读续验历史)。

## 2026-10-23 管理与设置改版本机预览

- 用户明确要求把页面改版安装到本机。源码 `f3c09cd653245f26013c59f1cddf6c4e3538c2bb`、Core `03bbb893` 在本机生成 arm64 0.3.77 Developer ID 签名预览并替换唯一 `/Applications/EduPi.app`。Team `BY3XZG2839`，CDHash `4f2bc0e81b5f3f97d601dc842a0e056b7b0c59ea`，主程序 SHA-256 `687d3f5e5af805d17f6b5bfc65977a81005b48674b7d73a58dc9f1e77cc9c5b7`；完整签名、原 updater 公钥和包内 Core/目录检查通过。此本地包未公证，不属于下方正式 Release run 的公证/发布证明；没有创建新 tag、Release 或改 feed。
- 已在真实原生应用完成设置与 JEV 保存/重启、OpenConnector 服务→操作→参数→返回；JEV 上游实际 HTTP451，连接不计通过。正常资料原有 Runtime 绑定经应用内带备份事务恢复，重启后 Core/投影/Kernel ready，51 学生/160任务/24校历/6课表与17模型保持。真实业务和凭据不写测试内容；会话仅4条custom追加且原前缀保持，Runtime指纹/进程元数据及修复备份单列。当前新App以正常资料运行，旧0.3.70回退App与私有备份保留。
- 本轮生成的缓存、重复依赖、第一预览App/重复旧App、隔离根已精确清理，约8.21GiB目录占用删除、实测可用空间增加约7.40GiB。代码/工作树/已安装App/验收证据保留。详见[本机验收](../acceptance/2026-10-23-admin-settings-redesign.md)，私有证据根为 `~/edupi-install-checkpoints/settings-redesign-20261023/`。

## 2026-10-21 v0.3.77 源码与配对门

- 最新状态取代下方“运行中”：同一Mac run39520241032/attempt1已失败，只有独立DMG公证状态查询报网络-1009；DMG submission `4b338b4b-a188-4b08-ac43-b95ca94575e6` 未获Accepted，后续装订/最终证明未执行，Draft419005601保留，不重跑或拼接资产。App自身另获Apple Accepted `d81403c1-1e38-4dd7-a9d0-a5f63f67d996`；同轮tar660977350与sig660977597已逐项核对大小/SHA、原公开70 updater key、Minisign及篡改拒绝，解包原App的现有票据校验、strict codesign、Gatekeeper均实际通过。包内Core03/schema/双组件完整依赖闭包、严格compat、arm64/Team/key核实，只形成独立App-only隔离安装证明，不称DMG或整轮Draft通过，不更新feed。证据`~/edupi-install-checkpoints/v0.3.77/evidence/mac-app-only-verification.json`及三份本机安全日志；唯一70刚隔离启动做跨版草稿基线，77安装交互尚待。真实睡眠用户已明确另约，本轮继续其余验证。
- 当前状态取代本节前序快照：Core [#311](https://github.com/PIGU-PPPgu/edupi/pull/311) 已正常合并为 `03bbb893bb609eb68513a65cf4fd808ab8aa30ed`，完整 Mac CI `39504481691` 的实际 checkout `b322a526`、PR head `2f0359f6` 与合并树均为 `8fc34936`。Desktop 同步 JSON 与严格 TypeScript adapter，固定 Runtime schema `09752f53…`、Runtime 组件 `c0c04416…`、Desktop 组件 `126ead40…`，原始 Desktop 清单 SHA `abbbe53f…`；Bridge/课次/SDK/fixtures 不变。[PR #370](https://github.com/PIGU-PPPgu/edupi-desktop/pull/370) 已正常合并为 `128a19d382a0223db9ea02acf72ca5f6afa42dc2`，受测 checkout `f885bf3a`、head及合并树均`b137af6a`；最终应用CI `39519044904` / job `118958122614` 2443通过、42条件跳过、0失败，类型/lint/高危门通过，整轮Rust仍按实际3项zip失败与11条警告记录。
- annotated tag `.77` 固定128a19d3，唯一 [Mac-only签名 run39520241032](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/39520241032) attempt1已启动，phase=draft/platform=macos。Mac目标依赖闭包、Apple route预检、应用质量与完整Core配对已通过，当前继续包装前宿主检查；签名/公证/最终资产与安装尚未完成。不重派Windows/Linux、不公开Release/feed，也不从仍运行的候选推断安装成功。
- 正式 Core03 配对的五项 release source E2 已各自实际 exit0：上传 ICS、文本 DOCX、OCR 只读围栏、文档 revision、slot alias；覆盖当前 owner read/明确采用、取消零写、旧证明/篡改拒绝、重放去重及冷读。最初 JSON 与 adapter 不同步的503已修正；同步后一次 owner read timeout 的原始失败保留，原脚本完整复现通过，根因未定，不能记为首轮全绿。精确命令、源码及日志 SHA 在 `~/edupi-install-checkpoints/v0.3.77/evidence/final-core03-release-e2.md`；收尾本轮临时根与进程均为0。
- 配对切片独立复核、两项精确身份检查、47项工作流检查、类型及定向lint通过。此前本机完整套因旧 adapter 76项失败已留红日志；修正后窄组55通过、1旧原始清单断言失败、3项取消、1项可选跳过，旧清单断言现已精确修正。限时 Runtime/host/reminder 三项发生于系统 Maintenance Sleep/DarkWake 期间，不计通过，也不将每个超时均断言为睡眠根因。已将原检查与正式 Core selectors 接入现有 Mac-only 包装前步骤，原32/25/15秒期限和失败门不变，待新CI实际执行，未以静态检查替代运行。
- 当前桌面恢复可操作后，同源码/正式Core03、原deadline按精确name pattern复验以上三项，实际3/3、0skip/0cancel，21.18秒，见`final-core03-awake-runtime-gates.log`。已保留原超时红日志，未改时钟/能源设置；不是受控真实睡眠验收，也不替代构建内同门。
- TLS补丁后的 `f3510cae` 应用 CI `39509871662` / job `118927944658` 已通过；完整 Rust job `118927944212` 仍失败，实际仅余 Windows updater 的3项 zip 漏洞，新披露两条TLS已消除，不称全仓安全绿。Mac normal/build闭包实际含补丁webpki0.103.16、不含root-certs或zip；签名前仍必须通过同目标CI门。公开 `.70`/feed保持，唯一安装版已停止，新签名安装与原生流程继续，以下前序快照不替代当前状态。
- 真实复现的旧通用文件写入缺口已扩展为完整消费迁移：ICS/DOCX 只收件，由现有 Core owner 重新读取 hash、metadata revision、parse fingerprint，原生明确确认后才 apply。PDF/图片/OCR/.doc 不能安排写入。旧 source 更新、逐项配对、纯 CANCEL/EXDATE 和文件课表缺 owner 合同，入口先返回409并保留暂存、不写安排/删除状态；旧历史读取保持，不能将这些负例记为更新功能完成。
- 两条消费链独立复核无必修；只读 Core `85f175f8` 的实际 Desktop API/磁盘诊断6项通过，文件 writer、owner ICS/DOCX 及副本证据 probe 通过，但它不是正式 pin。源码最终全套2483总/2444通过/39条件跳过/0失败，39项需要正式 Core 配对环境，仍须在最终 pin 补跑。类型、定向lint通过。CI `39499328715` 的章节组件三项失败已精确定位为测试未等真实 WebCrypto，三个回调返回既有 Promise、测试等待实际动作并新增摘要挂起期间切材料回归，10/10无跳过及独立复核通过；原失败日志保留，未削弱来源校验。
- 该源码随后推送到 `631051b7` 的 CI `39505239715` 在新 MCP high 公告门失败，应用兼容检查未运行，不能以本地全套补称CI通过。`ac88d02d` 仅固定 OpenConnector 内 MCP client/server/core2.3.0，并封住自有 REST 默认重定向；真实双loopback307/308改前6请求泄至第二origin、改后目标0请求，正常接口前后仍可用。针对组25/25、独立两文件32/32和类型/lint/锁一致性通过，高危/严重审计0；剩余4 moderate/6 low与Windows zip另记，未忽略安全门。MCP宿主拒路与实际SDK边界回归继续收口，正式Core配对/最终CI/安装仍待，证据`.77/evidence/connector-mcp-security.md`。
- 上条安全切片收口：新增实际MCP边界5/5、独立复核5/5无跳过；Console监听器拒MCP/写/跨origin且下游0调用、stdio限帧/固定GET、raw MCP传输同origin正例与跨origin307/308目标0请求均真实执行，provider SSRF拒绝独立记录。新增安全代码后的全套2489总/2450通过/39正式Core环境跳过/0失败、完整lint/branding与类型通过，原生安装未验；不将provider网络前拒绝当成重定向证明，也不声称历史生产凭据泄漏。
- `4f1d3c53` 应用 CI `39507494122` / job `118919969618` 已通过：新鲜安装/高危门/全套2442通过、42条件跳过、0失败及type/lint通过；与本机启用Core85诊断的2450/39分别记。完整Rust日志实际为5项漏洞，除三zip还新增 `RUSTSEC-2026-0382/0383`，取代之前“仅zip”的预期判断。已经Cargo官方解析精确更新webpki0.103.16及root-certs1.0.10，只有两锁条目变化、原父约束/MSRV保持；版本回归先红、只修webpki后root仍红，全部补丁后8/8及独立复核通过。实际Mac normal/build闭包含补丁webpki、无root-certs及zip，不凭crate存在声称当前SecTrust路径已可利用；root-certs本项目WASM边也不代表漏洞仅影响WASM。新锁Rust审计、最终Core配对与签名安装仍待，不豁免三zip或新公告。详见`.77/evidence/tls-macos-closure-proof.json`及原完整CI日志。
- 公开 `.70` 曾以原生 UI 回读 A/B、B 原会话与 A 独立 fork，输入未发送草稿并在退出后核对持久化。等待 CI 期间已恢复原 WebKit 偏好，故该测试草稿当前不在界面中；新签名包就绪后必须再经旧版 UI 建立，不能注入偏好伪造跨版恢复。新一轮311文件保护基线与原三origin偏好备份保留，唯一 App 已退出。
- `.76` 镜像已卸载、验签小工具保留；用户当次明确确认后，Finder只永久删除 `~/.Trash/edupi-076-generated-products-20261021`，精确警告同名、177→176项与目标不存在均复核。数据卷可用52151752→55884088KiB，约净增3.56GiB；其他废纸篓、源树、证据、真实数据和公开70保留。见`076-generated-products-permanent-cleanup.md`；本轮任务CargoHome克隆70MiB仍保留待最终清理。
- 证据：`.76/evidence/material-readonly-boundary.md`、`core-capability-gap-audit.md`；`~/edupi-install-checkpoints/v0.3.77/evidence/n02-owner-consumer-implementation.md`、`file-schedule-e2-adaptation.md`、`docx-chapter-action-wait.md`、`core-feedback-pr310-merge-proof.json`、`webview-prefs-waiting-restore.json`、`real-before-candidate-with-sessions.json`。旧8命令实际均在Core写入前返回unsupported、两未来投影未发布；受管教学方法、teacher_growth和洞察只读已有独立入口，不能将其一并归为外部阻塞或伪称旧命令完成。最终配对、精确源码 CI、签名与实际安装继续本轮执行。

## 2026-10-21 v0.3.76 退出与源码修复

- 本节取代下方运行快照。唯一 `/Applications/EduPi.app` 已恢复原签名公开 `.70` 并停止；strict codesign/Gatekeeper/原主程序摘要通过，feed不变。311个受保护文件中308原样，差异仅版本记录和两份日志追加，原前缀保持，无文件增删；教师业务、模型与认证文件保持。WebKit本轮改变的草稿/工作区键已恢复并按原摘要回读。
- 三域各三产物已原生打开；行政任务明确接受已落盘，但UI错把合法无回滚回执判失败，评价也已写入却因Core漏重验capability_work显示失效。原生导出取消不增记录、成功保存增一条本地用量事件，无外发；其余两域审核、用量撤销/擦除和新源码安装仍待。
- 原生逐次确认失败定位到锁版rfd无parent进入CF系统通知，非TCC未开或SSE未达。绑定主窗口、缺窗拒绝、锁后到期重验已实际cargo check及Rust6/6通过；新候选仍须真正允许/取消，未操作受禁通知中心或放宽授权。
- 原分支a14398ca的八项源码提交独立复核通过，尚未推送；Native补丁与账本保留。全量初次2484通过/1失败/38可选跳过，唯一旧断言漏sessionId；补精确身份及跨会话拒认后真实SDK26/26无跳过，生产校验未降级，lint/type通过。最终精确源码CI仍须全套成功。
- Core安全依赖已合3992040，必要反馈来源修复独立提交58a13b2f待正常PR/完整CI/合并后固定Desktop；未消费未发布Feishu/floor。DOCX新章节建议仅从精确来源片段待审采用，不自动建教学任务。以上不是`.76`已安装代码；后续只建一次有代码变更理由的Mac-only候选，不重建`.76`、不派Windows/Linux或发布feed。
- 证据仍在`~/edupi-install-checkpoints/v0.3.76/evidence/`：capability-install-result.json、native-export-result.json、native-wire-diagnosis.json、native-computer-parent-artifacts.json、real-076-verified-log-deltas.json、webview-prefs-restore.json。包与缓存身份核对后可恢复清理，完成前不报告已释放空间。

## 2026-10-21 v0.3.76 安装实测与修复中

- 本节取代下方构建前状态。Desktop `57bfe09e`、Core `2fbd3726` 的唯一 [Mac run 39461851799](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/39461851799) attempt1 全部成功；Release `418648403` 保持 Draft。App 公证 `85ff37a7-c5fc-4e6e-ad92-53562490a33a`、DMG 公证 `e00469af-2460-4a5e-930e-6f45c1df4758` 均 Accepted，实际装订、验票、strict codesign 和 Gatekeeper 通过，没有重跑或跨轮拼包。
- 三项最终资产已完整下载核对：DMG `660081618` / 234229972 字节 / SHA-256 `3323e88597713360fde3998d5d20ca4c25946e27fe41521247f75d51e546b5da`；tar `660064808` / 235520186 / `f42567887a847903ec85d922bb5ba74b7bc296e75f35027a961993df13bc48cf`；sig `660065260` / 404 / `742722ac568ed9865bc321d99a09d191b471c171a1bb8f7250e6cd4bc03edffc`。新旧 updater 公钥一致，真实 Minisign 验签和单字节篡改拒绝通过。Mac-only fingerprint 为 `sha256:54cce0a422f99b4a1a7a4fd50f5276f4e846722f18ea351a29f2bc1304db4a35`，不是全平台发布证明。
- 唯一 `/Applications/EduPi.app` 已安装签名 `.76`，仅用明确合成根；原签名公开 `.70` 备份保留于 `~/edupi-install-checkpoints/v0.3.76/EduPi-public-070.app`，公开 feed 不变。实际管理页核对 Core/双清单；旧 `.70` 创建的两任务、哨兵及隔离模型设置在升级和真实冷重启后保持。两任务各自续聊、A 独立 fork、原 A/B 历史及绑定、冷重进无重发通过，4 次本机模型调用/3 个会话文件。fork 消息虽已单次落盘，界面仍误报待核对；没有再次发送，不能把冷重进可见当作自动回执修复。
- 原生安装版完成 A 两回合→独立 fork→切 B 真重启→回 A 正向→班级页删除 A→原会话新回合及冷恢复。模型上下文跨班无串档、已删学生姓名不回生、无关已审核偏好保留；12 次实际本机调用，用户 prompt 未含被测姓名。随后从回收站按规范 ID 恢复 A，回收站 0 项、班级页两名同名异班学生回读一致。原审计/会话历史不重写，不宣称历史文件清除。
- 工具关闭及冷重启后空工具、恢复默认工具的实际调用通过；正常→安全→正常启动实测第三方技能/工具过滤和恢复。安全模式下插件/技能只读入口、新会话均未执行合成扩展模块，恢复正常的新服务 PID 再次记录扩展加载；没有用全关工具冒充安全模式。`.76` 新进程设置页两项 TCC 已授权且身份匹配，但两次 `observe` 在原会话/新会话均 45 秒后返回“EduPi 桌面窗口未连接”、没有逐次确认框，实际允许/取消尚未通过。
- 安装还复现短暂断连。旧 8192 项缓存小于 13158 文件闭包，暖调用仍读约 111 MiB；新源码 32768 有界 LRU 在未修改签名包上实测暖调用只读清单 1 次，仍逐次路径/stat/完整性核对。新增本地连接详情不保存正文、令牌或实例值，不放宽 4 秒/两次失败门。消息恢复补精确请求/完整命令的肯定持久回执，不凭 idle、同文或空 outbox 自动重发；导航后新编辑草稿也须保留。这些修复正在原分支复核，尚未进入签名 `.76`。
- 另确认技能 PATCH 在通用允许根覆盖 Core 时可触及包内封存文件；实际 App 写入被诊断替身拦截，签名文件未改。新源码为已配置 Core 技能增加独立只读拒写与禁用开关，普通用户技能仍可编辑，正在复核。三域授权/收件人/审核反馈和本地用量的原生流程继续，结束仍须真实资料新指纹、界面偏好恢复、恢复公开 `.70` 和产物清理。Windows/Linux 不派发；新 Core 审计修复交接未消费，不改当前候选身份。
- 原始证据为 `~/edupi-install-checkpoints/v0.3.76/evidence/` 下 `mac-asset-verification.json`、`upgrade-after.json`、`task-session-install-result.json`、`memory-privacy-install-result.json`、`tool-modes-install-result.json`、`observe-and-student-restore-result.json`、`core-cache-signed-root-benchmark.json`。源码真实 Core broker/SDK 2/2 已补跑、零跳过；不能代替未完成原生流程。

## 2026-10-21 v0.3.76 装订断连修复

- 原 `.75` [Mac run 39448839994](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/39448839994) attempt1 已失败，取代下方运行中快照。应用质量、完整 Core 配对、真实 SDK/用量/三域宿主接线、打包 OCR/DOCX/连接器/日程/反馈、资源签名、最终 App 签名运行时与 updater 公钥检查均通过。App 公证 `83d45dba-3942-4615-b45b-1b62b06a16f7` 为 Accepted；DMG 公证 `e27f7d0d-ba84-44e1-8500-07752702e27c` 也于 16:32:50Z Accepted，但紧接的 `xcrun stapler staple` 在 Apple ticket-delivery 端点报 `NSURLErrorDomain -1005`，退出 68。后续票据验证、Gatekeeper、最终 DMG 替换和安装未执行，不能凭 Accepted 记整轮通过。
- Release `418561011` 保持 Draft，原 tag/target 不变。三项仍为未完成最终 DMG 装订的资产：DMG `659843262` / 234217511 字节 / `43655008…`；updater tar `659843688` / 235518104 字节 / `ca330f73…`；签名 `659844184` / 404 字节 / `b3c41e12…`。以上为 GitHub 元数据，不冒充三包本机全量验签。签名文件摘要已回读；tar 下载在约 8 MiB 时精确停止本轮进程，未拿部分文件作证。未完成下载目录已移入废纸篓，尚未永久删除；验签小工具移到 `.76` 复用，未安装 `.75`，唯一签名公开 `.70` 与 feed 保持。
- 缺口是现有重试只包住 `validate`，没有包住实际失败的 `staple`。沿用原分支准备独立 `.76`，Core 仍冻结 `2fbd3726`，无新 pin 或用户功能变更。只为明确 Apple ticket-delivery URL 的已观察 `-1005/-1009` 增加最多三次装订尝试、两次 5 秒等待；所有显式 URL 都必须属于该端点，未知/混合端点、其他网络码、票据/签名错误或进程失败立即拒绝。旧验证仅保留历史无 URL 的 `-1009` 兼容，最终 Accepted→装订→验票→Gatekeeper→精确替换的安全门不变。
- 新装订四例先红，补实现后通过；独立复核发现旧验证的显式未知 `-1009` 仍可重试，已补未知/混合 URL 先红再绿，复核无剩余必修。最终发布工具 82/82、完整 lint/branding、`release:verify` 通过，无跳过；这些是调度和拒绝边界证据，不冒充已在 Apple 网络完成装订。日志位于 `~/edupi-install-checkpoints/v0.3.76/evidence/`，原 `.75` 完整脱敏 CI 日志保留。后续经源码 PR/CI 和新一次 Mac-only 签名候选验证，不重跑 `.75`、不拼资产；若有限重试仍遇相同持续外部断连，不再自动循环建立新候选。
- TCC 旧签名记录失配已在公开 `.70` 上通过仅重新登记两项权限修复，实际新 PID 与系统两项允许回执保留。`.76` 仍须唯一安装路径的新进程、真实 SDK/分叉/过滤、删除学生历史防回生、三域审核反馈及本地用量的原生流程，结束核对新真实资料指纹、恢复 `.70` 并清理包。Windows/Linux 不派发，正式用量收集仍默认关闭。恢复入口为 `~/edupi-install-checkpoints/v0.3.76/RESUME.md`。

## 2026-10-20 v0.3.75 固定 Core 删除隐私配对

- 当前状态取代下方 `.74` 中间快照：Core [#301](https://github.com/PIGU-PPPgu/edupi/pull/301) 已正常合并为 `2fbd3726fc4bab79238f17ffaf9e8d25d14d20ae`，树与完整 [Mac CI 39440308530](https://github.com/PIGU-PPPgu/edupi/actions/runs/39440308530) 通过的 `9b73bb16` 相同，Windows 原生跳过。本轮冻结此 Core，不因随后普通 main 更新重复建候选。Runtime schema `10adc92f…`、Bridge/课次/fixture 不变；Runtime 组件为 `75b49fa4…`，Desktop 组件为 `479a5a1d…`。
- Desktop [#367](https://github.com/PIGU-PPPgu/edupi-desktop/pull/367) 已合并为 `5efe0377`，应用 [CI 39437994940](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/39437994940) 通过；原 `.74` [Mac run 39439367689](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/39439367689) 在 Core 配对、应用质量、暂存运行和资源签名通过后，因新固定隐私修复在最终打包阶段主动取消。Release `418495494` 为 Draft/0 资产，原 tag/target 保留；不重跑 `.74`，也不把其通过步骤当作 `.75` 安装证据。
- macOS 26.5.1/arm64、Node 22.23.1 上，最终 Core 的真实 SDK/用量 3/3、完整合同/打包/提醒 25/25 通过，无跳过。新增真实 SDK 回归先确认无 ID 全局记忆包含合成学生姓名且已落盘，再删除该学生，验证新回合及 Core/SDK 冷重启后的工具历史都不回生该姓名，无关已审核偏好仍可见；冷恢复还须实际完成两次模型调用且无 `prompt_error`，防止空执行假绿，最终复核 2/2 通过。独立只读复核无剩余必修项。日志为 `/private/tmp/edupi-075-final-recall-usage.log`、`edupi-075-pairing.log` 和 `edupi-075-deleted-sdk-final.log`；安装版原生删除仍待实际操作，不能用夹具 API 替代。
- 源码门已完成：Desktop [#368](https://github.com/PIGU-PPPgu/edupi-desktop/pull/368) 正常合并为 `e8bae20a1cbb775b1923439487f604fd3a38d29d`，树与受测 `28389f6d` 相同；应用 [CI 39447897756](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/39447897756) 的 2382 通过/38 可选跳过/0 失败、类型/lint 通过，Rust 仍仅既有 Windows 目标 zip 三漏洞失败，未豁免。唯一 annotated tag `v0.3.75` 对象 `be23160da96237c9bcc63b59804334a1710ee63b` 固定该 main，仅派发一次 [Mac Draft run 39448839994](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/39448839994) attempt1，Release `418561011` 保持 Draft、尚无资产。Mac 依赖闭包和 Apple notary 路由预检成功，正在配对检查；不能提前记公证、签名或安装通过。原分支已推送；聊天附加 PR 工具达到 100 项上限，失败不影响已合并的 GitHub PR。
- 保留可信召回、三域授权/持久 outbox、公开收件人确认、审核反馈和默认关闭的本地用量接线。坏旧提醒账本不再阻塞独立内部到期工作；旧飞书结算不明和混合收件人不在本次修复内，不开启外发。实际 Mac 签名资产与安装闭环继续执行，不复用已取消候选。
- 最终固定 Core 的强制公开收件人三域 E2 通过：9 产物、3 次真实 SDK 完整落盘回复，空闲 70/3/4 ms、`prompt_error=0`、能力模型调用 0、无外发。`.75` 类型、完整 lint/branding、73 项发布工具和 `npm run release:verify` 通过；只新增针对删除隐私的 SDK 断言，不削弱任何授权、安全或发布门。证据已复制到 `.75/evidence/`，不代替后续安装交互。
- TCC 技术风险已定位并修复，取代旧“等待认证”状态：系统只读日志对辅助功能/录屏明确报旧代码要求不匹配，旧记录分别绑定 `99915aac…` / `328c1858…` 的固定 cdhash，当前 `.70` 为 `7fb0de47…` 的 Developer ID 稳定要求。原生“在访达中显示”和简介确认登记指向唯一 `/Applications/EduPi.app`。用户亲自通过系统验证后，仅移除这两条失效记录并从该路径重新添加；没有重置 TCC、加私有 entitlement 或改其他应用。隔离冷启动的新 `.70` PID24633 在实际设置页显示两项均已授权，路径/Bundle/Team/PID 与截图一致；系统日志也对该进程两项 preflight 返回 `authValue=2`。这仅证明公开 `.70` 重登记成功，`.75` 安装后仍须新进程和实际 observe 验证。证据在 `.75/evidence/public-tcc-repaired.json` 及相应系统日志。
- `.70` 已正常退出，唯一安装和公开 feed 保持。此次公开版隔离前后 311 个受保护文件中 309 个逐字节相同，仅飞书日志追加 64 字节和运行事件追加 4 条通道重连记录，原字节前缀摘要保持；教师业务、模型/认证和会话不变，不能声称整个摘要未变。安装前还须重建本轮新基线；结束恢复 `.70` 并清理包，Windows/Linux 不派发。恢复入口为 `~/edupi-install-checkpoints/v0.3.75/RESUME.md`。

## 2026-10-20 v0.3.74 HFS 实测修复

- 最终 Core 状态取代本节临时 pin 快照：[#300](https://github.com/PIGU-PPPgu/edupi/pull/300) 已正常合并为 `d6698585ec50ed39c3b84593522255d0cdca3afd`，与完整 [Mac CI 39434072570](https://github.com/PIGU-PPPgu/edupi/actions/runs/39434072570) 通过的 `909b599` 树相同；Windows 原生与 retention stress 跳过。Desktop 已改用最终 main 身份；该树的真实 SDK/用量 3/3、强制公开收件人三域 E2、完整合同/打包/提醒 25/25、类型、61 项发布工具及 release:verify 通过。原 `.73` 取消与其他失败记录保留，不以新结果改写旧运行。
- 当前取代 `.73` 的待签名状态：Desktop [#366](https://github.com/PIGU-PPPgu/edupi-desktop/pull/366) 已正常合并为 `35b8d06e4b011f98ddb6ff965c40b1275e60eef9`，与应用 [CI 39430114634](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/39430114634) 通过的 `4b0e89d5` 源码树相同；Rust 审计仍为既有 Windows 目标 `zip 4.6.1` 三项漏洞失败，无豁免。唯一 [`.73` Mac run 39430899748](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/39430899748) 的预检、应用质量和已完成的配对场景通过，但在签名打包前因下述实测缺陷主动取消；Release `418435366` 为 Draft/0 资产，tag 与 target 保持，不重跑或改写。
- 真实合成 HFS+ 镜像在 macOS 26.5.1/arm64、Node 22.23.1 下，原生 `statfs` 名称为 `hfs`、本机 raw type 为 25，`/bin/df` JSON 却输出精确 `"hfs "`，导致 `c9a1d0f` 的新采证器拒绝合法根。[Apple df 源码](https://raw.githubusercontent.com/apple-oss-distributions/file_cmds/main/df/df.c) 将 Type 列最小宽度设为 4 并使用左对齐格式，支持这一精确单空格填充；不能据数字 25 新增静态类型白名单。
- Core [#300](https://github.com/PIGU-PPPgu/edupi/pull/300) 的 `909b59977f32c0e90c7bf2af2c77495d2cdffb64` 仅将精确 `"hfs "` 解析为 `hfs`，不通用 trim。两个新增回归先红 0/2，修复后 Darwin 全组 28/28、类型、协议、组件闭包和原 root 检查通过，独立复核无必修发现。在同一真实 HFS+ 卷上同时复现旧采证器拒绝、新采证器接受，根准备/指纹回读、嵌套目录/文件证明和符号链接别名拒绝均通过。镜像已正常卸载并移入废纸篓，64 MiB 尚未永久删除；这不是物理 HFS 磁盘或 App 安装到 HFS 的验收。
- 当前原分支准备 `.74`，临时配对该受审提交及新 Runtime 组件 `f719eb80…`、Desktop 组件 `ca886f2e…`；Runtime schema 与公开 Bridge 能力不变。[Core Mac CI 39434072570](https://github.com/PIGU-PPPgu/edupi/actions/runs/39434072570) 仍待完成，最终候选必须换成正常合并后的精确 main，再经 Desktop PR/CI 与全新 Mac-only 签名构建。当前没有 `.74` tag、Release、包或安装证据。
- 用户已当次允许为唯一 `/Applications/EduPi.app` 补辅助功能与录屏授权，系统现要求触控 ID/管理员密码，由用户亲自验证；未重置 TCC、未改其他应用。旧 `.70` 的新进程和系统页状态分别记录，不能把旧开关开启当成当前进程有效获准。安装后的新进程仍须实测。公开 `.70` 与 feed 保持，Windows/Linux 不派发，正式用量文档和云接收端继续缺合同而默认关闭。恢复入口为 `~/edupi-install-checkpoints/v0.3.74/RESUME.md`。

## 2026-10-20 v0.3.73 最终 Core 配对

- 当前状态取代下方 `.72` 中间快照：Core [#299](https://github.com/PIGU-PPPgu/edupi/pull/299) 已正常合并为 `c9a1d0f3d77aeee4fec20cb2abe8cff3d3440771`，源码树与完整 [Mac CI 39424830485](https://github.com/PIGU-PPPgu/edupi/actions/runs/39424830485) 通过的 `6117bb9` 相同；Windows 原生和 retention stress 跳过。Desktop 沿用原分支准备独立 `.73`，固定该合并提交、Runtime schema `10adc92f…`、Runtime 组件 `f0f170b7…`、Desktop 组件 `fa0f6b53…`；Bridge 12 条公开命令和课次身份不变。当前尚无 `.73` 签名资产或安装结果。
- Core 已移除 Darwin 文件系统族的固定注册编号，使用受限系统命令读取原生 APFS/HFS 名称，并以私有证明绑定根、挂载点及逐路径 device/inode/raw type。根、数据库与授权的持久身份格式不变，不迁移、不静默重绑定，也不扩大 Linux/Windows 允许门。独立 26 项边界回归与最终路径词法复核通过。
- 原 `.72` 的 `unsupported_root` 未复现。[只读诊断 39416411366](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/39416411366) 与 [实际 Core 重放 39417133733](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/39417133733) 均通过：Mac 15 / Darwin 24.6.0、Node 22.23.2，系统与 Node 的 APFS 类型、根及挂载 device/inode 一致，原 ambient E2 通过。不能把新发现的可移植性缺陷冒充已证实的原失败原因；`.72` tag、失败 run 和 Draft/0 资产保持，不重跑。
- macOS 26.5.1/arm64、Node 22.23.1 上，最终合并 Core 的合同与原生提醒证明 22/22、真实 SDK 可信召回及本地用量 3/3 通过，无跳过。强制公开收件人确认的三域自然消息 E2 再次通过：9 产物、3 次完整 SDK 回复、空闲 77/3/3 ms、无 prompt_error、能力模型调用 0、无外发。相同 Core 源码树的三项打包/闭包/篡改检查通过；原 25 项组合运行有一项 15 秒 one-shot 超时，负载下降后以原时限单独复核通过，原取消记录不改绿。此前 Desktop 全量 2384/36/0、类型/lint/high audit 与新版本 52 项 release/public-source 检查仍分别保留，不冒充安装验收。
- 本机 Core 混合工作树整链的 DOCX 90 秒取消、稳定树单次生产 deadline 失败及首次 family 子进程超时保留；稳定最终源码的 DOCX 定向复核、独立后段均退出 0，最终整套门以固定源码的上述 Mac CI 为准。采样中只读 `df` 共四次、总约 60 ms，没有发现热循环；不能从随后成功推出原宿主延迟原因已定位。
- 仅派发 Mac 候选。Windows 按用户指令暂缓，Linux 不纳入；仓库级 Windows 目标 `zip 4.6.1` 三项 RustSec 漏洞仍未豁免。公开 `.70` 与七键 feed 保持；正式用量政策/协议与云接收端未提供，真实收集默认关闭。安装时复用 `.70` 原生创建的合成任务做同 ID 跨版本回读，并验证真实 SDK 续聊/分叉、工具与 Safe Mode、三域审核和本地使用记录；恢复入口为 `~/edupi-install-checkpoints/v0.3.73/RESUME.md`。
- 最终候选的小差异独立审查无必修发现；最终 pin 后类型、完整 lint/branding、61 项 release/public-source 工具检查通过。它们是源码门，签名包及原生交互仍需后续实际执行。

## 2026-10-20 v0.3.72 macOS 接线与安装准备

- 当前取代下方构建前快照：Desktop [#364](https://github.com/PIGU-PPPgu/edupi-desktop/pull/364) 已正常合并为 `ecba24e0ef008f631e25c8f1b7e7dbdbab832839`，最终应用 [CI 39414190121](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/39414190121) 通过，既有 Windows zip 审计失败如实保留。固定 annotated tag `.72` 的唯一 [Mac Draft run 39414914751](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/39414914751) attempt1 在首个配对 ambient E2 的 Core 数据根准备阶段返回 `unsupported_root`，未执行打包/签名/公证/安装。Release `418320571` 仍 Draft/0 资产；公开 `.70`、feed 和真实资料未替换，不重跑或改写 `.72` 身份。
- 相同精确 Core、本机子进程 022 掩码的完整 ambient E2 通过，权限掩码假设排除。Darwin 文件系统数字按内核注册顺序分配，Core 固定 26/23 存在可移植性缺陷；该 runner 实际数字尚待证据。只读诊断 [#365](https://github.com/PIGU-PPPgu/edupi-desktop/pull/365) 已合 `e8d3621e`，仅用原生 statfs 名称/类型与 Node 独立 device/inode 比对，未扩大允许列表、伪造证明或派发新包。[诊断 run 39416411366](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/39416411366) 待结果；取得实际证据后才修复并准备新候选。
- 状态：接线已实现、Core 已合并，正在准备 macOS 签名安装验证。Desktop 原分支从 `12bb6a75` 继续，候选版本升为 `.72`；没有改写 `.71` tag/资产，没有替换公开 `.70` 安装或 feed。Windows/Linux 本轮不构建。
- 最终配对取代本节下方仍称待 CI/合并的中间记录：组合头 `54c51a68` 的 [Mac CI 39410686488](https://github.com/PIGU-PPPgu/edupi/actions/runs/39410686488) 全部适用门通过，Windows/retention stress skipped；[#298](https://github.com/PIGU-PPPgu/edupi/pull/298) 正常合并为 main `ae99a886532eb811682f417b7eb8cb7b47298e7a`，包含 #297 全部提交，两 PR 均已 merged。最终树与通过 CI 的组合树逐字节相同；#297 单独排队检查取消，不冒称其独立通过。Desktop 已固定最终 main、Runtime schema `10adc92f…`、Runtime 组件 `bb0945ee…` 与 Desktop 组件 `039373bc…`。
- Desktop 全量 `2384 pass / 36 skipped / 0 fail`、类型、完整 lint/branding 和 high audit 通过。可选跳过项之外，真实 Core/SDK 用量与可信召回 3/3、合同/打包/原生提醒证明 25/25、强制公开收件人确认的三域 E2 均通过。三轮 SDK 助手完整落盘、无 prompt_error，空闲耗时 83/3/4 ms，无外发。安装操作尚未完成，不能把本机源码门提升为安装结果。
- Core 基线为已合并 `e74367ba87df9eda918ef88be02e3446e3a64928`。该精确树上的 Bridge/Runtime/课次合同与打包闭包 25/25、六类删除恢复、教师上下文审核、工作判断、学生档案与事件、文本日程证据链路已在 macOS 26.5.1/arm64、Node 22.23.1 的隔离根通过。它们不代替新增宿主合同的最终组合测试或安装证据。
- 新接线包括真实 SDK 当前消息和 Core 私有证明绑定的记忆读取、三域精确 grant/scope 启动、自然消息持久 outbox、收件人明确确认、审核后评价与本地用量。Core 收件人 [#297](https://github.com/PIGU-PPPgu/edupi/pull/297) 先后补同家长多学生/跨学期与未知失活来源的审查回归；[首轮 Mac CI 39406757007](https://github.com/PIGU-PPPgu/edupi/actions/runs/39406757007) 的 type/protocol/manifest/audit 通过，既有 G2 崩溃恢复夹具未到发布边界失败。用 2.1 秒回环延迟在旧测试租约复现 `model_unavailable` 后，仅扩大夹具 live 窗口、改等真实持久到期并增加脱敏诊断；SIGKILL、单调用/单占额、撤销和到期不发布的断言保留，三个定向恢复场景通过。新提交 `feae897` 待其 CI，不手动重跑失败旧 SHA。
- 使用记录的未知回执重试、Core 真重启、政策切换隔离、撤销/擦除、队列容量及业务哨兵保持通过真实 Core 定向测试；API 鉴权和对应界面恢复控制通过。默认不收集、不上传，正式政策/协议与云端接收合同未提供，不能从合成同意推出真实采集可启用。草稿打开按精确投影路径/ID/版本且实际可见后计入，导出仅在原生保存成功后计入；未知文件和教师材料不借用产物身份。
- 可信召回 Core 分支已通过精确注册消息、同名跨班、撤回删除、冷恢复、Safe Mode/无工具、在途 steer 失效及原中文/数学/日期回归。完整本机 npm 门遇审计矩阵行号和跨清单分类元数据断言后按证据修复，已经通过的前段与后续命令分别保留，不宣称原失败命令整体成功。最终固定版本 CI、双清单合并身份及原生安装步骤尚待执行。小型恢复记录在 `~/edupi-install-checkpoints/v0.3.72/RESUME.md`。

## 2026-10-19 v0.3.71 仅 macOS Draft 与隔离安装

- 用户要求先只构建 Mac，不在 Windows x64 电脑就绪前触发 Windows 构建或原生检查。Desktop Draft [#364](https://github.com/PIGU-PPPgu/edupi-desktop/pull/364) 的精确源码 `5c3c7d912acd6e6436f944ea3f22989a77ba4305` 临时固定未合并 Core [#286](https://github.com/PIGU-PPPgu/edupi/pull/286) 的旧快照 `d510792d8eb52a321825afc3808ba2006d3f67cd`；复查时 Core #286 头已前进至 `ac03fb9ba58265abea07993ed40946cb7859c6c7`，故本候选不能充当新头或未来合并提交的验收。[Mac-only Draft run 39191284249](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/39191284249) attempt 1 的 notary-preflight、release、`build (aarch64-apple-darwin)` 成功；Windows/Linux build 未派发，`draft-proof` 因非 `platform=all` 按设计跳过，**没有三平台同轮指纹或正式发布资格**。仓库级 [Rust 审计 39191253917](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/39191253917) 对 Windows 目标引入的 `zip 4.6.1` 三项新漏洞仍失败；Mac 预检只证明其目标依赖闭包没有旧版 zip，未关闭或豁免原审计。
- [Release v0.3.71](https://github.com/PIGU-PPPgu/edupi-desktop/releases/tag/v0.3.71) ID `416852779` 仍为 Draft，绑定上述精确源码。最终三项 Mac 资产均来自该 run：装订后 DMG ID `655167318`、`234116890` 字节、SHA-256 `be090a556d5a4dfd685ff0a4c0463f8a98440c3f7e0ce224fdbabd322f1a2776`；updater 包 ID `655153076`、`235378078` 字节、SHA-256 `8990da68527a21feacc113407a0b6f55f771f3093ec78b17c59293bc4b8f65d4`；其签名 ID `655153328`、`404` 字节、SHA-256 `82c8ef747425bd5bb873206ba2cec61064f9f24516baa750e0250127b8b0c78c`。先上传的 DMG ID `655152816` 已由 CI 替换，不能混作最终包。App submission `3e9c0346-8381-4276-954a-2fceca8b0843` 与 DMG submission `423a8256-ae5f-4351-b371-a11ffcefd935` 均 `Accepted`；CI 的 App/DMG 装订、strict codesign、Gatekeeper、包内 updater 公钥及配对 Core 暂存集成通过。本机完整下载最终 DMG 的大小/SHA、镜像 CRC、签名与 Gatekeeper 独立通过；只读挂载 App 的版本 `.71`、严格签名与 Gatekeeper 通过。
- 唯一 `/Applications/EduPi.app` 暂装该签名候选，使用权限 `0700` 的私有合成根、`EDUPI_ROUTE1_ISOLATED_CANARY=1`、`PI_OFFLINE=1` 正常 Launch Services 启动。原生管理中心显示 `.71`、与启动参数一致的隔离根、Core/教育投影就绪、Core 精确 `d510792d…`、双清单匹配及 12/12 可交互能力；G1 未开启。在工作区创建不自动准备产物的合成任务 `teacher-task-f0337fe9-0d66-4b57-8124-5baa3fefb51c`，落盘后正常退出并真实重启 App，从同一工作区和任务详情再次看到原任务，JSON 同 ID 回读。此项是 Mac 安装/持久化技术烟测，不替代六类删除恢复、更新原位升级或跨平台教师流程。
- 已正常退出测试进程、恢复原签名公开 `.70` 到唯一安装路径；主程序 SHA-256 `926bebb07d984bad49e669cb45bf1fcfbd783c1ca5f7288dfe19d6c222af9953`、strict codesign/Gatekeeper 均与原值一致。受保护真实资料安装前后各 167 文件，仅既有 `feishu-bridge.error.log` 增长，教师业务及模型/认证文件逐项相同。镜像已卸载；按用户对精确两项的确认，访达仅永久删除 `.71` DMG 下载目录和测试 App，删除前原占用约 224 MiB + 943 MiB，废纸篓项目数 95→93，两个目标路径均不存在，其他废纸篓项目未清空。系统空闲空间回读约 76→81 GiB，但有并发变化，不能把全部净增归因于这两项。本机保留约 96 KiB 小型证据与隔离合成根。`v0.3.71` 不公开、不更新七键 feed；公开 Release、feed 与安装版仍为 `.70`。恢复入口为 `~/edupi-install-checkpoints/v0.3.71/evidence/`。
- 账本首推 `bc3690bb` 在 [CI 39197655695](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/39197655695) 被公开源码路径哨兵拒绝，原因是新增维护者绝对路径；`85be527b` 删除该路径而保留精确本机记录，针对性 5 项测试全过，[PR CI 39198116825](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/39198116825) 的应用 `audit` 已通过。Rust 审计仍因同三项 `zip 4.6.1` 漏洞失败，未作豁免。

## 2026-10-19 Windows 构建暂缓

用户要求在其确认 Windows x64 电脑可用之前，不触发 Windows 构建或原生检查。后续不派发 `platform=all/windows` 签名 Draft、Windows preview/smoke/debug，也不手动重跑私有 Core 的 `windows-native-inspector`。[Core #286](https://github.com/PIGU-PPPgu/edupi/pull/286) 旧快照 `d510792` 的 Windows job 曾因付款或支出上限零步骤失败；当前头 `ac03fb9` 的 `core-quality` Mac 检查通过、`windows-native-inspector` 为 skipped，**均不能写成 Windows 通过**。Desktop [#364](https://github.com/PIGU-PPPgu/edupi-desktop/pull/364) 仍为 Draft 旧头临时 pin。上方 `.71` 是仅 Mac 签名且已恢复公开安装的技术试用候选；公开 `.70` Release、七键 feed 与唯一安装版不变。待 Core 审查及当前头/最终合并身份确定后重新配对，Windows runner 就绪后再补 Windows 构建与安装验收；暂缓不是验收通过。

## 2026-10-15 v0.3.70 正式发布与技术验收

- Desktop [#357](https://github.com/PIGU-PPPgu/edupi-desktop/pull/357) 合并为精确 `main` `ea03b52398455d80539d8f52fe22e18bd2dad032`，固定 Core `b12b5cbfd6f26561c535a95bfbf692fbe5fdae2d`。[三平台 Draft run 38679653950](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/38679653950) attempt 1 的 Mac/Windows/Linux、notary-preflight 与 `draft-proof` 同轮成功，九资产指纹 `sha256:e7ab5b1bbbe0db337f9f5f9f456125595057baaea5217b755da342378c319311`。Apple App submission `02c098d7-76e1-4d6f-b70c-8646aaedc66b` 与 DMG submission `f465887b-febf-406b-a782-e228889aec7e` 均 `Accepted`；装订、严格签名、Gatekeeper 及最终 DMG 替换通过。最终 DMG 资产 `642737755`，234088244 字节，SHA-256 `db04f04714409a7326ef396e3171ea17123de6de338416c3a4ab383c3f32101c`；本机整包摘要、镜像 CRC、签名和 Gatekeeper 独立通过。
- 原公开 `.56` 与 `.70` 可执行文件中的 updater 公钥完全相同，公钥字节 SHA-256 `1e4dfd5ed31ca46ee167654232980397ffbd9f0ba5ddaf03d57201e3af859de6`。同轮四类载荷与四个签名的本机完整下载均匹配 Release ID/大小/SHA；离线 `minisign-verify 0.2.5` 四项通过，逐项单字节篡改均被拒。本机唯一 `/Applications/EduPi.app` 用只读 DMG 短暂安装 `.70`，在私有合成根中通过原生 UI/Core 精确身份、外发关闭、合成任务写入及真正 App 重启后同 ID 回读。直接由测试脚本启动时，Next 服务曾在 GUI 存活时收到 `SIGTERM` 并显示断连；信号来源未定位。macOS Launch Services 的正常隔离启动与后续 updater 重启均能保持 Core ready，不把测试启动器异常伪称已修复。
- [publish run 38687334676](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/38687334676) 用原接受指纹和同一源码成功；[Release v0.3.70](https://github.com/PIGU-PPPgu/edupi-desktop/releases/tag/v0.3.70) 已非 Draft/预发布，11 资产，公开 feed 七平台键均为 `.70`。Raw CDN 曾在 `max-age=300` 内返回旧 `.56`，随后刷新；旧 `.56` 安装客户端已原生识别 `.70`，点击更新后实际经历下载、安装与重启，进程 `27477 → 28479`，唯一安装路径成为签名且经 Gatekeeper 接受的 `.70`，主程序 SHA-256 `926bebb07d984bad49e669cb45bf1fcfbd783c1ca5f7288dfe19d6c222af9953`。重启后隔离根/离线标记保留，Core `b12b5cb`/投影 ready、外发 false；根内原有合成标记文件摘要不变。旧版在升级前尝试创建合成任务时服务断连且任务未落盘，故不能声称该任务跨版本迁移通过。受保护真实资料升级前后均为 167 文件，只有既有 `feishu-bridge.error.log` 增长，教师业务和模型/认证配置逐文件相同。
- [Linux 公网安装 38687488727](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/38687488727) 成功。Windows [首轮公网安装 38687488485](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/38687488485) 已安装并启动，但旧脚本错误地等待普通模式教育工作区 200，超时后不能据此判定安装包失败。[#358](https://github.com/PIGU-PPPgu/edupi-desktop/pull/358) 保留当前 Core 的普通模式原生拒写门，先验公开安装器 digest 与普通壳身份/home，再以隔离 Safe Mode 核对同一包。`38688497297` 被 PowerShell `$home` 与只读 `$HOME` 冲突阻断；[38688768313](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/38688768313) 在源码 `78901010` 上通过公开包 digest、普通壳/单实例、`native_attestation_required` 与 G1 关闭、隔离 Safe Mode Core/教育投影 ready、精确 pin/G1 待激活/外发关闭及原生源码 `cargo check --locked`。审查追补中，[38690060618](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/38690060618) 的重复第二次安装后单实例检查未完成，[38690707375](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/38690707375) 在不受限 runner 临时安装根被原生来源守卫按设计拒绝；改为复用受限用户根中的唯一安装后，[最终同包验收 38691364876](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/38691364876) 在源码 `dfd94d79` 上再次全绿，包括原生源码检查。代码审查三项已解决，PR 合并为 `main` `ed23b2d400dbf785e14553c0e517b1578b72b946`，未重建或替换 `.70` 签名资产。此项只记 Windows 公网安装技术烟测通过，不等于完整教师 UI。
- #358 为历史公开 tag 增加所选 tag 源码/合同约束，并按 `.70` 首个公开原生准入版本分流。额外 `.56` 旧版试跑 [38692553526](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/38692553526) 的单次工作区读取返回“暂不可用”；合并代码已恢复原旧版临时安装根和最多 30 次只读等待，**该旧版兼容分支未再次运行，不记通过**。此结果不撤销同一 `.70` 公网包的两次正向验收。
- 系统设置中 EduPi 的辅助功能和录屏开关均显示开启，而隔离启动 `.70` 的设置页两项仍报未授权；本轮未更改 TCC，也未把该差异记为权限通过。已退出测试进程，唯一安装保留公开 `.70`；本轮约 895 MiB updater 下载件、13 MiB 验签缓存、225 MiB DMG、942 MiB 测试 App 已按精确路径删除，空闲空间约 36→38 GiB。小型原始指纹、验签结果及恢复说明在 `~/edupi-install-checkpoints/v0.3.70/RESUME.md`。此节取代下方 `.70` 构建前快照的当前发布状态。

## 2026-10-15 v0.3.70 构建前快照

- `.69` [三平台 Draft run 38675336208](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/38675336208) 的 Apple 公证服务预检及 Linux 构建通过；Mac 在“Verify staged macOS integrations”中先通过日程冲突，再于课次变更的服务重启后，首次教育数据 GET 报 `fetch failed` / `ECONNRESET`，后续 Mac 签名、公证和 `draft-proof` 未执行。Windows 在本记录时仍运行；整个 Draft 不具备发布资格，现有 `.69` Release 绑定旧源码 `f2001f70cc78bbefc70634fedaca4885f4f95be4`，不可改写成新源码。
- `.70` 仅将已合入的只读 GET 单次重置重试复用于课次/校历读路径，并在课次、上传校历、反馈的测试服务启动时先完成带授权只读 Core 预热；写入调用不重试，原拒写、去重、重启回读和公证/签名/同轮资产证明门不变。macOS 26.5.1/arm64 本机用精确 Core `b12b5cbfd6f26561c535a95bfbf692fbe5fdae2d`、13,300 文件的真实暂存服务与私有合成根，三个受影响的 staged E2 均通过，`external_send=false`；`npm test` 2351 通过/34 跳过/0 失败，类型与 lint 通过。本机约 1.8 GiB 暂存资源、临时 Core 检出及测试缓存已按路径清理，可用空间约 41→43 GiB。下一道门为原分支 PR/CI，再从合并 `main` 触发独立 `.70` 三平台 Draft；**没有新签名 Draft 或公开发布**。

## 2026-10-15 v0.3.69 构建前快照

- `.68` Mac 签名包上传后，Apple 公证状态轮询出现 `-1009`；无 `Accepted`、装订、最终验证或同轮资产证明。原分支为 `.69` 增加 macOS runner 的公证服务预检，预检不通时不启动三平台打包；提交 DMG 后保存一次 submission ID，对 `In Progress` 和已观察到的 Apple 状态端点短暂断线有界查询，最多 80 次，每次间隔 15 秒，不重传未知结果。`Invalid`、身份不符、非 Apple 端点、超时及持久故障仍失败；装订、签名、Gatekeeper 和原同轮资产证明门均保留。
- 本轮仍固定 Core `b12b5cbfd6f26561c535a95bfbf692fbe5fdae2d`，不改教师业务接口、真实数据根、公开 `.56` 安装或 feed。源码 PR、CI、签名 Draft、九资产指纹、Mac 公证及安装/更新技术验收必须分别记录实际结果；版本准备和脚本单测不等于发布。若 Apple 预检失败，记录后停在无新资产状态，不再触发重复付费构建。
- `.69` 公证流程源码由 [#353](https://github.com/PIGU-PPPgu/edupi-desktop/pull/353) 合并为 `main` `ebd19046fc8e010c582d4dfeb5869ef2f9e687bc`，最终 PR [CI 38673590665](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/38673590665) 两项通过；审查指出公证故障会丢诊断，已补仅含退出码、网络码、HTTP 状态、服务域名与脱敏摘要的错误，讨论已解决。**尚未触发 `.69` 签名 Draft**：另有 `.68` 的完整 attempt 2 在进行，不能并行花费或拼资产。该轮 Mac 失败后，原分支又将隔离日程验收的预热改为带授权只读 GET，并完整读取响应；实际状态判断仍由后续测试完成。macOS 26.5.1/arm64 本机真实暂存服务配精确 Core、隔离数据与外发关闭，连续三次跑 `npm run test:staged-schedule-conflicts-runtime` 均通过，包括凭据撤销后 503；全量 `npm test` 2345 通过/34 跳过/0 失败，类型和 lint 通过。GitHub Mac runner 上此修复仍待新的 PR CI/签名 Draft 证据。本轮临时 Core 检出、约 1.8 GiB 打包资源及测试缓存已按精确路径清理，磁盘可用空间约 43→45 GiB；源码和已有数据保留。

## 2026-10-15 v0.3.68 三平台 Draft 失败

- [同一 run 38594840857 attempt 2](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/38594840857) 由并行操作触发完整重跑，不是本任务补拼单平台资产。Windows/Linux 成功，Mac 在“Verify staged macOS integrations”的隔离日程冲突流程中，第三次启动打包服务并撤销测试凭据后首次授权读取报 `staged_schedule_get_failed:ECONNRESET`；子进程仍在、日志摘要 `3a4b795a…`、无可识别错误码。后续 Mac 签名/公证未执行，`draft-proof` 跳过，整轮不能发布；失败点属于 HTTP 传输，尚不能据此断言 Core 业务拒写本身有错。原无授权 403 预热不经过 Core 路由，是本轮针对性修正的依据。
- Desktop [#350](https://github.com/PIGU-PPPgu/edupi-desktop/pull/350) 的应用检查与 Rust 安全审计在 [CI 38593848793](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/38593848793) 通过，合并源码为 `539ada017961d03da096bb56c2a8ae260dff2493`，Core 固定 `b12b5cbfd6f26561c535a95bfbf692fbe5fdae2d`。[三平台 Draft run 38594840857 attempt 1](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/38594840857) 的 Windows/Linux 完成并通过，Mac 的配对 Core、打包集成、签名、打包运行时和 updater 公钥检查均通过。
- 预期 Mac 公证返回 `Accepted`、装订并替换 Release DMG，再完成严格签名/Gatekeeper 和同轮九资产指纹。实际 `notarytool submit --wait` 已上传 DMG、取得 submission `bae90110-2958-470d-86f9-5319261caca9`，在查询 `appstoreconnect.apple.com/notary/v2/submissions` 时报告 `NSURLErrorDomain -1009` / `No network route` 并退出；**Apple 最终公证状态未知**。装订、DMG 替换与最终验证未执行，`draft-proof` 跳过。Release `412914947` 虽列九项资产仍为 Draft，其中 Mac DMG 资产 `641035204`、SHA-256 `94b575ee375bffaca441046f65b362d79de922f29828152b03a58a8eb004a9ff` 是装订/替换前上传的字节，不能供教师下载或用于发布。`.67` 的 `-1005` 校验重试在真实 Mac CI 中尚未运行到，只有本机回归测试通过。
- 此次失败在 Apple 公证状态网络轮询，不是已观察到的产品签名拒绝；不能据此推断 Apple 已接受，也不能把 Windows/Linux 成功或九个文件名当成完整签名发布证明。连续 `.67`、`.68` 均被 Apple 网络瞬断打断，按费用与安全边界暂停重复三平台构建、单平台拼接和自动发布。待外部链路稳定后从新候选重新取得同一 attempt 的全套成功证明。GitHub API 回读公开 `updater-feed/latest.json` 仍为 `.56`、7 平台键；唯一公开安装 `.56` 未切换，本轮没有本地下载或构建包要清理。短暂断连横幅、TCC/旧客户端原位升级、真实跨到期睡眠、真人教学质量、Windows/Linux 完整教师流程继续未验。本节取代下面 `.67`/.68 构建前记录的当前状态。

## 2026-10-14 v0.3.67 Draft 失败，v0.3.68 构建前快照

- Desktop [#349](https://github.com/PIGU-PPPgu/edupi-desktop/pull/349) 已合并为 `main` `cc1531575108baef2264e2020051b41c7dcd0bd4`，固定 Core `b12b5cbfd6f26561c535a95bfbf692fbe5fdae2d`。[三平台 Draft run 38582208711](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/38582208711) 中 Windows/Linux 成功，Mac 的配对 Core、打包集成、签名、更新公钥检查通过；Apple notary submission `2e4c8673-723a-439b-bb10-8fef621e7b9b` 为 `Accepted`，DMG 装订及首次校验、Gatekeeper 评估通过，替换后的 DMG SHA-256 为 `9159defb5a3036ff95b44bb996e355dbcc38655560d5c54b38e557beded4f2a1`。
- 同一 Mac job 的最终复核中，App strict codesign 与装订校验、DMG codesign 通过；重复运行 DMG `stapler validate` 时 Apple CloudKit 票据查询返回 `NSURLErrorDomain -1005`（连接中断），脚本因仅识别 `-1009` 而立即失败。**整轮 CI 失败，`draft-proof` 跳过**；Release `412825464` 虽有九项资产，仍是 Draft，未证明同轮资产指纹，也不把 Mac 最终验证写为通过。公开安装和 feed 仍是 `.56`。
- 原分支对 Apple 票据服务这一路径的 `-1005` 增加至多三次校验、两次有界等待；持久中断、其他 URL、票据/签名错误仍失败。新增回归测试先在旧代码 2 项失败、修改后 5 项全过。仅为新候选 `.68` 准备版本与说明；PR CI、签名 Draft、同轮资产证明和安装验收均待实际运行，不能借 `.67` 资产发布。
- `.67` 所记录的短暂断连横幅、TCC、旧客户端原位升级、真睡眠、真人教学质量与 Windows/Linux 完整教师流程继续未验；构建失败不能推定这些流程的结果。本节取代下面 `.67` 构建前快照的当前状态。

## 2026-10-14 v0.3.67 构建前快照

- `.66` 的 Mac 构建已越过 Core 根准入门，但首个打包服务日程冲突 GET 在轻量身份端点返回 204 后仍发生 `ECONNRESET`。原分支修复提交 `2163fdc4` 在启动隔离服务器时，要求只读、无 token 的目标路由实际返回预期 403，才进入写入/审核用例；仍保留 45 秒有界启动门，不重试任何可能写入的 POST。`.67` 的最终 PR 合并源码 SHA 与签名 run 待产生后回填；Core 继续固定 `b12b5cbfd6f26561c535a95bfbf692fbe5fdae2d`，没有改产品接口或生产 Core 数据。
- 本机 macOS 26.5.1/arm64、Node v22.23.1，用 `npm run desktop:prepare` 真实暂存 13,300 个固定 Core 文件后，按 CI 顺序运行四项打包服务集成验收：日程冲突、课次改动、上传校历、教师反馈均通过；包内模型文件检查 1 通过、1 跳过。期待新 PR CI 零失败，再从合并 `main` 触发 `phase=draft, platform=all`，核对三平台同轮九资产、更新签名及 Mac 公证 Accepted。当前只是**源码和本机暂存验收通过，待 PR CI/签名 Draft**；本机原始 stdout 未归档，新 PR 与 Release Actions 日志需作为可复核原件回填。
- 同一源码第一次本机 `npm test` 长时运行记录 2330 通过、2 失败、1 取消、34 跳过，失败项原始输出被终端截断，原因未定位；不把它当成通过。未改代码的第二次完整运行记录 2333 通过、34 跳过、0 失败；TypeScript、lint、`release:verify`、锁定 Cargo metadata 和发布工具 202 通过/6 跳过/0 失败。两轮本机 stdout 均未归档，干净 runner 的 PR CI 是下一道可追溯门。
- PR [#349](https://github.com/PIGU-PPPgu/edupi-desktop/pull/349) 首轮 [CI 38575076924](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/38575076924) 的 npm 应用门通过，Rust 审计却按 2026-10-14 新披露的 `RUSTSEC-2026-0346` 至 `0349` 拒绝锁定版 `rustls 0.23.45`；[rustls 官方 0.23.46 发布](https://github.com/rustls/rustls/releases/tag/v%2F0.23.46)包含四项修复。已只用临时 Cargo 源配置将锁定 `rustls` 更新到 `0.23.46`，未禁用审计；Cargo 解析同时重选已在锁文件中的五处 `windows-sys 0.59.0` 引用，跨平台兼容须由新 CI/构建验证。此前 8 条 unmaintained/yanked 警告不是本次四条漏洞，也不称为零风险。当前仍待新 PR CI，不能合并或触发签名 Draft。
- PR 审查又指出后续三项 staged E2 各自新启服务器，也只等轻量身份端点。现按各自首个业务路由加有界只读/无效请求预热：课次 `intake` 的 `{}` 只得 400、不写入；上传材料与反馈无 token 只得 403。反馈在截止前未取得预期 403 则明确失败。使用本机真实 standalone 和同一固定 Core 重新跑课次、上传校历、反馈三项均通过，外发 false；工作流保护测试 203 通过、6 跳过、0 失败。所有本轮打包资源和临时 Core 依赖用完清理，磁盘空闲由约 48 GiB 恢复为 50 GiB；仍待新 PR CI 和 hosted macOS 签名验收，不把这次本机结果当成安装版证据。
- `.64` 的短暂断连横幅仍是已观察风险，`.67` 安装、TCC、旧客户端原位升级、真睡眠、真人教学质量和 Windows/Linux 完整教师流程均未验。唯一公开 `/Applications/EduPi.app` 和 feed 保持 `.56`；不得把 `.66` 的 Linux/Windows 部分资产拼入新版本或提前公开。此次本地暂存的 `.next-desktop`、server、Pi Agent Server、Core 和 OpenConnector 资源及精确临时 Core 依赖已核对为可再生后删除，空闲空间由约 48 GiB 回到 50 GiB。

## 2026-10-14 v0.3.66 三平台 Draft 失败

- PR [#348](https://github.com/PIGU-PPPgu/edupi-desktop/pull/348) 在 [CI 38538935999](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/38538935999) 两项通过后合并为 `main` `67a6734d0d9eade08aef5d8c19a3bf3d8e837338`。三平台 Draft [run 38539592345](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/38539592345) 中 Linux/Windows 成功，macOS “Verify paired Core runtime”通过，但在“Verify staged macOS integrations”的首项 `test:staged-schedule-conflicts-runtime` 报 `staged_schedule_get_failed:ECONNRESET`；进程未退出，日志摘要保留而无安全错误码。签名、公证未执行，`draft-proof` 因 Mac 失败跳过；Release `.66` 仍是只有六个 Linux/Windows 资产的 Draft，未改 feed。
- 该失败是验收服务的首次只读请求，未发生教师数据写入；其精确网络层原因仍未证实。`.67` 的目标路由预热是针对冷启动竞态的假设修复，需 macOS hosted runner 实测，不把本机打包服务通过写成 CI 通过。本节取代下面 `.66` 的构建前快照。

## 2026-10-14 v0.3.66 历史构建前状态

- `.65` 的 macOS 验收失败后，在原 Desktop 分支提交测试根修复 `a1b7305c`，并将候选版本升为 `.66`；最终 PR 合并源码 SHA 与签名 run 待实际产生后回填。Core 仍固定 `b12b5cbfd6f26561c535a95bfbf692fbe5fdae2d`，不把本候选称为最新 Core 配对，也不改变生产 Root writer admission。
- macOS 失败发生在合成验收脚本的系统临时根申请 Core 租约之前；准确的 Core 根错误码未被旧脚本打印，原因仍属环境假设。新脚本在申请租约前断言并输出脱敏 `code`，默认用受检出的 Desktop 工作区卷；Release 与 Preview 的非 Windows 配对步为所有合成脚本提供权限为 `0700` 的工作区临时目录，并在步末核对精确路径后清理。针对性结构测试先在旧工作流失败、修复后通过；本机精确 Core 的真实根租约、ambient、slot-alias 和 proactivity canary 通过，均在 macOS 26.5.1/arm64、Node v22.23.1 上运行。证据为该分支的 `scripts/release-workflows.test.mjs` 与下方 `.65` 失败 [run 38532458614](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/38532458614)；原始新 PR/签名 CI 日志待回填，不用本机通过冒充 runner 结果。
- 当前状态为**已修复验收夹具、待 PR CI 和新三平台签名 Draft**。预期新候选的 Mac/Linux/Windows 构建及同轮资产证明全部通过，Mac 公证 Accepted、签名与装订验真；实际结果待运行。`.64` 已观察的短暂断连横幅仍未修复，`.66` 安装、旧客户端原位更新、App 管理 TCC、真实跨到期睡眠、真人教学质量和 Windows/Linux 完整教师流程均未验。构建不自动公开 Release 或更新 feed；公开版仍 `.56`。

## 2026-10-14 v0.3.65 三平台 Draft 失败

- PR [#347](https://github.com/PIGU-PPPgu/edupi-desktop/pull/347) 合并为 `main` `566cb0514ea954f8e47a7bf8e4f61a644f7564dd`，本地检查及 PR CI [run 38531538804](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/38531538804) 通过。三平台签名 Draft [run 38532458614](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/38532458614) 实际失败：Linux/Windows 构建成功，macOS 在“Verify paired Core runtime”中由 `scripts/test-edupi-ambient-today-runtime.mjs` 触发 `CoreRuntimeWriterAdmissionError: The Core Runtime writer admission root is invalid`，后续签名、公证未执行；`draft-proof` 因矩阵失败跳过。Release `v0.3.65` 保持 Draft，只有 Linux/Windows 六个资产，不能作为三平台包或公开更新发布。
- 失败时旧验收脚本使用 `os.tmpdir()` 创建合成数据根；旧日志只显示写入租约拒绝，没有记录 `prepareCoreRuntimeRoot` 的具体错误码，不能断言 Core 生产根被拒绝或某个文件系统必然不受支持。本节取代下面 `.65` 的构建前快照；公开安装和七键 feed 均未改变。

## 2026-10-14 v0.3.65 历史构建前状态

- 版本提交 `a1b12f1af17f9ccb785f76ab22cf11b3d50545ee` 在 Desktop [PR #347](https://github.com/PIGU-PPPgu/edupi-desktop/pull/347) 中，合并提交与签名 Draft 的精确源码 SHA 待 CI 和合并后回填。本次只改版本、组件版本清单与发布说明；Core 固定 `b12b5cbfd6f26561c535a95bfbf692fbe5fdae2d`，Pi/PiDurable 1.0.2，未声称消费 Core 新 `main`。
- 当前状态为**已准备版本、待 PR CI 与三平台 Draft 构建**，不是“已构建”或“可公开下载”。本地 `npm test` 2331 通过、34 跳过、0 失败；发布工具测试 200 通过、6 跳过、0 失败；TypeScript、lint、`release:verify`、`cargo metadata --locked` 和高危 npm 审计通过，审计仍有 6 低危、3 中危。PR CI 完成后才从合并的 `main` 用 `phase=draft, platform=all` 触发签名构建，并逐项核对同轮资产、更新签名与 Apple 公证。
- 本地检查环境为 macOS 26.5.1/arm64、Node v22.23.1、npm 10.9.8、Rust/Cargo 1.88.0；预期是版本与组件清单一致、测试零失败、类型与 lint 零错误、锁定 Cargo 元数据可解析、无高危/严重依赖告警。上述本地实际结果记录在本节，原始 stdout 未单独归档，因此不以它代替 CI 门；同一 PR 补证前提交 `5dcf16235c906146d9d4395f93f6b5a685997f53` 的可追溯原始测试/类型/lint/npm 与 Rust 安全审计日志位于 [PR CI run 38530741909](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/38530741909)，两项 job 均成功。签名 Draft 的包检查与平台构建日志仍待新 run 生成。
- `.64` 安装版短暂误报断连仍是本候选已知风险，没有在 `.65` 修复；其已通过的定向通知和隔离续聊仅属于 `.64`，不能替代 `.65` 安装证据。`.65` 的签名包安装、旧客户端更新与 App 管理 TCC、真实跨到期睡眠、真人教学质量及 Windows/Linux 完整教师流程均未验。构建结果不自动发布 Release 或更新 feed；公开版仍为 `.56`。

## 2026-10-12 v0.3.64 定向通知安装验收追补

同一签名 Draft 资产 `632644912` 重装到唯一 `/Applications/EduPi.app`，仅以隔离单班数学根和本机回环模型运行。新合成任务 `teacher-task-faaf2949-951a-4547-a038-472e8de302d3` 的同一通知 attempt `1a7f220d-9466-42b9-b6a2-779244f3259c` 持久账本为一次 `claimed → delivered → opened`，教师亲点后原生 URL 精确指向该任务；一条合成续聊由 Core 捕获并在 Pi/绑定文件回读，离开重进和冷启动后仍是 Session `01a130a0-4d09-73b8-b12b-9297fa780431`，无重投递、无额外模型调用。旧通知点击只打开工作区，不计入新尝试。

仍两次观察到短暂“本地 Pi Agent 服务的连接已断开”横幅并自行恢复，尚无失败瞬间诊断，不能宣称冷启动连接体验已修复；TCC/旧客户端真正更新、真睡眠、真人内容与 Windows/Linux 教师流程也未验。Release `410117571` 保持 Draft，公开 feed `.56` 七键未变。测试 App/模型退出后恢复唯一公开 `.56`，严格签名/Gatekeeper/程序摘要通过，受保护真实资料前后各 167 文件仅既有飞书错误日志变化；按用户要求删除本地 `.64` DMG 223 MiB 与测试 App 942 MiB。[证据与边界](../acceptance/2026-10-05-pi1-a1-risk-verification.md#2026-10-12-v0364-安装版定向通知点击与重启复验)。

## 2026-10-12 v0.3.64 历史安装快照：续聊与重启保留

固定 Core `b12b5cb` 的同一签名 `.64` 安装版，在单班数学隔离根内补验应用内到期事项“继续聊”：首次本机模型服务缺席时 Core 实报降级，Pi 未收到消息，原草稿和持久 intent 保留；恢复模型、明确重连 Core 后，核对旧请求无 Pi/outbox，再放弃并只发一次新请求，Core 捕获、Pi 一条 user/assistant、模型一次调用、任务 Session 绑定均回读。离开重进和真正 App 冷启动后返回同一 Session，模型未额外调用。已采用的合成 ICS 在重启后的日程详情仍显示原日期、13:00–14:00、Asia/Shanghai 与已确认。**系统通知只实际投递，未取得点击回执**；App 管理 TCC、旧客户端原位升级、跨到期睡眠、真人质量和 Windows/Linux 完整教师流程仍缺证，Release `410117571` 保持 Draft，公开 feed `.56` 不变。隔离 App/模型已退出，原签名公开 `.56` 恢复并通过 Gatekeeper，受保护资料只变既有错误日志；本地 `.64` 测试 App/DMG 约 1.1 GiB 已清理。[逐项证据](../acceptance/2026-10-05-pi1-a1-risk-verification.md#2026-10-12-v0364-安装版任务续聊恢复与日程重启回读)。

## 2026-10-12 v0.3.64 历史签名 Draft 与安装版部分验收

Desktop [#342](https://github.com/PIGU-PPPgu/edupi-desktop/pull/342) 合入 `main` `7ea73fa2`；精确 Core 为 `b12b5cb`。[run 38199564546](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/38199564546) attempt 1 的 Mac/Windows/Linux、Release 和同轮资产证明均成功，9 资产指纹 `sha256:f425a4f3ea28f577af33320b46c20ff6ed773dfaf10daa85bdbbe13e1cc81254`。Apple 公证 Accepted；最终 DMG 资产 `632644912` 的本机整包 SHA-256 `891ede70b826f61fe291a45bb7eab78f76917377aede57127839008c55ba83c0`、镜像 CRC、App/DMG 严格签名和 Gatekeeper 通过。manifest/publish 按 Draft 设计跳过，Release `410117571` 未发布、feed 仍公开 `.56` 七键。

唯一 `/Applications/EduPi.app` 当前暂装 `.64` 供隔离验收，公开签名 `.56` 原包保留在任务检查点，结束后须恢复并清理本地包。单班合成根的两次原生冷启动到达主界面且 Core `ready`/`b12b5cb`，没有观察到错误断连横幅；一个真实 `teacher_created` 到期任务系统通知已在后台 `claimed → delivered` 一次。**教师点击后精确任务续聊/账本 `opened`、旧客户端原位更新与 App 管理 TCC、真实跨到期睡眠、真人教学质量、Windows/Linux 完整教师流程尚未通过**，因此不发布或更新 feed。[逐项证据](../acceptance/2026-10-05-pi1-a1-risk-verification.md#2026-10-12-v0364-三平台签名-draft-与-macos-通知待点击)。

## 2026-10-12 v0.3.64 历史构建前门

`.64` 源码现精确固定 Core `b12b5cb`/新 Runtime schema 与 Core 组件清单；Desktop manifest、Bridge 12 命令和 Pi/PiDurable 1.0.2 不变。修复冷启动用较慢 `/api/home` 判断本地服务离线的路径，并为新 Core 的完整来源验证设置逐层有界通知时限，原生通知证明移出 Tauri UI 线程。配对单测、全量 2354 通过/11 跳过/0 失败、类型/lint、高危审计、锁定 Cargo metadata、暂存 Core 13,300 文件、Cargo check 与 58 项库测试已过；原生实际任务通知、安装版横幅复验和三平台同轮签名 **尚未执行**。详细边界见[唯一账本](../acceptance/2026-10-05-pi1-a1-risk-verification.md#2026-10-12-v0364-core-b12-配对与真实提醒证明源码门)。`.63` Draft `409693213` 不重复构建或公开；公开安装与七键 feed 仍 `.56`。只有 PR/CI 及新的 `.64` Draft/安装门通过后，再决定发布，不用源码门替代原位升级、睡眠、TCC 和真人教学质量。

## 2026-10-12 v0.3.63 诊断通知点击复验

同一签名 Draft `.63` 在唯一安装路径和隔离数据根重测一次系统通知。设置页显示授权已开启，原生测试通知被系统接受；教师亲自点击并确认自动进入提醒收件箱。Codex 随后只看到同一安装进程已切至“学情观察”，没有截到过渡画面；这是教师现场确认的**无目标诊断通知**，不是对应真实任务的后台通知→点击续聊证明。该缺口和真实睡眠、旧客户端 updater 原位安装、真人教学质量、完整 Windows/Linux 流程、App 管理 TCC、偶发断连横幅根因继续保留在[唯一账本](../acceptance/2026-10-05-pi1-a1-risk-verification.md#2026-10-12-v0363-诊断通知人工点击复验)。测试后严格签名/Gatekeeper 核对公开 `.56` 并恢复为唯一安装版；受保护真实资料前后各 167 文件，仅既有飞书错误日志变化；本地测试 App 942 MiB 和 DMG 223 MiB 已删除。Release `409693213` 不发布，公开 feed 仍 `.56` 七键。

## 2026-10-12 v0.3.63 同轮签名 Draft 与安装门

- `.63` 精确源码 `6c297884`/Core `6b0f2a2` 的 [run 38144208051](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/38144208051) attempt 3 在 macOS/Windows/Linux 与 `draft-proof` 全绿，9 资产指纹 `sha256:a45e331c042164c6f45f004805dc995db67de151e87dc1511cc1feaf405c84a0`，Apple 公证 Accepted；Release `409693213` 仍 Draft，manifest/feed 未更新。前两次失败与同轮资产门原因见[唯一账本](../acceptance/2026-10-05-pi1-a1-risk-verification.md#2026-10-12-v0363-三平台-draft-与-macos-安装版续聊安全模式)。
- 最终 Mac DMG 本机摘要、镜像 CRC、签名/Gatekeeper、包内 Core 身份通过。唯一安装版用合成根完成任务首次发送、Pi 单次落盘/绑定、离开重进、Safe Mode 与恢复正常的资源过滤及持久化；G1 attempt 和反馈未重做。合成 ICS 在原生预览后由教师明确采用，材料、日程、Core 和磁盘各回读 1 条，采用后 App 重启保留尚未验。设置页通知为已开启、诊断通知被系统接受，但点击返回待用户确认。真实睡眠、真人内容、旧客户端实际升级和 Windows/Linux 完整教师流程继续未验；安装期间偶发本地连接横幅未定位。故不发布 Release、不更新七键 feed。隔离进程已退出、公开签名 `.56` 恢复并核对真实资料；本地 DMG 223 MiB 与测试 App 942 MiB 均已清理。

## 2026-10-11 v0.3.62 已拒绝发布，v0.3.63 待签名

- 同资产 `.62` 二次 macOS 隔离安装揭出任务内首次发送的草稿键错位，以及 Safe Mode 模型/Skill 读取接口仍执行第三方扩展；两项均有原生 UI、私有会话/模型计数与合成扩展标记证据。[逐项记录](../acceptance/2026-10-05-pi1-a1-risk-verification.md#2026-10-11-v0362-二次安装复验发现发布阻断)。`.62` 不能发布，旧客户端升级门也不能在此版本结案。
- `.63` 源码补了同一草稿键、任务工作区预校验及两个 Safe Mode 读路径；已同步 Core `main` [#278](https://github.com/PIGU-PPPgu/edupi/pull/278) 的精确 `6b0f2a2` pin。该 Core 的合同/打包 15/15、完整 2348 通过、11 跳过、0 失败，隔离开发 API 不再执行合成第三方扩展。这不等于新签名安装通过。已恢复唯一公开 `.56` 并删除本地 `.62` App/DMG 约 1.1 GiB；远端 `.62` Release 保持 Draft，feed 仍 `.56` 七键。需在精确 `.63` 源码/CI/签名 Draft 后重新安装验收，再谈发布。

## 2026-10-11 v0.3.62 安装版部分验收

- 唯一 `/Applications/EduPi.app` 已实际安装签名 `.62` 并以隔离根冷启动；原生 UI、Core/投影身份、单班数学 G1 的一次合成草稿、四产物、人工接受与合成反馈写回及重读通过。测试夹具首次缺模型 `reasoning` 布尔值导致激活失败，补齐夹具后通过，未改真实模型配置。任务续聊、安全模式、TCC/通知点击、真实跨到期睡眠、真人内容质量和旧客户端原位升级仍未验；原生工具在继续时再次实报锁屏，不能以签名或 API 检查替代。
- 已退出本轮隔离进程、恢复唯一公开 `.56`，严格签名/Gatekeeper 通过。真实业务和模型/认证文件前后相同，仅既有飞书错误日志变化。按用户要求删除本地 `.62` 测试 App 与 DMG 下载，约 1.1 GiB；远端九资产 Draft `409161380` 仍在。公开 feed 保持 `.56` 七键，未发布、未更新 manifest。[实际证据和未验边界](../acceptance/2026-10-05-pi1-a1-risk-verification.md#2026-10-11-v0362-macos-安装版部分验收与回退)。下节“锁屏前未安装、保留 DMG”是先前阶段快照，已由本节取代。

## 2026-10-11 v0.3.62 签名 Draft 已过构建门

- 精确源码 `7848c112`/Core `2ecf3465` 的 [三平台 Draft run 38080377311](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/38080377311) 和 `draft-proof` 成功；Release `409161380` 仍 Draft，共 9 资产，候选集合指纹 `sha256:e61bc0aca3bb3720e683f876a4cfa91d80fbe339ad2dee4536bf92bd0cb03da7`。Mac 公证 `Accepted` 并装订复核；Windows 新安装器隔离 Safe Mode/Core 默认关闭烟测通过。最终 DMG 本机下载 SHA-256 `46e364f39c10094311336ef637dfcaf93dcfaeb38b151543b09845fdad19c132`、App/DMG 签名/Gatekeeper/包内 Core 身份通过；四种 updater 载荷用公开 `.56` 公钥独立验签且篡改拒绝。预生成 manifest 为 7 键且 API URL；这不等于已发布 feed。
- Mac 当前经原生工具实测锁屏，未进行唯一安装路径的 `.62` 替换、TCC、真实睡眠或教师内容验收；已请求手动解锁一次。公开 `/Applications/EduPi.app`/feed 仍 `.56`，Release 不发布，manifest/publish job 按设计跳过。完成隔离安装与旧客户端升级前，候选指纹不能当作接受指纹。[详细证据与恢复入口](../acceptance/2026-10-05-pi1-a1-risk-verification.md#2026-10-11-v0362-三平台签名-draft-与安装门)。

## 2026-10-11 v0.3.62 新 Core 配对准备记录

- `.61` 旧 Core 安装器的精确 Windows 重查 run `38078453311` 已在隔离 runner 通过普通模式拒绝和 Safe Mode Core/投影 ready、G1 默认关闭、外发关闭；它不修复原三平台 Draft run 的 macOS 暂存请求失败，也不生成缺少的 Mac/Linux 资产。Release `409082688` 仍 Draft、公开 `.56` 与 feed 不变。
- `.62` 在原 Desktop 分支消费 Core `main` `2ecf3465` 的 R03 Stage 1 静止准入证明和双组件清单；Runtime schema、Bridge/课次合同和 Pi/PiDurable 1.0.2 不变。当时精确 Core 配对的全量测试、主动消息 canary、DOCX/日程/ICS 及暂存包服务均通过，证据见唯一账本；Core retention stress skipped。本段仅记录签名前的准备，不取代上节已完成的签名 Draft，也不把正式 App/教师流程计为通过。

## 2026-10-11 v0.3.61 失败追查历史

- `.61` [Draft run 38070153404](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/38070153404) 仅有一次同源码重试：macOS 先后在暂存日程 GET 的 `ECONNRESET`、教师上下文 POST 的 15 秒超时失败；Windows 安装烟测普通模式通过，隔离 Safe Mode 未在 90 秒内取得 Core ready；Linux 取消。Draft `409082688` 只留精确 Windows NSIS 与 `.sig` 两项资产，未形成七平台 manifest 或 Apple 公证，不发布、不更新 feed。
- 在 Core #277 合入前，`.62` 的诊断草案曾沿用旧 Core `57093b`，只给失败处加脱敏诊断并把单次写入请求截止从 15 秒调为 45 秒，不重试未知写入。该旧 pin 草案已被上节精确 `2ecf3465` 配对取代，不能据此构建 `.62`。
- 随后以手动 Windows Draft 烟测重查 `.61` 已上传的精确 NSIS，先核对 Release/源码 SHA/资产 ID/摘要；该测试不重建、不发布，不补齐 `.61` 的 macOS/Linux 资产与发布门。
- 首次重查 run `38075606044` 读取 Draft 元数据被仓库只读 `GITHUB_TOKEN` 以 403 拒绝，未下载安装器。GitHub Draft 需要推送身份；后续工作流仅在 GET/download 步骤使用 `contents: write` 内置令牌，checkout 禁止持久化凭据。用户剪贴板令牌试读为 401，未保存。
- 第二次 run `38076259913` 核对安装器后，Safe Mode 被原生源码链 `native_source_acl_untrusted` 拒绝；当时验收安装根位于 runner 共享临时目录。脚本随后改为在用户目录先创建私有 ACL 安装根，未放宽原生守卫。
- 第三次 run `38076862511` 的 ACL 错误消失，Node 子进程存在但未取得 Core ready；第四次 run `38077495232` 确认该子进程有回环监听 socket，短超时状态请求仍无应答。脚本最终改为 120 秒有界观察、先读服务身份、最多两次充分等待的 Core 状态请求；其正向结果只见上节 run `38078453311`，不能追认这些失败 run。

## 2026-10-10 v0.3.58 Draft 配对检查失败

- 源码 `e7d8fa0a` 的 [Draft run 38058904150](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/38058904150) 在 macOS/Linux 的配对 Core canary 失败：隔离夹具缺少模型配置，G1 激活返回 503；补齐合成模型后，旧消息入口又按新注册回执合同返回 `registered_prompt_required`。Core 的权限门没有放宽。该 Draft 已确定无法过门，已请求取消尚在运行的 Windows job，避免继续消耗 Actions 时长；取消请求不算 Windows 验收结果。
- canary 已在原工作分支改为注册后捕获、旧入口拒写、去重、越界不生成任务的配对检查；本机固定 Core `57093b` 验证通过。`.58` Draft `408993261` 保持草稿，失败资产不发布、feed 不变。修复进入新的 `.59` 候选，签名和安装结果另记，不沿用 `.58` 构建身份。

## 2026-10-10 Core 57093b 迁仓阶段记录

只读 `EDUPI_CORE_READ_TOKEN` 已更新到迁仓后的 Desktop Actions Secret；`.57` Draft `408319110` 的 0 资产失败保留历史，不用旧 pin 重试。当时开发分支固定 Core `57093b` 并增加发送前 intent、持久消息 outbox、G2/DOCX 消费；现行 `.62` 固定 `2ecf3465`，见本文顶部。`.58`–`.61` Draft 均未过发布门。发送点击后到 intent 落盘前的瞬时崩溃跨端口草稿仍缺恢复证据，不能称“零丢失”。新候选仍须绑定精确源码，通过三平台资产/摘要、Apple 签名公证、安装版双系统隔离验收后，再决定 Release/feed。公开 `.56` 与唯一安装应用保持不变。

## 2026-10-11 v0.3.60 Draft DOCX 检查失败

- [run 38067260599](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/38067260599) 绑定合并源码 `8096141f`；macOS/Linux 的注册消息与新校历 E2 已通过，随后 `test-edupi-document-revision-e2.mjs:334` 仍要求首次 DOCX 接入自动返回 `documentCommitted:true`，与 Core 的“文件接入、待审提案、明确采用”合同不符。Windows job 和后续证明步骤已取消，Draft `409060125` 为 0 资产，未签名发布或更新 feed。
- 本机固定 Core `57093b` 的脚本已改为验证首次材料只接入、时区缺失保持待审、明确时区材料经私有 `material_schedule_read/apply` 采用、已有来源的显式修订/重放和删除恢复；原失败处及整脚本退出 0。随后完整执行 Release 的剩余配对 Core 脚本和包闭包测试，均通过。修复进入新的 `.61`，不重试旧 `.60` 提交。

## 2026-10-10 v0.3.59 Draft 校历检查失败

- PR [#332](https://github.com/PIGU-PPPgu/edupi-desktop/pull/332) 已合并为 `7b2ce08f`；[Draft run 38063894602](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/38063894602) 的 macOS 配对 Core canary 已通过，随后上传校历 E2 在 `calendarCommitted` 旧断言失败，Linux 同步失败，Windows 在继续打包前已请求取消以节省额度。该 Draft 不发布、不更新 feed，不能把 canary 通过当成全平台签名完成。
- Core 当前合同把接收 ICS 文件与采用其中事项分开；旧 E2 要求首次上传自动写入，既与安全边界相悖也未覆盖 UI 采用路径。`.60` 在原分支增加桌面授权的预览指纹和教师明确确认，默认仅接入材料；本机精确 Core 的上传、错误指纹拒绝、首次导入、更新/撤回/重放及重启回读通过。源码和页面证据不替代新签名包安装。

## 2026-10-10 v0.3.57 Draft 构建阻塞

- [run 37987228603](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/37987228603) 的 Release 准备成功，但三平台 build 均在私有 Core checkout 的 HTTPS 403 失败；Draft Release `408319110` 仍为 0 资产。Apple 签名、公证、Windows/Linux 安装包和 `draft-proof` 未执行，不计三平台通过。
- 迁仓后的旧 Core 读取 token 不再有访问 `PIGU-PPPgu/edupi` 的权限；新范围仅限该私有仓库的只读凭据到位后，保持源码 `7faa74fd`、版本 `.57` 和现有 Draft 不变，先有界重试失败 job，再核对资产/签名与安装安全门。公开 `.56` Release/feed 与唯一已安装 `.56` 保持原状，绝不手动发布 0 资产 Draft。

## 2026-10-10 v0.3.57 发布准备

- 公开 v0.3.56、七键 feed 和已安装应用保持不变。迁仓后新 Raw feed 和 Release/API 路径可读；新客户端将新 Raw 地址置首位并保留旧地址为迁移回退。
- v0.3.57 源码 `c1b9241b` 已配对 Core `75d6d666ac9910166638c3ec6df2a03f1075bd43`，版本、Cargo 锁定文件、组件清单和发布说明已准备；[PR #330 CI](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/37985942722) 的 audit/rust-audit 已通过，审阅讨论和合并待完成。三平台签名 Draft、Apple 公证/装订、资产摘要及安装验收尚未取得结果，不公开 Release 或更新 feed。
- 本轮高危 npm 审计通过，仍有 6 低/3 中。真实通知/TCC、跨到期系统睡眠、真人教学质量与 Windows/Linux 安装不能由 Core 或 Desktop 源码测试代验。

## 2026-10-07 v0.3.56 正式发布

- 用户明确授权补齐三平台构建并发布，安装验收后置。本节取代下方候选“不发布/Windows构建延期”的对应状态，不把安装、真实睡眠、教学质量或六领域Live计为通过。
- 精确源码`6d8e696995040a2dd0191f178460dae5b24f7d99`的[全平台构建37521682413](https://github.com/Intellinfinity/edupi-desktop/actions/runs/37521682413)与[发布37527490223](https://github.com/Intellinfinity/edupi-desktop/actions/runs/37527490223)成功；原三平台、资产身份、签名/公证和原子feed发布门保留。资产身份`sha256:cf3594cc12877aee7928c44588b2828e04787953a79318ac28d5f332064f2d0f`为授权发布指纹，不是安装验收证明。
- [v0.3.56](https://github.com/Intellinfinity/edupi-desktop/releases/tag/v0.3.56)已为Latest、非Draft/预发布，共11资产；公开Raw版本`.56`、七平台键。四种API路径匿名返回二进制，九个完整下载摘要一致，四份更新签名匹配旧Mac客户端公钥，篡改均拒绝。新DMG本机签名/Gatekeeper通过；SHA256为`c8c7bee8239f99b02613c905355350f2abd382c5b25d58d3bd533fc47951519a`。
- 仅notes字段修正旧Mac-only文字，签名资产与下载映射不变。完整旧Mac检查点保留，新证据在`~/edupi-install-checkpoints/v0.3.56-publish`，详见[唯一验收记录](../acceptance/2026-10-05-pi1-a1-risk-verification.md#2026-10-07-v0356-三平台正式发布)。正式App仍`.45`；原生工具实际锁屏，界面检测及升级未验，不操作安装或教师数据。

## 2026-10-07 v0.3.56 MCP 修复候选

- `.55`构建成功后新披露MCP高危，最小修复固定OpenConnector client2.2.0和配套私有core2.2.0；server未受该公告影响，不为审计强行整体升级。现有目录/Console没有SDK OAuth provider路径，不清空用户连接或改凭据。高危门重新清零，另6低/3中仍保留。
- 安全组7/7，实际withMcpClient内存HTTP现代发现与工具调用通过；全量1983 pass、27 skipped、0 fail，类型/lint、版本/发布42检查、locked metadata与组件pin检查通过。源码`6d8e696995040a2dd0191f178460dae5b24f7d99`的CI`37509377920`双绿，PR [#312](https://github.com/Intellinfinity/edupi-desktop/pull/312)合并为`1400ede8a842957879d3867dfc167e630739be59`。
- macOS-only [run 37509562059](https://github.com/Intellinfinity/edupi-desktop/actions/runs/37509562059)成功，Draft`405013321`、tag`v0.3.56`固定该源码，Core仍`a84590c`/SDK1.0.2。CI质量1982 pass、28 skipped、0 fail；公证Accepted、装订、App/DMG严格签名、Gatekeeper、包内服务与updater公钥检查通过。跳过项不计验收。
- DMG asset`616378660`，209185115字节，SHA256`e3cb98da3fceca9021d3b8317ac7bababef01a7bb6e55254f67c5a3b1c19fd02`，本机完整下载精确匹配。只读挂载验证App/DMG签名/Gatekeeper、Core文件闭包/SDK和补丁版本通过：MCPclient/core2.2.0、sharp0.35.5、source-map-js1.2.2确实在包内；签名团队与公开版相同。镜像已卸载，未启动或安装候选。
- 文件位于`~/edupi-install-checkpoints/v0.3.56/EduPi_0.3.56_aarch64.dmg`，原始构建、摘要与身份记录同目录`evidence`。本机stapler旧TLS与updater安装验签继续未验；`.55`不可变检查点、正式`.45`、公开Release/feed及其他平台边界保持。最终npm高危门再次通过，余6低/3中，不称零风险。

## 2026-10-07 v0.3.55 macOS 候选

- 构建后风险复核新增MCP客户端高危[GHSA-6qxp-vccf-f47h](https://github.com/advisories/GHSA-6qxp-vccf-f47h)，来自OpenConnector的client2.1.0；`.55`在审计数据更新前通过构建门。`.55`资产作为签名/下载检查点保留，不发布，补丁采用新候选版本，不覆盖既有资产。
- 用户要求在当前风险修复后开始Mac构建。元数据/组件版本与Cargo锁定更新至`.55`，Core仍精确`a84590c`、Pi/PiDurable1.0.2；包含已合并任务卡/文件右栏和sharp0.35.5补丁。版本/发布42检查、locked metadata、组件pin和高危审计通过，余6低危/3中危继续记录。
- 源码`d3107c4b3686ef0fec5b506124269d21e88a02e2`的CI`37498670567`双绿，PR [#310](https://github.com/Intellinfinity/edupi-desktop/pull/310)合并为`1a7fa48cd89300ef4740ecfff5427cf7f2bd1470`。macOS-only [run 37498750385](https://github.com/Intellinfinity/edupi-desktop/actions/runs/37498750385)成功，Draft`404950486`与tag`v0.3.55`绑定该源码；Apple公证Accepted、装订、App/DMG签名与Gatekeeper检查全通过。CI全量1981 pass、28 skipped、0 fail，跳过项不计安装验收。
- 最终DMG asset`616184804`，209005219字节，SHA256`9fdd3e46d8bc3ad49533eb7d0744e9d76facbfbc119643a9523f740b11bf077a`；本机完整摘要、DMG与App严格签名/Gatekeeper、包内Core/SDK/文件闭包通过，sharp0.35.5及source-map-js1.2.2确实进入包内。候选与公开版签名团队一致，只读挂载后已卸载。文件位于`~/edupi-install-checkpoints/v0.3.55/EduPi_0.3.55_aarch64.dmg`。
- 首轮分片下载只有1个分片未完成，其他9个完整分片保留并复用，补齐后才核对完整摘要。CI与下载/身份原件保留在同目录`evidence`。本机stapler旧TLS边界未重复验证，App archive/sig的本机updater安装验签仍未执行。
- 仅构建候选，不替换正式`.45`、不覆盖`.54`检查点、不发布Release或更新feed。新UI安装、真实睡眠、真人质量和其他平台仍分别待验。恢复入口为`~/edupi-install-checkpoints/v0.3.55/RESUME.md`。

## 2026-10-06 v0.3.54 构建完成

- 签名run `37408179317` 成功，Draft `404276650` 固定源码 `c861347`。最终DMG asset `614416762` 的本机完整SHA256为 `50139f5e0f42cb405d6372d4adbc708c65430f0946f9a8e8e91b77128df619b8`，与Release精确匹配；App/DMG严格签名、Gatekeeper和内嵌Core身份通过。
- CI同资产公证Accepted、装订复核通过；本机stapler旧TLS问题不计已解决。包位于 `~/edupi-install-checkpoints/v0.3.54/EduPi_0.3.54_aarch64.dmg`。仅只读挂载核验并已卸载，未安装、未发布、未更新feed。构建心跳暂停，安装/公开升级门仍分别待验。[验收记录](../acceptance/2026-10-05-pi1-a1-risk-verification.md)。

## 2026-10-06 依赖门修复后构建

- 重新授权的`.53` attempt3通过runner分配和代码检查，在source-map-js新高危审计失败；没有进入签名。更新到官方修复1.2.2后高危门通过，另6低危/3中危仍保留记录，未降低审计级别或force升级。
- 采用`.54`的macOS-only签名候选保留历史身份；本轮先完成构建和精确资产核验。正式安装、公开Release/feed和未验收门均保持，详见[验收记录](../acceptance/2026-10-05-pi1-a1-risk-verification.md)。

## 2026-10-06 安装交互继续验收

- `.52` 签名App在唯一安装路径完成隔离生成、修订/取消、暂缓只读、续聊/分叉、实际重启和安全模式恢复；恢复公开 `.45` 后真实业务及模型配置保持，具体证据见[验收账本](../acceptance/2026-10-05-pi1-a1-risk-verification.md)。
- 安装实测发现任务内fork丢失task路由，多任务归属存在风险。修复经定向回归、两任务页面、复审及CI `37363398268`，PR #302合并 `42dec58`。`.53` run `37363416800` 的attempt2于UTC20:18:07再次因GitHub未分配hosted runner失败；release准备成功，macOS编译/签名未开始，Draft `404064845`仍为0资产。按约定暂停自动重试，安装补验为外部阻塞。`.52`固定资产及公开`.45`保持，真实睡眠、真人质量、其他平台和公开更新门不据此通过。

## 2026-10-06 原生安装冷启动

- Codex 原生 computer use 实际退出公开 `.45`，`.52` 在唯一安装路径以隔离根启动；原生界面与安装服务均确认版本，Core `a84590c` bundled/ready，双清单和 schema 一致，G1/G2/G3 默认关闭。只有 1 个合成任务、0 个学生与产物，模型未调用。
- 后续原生交互再次被 Mac 锁屏阻断，未完成生成/审核/续聊、Safe Mode 和安装版重启保留。退出自有测试进程后，从公开 `.45` 官方 DMG 摘要核验、签名核验并恢复安装，Gatekeeper 接受；教师业务文件与模型配置保持。临时旧 App 副本缺文件原因未确认，现已把候选、证据与官方回退包保存到持久目录，详见[实际记录](../acceptance/2026-10-05-pi1-a1-risk-verification.md)。
- `.52` 标签检查点保留，Release 仍 Draft，公开 feed 未更新；只把冷启动与实际 Core 连接标为通过，不把部分安装操作计成完整安装验收。

## 2026-10-05 Pi 1 与审核修复候选

- Core #222 已合并为 `a84590c`，Desktop #298 已合并为 `bffbd91`；Pi/PiDurable 为 1.0.2。真实开发页面已验证暂缓审核回读、只读历史、拒写保稿、会话分叉与工具关闭后重启保持；完整分层结果见[本轮验收](../acceptance/2026-10-05-pi1-a1-risk-verification.md)。
- `.51` Draft CI `37267593584` 在最终 App CloudKit 核验时报离线错误，整次 CI 失败，本机首次下载亦中断，未安装或发布。后续修复使用新 `.52`，不覆盖 `.51` 资产。
- `.52` macOS-only Draft CI `37281905644` 绑定代码 `072f2fa` 并成功，Release `403498252` 保持 Draft。DMG asset `612017261` 本机下载摘要 `ad416f27d16cee418f0b7d80aee65e8ee5a490cdd54db025c5abb4d188316087` 匹配；App 严格签名、App/DMG Gatekeeper 与包内 Core/SDK 身份独立核验通过。本机 stapler 联网复核报 CloudKit TLS `-1200`，未计为通过；CI 同资产公证、装订及复核通过。
- 公开 App、Latest 和 raw feed 仍 `.45`。正在运行的公开实例未退出、安装路径未替换；Orca 对 EduPi 的实际访问仍报 `permission_denied`，安装交互未验。Windows 安装、真实睡眠、真人质量及公开升级继续保留，不能用签名成功补勾。

## 2026-10-04 安全补丁候选状态

- 当前源码已修复新安全审计失败，标准 npm 审计为 0 漏洞并验证实际安装及包内依赖版本；[PR #291](https://github.com/Intellinfinity/edupi-desktop/pull/291) 已合并为 `3f1c5f7`，修复提交 `6c82e87` 的 [CI 37138282482](https://github.com/Intellinfinity/edupi-desktop/actions/runs/37138282482) npm / Rust 审计、干净安装、依赖回归、全量测试及静态检查均通过。本次没有覆盖 v0.3.50 Draft 的不可变资产，未生成新签名版本，正式安装与公开 feed 仍 v0.3.45。下一次签名构建须使用新版本号和本轮修复提交，不能复用旧 .50 公证证据。

## 2026-09-29 v0.3.50 候选准备

- v0.3.50 macOS 签名 Draft CI `36574120908` 绑定 `acecf26` 并成功，最终 DMG 摘要、严格签名与 Gatekeeper 独立通过；PR #287 已合并。唯一安装路径已实测审核刷新、反馈、重启保留、系统通知点击续聊和后台跨日期到期执行去重。夜间未取得真实跨到期 Sleep/Wake 证据，睡眠项未通过；已正常退出候选并恢复公开 v0.3.45，151 文件摘要保持。Release `399167693` 仍 Draft，公开 feed 不变；仅构建 macOS，三平台资产证明、其他系统及真人价值未补验。

## 2026-09-29 v0.3.49 Draft 验收后恢复正式版

- 已独立验证 0.3.49 Draft DMG SHA、严格签名、Gatekeeper 与 CI 公证装订，并在唯一正式安装路径做隔离验收；签名版的站内续聊、暂缓审核、synthetic 反馈和重启保留通过。系统通知点击、跨到期实睡、Windows Safe Mode 与最终发布门未通过，Release/PR 保持 Draft，公开 feed 仍 0.3.45。
- 验收收口后已退出隔离 App 与本机模型桩，将 `/Applications/EduPi.app` 恢复为原公开签名 v0.3.45，唯一副本签名/Gatekeeper 再核通过；签名候选资产和隔离测试证据可恢复，真实教师根/配置 9 项摘要不变。下方临时安装 0.3.49 的段落是中间状态。

## 2026-09-29 v0.3.49 签名 Draft（安装验收仍开放）

- [run 36525542297](https://github.com/Intellinfinity/edupi-desktop/actions/runs/36525542297) 三平台签名构建和 macOS 公证装订成功，9 项资产指纹 `sha256:7abe22c7f0351e2c321097a21fa419210d50266af81b6315eda1a7afb1937dd9`；DMG 下载摘要、App/DMG Gatekeeper 与 App 严格签名核验通过。本机 stapler 因 CloudKit TLS `-1200` 无结论。唯一正式安装路径临时为 0.3.49，旧 0.3.45 已独立备份；公开 feed 仍 0.3.45，Release/PR 均 Draft，不发布。
- 正式安装版单班内部草稿和站内续聊已部分验收，但签名版价值反馈、系统通知真实点击、跨到期真实睡眠，以及 Windows Safe Mode 正向安装未通过。Windows [预览 36525434938](https://github.com/Intellinfinity/edupi-desktop/actions/runs/36525434938) 失败，不把签名构建全绿替代安装运行证据。
- 后续签名版价值反馈已实际写入 Core 且只计 synthetic，退出重启后原会话、草稿和反馈保持；上条“价值反馈未通过”是中间状态。系统通知点击、跨到期实睡、Windows Safe Mode 正向安装和发布仍未通过，不能更新 feed。

## 2026-09-29 v0.3.49 路线 1 候选（尚未签名发布）

- 精确 Core pin 为 `22bf414`；未签名 macOS 隔离 `.app` 已完成任务审核及合成反馈写回，且修复隔离反馈必须标记 synthetic 的服务端边界。旧一次错误标记只在隔离测试根保留为失败证据。
- 正式 `/Applications/EduPi.app` 与公开 updater feed 仍为 v0.3.45。#287 为 Draft，预览 `36440865994` 的 Windows 安装脚本未通过；v0.3.49 尚无签名 Draft、Apple 公证/装订、正式安装或公开更新，不能承接 v0.3.48 已否决的安装证据。用户目前优先 macOS 路线 1，Windows 安装验收延期但未取消。

## 2026-09-27 v0.3.46 发布暂停（最新状态）

- Core #204 的范围/预算和 Desktop #285 的默认关闭/精确 pin 已合并；最终预览 CI `36296800201` 全绿。Core #205 的 Windows 只读探针已合并，但 G1 仍正确拒绝 `native_attestation_required`，正式发布不能把此项视为通过。
- Core #207 的旧授权租约安全栅栏已合并，但 Desktop 仍 pin #204 的 `3397b71`，未包含 #207。等 Windows 完整根证明后一次性更新 pin 与两份组件清单，不用旧 Draft 资产发布。
- Core #206 已合并 `a595f5a`，只增加 Windows 隔离根/SQLite 侧文件证据和 `pending` 非执行资产合同；`native_attestation_required` 与 G1 关闭未变。该 PR 不是正式安装或发布门通过，Desktop pin 暂不移动。
- 正式 run [`36298536318`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/36298536318) 已取消，manifest/notify job 未发布；[v0.3.46 Release](https://github.com/Intellinfinity/edupi-desktop/releases/tag/v0.3.46) 仍为 Draft，仅 4 个 Linux 资产。公开 updater feed 和唯一 `/Applications/EduPi.app` 保持 v0.3.45；v0.3.46 尚无 Apple 公证、7 键 feed 或正式安装版验收。待 Windows 完整根证明、安全复审、Core/Desktop 重新配对后再正式构建，不沿用已取消 run 的残留资产作为完成证据。
- 下一候选不能复用旧 v0.3.46 Draft：它绑定 Desktop `38d8c95`，而新 Core pin 与安全/发布门代码将产生新提交。保留 Draft 作失败记录，后续递增版本创建新 Draft；正式 workflow 改为 `draft` 构建和 `publish` 发布两次显式 dispatch，安装验收前不会自动更新公开 feed。

## 2026-09-27 v0.3.46 路线 1 正式版候选（未发布）

- 安全重检发现候选 Core a8 的 G1 没有强制单班单科授权，旧 Desktop 还无条件注入 G1 Live；已有本地门禁与旧 canary 不能证明发布安全。PR #285 已转 Draft，预览 run `36270079017` 已取消。默认关闭 G1、Core 精确授权/来源/耐久预算、重新固定 Core 组件清单和三平台 CI 均待完成；Release、Apple 公证、公开资产、feed 和正式 App 更新均未执行，不得继承 v0.3.45 的证据。Windows G1 仍保持 `native_attestation_required`。
- 2026-09-27 更新：Core [#204](https://github.com/Intellinfinity/edupi/pull/204) 与其 quality CI 已通过并合入 `3397b71`。Desktop 候选 pin 与 Runtime schema/两份组件清单已精确配对；本地 staged Core/投影 ready、G1 默认 pending，隔离包内单班草稿与通知失败链路通过。v0.3.46 仍未发布，PR #285 的最终 CI、Apple 公证、公开资产、feed 与唯一正式 App 验收未执行；Windows 原生盘证明依旧未交付。
- 教师要求以后只用正式版验收。正式 Release 后在 Mac 上顺序使用唯一 `/Applications/EduPi.app`，先备份并记录教师数据/模型配置，再核对更新验签、版本、Core 身份、真实提醒点击和数据保留；不另开同图标 canary，不把预览 CI 视作安装版通过。

## 2026-09-26 路线 1 隔离 canary（未发布）

- 用户指定后续只验收正式签名/公证安装版。两份临时 canary 进程已退出，本机模型桩停止，测试通知权限恢复关闭；正式 v0.3.45 没有因 #281 合并而自动更新，未进行路线 1 的正式版安装。以下 canary 结果只作开发证据，下一正式 Release 的通知点击、睡眠恢复和数据保留须重新逐项验证。
- Desktop [#281](https://github.com/Intellinfinity/edupi-desktop/pull/281) 已合并为 `d80bb12934c2805eb14eff57021d42e22f16be07`；这是源码合并，不是 v0.3.45 之后的新正式签名发布、Apple 公证或应用内升级。路线 1 的真实跨到期系统睡眠、通知成功点击和 Windows G1 仍待验。
- 追加的本地 `EduPi Route1 Notify Canary` 使用 Developer ID 对测试 `.app` 及嵌套 helper 签名，严格校验通过；macOS 只对该 bundle ID 授予通知，签名 canary 关窗后台有两次原生 API 送达并回读。它没有公证/装订，也没有公开安装或覆盖正式 App；横幅显示、系统点击和教师实际操作仍未验，不能归入正式发布验收。
- Core `a8fe471` 配对的 `com.abcwyc.pi-agent.route1-canary` `.app` 使用 `--no-sign` 构建，仅复制到 `/tmp` 独立安装目录并用隔离教师根运行。它验证的是本地安装版进程和 Core/提醒/续聊路径，**没有** Apple 公证、公开 Release 或旧版升级；不能继承下方 v0.3.45 正式版的公证结论。[最终预览 CI 36232143818](https://github.com/Intellinfinity/edupi-desktop/actions/runs/36232143818) 在恢复修复后的 `02781cb` 构建 macOS/Windows 包并在 Windows runner 隔离安装及二次启动，三个 job 全绿；Core 明确拒绝 `native_attestation_required`，不算 Windows G1 验收。逐项结果见 [路线 1 验收](../acceptance/2026-09-26-route1-core-a8fe471-installed-loop.md)。
- `71e32de` 后重新构建并复制到 `/tmp/edupi-route1-final.Aavckr/Applications/` 的独立 `.app` 已从 LaunchServices 启动，内置 Core `ready`、G1 `active`，原生菜单栏点击恢复同一 PID；staged 与 bundle 资源的隔离闭环均返回 4 个草稿、1 次模型调用、失败去重、synthetic 排除和重启保留。该 canary 仍是未签名、未公证、未公开的测试版；没有执行正式安装覆盖或旧版升级。系统锁屏后通知权限、系统通知成功点击和跨到期实睡未验。

## 2026-09-26 v0.3.45 公开签名版与本机原位升级

- [三平台正式 run 36190180285](https://github.com/Intellinfinity/edupi-desktop/actions/runs/36190180285) 及 Apple 公证装订全绿；[Release v0.3.45](https://github.com/Intellinfinity/edupi-desktop/releases/tag/v0.3.45) 非草稿、11 项资产、七个带签名 updater 平台键，Raw feed 为 0.3.45。Linux [公网安装](https://github.com/Intellinfinity/edupi-desktop/actions/runs/36194964574) 与 Windows [公网安装/诊断](https://github.com/Intellinfinity/edupi-desktop/actions/runs/36197070379) 通过。公开 DMG 摘要与 Release 相同，严格签名和应用/镜像 Gatekeeper 为 `Notarized Developer ID`；本机 stapler 因 CloudKit TLS `-1200` 无结论，不覆盖 runner 的装订成功。
- 本机唯一安装副本从 v0.3.44 在设置页检测到 v0.3.45，经下载、安装、自动重启变为 v0.3.45；Core/投影/Kernel ready、Core `86a49de`、51 学生/160 任务/24 校历/6 课表、五份配置摘要和 7897 更新代理保持。官方 OpenConnector Console 独立原生窗口四页、403 阻断、768×846 半屏服务/参数交互均已操作；Windows/Linux UI 点击另记未验。详情见 [官方 Console 验收](../acceptance/2026-09-26-openconnector-official-console.md)。

## 2026-09-25 v0.3.43 公开签名版与本机更新边界

- [#272](https://github.com/Intellinfinity/edupi-desktop/pull/272) 的管理与设置归位已进入公开 v0.3.43。正式 run [`36125163938`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/36125163938) 三平台、Apple 公证装订及 7 键 feed 全绿；Release 非草稿、11 项资产。Linux [`36130963967`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/36130963967) 与 Windows [`36130964060`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/36130964060) 的公开安装和后置诊断均通过。公开 DMG 经 API/7897 独立下载后摘要与 Release 一致，严格签名及应用/镜像 Gatekeeper 公证通过。
- 本机唯一 EduPi 仍为 v0.3.42，Core #191、51/240/43/9 和五份配置摘要已记录，并有可回退应用副本。Mac 锁屏时桌面控制因实体输入暂停，已请求教师手动解锁；未执行 0.3.42→0.3.43 应用内升级，不能把源码预览当作签名安装版视觉验收。详见 [v0.3.43 验收](../acceptance/2026-09-25-v0.3.43-signed-release.md)。

## 2026-09-25 v0.3.42 公开签名版与本机原位升级

- Desktop [#270](https://github.com/Intellinfinity/edupi-desktop/pull/270) 与 [#271](https://github.com/Intellinfinity/edupi-desktop/pull/271) 已合并。正式 run [`36110749260`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/36110749260) 三平台及 manifest 全绿，Release v0.3.42 非草稿、11 项资产、7 个带签名平台键。Apple runner 公证/装订与 Gatekeeper 通过；本机独立下载公开 DMG 摘要一致、严格签名与 Gatekeeper 公证通过。本机 `stapler validate` 因 Apple CloudKit TLS `-1200` 无结论，不能记为本地装订检查通过。
- Linux [`36118419926`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/36118419926) 公网干净安装、Windows [`36118419829`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/36118419829) 公网安装及原生诊断全绿。本机从唯一 v0.3.41 经保存的 7897 原位升级到 v0.3.42，版本、Core #191、51/240/43/9 与五份配置摘要保持；OpenConnector 安装版目录搜索通过，人工 inspect 未读到最终结果。详见 [v0.3.42 验收](../acceptance/2026-09-25-v0.3.42-signed-release.md)。Windows/Linux 旧版应用内原位升级依旧未验。

## 2026-09-25 Core #191 下一版候选（未发布）

- 此段为发布前状态：源码/staged 已配对 Core `86a49de`，准确展示 G1 active 与 G2/共享能力 pending，修复 G1 启动补扫项目错误分类及 OpenConnector 只读 host 的路径别名启动；全量与隔离 packaged smoke 证据见 [配对验收](../acceptance/2026-09-25-core-191-desktop-pairing.md)。当前发布和安装结果以上方 v0.3.42 记录为准。

## 2026-09-25 v0.3.41 公开签名版与本机原位升级

- Desktop `4536d03` 与 `04ab688` 的提醒加载/失败状态修正已进入公开 Latest v0.3.41。正式三平台签名构建、macOS 公证装订、7 键 feed、Linux/Windows 公网安装和本机 v0.3.40→0.3.41 原位升级均通过；Core `68004b2`、51/240/43/9 与五份配置摘要保持，安装版提醒页实际可打开。完整证据见 [v0.3.41 验收](../acceptance/2026-09-25-v0.3.41-signed-release.md)。
- 原生通知在临时放行共享屏幕通知后确认系统横幅展示和入历史，原隐私选项已恢复；点击回到提醒尚未观察。v0.3.41 签名版已在隔离数据根完成真实 Sleep/DarkWake/FullWake 和 G1 唤醒补查，真实数据/配置恢复保持，但没有到期事项跨睡眠的补跑证据。正式教师材料模型盲评及 Windows/Linux 旧版原位升级也仍未完成。

## 2026-09-24 v0.3.40 公开发布与本机原位升级

- 正式 run [`35993787607`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35993787607) 的 Linux、Windows、macOS、公证/装订和 manifest 全部成功；公开 Release [`v0.3.40`](https://github.com/Intellinfinity/edupi-desktop/releases/tag/v0.3.40) 含 11 项资产和 7 个签名平台键，Core 固定 `68004b2`，三条 feed SHA-256 均为 `b3605f88…`。
- Linux [`35998790991`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35998790991) 公网安装通过；Windows [`35998805393`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35998805393) 的公网安装和 diagnose 全绿。公开 DMG 经 7897 下载并核对摘要、版本、严格签名和 Gatekeeper 公证。本机 v0.3.39 已经持久化 7897 完成原位下载、验签、安装和自动重启；Core、51/240/43/9、五份配置摘要保持，Today 4+27 / 4+8 及展开收起通过。完整边界见 [v0.3.40 验收](../acceptance/2026-09-24-v0.3.40-signed-release.md)。

## 2026-09-24 v0.3.39 公开发布与本机原位升级

- 正式 run [`35979258168`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35979258168) 在 `acd7ae4` 上完成 Linux、Windows、macOS、公证/装订和 manifest；公开 Release [`v0.3.39`](https://github.com/Intellinfinity/edupi-desktop/releases/tag/v0.3.39) 含 11 项资产和 7 个签名平台键，Core 固定 `68004b2`，三条 feed SHA-256 均为 `758e0d10…`。
- Linux [`35984248531`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35984248531) 公开干净安装通过；Windows 首轮 public install 通过，diagnose 的 Core 字节恢复漏项由 #258 修复，完整重跑 [`35986226781`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35986226781) 全绿。本机后来由 v0.3.37 经原生更新到 v0.3.39、自动重启，同路径 Core/投影/Kernel ready，51/240/43/9、模型/认证/设置和桌面偏好摘要保持，唯一安装副本签名有效；完整过程边界见 [v0.3.39 验收](../acceptance/2026-09-24-v0.3.39-signed-release.md)。

## 2026-09-24 更新代理一次保存（macOS 全链通过，跨平台待验）

- 桌面设置可保存本机 HTTP 更新代理，例如 `http://127.0.0.1:7897`；配置在独立原生文件中持久化，不写 `ui-prefs.json` 的教师数据根。Tauri 签名更新的清单/资产和 `/api/updates` 的 GitHub Release 查询均使用它，后者只设置单请求 dispatcher，不影响 Core 或模型网络。设置后立即刷新版本；并发旧结果不可覆盖新结果。缺失配置沿用系统网络，损坏配置 fail closed，可显式恢复系统网络。
- 隔离代理 CONNECT、失败缓存/重试、800×900 页面、Rust/TypeScript 门禁、`35973703981` 预览、`35976790629` Windows 编译和 v0.3.39 正式构建已有证据，见 [更新代理验收](../acceptance/2026-09-24-update-proxy.md)。macOS 安装版已保存 7897，退出重启回读、Release 检查、Tauri 清单/资产下载、验签、覆盖安装与自动重启均通过；第一次到 2% 中断，第二次成功。Windows/Linux 实机仍待验。
- v0.3.38 及更早版本不含此设置；本机首次取得 v0.3.39 已走旧更新链路。保存后的代理只会影响后续检查与版本升级，不对旧包提供追溯能力。

## 2026-09-24 v0.3.38 公开发布与公网安装

- 正式 run [`35967579321`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35967579321) 在 `8871a1b` 上完成 macOS、Windows、Linux 与 manifest；Release [`v0.3.38`](https://github.com/Intellinfinity/edupi-desktop/releases/tag/v0.3.38) 当时为公开 Latest，非草稿/非预发布，11 项资产、7 个签名平台键，Core 固定 `68004b2`。`latest.json` SHA-256 为 `eadbc4db…`，公开 DMG 为 `f58462f5…`。
- macOS runner 的签名 packaged runtime、updater key、公证、staple 和 Gatekeeper 通过；独立下载 DMG 后挂载的 `.app` 同样为有效严格签名、`Notarized Developer ID`、stapled ticket。本机 `stapler validate` 仍因 Apple CloudKit TLS `-1200` 无结论，不覆盖 runner 和 Gatekeeper 的成功证据。
- 首轮 Linux [`35972371818`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35972371818) 与 Windows [`35972383389`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35972383389) 公网 smoke 在进入应用前因稀疏 checkout 缺开发包 `jiti` 失败。[#250](https://github.com/Intellinfinity/edupi-desktop/pull/250) 合并 `f7349df` 后，公开 smoke 不再依赖 `node_modules`；Linux [`35973841908`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35973841908) 与 Windows [`35973841420`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35973841420) 已对未改变的 v0.3.38 资产完成安装、目录和 Core/原生检查。完整边界见 [v0.3.38 验收](../acceptance/2026-09-24-v0.3.38-signed-release.md)。
- 本机未单独执行 v0.3.37→v0.3.38；后来直接完成 v0.3.37→v0.3.39 原位升级，旧 v0.3.37 `.app` 有独立临时备份。干净公网安装仍不替代 Windows/Linux 旧版原位升级。
- Desktop 旧 PR #71/#74 已关闭为 superseded；依赖 PR #32 的目标版本已由当前锁文件提供并关闭。三者均未重新合并到 v0.3.38 主线。

## 2026-09-24 教师价值与漏报反馈（已发布，待真人）

- 教师反馈现可记录真实使用、复用意愿和成对时间，并能从管理中心报告六领域漏报；隔离 Core 写入/重放/汇总与 360 像素组件浏览器验收通过，工程数据不计入真人价值。
- v0.3.38 已包含该表单和 Core 合同；macOS/Windows/Linux 签名安装版的实际评价/漏报提交与重启回读仍未执行。Tauri Next dev WebView 的既有 React interop 失败使开发窗口无结论，不能由静态浏览器 harness 或发布构建替代真人操作。

## 2026-09-24 R23 未受管 Action 隔离（已发布）

- 环境变量不再能向生产 AgentSession 注册 OpenConnector Action 工具；runtime/admin token 在扩展加载前从服务端环境清除。Provider 默认目录只读，执行、连接管理和审计回读均在网络前拒绝，旧副作用路径只允许隔离合同测试显式开启。
- 此改动已进入 v0.3.38；签名构建与公开安装保持只读 catalog host 的 Action/proxy 全阻断，生产 Agent 不再暴露旧工具。Core grant/Receipt 和受管 runtime 未实现，R23 继续部分实现，不能以“目录可查”冒充“Action 可执行”。

## 2026-09-24 v0.3.37 公开发布与本机原位升级

- 修复版 run [`35932154000`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35932154000) 的 macOS、Linux、Windows 和 manifest 全部成功；正式 Release `395131181` 非草稿、11 项资产，Raw feed 为 `0.3.37`、7 个签名平台键、清单 SHA-256 `bed10e86…`。Linux 和 Windows 公开安装启动分别由 `35936781815`、`35936813172` 验收通过。
- macOS 公开 DMG 的独立下载摘要与 Release 相同，本机 Gatekeeper 为 `Notarized Developer ID`；runner 两次 Apple submission 均 Accepted，应用与 DMG 的装订验证通过。本机 `stapler validate` 因 CloudKit TLS `-1200` 无结论。已安装的 0.3.36 从原生设置页点击更新，随后同路径变为 0.3.37、进程 `86147 → 22116`，Core `68004b2` ready、51/240/43/9 教师数据和三份模型/认证/设置摘要保持；中途锁屏使进度各阶段未逐帧可见。完整证据见 [v0.3.37 验收](../acceptance/2026-09-24-v0.3.37-signed-release.md)。

## 2026-09-24 v0.3.37 首轮 Linux 构建失败（历史，已由上节取代）

- Desktop 已将版本元数据、组件清单、Cargo 锁文件和 Release 说明同步为 `0.3.37`；目标 Core 固定 `68004b2`，包含 AI 协作自由输入、OCR、逐项日程/课表来源配对与默认关闭的 G1 试用。`release:verify`、Cargo metadata 和 40 项发布合同测试通过；首轮三平台构建未全绿，公证、公开资产及应用内升级不能记为通过。
- R23 OpenConnector 本次只合入授权止血，受管 runtime、Core grant/Receipt 与同用户 shell 隔离仍未完成；不能把这个包称为 R23 交付。下方 v0.3.36 是当前公开 Latest，待新版发布与安装验收后才改变该状态。

首轮正式 run [`35928743275`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35928743275) 建立绑定 `973babc` 的 v0.3.37 草稿；Linux 在 `linuxdeploy` 扫描 staged server 的 `@napi-rs/canvas-linux-x64-musl` 时因 glibc runner 上 `ldd` 返回 1 而失败。Windows 成功，macOS 在 DMG 公证期间随失败 run 取消，manifest 未运行。原来只移除 musl Sharp；Desktop [#241](https://github.com/Intellinfinity/edupi-desktop/pull/241) 将同平台的 musl Canvas 一并从 glibc 安装包剔除，保留 gnu 版本，定向测试、本地全量门禁和独立复审通过。旧草稿 `395112944` 经核对为未公开、仅含原提交 5 项资产且无 tag 后已删除；公开 feed 保持 v0.3.36。新 run [`35932154000`](https://github.com/Intellinfinity/edupi-desktop/actions/runs/35932154000) 在精确修复提交 `d16f9d6` 上完成 Linux 和 Windows build；macOS 签名构建完成，DMG 公证进行中。manifest、公开资产和安装验收仍未通过。

## 2026-09-24 课表来源别名与 Core `68004b2` staged 验收（未发布）

- Core [#182](https://github.com/Intellinfinity/edupi/pull/182) / [#184](https://github.com/Intellinfinity/edupi/pull/184) 已合并，Desktop `0f2c75d` 固定 `68004b2` 并通过真实隔离 Core 的纯课表、跨文件别名、教师选源增量、重复回放、旧材料删除和并发删除 CAS 流程。macOS staged bundle 的 Core/投影/Kernel ready，新课表来源 API 为 200/no-store，离线 OCR 与 DOCX smoke 均通过；详见 [课表来源别名验收](../acceptance/2026-09-24-l4-timetable-source-alias.md)。
- Release 的非 Windows 配对运行时步骤和 preview 打包前检查现都运行 `test:edupi-slot-alias-e2`；Windows 保留精确 bundle/manifest 门禁，安装版启动仍需 Windows 实机验收。`release-workflows.test.mjs` 与 `actionlint` 均核对新增步骤。
- 本批尚未生成签名/公证安装包，也未执行旧版应用内升级。公开 Latest 仍是 v0.3.36/Core `860594a…`；源码与 staged 结果不等于正式三平台安装验收。

## 2026-09-24 G1 主动运行与删除传播配对（开发验收，未发布）

- Desktop [#233](https://github.com/Intellinfinity/edupi-desktop/pull/233) 已合并为 `a3def0aa3a8f4b2655d04e50007ef4fe0c62b2cf`，[#235](https://github.com/Intellinfinity/edupi-desktop/pull/235) 的未授权领域即时 tombstone 已合并为 `e47bcca6cb18fa8feeb403dd2520a7d1a4515a6b`。此 G1 checkpoint 当时固定 Core [#183](https://github.com/Intellinfinity/edupi/pull/183) merge `26fc91ef656877b15ca3e60f14093cf52ea7b736`、Desktop/Runtime manifest `sha256:9c019d02…` / `sha256:85c6a8da…`；当前唯一配对 pin 已由上方 `68004b2` 取代。默认仍关闭；单班单科显式 canary 的期限、预算和 `external_send=false` 不变。
- Core/ Desktop 已覆盖串行启停与 stale CAS、停止失败栅栏、grant 到期、未授权领域即时 tombstone、多个普通课次共享材料、自然请求/修订/取消、反馈回读及 synthetic 排除、两阶段无正文 message ledger、会话删除前来源撤回、停止后撤回、active Goal/队列/草稿级联失效和 capture-crash pending 恢复。真实 merge Core E2 与 staged runtime 通过。
- Desktop 全量为 1673 tests，1647 passed / 26 skipped / 0 failed；TypeScript、lint、audit、actionlint、staged Desktop/feedback/occurrence/conflict/ICS/OCR/DOCX、Core closure 3/3 和 model host 2/2 通过。
- 后续 v0.3.37 已正式发布并安装。macOS 同一签名 `.app` 使用隔离 data/config/agent 目录实际完成 G1 启用、Core active、停止和重启后保持 disabled；状态始终 `external_send=false`。恢复真实 config 后 Core `68004b2`、Projection/Kernel 与 51/240/43/9 保持。Windows/Linux G1 原生 UI、真实睡眠、通知点击、Windows 旧版原位升级、真实模型内容、正式盲测和教师试用保持 Unverified，整体仍为“L4 功能收敛中”。

## 2026-09-24 同名多项逐项配对 staged 验收（未发布）

- Desktop `b029a45` 的教师逐项配对、Core CAS 和保留原事项身份已在隔离 Core/打包页面验收；签名后的 macOS 包新增 DOCX 提取 smoke，Release/preview 的三平台 staged 构建也需运行它。详情见 [逐项配对验收](../acceptance/2026-09-24-l4-document-pairing.md)。
- 当前没有包含该提交的正式安装包；公开 Latest 仍为 v0.3.36。macOS 签名公证与升级、Windows/Linux 安装版、真实老师材料和最终冲突决议仍需正式验收。

## 2026-09-24 扫描材料 OCR staged 验收（未发布）

- Desktop `77e88f8` 将离线 OCR/PDF 运行依赖纳入三平台打包准备，Release/preview 在打包后用真实图片与图片版 PDF 执行 OCR smoke；macOS 签名后的 bundle 也增加同一 smoke。固定 Core `c1edefd…` 的隔离 OCR→日程 E2 与 macOS staged server/Core 回读通过，详细边界见 [验收记录](../acceptance/2026-09-24-l4-scanned-material-ocr.md)。
- 尚无包含该提交的正式 Release。公开 Latest 仍是 v0.3.36；签名/公证后的 macOS 包、Windows/Linux 安装包及旧客户端应用内升级必须在正式发布时另验，不能用 staged 结果替代。

## 2026-09-23 文档同名 occurrence 配对（开发验收，未发布）

- [Desktop #229](https://github.com/Intellinfinity/edupi-desktop/pull/229) 的提交 `082648e` 支持同一 PDF/DOCX 的多条同名同类事项：完整语义 variant ref、exact duplicate 折叠、旧 singleton 保持、精确优先与剩余 1:1 配对。单项变化沿用原 ID，由 Core 按 revision/conflict 规则处理；日期或时段变化进入 held/conflict，多项变化不猜测。
- pre-typed inferred legacy 可在同字节证明下升级为 typed held；foreign legacy 同 anchor、deleted sibling 复活和确认内容漂移继续 fail closed。真实 DOCX E2、1521 passed / 26 skipped / 0 failed、TypeScript、lint、audit、packaged build、staged runtime 与独立复审通过。
- 本节未生成或安装正式 Release；公开 Latest 仍为 v0.3.36/Core `860594a…`。多项同时变化的逐项 UI、slot alias、可信 OCR、安装版、盲测和真人价值继续留在 Unverified。

## 2026-09-23 文档 evidence alias 与删除传播配对（开发验收，未发布）

- [Core #177](https://github.com/Intellinfinity/edupi/pull/177) 合并为 `c1edefd2a2b77e3d10dfc9f0a47eceb7b5f7b1de`；[Desktop #228](https://github.com/Intellinfinity/edupi-desktop/pull/228) 的提交 `3b7f1e5` 固定该 Core，并为 H2→H 精确重放恢复 Core-owned alias。自动恢复要求当前 accepted material hash 证明；删除状态、残留混合 evidence、slot 和歧义来源不会静默绑定。
- 真实 DOCX route E2 完成同哈希双副本删除、全部隐藏、明确恢复和恢复后 alias；全量 1519 passed / 26 skipped / 0 failed，staged Desktop/ICS/occurrence/feedback 与 bundle/model-host 8/8 通过。`proactivity=disabled`、`external_send=false`。
- 本节没有生成正式安装包；公开 Latest 仍为 v0.3.36/Core `860594a…`。重复同名同类事项的单项变化已由上方 #229 收敛；多项同时变化、slot alias、可信 OCR、正式安装、盲测和真实教师价值继续留在 Unverified。

## 2026-09-23 文档日程跨修订来源配对（开发验收，未发布）

- [Desktop #226](https://github.com/Intellinfinity/edupi-desktop/pull/226) 的提交 `0f9ec30`、`f255674`、`bd10438` 把 PDF/DOCX 修订绑定 Core logical source 和 occurrence，补跨格式去重、legacy/filename issuer 接管、教师确认防降级、omission 保留、tombstone 恢复与真实 route POST；详细边界和证据见 [验收记录](../acceptance/2026-09-23-document-schedule-revision-source.md)。
- 本节没有生成正式安装包；公开 Latest 仍为 v0.3.36/Core `860594a…`。source-hash alias 已由上方 #177/#228 收敛；重复同名同类事项、slot alias、图片/扫描 PDF、正式三平台安装及应用内升级仍需后续交付。

## 2026-09-23 文本日程证据配对（开发验收，未发布）

- [Desktop #225](https://github.com/Intellinfinity/edupi-desktop/pull/225) 的提交 `fe53b51` 让文本 PDF/DOCX 仅在原文可证明完整 typed time/location 时进入 Core v1.2，并新增真实 DOCX E2 与 release gate；packaged symlink worktree 同时补齐 `undici` 外部依赖闭包。证据见 [验收记录](../acceptance/2026-09-23-text-schedule-evidence.md)。
- 本节没有生成正式安装包；公开 Latest 仍为 v0.3.36/Core `860594a…`，三平台签名、公证、公开安装和后续应用内升级仍需单独执行。

## 2026-09-23 非 ICS 日程来源身份（开发配对，未发布）

- [Desktop #223](https://github.com/Intellinfinity/edupi-desktop/pull/223) 的提交 `c8cb6f0` 让 PDF、图片和 Word 的 schedule issuer 以校验后的内容 SHA-256 为准；同字节改名稳定、同名不同字节隔离。该项没有生成安装包，详细边界见 [验收记录](../acceptance/2026-09-23-document-schedule-content-identity.md)。
- 公开 Latest 仍为 v0.3.36/Core `860594a…`；下个正式包仍需重跑三平台构建、签名、公证、安装与应用内升级，不能用源码测试替代。

## 2026-09-23 ICS 来源收敛开发配对（未发布）

- 当前开发分支已固定 Core `b2c2bb809d4c4f8c09af7bc0e2741c025985dd3e`，[Desktop #222](https://github.com/Intellinfinity/edupi-desktop/pull/222) 以提交 `e097865`、`1e4c2c8`、`1402691`、`ee71640` 完成严格 ICS 暂存、确定性解析、来源 CAS、单次/整组取消、循环系列替换、精确重放和 tombstone 恢复防护。
- `desktop:prepare`、staged uploaded-calendar/occurrence/conflict/feedback/desktop、bundle closure 3/3 和 model host 2/2 均通过；packaged 页面在隔离数据根实际完成首次导入和来源更新，console error/warn 为 0。验收详见 [上传 ICS 日历来源收敛验收](../acceptance/2026-09-23-uploaded-calendar-source-sync.md)。
- 本节不改变公开更新状态：Latest 仍是 v0.3.36/Core `860594a…`。包含 Core `b2c2bb8` 的正式三平台构建、签名、公证、公开安装和应用内升级尚未执行，不能以 staged 资源替代安装版验收。

## 2026-09-23 v0.3.36 应用内更新风险验收（当前）

- Desktop #220 merge `71d9670` 要求正式构建内嵌 updater 公钥，并在 macOS 最终可执行文件公证前比对精确公钥；缺公钥构建负测按预期拒绝。正式 run `35820263217` 三平台与 manifest 全绿，Release `394308386` 为公开 v0.3.36、11 项资产、7 个签名 updater 键。Apple DMG submission `fb9c113d-aad4-461a-8f14-61170f43b1b3` Accepted，三条 feed 均回读 v0.3.36、清单 SHA-256 `e6b474a0…`。
- 本机从已安装的 v0.3.35 设置页实际点击“更新”：完成清单检查、下载、验签、安装与自动重启，进程 `10848 → 58654`，原路径版本为 0.3.36；Core/投影/Kernel ready、Core `860594a…`，51/240/43/9 和三份模型/认证/设置摘要保持，手机仍关闭、JEV 设置保持，唯一安装副本与 Gatekeeper 通过。固定 Tauri updater 2.10.1 在 `download` 返回前验签，失败不会进入 `install`。完整证据见 [v0.3.36 应用内更新验收](../acceptance/2026-09-23-v0.3.36-in-app-updater.md)。
- v0.3.29 已发布的 macOS 二进制无法原地补入 updater 插件；v0.3.25–v0.3.28 固化旧 endpoint，因此这些版本仍需一次性手动替换。这台 Mac 已在上一版完成该 bootstrap。Windows/Linux 旧版应用内升级尚需独立验收。

## 2026-09-23 v0.3.35 签名启动恢复（历史，首次手动安装通过）

- v0.3.29 应用内更新在清单检查阶段返回 `UPD-227408f2`，解码为 `plugin updater not found`；旧二进制未内嵌 updater 公钥。手动 bootstrap 的 v0.3.34 通过 Gatekeeper 后，在内置签名 Node 的 V8 初始化处 SIGTRAP；v0.3.30/v0.3.33 的同类 helper 也重现。根因是发布脚本以 Hardened Runtime 二次签名 helper 时丢失 `allow-jit` entitlement。
- v0.3.30/v0.3.33/v0.3.34 已调回 draft；中途公开 Latest/三条 feed 曾回到 v0.3.29，feed commit `18d87dba`，清单 SHA-256 `2b0e934a…`。该回滚和 v0.3.34 本机失败见 [安装回滚证据](../acceptance/2026-09-23-v0.3.34-core-occurrence-release.md)。
- v0.3.35 只给 Node helper 加 `allow-jit`，签名后执行 V8 命令，Tauri 最终 `.app` 再启动隔离 Core。正式 run `35815288358` 三平台、DMG 公证与 manifest 全绿；Release `394282553` 为公开 Latest，11 项资产、7 个签名 updater 键。Apple submission `f9b1d9ff-93cc-4374-a36f-77061c6e7653` Accepted，公开 DMG SHA-256 `b766f9be…`；canonical Raw、旧 Raw 和旧 Latest 均返回同一份 v0.3.35 manifest `d306677b…`。
- Linux `35817527851` 和 Windows `35817533119` 公共安装通过。本机从 v0.3.29 保留备份手动安装 v0.3.35 后，应用窗口与 Core `860594a…` 就绪；51/240/43/9 数据和模型/认证/设置摘要保持，手机仍关闭、JEV 设置保留、唯一 `/Applications/EduPi.app`。完整证据见 [v0.3.35 签名启动恢复与安装验收](../acceptance/2026-09-23-v0.3.35-signed-macos-recovery.md)。v0.3.29 没有 updater 插件；v0.3.35 后续自动升级现以上方 v0.3.36 实测为准。

## 2026-09-23 v0.3.34 Core occurrence 配对发布（历史，macOS 启动失败后撤回）

- Desktop PR #212/#215/#216 最终发布 merge 为 `c492aea8e50b3aadd207be9bae40a34e0412dedc`，固定 Core `860594a05c5d32617fffdbdf03d56e6ade6dc211`；occurrence mutation 连续性、旧 owner key 安全降级和 owner read 503 映射均已进入公开包。
- 全平台 run `35805159993` 完成 Linux/Windows 构建；macOS 的已知 hosted runner 临时根 writer admission 波动没有生成资产。同 SHA 的一次 macOS 补跑 `35808315316` 完成构建、公证和 manifest。Release `394223451` 为公开 v0.3.34，11 项资产、7 个签名键，feed commit `9e70f0e`。
- Apple submission `192c6e32-de59-47d3-9f12-4e5b54702eb4` Accepted，runner 的 DMG staple/validate、Gatekeeper 与 Release ID 替换事务通过；公开 DMG SHA-256 为 `a40b23b9…`。三条迁移期 endpoint 返回同一份 v0.3.34 manifest `539bffd4…`。
- 公开 updater tar 在仓库外启动后 Core/投影/Kernel ready，Core 精确为 `860594a…`，proactivity 与 external send 关闭。Linux `35811719843` 与 Windows `35811727023` 公共安装启动均通过。完整证据见 [v0.3.34 Core occurrence 与签名发布验收](../acceptance/2026-09-23-v0.3.34-core-occurrence-release.md)。
- 当时本机唯一安装副本为 v0.3.29，Mac 锁屏使该版本的安装验收尚未执行；后来的 v0.3.34 失败和 v0.3.35 成功以上方当前状态为准。通知点击、睡眠恢复与 Windows/Linux 旧版应用内升级仍未由公共干净安装替代。

## 2026-09-23 v0.3.31-v0.3.32 启动回滚与 v0.3.33 修复

- 受限 Core 只读凭据恢复后，正式 run `35757858707` 在 merge `bef61195` 上完成 macOS、Linux、Windows 和 manifest；v0.3.31 已公开为非草稿 Release，11 项资产、7 个签名 updater 平台键与 canonical Raw feed 完整。DMG、macOS updater 和 `latest.json` 的 Release digest 分别为 `fa4ccd48…`、`da2f3e79…`、`6e32a370…`。
- 独立复核发现 v0.3.31 只对 `.app` 完成 Apple 公证：解包应用为 `accepted / Notarized Developer ID`，公开 DMG 没有 stapled ticket，`spctl --type open` 为 `Unnotarized Developer ID`。应用内 updater tar 可继续由 Tauri 验签升级，但 v0.3.31 DMG 不满足离线 ticket 验收。
- v0.3.32 将 canonical 仓库和首选 feed 固定为 `Intellinfinity/edupi-desktop`，保留两个旧 endpoint 作迁移 fallback；macOS workflow 新增 DMG `notarytool submit --wait`、staple 和 Gatekeeper 验证。公证后的 DMG 不再用 tag `--clobber`：脚本绑定 release ID、唯一 tag、draft、目标 SHA，先改名保留旧资产，再通过 `uploads.github.com/.../releases/{release_id}/assets` 上传并重新下载核对 size/SHA-256，最后删除备份。
- 发布事务在首次删除备份时进入提交状态；之后只幂等重试同一 backup asset ID，404 视为已删除。其他 cleanup 不确定性会同时保留已验真的正式 DMG 与备份，使精确资产集合门禁失败并保持 draft，不会再回滚删除已验真 DMG。上传、验真或提交前错误恢复旧资产。
- 本地最终门禁：`npm test` 1373 passed / 25 skipped / 0 failed，TypeScript、ESLint、npm audit（0 vulnerabilities）、release verify、目标仓库校验、actionlint、Cargo metadata 和 28 项 Rust library tests 通过；发布事务 41 项定向测试及独立复审无 P1/P2。
- DMG 验收：全平台 run `35771039553` 完成 Linux/Windows 构建，macOS 的一次 G6 临时根失败保持 draft；同提交 macOS retry `35772209888` 完成 manifest。Release ID `394034871` 固定 `9f33463`，Apple submission `500735b4-4a03-4b0b-8376-c6cf3270c48c` Accepted；runner 的 DMG staple/validate、Gatekeeper 和重新下载 SHA-256 `3ee2667b…` 全部通过。公开 DMG 本机 Gatekeeper 为 `Notarized Developer ID`，本机 `stapler validate` 仍受 Apple CloudKit TLS `-1200` 阻断，未记为通过。
- 启动回归：Linux `35783207989` 和 Windows `35783220232` 均从已安装 v0.3.32 的 `server.log` 读到 `Cannot find module 'next'`。原因是普通 standalone `node_modules` 被排除，而 staged 测试从源码上级依赖形成假通过。v0.3.31/v0.3.32 已退回 draft，v0.3.30 已恢复 Latest；feed commit `446a73a` 为 v0.3.30、7 个签名键，三条 endpoint 与本机更新接口均已回读。
- v0.3.33 增加普通目录复制、symlink/NFT 兼容、最终产物零 symlink/realpath containment 和三平台隔离 staged server 启动门禁；正式 run `35789747783` 三平台/manifest 全绿，Release `394151776` 有 11 项资产与 7 个签名键。Linux public install `35792864973` 和 Windows `35792875124` 均成功；DMG 公证与本机 Gatekeeper 通过。完整证据见 [v0.3.33 packaged server 恢复验收](../acceptance/2026-09-23-v0.3.33-packaged-server-recovery.md)。
- v0.3.33 发布后合并的 Core occurrence 配对不在旧包内；现已由 v0.3.34 独立构建、签名、公证并完成 Linux/Windows 公共安装。macOS 应用内原位升级仍待本机解锁。
- v0.3.34 同时修复 occurrence mutation 即时投影回退和旧 owner key 升级阻断；全量 1425 passed / 26 skipped / 0 failed，真实 source occurrence mutation、lost credential conflict 和旧 owner state 升级演练通过。首次 run `35804036187` 在上传前发现 owner read 的错误状态映射并取消，空 draft `394218266` 已删除；最终 Release 不复用该 run 的任何资产。

## 2026-09-22 v0.3.31 发布阻塞（历史，已解除）

- Desktop #207 合并为 `0d36b5f`，Release run `35714740346` 创建 `v0.3.31` 草稿；三平台 npm/type/lint/audit 及 Apple 六项 Secret 门禁通过，但私有 Core checkout 都在 `git@github.com:Intellinfinity/edupi.git` 返回 `Repository not found`。manifest job 未运行，Release 未公开，旧版更新不可见。
- Core 仓库仍列有旧只读 Deploy Key；组织策略禁用 Deploy Key 后它不能读取，创建新 Key 返回 HTTP 422。未注册的临时私钥已删除。不得把当前广权限个人 `gh` OAuth token 写入 Actions Secret。
- 后续须使用组织允许的、仅 `Intellinfinity/edupi` Contents 只读的短期凭据（或等价的 GitHub App 授权）恢复 checkout；同一 draft 绑定原 merge SHA，凭据恢复后可重跑失败 job。三平台公证、11 项资产、7 平台 feed 和 0.3.29 原位升级仍分别待验收。
- [Desktop #210](https://github.com/Intellinfinity/edupi-desktop/pull/210) 已提交凭据优先级与新仓库路径修正：29 项定向测试、release/preview actionlint 和 lint 通过；Windows debug 的完整 actionlint 仍报原有 ShellCheck `SC2012`，没有当作通过。该修复目前是另一 PR，不会改变已经失败 run 的代码；`gh auth` 已返回 401，需要恢复登录后才能继续远端操作。

## 2026-09-20 v0.3.29 执行记录

- 最终发布与安装：PR #200 合并为 `a7b83a9`；workflow `35548760372` attempt 2 成功，v0.3.29 正式发布，11 个资产、7 个 Raw feed 平台键完整。本机从 v0.3.28 手动 bootstrap 到 v0.3.29，唯一安装副本、教师数据、模型/认证哈希和默认模型保持；Safe Mode 与 LAN 手机配对/撤销完成安装版实测。见 [完整验收](../acceptance/2026-09-21-v0.3.29-update-safe-mobile.md)。
- Feed 专用树：发现首次分支沿用了 main 树后，使用非强制快进 commit `7ae9dd2` 把当前树收敛为唯一 `latest.json`；发布 workflow 已改为直接创建 manifest-only Git tree，不再从 main 复制仓库内容。

- 代码状态：更新 manifest、Tauri endpoint、release workflow、Safe Mode、手机 bridge 和 v0.3.29 版本元数据已落地，未执行 reset/clean 或重建分支。
- 自动化证据：初始实现回归 `npm test` 1332 项中 1307 passed、25 skipped、0 failed；`tsc --noEmit`、针对性 updater/Safe Mode/mobile 测试和 Cargo library tests 已通过。最终复跑结果见下行。
- 最终本地复跑：`npm test` 1334 项中 1309 passed、25 skipped、0 failed；`npm run lint`、`npm audit --audit-level=high`（0 vulnerabilities）、`tsc --noEmit`、`cargo metadata --locked`、默认/无 custom-protocol Cargo tests 和 `actionlint` 均通过。`PI_WEB_DESKTOP_BUILD=1 next build --webpack` 成功，保留既有 export route 的 critical dependency warning。
- 公开传输实证：以 Latest `v0.3.28` 资产回放新脚本，生成 7 个 updater 平台键、4 个唯一 GitHub API asset URL；API asset endpoint + `Accept: application/octet-stream` 取得 1024 字节 ELF 分片。当前 `updater-feed` Raw URL 仍为 404，因为分支尚未推送。
- 打包边界：`npm run desktop:prepare` 的 Next standalone build 成功，随后因本机没有计划固定的 Core commit `d05cf89…` 而停止；旁边 `../edupi` 为另一提交且有未提交改动，未使用或修改。
- 未验收：公开 `updater-feed` 分支首次写入、v0.3.29 三平台 Release、旧客户端手动 bootstrap、安装版 Safe Mode、真实手机配对/续聊/撤销。源码测试或 API 可达性不替代安装版与手机端到端证据。
- 本地交付提交：`45e1a55`（主实现）、`93fc5e0`（执行记录）、`cff8dd6`（旧客户端 bootstrap 边界）、`4f599a3`（手机窄屏布局）。推送到既有 origin 分支时因本机 GitHub HTTPS 凭据失效而被拒绝，未尝试覆盖远端或重建分支。

## 2026-09-20 更新中断分层诊断

- 安装版内置 server 的 `GET /api/updates?refresh=1` 返回 `currentVersion=0.3.25`、`latestVersion=0.3.28`、`releaseStatus=available`；该查询走 `api.github.com`，HTTP 200。
- 当前 Tauri updater endpoint 仍是 `https://github.com/PIGU-PPPgu/edupi-desktop/releases/latest/download/latest.json`。从同一机器请求该 manifest，以及 `latest.json` 中的 macOS 资产 URL，均在 0 字节阶段超时；强制 HTTP/1.1 或 IPv4 也未改变结果。
- 通过 GitHub API 的同一 Release asset（`Accept: application/octet-stream`）可以收到 302，并跟随到 `release-assets.githubusercontent.com`；`latest.json` 完整解析成功，macOS tar 通过该路径取得 1024 字节 gzip 分片。`api.github.com` 与 `release-assets.githubusercontent.com` 均可达。
- 结论：故障是 `github.com` origin 下载路径的目的地主机/重定向链路，不是 Release 文件损坏、签名缺失或整个网络不可用。当前 UI 的“更新包下载中断”来自 `desktopUpgradeErrorKind` 对响应体/连接错误的统一映射，尚未记录具体 host 和阶段。
- 本轮没有重复点击同一失败入口，也没有手动覆盖安装；下一步应把 updater manifest/资产下载从 `github.com` origin 解耦（API-backed stable manifest/proxy 或明确的网络 allowlist），再做一次完整验签、替换、重启验收。

## 2026-09-20 `v0.3.28` 提醒工作台发布

- Release workflow [`35505373874`](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/35505373874) 三平台质量门、固定 Core 配对、桌面壳测试、签名资产上传和 manifest 全部成功；正式 Latest [`v0.3.28`](https://github.com/PIGU-PPPgu/edupi-desktop/releases/tag/v0.3.28) 固定到 `d3b96f96f9344a98dfba1cc145c84309c9dbf08d`。
- Release 非草稿、非预发布，共 11 项资产；`latest.json` 版本为 `0.3.28`，包含 `darwin-aarch64`、macOS app、Linux AppImage/deb、Windows NSIS 等 7 个 updater 平台键。组件清单为 Desktop `0.3.28`、Pi `0.84.1`、pi-web `0.8.7`。
- `v0.3.28` 包含全宽提醒队列/详情、提醒状态切换，以及隐藏对话侧栏后遗留空白列与窄窗裁切修复。开发版 1440×900、800×900、390×844 与亮/暗色均已操作验收。
- 本机安装副本仍为 `v0.3.25`；`github.com:443` 当前 5 秒连接超时，无法开始 updater 下载，因此尚未验签、替换或重启。macOS Release 仍为 ad-hoc 签名，安装版页面、数据保持和授权状态继续保留未验收。

## 2026-09-20 `v0.3.27` JEV 设置发布

- Release workflow `35484119032` 三平台构建、签名、上传和 manifest 全部成功；正式 Latest [`v0.3.27`](https://github.com/PIGU-PPPgu/edupi-desktop/releases/tag/v0.3.27) 固定到 `56d9e94daadb496491912e3d6999fdc2289d71a8`，11 项资产、7 个 updater 平台键完整。
- `v0.3.27` 包含 JEV 快速浏览器决策设置、服务端密钥存储和 OpenConnector 适配器；JEV 默认关闭且不参与聊天模型。
- 本机安装副本仍为 `v0.3.25`。从设置页检测到 `v0.3.27` 后，三次应用内下载都在 `github.com:443` 下载阶段中断，尚未验签、替换或重启；待该网络入口恢复后继续同一更新入口验收。

## 2026-09-20 `v0.3.26` 发布与本机更新阻塞

- Release workflow `35445254882` 的 macOS、Linux、Windows 与 manifest 全部成功；正式 `v0.3.26` 固定到 `4f85114942f4e65f9463ec5d3dd7ccf6e4c35b8b`，非草稿、非预发布，共 11 项资产和 7 个 updater 平台键。
- 本机仍为 `v0.3.25`。设置页真实检测到 `v0.3.26`，三次点击应用内“更新”都在下载阶段返回“更新包下载中断”，没有进入验签、替换或重启；安装目录和进程保持原版。
- 网络诊断显示 `api.github.com` HTTP 200，但 `github.com:443` 请求无响应或连接超时，三轮更新器连接同一地址停在 `SYN_SENT` 后消失。未用手动下载或覆盖安装替代应用内验收。
- 升级前基线：Core/projection/kernel ready；51 名学生、240 个任务、43 个校历节点、9 个课表、28 个已登记产物；默认模型 `zai-coding-cn/glm-5.3-flash`，自定义配置 3 个 Provider/9 个模型；`.edupi` 147 个文件。模型和认证文件摘要已在本轮内存证据中核对，未写入密钥。
- 当前状态为外部网络阻塞。待 `github.com` 恢复后从同一设置入口重试，成功后核对版本、进程、上述数据和模型摘要，再继续通知授权、显示与点击验收。

## 2026-09-16 `v0.3.15`–`v0.3.17` 发布与旧客户端检测

- `v0.3.15` 首轮因 Cargo.lock 的无关 `errno` 版本被误改而失败且未生成 Release；Desktop [#133](https://github.com/PIGU-PPPgu/edupi-desktop/pull/133) 恢复依赖并在打包前强制校验 lockfile。workflow [35013486688](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/35013486688) 随后以 macOS 15分57秒、Linux 16分05秒、Windows 21分36秒完成，发布 11 项资产。
- `v0.3.16` workflow [35016438326](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/35016438326) 的三平台全部成功，旧 manifest job 因两个并发草稿各只有部分 updater 平台而失败。两个草稿的原构建资产和签名经摘要核对后合并到 Release `389446081`，完整 `latest.json` 有 7 个平台键，Release 固定到 `06f167a1db94a1b28f076b45d213fd1d23630263` 并公开，重复草稿已删除。公开 macOS updater 与实测包相同，SHA-256 为 `3b5572a2a520b632f527970c571bfb963f87d9505b7a954e497e72999b9cac69`。
- Desktop [#138](https://github.com/PIGU-PPPgu/edupi-desktop/pull/138) 让并行构建共用一个 commit-bound Release ID，并由最终 job 从真实签名集中生成 `latest.json`。`v0.3.17` workflow [35022297439](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/35022297439) 实际只创建一个草稿，macOS、Linux、Windows 分别约13分40秒、14分51秒、20分19秒并全部成功，草稿准确收齐 9 个平台资产。最终 job 已正确生成 7 平台清单，但随后调用需要 `node_modules` 的冗余组件生成器而失败；Desktop [#141](https://github.com/PIGU-PPPgu/edupi-desktop/pull/141) 改为校验提交内组件清单，使用同一修复步骤完成当前草稿。
- 正式 Latest [`v0.3.17`](https://github.com/PIGU-PPPgu/edupi-desktop/releases/tag/v0.3.17) 固定到实际构建提交 `dd5bce96bb0e1bfdf3f117cae4a7d88994b54bc0`，非草稿、非预发布，共 11 项资产；`latest.json` 的 7 个条目全部带签名，组件清单为 Desktop `0.3.17`、Pi `0.84.1`、pi-web `0.8.7`。公开 macOS updater SHA-256 为 `d4f88cae3e5eb96dd0b97b2f45cb188b7478726c5a097f5adfd2aa1ce09f612a`，解包版本为 `0.3.17`。
- 本机唯一安装副本 `/Applications/EduPi.app` 仍为 `0.3.13`；其真实 `/api/updates?refresh=1` 已返回 `latestVersion=0.3.17`、`updateAvailable=true`、`releaseStatus=available`，证明现有客户端无需重新下载安装包即可发现新版。本轮按用户安排不执行安装；升级重启、教师数据/模型保持、权限重查、通知点击和睡眠唤醒留给用户验收。Windows/Linux 应用内升级与 Apple 稳定签名/公证仍未验收。

## `v0.3.17` 用户安装验收清单

升级前基线已在 2026-09-16 重新读取；验收时只核对数量、身份和交互，不把任何 API Key 写入记录。

| 状态 | 项目 | 升级前 | `v0.3.17` 预期 |
| --- | --- | --- | --- |
| [ ] | 安装与进程 | `/Applications/EduPi.app` 一个副本，版本 `0.3.13`，一个主进程及其 server/Core 子进程 | 同一路径原位变为 `0.3.17`，旧进程退出，不出现第二个应用或窗口 |
| [ ] | Core 身份 | `f6145130dad4250864a3c6cd404f121be08fad17`，旧界面因课次缺材料显示 degraded | `19c0fd5182c6c20d6534973e506d6fa36acc1b06`，系统页显示“EduPi Core · 已就绪 · 已连接” |
| [ ] | 教师数据 | 50 名学生、240 个任务、43 个校历节点、9 条课表 | 四项数量保持；今天、教学、日程、工作区可打开同一对象 |
| [ ] | 模型配置 | 13 个可见模型，默认 `zai-coding-cn/glm-5.3-flash` | 数量和默认模型保持，既有 API Key 无需重填，模型测试可用 |
| [ ] | 自动运行 | 旧客户端显示 500 条重复失败 | 页面投影为 13 个真实课次；显示“缺少可用材料 / 补充材料”，不出现 `g1_prepare_due` 或 `source_unavailable` |
| [ ] | 更新状态 | 当前 `0.3.13`、最新 `0.3.17`、可更新 | 重启后当前与最新均为 `0.3.17`，不再显示可更新 |

按以下顺序完成原生交互验收：

1. 在“管理中心 → 系统 → 应用更新”点击更新，等待下载、安装和应用自行重启；不要手动打开第二份 EduPi。
2. 重启后依次核对上表六项，再从自动运行点击一次“补充材料”，确认进入材料页。
3. 在设置中点击“测试通知跳转”，把 EduPi 切到后台后点击系统通知，确认回到同一应用的提醒收件箱。
4. 在对话框选择“完全访问”，读取一个工作区文件并新建一个明确标记为验收用的文件；确认 Core 写入不再报 writer admission，随后删除该验收文件。
5. 从对话产物分别执行预览、打开文件、显示所在文件夹和另存为；从 OCR 结果打开可编辑文本，确认不是只有“已完成”状态。
6. 让系统睡眠后唤醒，等待一次自动检查；同一课次不得新增重复记录，失败仍能进入对应材料或任务。
7. 返回系统设置页点击“重新检测”；若 macOS 因当前临时签名要求重新授权，重新开启辅助功能和屏幕录制后重启 EduPi，再确认状态生效。

## 2026-09-16 `v0.3.13` 实际升级与 `v0.3.14` 发布

- 用户授权后，已从 `v0.3.11` 设置页点击真实“更新”。下载进度走完后应用自行重启，旧 PID `88791` 被新 PID `90028` 取代，路径仍为 `/Applications/EduPi.app`，版本为 `0.3.13`；磁盘搜索没有发现第二个 EduPi 安装副本。
- 升级前基线与升级后回读一致：Core、教育投影和 Kernel ready；50 名学生、240 个任务、43 个校历节点、9 个课表、45 条记忆、9 个自定义模型、默认模型、模型配置 SHA-256 和认证文件均保留。升级后暴露的旧 Runtime 重试历史兼容问题已由 Core [#121](https://github.com/PIGU-PPPgu/edupi/pull/121) 修复并由 Desktop [#125](https://github.com/PIGU-PPPgu/edupi-desktop/pull/125) 精确 pin；迁移后连续六轮状态/工作区读取为 200。
- `v0.3.14` 已由 Desktop [#126](https://github.com/PIGU-PPPgu/edupi-desktop/pull/126) 发布。Workflow [35002520172](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/35002520172) 的 macOS、Linux、Windows 分别约 13、15、22 分钟，整轮约 22 分钟；11 项 Release 资产、七个平台 updater 签名和组件清单完整。公开 macOS updater SHA-256 `8921b36e29b0ed79f5270136d4a363240987dcb6267e8fcea89e7207028e24c8` 与 Release digest 相同，解包后的应用版本为 `0.3.14`。
- 当前已安装 `v0.3.13` 能检测 `v0.3.14`，但本机尚未安装它；用户将在后续自行验收。当前 Release 仍使用 ad-hoc macOS 身份，Apple 稳定签名/公证和 Windows/Linux 应用内升级仍未完成；因此更新后 TCC 权限仍可能要求重新开启并重启应用。

## 2026-09-16 `v0.3.13` 更新入口热修与权限身份

- Desktop [#121](https://github.com/PIGU-PPPgu/edupi-desktop/pull/121) 修复管理中心覆盖设置窗口、更新区与首张卡片重叠、更新入口含义不清和权限状态无法重查；系统页现在明确显示“应用更新 / 检查更新”，打开时先关闭管理中心。设置窗口固定头部并让正文独立滚动，去掉仓库标签和第二行说明；桌面权限可重新检测、返回应用时自动刷新，并可打开对应系统设置或重启 EduPi。
- Desktop [#122](https://github.com/PIGU-PPPgu/edupi-desktop/pull/122) 将版本推进到 `0.3.13`。Release workflow [34995513104](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/34995513104) 的 macOS、Linux、Windows 分别用时14分40秒、15分58秒、21分50秒，manifest 16秒；三平台并行后整轮约22分钟。正式 Release 含11项资产，`latest.json` 的7个平台键全部带签名，组件为 Desktop `0.3.13`、Pi `0.84.1`、pi-web `0.8.7`。
- 本机磁盘只找到 `/Applications/EduPi.app` 一个安装副本，当前为 `0.3.11`；其真实更新接口已返回 `latestVersion=0.3.13`、`updateAvailable=true`，原生设置页也显示可用的“更新”按钮。升级前基线为 Core/projection/Kernel ready、50名学生、240个任务、43个校历节点、9个课表、45条记忆、9个自定义模型；尚未执行安装，不把升级重启与数据保持记为通过。
- Tauri macOS updater 的实际实现会先把当前 `.app` 移到临时备份，再把新包移动回同一路径；正常应用内更新替换当前安装，不另建版本副本。Desktop [#123](https://github.com/PIGU-PPPgu/edupi-desktop/pull/123) 已接入 Developer ID 证书和可选公证凭据，并在缺少凭据时明确警告临时签名。仓库当前没有 Apple 证书类 Secret，因此 `v0.3.13` 仍是临时签名；Apple 确认 TCC 依赖稳定代码身份，辅助功能与屏幕录制授权可能在更新后需要重新开启。[Apple 说明](https://developer.apple.com/forums/thread/819406) [Tauri 环境变量](https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/reference/environment-variables.mdx)

## 2026-09-15 `v0.3.12` 发布与更新检测

- Desktop [#119](https://github.com/PIGU-PPPgu/edupi-desktop/pull/119) 将四处版本元数据统一到 `0.3.12`。Release workflow [34983508483](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/34983508483) 的 macOS、Linux、Windows build 和最终 manifest 全部成功，`v0.3.12` 已发布为非草稿、非预发布的 Latest Release。
- Release 包含 DMG、macOS updater、AppImage、deb、Windows NSIS、对应签名、`latest.json` 与 `component-versions.json` 共11项资产。`latest.json` 的7个安装/更新平台条目均带签名；组件清单为 Desktop `0.3.12`、Pi `0.84.1`、pi-web `0.8.7`。
- 本机已安装 `v0.3.11` 的 `/api/updates?refresh=1` 实际返回 `latestVersion=0.3.12`、`updateAvailable=true`、release status `available`，证明既有客户端可以在应用内检测并下载更新，无需用户重新寻找安装包。本轮只验证检测，没有替用户点击安装。
- 本次三平台因 `max-parallel: 1` 串行耗时约55分钟。Desktop [#120](https://github.com/PIGU-PPPgu/edupi-desktop/pull/120) 将独立平台并发数改为3，同时保留每平台质量门、Rust测试、签名、草稿保护、全平台 manifest gate 和失败通知；按本次各平台耗时，后续完整发布预计约22–25分钟。
- Windows/Linux 应用内升级、Apple 公证、系统通知点击和真实睡眠唤醒仍未验收；按用户要求 Windows 人工优化与应用内升级后置，不再阻塞本地产品主线。

## 2026-09-14 `v0.3.11` 发布与三平台安装复核

- Release workflow `34765761183` 的三平台构建和 manifest 全部成功；`v0.3.11` 为正式 Release，DMG、macOS updater、AppImage、deb、NSIS、三平台签名、`latest.json` 与组件清单齐全。
- macOS updater tar.gz 的 SHA-256 为 `d90947b7cf3bd0b2d6907020e45e6f521e3eca9b072265c75eb3698ae7438a37`，与远端 digest 一致；将本机 Base64 公钥和 `.sig` 解码后，`minisign-verify 0.2.5` 校验成功。解码文件仅用于临时验收。
- 本机已安装并启动 `v0.3.11`，原生导航显示版本正确，既有教师工作区仍可读；安装包内置 server 的隔离恢复测试确认启动立即 due-scan、后台任务 attempt 2 恢复、旧工具进程退出和产物登记。
- Windows published-install run `34770908602` 与 Ubuntu 24.04 published-install run `34770910836` 均成功。它们验证公开安装包安装与启动，不替代 Windows/Linux 从旧版点击应用内升级。
- 下一安装版将包含 Desktop #102/#103 和 Core #66/#67 的真实睡眠间隔监测、Runtime health、后台进度与 Core 投影对齐；当前 `v0.3.11` 不包含这些后续提交。Apple 公证、Windows/Linux 应用内升级和系统通知点击仍未验收。

## 2026-09-13 `v0.3.10` Windows 修复发布与验收

- Release workflow `34754561484` 的 macOS、Linux、Windows 和 manifest 全部成功；`v0.3.10` 已发布为非草稿、非预发布版本，三平台资产、签名文件、`latest.json` 和组件清单齐全。
- Windows published-install workflow `34757893517` 成功：从 `v0.3.10` NSIS 安装包安装并启动，工作区服务可用，Tauri native source check 通过。
- Windows acceptance workflow `34758285479` 成功：同一已安装可执行文件第二次启动后退出，运行中的 `pi-agent-desktop` 保持单个，覆盖单实例回归。
- 本机 `v0.3.10` 安装包模型测试实际提交缺失 `cacheWrite` 的 cost 对象，返回 HTTP 200 / `OK`；说明 Windows 报错的 schema 路径已在包内修复。单实例插件 Rust 编译和本机 Tauri 21 项测试通过。
- 未验证：Apple 公证、Linux/Windows 应用内升级、系统通知点击与睡眠唤醒；真实 Provider Key 仍未写入正式账户。

## 2026-09-13 `v0.3.9` Provider 模型配置发布与本机包复核

- Release workflow `34738213112` 的 macOS、Linux、Windows build 和 manifest 全部成功；`v0.3.9` 已发布为非草稿、非预发布版本。
- Release 资产包含 DMG、AppImage、deb、Windows NSIS、macOS updater tar.gz、三平台签名文件、`latest.json` 和 `component-versions.json`。`latest.json` 的 `darwin-aarch64`、`linux-x86_64`、`windows-x86_64` 均指向 `v0.3.9`；组件清单为 Desktop `0.3.9`、Pi `0.84.1`、pi-web `0.8.7`。
- 本机远端 macOS updater tar.gz SHA-256 为 `39627a85d77d13283358344981bc91bd628df932cbb9cf3eda15b5bb78533c71`，与 GitHub asset digest 一致；使用本机 updater 公钥复核签名为 `valid`。
- `/Applications/EduPi.app` 已从 `v0.3.8` 备份并替换为签名 `v0.3.9` 包后启动。Info.plist、`/api/updates?refresh=1` 和 `/api/edupi/status?summary=1` 分别回读 `0.3.9`、up-to-date、Core/projection ready；工作区回读 50 名学生、237 个任务、43 个校历、9 个课表。
- 安装版模型接口回读默认 `zai-coding-cn/glm-5.2`，模型列表包含 DeepSeek、Z.AI Coding CN 和自定义 `edupi-test`；管理中心页面显示 `v0.3.9`。进一步使用该安装包内置 server、临时 HOME 和临时 Key 实际完成保存 Key→自动加载 2 个模型→添加同面板自定义模型（3 个）的页面流程，临时环境已清理。
- 未验证：Apple 公证、Linux/Windows 应用内升级、系统通知点击与睡眠唤醒；未在正式教师数据或正式账户上输入 API Key。

## 2026-09-12 本地签名复核（取代“缺少私钥”的当前风险描述）

- 已找到本机永久 updater 密钥对：`~/.config/edupi-release/updater.key` 与 `.pub`。用私钥对临时文件签名成功，确认该私钥未设置密码。
- GitHub 仓库 Actions Secret 名称 `TAURI_SIGNING_PRIVATE_KEY`、`TAURI_UPDATER_PUBLIC_KEY` 已存在；`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 不需要补值。Core 仓库实际为私有，当前正式 Actions 使用仓库专属只读 deploy key `EDUPI_CORE_DEPLOY_KEY`；旧宽权限 `EDUPI_CORE_READ_TOKEN` 已删除。
- 使用本机密钥临时注入公钥后，最终 `EduPi.app.tar.gz` 已生成对应 `.sig` 文件（404 bytes）；随后恢复源码中的临时公钥配置，没有提交密钥或配置改动。
- 当前剩余事项是 Linux 实机安装与应用内升级、Apple 公证、系统通知/睡眠唤醒和真实课堂内容质量；本地签名、正式 Release 与 Windows runner 安装阻塞已解除。

## 2026-09-12 正式发布链路准备（取代“缺少 Core token”的当前风险描述）

- Desktop 版本已从 `0.3.6` 推进到 `0.3.7`，`Cargo.toml`、`Cargo.lock`、包元数据和 `component-versions.json` 已保持一致。
- `release.yml`、`preview-installers.yml`、`windows-build-debug.yml` 当前优先使用 `EDUPI_CORE_DEPLOY_KEY`，并保留 token/public mirror fallback；私有 Core checkout 缺少 deploy key 时会在 checkout 阶段明确失败。
- Core 修复提交 `6b1d0cf74d7a1344c881da8e34a857243e315fdb` 已通过本机全量回归并合并到公开 Core `main`（PR #58，合并提交 `ea3b1dd175d3521546cc2b3ff685f6c9c7a360c6`）；Desktop Actions 现在可以按精确 pin checkout。
- 仍需远端实证的项目是 Linux 实机安装与应用内升级、Apple 公证、系统通知/睡眠唤醒和真实课堂内容质量；正式三平台 Release 与 Windows runner 安装已在下方记录。

## 2026-09-13 正式 `v0.3.7` Release（取代远端发布未验证状态）

- 首次 Release run `34701579391` 的三个平台均在私有 Core checkout 失败，根因为 `EDUPI_CORE_READ_TOKEN` 未设置；没有生成草稿或发布资产。
- 当时使用现有 GitHub 登录凭据临时写入 `EDUPI_CORE_READ_TOKEN`，不回显 token；重跑 `34702177745` 成功。随后改为仓库专属只读 deploy key，并删除该宽权限 token。
- `v0.3.7` 已发布为非草稿、非预发布版本：DMG、AppImage、deb、Windows NSIS、三类 updater `.sig`、macOS updater tar.gz、`latest.json` 和 `component-versions.json` 均存在；`latest.json` 的 `darwin-aarch64`、`linux-x86_64`、`windows-x86_64` 三项均有签名和 `v0.3.7` 下载地址，组件清单 `appVersion=0.3.7`。
- 仍未完成的是 Windows/Linux 实机安装与应用内升级、Apple 公证、系统睡眠唤醒/通知点击和真实课堂内容质量；CI 产物存在不替代这些验收。
- Windows published-install run `34705099213` 已在干净 Windows runner 安装并启动 `v0.3.7`，同时 native source check、私有 Core diagnose、资源 stray-scan 和原生命令检查均通过。

## 2026-09-13 CI 读取权限与 Linux 安装验收

- 私有 Core 的 Actions 读取已改为仓库专属只读 deploy key（Core key id `163097454`），Secret 为 `EDUPI_CORE_DEPLOY_KEY`；原有宽权限 `EDUPI_CORE_READ_TOKEN` 已删除。preview workflow `34710502746` 的 macOS/Windows checkout、质量和预览构建全部通过。
- Linux published-install workflow `34711422997` 已在 Ubuntu 24.04 下载并安装 Release `v0.3.7` 的 `.deb`，在 Xvfb 下启动已安装二进制，Core/projection readiness 检查通过。
- 当前剩余边界收窄为 Apple 公证、Linux/Windows 应用内升级、系统通知/睡眠唤醒和真实课堂内容质量；Windows 首次安装与 macOS 应用内升级已有证据。

## 2026-09-13 macOS 应用内升级验收

- `/Applications/EduPi.app` 升级前为 `0.3.6`；设置页真实检查返回 `latestVersion=0.3.7`、`updateAvailable=true`。先备份旧应用到 `/var/folders/xk/qmn_r8g93ljb7b5vqzq3rd040000gn/T/edupi-before-037-4bf_lkm1/EduPi.app`。
- 第一次下载在约 80% 返回原生 `error decoding response body`，进程和旧应用保持不变；点击重试后下载、签名校验、安装和 relaunch 均成功。
- 重启后的原生窗口显示 `v0.3.7`；`/api/edupi/status?summary=1` 返回 Core/projection/Kernel `ready`，计数为 students 50、tasks 237、calendar 43、timetable 9；`/api/updates?refresh=1` 返回 current/latest `0.3.7` 和 `updateAvailable=false`。
- 升级前后 `.edupi` 文件清单均为 121 个；变化仅落在 dingtalk/kernel/rhythm/teacher-review 与 Core runtime 状态文件，学生、任务、校历和课表投影均重新读取成功。Linux 实机安装、Apple 公证和通知/睡眠唤醒仍未验收。

## 2026-09-13 `v0.3.8` 发布与本机安装复核

- Release workflow `34714343043` 的三平台 build 与 manifest 全部成功；`v0.3.8` 已发布为非草稿、非预发布，资产和签名元数据完整。
- 远端 `latest.json` 的 `darwin-aarch64`、`linux-x86_64`、`windows-x86_64` 均指向 `v0.3.8`；`component-versions.json` 回读为 Desktop `0.3.8`、Pi `0.84.1`、pi-web `0.8.7`。
- 本机 updater tar.gz 用公钥复核成功；由于 Mac 锁屏无法操作原生设置页，本次将已安装 `v0.3.7` 备份并替换为签名 `v0.3.8` 包后启动。应用版本、Core/projection readiness、50/237/43/9 工作区计数和 up-to-date 状态均回读成功。
- Apple 公证、Linux/Windows 应用内升级、系统通知点击和睡眠唤醒仍未验收。

## 2026-09-12 Today 修复包（取代下方旧 Core pin 记录）

- 最终包配套 Core pin 为 `6b1d0cf74d7a1344c881da8e34a857243e315fdb`，Desktop component manifest 为 `sha256:9f28910f0886fcfed4509729af8361749cbd0f0cf3b48df4093db34fed6728b5`。旧的 `deda34d… / b29eb3…` 记录仅保留为历史证据；writer detector 矩阵和 daemon manifest 断言均已同步。
- 钉钉长驻进程不再独占 Core 写锁；最终包启动后钉钉为 ready，空闲 writer admission 可由另一写入者成功取得并释放。
- 隔离打包服务真实执行一次 Today 接受：HTTP 200、receipt `accepted`，重新读取为 `accepted / closed_accepted`，证明包内 UI 所接的写入链可持久化并重新投影。
- Today 页面已显示“待你决定 / 稍后处理 / 已记录”，动作反馈和刷新/重试入口随包交付。macOS 原生窗口已冷启动并截图核对。
- `tauri build --bundles app` 已生成 `.app` 和 tar.gz；updater 私钥缺失导致签名步骤退出，未上传发布。Windows/Linux 实机安装升级、签名/公证仍未验收。

## 2026-09-12 本地修复包状态

本地打包已使用锁定 Core `deda34d7523b5267602a5629027c367a91acaa7a`（Desktop component manifest `sha256:b29eb3…`）生成 `EduPi.app` 并实际冷启动；最新序列首个状态响应约 2.4 秒即为 ready，内置服务监听 38472，Core、教育投影和 Kernel 返回 ready，真实工作区为 50 名学生、9 个课表、43 个校历节点、237 个任务，原生窗口可见。构建最后的 updater 签名步骤因当前环境没有 `TAURI_SIGNING_PRIVATE_KEY` 失败，未上传或发布此包；DMG/updater 签名和跨平台升级仍未完成。

同一包还包含 R03 下一次计划运行显示、R05/R10 来源跳转、R13 多产物入口和 C6 识别可选字段兼容；启动初期的 Core process 状态会在运行时完成后恢复为 ready，最终状态请求已回读 ready。

最终包的模型测试路由用临时 localhost mock 服务复核通过：未提供 API key 时返回 `ok=true`、HTTP 200 和 `OK`，测试服务未写入持久配置。

用临时数据根启动同一 `EduPi.app` 的独立 38471 实例完成文件补录 E2：历史会话 `write` 结果登记 1 份文件并重新读取成功；临时实例关闭后正式 38472 服务恢复 ready，未改真实教师数据。

## 2026-09-09 Windows安装基线

后续运行 `34316941057`：公开版安装检查及当前原生代码编译均通过。原生编译使用公开版资源夹具，不包含新版Core/前端完整构建；私有Core构建仍未执行，不能据此宣称新版Windows安装包已通过。

- 运行 `34315814729` 的独立 `published-install` job通过：Windows GitHub runner从公开Release下载v0.3.6 x64 NSIS，安装退出0，应用进程保持运行，`/api/edupi/workspace`返回200。
- 这是干净Windows runner安装与服务启动证据，未复现用户本机失败，也未验证窗口操作、旧版升级或新通知回调。用户系统版本、失败步骤/日志仍缺失。
- 同次 `diagnose` job失败于私有Core checkout：`EDUPI_CORE_READ_TOKEN`不存在。没有进入新版编译；未将个人GitHub凭据上传替代。新品跨平台构建/发布依赖恢复相应读取凭据。
- 当前已安装macOS v0.3.6出现工作区503。新Core已只读验证其真实237条任务可投影；修复尚未发布，未改写安装包或教师数据。

## 新增发布要求

用户反馈 Windows 安装包无法正常安装。状态为待复现，不能归因为系统拦截或安装器缺陷，尚缺报错、系统版本与失败步骤。构建通过不作为安装通过证据。

排查与验收：

1. 从公开 Release 下载确切版本，记录 Windows 版本、架构、安装权限、失败步骤和安装日志；分别复现全新安装、覆盖旧版、安装后首次启动。
2. 定位 NSIS、WebView2、文件路径、运行库或应用启动的具体失败点，修复后使用同一环境复测。不以关闭系统保护作为修复。
3. 每次发布后保留旧版客户端，从桌面设置检查公开 Release，确认能识别新版本；实际下载、验签、安装并重启，核对新进程版本及工作区可用。
4. 核对教师资料、模型配置、课程、材料和原 Pi 配置仍保留；网络失败后可重试，升级失败可继续使用旧版。
5. macOS、Windows 分别记录完整升级证据。缺少实机时标为未验收，不能借用另一平台或 CI 的结果。

本轮先继续功能开发，安装版延后统一更新。发布前必须处理 Windows 安装反馈；首次定位所需截图或日志可由用户补充，不阻塞其他本地功能。

## 范围

现有更新检测可用，但 v0.3.5 未内置更新公钥，Rust 未注册 updater 插件。旧用户需覆盖安装一次启用版；后续保留同一个公钥验证更新。

## 发布

- 专用私钥仅存受限本机配置目录和 GitHub Secrets，不提交源码。
- v0.3.6 使用既有 release.yml 生成平台安装包、签名和 latest.json。
- Linux 补 AppImage，Debian 安装包不能替代 Linux updater 产物。
- 各平台质量和构建成功后才能公开 Release。
- 更新包签名不等于 Apple 公证或 Windows Authenticode；不宣传为已获系统认证。

## 验收

- [x] 更新公钥配置、发布工作流定向测试 27 项通过。
- [x] 远端平台包、签名、latest.json 完整。v0.3.6 已公开；Mac/Windows 构建通过，Linux 最终运行 34057453397 的 build/manifest 通过。
- [x] 本地启用 updater 的 0.3.5 测试包检查到 0.3.6。安装版 `/api/updates?refresh=1` 返回 updateAvailable=true。
- [x] macOS 实际下载、签名验证、安装、重启到 0.3.6；教师身份、课程和 27 条记忆可见，工作区 HTTP 200。不是全面数据一致性审计。
- [ ] Windows 安装内升级实机验收；构建通过不代表实机通过。

升级前保留旧应用，更新失败不删除教师数据。签名私钥不得重新生成替换，否则已安装客户端将无法验证后续更新。

## 2026-09-07 实际结果

- 发布地址：https://github.com/PIGU-PPPgu/edupi-desktop/releases/tag/v0.3.6
- PR #60、#61、#62、#63、#65、#66、#67、#68 已合并，分别修复发布配置、质量检查顺序、npm 命令、Linux 构建库、Windows 文件检出、单平台重试、AppImage 处理和错误 libc 可选包。
- 完整发布包含 Mac tar.gz + sig、Windows exe + sig、Linux AppImage + sig、latest.json 与组件版本文件。
- 本机当前是启用 updater 的 0.3.5 验收包，原应用备份 `/tmp/edupi-before-updater.r1k28J/EduPi.app`。未声称已经自动升级至 0.3.6。
- 原生点击验收受阻：Orca 报 `permission_denied`，应用有可见窗口但 AX 无法读取；权限查询显示 granted，restore-window 重试仍失败。需要可访问的桌面会话后继续“检查更新→升级→重启→版本/数据核对”。不绕过系统访问限制。
- 构建临时 Core checkout token 已从 GitHub Secrets 移除；正式 updater 签名密钥保留供后续版本使用。
- 旧的无 updater 版本必须先手动覆盖安装一次 v0.3.6，以后才具备应用内更新能力。

### 解锁后完成原生验收

用户解锁后，通过设置中的“检查更新→更新”实际升级。首次原生清单请求发生网络错误，手动重试后成功进入安装并重启。未绕过签名校验，未用手动拷贝替代此次升级。

应用进程从 44392 变为 12712；Info.plist 显示 0.3.6，界面管理中心显示 v0.3.6；安装版检查接口返回 currentVersion=latestVersion=0.3.6。工作区接口 HTTP 200，教师身份、学科年级、课程及记忆仍可读取。此前窗口访问阻塞已解除；上文 0.3.5 状态为历史记录。Windows 和 Linux 的安装内升级尚未实机验证。
