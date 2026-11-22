# EduPi 与 Supabase 契约对齐

日期：2026-11-22（保留 11 月 21 日基础设施记录）

## 结论

云端 EduPi 现在有一条受控 canonical writer 链路。手机或浏览器只通过 Edge Function 进入，Edge Function 先校验 Auth 和 workspace，再调用 `edupi` schema 内的 writer RPC。事实、任务、材料、事实脊柱、班级对象和 Core Runtime 状态都会在同一 workspace 里保存 revision、幂等 request、snapshot、state hash、审计和 `external_send=false`。

本地 Core 仍是 Desktop 默认 writer。2026-11-22 核对发现 cloud writer 固定 `3ce22b1e… / 2749b120…`，本地主线固定 `fc89b3bc… / 4d406ea0…`；两组 identity 不能互换。Desktop 用独立云端合同适配普通任务，历史 migration、本地兼容 pin 和 mobile-dashboard 1.0 保持原字节。现有 Supabase 已通过 `https://edupi.intelliclass.online` 提供服务；本轮复用该部署，没有重装数据库或迁移真实教师资料。固定 Core standalone 尚未作为云端 Web 服务部署。

## 本地接口事实

| 本地入口 | 当前行为 | 事实源 | 云端对应 |
| --- | --- | --- | --- |
| `GET /api/edupi/education` | 返回 `EducationContract` 组合投影 | Core `education_workspace` 快照、任务会话索引、产物投影 | 暂不整体复制，后续按领域拆分 |
| `POST /api/edupi/education` | 当前路由处理 `review_work_candidate` | Core command + receipt + fresh snapshot | `review_receipts` 记录回执，具体写入仍需对应 Core/Edge 契约 |
| `GET /api/edupi/student-events` | 按学生、类型、日期和关键词分页读取 | Core `students` operation | `edupi.student_events` 和 `student_event_revisions` |
| `POST /api/edupi/student-events` | `update_event`、`delete_event`、`set_topic_alias` | Core writer admission 和 revision | `student_events`、revision 表、别名表，必须带 workspace |
| `POST /api/edupi/classroom` | `roster/list/read/preview/save/restore/publish` | Cloud canonical writer，Desktop 仍走本地 Core | `classroom_objects`、`classroom_object_versions`，发布会写入任务关联 |
| `GET/POST /api/edupi/account` | Desktop 账号客户端状态和动作 | 本地私有账号文件，远程后台是独立未来服务 | Supabase Auth + `accounts`/`account_identities` 后续对齐 |
| `/api/mobile/pairing/*` | 本机短期手机配对和 token scope | 内存 + 本地 `mobile-pairings.json` | 云端必须重新设计 session/device/revocation，不能直接暴露本地 pairing 文件 |
| `/api/mobile/sessions/*` | 读取本地 Pi session，发送受门控 prompt | `~/.pi/agent/sessions` 和本地 Core | 需要云端 session 存储和 Core worker，当前不迁移 |

## 第一批表

迁移文件为 [`20261120142514_edupi_contract_foundation.sql`](../../supabase/migrations/20261120142514_edupi_contract_foundation.sql)。

- `edupi.contract_versions` 固定当前 `edupi-bridge-v1.1`、`edupi-schedule-occurrence-v1.2`、Core commit、schema hash、命令和投影清单。
- `edupi.workspaces` 和 `edupi.workspace_members` 提供云端边界。RLS 以 `auth.uid()` 和 workspace membership 为准。
- `edupi.student_profiles` 保存稳定 `student_id`、姓名、班级、profile revision 和删除标记。
- `edupi.student_events` 保留本地 `kind`、`student_ids`、`student_labels`、`topic`、`canonical_topic`、`summary`、`observed_on`、`source`、`history`、`revision`。
- `edupi.student_event_revisions` 保存每次事件版本和幂等 `request_id`，避免用 JSON 数组代替并发写入控制。
- `edupi.teacher_tasks` 先保存本地任务身份、状态和完整 JSON 兼容体。正式 task board 写入仍需 Core 命令闭环。
- `edupi.classroom_objects` 和 `edupi.classroom_object_versions` 对应 `ClassroomRecord`，保留 domain、input、result、issues、versions、publication 和 revision。
- `edupi.task_session_bindings` 对应本地 `task-session-bindings` 文件的唯一任务/会话绑定关系。
- `edupi.review_receipts` 对应本地教育审核 receipt，保留 snapshot、state hash、decision、evidence、rollback 和 `external_send=false`。
- `edupi.workspace_snapshots` 和 `edupi.command_receipts` 保存 mutation 前后的 canonical snapshot、state hash、原始 envelope、request fingerprint 和完整回执。
- `edupi.tasks`、`task_versions`、`work_cases` 和 `work_case_transitions` 保存任务板、工作案例和历史版本。
- `edupi.materials`、`material_versions` 和 `artifacts` 保存材料元信息、版本链和私有 Storage object key。绝对本地路径不会进入云端。
- `edupi.facts`、`fact_observations`、`fact_reviews`、`fact_conflicts` 和 `fact_spine_snapshots` 保存事实生命周期和事实脊柱。
- `edupi.core_runtime_instances`、`core_runtime_leases` 和 `core_runtime_events` 保存 Runtime identity、fencing generation、租约和运行事件。

