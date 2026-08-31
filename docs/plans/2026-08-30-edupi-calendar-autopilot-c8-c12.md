# EduPi 行事历自动工作引擎：C8–C12

## 产品目标

EduPi 的核心价值不是展示日历，也不是提醒老师还有什么没做，而是读取真实校历、课程表、通知和教师上下文，在正确的提前量内把教师工作做成可直接检查和使用的产物。Desktop 是这套运行中的可见身体：老师在其中看见 EduPi 已发现什么、正在做什么、做完了什么，并可修改、接管或授权外发。

完成态必须满足：

```text
校历/通知/Chat 事实
→ 稳定事件
→ 提前工作包
→ 自动执行教师内部工作
→ 产物与证据落入 Core
→ 日/周/月/任务板同步呈现
→ 教师反馈改变下一轮计划
```

## 已观察到的缺口

当前 `rhythm_planner` 已能从部分节日、假期、期中、期末和班会节点生成稳定任务，`rhythm_heartbeat` 也能把到期任务同步为 Core work candidate。但任务固定为 `content_status=not_generated`，心跳只报告“进入窗口”，不会生成任何内容。普通 meeting/activity/teaching/custom 事件也可能没有工作包。因此当前系统是提前列清单，还不是提前完成工作。

## 方案选择

1. **只增强 Desktop 自动化**：实现快，但退出 Desktop 后不运行，状态也容易变成第二事实源。
2. **只增强提醒与通知**：能减少遗漏，但仍把实际工作留给老师。
3. **Core 工作图 + 自动执行账本 + Desktop 投影**：Core 负责计划、执行状态、产物、反馈和重启恢复；Desktop 只消费与控制。这是采用方案。

## 自主边界

- 日期明确且来源已确认：自动建立提前工作包。
- 日期缺失、冲突或来源为 inferred：保持 hold，不猜日期、不执行。
- 教师内部分析、清单、教案框架、材料草稿：自动执行并保存。
- 面向学生、家长或学校的内容：自动做到可直接发送的候选稿，`external_send=false`。
- 外部发送与不可逆桌面动作：当前仍需要一次教师授权；C11 保留可升级的授权合同。
- 所有自动产物绑定来源、输入快照、任务 ID、哈希、版本和执行记录；源事件变化后旧产物必须可识别为 stale。

## 事实所有权

- `calendar.json` / intake store：事件事实与来源。
- `rhythm_plan.json`：由事件确定性派生的提前工作图。
- `teacher_review_state.json`：教师对工作候选的接受、修改、暂缓、拒绝与抑制。
- C9 新增 Core execution store：自动执行尝试、状态、产物元数据和幂等记录。
- Core 管理的 artifact 目录：候选产物文件及哈希。
- Desktop：仅 UI、会话绑定、临时材料 staging；不得保存教育任务或产物的第二份真相。

## C8：完整行事历工作图

目标：每个日期明确、来源已确认的行事历事件至少有一个有提前量、可执行、可追溯的教师工作包。

工作：

- 让 `prep_days` / `preparation.lead_days` 优先于类型默认值。
- 保留已有节日、长假、期中、期末、班会策略。
- 为普通考试、活动、会议、教学节点和 custom 事件补齐默认教师内部工作包。
- 特定策略已生成任务时不再叠加同义 generic 任务。
- 保持稳定 logical occurrence key、来源哈希、证据 ID、日期 hold 和现有教师反馈继承。
- 每次 heartbeat 同时提交完整 work-graph identity 集合与当前激活子集；Core 用完整集合做权威对账，不能把“未进入执行窗口”误判为删除。
- 已持久化任务若不再存在于完整工作图，原子进入 `withdrawn`，从活动投影和后续执行中移除，同时保留之前状态、教师修改、语义指纹和 lifecycle history。
- 同一 event-plus-package identity 重新出现且语义未变时恢复撤回前状态和教师修改后的标题/摘要/日期；语义变化时按现有 source-changed 规则重开为待确认。事件改类会撤回旧 package identity，并在新 package 进入窗口时创建新候选。
- 活跃 work candidate 与 withdrawn tombstone 使用独立的有界容量；满载时的一进一出改类必须在同一事务内成功，最旧 tombstone 可按确定性策略淘汰，但活动任务不得因 tombstone 占位而拒绝正确替换。
- Desktop 固定新 Core，并在现有任务板/日历中直接看见新增工作包，不增加新一级导航。

验收：覆盖七类事件；明确日期生成 planned，缺失/冲突/inferred 生成 hold；重复运行无重复；来源日期变化保持任务身份并重开候选；删除、改类和重新加入事件不会留下 ghost work；withdraw/reactivate 历史在 restart/replay 后一致。

## C9：自动执行与产物账本

目标：进入执行窗口的教师内部工作包自动完成，不等老师先点击“开始”。

工作：

- 新增 execution store 与 artifact 目录，状态为 queued/running/draft_ready/failed/stale。
- 调度器领取到期任务，使用固定 Pi 模型执行；测试通过注入 runner，生产运行记录实际 provider/model/session。
- 每个 planned artifact 生成候选文件、摘要、SHA-256 和版本。
- 同一任务/输入哈希幂等；崩溃后可恢复或重试；源事实变化使旧执行 stale。
- 执行中投影到任务板“进行中”，完成后进入“待我确认”。

