# R04 Core 问答接线

当前状态：已实现，隔离工程验收进行中；普通安装入口、真实模型语义与签名安装尚未通过。Core 已完成同树合并及主线精确 CI，Desktop 正在更新最终 pin 和组合最新 main。R04、R15、完整 L4 均不勾选完成。本文挂回原路线图，不建立另一份任务计划。

## 版本与环境

| 项目 | 实际版本或边界 |
| --- | --- |
| Desktop | `codex/r04-core-answer-desktop-20261117`，基于 `c19cd15d9516bc6894aee88721025ea5c7d9063a`，本轮受测时有未提交修改和新增文件 |
| Core 开发候选 | `b60d4b29bf827a8e7822ba00f5cacef7f351b811` |
| Core 最终合并 | `fc89b3bc899a55b0fdad61b8f37e238d950f37c6`，与受测候选同树；官方候选 CI `44123145520` attempt 2、最终 main CI `44145905596` attempt 1 成功；Windows/visual 条件 skip 不算通过 |
| Core tree | `ed98dad0591a4d273c4d571a7e116c732354f582` |
| Runtime schema | `sha256:815da174d88273e2d8df1039fce600eff7999455c2a30af8ebdcfe1627fe1e2d` |
| Runtime component | `sha256:c872f949b8e79d65fc87d778744fb87345186bb6af62b97a6d42df53b27768be` |
| Desktop component | `sha256:9e2011b079292f9adb8be6ebfea670cbae8d9f04f5414f81121db542b26082a6` |
| Bridge 1.1 | `sha256:4d406ea05466f525d68e9a5c2e8f21b05a1013346fff5962a3ccc0ea61398b1d`，五份 fixture 逐字配对 |
| 数据 | 新建合成 Main4 根；不使用真实教师资料、全局认证或已装 App |
| 页面 | Ego TaskSpace 6，`127.0.0.1:61436`；使用官方 Tauri mocks 和本次测试进程 token |
| 模型 | 合成本地 SSE assessor；不证明真实 GLM 语义质量，不使用其他账号、key 或付费路径 |
| 发布 | `.117` 公开预发布资产、标签及正式 Latest `.70`、feed 均冻结；本轮没有签名或部署 |
| Windows | 用户于 2026-11-17 因费用暂停；本轮没有 Windows runner、构建、打包或安装验收 |

证据根：`/Users/iguppp/edupi-install-checkpoints/r04-desktop-20261117.noindex/`。当前进程与 fixture 路径以其中 `active-next.json`、`active-provider.json` 为准，不能使用较早的 PID 续接。原截图绑定依据实际启动记录及同一未重启 Core 的 health；原截图未冻结完整 dirty patch，该限制保留在 sidecar 中。

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

## 普通安装入口

原 R04／L4-P1-6 的生产可达性仍为未完成。普通 Tauri 启动原先没有持久的 R04 显式启用设置；四处消费者的环境判断正在集中接入新配置。canary 还另行提供 isolated flag、private Live profile、owner grant 和已捕获来源，因此不能把上述页面结果记为老师普通安装可用。

新增 `edupi-recall-config/authorization/store` 已提供私有原子写/回读、根内跨进程锁、CAS、独立 R04 grant/scope/model/consent、逐问题原文意图和跨冷启预算。26 项检查通过；普通源码语义门固定 false，启用请求拒绝且不写未来 true；stop 可否决 canary 环境且不修改 G1。used/unknown 均计数，重复 IPC id 不再授权，失账本不重建额度。API、四处消费者及模型主机仍待整合验证，不能只凭存储测试标记普通入口通过。

不需要新增 Rust 命令。缺少或损坏配置、换根、授权变化、安全模式都应关闭；不能为了 R04 自动启用 G1，不能把 G1 的旧同意或用量统计同意扩大为 R04 模型授权。普通启动的最低验收仍是：无环境开关默认关闭 → 独立授权/逐问题 capture/明确预算写后回读 → 完整退出冷启保持 → 关闭或撤权失效。

当前真实 GLM 套餐 `429/code1310` 为外部阻塞；不重试、不换账号或 key、不新增付费。Core CI、最终 pin 与 assessor 装配 ready 均不替代真实语义验收，当前不默认放开生产入口。

## 原 L4 与发布范围

本轮 R04 卡片工程证据不替代五领域、周期工作、教师反馈、系统通知、真实升级或教学内容质量。沿用 `.115/.117` 仍有效的 G3/G5、安装与升级证据；R03 已有精确事项和两份草稿证据仍不能证明发送、绑定或通知点击完成。

冻结 Core 配对的 G1/G2/G3/G4/G5 源检查、周期及反馈检查已补：九组 197 passed、0 failed、0 skipped；合成 2026-11-18/25 两期各两份 507 bytes 产物，route/磁盘/持久 SHA-256 一致，attempt 1，重启保持。三领域真实落盘产物和 synthetic feedback 保留；`synthetic_excluded=3`、`real_teacher_current=0`，未验证的反馈 source 不改绿。详见证据根 `paired-workflows/REPORT.md` 和 `summary.json`。这些是新私有根及一次性 source-candidate V3 测试迁移，`main4Checks=[]`，不覆盖旧 Main4 `create_task` 拒绝。

原 L4-P0-1/P1-4/P1-6 的 Main4 周期装配仍缺：最终 Core 已提供 `teacherTemplates`，Desktop 还需严格装配精确 owner/grant/scope/显式 templateIds、仅模板命令的 owner 通道、首次 owner create/确认和修改/暂停/恢复/反馈入口。不得自动选择全部模板、借 G1 授权或把确定性骨架记为教学质量。旧 `create-native-l4-acceptance-fixture` 固定 Core98 且只覆盖 G3/G5，不能直接作新同签名包五域证据。

Core 最终精确 CI 与同树合并 pin 由 Core 协调任务维护；取得之前不得签名、打包或宣称安装版／完整 L4 通过。后续发布必须显式选择允许的平台，不使用包含 Windows 的默认全平台矩阵。

## 清理

运行中的 `.next/`、Main4 fixture 和 provider 当前用于本轮验收，不提前删除。结束时必须先停止自有 Next/Core/provider、结束 Ego，再清理确认可重建的 `.next/` 和本轮临时 fixture，保留源码、原始失败、截图、绑定及回退证据；记录实际清理路径和空间。正常 App、真实教师资料、全局模型及认证不在清理范围。
