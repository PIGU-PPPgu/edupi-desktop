# Core #429 与 Desktop 工作流源码配对

状态：Desktop 源码 `a096aff` 对当前 Core main `7ddb573520f703bd10eb6db2bec8ae1b6cd976b3` 的隔离配对已通过；`f5fe7bb` 只把 Mac 候选版本元数据预备到 `0.3.98`，未构建或创建 Release。Core #430 尚在 CI，签名 Mac 安装版仍为固定旧 Core 的 `0.3.97`。本记录是源码验证，不是安装验收。

## 固定身份

- Core PR #429 的受测 head `5d82eb4d` 与 main 合并提交 `7ddb5735` 同 tree `2698180a8a4a7ed60c2715709476c75ecf9e8a07`；Desktop 临时固定合并 SHA。
- Runtime schema `sha256:ffa8632b29381cf601593478d4755cf38e17b0e112b8ec0600d44108594bcb0a`；Desktop component manifest `sha256:67230285d1aabc7ab730d49c1de933649d1a6bbeac777ef2754d1636988b62fb`；Core runtime component manifest `sha256:6b7bc7fdb288e3e68785a68571ca6c4a2872749fad93da8e7694c360ce2f58be`。三项从精确 Core checkout 回读，未借旧包。
- Bridge v1.1 的公开命令与课表 occurrence 合同未变。Core 的联合来源证明仍是 owner-only 只读检查，`answer_verified=false`、`question_case_verified=false`；Desktop 不据此放行复合回答。

## 验证

| 环境与操作 | 实际结果 | 边界 |
| --- | --- | --- |
| macOS，本地精确 Core checkout，`EDUPI_CORE_ROOT=<隔离 Core 根> npm run test:edupi-c1-e2`、`test:edupi-c2-e2`、`test:edupi-c3-e2` | 三项 GREEN；C1 幂等／过期拒写、C2 四种教师决定和重启回读、C3 任务决定／重放／跨轮隔离通过 | 合成教师资料，不是正常安装版 |
| 同一根，`node --test lib/edupi-bridge-contract.test.mjs desktop/core-runtime-host.test.mjs scripts/runtime-model-host-files.test.mjs` | 25 通过、1 条件跳过、0 失败；Core 宿主和模型文件闭包通过 | 无 Windows 原生目标 |
| 同一根，`node --test desktop/core-runtime-recall.test.mjs` 与 `EDUPI_MEMORY_RECALL_CORE_ROOT=<隔离 Core 根> node --test lib/edupi-memory-recall-access.test.mjs` | 私有 IPC、当前来源、伪造拒绝、模型取消、冷重启、SDK 捕获与跨班隔离通过；只有合成本地模型调用 | 未测真人答案质量 |
| 同一根，`node scripts/test-edupi-capability-canary-e2.mjs` | 日程行政、课后反思、家校沟通三域的精确授权、私有 Durable、产物哈希回读、停止重启续跑通过；外发 false | 仅隔离 Mac 合成根 |
| 同一根，`node scripts/test-edupi-workflow-core-first-e2.mjs` | Core-first gate 已启用；捕获父回合的工作流经确认运行一个只读子会话，父回合结束后的直接／内部派发均被拒绝；外部网络调用 0 | 以服务端捕获方法和合成回执驱动，未代替签名安装版用户流程 |
| `EDUPI_CORE_ROOT=<隔离 Core 根> node --test --test-concurrency=4 ...` | 3587 项，3571 通过、16 条件跳过、0 失败 | 默认高并发完整套件曾使同一 Core process 测试硬超时 1 项、取消 1 项；单文件复跑 16 通过／1 条件跳过，失败记录保留于本机诊断日志 |
| macOS Rust 1.90，`TAURI_CONFIG='{"bundle":{"resources":[]}}' cargo check --locked --manifest-path <Desktop>/src-tauri/Cargo.toml` | 原生源码编译通过；只跳过尚未生成的包内资源目录 | 本次是 `cargo check`，不是签名包；默认 `tuna` Git 索引三分钟无进展，改用 `/tmp` 隔离 Cargo Home 与官方 sparse 源，没有修改全局 Cargo 配置 |
| `0.3.98` 四处版本元数据和发行说明、同一隔离 Cargo Home 的 `cargo check --locked`、发布工作流定向测试 | 源码候选版本一致、Mac 原生重新检查通过、发布流程 52 通过／3 条件跳过／0 失败 | 未触发 GitHub 签名构建、未创建 tag 或安装包；Core #430 最终身份仍需替换发行说明和 pin |

本机待清理的纯生成缓存：该 Desktop 工作树的 `src-tauri/target/` 约 1.1 GiB，以及 `/tmp/edupi-cargo-home-20261102.pKcWDK` 约 237 MiB。两者保留至最终 Mac 候选完成本机验证或明确放弃本轮构建；届时先核对句柄、Git 跟踪和保留证据，再按精确路径清理，不触及源码、已安装应用或真实资料。

## 未完成

- Core #430 的精确 CI、合并与新 manifest 消费；本 `7ddb` 配对是中间身份，不能直接构建最终候选。
- 含工作流 v2 的 Mac 签名、公证、隔离原生确认、Core-first 实际输入、冷启续跑与数据保持；正常 `0.3.97` App 尚未替换。
- Windows/Linux 未构建或验收，产品复合回答继续 held。