验收：一个考试节点自动生成教师复习重点清单与外发候选稿；断电式重启不重复生成；失败可见且可重试；无外发。

## C10：任务、日历、产物统一工作面

目标：Desktop 准确呈现 Core 自动工作，而不是另建一套状态。

工作：

- 日、周、月视图展示任务触发、事件日期和自动产物状态。
- 任务卡与日历项打开同一个右侧详情抽屉。
- 详情展示来源、执行时间线、产物预览、版本、失败与教师反馈。
- 日期/任务修改走 typed Core command；回执后刷新，不做乐观持久化。
- Chat 仍在顶部，任务内“继续让 EduPi 做”绑定同一任务与执行记录。

验收：同一 task ID 在四个视图状态一致；点击均可用；产物可打开；刷新和 restart 不丢状态。

## C11：持续摄入、重规划与授权动作

目标：老师丢进文件、图片或一句话后，EduPi 自动补充行事历并重算后续工作。

工作：

- 统一 file/image/Word/PDF/Chat intake 到已存在的 Core import commands。
- 修复模型识别运行时选择与 `model_unavailable` 诊断；保留确定性解析门。
- 新事件确认后立即重算工作图并触发适用的自动执行。
- 教师对提前量、交付物和无用任务的反馈形成可回滚 policy candidate，并在 held-out 未来节点验证。
- 外发候选稿支持一次明确授权；默认不发送。

验收：真实校历图片或通知文件进入后，日历、工作包和产物自动出现；同一文件重放不重复；修改来源只重做受影响工作。

## C12：Desktop 全局身体与持续运行

目标：EduPi 即使不在当前页面，也持续工作并在合适时机让老师看见结果。

工作：

- Tauri 全局快捷入口、任意页面材料拖入、任务完成通知和“EduPi 已完成”收件箱。
- Desktop command palette 可打开事件、任务、产物和 Chat，不暴露开发者配置。
- 本地 action 继续使用 typed preview/approve/stop/result 合同和 NomiFun vendor 边界。
- 打包固定 Core component manifest，验证开机恢复、离线状态、升级与回滚。

验收：关闭页面再打开仍能恢复；后台完成后通知可直接打开产物；紧急停止有效；安装包不含私有数据。

## 工程命令

Core：

```bash
npm test
npm run typecheck
npm run test:storage-contract
npm run audit:contracts
git diff --check
```

Desktop：

```bash
npm test
node_modules/.bin/tsc --noEmit
npm run lint
npm run security:audit
git diff --check
```

开发期间不运行 `next build`。每个 C 阶段都有独立 Core/Desktop checkpoint、paired E2、真实浏览器验证、文档记录、PR 和 merge。任何模型或外部渠道不可用必须单独记为 unavailable，不得用 fixture 冒充真实运行。

## 当前执行指针

C8 已完成：Core PR #4 和 Desktop PR #13 均已合并，完整校历工作图、权威撤回/恢复、教师修改保护与 restart/replay 通过，fresh Sol/Max verdict 为 `ship`。

C9 Core 已由 PR #5 合并到 `5538021f171a647d87562d91e5ab953f794e2331`，component manifest 为 `sha256:649c13fd9d6f0defa56a189176cab0e2a461355131397a4601d260fa1d08d922`。自动执行账本、隔离模型运行、候选产物、过期对账、并发发布保护、失败次日重试和北京时间日期边界均通过，fresh Sol/Max verdict 为 `ship`。本 checkpoint 将 Desktop 固定到该 Core。

C10 统一任务详情工作面已由 Desktop PR #16 合并到 `c8fdc007fbe5f8e0dd3940db8ef8f6d4cf3dfdd6`：任务板和日历任务使用同一个右侧抽屉，状态、产物、教师反馈、Chat 绑定和完整任务入口保持一致；普通日程仍使用原详情。Bridge v1.1 暂不投影执行 attempt、时间戳和独立 artifact revision，因此界面只显示真实的任务级进度，不伪造执行时间线。

C11 模型识别运行时已由 Desktop PR #14 合并到 `82a559e197b76811b3141f340cc20dc7c5f7ba24`：文件与图片识别使用明确 provider/model，禁用工具、技能、上下文文件与附加系统提示，模型不可用时只返回清洗后的诊断。

C12 Desktop 全局身体已形成三个可合并 checkpoint：任意 EduPi 模块的文件拖入统一进入 staging→识别→Core intake 且不会被 Chat 重复处理；AppShell 后台监视精确 `draft_ready` / `generation_failed` 转换，派生“EduPi 已完成”收件箱并使用既有桌面通知；Cmd/Ctrl+K 与托盘 Quick Entry 可直接打开 Chat、任务、真实产物和日程。Web 全量、Rust 单测和真实浏览器交互均通过，各切片 fresh Sol/Max verdict 为 `ship`。

C12 后续边界：通知点击直达产物需要新的 Tauri 通知事件；真正的系统级键盘快捷键需要官方 global-shortcut 插件及跨平台冲突/打包验证；精确重复失败通知需要 Core 投影 execution revision。当前版本不声称具备这三项，也不建立 Desktop 第二事实源。
