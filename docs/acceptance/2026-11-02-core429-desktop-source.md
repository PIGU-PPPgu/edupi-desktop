# Core #432 与 Desktop 工作流源码配对

2026-11-02 `.98` 原生验收结论取代下方“待安装”：唯一 `/Applications/EduPi.app` 从已验 Draft 安装为 `.98`，安装前 `.97` 和 helper 正常退出，344 项真实资料指纹与回退副本完成；文件安装后全部字节一致。明确隔离根 `edupi-route1-canary-098-20261102` 只配本机回环合成模型，原生 CUA 前 App/Core 环境断言通过。可见确认的正常路径创建一个只读子会话，私有 journal 为 `done`，子会话实际 `read` 读取合成标题；流程图展开／收起、跨页面及冷启回读通过，设备权限重新检测显示辅助功能／屏幕录制已授权，关于页为 `.98`、正式 feed `.70`。但**取消确认后工具回执为 `declined`／“工作流未启动”，顶部图却误报“已完成 1/1 项”**，因此 `.98` 原生验收失败、保持 Draft、不公开。随后测试退出后的 CUA 状态读取期间出现正常模式 App 进程，隔离断言立即阻止继续 UI 操作；退出按钮源码只调用 `quit_app`，不能将重启归因于按钮，精确拉起原因未证实。正常进程停止后，保护门发现提醒文件新增 14 条通知领取／延期事件并更新 7 项重试时间，2000 条环形活动中原有的 1986 条逐字节保留，最旧 14 条被轮出；另出现 3 个 SQLite 运行态文件。当前四个文件已原位保留并在私有证据区封存，其余 343 项基线文件不变；未用旧备份覆盖新记录。WebView 三个 origin 偏好均恢复，已把唯一 App 回退为原 `.97` 并验证签名，`.98` 测试包留作诊断，正常 App 当前已退出。证据为 `~/edupi-install-checkpoints/v0.3.98/evidence/` 的 `native-technical-acceptance-098.json`、`post-rollback-protected-data.json`、`rollback-tested-mac-098.json`、`webview-prefs-restore.json`。本次失败不追认为 `.98` 安装版通过，也不把真实资料全文件门改写成绿。

取消误报的源码修复已在本工作树实现：`edupi_workflow` 回执结构化 `details.status` 为 `declined` 或 `blocked` 时，不投影未启动的流程；其他工具调用保留。20 项定向测试、TypeScript、目标 ESLint 通过。隔离 Next 开发预览的已存会话加载两次触及 10 秒超时，尽管独立 loopback GET 200／约 20 ms；开发页人工复验未通过，不替代下一签名版原生验收。`.98` 签名身份不改写，下一候选需独立版本和同轮新资产。

新 `.99` 源码候选已预备四处版本元数据和说明，固定 Core `dfcdfaef` 不变；`npm run release:verify`、Rust 1.90 的 `cargo metadata --locked` 和在已隔离 Cargo Home 中的 Mac `cargo check --locked` 通过。另直接读取 `.98` 安装版留下的取消会话 JSONL：5 条消息经 `normalizeToolCalls()` 转换后，当前 `projectWorkflowView()` 对 `details.status=declined` 返回 `null`，不再虚构完成节点；回归测试也覆盖 Pi 文件格式的 `{id,name,arguments}` 工具调用。这是源码投影证明，`.99` 签名包与原生流程仍待验证。

## 已验签的历史 `.98` Draft