## Edge Function 约定

第一批函数目录：

- `supabase/functions/edupi-student-events`
- `supabase/functions/edupi-classroom`
- `supabase/functions/edupi-core-broker`
- `supabase/functions/edupi-core-runtime`

请求必须携带 Supabase Auth Bearer token 和 `x-edupi-workspace-id`。函数内部先检查 workspace membership，再执行数据库操作。响应沿用本地路由的领域字段和错误语义，不返回 service role key、原始数据库错误或本地文件路径。

`edupi-student-events` 对齐本地 `GET` 查询与 `update_event`、`delete_event`、`set_topic_alias` 动作。成员只能调用 writer RPC，不能直接 insert、update、delete canonical 表。

`edupi-classroom` 对齐 `ClassroomRequest` 的 `domain`、`action`、`id`、`expected_revision`、`revision`、`input`、`request_id` 字段。`preview`、`save`、`restore` 和 `publish` 都进入 `mutate_classroom_object`，保存和恢复使用 expected revision，发布保存任务关联。

`edupi-core-broker` 接受五类本地请求。`operation: "command"` 接受 bridge v1.1 envelope，`operation: "education-facts"` 接受事实生命周期请求，`operation: "material-metadata"` 接受材料元信息版本请求，`operation: "classroom"` 接受班级写入请求，`operation: "mobile-dashboard"` 提供带版本 contract identity 的手机版首页读取投影。它还提供 `snapshot` 回读入口。

`edupi-core-runtime` 接受 Runtime register、heartbeat、lease acquire、lease renew、lease release 和 event 请求。租约返回给当前实例的 token 只在响应中出现，数据库保存 hash。不同 nonce 或旧 fencing generation 会返回 `runtime_fenced`。

当前函数已实现 `roster`、`list`、`read` 的云端读取。`preview`、`save`、`restore`、`publish` 明确返回 `core_required`，避免在没有 Core 算法和 writer admission 的情况下产生与本地不同的结果。

## 仍需单独接入的域

这些本地域已经存在接口或投影，当前 canonical writer 之外仍需单独完成：

- `EducationContract` 的完整前端组合投影、日历 occurrence、课表来源和生成任务编排。
- 家校人物记录的 `guardian_verification`、冲突恢复和删除/恢复链。
- Pi session、SSE、Agent execution、Core owner control 和移动端 prompt。
- 账号扫码、手机号/邮箱/微信绑定、refresh token、撤销和账号合并。

这些域要迁移，必须补充对应的 producer contract、文件存储策略、身份归属、RLS、审计和重启读回测试。

## 验收门

每个云端域都必须同时通过以下检查：

1. 用本地接口请求体调用 Edge Function。
2. 读写同一 workspace，确认 RLS 不串租户。
3. 重复提交同一 `request_id`，确认幂等回执不产生第二个版本。
4. 用旧 `expected_revision` 更新，确认返回 stale/rejected 且没有新写入。
5. 写入后重新读取，确认响应字段与本地类型一致。
6. 删除、恢复、历史版本和审计回执分别回读。
7. Cloud writer 失败不能返回 accepted，replay 必须返回首次回执，旧 writer 必须因 fencing generation 失败。

手机版接口同步规则见 [`edupi-mobile-api-sync.md`](./edupi-mobile-api-sync.md)。桌面端新增接口不会自动进入手机版，必须更新 contract、Edge Function、iOS decoder 并完成远程 E2。
