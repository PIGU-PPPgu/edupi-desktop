# EduPi 可验证 L4 收口计划

日期：2026-09-02
状态：Phase 1 · Task 5 complete · Task 6 in progress（6A store foundation、6B1 daemon/protocol、6B2 deterministic Harness/G1 Core slice、6C-A writer-admission foundation、6C-B managed callers与6C-C1 writer-enforcement foundation complete；6C-C2/C3 raw/extension/maintenance matrix 与 Task7 not started）
目标：不用增加新页面、新技能数量或新的拟人层级，把 EduPi 从端到端 L2/L3 推进到三条可重复、可恢复、可审计的局部 L4 教师闭环。

## 1. 权威、边界与启动条件

本计划是 [`2026-09-02-edupi-living-teacher-agent-master-plan.md`](./2026-09-02-edupi-living-teacher-agent-master-plan.md) 的收口执行计划，不替代 ADR-001，也不改写已经通过的历史 checkpoint。

本计划在以下三项完成前保持 `blocked_on_prerequisites`：

1. PR A — Core Flow Contract v1：提供最小 `work_case` / transition 合同；
2. PR B — Desktop Living Flow v1：消费真实 transition 和统一对象时间线；
3. PR C — Teaching Before-Class v1：完成下一节课的课前准备纵向链。

本计划不得修改上述三个 PR 正在拥有的合同字段、Living Flow UI、课前业务内容或相关测试。它只在三项合并后的固定 Core/Desktop 基线上继续工作。

规划基线：

- Desktop：`89cecc8`；工作树在规划时干净；
- Desktop 当前固定 Core：`dae43405f5057e3b7032def28267d258c9066a8e`；
- `/Users/iguppp/.openclaw/workspace/edupi` 在规划时存在大量未提交工作，不能作为实现工作树；
- 实现开始时必须从 PR A/B/C 合并后的明确提交创建新的干净 Core 与 Desktop worktree；不得清理、重置或复用上述脏 Core 工作树。

明确不做：

- 不增加一级导航或六层架构页面；
- 不新增第 48 个或更多场景技能；
- 不启用自动对外发送；
- 不扩展生物意识叙事；
- 不在本计划内继续多 Agent、自我进化或 3D 教室；
- 不以模型自述、截图或 fixture 单独证明 L4；
- 不一次性迁移或删除现有记忆文件。

## 2. L4 判定标准

L4 是完整链路属性，不按六层代码数量或平均成熟度计算。一条教师任务只有同时满足以下条件，才可以标记为“局部 L4 已通过”：

1. **自然触发**：老师正常说话、导入材料或既有可信日程即可触发，不选择功能；
2. **事实可信**：涉及的教师、班级、学生、学科、日期和来源有稳定身份、置信状态与冲突处理；
3. **提前执行**：教师没有再次发起“帮我做”时，Core 已执行可逆的教师内部工作；
4. **真实产物**：完成状态对应文件、哈希、版本或确定性结构化产物；
5. **低负担审核**：教师主要接受、轻改、暂缓或否决，不从零补齐系统已知信息；
6. **反馈闭环**：教师修改、拒绝和抑制会改变下一次同类任务；
7. **连续性**：Core、Desktop 或通道重启后，同一对象身份和状态不变、不重复执行；
8. **安全边界**：没有教师明确授权时，对学生、家长、学校或公开渠道的外发为零。

三条黄金任务全部通过前，产品整体仍表述为“可审计的主动教师助手”，不得宣称完整 L4。

## 3. 三条黄金教师任务

### G1：课前自动准备

输入：可信课程表、教学重点、近期学情和材料。
目标：在教师主动开始前形成下一节课的目标核对、易错点、课堂策略、材料缺口和课后观察入口。
本计划只验证 PR C 的既有课前能力能在常驻 Core 中后台运行，不重写其领域逻辑或 UI。

关键证据：

- 聊天 Agent 已销毁或没有活动会话时仍能执行；
- 同一课程 occurrence 不重复；
- 模型不可用时明确进入 `failed` / `unavailable`，不伪造 `draft_ready`；
- Core 重启后继续原 case，已完成产物不重复生成；
- Desktop、日程、教学、材料和审核入口显示同一 case 与产物版本。

### G2：课后一句口述

输入示例：`刚才讲移项变号，张三听懂了，李四还是不会，赵六上课走神。`
目标：保留原话和来源，拆分为多个学生事实、课堂观察、待验证假设和下一课调整候选；明确事实可自动进入记忆，歧义与定性留给教师审核。

关键证据：

- 三名学生不串线，不因姓名标签重合而覆盖不同事实；
- 同一句重复投递幂等；
- 与旧记忆冲突时形成候选，不静默覆盖；
- 教师修改后，学生档案、教学记忆和下一课准备读取同一事实版本；
- 删除或撤回后不再召回，来源仍可追溯。

### G3：学校事务材料包

默认输入：`周五前提交本学期安全教育工作总结。`
目标：从日常班会、安全演练、晨会、通知与教师记录持续积累证据，在截止日前自动形成可编辑初稿及缺口清单。

关键证据：

- 老师不需要再次问“帮我写”；
- 初稿每一段可回到真实来源，缺少材料时显示缺口而非编造；
- 失败可重试，来源变化使旧产物 `stale` 并生成新版本；
- 教师修改被记录为下一次同类产物的策略候选；
- 只生成教师内部草稿，未经授权不外发。

## 4. 架构决策

### 4.1 Core 是唯一持续运行体

```text
Desktop Chat / 文件 / 日历 / 飞书 / 企微 / 钉钉 / 未来语音
                              │
                       channel adapter
                              │
                  统一、幂等的 teacher_event
                              ▼
                    EduPi Core Runtime
          事实 → 记忆 → 注意 → 规划 → 执行 → 反馈
                              │
                    snapshot / receipt / event
                              ▼
                 Desktop 与任意交付 adapter
```

- Core 拥有教育事实、记忆、`work_case`、调度、执行、产物、审核、回执和策略反馈；
- Desktop 是本地 supervisor、可见身体和控制面，不建立第二事实源；
- 飞书、企微、钉钉和其他载体只连接、规范化输入、声明能力并验证发送回执；
- adapter 不保存教育状态，不运行教育 prompt，不拥有定时器；
- 本地第一阶段由 Tauri 监管 Core 常驻进程；未来可把同一 Core 运行在私有 headless 主机，协议与教育逻辑不分叉。

### 4.2 先复用现有 bridge，不创建第二套业务合同

常驻 runtime 必须复用 PR A 合并后的 snapshot、command、receipt、transition 和 component manifest。允许新增生命周期、事件输入和健康状态合同，但不得复制 `work_case`、任务或教育事实字段。

### 4.3 事实内核先覆盖黄金任务，不先建设通用知识图谱

Fact v1 只覆盖 G1/G2/G3 需要的稳定实体与关系：教师、学期、班级、学生、家长、学科、知识点、课程 occurrence、日历事件、材料、观察和产物。存储技术在 Task 6 的基准与失败恢复验证后决定，不因“未来规模”提前引入复杂数据库。

### 4.4 能力必须是可执行合同，不是 Markdown 名单

一个能力包上线必须同时拥有：输入 schema、输出 schema、证据要求、权限边界、失败状态、checker、黄金样例、失败样例和产物/回执。SKILL.md 可以作为模型说明，但不能单独构成已上线能力。

## 5. 依赖图与 PR 顺序

```text
PR A / PR B / PR C 合并
          │
          ▼
Phase 0：黄金任务 + 价值账本
          │
          ▼
PR D：Core Runtime Contract + 常驻 daemon
          │
          ▼
PR E：Desktop Supervisor + G1 后台连续性
          │
          ▼
PR F：Fact Spine v1 + G2 课后口述
          │
          ▼
PR G：Capability Package v1 + G3 学校事务
          │
          ▼
PR H：架构淘汰审计 + 真实教师基线
```

Core producer 先合并并接受独立审查；Desktop consumer 随后固定精确 Core commit、component manifest、schema hash 和 fixture manifest。不得让两个 runtime 同时写同一个 data root。

## 6. 分阶段任务

### Phase 0：冻结基线与架构价值账本

#### Task 1：记录 PR A/B/C 完成基线

**描述：** 在三个在途 PR 合并后，记录 Core/Desktop 提交、合同身份、支持命令、投影、三项 verifier 和未验证项，作为本计划唯一启动点。

**验收标准：**

- [x] Core 与 Desktop 的基线提交对象干净且提交身份明确；Phase 0 文件是当前唯一有意工作树变更；
- [x] PR A/B/C 的 paired E2、restart/replay 与浏览器证据可定位；
- [x] G1 的 case、transition 和产物身份可从现有合同读取；
- [x] 没有把 fixture、截图或模型自述升级为 E4/E5。

**验证：** Core 定向测试；Desktop PR A/B/C 指定测试、`node_modules/.bin/tsc --noEmit`、`npm run lint`、`git diff --check`。禁止运行 `next build`。

**依赖：** PR A/B/C。
**可能涉及：** 本计划、Core append-only checkpoint ledger、Desktop plan note。
**规模：** S。

#### Task 2：冻结三条黄金 fixture 与评分卡

**描述：** 为 G1/G2/G3 固定脱敏输入、预期事实、允许歧义、禁止结论、预期产物和重启场景。评分卡不以模型自评为依据。

**验收标准：**

- [x] 每条任务都有成功、歧义、冲突、重复、模型不可用、来源变化和重启重放样例；
- [x] 预期事实与禁止推断逐字段列出；
- [x] 记录提前完成、只需确认、遗漏、无效打扰、证据完整和连续性；
- [x] fixture 不包含真实学生隐私。

**验证：** fixture schema test + 人工逐项审阅。
**依赖：** Task 1。
**可能涉及：** Core `data/teacher_task_benchmark_v2.json`、Core benchmark tests、计划证据文档。
**规模：** M。

#### Task 3：建立架构价值账本

**描述：** 将现有机制逐项标成 `keep`、`integrate`、`freeze` 或 `retire_candidate`，并绑定实际黄金任务、代码入口和证据。

初始分类：

- `keep`：bridge 合同、receipt、provenance、软删除、staging、calendar-work 产物执行；
- `integrate`：memory、student/parent profile、subject knowledge、teacher review、task board；
- `freeze`：subconscious、consciousness、多 Agent、evolution；
- `retire_candidate`：把 `auto_actions.json` 当事实源、载体内调度器、直接跨文件写入、重复场景技能。

**验收标准：**

- [x] 每个机制至少绑定一条黄金任务或明确标记无绑定；
- [x] 每个 `keep` 项说明删除后哪个验收会失败；
- [x] `freeze` 项不进入 Phase 1–3 的生产路径；
- [x] 本任务只分类，不删除代码或数据。

**验证：** 路径存在性检查 + 独立审阅。
**依赖：** Task 2。
**可能涉及：** 新增 Core `docs/ARCHITECTURE_VALUE_LEDGER.md`。
**规模：** S。

#### Phase 0 execution baseline (2026-09-02)

This is the frozen PR A/B/C execution baseline. The earlier planning baseline
above remains historical context; it is not the educational runtime pin.

