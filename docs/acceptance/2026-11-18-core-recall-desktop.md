# R04 Core 问答接线

当前状态：源码接线已实现，隔离工程组合验收进行中；普通 R04 语义放行与签名安装尚未通过，签名发布另受依赖审计阻塞。Core 已完成同树合并及主线精确 CI，Desktop 已固定最终 pin 并正常合入最新主线班级与账号功能。R04、R15、完整 L4 均不勾选完成。本文挂回原路线图，不建立另一份任务计划。

## 版本与环境

| 项目 | 实际版本或边界 |
| --- | --- |
| Desktop | `codex/r04-core-answer-desktop-20261117`，checkpoint `61857d9`，合并 `9d1b4c45` 后 HEAD `e8412aaa159a76e65e6db433a8fc355489a68a16`；当前仍有未提交组合修改和新增文件，`.118` 为源码候选 |
| Core 开发候选 | `b60d4b29bf827a8e7822ba00f5cacef7f351b811` |
| Core 最终合并 | `fc89b3bc899a55b0fdad61b8f37e238d950f37c6`，与受测候选同树；官方候选 CI `44123145520` attempt 2、最终 main CI `44145905596` attempt 1 成功；Windows/visual 条件 skip 不算通过 |
| Core tree | `ed98dad0591a4d273c4d571a7e116c732354f582` |
| Runtime schema | `sha256:815da174d88273e2d8df1039fce600eff7999455c2a30af8ebdcfe1627fe1e2d` |
| Runtime component | `sha256:c872f949b8e79d65fc87d778744fb87345186bb6af62b97a6d42df53b27768be` |
| Desktop component | `sha256:9e2011b079292f9adb8be6ebfea670cbae8d9f04f5414f81121db542b26082a6` |
| Bridge 1.1 | `sha256:4d406ea05466f525d68e9a5c2e8f21b05a1013346fff5962a3ccc0ea61398b1d`，五份 fixture 逐字配对 |
| 数据 | 新建合成 Main4 根；不使用真实教师资料、全局认证或已装 App |
| 页面 | 已关闭的旧空间不复用；当前空间由私有 `active-ego.json` 定位，`127.0.0.1:61436`；使用官方 Tauri mocks 和本次测试进程 token，不是原生安装版 |
| 模型 | 合成本地 SSE assessor；不证明真实 GLM 语义质量，不使用其他账号、key 或付费路径 |
| 发布 | `.117` 公开预发布资产、标签及正式 Latest `.70`、feed 均冻结；本轮没有签名或部署 |
| Windows | 用户于 2026-11-17 因费用暂停；本轮没有 Windows runner、构建、打包或安装验收 |

证据位于私有本机验收目录 `r04-desktop-20261117.noindex/`，具体位置由私有续接文件的 `desktopCurrent.evidence` 定位。当前进程与 fixture 路径以其中 `active-next.json`、`active-provider.json`、`active-r04-fixture.json` 为准，不能使用较早的 PID 或已删除的 A 会话续接。截图绑定记录采样时间和源码快照边界，不把稍后采集的 dirty snapshot 冒充截图瞬间的精确版本。

## 已实现的边界

- 正式问句通过真实 owner registration/capture 和 SDK user entry 绑定；Core 原文及逐 facet 引用保存为 canonical custom，不交给聊天模型改写。
- 原始 query、identity、registration 和全部 selection 只保存在服务器私有绑定；复核只追加 `answer_receipt_ref`，不补默认筛选，不退回旧 no-query memory list。
- capture、SDK、query、原文 hash 均保留首尾空白和换行。只用 `trim()` 检查是否为空。
- 运行内 current 不落盘。冷重启、来源或授权失效、取消、换会话和过期都不能凭保存的 true 恢复 current。
- 人物确认使用较早的含姓名来源，显式 read → confirm → read，支持 revision 0；未知写入保持 `factWrite:null`，不自动重试。
- SDK 在正式 Core 回合前的自动 compaction 由公共 hook 取消。普通后续模型上下文排除历史 Core custom。
- 本地 submission 尚未结束时不接受 server idle 提前结算；纯 artifact 刷新不撤销答案，真实来源事件仍撤销。

## 实际证据

