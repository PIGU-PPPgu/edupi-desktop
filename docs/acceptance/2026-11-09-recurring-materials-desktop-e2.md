# R04／L4 周期内部材料两期验收

状态：隔离合成环境中的两期脚本跨入口验收通过；2026-11-10 新建的每周内部材料候选完成源码预览的任务／文件／材料跨入口回读，同一合成根恢复运行后 API、执行记录和文件回读一致，计划检查已返回四条合成候选。此前另一候选无产物、计划检查未完成的失败仍保留，完整 R04／L4 产品验收未完成。本记录附属于 `docs/plans/2026-09-06-product-closure-roadmap.md` 的 R04／L4，不替代唯一账本，也不将周期流程勾选完成。

2026-11-10 05:34 CST 同根恢复后的独立只读复核：受测仍为 Desktop `d9e1baba431209dfbddbe9e596e796c00239c16c` 加未提交修改、Core `01fcdcf3d45dfaa45c350c1ec88cc551bb4652df`，地址 `http://127.0.0.1:30373`，合成根 `/Users/iguppp/edupi-desktop-p0p2-canary-C5AWS9`。该根 `runner.log` 保留旧 runner `79037` 的 ready 与 stopped 记录；`fixture.json` 现记录同根 runner `87587`、Next `87629`，`ps` 显示新进程于 05:09:06 CST 启动，`next.log` 亦有新的 Ready 段。这些是同根停止后恢复运行的日志与进程证据；本次独立复核没有自行停止或重启服务，也未重新操作浏览器。

预期恢复后新候选不重复执行、原文件仍可读。用 Node 内置 `fetch`、`assert`、`fs` 和 `crypto` 对 `/api/edupi/preparation?taskId=teacher_recurring_113eba987994cd315ebed9085490a14e_2026-11-09`、`/api/edupi/education` 及两份 `/api/files/<绝对路径>?type=read` 做只读检查，均为 HTTP 200；preparation 为 `state=ready`、`prepared=1`，education 中同任务为 `contentStatus=draft_ready`，关联两份 `available=true` 的产物。持久执行仍为 `calendar_work_execution_8d84efec1f2e5d823541f48c12e129b4`、`draft_ready`、attempt 1；两份文件各 456 bytes，HTTP 正文与磁盘逐字一致，磁盘 SHA-256 与下段已记录的持久哈希完全相同，断言退出 0。证据位置为该根 `.edupi` 文件所在的 `teacher-data/.edupi/output/calendar_work_execution_state.json` 及其 `calendar-work-artifacts/ef85a75fb84749c3bddca26f0e7a382f/`；本次没有新建证据文件。

同轮 `GET /api/edupi/plan-overlaps` 返回 HTTP 200、`needsScan=false`、`pairs=4`、`remaining=0`、四条 `pending` 建议且没有 error，版本为 `35793fad16f68cc53e425dbb811a4e953ae4e64a1483aac428a84aa5edb8db38`；`teacher-data/.edupi/desktop/plan-overlaps.json` 保存同版本、同四条建议与四个 checkedIds。源码夹具的 `syntheticPlanOverlapReply` 提供协议形状的确定性合成回复，不能证明真实模型的冲突判定质量；本次仅回读扫描结果，没有重新发起扫描或审核建议。本段取代当前合成夹具“计划检查仍未完成”的状态，不追认此前失败，也不改变旧候选无产物的结果。

修复前元数据观察：上述 education 的两份产物都报告 `size_bytes=0`，但对应磁盘文件和 HTTP 正文各为 456 bytes。因此文件可读和哈希一致通过，大小元数据不一致另记。Core 独立分支的代码候选 `7a67db51a35f33f60acbce9feec5c7196fe91fc2` 修改了准备产物大小计算并增加相关测试；此服务仍使用上述 Core 旧版本，候选尚待 Desktop 配对验证，不能计为已发布或安装版已通过。另一合成课前准备执行仍为 `failed`／`model_error`，不纳入本次通过范围。