**Commit identities**

- Desktop baseline: `c4e0ff322486f7183d97dc3070e88c867c36d4c8` (PR C consumer,
  `feat(edupi): prepare lessons before class`).
- Paired educational Core: `6e806f4e0af4232d95aa7353ed7a46cea4c7032a` (PR C
  producer, `feat(core): prepare lessons from teacher timetable`).
- PR A evidence: Core `610fa3187ce32e453e8617e1f4c1ab12759fa0f2` plus rollback
  closure `5d546d04744055de3fcd2bf00e140899915781ef`.
- PR B evidence: Desktop `847f0f68597a695d5ba8282d0d63d297579050b8`.
- PR C evidence: the paired Core/Desktop commits above.
- The current clean Core checkout is `ca623bdf93d781f57b7ad89956dcec9171ac7738`.
  Its only post-PR-C change is the packaged runtime dependency closure. It is
  recorded for reproducibility, but is not treated as the paired educational
  runtime until the separate Desktop pin/bundle task lands.

**Contract identity**

- contract: `edupi-bridge-v1.1` / version `1.1`;
- schema: `sha256:30d10113b6c7e7b2d3ad4eb54e34d47e8d03e848e9fbbabd1c81cf5db36727df`;
- fixture manifest: `sha256:2143fe0c4ab271d251134f137304c9dbef0a1b33517d8e8159c8adfb6dcb43c4`;
- component manifest: `sha256:03b5944d14312508141b6cbb3868828c95601f88c6f9ff2d6066e16d14bc5130`;
- supported commands: `review_observation`, `review_memory_candidate`,
  `review_teacher_context`, `review_work_candidate`, `review_task`,
  `import_calendar`, `import_timetable`, `intake_material`, `create_task`,
  `move_task_stage`, `update_memory`;
- supported projection: `education_workspace`;
- external delivery is unsupported by this contract and remains
  `external_send=false`.

**Evidence locator and baseline checks**

- PR A/B paired evidence: [`2026-09-02-living-flow-checkpoint.md`](./2026-09-02-living-flow-checkpoint.md)
  records stable living-flow replay/source-change E2 and the browser board/shared
  drawer observation.
- PR C paired evidence: [`2026-09-02-teaching-before-class-checkpoint.md`](./2026-09-02-teaching-before-class-checkpoint.md)
  records six lesson occurrences, four outputs per ready case, model-unavailable rejection was observed before batch persistence/execution; no persisted/projected failed state was proven, replay stability and the same task/work-case path through Desktop.
- G1 case/transition/artifact identity is implemented by Core
  `scripts/calendar_work_case_projection.mjs` and
  `scripts/calendar_work_execution_store.mjs`, projected by Desktop
  `lib/edupi-work-case.ts`; the four required artifact names are fixed in the
  PR C evidence and the Phase 0 benchmark.
- Core baseline checks: `node scripts/test_work_case_projection.mjs` -> passed
  (`work_cases=2`, `transitions=8`, stable replay and stale-source closure);
  `node scripts/test_rhythm_planner.mjs` -> passed (`teaching_tasks=6`);
  `node scripts/test_calendar_work_heartbeat.mjs` -> passed.
- Desktop baseline checks: `node --test lib/edupi-work-case.test.mjs
  components/EduPiLivingFlow.test.mjs components/EduPiTeachingBeforeClass.test.mjs
  components/EduPiReviewGate.test.mjs` -> 21/21 passed.
- The exact Core/Desktop E2 commands, typechecks, full suites and diff checks
  are recorded in the Phase 0 implementation report after execution; no
  `next build` is used.

**Evidence boundary**

The baseline preserves inherited deterministic E2 evidence only. The new
benchmark fixture and architecture ledger are E1 documentation/fixture
evidence. Neither upgrades the project to E4/E5 nor proves provider output,
real teacher usefulness, a daemon, or external delivery. The pre-edit Core
commit was clean; the Desktop checkout already carried this plan as its owned
untracked planning artifact. Current dirtiness consists only of the explicitly
owned Phase 0 documentation/fixture/test edits.

### Checkpoint 0：准许进入 Runtime Spine

- [x] PR A/B/C 基线冻结；
- [x] 三条黄金任务冻结；
- [x] 价值账本经用户确认；
- [x] 本计划没有修改三个在途 PR 的拥有范围。

Checkpoint 0 用户决策（2026-09-02）：`确认价值账本`。

### Phase 1：常驻 Runtime Spine，用 G1 证明无人聊天时仍会工作

#### Task 4：制定 Core Runtime Contract v1（ADR-002）

**当前状态：** 已完成。ADR-002 已在 Core/Desktop 镜像并于 2026-09-02 接受；Task 5 已按该合同完成，Task 6 正在进行中（6A store foundation、6B1 daemon/protocol、6B2 deterministic Harness/G1 Core slice、6C-A writer-admission foundation 与 6C-B managed callers complete；6C-C raw/extension enforcement not started）。

**描述：** 定义一个 data root 只允许一个 Core writer、生命周期状态、adapter 注册、事件输入、健康、关闭、版本协商和失败恢复。区分载体与运行宿主。

**验收标准：**

- [x] 明确 Desktop-supervised 与未来 headless 两种部署复用同一合同；
- [x] adapter 最小接口只包含 connect/receive/send/capabilities/health；
- [x] Core 退出、adapter 断开、模型不可用、Desktop 重启的状态转换明确；
- [x] 不新增第二套教育对象模型。

**验证：** ADR 逐项映射 G1/G2/G3 与失败模式；`cmp -s` Core/Desktop ADR-002；用户明确确认 `确认 ADR-002 五项决策`（2026-09-02）。
**依赖：** Checkpoint 0。
**可能涉及：** Desktop `docs/architecture/ADR-002-edupi-core-runtime.md`、Core 配对 ADR。
**规模：** S。

#### Task 5：证明 one-shot bridge 可复用请求处理器边界

**当前状态：** 已完成。冻结的 `scripts/desktop_bridge_port.mjs` 已导出 `dispatchBridgeRequest(request)`，并由直接执行 main guard 保留 stdin/stdout transport。Task 5 通过 characterization/parity test formalize 并证明 reusable handler ↔ one-shot 边界；实际 daemon ↔ one-shot parity 保留给 Task 6。

**描述：** 复用现有导出的纯请求处理器，不创建新 handler 模块或 wrapper；验证 one-shot transport 对同一确定性请求返回与 handler 完全相同的 JSON frame，不改教育合同语义。

**验收标准：**

- [x] 原 health/snapshot/command fixture 逐字节或语义等价；
- [x] reusable handler 与 one-shot 对同一确定性输入返回同一 JSON frame；实际 daemon ↔ one-shot parity 保留给 Task 6；
- [x] 未知版本、schema、命令继续 fail closed；
- [x] handler 不持有 channel 或 Desktop UI 状态。

**验证：** `node scripts/test_desktop_bridge_transport_parity.mjs` 与 `npm run test:bridge-transport-parity`；现有 bridge contract suite。
**依赖：** Task 4。
**可能涉及：** Core frozen bridge entrypoint 与一个定向 parity test；不修改 production bridge、schema、fixture 或 component manifest。
**规模：** M。

**Task 5 完成证据（2026-09-02）：** `node scripts/test_desktop_bridge_transport_parity.mjs` 与 `npm run test:bridge-transport-parity` 均通过；六个 health、空 root snapshot、错误 outer version、unsupported operation、unknown command schema、fixture-pattern unsupported command parity/fail-closed cases，import guard 与 handler source boundary 均通过。测试报告 bridge entrypoint `sha256:afb83d7188952a51a66e514729157e77106c0c728a1422969a3f37552deca2dc`、schema `sha256:30d10113b6c7e7b2d3ad4eb54e34d47e8d03e848e9fbbabd1c81cf5db36727df`、fixture manifest `sha256:2143fe0c4ab271d251134f137304c9dbef0a1b33517d8e8159c8adfb6dcb43c4`、component manifest 文件 `sha256:322b01af27fa6f29ecd6e3fcb8b1050df99085c93c8682ce15d30f32328dc72e` 与 identity `sha256:8431f854d95fd049f3c2e8a54a0885e058bb1b1a40a934acf18502ec2e322028`（15 modules），并确认 `external_send=false`。未修改任何 runtime production bytes、bridge v1.1 schema/fixture/command/projection 或 component manifest。

#### Task 6：实现单实例 Core daemon 与持久事件队列

**当前状态：** 进行中，父任务未完成。Task 6A、Task 6B1、Task 6B2 的 Core-only deterministic evidence、6C-A writer-admission foundation、6C-B managed caller evidence 与 6C-C1 writer-enforcement foundation 已通过；6C-C2/C3 raw/extension/maintenance matrix not started。父任务的验收框保持未勾选。Task 6 负责实际 daemon ↔ one-shot parity、single-writer fencing、持久队列和 G1 常驻执行；Task 5 不预支这些证明。

**描述：** 创建 loopback-only、由 Tauri 在 supervisor session 内稳定的 rendezvous endpoint 与独立 Core token 的常驻 Core 进程；持有 data-root lease，并用可恢复队列接受规范化 `teacher_event` 和内部 timer event。首轮只执行合并后的 G1 能力。

**验收标准：**

- [ ] 同一 data root 的第二 writer 启动失败且不写入；
- [ ] 事件在 ack 前持久化，重复 event id 幂等；
- [ ] 崩溃发生在 claim、模型执行、产物发布各阶段时均可恢复；
- [ ] adapter 断开不停止内部任务；
- [ ] token、路径、教师内容不进入日志。

**验证：** single-instance、queue replay、crash injection、auth、path containment、model-unavailable tests；Task 6A 已以固定 300 条 benchmark 选择 SQLite foundation，Task 6B1 daemon/protocol、Task 6B2 deterministic Harness/G1 Core evidence 与 6C-B managed caller evidence 已通过，6C-C raw/extension caller evidence 仍未完成。

**依赖：** Task 5。
**可能涉及：** Task 6A 的 Core store foundation、Task 6B 的 daemon/protocol/Harness/G1、Task 6C 的 caller audit/enforcement。
**规模：** M；拆分后每个切片保持可独立回滚与验证。

#### Task 6A：建立 verified-local-root、SQLite fenced store 与 durable queue foundation

**当前状态：** 已完成（仅 6A；以 Core evidence note 与定向测试/benchmark 为准）。

**描述：** 在 verified local data root 下创建新的 `.edupi/runtime/core-runtime-v1.sqlite`，使用 Node `DatabaseSync`、WAL/FULL 和严格、精确的 schema，原子持有 fenced authority 与 bounded/idempotent `event_version: 1` queue。普通 payload 支持原样保留 tab/LF/CR，event/ref/factory identity 只接受保守 ASCII opaque-ID；overlayfs backing 无法由 `statfs.type` 单独证明，因此 fail closed。覆盖 live-owner exclusion、positive-death takeover、单调 generation、commit-time stale binding rejection、ack-before-crash persistence、claim recovery、draining、capacity/pruning、redacted diagnostics 和 integrity evidence。存储选择为 SQLite；不迁移或复制现有 canonical data。

