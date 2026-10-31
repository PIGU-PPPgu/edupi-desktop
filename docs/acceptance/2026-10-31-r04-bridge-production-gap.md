# R04 Core 与 Desktop 生产合同缺口

2026-10-31，Core PR #416／#417 已合至 main `2a0016a4`，Desktop PR #433 已合至 main `3edfff1d`；固定该配对的 0.3.95 Mac-only 签名 Draft 已通过资产与包内身份核验，安装版原生验收尚未执行。当前 Core Bridge v1.1 生产能力为 12 条命令和 `education_workspace` 投影；下列八条虽有 schema，Core `edupi_bridge_command.mjs` 仍返回 `unsupported_command`，不能只改兼容清单。#417 已通过现有 `review_task modify` 修订 G4 当前下次课调整草稿，不新增独立调整审核权威；教学方法 `route_verified` 无实际路由回执时保持 false。

| 预声明命令 | 缺少的生产条件 |
| --- | --- |
| `review_teaching_adjustment` | 课后调整候选的稳定目标、审核写入、回执及下次课来源失效投影 |
| `review_insight` | 当前洞察候选的 Core 来源、拒绝与抑制状态；旧 subconscious 文件不能充当审核事实 |
| `review_growth_candidate` | 成长候选的按学生隔离目标与审核生命周期；现有 G2 跟进是另一合同 |
| `review_learning_candidate` | 独立评估、重载、实际路由使用与回滚的同一候选证据链 |
| `request_action_preview` | 有界动作规格、来源和权限核验、Core 持久预览状态 |
| `approve_action` | 教师批准、一次性执行令牌和过期/重放围栏 |
| `stop_action` | 运行中停止与未知结果回执的持久恢复 |
| `report_action_result` | 原生执行 claim/final 回执、崩溃恢复与旧执行者拒写 |

`external_delivery` 需要独立版本的真实载体发送回执投影，不能用内部通知 `attention_delivery` 或旧 Markdown 推送充数。`teacher_outcome_evidence` 可参考现有 `teacher_feedback_read`，但仍缺独立版本投影和真实教师连续使用数据。两者目前均保持 unsupported，`external_send=false`。

PR #416 新增 `owner_recall_source_proof_read`：Desktop 只在当前已捕获会话的单份召回结果上调用，结果作为运行时诊断，不进入模型提示、聊天历史的“当前已核验”徽标或复合来源放行。完整的两来源同案关联与逐属性答案证明仍是 R04 未完成项。

本文件记录合同边界，不把上述缺口标为已交付。安装版复验固定 Core `2a0016a4f9499c97e705fd8d4b28acdbc49d2d91`、Desktop `3edfff1d3706213b36638594e504aea5d9ce4e3f`、同轮 Draft run `41174329943` 及双组件清单；当前正常 App 在运行时按 `AGENTS.md` 不启动第二实例。精确签名、资产与未验条件见[发布账本](../plans/2026-09-07-signed-updates.md)。

## R04 接续计划

