# EduPi 可写任务板契约 — 2026-08-30

## 目标

让教师可以在工作区创建真实任务并拖动任务阶段，同时保持 Core 为唯一事实所有者。Desktop 只提交命令、等待回执并刷新快照；不做乐观移动，不保存浏览器本地任务状态。

## Core v1.1 增量命令

### `create_task`

输入：`task_id`、`title`、可空 `due_date`、可空 `note` 和标准 `source`。任务固定为教师内部、需要教师审核、禁止外发，初始阶段固定为 `todo`，阶段版本为 0。

成功：`status=accepted`，回执 target 指向新任务，刷新后的 `education_workspace.tasks` 必须包含同一任务和相同 after snapshot/state hash。

冲突：任务 ID 已存在但语义不同返回 `task_conflict`；精确幂等重放返回原回执。

### `move_task_stage`

输入：`task_id`、`expected_revision`、`to_stage`、可空 `note` 和标准 `source`。

允许转换：

- `todo → progress | review`
- `progress → todo | review`
- `review → progress | done`
- `done → progress`

相同阶段返回 `stage_unchanged`，非法跳转返回 `invalid_transition`，版本不一致返回 `stale_revision`，不存在返回 `task_missing`。成功后阶段版本加 1。

## Core 状态

新增 `.edupi/output/task_board_state.json`，只保存：

- 教师手动创建的最小任务记录；
- 任意任务的显式阶段覆盖与版本；
- 命令回执和幂等记录。

旧 rhythm/work-candidate 任务仍由原存储拥有内容与审核状态。Task Board store 只拥有手动任务和看板阶段，不复制旧任务正文。

快照给每个任务附加 `board_stage`、`board_revision`、`board_updated_at`。没有显式覆盖时，Core 按任务/候选审核状态给出稳定默认阶段；Desktop 的 Agent 会话仅作为展示提示，不覆盖显式 Core 阶段。

## Desktop API

- `POST /api/edupi/tasks`：`{ title, dueDate, note }`
- `PATCH /api/edupi/tasks/:taskId`：`{ stage, expectedRevision, note }`

两者均返回 `{ receipt, data }`。HTTP 400 表示输入错误，404 表示任务不存在，409 表示快照/版本/阶段冲突，503 表示 Core 不可用。

## UI

- 页面标题区增加“新建任务”，表单只收标题、截止日期和备注。
- 卡片使用 Pointer Events 拖拽和键盘可访问的“移动到”菜单；任务板容器接管移动/释放事件，避免手柄离开后丢失事件。
- 拖动开始不改变列；只有 200 回执和刷新后的快照到达后才更新。
- 非法目标列显示原因，卡片保持原位。
- pending 时禁用重复提交，页面显示紧凑状态提示。

## 验收

- Core 契约、幂等、非法转换、陈旧版本、重启恢复均有决定性测试。
- Desktop 路由和命令客户端拒绝未知字段、伪造回执及 after-snapshot 不匹配。
- 隔离 E2 完成“创建 → 进行中 → 待审核 → 完成 → 重启读取”。
- 浏览器完成新建、拖动、键盘移动、失败不移动和无控制台错误验证。

## 2026-08-30 实现检查点

- Core main merge：`b8c0a6f463d4f17c08301731b3dc1ca3ceafe7d3`（PR #3）；schema `sha256:a0916f90fbca72da0c48e545c5c8dfddee42a0f0b3e54641c7a2297e54e9eb31`；component manifest `sha256:dfb4932f3128f7d5995bac39c988070f48d625c980f6e5dd39da4e9e031229bf`；fixture manifest `sha256:68e9d2e91e04a314037590b1a5ebe51cf2fab3d50392d65e30a0dd71bec29cfb`。
- Core 回执与幂等记录使用同一 500 项保留窗口，不会产生仍保留幂等键、对应回执却已被裁剪的坏引用。
- Desktop 全量单测：640 passed / 13 skipped / 0 failed；类型检查、lint、依赖安全审计（0 vulnerabilities）、`git diff --check` 通过。
- 跨仓 E2：C1、Chat capture、C2、C3、C6 导入、任务板写入均 GREEN；任务板覆盖创建、三段合法移动、非法跳转不写、重启读取。
- 隔离浏览器：带日期创建成功；Pointer 拖拽完成 `todo → progress → review → done`；下拉移动成功；非法直达 `done` 不提供；控制台 0 error/warning。
- 模型驱动的 C6 识别 E2 在当前主机两次返回 `model_unavailable`，未作为本任务板改动的通过证据；确定性的识别解析/导入单测及 C6 非模型 E2 均通过。
- 所有浏览器验收只写临时数据根；生产教师数据未写入，`external_send=false`。

回滚：回退 paired Core/Desktop 提交并恢复上一组兼容 pin；Core 的 `task_board_state.json` 可保留，旧 Desktop 不会读取或写入它。