**验收标准：**

- [x] production root verifier 只使用真实 `process.platform`/`statfs` 证据，unsupported/Windows native-attestation-required fail closed，runtime path symlink 被拒绝；
- [x] SQLite schema/root identity、WAL/FULL、权限、generation/authority exclusion/takeover 和 stale-writer binding 已由定向测试证明；
- [x] durable event ack、exact-ID replay/conflict、claim/settlement/retry/cancel/expiry recovery、500-row terminal pruning/active capacity、draining 和 redacted snapshot/error 已由定向测试证明；
- [x] crash child、committed-before-exit、takeover/reclaim、old-settlement rejection、restart integrity 和 safe-store/JSONL/SQLite directional benchmark 已记录；
- [x] `external_send=false`；本切片不包含 daemon、loopback endpoint/token、runtime protocol、HarnessAdapter、G1 orchestration、caller audit/enforcement、Desktop supervision 或 legacy-writer gate。
- [x] 关闭 parent reproductions：empty regular DB first boot、starting enqueue/claim readiness、old-generation terminal replay、old retry settlement after re-claim；automated no-SQLite probe and Windows explicit not-run boundary are recorded。
- [x] parent content-boundary closure：multiline/tab payload round-trip、opaque CJK/content-ID rejection、snapshot/error redaction and overlay unsupported classifier are recorded；tmpfs only has process-crash evidence, not machine-reboot durability。
- [x] final bounded correction：root、`.edupi`、runtime 与 DB/WAL/SHM 均需同一已证明 local filesystem type/device；runtime identity 纳入 fingerprint；release/takeover 对 attempt 3 claimed rows 以 `attempts_exhausted` terminalize，并报告精确 `{total,requeued,terminalized}`；attempt-1 recovery 与 attempt-3 terminalization 的真实 child-crash、invariant、integrity evidence 已通过。
- [x] second fresh Sol/Max correction：绝对路径词法归一化后，final symlink 的直接、尾部分隔符与 `/.` spelling 均 fail `invalid_root`；fresh/reopen 均校验由固定 `SCHEMA_SQL` 推导的完整 table/index/view/trigger inventory 与定义，altered semantics、missing index、extra object、extra column 均 `schema_mismatch` 且不修复。

**验证：** Core `npm run test:core-runtime-store`、三个 new tests individually、store-suite child `node --no-experimental-sqlite` unavailable probe、`npm run benchmark:core-runtime-store`；exact output in `docs/loop/evidence/2026-09-03-core-runtime-store-selection.md`。
**依赖：** Task 5。
**可能涉及：** Core `scripts/core_runtime_root.mjs`、`scripts/core_runtime_store.mjs`、three tests/benchmark, package registration; no Desktop runtime bytes.
**规模：** M。

#### Task 6B：实现 daemon、runtime protocol、deterministic HarnessAdapter 与 G1 orchestration

**当前状态：** 进行中。Task 6B1 的 Core-only daemon/runtime protocol slice、Task 6B2 的 deterministic Harness/G1 Core slice、6C-A writer-admission foundation 与 6C-B managed callers 已完成并有独立证据；6C-C raw/extension enforcement not started，不得由 6A/6B/6C-A/6C-B 证据预支 production activation。

**描述：** 在 6A store foundation 上实现 loopback-only daemon 与独立 runtime protocol/rendezvous，接入 deterministic result-only HarnessAdapter，并完成 bounded G1 queue/claim/execution/replay continuity。不得把 6A store、fixture 或模型自述升级成 daemon/G1 evidence。

**验收标准：**

- [ ] 同一 data root 的 daemon second writer、protocol handshake、restart and backoff evidence passed；
- [x] deterministic HarnessAdapter 只返回 bounded result，Core exclusive commit、model-unavailable/retry、artifact/receipt identity 和 G1 replay passed；
- [x] no external send、no data-root write access for HarnessAdapter，daemon ↔ one-shot parity is explicit；

**验证：** daemon/protocol/HarnessAdapter/G1 deterministic tests and crash/replay evidence; no provider-backed completion claim. 6B2 evidence is recorded in Core `docs/loop/evidence/2026-09-03-core-runtime-daemon-protocol.md`; Core's intentional transitive-runtime manifest characterization is updated there, while Desktop re-pinning remains a Task7 pairing action.
**依赖：** Task 6A。
**可能涉及：** Core daemon/runtime protocol/HarnessAdapter/G1 modules and tests; no Desktop caller enforcement.
**规模：** M。

#### Task 6B2：deterministic result-only Harness 与 activated G1 queue/claim/execution/replay

**当前状态：** 已完成（仅 isolated Core deterministic slice；父 Task 6 仍为进行中，6C-A writer-admission foundation 与 6C-B managed callers complete；6C-C raw/extension enforcement not started）。

**描述：** 在独立 branded activation capability 下接入严格 bounded/versioned result-only Harness lease/result contract 与现有 calendar/teacher work-case semantics。默认 CLI/factory 不接收此 object capability，继续保持 `enqueue_event`、internal timer 与 G1 `activation_pending`；不启动生产 wall-clock timer，不接入 provider/network/channel/Desktop。

**验收证据：** strict Harness binding/UTF-8 bounds、exact layout/root/generation/provenance gate、scoped synchronous `BEGIN IMMEDIATE` mutation guard、canonical candidate sync/work-case projection、exact timer/event replay、queue/Harness/calendar deadline equality、model-unavailable retryability、source-change fail-closed、drain settlement、four crash/takeover phases and stable receipt/artifact identities 均由 Core focused tests passed。Default daemon remains activation-pending; activated daemon only exists behind explicit validated test injection.

**验证：** `npm run test:core-runtime-g1`、`npm run test:core-runtime-daemon`、`npm run test:core-runtime-store`、`npm run benchmark:core-runtime-store`、`npm run typecheck`、`npm run check:core-runtime-contract`、`npm run check:core-runtime-manifest`、`node scripts/test_desktop_bridge_port.mjs` 与 Core/Desktop `git diff --check`。No provider-backed or external-send claim. At the 6B2 checkpoint, Core's intentional Desktop characterization was `13427f0f27ca75b542dd6502012c1b034997a68f7704badb53f529424423d563` / identity `sha256:573bdb99852a9cdd6fa9d85dd84d28218324c0a9157300799273e96155e22223`; the current 6C-B managed-caller characterization is recorded below. The Phase0/Task5 baseline remains `322b01af27fa6f29ecd6e3fcb8b1050df99085c93c8682ce15d30f32328dc72e` / identity `sha256:8431f854d95fd049f3c2e8a54a0885e058bb1b1a40a934acf18502ec2e322028`; Desktop `edupi-core-compat.json` and runtime remain pinned until Task7 pairs the new Core commit/hash.

**依赖：** Task 6A。
**可能涉及：** Core Harness/G1/daemon/protocol and bounded existing-store seams; no Desktop runtime or caller enforcement.
**规模：** M（6B2 independent rollback boundary）。

6B2 P1 correction update: terminal queue continuation, create-only canonical-source binding, receipt-time source revalidation, cross-wired claim rejection, and bounded unexpected rejection are now covered by the Core focused evidence. The Core Desktop component characterization is intentionally regenerated for the changed transitive bytes; Desktop compatibility remains pinned until Task7 pairing.

#### Task 6B1：Core-only authenticated daemon 与 Runtime Protocol v1

**当前状态：** 已完成（仅 6B1；以下“6B2 未开始”是该历史 checkpoint 的状态，独立 6B2 Core slice 已在上方专节完成；Task 6C 尚未开始，父 Task 6 仍为进行中）。

**描述：** 在 Task 6A store 上建立固定 `127.0.0.1/runtime/v1`、独立 bearer token、严格 TypeBox Runtime Protocol v1 与可重启的 Core-only resident daemon。默认 CLI/factory 只提供 health、生命周期和 bridge health/snapshot 只读通道；`enqueue_event`、internal timer 与 G1 能力保持 `activation_pending`，不进入队列。

**验收标准：**

- [x] 请求/响应严格 discriminated union、canonical schema/hash、嵌套 bridge/event byte caps 与 unknown/invalid frame fail-closed；
- [x] authenticated loopback HTTP transport 具备固定 Host/path、header/body/concurrency/response/timeouts、no-store/nosniff/connection-close 与无 token/path/content 日志；
- [x] health、bridge health/snapshot parity、drain、shutdown、second writer 与 queue unchanged 证据通过；
- [x] CLI child restart 保持 endpoint/token/supervisor/component/root identity，nonce 变化、fencing generation 递增、`SIGTERM` clean；
- [x] 独立 daemon component manifest 具备 runtime/bridge schema/hash 与 fixture assets，旧 desktop manifest/bridge entrypoint byte-identical；
- [x] Task 6B2 independent deterministic Core slice completed after this historical 6B1 checkpoint; parent Task 6B acceptance boxes remain governed by the parent section above;
- [ ] Task 6C caller audit/enforcement 未开始。

**验证：** `npm run test:core-runtime-daemon`、`npm run check:core-runtime-contract`、`npm run check:core-runtime-manifest`；parent review correction 已补齐 auth-before-body/Origin fail-closed、direct-only contract update、以及 observable idempotent close/release failure，并由 slow-body、imported-`--update`、tampered-authority regressions 覆盖；完整命令与输出记录在 Core `docs/loop/evidence/2026-09-03-core-runtime-daemon-protocol.md`。本 slice 不声明 HarnessAdapter、G1、caller enforcement、Desktop supervision、E3/E4/E5 或 external delivery。

**依赖：** Task 6A。
**可能涉及：** Core `scripts/core_runtime_protocol.mjs`、`scripts/core_runtime_daemon.mjs`、对应 tests/contracts/evidence；不修改 bridge、Task 6A store/root、Desktop runtime、Harness/G1 或 caller writers。
**规模：** M（6B1 独立可回滚）。

#### Task 6C：完成 caller audit 与 legacy mutation enforcement

**当前状态：** 进行中；6C-A writer-admission foundation、6C-B managed caller enforcement 与 6C-C1 writer-enforcement foundation 已完成，6C-C2/C3 raw/extension/maintenance caller audit/enforcement 未开始；不得由 6A/6B/6C-A/6C-B/6C-C1 单独宣称 entire-data-root single-writer completion。

**描述：** 建立当前 one-shot/Feishu/extension/raw writer matrix，把每个 reachable mutation route either through the daemon or fail closed；保留可验证 rollback boundary，避免 daemon 与旧 writer 同时活跃。

#### Task 6C-C1：writer-enforcement foundation

**当前状态：** 已完成（bounded C1 foundation only；Task 6C-C2/C3、Task 7 与
shared product C1 E2 decision remain unimplemented）。

**描述：** 在 6C-A admission boundary 上加入 active live-binding assertion，
使 raw `createCoreRuntimeStore` 在 outer admission 之前 fail closed；为
JavaScript/TypeScript safe-store 写路径加入 concrete destination gate、
`O_NOFOLLOW|O_EXCL` unique temporary files、backup 与 owned cleanup；保持
`safeLoad`/snapshot 只读和 generic `withLock` 可用。C1 capability 与
application-runtime tests use real-admission child processes so tsx loader
boundaries cannot become a bypass。