2026-11-10 隔离页面新候选验收：在 macOS arm64 的 Desktop 隔离工作树 `d9e1baba431209dfbddbe9e596e796c00239c16c` 加本轮未提交修改、Core `01fcdcf3d45dfaa45c350c1ec88cc551bb4652df` 的源码预览 `http://127.0.0.1:30373`，使用独立 Playwright Chromium 操作合成根 `/Users/iguppp/edupi-desktop-p0p2-canary-C5AWS9/teacher-data`。预期本期每周内部材料任务产生两份可读文件，材料索引能打开并返回同一任务，刷新后状态保持；实际任务 `teacher_recurring_113eba987994cd315ebed9085490a14e_2026-11-09` 显示“已准备”和 2 份文件，从任务分别打开“合成内部议程”和“合成材料清单”，两份预览正文均有标题、本期截止 `2026-11-10` 及“待教师核对与补充”。离开任务后在“材料”索引分别重新打开两项，点击各自“打开关联任务”均返回同一任务的“材料与证据”；刷新后仍显示“已准备”，切到“教学产物”仍有两份文件，材料索引也仍有两项。首次和刷新加载会重现欢迎层，点“稍后再说”后继续；页面操作为现场观察，未保存快照。

隔离持久记录 `.edupi/output/calendar_work_execution_state.json` 中该任务为 `draft_ready`，两份文件的 SHA-256 分别为 `a7bf7ec2f6e264a30cd5eff5e2dab2352f9d94c5ba99060dce74f843a4b357c4`、`d0955d1c943224bcdd76a8d16cd22ec78e09b6b5e31eaaebad2e135cc634fc53`；本轮磁盘复算与记录相同。此前页面预览的两个文件 route 均返回 HTTP 200，正文与磁盘文件相同。此证据仅覆盖新候选的隔离源码页面及占位内部材料，没有在本次页面操作中重启 Core，也没有证明签名安装版、真实内容质量或全进程零外发。另一合成课前准备任务在同一状态文件中为 `failed`／`model_error`，不计入这项每周材料的通过范围。下文旧候选 `teacher_recurring_2d56c0dd0d148e4e94fa11263f3238e7_2026-11-09` 的 0 产物与计划检查失败仍是独立失败观察，未被新候选追认通过。

2026-11-10 隔离两期重验：在 Desktop 隔离工作树运行 `EDUPI_CORE_ROOT=/private/tmp/edupi-core-main-pair-20261109 node scripts/test-edupi-recurring-materials-e2.mjs`，退出 0；Core HEAD 和 Desktop 合同 pin 同为 `01fcdcf3d45dfaa45c350c1ec88cc551bb4652df`。合成时钟的 2026-11-10 与 2026-11-17 两期各产生 2 份内部材料，attempt 均为 1；Desktop 文件 route 回读哈希与持久记录相同，Core 子进程重启后记录保持，`projectionFailures=[]`，共启动 5 次。父进程观测 49 次 loopback fetch、配置模型端点 0 次调用；Core 子进程网络没有监测。脚本清理了自建临时根。这次重验只覆盖隔离脚本和确定性内部材料，不能覆盖下述浏览器候选无产物、真实自然跨期或内容质量。

2026-11-10 隔离源码预览补验：在 `http://127.0.0.1:30373` 打开合成本期候选 `teacher_recurring_2d56c0dd0d148e4e94fa11263f3238e7_2026-11-09`。详情显示“待你确认”、计划交付“合成周期教案”，但产物为 0 份文件、暂无已生成文件，执行记录为空；材料页仅看到两份“每日简报”，没有本期教案。因此候选详情可打开，本期从候选到文件打开及任务／材料跨入口回读未通过。`GET /api/edupi/plan-overlaps` 返回 HTTP 200，但业务体为 `needsScan=true`、`pairs=4`、`remaining=4`、`suggestions=[]`、`error="计划检查未完成，请重试。"`；本轮不把空建议解释为无冲突。受测为隔离源码预览及带未提交修改的工作树，不能把当前 HEAD 单独当作该浏览器受测版本，也不能用它替代签名安装版证据。此观察与下文两期合成时钟脚本通过分开记录，未调用真实模型。

2026-11-10 staged 资源就绪诊断：`EDUPI_STAGED_STATUS_DIAGNOSTIC=1 node scripts/test-staged-desktop-runtime.mjs` 退出 0、`status=passed`；隔离副本的首次 `/api/edupi/status?summary=1` 返回 HTTP 200，`core=ready`、`coreLifecycle=ready`、`projection=ready`、`kernel=ready`，Core 身份为 `01fcdcf3d45dfaa45c350c1ec88cc551bb4652df`、occurrence contract `1.2`、`externalSend=false`。这只验证 staged 资源副本的 HTTP 就绪与兼容身份，不证明浏览器本期材料生成、真实 OS 睡眠或安装版。