2026-11-02 签名 Draft 与本机验签：Desktop [PR #454](https://github.com/PIGU-PPPgu/edupi-desktop/pull/454) 已合并为 `88dc30899512abb99c0e02e36573702f2460015e`，tree `ca00fca7d81c52a1cc07d7295462e49a6ea3be2c` 与受测 head `159a5b17` 相同；最终 [源码 CI](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/41365992605) 的 audit、rust-audit、linux-source 全部成功，Core #432 [main CI](https://github.com/PIGU-PPPgu/edupi/actions/runs/41364275615) 也整轮成功。唯一 [Mac-only 签名 run](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/41366765178) attempt 1 全部必需 job 成功；`draft-proof`、`manifest`、`notify` 因 Mac-only 条件跳过。Draft Release `430952314` 精确指向该 Desktop SHA，最终三资产为 DMG `700090567`／`238389847` 字节／`sha256:8bf94f87c798fd2b333d45e67771ef8f8959a7eb870aff51447a6972e719b706`，更新 tar `700058771`／`239690602`／`sha256:c48a067d879d7cf1fbc0115fd6da882145323e3ed18d93c6740f60f1678c0012`，签名 `700059178`／`404`／`sha256:9c7825cf2cde771778c44a2cbcbde2ea88692dbbc21b685e22ad25351f47a093`；Mac 集合指纹 `sha256:2c675986163246991981c35c3001249d3a3a931e7335b11646d2b40f1bb5d3a7`。App Apple Accepted `b6373934-166c-40a3-8f88-4cfafcdbeb84`、DMG Accepted `aada6a50-22d3-41d5-a34f-10a72387a4e4`；CI 与本机 strict codesign、装订、Gatekeeper、更新包 Minisign/篡改拒绝和 App／DMG／tar 同身份通过。本机下载的三资产大小／SHA 与 Draft 一致，挂载 DMG 与展开更新包中的 App 资源摘要一致，17 项固定 Desktop/Core 源文件与包内字节一致。私有原始回执在 `~/edupi-install-checkpoints/v0.3.98/evidence/`；尚未替换正常 `.97` App、未完成隔离原生验收或发布。

GitHub 新报 `minimatch` 中危 [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)，`npm run security:audit` 按仓库 high 门退出 0，但报告 17 条中危依赖链。当前 Pi 1.0.2 对 `minimatch@10.2.6` 的调用未设置 `optimizationLevel:2`，该包默认值为 1；公告的放大条件在已核对的 Pi 调用处未触发。依赖仍未升级，不能称告警清零；保持作为独立中危记录，不将其混同本轮来源证明 P2 的已解决结论。

安装前 TCC 身份只读核对：唯一已装 `.97` 与已验 `.98` App 的 designated requirement 均为 bundle ID `com.abcwyc.pi-agent` 和 Team ID `BY3XZG2839`；私有回执 `~/edupi-install-checkpoints/v0.3.98/evidence/tcc-identity-preflight.json` 只证明签名要求相同，不证明新版本实际已获辅助功能或录屏权限。本轮保留 `~/edupi-install-checkpoints/v0.3.98/macos-assets/` 456 MiB、可重建 `segmented-assets/` 456 MiB、待验更新包展开目录约 950 MiB、已挂载只读 DMG，以及独立 Desktop `src-tauri/target/` 1.2 GiB 与 `/tmp/edupi-cargo-home-20261102.pKcWDK` 237 MiB；均待安装、回退与证据核对完成后按精确路径和无句柄门清理，当前未删除。

## 历史源码阶段

2026-11-02 最终待安装身份：Desktop 本地源码候选固定 Core main `dfcdfaef6e0710e4064a3343453e82da571990a9`，与 #432 受测 head `ce790710036362f6eb5c906526ca69a77b7fa39b` 同 tree `ba10f42e55b03136a52d856bf258edd11c3c5196`。Runtime schema 为 `sha256:ffa8632b29381cf601593478d4755cf38e17b0e112b8ec0600d44108594bcb0a`，Desktop 清单为 `sha256:67230285d1aabc7ab730d49c1de933649d1a6bbeac777ef2754d1636988b62fb`（文件 SHA-256 `7d6f9f84d5710b759d447b4ca813bc54e141fd327562594ae778007a9bb26519`），Core Runtime 清单为 `sha256:1c700dfb5e93490a5ae659b5e4d54fb664bfba8b4c97b2497e0b8ad8af38e86e`（文件 SHA-256 `5fe8a5ac12d04f7cfd98a47bb48e4b249e97231b5e36bc8eb8e27e5e5eca1949`）。#432 [PR CI](https://github.com/PIGU-PPPgu/edupi/actions/runs/41351456929) 的 core-quality 成功；合并后 main CI `41364275615` 尚未完成。精确 Core 的 `npm run test:recall-owner-origin` 本机通过：同 Goal 两条当前 guard 的歧义返回 held，20 来源冷进程证明与独立客户端并发均通过、provider 调用及外发为 0；#430 原 P2 审查线程已据此解决。此处仍是源码身份，未产生签名 `.98` 安装包。

同一隔离 Mac 树以 `EDUPI_CORE_ROOT=<此 Core checkout>` 运行 Desktop Bridge／宿主／模型闭包 25 通过／1 条件跳过，C1、C2、C3 串行 E2 全部 GREEN；私有召回 IPC／SDK 三项通过，Core-first 捕获父回合→合成原生确认→只读子会话→过期拒绝通过，三域 canary 的私有 Durable、产物哈希回读、停止重启续跑通过，外发为 false。`node_modules/.bin/tsc --noEmit` 与 `npm run release:verify` 通过。首次把 C1/C2/C3 与多项重型测试并跑时，三项各自 60 秒硬超时；失败保留，改为逐个复跑后通过。以上均是本机合成与源码验证，目标是安全接线和数据读写，不替代 `.98` 签名 App 的原生流程。

## 历史中间身份

2026-11-02 后续中间身份：Desktop `8a371f9` 在本地把 Draft 候选改配 Core #430 合并提交 `3712197126b38399688db814ea78dd8c19815a41`；PR head `c9cabf6b` 与合并 tree 同为 `b5f68ad8c99b7bfd583fe601237a6585a045f3c1`，Runtime schema 仍为 `sha256:ffa8632b29381cf601593478d4755cf38e17b0e112b8ec0600d44108594bcb0a`，Desktop component manifest 仍为 `sha256:67230285d1aabc7ab730d49c1de933649d1a6bbeac777ef2754d1636988b62fb`，Core runtime component manifest 更新为 `sha256:b6cd6c7044b2fe62abcb3e8a3b831d175a60a3c01c0cb6bddcaa35a4586b391e`。精确 Core 的 Bridge／宿主／模型闭包 25 通过／1 条件跳过、C1 GREEN、Core-first 合成捕获工作流与父回合失效拒绝通过；源码 TypeScript 通过。Core #430 的 PR CI 已成功，但同 Goal 多 guard 的 P2 审查线程在合并后仍未解决，Main push CI 仍在运行；后续 Core 风险修复未落地前，本身份不冻结签名安装包。正常 App 仍为 `.97`。

状态：Desktop 源码 `a096aff` 对当前 Core main `7ddb573520f703bd10eb6db2bec8ae1b6cd976b3` 的隔离配对已通过；`f5fe7bb` 只把 Mac 候选版本元数据预备到 `0.3.98`，未构建或创建 Release。Core #430 精确 head `c9cabf6b` 的 [CI](https://github.com/PIGU-PPPgu/edupi/actions/runs/41334068542) 已成功，但仍有一条关于同 Goal 多 guard 的未解决 P2 审查意见，尚未合并；签名 Mac 安装版仍为固定旧 Core 的 `0.3.97`。本记录是源码验证，不是安装验收。

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
| 同一根，`node scripts/test-edupi-workflow-core-first-e2.mjs` | Core-first gate 已启用；捕获父回合的工作流经合成确认运行一个只读子会话，父回合结束后的直接／内部派发均被拒绝；父进程 fetch 限 loopback | 以服务端捕获方法和合成回执驱动，未代替签名安装版用户流程，也未观测所有子进程网络 |
| `EDUPI_CORE_ROOT=<隔离 Core 根> node --test --test-concurrency=4 ...` | 3587 项，3571 通过、16 条件跳过、0 失败 | 默认高并发完整套件曾使同一 Core process 测试硬超时 1 项、取消 1 项；单文件复跑 16 通过／1 条件跳过，失败记录保留于本机诊断日志 |
| macOS Rust 1.90，`TAURI_CONFIG='{"bundle":{"resources":[]}}' cargo check --locked --manifest-path <Desktop>/src-tauri/Cargo.toml` | 原生源码编译通过；只跳过尚未生成的包内资源目录 | 本次是 `cargo check`，不是签名包；默认 `tuna` Git 索引三分钟无进展，改用 `/tmp` 隔离 Cargo Home 与官方 sparse 源，没有修改全局 Cargo 配置 |
| `0.3.98` 四处版本元数据和发行说明、同一隔离 Cargo Home 的 `cargo check --locked`、发布工作流定向测试 | 源码候选版本一致、Mac 原生重新检查通过、发布流程 52 通过／3 条件跳过／0 失败 | 未触发 GitHub 签名构建、未创建 tag 或安装包；Core #430 最终身份仍需替换发行说明和 pin |
| 与签名工作流相同的 `cargo tree --locked --target aarch64-apple-darwin --edges normal,build --prefix none` | 1225 行 Mac 依赖闭包，未发现 `zip v0–v8`；本机可重复读取锁定解析 | Apple 凭据、签名和公证仅在最终 Mac 签名 run 验证，本机树检查不替代 |

本机待清理的纯生成缓存：该 Desktop 工作树的 `src-tauri/target/` 约 1.1 GiB，以及 `/tmp/edupi-cargo-home-20261102.pKcWDK` 约 237 MiB。两者保留至最终 Mac 候选完成本机验证或明确放弃本轮构建；届时先核对句柄、Git 跟踪和保留证据，再按精确路径清理，不触及源码、已安装应用或真实资料。

## 当前待验

- Desktop Draft PR454 远端仍固定旧 #429；最终 `dfcdfaef` pin、版本与账本一次推送后的源码 CI 尚待。Core #432 合并后 Main CI `41364275615` 也尚未完成，不记为通过。
- 含工作流 v2 的 Mac 签名、公证、隔离原生确认、Core-first 实际输入、冷启续跑与数据保持；正常 `0.3.97` App 尚未替换。
- Windows/Linux 未构建或验收；产品复合回答继续 held。