**验证：** Core focused writer-enforcement/admission/storage/store/G1/managed
caller checks、300-row benchmark、Core full `npm test`、typecheck、two
contract/two manifest read-only checks、bridge-port check、Desktop
`node --test lib/edupi-core-process-client.test.mjs` 与 Core/Desktop
`git diff --check` passed；the exact current hashes, byte sizes and bigint
`mtimeNs` are recorded in Core
`docs/loop/evidence/2026-09-05-core-runtime-writer-enforcement-foundation.md`。
`npm audit` remains nonzero only for existing advisories; no dependency or
lockfile change。

**边界：** 本切片只声明 C1 writer-enforcement foundation，不声明整个
Task 6C、whole-root single-writer、provider/model/network、production G1、
external delivery、Task 7 Desktop/Tauri supervision 或产品 C1 E2。C2/C3
raw/manual/maintenance/E4/matrix work remains unimplemented and must be
separately reviewed。

#### Task 6C-A：Core daemon lifetime writer-admission foundation

**当前状态：** 已完成（仅 admission foundation；6C-B managed caller slice 已完成，6C-C raw/extension caller audit/enforcement 与 Task 7 Desktop supervision 未开始）。

**描述：** 在 verified local data root 的固定 `.edupi/runtime/core-runtime-writer-admission-v1.sqlite` 上，以一个持有 `BEGIN IMMEDIATE` 的 crash-released SQLite lease 原子仲裁 daemon 与未来 `legacy_*` writer。daemon 先完成 pre-admission root prepare，再 acquire admission，随后才打开/ready inner Task 6A store；close/startup cleanup 按 inner authority 成功 release 后才释放 admission。此切片不改变 Runtime Protocol v1、bridge/one-shot contract 或默认 `activation_pending` gate。

**验收证据：** 空 root barrier-controlled daemon/legacy contenders 恰有一个持有 lease、失败者得到 typed `writer_admission_unavailable`；正常 release 后可重入；child `SIGKILL` 后由 SQLite/OS lock recovery，无 stale-file cleanup；首启 crash 后 schema 可 bootstrap；malformed/extra schema、root mismatch、admission/sidecar symlink 与 unsupported root fail closed 且不修复；pre-admission 对既有 `.edupi`/runtime/inner DB/WAL/SHM/admission DB 的 bytes/mtime/mode 保持不变。daemon listen failure 释放 admission，tampered inner authority close 拒绝并保持 admission，child probe 仍 blocked；prepared-root fingerprint 与 inner store fingerprint/database identity 必须一致。

**验证：** `npm run test:core-runtime-writer-admission`、`node --disable-warning=ExperimentalWarning scripts/test_core_runtime_daemon.mjs`、`npm run test:core-runtime-store`、`npm run test:core-runtime-daemon`、`npm test`、`npm run typecheck`、`npm run benchmark:core-runtime-store`、bridge/C1 parity、重复 daemon/restart、contract/manifest SHA+bigint mtime read-only proof、audit 与 Core/Desktop `git diff --check`；Core daemon manifest 在 6C-A checkpoint 的 identity 为 `sha256:79027b42faf2ca0d2559dc930a182eaa751101a86f6e75e10aad602f0186dbb0` / file `sha256:da654021a302d9a3035d091e2c3ae3b9b95ebfcc33924a71eb8960a9135a7cbe`（31 modules）；当前 6C-B managed caller 变更后的 daemon/one-shot identities 记录于下方 6C-B subsection。Runtime schema `sha256:692afe4905463d1a4bd3347fa61fa23d63c44b7b3df764c236d272170e7f5b6b` unchanged；Desktop compatibility remains pinned until Task 7 pairing。

**边界：** 本切片不完成 legacy caller matrix/enforcement（6C-B/6C-C）、Desktop/Tauri supervision（Task 7）、provider/model/channel/network、生产 G1 activation、whole-root writer claim 或 external delivery；`external_send=false`。

#### Task 6C-B：managed one-shot 与 carrier admission enforcement

**当前状态：** 已完成（managed entrypoints only；6C-C raw/extension/direct writer audit 与 Task 7 Desktop supervision 未开始）。

**描述：** 将 6C-A lifetime writer admission 接入现有 one-shot bridge 的 mutating operations，以及 reusable/Feishu carrier 的整个启动与 quiescent shutdown 生命周期。只读 bridge projection/health/manifest 不 acquire；不改变 Runtime Protocol v1、默认 `activation_pending` 或外部发送边界。

**验收证据：** active daemon 下 `command`、`delete`、`students`、`connector-setup/configure` 在 handler lock/state/network 之前 fail closed，temporary state 保持不变且 connector verifier call 为零；真实 reusable custom-channel carrier 与 daemon/second carrier 互斥并在 returned close 后可重入；Feishu startup 在 admission 前不写 status/加载 model/channel；application runtime 停止 intake、等待 in-flight message、idempotent close；Feishu scheduler 的 serialized tick 与 bounded drain、late no-detach emission、双方 exact `excludeTools: ["bash", "edit", "write"]` 均由 Core focused test 覆盖。

**验证：** `npm run test:core-runtime-managed-callers`、carrier/application/connector/preflight、bridge/C1 parity、`npm run test:core-runtime-writer-admission`、`npm run test:core-runtime-store`、`npm run test:core-runtime-g1`、`npm test`、`npm run typecheck`、`npm run benchmark:core-runtime-store`、contract/manifest read-only SHA+bigint `mtimeNs` proof、audit 与 Core/Desktop `git diff --check` 均通过。current Core daemon manifest identity `sha256:4822e5207c253a44358ab796b81d051ae1c026835730fd9ab24704047cffa512`（file `sha256:41f12e619fe63e18e2a0d820724881872c7252e809301f7c6e8095dde2deeae0`），Desktop one-shot characterization identity `sha256:012b4d674575c8f913539db2f89bf6918f6dbf91e2f4ae61a081503a6bcef820`（file `sha256:110dbc0d2f70dc67085f5156ad648c4aa9476cd03a9b06bf16531c1177d0fb5e`），bridge entrypoint `sha256:8de6f82418e9339c6d6ad6e7871e9de193cfd14ac8f888af06421cb62d6d5cc8`；Phase0/Task5 one-shot baseline remains historical and Desktop compatibility stays pinned until Task7 pairing.

**边界：** 6C-B 不包含 extension/safe-store/raw/manual cross-file writer enforcement（6C-C），不启动 provider/network production flow，不完成 Desktop/Tauri supervision，不声明 whole-root single-writer、production G1、E3/E4/E5、teacher usefulness 或 L4。

**验收标准：**

- [ ] one-shot、carrier scheduler/Feishu、extension/direct cross-file writers 均已审计并路由或 fail closed；
- [ ] enforcement gate 证明同一 data root 没有 legacy dual writer，rollback/re-enable 顺序可验证；

**验证：** caller matrix/source audit, enforcement tests, rollback rehearsal and paired Desktop review; 6A queue evidence is supporting evidence only.
**依赖：** Task 6B。
**可能涉及：** existing writer entrypoints, bridge/Feishu/calendar/extension callers, enforcement tests and paired Desktop plan; no silent deletion or migration.
**规模：** M。

#### Task 7：让 Tauri 监管 Core，而非让聊天会话代表 Core 生命

**描述：** Tauri 启动并验证 Core daemon，把 endpoint/token 仅传给本机 Next 服务；窗口关闭策略与真正退出分开。Next 路由通过 daemon client 访问 Core，保留一键回滚到 one-shot 的发布开关，但同一时刻只能有一个 writer。

**验收标准：**

- [ ] Desktop 启动可证明 daemon 实例身份；
- [ ] Chat Agent 空闲销毁后 Core 仍为 ready；
- [ ] Desktop/daemon 任一方异常退出时不会留下无主 writer；
- [ ] Desktop supervision and caller contracts consume only the reviewed daemon boundary；
- [ ] 退出与升级路径可停止、恢复或回滚；
- [ ] Web 模式在没有 supervisor 时显示明确 unavailable，不伪装常驻。

**验证：** Rust unit tests、server launcher tests、daemon client tests、packaged-process cleanup test；不运行 `next build`。

**依赖：** Task 6。
**可能涉及：** `src-tauri/src/lib.rs`、Desktop server launcher、Core client/status route及测试。
**规模：** M。

#### Task 8：用 G1 完成常驻连续性 E2

**描述：** 复用 PR C 的课前 case，证明没有活动 Chat、通道未连接、Core/ Desktop 重启和模型临时不可用时的正确行为。

**验收标准：**

- [ ] 注入到期 timer 后自动从 queued 到真实 `draft_ready`；
- [ ] 产物、哈希、来源和 transition 完整；
- [ ] 重启/replay 不产生第二 case 或第二产物；
- [ ] 模型不可用时不宣称完成，恢复后可重试；
- [ ] `external_send=false`。

**验证：** paired Core/Desktop E2 + 浏览器对象时间线 + daemon restart。
**依赖：** Task 7。
**可能涉及：** 仅测试、fixture 和必要的 Runtime glue；不得重写 PR C 领域实现。
**规模：** M。

### Checkpoint 1：G1 局部 L4

- [ ] 教师没有再次发起生成；
- [ ] 无活动聊天会话时任务仍完成；
- [ ] 真实产物、来源、回执、重启证据齐全；
- [ ] 失败时不伪造完成；
- [ ] 架构价值账本记录 Runtime Spine 实际参与点。

### Phase 2：Fact Spine v1，用 G2 证明“说一句就正确记住”

#### Task 9：先锁定并修复跨类型记忆合并回归

**描述：** 为同一学生的错因、进步、行为和一般观察建立回归用例，证明不同事实不会仅因学生姓名标签相同而相互覆盖。只做根因修复，不顺手重构全部记忆。

**验收标准：**

- [ ] 现有实现下测试先失败；
- [ ] 同学生同事实可累计，不同事实保持独立；
- [ ] 已解决事实不继续触发旧提醒；
- [ ] 旧数据读取行为有明确兼容结论。

**验证：** targeted memory regression + existing memory/profile/proactive tests。
**依赖：** Checkpoint 1。
**可能涉及：** Core `extensions/memory.ts` 与一个定向测试。
**规模：** S。

#### Task 10：定义 Education Fact v1 与稳定身份

**描述：** 为 G1/G2/G3 定义最小实体、alias、事实、来源、置信、冲突、supersede、删除和版本合同。Fact 不是模型摘要，也不取代原始 observation。

**验收标准：**

- [ ] 同一学生跨 Desktop/adapter 映射到同一稳定 ID；
- [ ] 一个事实可绑定多个来源，来源变更可使派生产物 stale；
- [ ] 观察、事实、假设、洞察四类状态不可混用；
- [ ] 冲突不会直接覆盖 accepted fact；
- [ ] 删除/恢复与既有软删除语义一致。

**验证：** schema/property tests、identity collision fixtures、conflict/restart tests。
**依赖：** Task 9。
**可能涉及：** Core fact contract、store/projector、tests；先不改 Desktop UI。
**规模：** M。

