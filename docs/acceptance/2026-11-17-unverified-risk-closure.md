# 未验收项与风险收口

## 当前状态

本段取代下方早期“源码准备中、等待重跑”的阶段状态。Desktop PR498、PR499、PR500 已正常合并；真正 `.117` 签名源为 `a55777400dea49f1ba3d953418b6965a41942c3e`，与受测 `2b1f0c14adba71fc95012b30cd453b0f6f2f6df3` 整树相同，Core 仍固定 `98e4f7cd0c31dd30954574d2040bb1b948cdd954`。旧 `2618757a` 仅为未使用准备源，没有移动旧分支。正式 Latest `.70` 与 feed `7924328ee893c9527adb54e25b0023e9f2a26ff7` 保持；完整 L4 不放行。

| 项目 | 当前结论 | 针对性证据与边界 |
| --- | --- | --- |
| R18／R20 原生鼠标 | 自动化输入限制已定位，人工鼠标未验 | 原生 `pressedMouseButtons=0`、Web `buttons=0`，实际命中把手并成功 capture 后触发松键保护；真实 hook 回归12项通过。未删保护 |
| R15 Linux `.116` | Draft 构建、真实 `.deb` 安装与两次启动通过 | Ubuntu runner，两个不同实例 ID、bundled Core/投影 ready、同一 SQLite 只读完整性通过；不是教师全流程或 GUI 鼠标验收 |
| R15 Windows `.116` | 原 all-platform run 中 Windows 实际重跑通过 | 初次 npm `ECONNRESET` 失败保留；单平台 run43919850507 的 build 被跳过，不作证据。原 run43913704753 重跑后实际 Windows job成功 |
| R15 Mac `.116` | 私有完整资产与原生安全 gate通过 | Release447334004／源13de；三包完整size/SHA、Minisign及篡改拒绝、Developer ID、票据、Gatekeeper、arm64、DMG/updater整App树及30份包内源文件匹配；未启动或安装116 |
| R15 `.116` 整轮发布 proof | 未通过，保持 Draft | 选择性重跑更新 `run_started_at`，旧代码误拒绝保留的早期Mac/Linux资产。最终整体success发布门未跳过；修复进入PR500，不将历史run failure改绿 |
| R15 版本签名 | 源码、真实CLI与密码学回归通过，实包待验 | CLI精确2.12.4，Mac重打包显式app-version，三平台最终签名gate及生产requireSignedVersion加严；原公钥、TLS、禁止降级未改。实际117签名run43967319356已派发 |
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
