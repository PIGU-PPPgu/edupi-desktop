# R04 Core 与 Desktop 生产合同缺口

2026-10-31，Core PR #416 与 Desktop 0.3.95 候选配对中。当前 Core Bridge v1.1 生产能力为 12 条命令和 `education_workspace` 投影；下列八条虽有 schema，Core `edupi_bridge_command.mjs` 仍返回 `unsupported_command`，不能只改兼容清单。

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

本文件记录合同边界，不把上述缺口标为已交付。安装版复验须使用合并后精确 Core SHA、双组件清单、签名候选及隔离根；当前正常 App 在运行时按 `AGENTS.md` 不启动第二实例。