#### Task 11：把 G2 口述编译为 observation 与 fact candidates

**描述：** 输入始终先保存原话和来源；确定性 roster/context 先解析实体，模型只在严格 schema 内辅助拆分。明确事实可按政策接受，歧义、关系推断和学生定性保持 pending/hold。

**验收标准：**

- [ ] G2 三名学生正确拆分；
- [ ] 无 roster 命中时不猜学生身份；
- [ ] 重复消息、同内容不同 source、来源修订行为明确；
- [ ] 模型输出越界、缺字段或超时不写正式事实；
- [ ] 安全与高风险观察继续保留教师 gate。

**验证：** frozen G2 fixtures、schema fuzz、model unavailable、idempotency、conflict tests。
**依赖：** Task 10。
**可能涉及：** Core perception adapter、fact compiler、teacher-review integration及测试。
**规模：** M。

#### Task 12：统一 G2 的记忆投影与下一课消费

**描述：** 学生档案、教学记忆、学科状态和下一课准备从 Fact v1 投影，不再各自解释同一句原话。旧 JSON 先作为只读输入或兼容投影，不做破坏性迁移。

**验收标准：**

- [ ] 接受后的事实出现在学生与教学两个视图但只有一个事实身份；
- [ ] 修改一次即可同步所有投影；
- [ ] rejected/deleted fact 不参与召回和下一课准备；
- [ ] restart 后查询结果和使用记录一致；
- [ ] 不存在 Desktop 或 adapter 直写记忆。

**验证：** paired projection E2、query tests、restart、legacy shadow comparison。
**依赖：** Task 11。
**可能涉及：** Core fact projectors、snapshot projection、Desktop contract/consumer及测试。
**规模：** M，Core 与 Desktop 分为配对 PR 的两个提交。

### Checkpoint 2：G2 局部 L4

- [ ] 一句话正确形成多对象事实；
- [ ] 明确事实无需重复录入；
- [ ] 只有歧义项要求老师判断；
- [ ] 修改影响下一课准备；
- [ ] 无跨学生、跨类型覆盖。

### Phase 3：Capability Package v1，用 G3 证明能力能兑现

#### Task 13：定义能力包合同与 checker

**描述：** 在不迁移全部技能的前提下定义一个最小 executable capability contract，覆盖输入、输出、证据、权限、错误、重试、stale 和 checker。

**验收标准：**

- [ ] 输入只能引用可定位事实、材料和 case revision；
- [ ] 输出 title/type/schema 与计划 deliverable 完全匹配；
- [ ] 缺证据、模型不可用、checker 失败有不同状态；
- [ ] capability 不能自行外发或修改正式事实；
- [ ] 运行记录可回答“用了什么、为何运行、产物在哪里”。

**验证：** contract fixtures、invalid output、missing evidence、permission、retry tests。
**依赖：** Checkpoint 2。
**可能涉及：** Core capability contract/registry/runner/checker及测试。
**规模：** M。

#### Task 14：把“安全教育工作总结”转换为首个能力包

**描述：** 从现有 Markdown 技能与模板提取必要内容，建立 G3 的事实查询、材料缺口、输出结构、质量 checker 和失败样例。原 SKILL.md 保留为说明，不再由前 500 字路由决定完成质量。

**验收标准：**

- [ ] 只引用本学期与目标班级的证据；
- [ ] 缺失活动、日期或来源时输出缺口，不编造；
- [ ] 每个结论可回到来源 ID；
- [ ] 产物通过结构与证据 checker；
- [ ] 黄金与失败样例固定。

**验证：** frozen G3 benchmark、held-out sample、source leakage、wrong-semester tests。
**依赖：** Task 13。
**可能涉及：** 一个能力目录、runner adapter、checker、fixtures；不得批量改其余技能。
**规模：** M。

#### Task 15：让调度器提前运行 G3 并吸收教师反馈

**描述：** 可信 deadline 建立工作包后，Core 在准备窗口内自动运行能力包；教师修改形成 diff 与 policy candidate，但不自动晋级。

**验收标准：**

- [ ] 不出现“要我现在生成吗”；到期前直接得到内部草稿；
- [ ] source revision 变化使旧产物 stale；
- [ ] 修改、拒绝、暂缓均有 receipt 并影响下一轮行为；
- [ ] policy candidate 只影子记录，不自动改变正式策略；
- [ ] restart/retry 不重复产物或反馈。

**验证：** paired G3 E2、stale/restart/retry、teacher-edit diff、no-external-send tests。
**依赖：** Task 14。
**可能涉及：** Core planner/scheduler integration、transition projection、Desktop existing review/artifact consumer及测试。
**规模：** M。

### Checkpoint 3：G3 局部 L4

- [ ] 通知后无需再次发起生成；
- [ ] 初稿与缺口清单提前到达；
- [ ] 每段内容有来源；
- [ ] 修改进入下一轮候选；
- [ ] 未经授权外发为零。

### Phase 4：删减与真实效果基线

#### Task 16：运行架构 kill test

**描述：** 对价值账本中的每个机制回答：三条黄金任务是否调用、删除后哪个验收失败、是否减少教师操作、是否改善 restart/证据/安全。没有可观察贡献的机制不得继续占用核心路径。

**验收标准：**

- [ ] 每个机制得到 `keep`、`integrate`、`freeze`、`retire` 最终结论；
- [ ] 先停止路由/加载，再经过一轮完整回归后才允许删除；
- [ ] 不删除历史来源、教师数据或审计证据；
- [ ] 六层继续作为内部职责模型，不成为必须保留六套存储的理由。

**验证：** 三条黄金任务全量回归 + final diff/reachability review。
**依赖：** Checkpoint 3。
**可能涉及：** value ledger、加载配置、后续独立 deprecation PR；本任务本身只形成决策。
**规模：** S。

#### Task 17：建立真实教师 E5 前的产品基线

**描述：** 先由当前用户用真实但可脱敏材料跑三条闭环，记录接受、修改、拒绝、耗时、遗漏和打扰；再决定是否进入至少三位教师、连续四周的 E5。

**验收标准：**

- [ ] 三条任务各有至少一次真实材料运行；
- [ ] 记录老师从零制作时间与 EduPi 审核时间；
- [ ] 保留失败、拒绝和撤回样例；
- [ ] 不用模型自评替代教师判断；
- [ ] 只有数据支持时才重新评定整体 L4。

**验证：** source-backed scorecard + teacher decision + restart record。
**依赖：** Task 16。
**可能涉及：** benchmark evidence 与 checkpoint ledger，不默认修改产品。
**规模：** S。

## 7. 每阶段统一证据

每个 PR 至少记录：

```text
Observed failure:
Hypothesis:
Expected measurable improvement:
Baseline:
Evaluation task: G1 | G2 | G3
Result:
Decision: keep | revise | revert
```

Core：

- 定向 regression / contract / crash / restart tests；
- `npm run typecheck`；
- `npm test`；
- `git diff --check`。

Desktop：

- 定向 Node tests；
- `node_modules/.bin/tsc --noEmit`；
- `npm test`；
- `npm run lint`；
- 真实浏览器检查与 0 console error；
- Tauri/Rust tests（涉及 supervisor 时）；
- `git diff --check`；
- 开发期间绝不运行 `next build`。

配对证据：

- 精确 Core commit + component manifest；
- fixture manifest 与 contract identity；
- restart/replay/stale/model-unavailable；
- 教师输入、事实、case、execution、artifact、decision、receipt 的同链 trace；
- `external_send=false`。

## 8. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 与 PR A/B/C 重叠 | 合同冲突、重复实现 | 三项合并并冻结基线前不激活；Runtime 复用其合同 |
| 脏 Core 工作树被误改 | 丢失用户工作 | 只从明确 commit 新建 worktree；不清理现有目录 |
| daemon 与 one-shot 双写 | 数据损坏 | data-root lease；任何时刻只有一个 writer；发布开关互斥 |
| 常驻进程泄露 token/路径/教师内容 | 隐私与安全事故 | loopback、随机 token、最小环境、脱敏日志、路径 containment |
| Fact v1 变成大而全知识图谱 | 延迟、迁移风险 | 仅覆盖 G1/G2/G3；旧数据先 shadow/read-only |
| 模型失败却被包装成完成 | 教师失信 | artifact/checker/receipt 门槛；明确 unavailable 与 retry |
| 能力包再次膨胀为技能目录 | 无实际收益 | Phase 3 只迁移一个 G3 能力；通过后再排下一个 |
| 过早恢复潜意识/多 Agent/自进化 | 分散主线 | Checkpoint 3 前保持 freeze；kill test 后再决定 |

## 9. 停止与重判条件

出现任一情况时停止扩展并回到最近 checkpoint：

1. 为实现 daemon 必须复制或重写 PR A 的教育对象合同；
2. 同一 data root 出现两个可写 runtime；
3. G1 在常驻化后比 one-shot 基线更容易重复或丢失任务；
4. G2 无法在不猜测学生身份的前提下正确拆分；
5. G3 checker 无法阻止无来源内容进入草稿；
6. 教师审核操作数高于原有从零工作流；
7. 任一链路为了通过测试而使用模型自述、隐藏失败或跳过重启证据。

## 10. 完成定义

本计划完成时：

- G1、G2、G3 分别通过确定性 E2、真实材料运行和教师决定；
- Core 在没有活动 Chat 或已连接消息通道时仍能持续运行内部工作；
- 教育事实不因不同载体、不同视图或同一学生的不同事件而分裂/覆盖；
- 至少一个 Markdown 场景技能已成为有 schema、checker、失败状态和产物回执的能力包；
- 未使用的高层机制已有冻结或淘汰决定；
- 产品是否达到整体 L4 由真实教师证据决定，而不是由计划、架构图或代码数量决定。

## 11. C1 writer-enforcement correction (2026-09-05, append-only)

The earlier Task 6C-C1 `complete` wording remains historical.  A fresh review
opened a bounded Core fix-first window (`fix-in-progress`) for four gaps: an
open Core store could outlive its exact outer admission, admission pathname and
sidecar identities were not fully pinned, JS/TS safe-save had parent and
backup-source TOCTOU windows, and an unknown-fstat cleanup could unlink an
unidentified pathname.  This did not start C2/C3 or change the Desktop runtime
contract.

The corrected Core evidence supersedes that interim status: exact outer-lease
store binding, pre/post-open admission identity checks, all-sidecar snapshots,
canonical ancestor/parent fences, no-follow/fstat backup reads, target-inode
publication checks, generic redacted I/O errors, and orphan-on-unknown-fstat
cleanup are covered by local deterministic tests.  A real local Pi
`DefaultResourceLoader`/Jiti test loads a temporary-root TypeScript extension
that imports the repository safe-store, succeeds while the ESM admission is
held, and fails after release; the temporary fixture never enters the repo
extension tree.