2026-11-09 隔离浏览器补验：受测 Desktop 为 `6ccf12f6ad43bc2460f20d07104f299a3f65856c` 加本轮未提交工作树修改，在源码预览 `http://127.0.0.1:30149/` 操作合成周期任务 `teacher-task-49328dcd-e98b-4896-832d-075cd95da3d9`。任务详情点击“暂停”后，任务、周期材料和执行记录均显示已暂停，首页本期待处理候选消失；刷新后仍保持。点击“恢复”后，任务和执行记录显示进行中，周期材料显示已启用，首页本期候选重新出现；刷新后仍保持。首页对本期候选点击“暂缓”，成功回执出现，候选移至“稍后处理”，刷新后仍为已暂缓。再点击“修改决定→拒绝”，成功回执出现，候选移至“已记录”，刷新后仍为已拒绝；周期模板本身仍进行中。上述点击和刷新回读是现场观察，未保存本轮页面快照；隔离持久数据可独立核对模板最终进行中、候选最终拒绝以及暂缓到拒绝的决定历史，不能独立证明每一步刷新后的页面。此轮不证明自然到期调度、安装版或真实教师体验。预览启用了 Desktop token，普通浏览器加载时 `/api/edupi/materials/staging` 两次和 `/api/models` 一次返回 403；控制台不干净，不能视为正常安装版环境。详情页每次刷新还重新显示新手教程第 3/8 步，需另行排查。

2026-11-09 实际 Core main 配对复验：Core PR #459 已合入 main `01fcdcf3d45dfaa45c350c1ec88cc551bb4652df`；Desktop 隔离树把兼容身份固定到该 SHA 及其两份组件清单后，运行 `EDUPI_CORE_ROOT=/private/tmp/edupi-core-main-pair-20261109 node scripts/test-edupi-recurring-materials-e2.mjs`，退出 0，`status=passed`、`projectionFailures=[]`。两期分别为 11 月 9 日与 16 日，各生成两份内部材料；五次 Core 子进程启动覆盖关闭、重启和持久回读，首期文件在次期仍保持原哈希。Desktop 合同检查 `EDUPI_CORE_ROOT=/private/tmp/edupi-core-main-pair-20261109 node --test lib/edupi-bridge-contract.test.mjs` 为 12/12 通过。首次合同测试因新 Core 工作树缺少 `typebox` 依赖失败 3 项，确认 Core lockfile 相同并复用已有依赖后重跑通过；这次环境失败保留，不作为行为通过。下文旧 PR head 的验收与首次投影失败是历史过程；此段记录实际 main 的最新配对结果。父进程观测 49 次 loopback fetch、配置的模型端点调用 0；Core 子进程网络未监测。浏览器的部分操作补验见上段；签名安装版、自然七天、教学内容质量及全进程无外发仍未验证。

隔离持久数据位置：`/private/tmp/edupi-l4-browser-20261109.DC87YK/data/.edupi/output/` 中的 `task_board_state.json` 与 `teacher_review_state.json`。这份合成数据仅供本轮复核；隔离验收结束并记录必要结果后可清理，清理后不能独立回读该数据。

## 版本与环境

- Desktop：最初两期脚本的旧测试基线为 `45d0968785f14b0e49320081aa452cc59546a041` 加本轮脚本；本次 Core main 复验与浏览器预览使用隔离分支 `codex/desktop-runtime-recovery-v4-20261109` 的 `6ccf12f6ad43bc2460f20d07104f299a3f65856c` 加未提交修改。提交后的精确版本以交付 PR 为准。
- Core：首次重验使用隔离树 HEAD `7a760af824eb19ace02c066af41eef4a4861c0f9`，目录 `/private/tmp/edupi-core-l4-integration-20261108`；先前通过的版本是基线 HEAD `be80d52f95cf4ff1bf0e3fd8ed4cd4780fa5cb26` 加未提交来源校验修复，不可用该旧 HEAD 单独复现。随后 PR #459 合入 main，实际 main 的复验结果见顶部。
- macOS arm64，Node `v22.23.1`。验收运行于 `/private/tmp/edupi-desktop-runtime-recovery-v4-20261109`。
- 隔离工作树最初无依赖；先复用原 Desktop 依赖时缺少 `qrcode`，随后改为链接已存在的 `/private/tmp/edupi-desktop-main4-integration-20261108/node_modules`。未安装或改动被复用的依赖。
- 每次运行使用 `mkdtemp` 新建私有合成根，独立 data、state、agent 和 loopback 假模型端点。未使用教师数据、真实模型、原运行目录或安装 App。

