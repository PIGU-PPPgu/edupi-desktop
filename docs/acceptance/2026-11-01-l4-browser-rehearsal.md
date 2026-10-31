# macOS L4 内置浏览器验收记录

2026-11-01。仅使用合成数据、Loopback Core 和 Codex 隐藏内置浏览器；没有操作正在运行的正常 EduPi、真实教师资料、系统睡眠或公开更新源。该记录沿用 [R03／R04／G1–G6 任务账本](../plans/2026-09-06-product-closure-roadmap.md)。

## 固定版本与浏览器流程

| 对象 | 精确身份 |
| --- | --- |
| 签名候选 | 0.3.95 Draft 的 [Mac-only run 41174329943](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/41174329943)，Desktop `3edfff1d3706213b36638594e504aea5d9ce4e3f`，包内 Core `2a0016a4f9499c97e705fd8d4b28acdbc49d2d91` |
| 浏览器宿主 | 同一签名更新包中解压的 `server/desktop-server.cjs` 与签名 Node helper；仅监听 `127.0.0.1:30145`，数据根 `~/edupi-route1-canary-095-g4-3f7855c1e307` |
| 真实安装版 | `/Applications/EduPi.app` 仍为 0.3.94 且在运行；未安装、替换或启动第二个 App |

Core 隔离种子先产生一个 G4 `draft_ready` 任务、3 份内部产物及 `external_send=false`。包内服务器的 `/api/edupi/status` 返回 `core=ready`、精确 Core pin、任务 1。隐藏内置浏览器从首页打开“课后复盘草稿”，查看下次课调整版本 1；在“教师审核”输入合成调整并点击“修改后接受”。实际页面显示“已完成”和审核历史 1 条；从产物页打开版本 2，正文包含刚输入的调整。Core 状态文件中旧调整版本 1 为 `stale`、版本 2 为 `current`，同一 `work_case_id` 未变。

随后仅终止该合成根的 Core host PID `26274`，下一次状态请求启动 PID `30852`。状态文件 SHA-256 前后均为 `cbaf6c0ab5a4b3e39cc84f822ada04ebef37fb334732138a21be9c7f88893a69`；浏览器刷新后仍显示“已完成”及调整版本 2。此项证明包内 Web UI、Core 写入和 Core 子进程恢复；没有证明原生 Tauri 启动、系统通知点击、实际睡眠或整机升级回滚。

教师价值评价按钮由 `EduPiCapabilityFeedback` 限定为 Tauri 桌面环境，内置浏览器不会显示。下表的合成反馈来自真实 Core/Runtime API E2；本轮没有把它写成浏览器反馈表单或原生教师操作通过。

![G4 审核后页面](assets/2026-11-01-l4-browser/g4-review.jpg)

![Core host 重启后的版本 2](assets/2026-11-01-l4-browser/g4-after-restart.jpg)

## 其余非睡眠定向检查

| 领域／门槛 | 实际命令与结果 | 证据边界 |
| --- | --- | --- |
| G1 教学准备 | 固定 Core `cb28c87f` 执行 `node scripts/test_g1_durable_teaching.mjs`，23 个合成场景通过，覆盖崩溃、取消、超时、来源改删、授权收窄、预算和默认关闭；`external_send=false` | 隔离 Core worker；未运行本版原生 G1，也未做真实 OS 睡眠 |
| G2 学生跟进 | 同 Core 执行 `node scripts/test_student_followup_natural_intake.mjs`，自然消息、观察隔离、反馈、转班、撤源、重启、预算拒绝通过；4 次合成 provider 调用，0 付费调用、0 自动正式 Fact | Core E2，不是安装版 UI |
| G3／G4／G5 与安全 | Desktop Main `7013618a` 配对 Core `cb28c87f` 执行 `node scripts/test-edupi-capability-canary-e2.mjs --require-recipient-confirmation`，三域各 3 产物、审核与合成反馈回读、跨学生拒绝、收件人确认、危险外发拒绝、停止重启恢复通过；3 次本地合成聊天、0 能力模型调用 | 真实 Pi SDK／Core 子进程，但不是 0.3.95 签名包 UI 的三域自然触发 |
| 来源证明 | 0.3.95 固定 Core 执行 `node scripts/test_owner_recall_source_support.mjs`，撤源、加源、学期变更、授权撤销与 drain 场景通过，0 provider 调用 | 单来源只读证明，不是逐属性回答证明 |
| 教学内容规则 | Core `cb28c87f` 执行 `npm run test:g1-teaching-quality`，124/124 通过 | 规则、数学与来源夹具；不代表广泛课堂质量或独立人工核对 |
| 正式盲测准备 | `npm run test:l4-formal-prep` 通过 60 故事／360 时间点／12 开发槽／120 重复槽；`npm run test:l4-nonpaid-blind` 通过 492 次确定性策略评估 | 两项实际模型调用均为 0；正式语义盲评与真人裁决仍未运行 |