Core writer-admission, writer-enforcement, safe-store fencing,
extension-loader, storage-contract, managed-callers, store, and G1 suites;
Core `npm test`, typecheck, benchmark, bridge checks, two contract/manifest
checks; Desktop `node --test lib/edupi-core-process-client.test.mjs` (6 passed,
1 skipped, 0 failed); and both `git diff --check` runs passed.  Core/Desktop
manifest identities were regenerated once after source stabilization and are
recorded in the linked Core evidence.  Node v22 has no `renameat`/`renameat2`,
so the implementation documents canonical realpath/inode fencing as the
strongest available boundary rather than claiming absolute cross-process
openat safety.  `external_send=false`; Task 6C-C2/C3 and Task 7 remain open.

The paired Core worktree's `docs/loop/evidence/2026-09-05-core-runtime-writer-enforcement-foundation.md`
records the exact commands, outputs, hashes, residual limitations, and rollback.

Final fresh Sol/Max reviewer v2 returned `ship` with no P0/P1/P2/P3 findings
after independently inspecting the corrected code/tests and rerunning the Jiti
test without `--import tsx`.  Behavioral read-only review metadata: model
`gpt-5.6-sol`, reasoning `max`, sandbox `danger-full-access`, permission
`disabled`; parent verification found identical before/after Core/Desktop
fingerprints.

## Task 6C-C2 Core handoff — 2026-09-05 (append-only)

The paired Core worktree completed the bounded C2 raw/extension/maintenance/
E4 enforcement slice. Exact live admission now guards canonical raw sinks and
JS/TS safe-store destinations; setup, setup:web, rhythm, and education-info
use one exact-target maintenance preloader; evolution writes and external
actions are frozen; E4 rejects before log/stream/spawn/provider work.
Education snapshots are read-only and admitted recovery owns pending-material
rename. Core C2 focused output, full Core npm test, typecheck, 300-row
benchmark, bridge/parity, two contract/manifest checks, Desktop process-client
(6 passed, 1 skipped, 0 failed), and both diff checks passed. C3's versioned
matrix/detector/rollback rehearsal and Task 7 remain pending; external_send
remains false.
Evidence: the paired Core
docs/loop/evidence/2026-09-05-core-runtime-raw-writer-enforcement.md.

Current one-time post-stabilization component identities are Core
sha256:dfb3ca7a9759e8cc6eec215189458e6854050b2c3a98b1d151a2144f9f8b33a2 and
Desktop sha256:829ae80ca75717966b5abeebab0cc4e24072481ff8b31f383e0757d6a228b799.
The final fresh Sol/Max v2 review remains ship with no P0/P1/P2/P3 findings;
the reviewer reran the Jiti test without --import tsx, used
gpt-5.6-sol/max with danger-full-access and permission disabled, and parent
verified identical before/after Core/Desktop fingerprints.

## Task 6C-C2 correction — 2026-09-05 (append-only)

The earlier C2 `passed` wording is historical/suspended for the fresh
fix-first correction window. Core now proves strict canonical education
material recovery, a frozen default evolution extension, immutable-startup
maintenance preloader validation, canonical-only safe-store writes,
rollback-safe Feishu/DingTalk connector pairs with fail-closed pending-marker
recovery, lease-loss-safe temp cleanup, and bounded relative public/log paths.
The focused C2 and evolution-freeze suites, all affected/full Core checks,
single post-stabilization Core/Desktop manifest refresh, Desktop process-client
check, and both diff checks passed; `external_send=false` and
`activation_pending` remain. C3's versioned matrix/detector/rollback work is
still pending. Detailed evidence and current component hashes are recorded in
Core `docs/loop/evidence/2026-09-05-core-runtime-raw-writer-enforcement.md`.

## Task 6C-C2 P2 final superseding record — 2026-09-06 (append-only)

The earlier P2 `evidence_pending` note is superseded: the macOS canonical
`/var` ancestor-alias correction is green, full Core `npm test` and focused G1
passed exit 0, and all C2/C1/enforcement/fencing, typecheck, benchmark,
immutable double checks, bridge, Desktop process-client (6 passed, 1 skipped,
0 failed), and both diff checks passed. Current manifest identities and
residuals are recorded in Core
`docs/loop/evidence/2026-09-05-core-runtime-raw-writer-enforcement.md`;
C3 remains pending and `external_send=false`.

## Task 6C-C2 P2 correction — 2026-09-05 (append-only)

Fresh reviewer v2 suspended the corrected C2 status for two bounded fixes:
preserve pre-existing connector registry backups during pair publication and
reject rogue cached lock bindings before safeSave can create them. The
superseding Core evidence is appended after verification; C3 remains pending.

## Task 6C-C2 P2 superseding record — 2026-09-06 (append-only)

Both P2 corrections are focused-green: connector pair publication preserves
pre-existing registry `.bak` bytes/modes across Feishu/DingTalk failure
boundaries, and JS/TS safeSave rejects rogue cached lock bindings before lock
directory creation while canonical writes remain valid. C2 focused,
connector/safe-store/C1, typecheck, benchmark, immutable double checks, bridge,
and Desktop process-client (6 passed/1 skipped/0 failed) passed; both diff
checks passed. The attempted full Core `npm test` exited 1 in the existing G1
activation path (`database_unavailable`), reproduced by focused G1, so the
broader handoff remains `evidence_pending`; C3 remains pending.

Current Core/Desktop manifest identities and detailed residuals are recorded in
Core `docs/loop/evidence/2026-09-05-core-runtime-raw-writer-enforcement.md`.

## Task 6C-C2 v3 fix-first window — 2026-09-06 (append-only)

Fresh Sol v3 review (`gpt-5.6-sol/max`) suspended the prior C2 evidence for
one P1 safe-store binding issue: an exact expected lock path replaced by an
outside symlink could pass lexical validation. Core is correcting this by
validating each existing canonical binding component while retaining the
legitimate macOS ancestor alias, with normalized dead-PID JS/TS lock-symlink
regressions. Final superseding status follows clean verification; C3 remains
pending.

Source-stable manifest identities for this fix-first window are Core component
`sha256:813995b6819937a129db97ff49cb3bd89f8d878d26dc67c8275dd935cf91258a`
(manifest file SHA `sha256:2c02a54a87be8a2ff9580fd0c69d064dbef18139b78c52d1d50ecede50e68ab8`,
302141 bytes, 33 modules/5 assets, `mtimeNs=1788626517008540218`) and Desktop
component `sha256:8301340f757adc28165e614427ca22268c9eb5d85cca3b8b7ba1bc1963cf7c30`
(manifest file SHA `sha256:fc17520c9fda1179a273b590f23f618b7c576bb1a5eb6519a12237e27dd1211c`,
300622 bytes, 28 modules/2 assets, `mtimeNs=1788626528905524447`).

## Task 6C-C2 v4 fix-first window — 2026-09-06 (append-only)

Fresh Sol v4 runtime evidence suspended the v3 window for a P1 in which a
direct production `application_runtime.trace` `withLock` caller could follow
an outside lock-directory symlink after module load. Core now fences the JS/TS
lock binding inside `withLock` and acquire/release before every lock filesystem
boundary; invalidation rejects before callbacks and release retains the owned
orphan. Generic no-admission coordination and the valid macOS `/var` ancestor
alias remain compatible. Direct JS/TS primitive, production trace, stale
sentinel, and release-orphan regressions plus focused/full checks are green;
C3 remains pending and `external_send=false`.

Source-stable manifest identities: Core component
`sha256:79e36329901a719f68e33dac2bbdfffb22a1934999c4f91cee28bd2515eb15d3`
(file SHA `sha256:f4f922f6efde3d5151ab2328d805dc4c34db29f016d463f649d23c9bb5965d71`,
302141 bytes, 33 modules/5 assets, `mtimeNs=1788628918655729925`) and Desktop
component `sha256:9f1570229edf88e8e237682b9b4608455c931018725f74fe74a527e0622a2d73`
(file SHA `sha256:4f446bcd3ee300150e97fc802b1877c878639d33bc6ee58ea00142b3049bd788`,
300622 bytes, 28 modules/2 assets, `mtimeNs=1788628946656237626`).

## Task 6C-C2 terminal reconciliation — 2026-09-06 (append-only)

Fresh Sol v5 runtime review (`gpt-5.6-sol/max`, `danger-full-access`,
permission disabled, behavioral read-only) found no P0/P1/P2/P3 issues;
VERDICT: `ship`. Parent verified identical before/after reviewer fingerprints:
Core diff `ba59a72f…` with untracked `ad3a11a3…`, Desktop diff
`38299475…`, and both HEADs unchanged. This terminal record supersedes prior
C2 fix-first entries without rewriting historical records.

Final C2 checks passed: full Core `npm test`; C2 direct-lock/runtime, G1,
enforcement, fencing, typecheck; 300/300/300 benchmark with SQLite integrity;
bridge/Desktop process-client; double immutable contract/manifest checks; and
Core/Desktop diff checks. Defaults remain `external_send=false` and
`activation_pending`.

Current manifests are Core component
`sha256:79e36329901a719f68e33dac2bbdfffb22a1934999c4f91cee28bd2515eb15d3`
file `sha256:f4f922f6efde3d5151ab2328d805dc4c34db29f016d463f649d23c9bb5965d71`
and Desktop component
`sha256:9f1570229edf88e8e237682b9b4608455c931018725f74fe74a527e0622a2d73`
file `sha256:4f446bcd3ee300150e97fc802b1877c878639d33bc6ee58ea00142b3049bd788`.

Residuals: documented Node `renameat`/`renameat2` limitation, C3 versioned
matrix/detector equality plus rollback rehearsal, provider/network/external
sending, and `npm audit`. Next entry point: C3 versioned matrix/detector
equality and rollback rehearsal.

## Task 6C-C3 final verification — 2026-09-06 (append-only)

C3 implementation gates passed: the read-only TypeScript compiler-scanner
detector and explicit reviewed matrix match in both directions (286 facts, 73
package commands, 18 configured extensions, one executable opaque launcher;
matrix SHA `sha256:c817930970afed12443062e50d3ec95172dff1170517e5d0a9b844ed8d9c61fa`).
The real daemon/legacy rollback rehearsal completed 11 ordered phases with
`writer_count_max=1`, proving both daemon→legacy and legacy→daemon exclusion,
release, and new-generation re-enable. Full Core `npm test`, C1/C2,
typecheck, benchmark (300/300/300 with SQLite integrity), bridge/Desktop,
immutable double checks, and diff checks passed. No C3 runtime closure bytes
changed; `external_send=false` and `activation_pending` remain. Final review is
the next entry point; Task 7 and `npm audit` remain pending.

## Task 6C-C3 wording reconciliation — 2026-09-06 (append-only)

The earlier C3 record's “skips symlinked paths” wording is superseded: both
recursive source enumerators now reject source-root, intermediate, and file
symlinks with bounded errors. The nested fixture proves this, and the focused
C3 rerun remains green with 286 facts, 73 commands, 18 configured extensions,
one executable opaque launcher, and matrix SHA
`sha256:c817930970afed12443062e50d3ec95172dff1170517e5d0a9b844ed8d9c61fa`.
Task 7 remains pending.

## Task 6C-C3 dynamic SQLite correction — 2026-09-06 (append-only)