## 命令与实际结果

```bash
EDUPI_CORE_ROOT=/private/tmp/edupi-core-l4-integration-20261108 node scripts/test-edupi-recurring-materials-e2.mjs
node_modules/.bin/eslint scripts/test-edupi-recurring-clock.mjs scripts/test-edupi-recurring-materials-e2.mjs
node --check scripts/test-edupi-recurring-clock.mjs
node --check scripts/test-edupi-recurring-materials-e2.mjs
git diff --check
```

首次运行完成两期后退出 1，报告 `status=failed`、两条 `projectionFailures`；下节保留当时的失败与定位。在 Core 来源读取分支修复后，同一端到端命令重跑退出 0，`status=passed`、`projectionFailures=[]`：两期任务和 work case 的状态、education 产物关联、四份 Desktop 文件入口读回及持久文件哈希一致。定向 ESLint、两份脚本语法检查、diff 空白检查通过。未运行全套测试或构建。

脚本直接调用真实 Desktop route handler，并经真实 supervisor、独立 Core 子进程及其 HTTP 协议执行；未模拟 Bridge、数据库、任务写入、周期定时器或文件读取。时间控制只在验收脚本中注入，父进程和每次真实 Core 子进程同步 `Date` 偏移；次期为 +7 天，系统时间未改。没有等待自然七天，也没有经过 Next HTTP server 或浏览器。

通过的针对性证据：

| 检查 | 实际结果 |
| --- | --- |
| 周期模板创建 | Desktop `tasks.POST` 返回 `accepted`；`template_definition_hash=sha256:0127a42d80af722044965ef85b70037edd0b4f46a285dcbc7dcef53e9dd0c1d1` |
| 模板身份 | `teacher-task-84848484-8484-4484-8484-848484848484`，重复提交仍为单条模板 |
| 默认关闭 | G1 未启用时无执行记录、配置的 loopback 模型端点调用 0 |
| 显式激活 | 经 timetable/material intake、owner bootstrap 与 proactivity route 启用，health `g1_processor=active` |
| 首期 | 2026-11-09，真实 G1 定时器生成 2 份内部材料；执行 attempt 1 |
| 次期 | 2026-11-16，生成不同 task/execution/artifact ID 的 2 份内部材料；执行 attempt 1 |
| 文件入口 | 四份材料均由 Desktop files GET 读取，其内容 SHA-256 与磁盘及持久 execution ledger 一致 |
| 冷重启幂等 | 两期分别实际关闭并启动 Core，execution ID、attempt、artifact ID 和内容哈希保持；重复创建不增加生成 |
| 旧文件保持 | 进入次期后，首期两份文件仍存在且哈希相同 |
| 网络观测范围 | 共启动 5 次 Core 子进程；父进程 `fetch` 仅访问 loopback；配置的 loopback 模型端点调用 0；Core 子进程网络未监测 |
| 响应字段 | 模板 receipt 的 `external_send` 与 proactivity 响应的 `externalSend` 均为 `false`；只验证响应值，不证明实际无外发 |

独立审查后移除了脚本汇总中无监测依据的 `externalSend=false`，改为 `networkObservations` 与 `responseFlags`，并把全进程无外发列入 `unverified`。父进程替换 `globalThis.fetch` 不会拦截 Core 子进程，也不覆盖其他网络 API；loopback 模型计数只说明该端点未收到请求。因此本次证据不能证明全进程没有外部网络请求或外发行为。

2026-11-09 证据边界修正后的定向检查：`node --check scripts/test-edupi-recurring-materials-e2.mjs`、该脚本 ESLint 和本次文件 diff 空白检查通过；使用隔离 `vm` 执行实际报告生成表达式，验证无顶层 `externalSend`、响应字段独立列示、Core 网络标为 `unmonitored`，并包含全进程无外发的未验证项。该检查只验证报告结构。第一次重验因 Core HEAD 已变为 `7a760af824eb19ace02c066af41eef4a4861c0f9`、Desktop pin 仍为旧 `be80d52f95cf4ff1bf0e3fd8ed4cd4780fa5cb26`，在临时根创建前由精确版本守卫拒绝。Desktop pin 改为受测 Core head 后，修正脚本再次运行退出 0：`status=passed`、`projectionFailures=[]`，首期 2026-11-09 与次期 2026-11-16 各有 2 份可读产物，5 次 Core 子进程启动，父进程 loopback `fetch` 49 次、配置模型端点调用 0。此轮仍只证明隔离合成环境，Core 子进程网络未监测。