| 检查 | 实际结果 | 证据 |
| --- | --- | --- |
| Bridge 精确配对 | 冻结候选 12/12 通过，无 skip | `EDUPI_CORE_ROOT=<b60辅助树> node --test lib/edupi-bridge-contract.test.mjs` |
| raw 全链路 | 真实 Core registration/capture → SDK 保存 → 两次完整复核均 current；1 次合成 facet、0 次聊天模型；裁剪 query/hash、改票据 query、撤回来源被拒绝 | `raw-binding-review/commands.txt`、`final-paired.log`、`raw-core-b796c0ff-72e2-4bc5-b27a-2ffe856c5792.json` |
| raw 相关回归 | 八个配对测试文件 272 passed，0 failed，0 skipped | `raw-binding-review/final-paired.log` |
| 发送与 UI 回归 | mounted/callback、发送生命周期和消息身份合跑 110 passed；删除三个 submission guard 分别得到预期失败 | `components/CoreRecallAnswer.behavior.test.mjs` 及对应发送、hook 测试 |
| 实际页面新问题 | Core 原文和两条引用、空草稿、无 abort 尾信息；保存时连续 18 次完整复核 current | `browser-b60-live-current.png`、`browser-b60-live-current.json` |
| 原图版本绑定 | 原 PNG/JSON 未覆盖；记录 SHA-256、实际 health、Core tree/schema/双清单、Desktop dirty 状态与限制 | `browser-b60-live-current.binding.json` |
| settled 后回读 | SDK custom 原文、两 facets 和 UI receipt 一致；未保存 `coreRecallLive`；合成 facet 1、聊天 0 | `browser-b60-settled-persistence.json` |
| 实际进程重启 | 重启前已保存的 current receipt 返回 historical，没有凭落盘 true 恢复 | `browser-b60-current-receipt-after-restart.json` |
| 离开重入及手动复核 | 回到原会话为历史回答，草稿保留；明确重新核对后恢复 current，前后 facet 均 3、聊天均 0 | `browser-b60-layout-reentry-current.json` |
| 实际来源撤回 | 来源会话 DELETE 200、回读 404；独立查询会话仍为 200；11 条真实 Core source withdrawn，旧 receipt held/source_changed，页面撤销 current，模型计数不增 | `actual-source-withdraw-full-proof.json`、`source-withdraw-query-ui-held.json` |
| 纯时间和重启反例 | 冻结 Core 的 `--receipt-only` 检查通过：Goal/person grant 到期、同 Runtime 来源变化、重启失票 | `node scripts/test_core_runtime_recall_answer_v4.mjs --receipt-only` |
| 独立复审 | raw、SDK、private receipt、人物、UI 生命周期和 submission guard 未发现新增实质缺陷；不替代页面验收 | Faraday、Turing 独立只读结果 |
| 最终 Core 新根页面 | 人物 read→confirm→read 后，新的问题显示“本轮核验”、Core 原文与两项逐项来源；2 次合成 facet、0 次普通聊天 | `browser-fc89-current.png`、`.json`、`.binding.json`；早期 `person_unverified` 卡片仍保留 |
| 普通恢复与取消复审 | 两项 P2 修复前 7 个反例失败，修复后 70 passed、0 failed、0 skipped；原 reviewer 核对源码哈希后关闭 | `r04-recovery-review-fixes.tap`；只读 GET 不改写，后续 POST 收敛已持久 ACK，DELETE 恢复独立 conversation |
| 输入原文与只读 GET | 真实组件的首尾空格／换行／Tab 在 POST 和 pending.message 中逐字保持；raw 513 字拒绝；带查询参数的 GET 携带原生 token | `raw-composer-and-inspect-regression.tap`，16 passed、0 failed、0 skipped |
| Main4 模板正式 API | 独立授权后周／月创建、重复提交与真实冷重启回读通过；模型和模型配置请求均 0，seed host 剩余 0 | `fc89-native-l4-fixture-1/native-l4-fixture.json`；该轮是 dirty 源码准备证据，不能替代最终冻结源或原生安装 |
| 模板停止与版本竞态 | local-first、Core unknown、关闭 unknown、并发替代、48s 虚拟 deadline、pending／failed drain 跨域拒绝及晚到关闭覆盖；最终临时 host 的旧配置身份问题已修 | `template-storage-and-stop-integration.tap`，93 passed、0 failed、0 skipped；最终整合继续按新哈希记录 |
| Main4 两期实际执行 | 显式迁移的合成 Main4 根上，两期各 2 份 507 bytes 产物，attempt 1；文件接口／磁盘／持久 SHA-256 一致；10 次实际 Core 启停，G1 始终关闭、0 模型、0 模型配置请求 | `fc89-recurring-two-periods-3.log`，前两次失败保留；模拟 +7 天不证明自然七天 |
| 请求内 roots 与最终停止竞态 | 220 passed、0 failed、0 skipped，包含每请求 1 次完整校验、跨 Core await 换根／停用、最终 drain 被新选择替代时拒绝误报 disabled | `request-roots-and-final-stop.tap`；SDK／outbox／intent／Core 完整复核保留，不跨请求缓存 |
| 不可见读取 | 管理中心 5 组件 100 passed；教育页覆盖、可见性、初始 kernel 去重与显式 mutation readback 47 passed；补充 3 种事件在途取消的定向组 7 passed | `admin-read-activity.tap`、`education-read-activity.tap`、`education-event-read-cancel.tap`；不据 mock 数量宣称实际延迟通过 |
| 实际页面安全停用 | 新问为 current 后按停止，持久配置变为 off，current 1→0，G1 文件 hash 不变，facet 4→4／chat 0；UI 28.2s 后仍待核对，后续 Core unavailable | `browser-r04-stop-1794954658099.*`、`fc89-r04-stop-runtime-readback.json`；只记安全关闭和撤核验，不记完整停止、健康或延迟通过 |
| 默认服务实际关闭 | 实际 C0 capture／Core 模型 IPC 后，默认 settings＋supervisor 在 2543ms 返回 stopped／none，替代实例健康，冷启仍 off，facet 1／chat 0，清理 closed true | `r04-settings-real-runtime-4.tap`；直接 Core 生命周期证据，SDK 绑定由配对 raw 检查覆盖，实际新源码页面链仍另验 |
| 真正进程冷恢复 | 自有 Next／Core PID 全部退出后冷启，Core ready、recall off、旧票据 historical；normal 开启 403，session／G1／recall 三个文件 hash 不变，facet 4／chat 0 | `r04-cold-off-and-gate-final.json`；普通语义门仍 false |
| 修复后实际 SDK 页面 | 新合成根先经真实 Core 人物准备，再从实际页面发送；SDK 回答 current→点击停止→UI“已停止”、current 1→0、Core ready，G1 hash 不变、facet 1→1／chat 0 | `fixed-sdk-stop-1794959269454.*`；7733ms 包含页面撤核验与 status 回读；取代旧 unknown／unavailable 的该页面欠项，保留旧失败，不代表原生安装或真实 GLM 通过 |
| 全量源码检查 | 4946 tests，4889 passed、0 failed、0 cancelled、57 conditional skipped；类型检查、lint 通过，现有 `_text` lint warning 保留 | `full-source-suite-2.tap`、`frozen-candidate-typecheck.log`、`frozen-candidate-lint-2.log`；57 个条件检查不作通过 |