Dynamic `await import("node:sqlite")` resolution is now covered: production
`core_runtime_writer_admission.mjs` and `core_runtime_store.mjs` each expose
exactly one `node:sqlite.DatabaseSync` fact. The reviewed matrix is 288 facts,
73 commands, 18 configured extensions, and one executable opaque launcher,
SHA `sha256:92310a9de44e6af663fe6e36651cd1ad7a06816d5d395a7932e513a06d998fd2`.
Focused C3, full Core `npm test`, typecheck, benchmark, bridge/Desktop,
immutable double checks, and diff checks passed; manifests remain unchanged,
`external_send=false`/`activation_pending`, and final review plus Task 7 remain
pending.

## Task 6C-C3 four-review-corrections window — 2026-09-06 (append-only)

Latest Sol/Max review remains `fix-first` pending fresh final re-review. Core's
reversible correction freezes `scripts/pi-edupi` before environment/Pi access
with exit 78 and bounded `pi_launcher_frozen`/`external_send=false`; the
fake-Pi and hostile-env regression passed. The read-only scanner now inventories
link/ftruncate/writev pairs and direct, bracketed, and assignment-alias
`require("fs")` calls. The reviewed policy is exact path+operation with no PATH
fallback, and unfamiliar operations in known paths fail closed. The real
daemon rehearsal now proves a bounded silent-child readiness deadline kills and
reaps the child (`readiness_timeout_reaped=true`).

The reviewed matrix is
`sha256:78a62789a66bc0108012e9f3ab95c4403c2780a447457c4829f49f84f4d19c07`
with 288 findings, 73 package commands, 18 configured extensions, and one
frozen opaque launcher (policies: findings 203 admitted/53 read_only/6
runtime_bootstrap/5 managed_lifetime/10 managed_maintenance/2
frozen_fail_closed/6 build_only/2 os_temp_only/1 read_only_coordination;
commands 56 test_only/9 build_only/4 managed_maintenance/2 managed_lifetime/1
frozen_fail_closed/1 read_only; extensions 13 admitted/4 read_only/1
frozen_fail_closed). Focused C3, full Core `npm test` exit 0, typecheck,
300/300/300 benchmark with SQLite integrity, C1/C2/daemon/G1 gates,
bridge/parity, Desktop process-client (6 passed/1 skipped/0 failed), immutable
double checks, and Core/Desktop diff checks passed. No runtime manifests were
regenerated; `external_send=false`/`activation_pending` remain. Fresh final
review, provider/network/external sending, audit, and Task 7 remain pending.

## Task 6C terminal reconciliation — 2026-09-06 (append-only)

Fresh final Sol v2 review runtime was `gpt-5.6-sol/max` with
`danger-full-access`, permission disabled, and behavioral read-only review.
It returned **No P0–P3 findings**; verdict: `ship`. Parent verified identical
reviewer before/after fingerprints: Core HEAD `0f13438…`, diff `3c60bccd…`,
untracked `815042e8…`; Desktop HEAD `2793d74…`, diff `d627345f…`, with no
untracked files. This terminal record supersedes prior C3 fix-first records
without rewriting history.

Task 6C is complete. Final Core matrix
`sha256:78a62789a66bc0108012e9f3ab95c4403c2780a447457c4829f49f84f4d19c07`
has 288 findings, 73 package commands, 18 configured extensions, and one
opaque launcher. Focused C3 includes `launcher_frozen=true` and
`readiness_timeout_reaped=true`; full Core `npm test`, typecheck, benchmark,
C1/C2, daemon/G1, bridge/Desktop, immutable checks, and Core/Desktop diff
checks passed. Runtime manifests remain unchanged; `external_send=false` and
`activation_pending` remain.

Residuals: the documented Node `renameat` limitation,
provider/network/external sending, and audit. Next entry point: Task 7 only;
this plan does not claim L4 or product completion.

## Task 7 implementation verification — 2026-09-06 (append-only)

Task 7 is `implementation_verified` pending its fresh final review. The final
design supersedes the rejected first supervision draft: Tauri starts a
process-isolated broker and waits only for its stable proxy identity before
starting Next; Core may still be starting, restarting, or failed. The raw Core
token never enters Next. Next receives one frozen broker capability restricted
to bridge `health`, `snapshot`, `command`, `students`, and `delete`; runtime
lifecycle, enqueue, connector configuration, provider/channel, and external-send
operations are not delegated.

Daemon mode keeps one supervised Core child and validates every ready/restarted
identity with a direct authenticated Core health request. One-shot rollback is
also brokered, serial, and has no resident daemon. Core parent-death supervision
is armed before startup authority, the broker has one 20-second stop deadline,
and Tauri gives it a 25-second reap margin before process-tree termination. Web
without an attested supervisor returns explicit unavailable and never starts a
fallback writer.

Verification passed: Core full `npm test`, typecheck, 300/300/300 benchmark,
double immutable contract/manifest checks, and the C3 288/74/18/1 matrix with
`writer_count_max=1`; Desktop focused Task 7 tests 62/62, TypeScript, lint, and
two 23/23 Rust runs. Desktop full `npm test` ran 867 tests with 861 passed, 5
skipped, and one known public-source failure caused solely by the earlier
append-only plan's maintainer-machine path record. Task 7 added no new machine
path and does not rewrite that history. Core evidence is
`docs/loop/evidence/2026-09-06-core-runtime-task7.md`.

Paired identities are Core commit
`0f13438af117569f6f1ae896a7ee5bc771cb8c9e`, Runtime schema
`sha256:315be5504ecffa382213d90211fc6263664bdcfcbb7974edb5994d0c3e7aaef2`,
and Core daemon component
`sha256:3a9522bec208e38328ec2be91c7c170f1308fe412db63394d1c1c1c77c4c45e1`.
No `next build`, `desktop:prepare`, packaged app, provider, network, channel, or
external send was run. Defaults remain `activation_pending` and
`external_send=false`; Task 8 and any L4 claim remain blocked on the fresh Task
7 review.

## Task 7 first-review correction — 2026-09-06 (append-only)

The first fresh final review returned `fix-first`; its verdict is superseded.
It found that an active one-shot could outlive a killed broker and that the Core
HTTP socket's five-second inbound timeout could cut off a valid 5–15 second
mutation response. The corrected one-shot arms an independent worker-thread
parent watchdog before writer admission, and Core now separates inbound body
timeout from operation response timeout with a one-second transport margin.

Focused evidence now proves broker kill during a real blocked one-shot mutation
releases admission twice in about 1.1 seconds, and a real 5.75-second daemon
mutation returns the same successful response before its fifteen-second command
deadline. Daemon/one-shot component identities are respectively
`sha256:3a9522bec208e38328ec2be91c7c170f1308fe412db63394d1c1c1c77c4c45e1`
and
`sha256:eae0e255a2336c7121c2112aba6b4e914b3e9c8b37e7c0e29b935ebf08f8795c`.

Post-correction Core full/focused/typecheck/benchmark/immutable checks, Desktop
focused 63/63, TypeScript/lint, Desktop full 868 with only the unchanged
historical path finding, and both Rust 23/23 runs passed. Task 7 returns to
`implementation_verified` and still requires a new fresh `ship` review. Task 8,
provider/channel/network/external sending, and any L4 claim remain blocked.

## Task 7 second-review correction — 2026-09-06 (append-only)

The second fresh review returned `fix-first`; its verdict is superseded. The
broker now validates and narrows Core bridge health to the exact five operations
it permits, so real supervised health and the actual status route report
`ready`. Transport clocks are ordered outside the operation clock: one second
of Core-facing grace, two seconds for Next callers, and a three-second final
broker-socket bound. A complete Core→broker→Next regression preserves the typed
`bridge_timeout` emitted at 15.05 seconds and observes it at about 15.2 seconds
instead of reporting an outer timeout.

Desktop focused Task 7 tests now pass 64/64; TypeScript and lint pass; full
Desktop runs 869 tests with 863 passed, 5 skipped, and only the unchanged
historical path finding. Core production bytes and the daemon/one-shot identities
remain unchanged from the first correction. Task 7 is
`implementation_verified` pending another fresh final review; Task 8 and any L4
claim remain blocked, with `activation_pending` and `external_send=false`.

## Task 7 terminal reconciliation — 2026-09-06 (append-only)

The new fresh final Sol/Max review returned `ship` with no findings. It used the
exact `sol_advisor_new_sol_reviewer` role on `gpt-5.6-sol/max`, observed
`danger-full-access` with permission disabled, and remained behaviorally
read-only. Parent verification found identical before/after fingerprints:
Desktop HEAD `2793d74c…`, diff `f196cd46…`, untracked `e3346e49…`; Core HEAD
`0f13438…`, diff `687091b6…`, untracked `6801c7f0…`.

Task 7 deterministic local Desktop supervision is complete. Final evidence is
Core full/focused/typecheck/benchmark/immutable checks; Desktop focused 64/64,
TypeScript/lint, full 869 with only the historical plan-path finding; two Rust
23/23 runs; exact manifest/pin/ADR parity; and all prior review findings closed.
Defaults remain `activation_pending` and `external_send=false`.

This does not claim a packaged/signed cross-platform installed app,
provider/network/channel activation, Task 8 G1 continuity E2, or product L4.
The next authorized implementation entry point is Task 8 only.

## Task 8 implementation verification — 2026-09-07 (append-only)

Task 8 is `implementation_verified` pending a fresh final review. A branded,
test-only Core driver injects the frozen due timer while the normal production
daemon remains `activation_pending`. Attempt 1 records retryable
`model_unavailable`; Core recovery completes attempt 2. A second Core restart
and a complete Desktop broker restart preserve the exact event, task, work case,
execution, receipt, four artifact IDs, four artifact hashes, and the transition
sequence `queued → running → failed → queued → running → draft_ready`. Three
consecutive paired runs were identical. The runner started no Chat runtime, the
browser readiness check measured zero running sessions, no channel was
connected, and `external_send=false` throughout.

The minimum production glue is a bounded, backward-compatible transition
history in the existing calendar-work execution state and projection. It does
not create a second contract or rewrite PR C domain output. Full regression also
closed the Feishu observable-ready/signal-handler race and two nondeterministic
test-harness timing/token defects without changing the accepted capability
boundary.

Core full/focused/typecheck/benchmark/contract/manifest/C3 checks passed. Desktop
supervisor passed 8/8, Task 8 passed 3/3, bridge contract passed 7/7,
TypeScript/lint and both Rust 23/23 root variants passed. Browser verification
showed the same task, six transitions, four verified outputs, no Chat session,
and closed external send with an empty warning/error console. Desktop full
`npm test` ran 872 tests with 866 passed, 5 skipped, and only the unchanged
historical append-only plan-path failure.

Detailed paired identities and acceptance mapping are recorded in Core
`docs/loop/evidence/2026-09-07-core-runtime-task8-g1-continuity.md`. This is
deterministic local G1 continuity E2, not provider-backed teacher evidence,
packaged cross-platform proof, or product-wide L4. Final review remains the
Checkpoint 1 acceptance gate.

## Task 8 first-review correction — 2026-09-07 (append-only)