首期执行为 `calendar_work_execution_2b09cf05a5f40bb9ee96dffcf6cd9593`，次期为 `calendar_work_execution_554806eecff965d1de798fd454d51e32`。

| 期次 | artifact ID | 文件 SHA-256 |
| --- | --- | --- |
| 首期 | `artifact_27a3506ad89e09bfb73a44e972f9b57a` | `d2d80762be818c809db9d183f39e56db32f614717ed6c595a866b1a62f2685c0` |
| 首期 | `artifact_6686be39e500b4c74d90bcf6651f5dc1` | `1bfda5fff5bc8c0d5896d3993f019f725c8083d724ac444ee9c379c478c1e970` |
| 次期 | `artifact_a1cd650105d849053adba707dfb7ec8e` | `c4f5ac9cd703cb3962b3348f6f217c2b9217f4c78efc881d5892d6d948d2fb23` |
| 次期 | `artifact_8e93e955a4501448254fd266874b027c` | `7f5eeb6e2006c1cf5bcfb3083942e3ba8cdefe67df0191fd4163b2cd35b0bddc` |

## 首次失败与定位

两期发生相同跨入口失败：

- 持久 `calendar_work_execution_state.json`：`status=draft_ready`，2 个 artifact。
- Desktop education 的任务：`contentStatus=not_generated`。
- 同一任务的 work case：`currentState=planned`、`artifactIds=[]`；历史 transitions 中存在 `draft_ready`。
- education `generatedArtifacts`：对应任务 0 项。
- 直接文件 route 能读取全部产物且哈希一致，因此失败发生在产物来源证明／投影关联，不能记录为“没有生成”或“文件不可读”。

配对 Core 的源码定位：

1. `scripts/core_runtime_template_due.mjs` 通过确定性 `renderTemplate` 与 `executeCalendarWorkBatch` 生成内部材料。
2. `scripts/preparation_artifact_access.mjs:8` 对全部准备产物使用 `createLiveG1Execution` 的来源读取器；无 `source_content_signature` 时在第 32 行进入 `source.matchesSource(candidate, execution)`。
3. `scripts/core_runtime_g1_live.mjs` 的 `requestFor` 将非 `teaching_before_class` candidate 统一交给 `createConfirmedCalendarG1Request`。该读取器要求 candidate 绑定已确认的 calendar event；周期模板来源是 `template:...`，不是 calendar event。
4. `scripts/preparation_artifacts.mjs` 捕获来源校验异常并排除产物。`scripts/edupi_bridge_snapshot.mjs:1161` 只将可编辑、可用产物纳入 `currentReadyExecutionIds`，因此任务和 work case 未获得生成完成状态。

这是源码路径定位与首次两期症状的组合证据。随后 Core 隔离树修复周期模板产物的来源校验，保留原文校验与失败关闭规则；同一 Desktop 脚本重跑获得上述跨入口通过结果。首次失败记录保留，不能把修复前的执行追认为通过。

## 清理与未验证

各轮脚本 finally 实际关闭自有 Core 和 loopback server，恢复父进程 Date、fetch、fork 与环境变量，删除该轮新建的精确合成临时根。没有生成 Next、Cargo 或安装包产物；复用中的 node_modules 链接保留供同 worktree 主任务使用。

浏览器暂停／恢复／暂缓／拒绝及刷新回读已按顶部历史记录补验；2026-11-10 旧本期候选没有文件或执行记录，新建的每周内部材料候选已完成任务、两份文件、材料索引和关联任务的页面回读。同一合成根恢复运行后的 API、执行记录、文件和计划检查结果已独立回读；计划检查的此前失败保留，当前四条确定性合成建议不证明真实模型判断或审核交互通过。两期脚本仍未经过 Next HTTP server，新候选的浏览器操作未验证自然到期生成，恢复运行后亦未重新操作浏览器；`size_bytes=0` 的修复配对未验。签名安装版、自然七天计时、真实 OS 睡眠、系统通知点击、真实模型与教学内容质量、连续教师使用均未验证；全进程无外发亦未验证，Core 子进程及其他网络 API 没有网络监测。两期脚本及新候选的产物是确定性内部材料，不能作为教学质量证据。Core 来源校验修复和 manifest 已合入实际 main，Desktop 隔离树已更新 pin 并完成实际 main 复验；签名安装版配对尚未执行。完整周期产品流程与 L4 不能据此标为通过。