## 已保留的失败与修复

1. 旧 Bridge hash 导致 503 `unknown_schema_hash`。同步完整 schema、五份 fixture 与清单修复，没有放宽校验。
2. 快速 context-only 答复先于 ACK、SDK 空 abort 先于 custom 的顺序曾使 final 消息和运行内资格错位。现按真实 entry ID、请求与会话处理；只隐藏已知空 abort，其他 provider 错误保留。
3. AppShell 结算时的纯 `edupi-artifacts-updated` 刷新曾被当成来源修改。现只允许明确的 `refreshOnly:true` 免于撤销。
4. 真实 SDK 在新 user entry 前自动 compaction 曾产生额外模型请求。公共 hook 取消该回合 compaction；SDK 强制阈值回归确认聊天及摘要模型为 0。
5. capture 裁剪原文但 query 保留原文，导致 `query_changed`。已统一 raw 绑定，真实 Core 及既有 legacy capture 回归通过。
6. preflight/capture/ACK pending 时的 idle 轮询曾提前通知完成。GET、finisher 入口及 `finally` 均有 submission guard，包含延迟 idle 响应反例。
7. 重入后的完整 Core 复核实际为 current，只有 Desktop `epoch:false`：前台 catch-up 的 `connector-setup/start_runtime`、`agent-computer/claim` 被当成来源修改。保留 `browser-b60-reentry-epoch-failure.json`；现仅这两项恢复操作不触发来源 fence，其他 Bridge 写入、owner 写入、关闭和重启仍撤销。17 项 supervisor 配对检查及独立审查通过；实际新回答、重入与无模型手动复核通过。
8. 开发页冷编译曾超过 6 秒及 10 秒 deadline，正常“重试”可恢复。失败未改绿，不以预热开发页替代安装版冷启动。
9. Fast Refresh 的 passive cleanup 晚于替换后的 layout load，作废新请求的 run id，留下永久 loading。改用 layout cleanup；真实 Refresh runtime 的内存反例可复现旧行为，普通 StrictMode 初次重放本身不能证明根因。能力探测另与每轮来源撤销解耦，对网络错误/503 做有 deadline 的有限重试；false/403 不重试，恢复入口后仍需独立 POST 才能 current。
10. 来源撤回场景先尝试 C1 reviews，实际 503，未记成功。原 fixture 两条种子只写了真实 outbox/SDK mapping，漏了 Desktop 撤回 mirror；补录只依据精确已捕获 outbox 和实际 SDK accepted 证据，不写 Core authority/current。保留 `synthetic-source-ledger-repair.json`；fixture 种子已改为与生产 registration/capture 同步记录 mirror，后续不得依赖手工补录。之后通过普通 session DELETE 完成真实 Core 来源撤回，不据此宣称 C1 reviews 在 Main4 可用。
11. 普通入口只读 inspect 曾调用不接受查询参数的 path-only 原生 helper，导致请求在本地被拒绝。现 GET 使用固定接口、编码后的查询参数和原生 token；helper 的纯路径限制保留。
12. inspect 确认 accepted 后旧 outbox 未收敛，曾阻塞下一问；管理中心取消又曾使用旧 G1 conversation。新 POST 在会话锁内按精确 SDK markers 收敛旧 ACK，取消按持久 R04 intent 绑定原 conversation；不重新发送旧问题。
13. 全局模板停止曾先访问 Core 再落本地 false；现先 CAS 持久关闭，再有界关闭旧 host 和暂停独立 grant。pending／failed drain 不能被其他领域的 clear／ensure 绕过；若模型忽略取消，48s 后返回 unknown 并保留同根隔离，须实际完成 drain 或恢复进程才能重新启动。48s 的真实墙钟等待未单独计时，现有证据是虚拟 deadline 与生产控制流。
14. Core pause 回读后会推进第二个配置版本，原临时 host 曾滞留在第一个版本而令后续 ensure 失败；现停止事务结束后再次严格关闭临时 host，关闭失败不报 verified。实际停止后的教育／历史回读仍需本轮现场证据。
15. 两期脚本第一轮在 legacy 根上请求新 Main4 模板，创建 503；第二轮迁移到 Main4 后又因模板专用启动误带 `ownerMessageContinuation` 而失败。两个原失败日志分别保留为 `fc89-recurring-two-periods-1.log`、`-2.log`；已改为合成根明确迁移和模板独立参数，第三轮按原两期、去重、冷启与零模型断言通过。生产选择前用固定 Core 的只读 V4 validator 检查存储，拒绝 legacy 而不写未来启用状态，不迁移真实根。
16. 实际页面的小 GET 曾超时，独立进程测得完整 Core 校验单次 0.7–1.0s；同一次回答复核原有 3 次完整校验，多个收起或被覆盖界面仍读取投影。现保留每请求一次完整校验、跨 await 的现时数据根／SDK／授权检查，并暂停不可见界面的只读读取；命令和 mutation readback 不被暂停。实际响应时间仍待现场复测。
17. R04 stop 先持久 false 后默认 ensure，会因驻留实例身份含旧配置而在 pause 前被拒，固定返回 grants unknown。协调侧最小修复改用同根已验证驻留 handle，保留 local-first、严格关闭和 off 替代实例；18 项生产 identity 回归及 tsc 通过，独立复审关闭该 P2。此前实际 Core unavailable 仍须另验，不能只凭此修复认定消除。
18. 新增 SDK→stop 扩展回归曾在 120s 无结论，原日志、源码和合成会话已保存，确认自有 PID 停止后清理其临时根。聚焦的实际 C0／Core IPC／settings 生命周期第二轮到达 stop_returned 后 cleanup unknown，主错误又被 finally 断言覆盖；失败保留并新增受控阶段、耗时和 primary error 记录继续定位。此路径没有因既有 SDK 局部通过而改绿。
19. 第三轮受控阶段记录确认：Core 回答完成，runtime-stop 后已有 disconnect、exit，却没有 close；监督器只等 close，导致 48s 停止和再次清理均 unknown。现只把 exit／close 作为幂等退出证明，disconnect 不作证明；继续独立等待父模型 drain，二者都完成才释放 entry／隔离。虚拟与独立只读差分检查通过，第四轮实际 Core 生命周期通过；不通过增加全局 timeout 掩盖。