The first fresh final review returned `fix-first` for two P2s and is superseded.
Core now rejects impossible same-attempt transition order, duplicate projected
transition identities, attempt gaps, and chronological reversal after
canonicalizing offset timestamps. It retains the real stale-source recovery edge
and still derives legacy records without explicit history.

Desktop E2 now rejects duplicate matching tasks, work cases, executions,
artifact IDs, paths, and extra artifact files. The persisted event binding is
part of the restart identity. The non-browser runner says only that it started no
Chat runtime; the visible checkpoint queries `/api/agent/running` and measured
zero active sessions.

Post-correction Core full/focused/typecheck/benchmark/contract/manifest/C3,
three identical paired E2 runs, Desktop supervisor 8/8, Task 8 plus bridge
10/10, TypeScript/lint, browser, full 872 with only the historical path finding,
and both Rust 23/23 variants passed. Task 8 is again
`implementation_verified` pending a new fresh final review. Production remains
`activation_pending`, `external_send=false`, and product-wide L4 unclaimed.

## Task 8 terminal reconciliation — 2026-09-07 (append-only)

The new fresh-context final review returned **No P0–P3 findings** and verdict
`ship`. It confirmed the two earlier P2s are closed: transition history now has
canonical time and exact state/identity invariants, and paired E2 now proves
event/cardinality/complete-file/Chat-runtime claims at their stated boundary.
Parent reviewer before/after fingerprints were identical for both repositories.

Task 8 is complete. Checkpoint 1's deterministic engineering criteria are met:
the teacher did not re-request generation, no Chat runtime was started, the
visible checkpoint measured zero running sessions, exact artifacts/source/
receipt/restart evidence is present, failure never became ready, and the Core
architecture value ledger records Runtime Spine participation.

Phase 1 engineering implementation is therefore complete and Phase 2 Task 9 is
the next entry point. This checkpoint does not activate the production timer or
provider, and it does not claim real-teacher E4/E5, external delivery, packaged
cross-platform operation, or product-wide L4. Defaults remain
`activation_pending` and `external_send=false`.

## Tasks 9-17 implementation verification — 2026-09-07 (append-only)

Tasks 9-16 are implementation-verified pending fresh final review. Task 9 fixes
the cross-type legacy merge without breaking same-fact accumulation. Tasks
10-12 add Education Fact v1, a strict G2 compiler, one shared Core projection,
and a read-only Desktop consumer. Tasks 13-15 add executable Capability v1, the
single safety-education summary package, and a source/revision-bound G3
scheduler with receipt-backed feedback. Task 16 records 26 kill decisions with
no deletion.

The paired G2 E2 preserves one fact identity across three students, student and
teaching views, next-lesson recall, modification, use records, two fresh Core
snapshot processes, and Desktop envelope validation. The paired G3 daemon E2
records a due timer, retryable model outage, supervised Core restart, two
checked artifacts, Desktop bridge review, an unapplied policy candidate, and
complete Desktop restart. A real browser independently opened both artifact
files, observed eight supervised transitions, zero Chat sessions, no
warning/error response, and `external_send=false`.

Core full tests, typecheck, 300/300/300 benchmark, runtime/bridge/component
identities, and C3 305/77/18/1 passed. Desktop paired G1/G2/G3, supervisor 8/8,
TypeScript, lint, browser, and both Rust 23/23 allowed-root variants passed. The
Desktop full suite ran 876 tests with 870 passed, 5 skipped, and only the
unchanged historical append-only plan-path finding.

Task 17's schema, scorecard, empty baseline, and runbook are implemented. Its
product acceptance is deliberately `evidence_pending`: synthetic checkpoints
do not count, and readiness requires independently registered evidence files
with verified material/decision/restart/failure/reject/withdraw hashes. No real
teacher material, timing, or decision was invented. Detailed evidence is in Core
`docs/loop/evidence/2026-09-07-tasks9-17-fact-capability-baseline.md`.

Current identities are bridge
`sha256:41798fb7b5a2b30f09c2dcf07687193a0efbeade93667f47e6fd0c33e70760a3`,
Fact v1
`sha256:f9ed89a97d80c6cafa8d6689b50674b4b15e920e83119eea902d677c00293f55`,
Capability v1
`sha256:b6766441dae1b734c55b90d279dec26894e41096649622c9e97aa3c0093f412a`,
daemon
`sha256:c60fc7cdb1b2f2837f631f0d9c3488a0e15032aac0876217bc6ff689124cfc0f`,
and one-shot
`sha256:e58164d5059652e60204311ed3891512afec50c99ee23516be3151a5f75fba29`.
Production remains `activation_pending`; provider, carrier, network, external
send, packaged release, product-wide L4, and E5 remain unclaimed.

## Tasks 9-17 second-review correction — 2026-09-07 (append-only)

The follow-up review returned `fix-first` for three P1 and five P2 findings. The
correction now persists bounded retry backoff, records adapter timeout at its own
deadline, binds generic capability scope and calendar dates, cross-validates
review receipts against transitions and artifact diffs, and returns the exact
persisted bridge receipt after unrelated work advances. Task 17 evidence now
requires unique normalized physical files plus task/run/decision/restart/example
semantics. The kill ledger covers every documented frozen or retired path,
including all six duplicate report skills. Fact acceptance also discovers
conflicts between candidates proposed before either review, and Fact ingestion
accepts the tested multi-megabyte 501-observation state while bounding the wire
projection.

Post-correction Core full tests, typecheck, frozen contracts/manifests,
`307/77/18/1` writer audit, and 300/300/300 storage benchmark passed. Desktop
paired G2/G3, TypeScript, lint, full 876 with only the unchanged historical
plan-path finding, and both Rust 23/23 root variants passed. Current daemon and
one-shot identities are
`sha256:452ab2fe3ec69e57b80a860381fd62dd371e8fec170169229de35c69e294f41f`
and
`sha256:8a379d43e4512b2488596ccdd565be4721984b5bee20181ef3219504f7a5190c`.
Tasks 9-16 return to `implementation_verified` pending final review. Task 17's
engineering harness is implemented, while product acceptance remains
`evidence_pending`. Production stays `activation_pending` and
`external_send=false`.

## Tasks 9-17 terminal-review correction — 2026-09-07 (append-only)

The fresh terminal review returned `fix-first` for three P1 boundary cases.
Nested roster names now use unique longest-owner matching, so a quote about
`王小明` cannot bind to `小明`. Restoring a deleted accepted fact re-discovers
current conflicts and requires explicit supersession. Capability mutation and
its immutable bridge replay receipt now commit atomically in the same state;
the replay-only binding is excluded from projection identity and remains exact
after unrelated work advances.

Focused Fact, G2, G3 scheduler, bridge, and Task 17 checks pass. The writer
inventory returns to `305/77/18/1`. Final daemon and one-shot identities are
`sha256:a340f82e03f9b9291ae2d9e43ad0b1c231865b33127507d5818a0ee135bac0f6`
and
`sha256:8b7f196d7e6bb14b34aef4514cf0558ea1d9c57b79053d7100359180c7096475`.
Tasks 9-16 remain pending one final read-only review; Task 17 product acceptance
remains `evidence_pending`. Production remains `activation_pending` and
`external_send=false`.

## Tasks 9-17 second terminal-review correction — 2026-09-07 (append-only)

The next fresh review returned `fix-first` for two P1 evidence-integrity cases.
G2 now rejects model-declared unresolved names that are absent from the original
utterance or already resolve to the roster, preventing invented held
hypotheses. Capability restart validation recomputes the before/after snapshot
identity from each persisted state-hash prefix, so another format-valid hash
cannot silently replace the bound value.

Focused regressions pass. Final daemon and one-shot identities are
`sha256:12d914d74ea2485adea480bb59a37d3b4e4b4d7cdfc4ef706038d3f0f270b03c`
and
`sha256:8ab960dc616b0654863fe41bac7044dffdca1bbb22c6819c400a379c6c177ba3`.
Tasks 9-16 await another final read-only review; Task 17 remains
`evidence_pending`, production remains `activation_pending`, and
`external_send=false`.

## Tasks 9-17 full-hash identity correction — 2026-09-07 (append-only)

The next fresh review returned `fix-first` because the 128-bit snapshot ID could
not verify the untouched suffix of a 256-bit state hash. Core and Desktop now
carry all 64 state-hash hex characters in snapshot identities. Restart
validation checks every bit, with suffix-only tamper cases for both before and
after receipt bindings.

The schema remains unchanged because snapshot IDs are opaque bounded IDs. Final
daemon and one-shot identities are
`sha256:d195f2c1b83c447a5fd8a9b5a4db5f9d5c388c3113ab590ebd7a76e7c93e8c1c`
and
`sha256:64b2f689066750a4d0c11c40beed5ac1ca2f365042f57d479821d728fa094e0c`.
Tasks 9-16 await another read-only review. Task 17 remains
`evidence_pending`; production remains `activation_pending` and
`external_send=false`.

## Tasks 9-17 unresolved-owner correction — 2026-09-07 (append-only)

The next fresh review returned `fix-first` for the nested-name unresolved path.
Both model-declared unresolved values and candidate fallback now require an
independent occurrence not owned by a longer roster alias, while exact aliases
shared by multiple students remain genuine ambiguity. Focused tests cover a
roster containing only `王小明` and reject attempts to create an unresolved
`小明` hypothesis. Runtime identities remain unchanged because the G2 compiler
is outside the resident bridge component closure.

Tasks 9-16 await another final read-only review. Task 17 remains
`evidence_pending`; production remains `activation_pending` and
`external_send=false`.

## Tasks 9-17 terminal reconciliation — 2026-09-07 (append-only)

The final fresh, read-only review returned **No P0–P3 findings; ship** and wrote
nothing. Reviewer before/after fingerprints were identical: Core HEAD
`0f13438a…`, diff `769f49a2…`, untracked `ebf55b9c…`; Desktop HEAD
`2793d74c…`, diff `d018fa8f…`, untracked `003ac2cf…`.

Tasks 9-16 are complete at deterministic local E2. Task 17's engineering
harness is complete, including the schema, scorecard, structured evidence
validator, runbook, and visible G3 evidence path. Its product criterion remains
`evidence_pending` until real/redacted teacher materials, measured baseline and
review times, teacher decisions, restart proof, and observed
failure/reject/withdraw examples exist.

Final daemon and one-shot identities are
`sha256:d195f2c1b83c447a5fd8a9b5a4db5f9d5c388c3113ab590ebd7a76e7c93e8c1c`
and
`sha256:64b2f689066750a4d0c11c40beed5ac1ca2f365042f57d479821d728fa094e0c`.
Production remains `activation_pending`; no provider, carrier, network,
external send, or original production Core mutation occurred.

## Tasks 9-17 source publication — 2026-09-07 (append-only)

The reviewed Core closure was committed as
`a77d6940bd939a20f42d84f433c1b0c3bb8fea1a` and pushed only to
`codex/verifiable-l4-closure`. Desktop now pins that published commit and its
daemon component
`sha256:d195f2c1b83c447a5fd8a9b5a4db5f9d5c388c3113ab590ebd7a76e7c93e8c1c`.
No protected branch or production runtime was changed.