R04 仍有一个可重放的安全缺口：在隔离 Owner HTTP 夹具里，只选一份“花灯班会由张老师主持”的当前来源，询问“谁主持、排在第几场”，注入一个错误地把全文标为 `supported` 的合成模型回执，产品返回 `status=current`、1 份来源。此探针证明**当前代码缺少独立逐属性围栏**，不证明真实 GLM 在这道题上会犯错。直接把所有带连接词的查询拒绝会覆盖 v17 已揭晓 60 题中的 47 题，因此不能当作完成 R04 的正向修复。须建立可信事项身份、每项问题的当前来源锚点，并在新未见样本上测量。

R03 旧版回滚的首次脚本返回失败：旧 Core `00d05a1` 无法读取新版 `gate_anchor`。修正后的[Core PR #423](https://github.com/PIGU-PPPgu/edupi/pull/423) 定向复验要求旧版**拒绝启动并零业务写入**、新版重开、预升级备份供旧版恢复，结果通过；精确 CI 和合并状态另记。这个结果不等于已安装 App 的升级／回滚。

开发模式在两个隔离 localhost 端口出现 Next 客户端 `OuterLayoutRouter` 的 `slots` 错误，页面停在加载态；同一签名包内的生产服务器在内置浏览器成功打开并完成上述 G4 操作。开发模式问题单列，不用它否定已通过的生产包内流程。

## 11 月 1 日续验

- R03 [Core PR #423](https://github.com/PIGU-PPPgu/edupi/pull/423) 精确 [CI run 41222808413](https://github.com/PIGU-PPPgu/edupi/actions/runs/41222808413) 成功，合入 Main `62600c32b408578953b7332c9db79d49f973f5c7`，合并树与受测 head 相同。旧版直接运行新版 owner gate 的结果是预期拒绝；合成业务文件和 Durable 库不变，新版重开与预升级备份恢复通过。签名 App 回滚仍未验。
- Core `cb28c87f` 的 `npm run test:schedule-upload-dedupe` 退出 0：规范日程、同源副本去重、改期与冲突、ICS/Word/PDF/PNG/JPEG 的当前来源与教师确认、来源字节漂移和撤销后拒旧回执均通过。PDF/PNG/JPEG 与 DOCX 的合成公开 Owner 路径各证实选定第 6 份材料后生成 4 份备课草稿、审核/反馈回读与重启不重生。测试没有读取真实校历或证明任意学校官方源及时更新。
- 同 Core 的 `npm run test:teacher-feedback` 退出 0：六领域反馈目标、纠正链、漏报、重启、合成记录排除、同意门、脱敏账本、90 天保留与擦除回归均通过。原生反馈表单仍未在 0.3.95 安装版操作，云端接收 API 仍未提供。
- 真实 `zai-coding-cn/glm-5.3-flash` 固定套餐合成数学首测最多 7 次且实际预留 7 次，0 重试、0 换供应商。负数题与分数崩溃恢复各生成 4 份校验产物；正数题最后解正确但中间等式错误，Core 以 `inequivalent_step` 拒绝、没有 ready 产物。因此这轮内容质量为 **2/3 场景通过**，不能改写为全过。[Core PR #424](https://github.com/PIGU-PPPgu/edupi/pull/424) 已将正确最终解下的步骤纠正交给有界 BigInt 算法，原失败模型输出离线重放后 4 份产物通过数学/来源校验，额外 provider 调用 0；该 PR 的精确 CI、合并及修后真实模型/安装版仍待验证。私有完整模型回执在 `~/` 对应系统临时目录 `edupi-g1-real-model-ZZbIeH/evidence.json`；仓库只记脱敏摘要。
- PR #424 的修后正数题另用固定 GLM 套餐实际预留 2 次请求，0 重试，观察到 1768 tokens。Core 结果为 `draft_ready`；独立只读检查确认四份候选产物与持久状态的 SHA-256 一致，答案含 `2x - 2 = 6 → 2x = 8 → x = 4`，不含模型错误的 `x = 5`，`external_send=false`。旧验收脚本把新增 `math_step_repair_count` 字段误判成失败，原始运行仍保留 `partial_or_failed`；脚本已修并通过无 provider 的离线回归。此为定向内容核验，不等于总体教学质量通过；完整脱敏记录见 Core `docs/loop/evidence/2026-11-01-g1-math-step-repair.json`。

## Core G1 合并与 Desktop 交接

- [Core #424](https://github.com/PIGU-PPPgu/edupi/pull/424) 的精确 [CI](https://github.com/PIGU-PPPgu/edupi/actions/runs/41232104459) 成功，合入 `2b3e55963efa9e91b221342aae1ef4e80dafb898`；[Core #425](https://github.com/PIGU-PPPgu/edupi/pull/425) 的精确 [CI](https://github.com/PIGU-PPPgu/edupi/actions/runs/41236036720) 成功，合入 Core Main `e07885b1dadcd763d7454799088c88b81cad06b3`。两次合并树分别与其受测 head 相同；Core Main 推送 CI 仍排队。
- #425 修正 G1 真实模型候选教案的 55 分钟活动超时：新 Durable 草稿默认一节 45 分钟，46–60 分钟按比例缩减并记入策略版本，超过 60 分钟拒绝；实际校方节长未知，教师仍须审核。`npm run test:g1-teaching-quality` 129 通过，Durable 25 个合成场景通过。可重放的 `scripts/rehearse_g1_activity_budget_upgrade.mjs --old-core <#424 精确源>` 用旧 Core 发布 55 分钟四份草稿，再由新 Core 同一隔离根重启，状态及四份文件哈希不变、追加模型调用 0，详见 Core `docs/loop/evidence/2026-11-01-g1-activity-budget.json`。
- Desktop 配对时固定 Core `e07885b1dadcd763d7454799088c88b81cad06b3`；Runtime schema `sha256:79b9d2af1de039967f53f5ffdbdeb0d7faed4c7b8122cac307086c485d17ef4b`，Bridge v1.1 schema `sha256:2749b1208b47bf475bd30d266b5ca1b213aa78c6c8b4dcd53059c524400565c8`。Core Runtime 组件清单内哈希 `sha256:66cd579ff6131cc2cbefce30f0cccee5ed829d9d957c0ba394b9331337853d65`，文件 SHA-256 `4b678a350eb3ce4d0fb3de6c7bcb1bb0294c858e614dd1628a25ca8c68f9c163`；Desktop 组件清单内哈希 `sha256:da4f929007f37f3597dc741547ce891a460e1a12120a4a4768295bfe47940845`，文件 SHA-256 `be7ce62e01ea7b8dbfffa29ab453ead464c9e550a553e43781e1268408312e28`。新 pin、双清单、真实 Core 进程和签名包需由 Desktop 线重新验证，旧 0.3.95 安装候选不追认为包含这些修复。
- [Core R04 #426](https://github.com/PIGU-PPPgu/edupi/pull/426) 在当前 Main 上等待 CI；它只证明两份选定且当前的来源属于同一 Core 事项，`answer_verified=false`、`question_case_verified=false`。单来源逐属性误判、完整来源库存和新未见语义门仍未解决，Desktop 不应据此放开复合回答。

## 未验证

- 0.3.95 唯一 macOS App 原生安装、通知点击、升级及回滚、真实资料保持；正常 0.3.94 仍在用，按仓库隔离门不启动第二实例。
- G1–G5 加贯穿安全在**同一签名安装版**的六条自然触发全链；本轮 Core E2、Desktop E2 与 G4 包内浏览器分别记账。
- R04 查询与事项绑定、完整来源库存、逐属性支持和新的未见语义门；正式盲评、广泛教学内容人工核对与真人连续使用价值。
- 真实跨到期系统睡眠，按用户要求后置。

合成 G4 数据根 `~/edupi-route1-canary-095-g4-3f7855c1e307` 仅为后续原生验收保留；完成同一签名包的安装审核和重启回读后清理，不作为教师数据。