## 普通安装入口

原 R04／L4-P1-6 的生产放行仍未完成。普通 Tauri 的持久 R04 设置、显式每问入口、四处 activation 消费者和模型主机已接入；默认发送仍走普通聊天，只有“核对记忆”才进入独立 R04。canary 另行提供 isolated flag、private Live profile、owner grant 和已捕获来源，不能把上述页面结果记为普通安装语义验收通过。

新增 `edupi-recall-config/authorization/store` 提供私有原子写／回读、根内跨进程锁、CAS、独立 R04 grant／scope／model／consent、逐问题原文意图和跨冷启预算。普通源码语义门固定 false，启用请求拒绝且不写未来 true；stop 可否决 canary 环境且不修改 G1。used／unknown 均计数，重复 IPC id 不再授权，失账本不重建额度。模型主机对 reserve 之后的停止／配置／取消重新核对，最多 12 次的持久额度不借用旧 64 次内存上限；这些工程证据不放开真实语义门。

不需要新增 Rust 命令。缺少或损坏配置、换根、授权变化、安全模式都应关闭；不能为了 R04 自动启用 G1，不能把 G1 的旧同意或用量统计同意扩大为 R04 模型授权。普通启动的最低验收仍是：无环境开关默认关闭 → 独立授权/逐问题 capture/明确预算写后回读 → 完整退出冷启保持 → 关闭或撤权失效。

