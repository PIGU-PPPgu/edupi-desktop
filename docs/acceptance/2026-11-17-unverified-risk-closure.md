# 未验收项与风险收口

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