2026-10-31 只读对照：Core main 已到 `cb28c87f1557e7daaf94c0f3f5ac74a9a1c8deb0`，其 [Core Quality](https://github.com/PIGU-PPPgu/edupi/actions/runs/41204099294) 成功。相对 `.95` 固定的 `2a0016a4`，Bridge v1.1、Runtime schema、命令及投影集合均未变；新增梦境降级、跨日事件种子和钉钉模型调用截止等 Core 内部修复，两份组件清单的身份随之改变。开放的 Core #422 尚未合入，不纳入当前固定候选。`.95` 的包内 Core 和资产保持原身份。

| 顺序 | 工作及验收条件 | 当前状态 |
| --- | --- | --- |
| 1 | 将 Desktop 源码配对到精确 Core main `cb28c87f`：只更新 pin、双组件清单及其文件摘要；核对 Bridge／Runtime schema 未变，运行真实 Core 进程、现有 12 条 Bridge 能力、来源证明、打包闭包与 Desktop 定向检查。任何失败保持当前 `.95` 固定身份，不改旧 tag／资产。 | [PR437](https://github.com/PIGU-PPPgu/edupi-desktop/pull/437) 已合 Main `8d8e6720`；本机完整源码测试通过，远端 Desktop 检查未触发；安装验收未做 |
| 2 | 完成 `.95` 已签名候选的唯一 Mac 安装：正常 `.94` 退出后保护真实资料／配置，检查进程与隔离根，再验 G4 修改、来源证明、冷启动和数据保持。此验收只归于 `.95` 所带 Core `2a0016a4`，不能代替步骤 1 的新配对安装。 | 已签名待安装；正常 `.94` 在用 |
| 3 | Core 先给出可信同案两来源与逐属性答案证明的生产合同、失效传播和新未见反例；Desktop 才允许把证明送入召回判别，并实测取消、旧引用、跨学生／班级与冷重启。当前单来源证明继续只读，不把诊断徽标当授权。 | Core 正向合同未实现 |
| 4 | 沿现有 `review_task modify` 完成 G4 教师调整流程，不为同一任务建立第二套 `review_teaching_adjustment` 审核权威。旧 insight／growth／learning 三条待 Core 定义当前候选、稳定 ID、来源撤回及真实路由回执后再逐条接入。 | G4 源码接线已实现，独立旧命令仍 unsupported |
| 5 | 动作链按 Core 持久预览 → 教师批准与一次性令牌 → 原生执行 claim/final → 停止及崩溃恢复逐个建立合同，Desktop 每步做可撤回、重放拒绝和冷启动端到端验证；另为 `external_delivery`、`teacher_outcome_evidence` 分别建立真实载体回执及教师结果投影。 | 4 条动作命令和 2 类投影均未实现 |

步骤 3–5 属于 Core 生产能力建设；目前不能通过扩充 Desktop `supported_commands` 消除缺口。每个切片在 Core 精确 CI、Desktop 源码配对及真实安装验证中分别记状态；Windows 继续后置，不用 Mac 结果替代。

步骤 1 本机证据：Desktop 从已合并 main `78a08128` 快进，Core 使用无修改的独立 checkout `cb28c87f`，Node `22.23.1`／macOS arm64。两份组件清单内哈希为 `sha256:23c403715e04e35967f6032e17b00930b79d03ef4e57abf330e49e36bbe35ff3`、`sha256:dae471f045ded35088434616663e36146931fa8869dda16c971976032c6130b8`，文件 SHA-256 为 `8056d5b4…`、`c38214f0…`；Runtime schema 仍为 `sha256:79b9d2af…`，Bridge 仍为 `sha256:2749b120…`。`EDUPI_CORE_ROOT=<独立checkout> node --test` 的合同、进程、身份、召回和打包闭包 48 通过／2 条件跳过／0 失败；额外设置 `EDUPI_MEMORY_RECALL_CORE_ROOT` 后真实 Pi 1.0.2 SDK 召回链 2／2 通过，包含冷恢复、删除传播、同名隔离和无真实模型调用。`npm run test:edupi-c1-e2` 真实 Core 子进程返回 GREEN，审核、幂等、stale 零写、冷读与 `external_send=false`；`tsc --noEmit`、`npm run release:verify` 通过，`npm run lint` 0 错误／原有 1 警告。剩余 1 条 Core 进程测试要求外部预种 `EDUPI_DATA_ROOT`，未以真实根补跑；同类真实进程和合成根已由 C1 E2 验。测试没有打包、安装、切换正常 App、触及真实教师资料或公开 feed。上述命令与身份是源码配对证据，不是新候选的签名或安装证明。

合并后只读核对 PR437 的 head `a6ac5807` 与 Main `8d8e6720` 同树；该 Main 的 GitHub check-runs 为 0、commit statuses 也为 0，不能沿用 `.95` 的远端 Desktop CI。为覆盖该门，在相同源码树及上述 Core checkout 上额外执行 `EDUPI_CORE_ROOT=... EDUPI_MEMORY_RECALL_CORE_ROOT=... npm test`，完整结果为 3518 通过／15 条件跳过／0 失败／0 取消，原始本地日志保留于 `~/edupi-install-checkpoints/core-pair-cb28-tests-20261101.log`。这证明源码回归，不等于新签名包安装。未触发 Windows 或付费签名构建。