当前真实 GLM 套餐 `429/code1310` 为外部阻塞；不重试、不换账号或 key、不新增付费。Core CI、最终 pin 与 assessor 装配 ready 均不替代真实语义验收，当前不默认放开生产入口。

## 原 L4 与发布范围

本轮 R04 卡片工程证据不替代五领域、周期工作、教师反馈、系统通知、真实升级或教学内容质量。沿用 `.115/.117` 仍有效的 G3/G5、安装与升级证据；R03 已有精确事项和两份草稿证据仍不能证明发送、绑定或通知点击完成。

冻结 Core 配对的 G1/G2/G3/G4/G5 源检查、周期及反馈检查已补：九组 197 passed、0 failed、0 skipped；合成 2026-11-18/25 两期各两份 507 bytes 产物，route/磁盘/持久 SHA-256 一致，attempt 1，重启保持。三领域真实落盘产物和 synthetic feedback 保留；`synthetic_excluded=3`、`real_teacher_current=0`，未验证的反馈 source 不改绿。详见证据根 `paired-workflows/REPORT.md` 和 `summary.json`。这些是新私有根及一次性 source-candidate V3 测试迁移，`main4Checks=[]`，不覆盖旧 Main4 `create_task` 拒绝。

原 L4-P0-1/P1-4/P1-6 的 Main4 周期装配已接入精确 owner／grant／scope／显式 templateIds、窄模板 owner 通道、首次 owner create，以及 review_task modify、done／progress 和全局停止。顺序加入模板保持同 scope grant ID，旧 selection 与版本须精确匹配，不能自动全选或借 G1 授权。fixture 已更新至 fc89，周／月正式 API 准备通过；页面、同签名安装、自然到期、反馈与旧 proposal 生命周期仍分别记录，不能把确定性骨架记为教学质量。

Core 最终精确 CI 与同树合并 pin 已取得；Desktop 仍须完成最终源码复审、组合检查和同源 Mac 签名安装，之后才可更新 `.118` 发布状态。后续发布显式使用 `platform=macos`，不使用包含 Windows 的默认全平台矩阵。

## 发布阻塞

`npm run security:audit` 当前失败：15 项计数中包含 11 项 high，来自 picomatch 4.0.7 经 fdir／tinyglobby 到 ESLint 和构建 glob 的依赖链，并非 11 个彼此独立的公告。官方 `GHSA-fc5q-39xc-vjpf` 当前标注受影响版本 `<=4.0.7`，未列官方修复版本，注册表 latest 仍为 4.0.7。原审计输出保留为 `frozen-candidate-audit.log`。不降低审计门、不强制升级未知版本、不用伪造版本排除公告；签名、安装与公开 `.118` 保持外部阻塞，源码 PR 和其余可执行验收继续。

## 清理

运行中的 `.next/`、Main4 fixture 和 provider 当前用于本轮验收，不提前删除。结束时必须先停止自有 Next/Core/provider、结束 Ego，再清理确认可重建的 `.next/` 和本轮临时 fixture，保留源码、原始失败、截图、绑定及回退证据；记录实际清理路径和空间。正常 App、真实教师资料、全局模型及认证不在清理范围。
