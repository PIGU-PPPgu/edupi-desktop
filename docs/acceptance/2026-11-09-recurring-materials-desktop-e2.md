# R04／L4 周期内部材料两期验收

状态：隔离合成环境中的两期跨入口验收通过；完整 R04／L4 产品验收未完成。本记录附属于 `docs/plans/2026-09-06-product-closure-roadmap.md` 的 R04／L4，不替代唯一账本，也不将周期流程勾选完成。

2026-11-09 实际 Core main 配对复验：Core PR #459 已合入 main `01fcdcf3d45dfaa45c350c1ec88cc551bb4652df`；Desktop 隔离树把兼容身份固定到该 SHA 及其两份组件清单后，运行 `EDUPI_CORE_ROOT=/private/tmp/edupi-core-main-pair-20261109 node scripts/test-edupi-recurring-materials-e2.mjs`，退出 0，`status=passed`、`projectionFailures=[]`。两期分别为 11 月 9 日与 16 日，各生成两份内部材料；五次 Core 子进程启动覆盖关闭、重启和持久回读，首期文件在次期仍保持原哈希。Desktop 合同检查 `EDUPI_CORE_ROOT=/private/tmp/edupi-core-main-pair-20261109 node --test lib/edupi-bridge-contract.test.mjs` 为 12/12 通过。首次合同测试因新 Core 工作树缺少 `typebox` 依赖失败 3 项，确认 Core lockfile 相同并复用已有依赖后重跑通过；这次环境失败保留，不作为行为通过。下文旧 PR head 的验收与首次投影失败是历史过程；此段记录实际 main 的最新配对结果。父进程观测 49 次 loopback fetch、配置的模型端点调用 0；Core 子进程网络未监测。浏览器、签名安装版、自然七天、教学内容质量及全进程无外发仍未验证。

## 版本与环境

- Desktop：`45d0968785f14b0e49320081aa452cc59546a041`，隔离分支 `codex/desktop-runtime-recovery-v4-20261109`，另含本次新增验收脚本。
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

未验证浏览器点击、Next HTTP server、签名安装版、自然七天计时、真实模型与教学内容质量，也未验证全进程无外发；Core 子进程及其他网络 API 没有网络监测。两份产物是确定性内部清单，不能作为教学质量证据。Core 来源校验修复和 manifest 已合入实际 main，Desktop 隔离树已更新 pin 并完成顶部的实际 main 复验；签名安装版配对尚未执行。本记录只证明该源码树上的合成两期跨入口闭环。
