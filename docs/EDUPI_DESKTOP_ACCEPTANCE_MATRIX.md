# EduPi Desktop 验收矩阵 v1

| 层级 | 证据 | 可声称内容 | 不可声称内容 |
|---|---|---|---|
| E0 代码 | 文件、类型、路由存在 | 已写入代码 | 功能可用、教师需要 |
| E1 隔离 | fixture、定向测试、API smoke | 隔离路径通过 | 真实学校数据闭环 |
| E2 本地真实数据 | 当前 EduPi workspace 读写、重启读取 | 当前本机数据路径可用 | 真实教师有效 |
| E3 运行时闭环 | extension/runtime receipt、审核、rollback | EduPi runtime 的指定闭环可回放 | 普遍教育场景完成 |
| E4 channel | 当前源码、真实 Feishu/其他 channel inbound/outbound messageId | 指定 channel 消息闭环 | 只因 Gateway 在线就称 EduPi 在线 |
| E5 教师 | 真人输入、接受/修改/拒绝、held-out、独立评估 | 指定教师场景试用证据 | 模型自评、fixture、旧日志替代真人证据 |

## 每条垂直闭环必须记录

```text
source_file/hash
context_id
input_material_ids
observation_id
prediction/candidate_id
teacher_action
review_status
output/evidence_id
external_send
reload/restart result
rollback result
```

## V1 校历准备验收

### 代码层

- [ ] API/UI 没有第二套校历事实源；
- [ ] 任务字段可追溯到 calendar event；
- [ ] 低置信/日期缺失进入 hold；
- [ ] `teacher_internal`、`external_send=false`、`requires_teacher_review=true` 固定；
- [ ] 任务接受/修改/拒绝状态有受控写入；
- [ ] 有审计/receipt/evidence；
- [ ] 可 rollback。

### 隔离测试层

- [ ] 完整事件导入；
- [ ] 缺失日期不猜测；
- [ ] 日期冲突不自动覆盖；
- [ ] 修改提前量持久化；
- [ ] 重启后任务仍在；
- [ ] 外发始终为 false。

### 当前真实 workspace 层

- [ ] 读取 `$EDUPI_PROJECT_ROOT` 当前数据；
- [ ] 明确当前 calendar/timetable/rhythm 数据为空或非空；
- [ ] 写入前保留用户数据边界；
- [ ] 重启后真实读取一致。

### 真实教师层

- [ ] 至少一名真实教师确认任务有用；
- [ ] 记录接受/修改/拒绝；
- [ ] 后续未见节点有 held-out；
- [ ] 报告教师负担变化，不用模型自评；
- [ ] 失败任务和 rollback 保留。
