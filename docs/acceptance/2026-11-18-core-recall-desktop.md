# R04 Core 问答接线

当前状态：`.118` 已于 2026-11-18 22:47:42 CST 公开为 macOS Apple Silicon 正式 GitHub Release；只读回读 `draft=false`、`prerelease=false`、GitHub Latest `.118`，三项安装验收资产的 ID／大小／SHA-256 不变。正式自动更新 feed 仍为 `7924328e…`，不把 Release 公开记作 updater 通过。2026-11-19 本机临时 `.118` App 复验已通过 DMG SHA、只读挂载、签名/Gatekeeper、bundled Core/Projection ready、隔离进程、HTTP identity、任务/SQLite 回读和冷重启 instance nonce 变更；完整证据见 `core-desktop-pairing-20261119/installed-acceptance-20261119.json`。原生 GUI 因系统锁屏未执行，正常 Cmd+Q、updater 和真实模型仍未执行。首轮安装验收因 harness 过期 Core 白名单失败，失败保留；`5ef4bd0f` 只更新 harness 与 fixture 的精确 pin，第二轮复用原 DMG 通过，没有重建或替换资产。用户于 2026-11-18 明确批准本次正式 Release，并书面接受 Rust `RUSTSEC-2026-0543` 例外；`cargo audit --deny warnings` 仍失败，不记为通过，范围不延伸到 Windows 或其他平台。PR509 保持 Draft，R04、R15、完整 L4 均不勾选完成。本文挂回原路线图，不建立另一份任务计划。

## 版本与环境

| 项目 | 实际版本或边界 |
| --- | --- |
| Desktop | 签名包源 `7935753ae8296d820010a8e5bb1d7f3d477b72eb`、tree `c1a4de98309e9972f043f44081e08ceaa09f21df`；验收 harness `5ef4bd0fe5cf070e1885ae233365c6f6457aab5e`；分支 `codex/r04-core-answer-desktop-20261117`／PR509 仍 Draft，保留 PR508 merge `9d1b4c45` |
| Core 开发候选 | `b60d4b29bf827a8e7822ba00f5cacef7f351b811` |
| Core 最终合并 | `fc89b3bc899a55b0fdad61b8f37e238d950f37c6`，与受测候选同树；官方候选 CI `44123145520` attempt 2、最终 main CI `44145905596` attempt 1 成功；Windows/visual 条件 skip 不算通过 |
| Core tree | `ed98dad0591a4d273c4d571a7e116c732354f582` |
| Runtime schema | `sha256:815da174d88273e2d8df1039fce600eff7999455c2a30af8ebdcfe1627fe1e2d` |
| Runtime component | `sha256:c872f949b8e79d65fc87d778744fb87345186bb6af62b97a6d42df53b27768be` |
| Desktop component | `sha256:9e2011b079292f9adb8be6ebfea670cbae8d9f04f5414f81121db542b26082a6` |
| Bridge 1.1 | `sha256:4d406ea05466f525d68e9a5c2e8f21b05a1013346fff5962a3ccc0ea61398b1d`，五份 fixture 逐字配对 |
| 数据 | 源码页面使用合成 Main4 根；安装流程使用 GitHub-hosted macOS 15.8.2 arm64 的全新隔离根、空认证与离线合成模型配置，没有调用真实模型；本机正常 `.115` 未替换或启动 |
| 页面 | 原源码页面由私有 `active-ego.json` 定位的已结束空间验收，使用官方 Tauri mocks；本次真实 App 安装只验证启动与持久化，不声称 GUI 操作通过 |
| 模型 | 合成本地 SSE assessor；不证明真实 GLM 语义质量，不使用其他账号、key 或付费路径 |
| 发布 | 签名 Draft run `44303236812` success、安装 run `44318046052` success；正式 Release `449948350`／`v0.3.118`，`draft=false`、`prerelease=false`、GitHub Latest `.118`；原三项 Mac 资产、`.117` 资产和自动更新 feed `7924328e…` 保留 |
| Windows | 用户于 2026-11-17 因费用暂停；本轮没有 Windows runner、构建、打包或安装验收 |

证据位于私有本机验收目录 `r04-desktop-20261117.noindex/`。运行期间的 fixture 与 PID 由 `active-next.json`、`active-provider.json`、`active-r04-fixture.json` 定位；最终清理记录优先于其中历史 PID，不得凭旧记录重启已删除的根。截图绑定记录采样时间和源码快照边界，不把稍后采集的源码清单冒充截图瞬间的精确版本。

## macOS 签名与安装

本节取代下方历史“尚未签名／安装”的状态。`ca54e91` 到签名源 `7935753a` 只变更三份验收／发布文字，`contracts/edupi-core-compat.json` 不变；首轮失败与这两份源码的 manifest 不匹配无关。

| 检查 | 实际结果 | 证据 |
| --- | --- | --- |
| 同源签名 | `44303236812` attempt 1 的 notary-preflight、release 与唯一 `aarch64-apple-darwin` build 全部 success；App ticket、签名后 runtime、App／DMG 公证与 Gatekeeper、updater 签名及最终资产替换通过 | `continuation-audit-20261118/draft-run-44303236812.json`、`draft-jobs-44303236812.json`；全平台 draft-proof 依条件 skipped，不作通过 |
| 首轮安装失败 | `44316698278` 的 DMG 下载摘要、只读安装和三处 codesign／stapler／spctl 已通过，随后在 `bundled_core_exact_source_contract` 返回 `unsupported_or_invalid_source_contract`；App 启动 0，cleanup passed | `macos-installed-acceptance-44316698278/job.log`、`artifact/e.JSON`；位于上述 continuation 目录 |
| 原因与窄修复 | harness 仍精确要求旧 Core `98e4f7cd…`，真实 source contract 已固定 `fc89b3bc…`；`5ef4bd0f` 只同步 harness 常量与 fixture，manifest hash、逐文件字节、symlink／inventory、运行时身份与隔离门均保留 | 两文件 `+4/-3`；`node --test scripts/test-macos-installed-acceptance.test.mjs` 24 passed、0 failed、0 skipped；lint 0 errors、已有 1 warning，tsc 与 diff check 通过；magpie_reviewer 独立只读审查未留实质缺陷 |
| 同包安装与双冷启 | `44318046052` attempt 1 使用原 source `7935753a`、同一 DMG asset `763552583` 和修复后 harness；两次 App PID／instance nonce 不同，Core／projection 均 ready，精确核对 13,381 个 Core 运行文件 | `macos-installed-acceptance-44318046052/e.JSON`、`summary.json`、`job-complete.log`；e.JSON SHA-256 `5f0f0a989078c8291606c49cb65cb649ff5b001c5cfed8179f6c7e735025d46e` |
| 重启与清理 | 同一 SQLite inode、两次 readonly quick_check ok、持久记录／marker／三份模型配置不变；结束后自有 App/helper 0、DMG 已卸载，清理通过 | 同份 e.JSON 的 `readback`／`cleanup`；移除任务产物 1,252,659,200 allocated bytes，卷可用空间增加 1,239,142,400 bytes；没有在本机生成构建缓存 |
| 未执行边界 | GUI、正常 Cmd+Q、teacher workflow、updater、model generation 均为 `not_exercised`；数据仅为 synthetic；不因安装 success 宣称完整产品、教学质量或升级验收通过 | 同份 e.JSON 的 `claims`；Windows 全程未触发 |

下列是安装验收精确绑定的最终资产，后续只允许改变发布 metadata，不复用其他包的证据：

| Asset ID | 名称 | bytes | SHA-256 |
| --- | --- | --- | --- |
| `763552583` | `EduPi_0.3.118_aarch64.dmg` | 239241349 | `99ed51f5b55ea7776f13684bc8b66274d6195326a7005b8b84dcf1fa97ce2eb6` |
| `763511519` | `EduPi_aarch64.app.tar.gz` | 240551746 | `01dc41a473b80c139f40a5f5d890f554519f248d108cc79ec631522aa72ba10e` |
| `763512164` | `EduPi_aarch64.app.tar.gz.sig` | 424 | `d7523dd989632fd727db5dacd8ab1ceaffb1125e3228a1ded80ec6ca89551d65` |

协调侧按用户最新明确指令只变更 GitHub Release metadata，没有派发要求全平台资产的 `phase=publish`。正式 tag `v0.3.118` 精确指向签名源 `7935753ae8296d820010a8e5bb1d7f3d477b72eb`；22:50 CST 独立回读三项资产与安装快照逐项相等、`.117` 资产相等、PR509 仍 Draft、feed 仍为 `7924328ee893c9527adb54e25b0023e9f2a26ff7`，匿名公开页面可读并显示 Latest。证据为 `continuation-audit-20261118/publication-observed.json` 及 `publication-final-*.json`。公开说明列出 macOS-only、Rust audit 例外与 R04／L4 边界；当前正文未单列 GUI／updater 未执行，本账本保留这两项明确边界，不把签名验证或 Release 公开当作 GUI／更新验收。

## 已实现的边界

- 正式问句通过真实 owner registration/capture 和 SDK user entry 绑定；Core 原文及逐 facet 引用保存为 canonical custom，不交给聊天模型改写。
- 原始 query、identity、registration 和全部 selection 只保存在服务器私有绑定；复核只追加 `answer_receipt_ref`，不补默认筛选，不退回旧 no-query memory list。
- capture、SDK、query、原文 hash 均保留首尾空白和换行。只用 `trim()` 检查是否为空。
- 运行内 current 不落盘。冷重启、来源或授权失效、取消、换会话和过期都不能凭保存的 true 恢复 current。
- 人物确认使用较早的含姓名来源，显式 read → confirm → read，支持 revision 0；未知写入保持 `factWrite:null`，不自动重试。
- SDK 在正式 Core 回合前的自动 compaction 由公共 hook 取消。普通后续模型上下文排除历史 Core custom。
- 本地 submission 尚未结束时不接受 server idle 提前结算；纯 artifact 刷新不撤销答案，真实来源事件仍撤销。

## 实际证据

| 检查 | 实际结果 | 证据 |
| --- | --- | --- |
| Bridge 精确配对 | 冻结候选 12/12 通过，无 skip | `EDUPI_CORE_ROOT=<b60辅助树> node --test lib/edupi-bridge-contract.test.mjs` |
| raw 全链路 | 真实 Core registration/capture → SDK 保存 → 两次完整复核均 current；1 次合成 facet、0 次聊天模型；裁剪 query/hash、改票据 query、撤回来源被拒绝 | `raw-binding-review/commands.txt`、`final-paired.log`、`raw-core-b796c0ff-72e2-4bc5-b27a-2ffe856c5792.json` |
| raw 相关回归 | 八个配对测试文件 272 passed，0 failed，0 skipped | `raw-binding-review/final-paired.log` |
| 发送与 UI 回归 | mounted/callback、发送生命周期和消息身份合跑 110 passed；删除三个 submission guard 分别得到预期失败 | `components/CoreRecallAnswer.behavior.test.mjs` 及对应发送、hook 测试 |
| 实际页面新问题 | Core 原文和两条引用、空草稿、无 abort 尾信息；保存时连续 18 次完整复核 current | `browser-b60-live-current.png`、`browser-b60-live-current.json` |
| 原图版本绑定 | 原 PNG/JSON 未覆盖；记录 SHA-256、实际 health、Core tree/schema/双清单、Desktop dirty 状态与限制 | `browser-b60-live-current.binding.json` |
| settled 后回读 | SDK custom 原文、两 facets 和 UI receipt 一致；未保存 `coreRecallLive`；合成 facet 1、聊天 0 | `browser-b60-settled-persistence.json` |
| 实际进程重启 | 重启前已保存的 current receipt 返回 historical，没有凭落盘 true 恢复 | `browser-b60-current-receipt-after-restart.json` |
| 离开重入及手动复核 | 回到原会话为历史回答，草稿保留；明确重新核对后恢复 current，前后 facet 均 3、聊天均 0 | `browser-b60-layout-reentry-current.json` |
| 实际来源撤回 | 来源会话 DELETE 200、回读 404；独立查询会话仍为 200；11 条真实 Core source withdrawn，旧 receipt held/source_changed，页面撤销 current，模型计数不增 | `actual-source-withdraw-full-proof.json`、`source-withdraw-query-ui-held.json` |
| 纯时间和重启反例 | 冻结 Core 的 `--receipt-only` 检查通过：Goal/person grant 到期、同 Runtime 来源变化、重启失票 | `node scripts/test_core_runtime_recall_answer_v4.mjs --receipt-only` |
| 独立复审 | raw、SDK、private receipt、人物、UI 生命周期和 submission guard 未发现新增实质缺陷；不替代页面验收 | Faraday、Turing 独立只读结果 |
| 最终 Core 新根页面 | 人物 read→confirm→read 后，新的问题显示“本轮核验”、Core 原文与两项逐项来源；2 次合成 facet、0 次普通聊天 | `browser-fc89-current.png`、`.json`、`.binding.json`；早期 `person_unverified` 卡片仍保留 |
| 普通恢复与取消复审 | 两项 P2 修复前 7 个反例失败，修复后 70 passed、0 failed、0 skipped；原 reviewer 核对源码哈希后关闭 | `r04-recovery-review-fixes.tap`；只读 GET 不改写，后续 POST 收敛已持久 ACK，DELETE 恢复独立 conversation |
| 输入原文与只读 GET | 真实组件的首尾空格／换行／Tab 在 POST 和 pending.message 中逐字保持；raw 513 字拒绝；带查询参数的 GET 携带原生 token | `raw-composer-and-inspect-regression.tap`，16 passed、0 failed、0 skipped |
| Main4 模板正式 API | 独立授权后周／月创建、重复提交与真实冷重启回读通过；模型和模型配置请求均 0，seed host 剩余 0 | `fc89-native-l4-fixture-1/native-l4-fixture.json`；该轮是 dirty 源码准备证据，不能替代最终冻结源或原生安装 |
| 模板停止与版本竞态 | local-first、Core unknown、关闭 unknown、并发替代、48s 虚拟 deadline、pending／failed drain 跨域拒绝及晚到关闭覆盖；最终临时 host 的旧配置身份问题已修 | `template-storage-and-stop-integration.tap`，93 passed、0 failed、0 skipped；最终整合继续按新哈希记录 |
| Main4 两期实际执行 | 显式迁移的合成 Main4 根上，两期各 2 份 507 bytes 产物，attempt 1；文件接口／磁盘／持久 SHA-256 一致；10 次实际 Core 启停，G1 始终关闭、0 模型、0 模型配置请求 | `fc89-recurring-two-periods-3.log`，前两次失败保留；模拟 +7 天不证明自然七天 |
| 请求内 roots 与最终停止竞态 | 220 passed、0 failed、0 skipped，包含每请求 1 次完整校验、跨 Core await 换根／停用、最终 drain 被新选择替代时拒绝误报 disabled | `request-roots-and-final-stop.tap`；SDK／outbox／intent／Core 完整复核保留，不跨请求缓存 |
| 不可见读取 | 管理中心 5 组件 100 passed；教育页覆盖、可见性、初始 kernel 去重与显式 mutation readback 47 passed；补充 3 种事件在途取消的定向组 7 passed | `admin-read-activity.tap`、`education-read-activity.tap`、`education-event-read-cancel.tap`；不据 mock 数量宣称实际延迟通过 |
| 实际页面安全停用 | 新问为 current 后按停止，持久配置变为 off，current 1→0，G1 文件 hash 不变，facet 4→4／chat 0；UI 28.2s 后仍待核对，后续 Core unavailable | `browser-r04-stop-1794954658099.*`、`fc89-r04-stop-runtime-readback.json`；只记安全关闭和撤核验，不记完整停止、健康或延迟通过 |
| 默认服务实际关闭 | 实际 C0 capture／Core 模型 IPC 后，默认 settings＋supervisor 在 2543ms 返回 stopped／none，替代实例健康，冷启仍 off，facet 1／chat 0，清理 closed true | `r04-settings-real-runtime-4.tap`；直接 Core 生命周期证据，SDK 绑定由配对 raw 检查覆盖，实际新源码页面链仍另验 |
| 真正进程冷恢复 | 自有 Next／Core PID 全部退出后冷启，Core ready、recall off、旧票据 historical；normal 开启 403，session／G1／recall 三个文件 hash 不变，facet 4／chat 0 | `r04-cold-off-and-gate-final.json`；普通语义门仍 false |
| 修复后实际 SDK 页面 | 新合成根先经真实 Core 人物准备，再从实际页面发送；SDK 回答 current→点击停止→UI“已停止”、current 1→0、Core ready，G1 hash 不变、facet 1→1／chat 0 | `fixed-sdk-stop-1794959269454.*`；7733ms 包含页面撤核验与 status 回读；取代旧 unknown／unavailable 的该页面欠项，保留旧失败，不代表原生安装或真实 GLM 通过 |
| 修复后同根冷恢复 | 自有 Next／Core 进程全部退出后，同一合成根与 session 冷启为 off／historical，Core ready，facet 1／chat 0、G1 hash 不变；旧冷图的连接红条原因未证实 | `fixed-sdk-stop-cold-process-check.json`、`fixed-sdk-same-root-cold.*`、`fixed-sdk-stop-cold.binding.json`；清单 `source-manifest-0803ab9.json` 采于停止后、冷启前 |
| Main4 实际模板页面 | 显式选择同一班级与数学后创建周模板，首期两份 453 bytes 文件均实际打开；修改标题／产物、单项暂停 done／恢复 progress、全局停止后教育数据和历史回读通过，revision 0→1、board revision 0→1→2 | `main4-ui-create.json`、`main4-ui-create-disk-readback.json`、`main4-ui-artifact-*.txt`、`main4-ui-modify/pause/resume/global-stop.json`、`main4-ui-history.txt`；全局回执 disabled／verified／paused，落盘 false |
| 模板页面刷新与模型边界 | 首次刷新设置回读 403，后续明确重新 bootstrap 后 200 且仍 off；独立观察曾见测试注入缺失，但不据此证明该次 403 的原因。合成模型累计 facet 1／chat 0 未增加，较早另一 provider 累计 4／0 已停止；模板隔离根无模型或认证 provider | `main4-ui-reload.json`、`main4-ui-reload-native-observation.json`、`main4-ui-final-model-counters.json`；累计数不是 0，不将独立 provider 计数当作任意上游流量的完整审计 |
| 连接超时窄修复 | 连续纯 4s deadline 显示 busy，重试继续超时不重启；两个 ignoreAbort 迟到合法 204 均不成为 online、不 pin，retry 不 reload／relaunch；三文件 32 passed、0 failed、0 skipped，独立复审未留 P1/P2 | `health-timeout-busy.tap`、`health-timeout-late-response.tap`；4s deadline、8s interval、身份校验与混合失败 offline 门保留 |
| 同页 busy 与实际恢复 | 受控仅延迟 identity transport 后观察 busy；还原实际 transport 后最终同页探测为相同实例 204，慢响应条消失、documentStartedAt 不变、relaunch 0，历史 timeout＋network incident 保留 | `connection-actual-before.json`、`connection-ui-busy.*`、`connection-ui-busy-retry.json`、`connection-ui-recovered-final.*`；中间 `connection-ui-recovered.*` 仍 busy 的原图保留；不是安装版、持续延迟或旧冷图成因证明 |
| 接线 checkpoint 全量检查 | 4946 tests，4889 passed、0 failed、0 cancelled、57 conditional skipped；类型检查、lint 通过，现有 `_text` lint warning 保留 | `full-source-suite-2.tap`、`frozen-candidate-typecheck.log`、`frozen-candidate-lint-2.log`；57 个条件检查不作通过 |
| npm 风险续修 | `npm ci --no-audit --no-fund` 成功且 lock 字节未变；其后 npm audit 全部级别 0，实际 TypeScript parser／resolver 等适配回归 13 passed，依赖安全回归 29 passed，类型与完整 lint 通过，原 `_text` warning 保留 | `continuation-audit-20261118/clean-npm-ci.json`、`npm-audit-clean.json`、`lint-project-glob-clean.tap`、`dependency-security-clean.tap`、`typecheck-clean.log`、`lint-clean.log` |
| 风险续修全量检查 | 干净安装后 `npm test` 4974 tests，4917 passed、0 failed、0 cancelled、57 conditional skipped；未触发 Windows 构建或 runner | `continuation-audit-20261118/full-source-patched.log`、`checks-summary.json`；57 个条件检查不作通过，不能替代新 head 远端 CI |
| Next 补丁生产验证 | Next／eslint-config-next 16.4.6 生产前端编译成功；隔离安全模式页面可打开设置，CSS／JS 200、identity 204；空根教育工作区 503 保留，不作业务流程或原生安装通过 | `continuation-audit-20261118/frontend-production-build.json`、`production-http-smoke.json`、`production-browser-smoke.json` 及 PNG；独立 `.next-desktop` 输出，无桌面打包 |
| 发布默认平台保护 | 手动发布入口的 `platform` 默认从 all 改为 macos；从实际矩阵表达式核对默认只选 Apple Silicon Mac，发布平台／workflow／draft proof 三组共 59 passed、0 failed、0 skipped | `continuation-audit-20261118/default-macos-release.tap`；仅配置与结构回归，没有触发任何 runner、签名、构建或发布，实际发布仍显式传 `platform=macos` |
| Linux CI 准备修复 | 组合提交 `941112db` 引入 Ubuntu 区域镜像归一化、APT retries=2、HTTP/HTTPS 30s timeout、update 失败即停和原 11 包清单；Linux helper／workflow 及依赖安全回归定向 40 passed，完整 lint 通过 | `continuation-audit-20261118/combined-risk-targeted.tap`、`lint-combined-risk.log`；只证明本地结构与模拟 APT 行为，真实 Linux 网络／cargo 源码检查等待新 head 的 CI |
| Linux 源码兼容修复 | `ca54e91` 的 Linux job 已通过依赖准备、cargo check、GLib、D-Bus、单实例、portal 和 codec 检查；应用兼容检查暴露两个 SDK 回归硬编码 macOS `/private/tmp`，改为 Node `os.tmpdir()` 后 `lib/edupi-recall-answer.test.mjs` 4 passed | `continuation-audit-20261118/a363-audit-full.log`、`recall-answer-linux-fix.tap`、PR CI `44259389523`；最终 Linux source job 通过 |

## 已保留的失败与修复

1. 旧 Bridge hash 导致 503 `unknown_schema_hash`。同步完整 schema、五份 fixture 与清单修复，没有放宽校验。
2. 快速 context-only 答复先于 ACK、SDK 空 abort 先于 custom 的顺序曾使 final 消息和运行内资格错位。现按真实 entry ID、请求与会话处理；只隐藏已知空 abort，其他 provider 错误保留。
3. AppShell 结算时的纯 `edupi-artifacts-updated` 刷新曾被当成来源修改。现只允许明确的 `refreshOnly:true` 免于撤销。
4. 真实 SDK 在新 user entry 前自动 compaction 曾产生额外模型请求。公共 hook 取消该回合 compaction；SDK 强制阈值回归确认聊天及摘要模型为 0。
5. capture 裁剪原文但 query 保留原文，导致 `query_changed`。已统一 raw 绑定，真实 Core 及既有 legacy capture 回归通过。
6. preflight/capture/ACK pending 时的 idle 轮询曾提前通知完成。GET、finisher 入口及 `finally` 均有 submission guard，包含延迟 idle 响应反例。
7. 重入后的完整 Core 复核实际为 current，只有 Desktop `epoch:false`：前台 catch-up 的 `connector-setup/start_runtime`、`agent-computer/claim` 被当成来源修改。保留 `browser-b60-reentry-epoch-failure.json`；现仅这两项恢复操作不触发来源 fence，其他 Bridge 写入、owner 写入、关闭和重启仍撤销。17 项 supervisor 配对检查及独立审查通过；实际新回答、重入与无模型手动复核通过。
8. 开发页冷编译曾超过 6 秒及 10 秒 deadline，正常“重试”可恢复。失败未改绿，不以预热开发页替代安装版冷启动。
9. Fast Refresh 的 passive cleanup 晚于替换后的 layout load，作废新请求的 run id，留下永久 loading。改用 layout cleanup；真实 Refresh runtime 的内存反例可复现旧行为，普通 StrictMode 初次重放本身不能证明根因。能力探测另与每轮来源撤销解耦，对网络错误/503 做有 deadline 的有限重试；false/403 不重试，恢复入口后仍需独立 POST 才能 current。
10. 来源撤回场景先尝试 C1 reviews，实际 503，未记成功。原 fixture 两条种子只写了真实 outbox/SDK mapping，漏了 Desktop 撤回 mirror；补录只依据精确已捕获 outbox 和实际 SDK accepted 证据，不写 Core authority/current。保留 `synthetic-source-ledger-repair.json`；fixture 种子已改为与生产 registration/capture 同步记录 mirror，后续不得依赖手工补录。之后通过普通 session DELETE 完成真实 Core 来源撤回，不据此宣称 C1 reviews 在 Main4 可用。
11. 普通入口只读 inspect 曾调用不接受查询参数的 path-only 原生 helper，导致请求在本地被拒绝。现 GET 使用固定接口、编码后的查询参数和原生 token；helper 的纯路径限制保留。
12. inspect 确认 accepted 后旧 outbox 未收敛，曾阻塞下一问；管理中心取消又曾使用旧 G1 conversation。新 POST 在会话锁内按精确 SDK markers 收敛旧 ACK，取消按持久 R04 intent 绑定原 conversation；不重新发送旧问题。
13. 全局模板停止曾先访问 Core 再落本地 false；现先 CAS 持久关闭，再有界关闭旧 host 和暂停独立 grant。pending／failed drain 不能被其他领域的 clear／ensure 绕过；若模型忽略取消，48s 后返回 unknown 并保留同根隔离，须实际完成 drain 或恢复进程才能重新启动。48s 的真实墙钟等待未单独计时，现有证据是虚拟 deadline 与生产控制流。
14. Core pause 回读后会推进第二个配置版本，原临时 host 曾滞留在第一个版本而令后续 ensure 失败；现停止事务结束后再次严格关闭临时 host，关闭失败不报 verified。新页面全局停止返回 disabled／verified／paused，后续教育和历史回读通过，旧失败仍保留。
15. 两期脚本第一轮在 legacy 根上请求新 Main4 模板，创建 503；第二轮迁移到 Main4 后又因模板专用启动误带 `ownerMessageContinuation` 而失败。两个原失败日志分别保留为 `fc89-recurring-two-periods-1.log`、`-2.log`；已改为合成根明确迁移和模板独立参数，第三轮按原两期、去重、冷启与零模型断言通过。生产选择前用固定 Core 的只读 V4 validator 检查存储，拒绝 legacy 而不写未来启用状态，不迁移真实根。
16. 实际页面的小 GET 曾超时，独立进程测得完整 Core 校验单次 0.7–1.0s；同一次回答复核原有 3 次完整校验，多个收起或被覆盖界面仍读取投影。现保留每请求一次完整校验、跨 await 的现时数据根／SDK／授权检查，并暂停不可见界面的只读读取；命令和 mutation readback 不被暂停。实际响应时间仍待现场复测。
17. R04 stop 先持久 false 后默认 ensure，会因驻留实例身份含旧配置而在 pause 前被拒，固定返回 grants unknown。协调侧最小修复改用同根已验证驻留 handle，保留 local-first、严格关闭和 off 替代实例；18 项生产 identity 回归及 tsc 通过，独立复审关闭该 P2。此前实际 Core unavailable 仍须另验，不能只凭此修复认定消除。
18. 新增 SDK→stop 扩展回归曾在 120s 无结论，原日志、源码和合成会话已保存，确认自有 PID 停止后清理其临时根。聚焦的实际 C0／Core IPC／settings 生命周期第二轮到达 stop_returned 后 cleanup unknown，主错误又被 finally 断言覆盖；失败保留并新增受控阶段、耗时和 primary error 记录继续定位。此路径没有因既有 SDK 局部通过而改绿。
19. 第三轮受控阶段记录确认：Core 回答完成，runtime-stop 后已有 disconnect、exit，却没有 close；监督器只等 close，导致 48s 停止和再次清理均 unknown。现只把 exit／close 作为幂等退出证明，disconnect 不作证明；继续独立等待父模型 drain，二者都完成才释放 entry／隔离。虚拟与独立只读差分检查通过，第四轮实际 Core 生命周期通过；不通过增加全局 timeout 掩盖。
20. 连接原先把连续纯超时直接当作断连，现区分 busy；当前页面实际 incident 包含 timeout 与 network，后续真实同实例 204 恢复，不能回推旧冷图一定是纯 timeout。受控页面首次恢复等待未在 15s 内取得结论，随后又采到 busy 的中间图，均保留；最终无横条且最新探测为 same／204 的独立采样才记录本次恢复通过，不据此宣称连续性能通过。
21. Ego 的日期 fill 曾只改变 DOM 值而未更新结束日期的 React 状态；按真实年份／月份／日期键盘输入后创建可用，未修改业务校验或生产表单。跨调用刷新还曾丢失测试注入，重新 bootstrap 仅修改私有 QA helper，不修改生产身份或 token 边界。

## 普通安装入口

原 R04／L4-P1-6 的生产放行仍未完成。普通 Tauri 的持久 R04 设置、显式每问入口、四处 activation 消费者和模型主机已接入；默认发送仍走普通聊天，只有“核对记忆”才进入独立 R04。canary 另行提供 isolated flag、private Live profile、owner grant 和已捕获来源，不能把上述页面结果记为普通安装语义验收通过。

新增 `edupi-recall-config/authorization/store` 提供私有原子写／回读、根内跨进程锁、CAS、独立 R04 grant／scope／model／consent、逐问题原文意图和跨冷启预算。普通源码语义门固定 false，启用请求拒绝且不写未来 true；stop 可否决 canary 环境且不修改 G1。used／unknown 均计数，重复 IPC id 不再授权，失账本不重建额度。模型主机对 reserve 之后的停止／配置／取消重新核对，最多 12 次的持久额度不借用旧 64 次内存上限；这些工程证据不放开真实语义门。

不需要新增 Rust 命令。缺少或损坏配置、换根、授权变化、安全模式都应关闭；不能为了 R04 自动启用 G1，不能把 G1 的旧同意或用量统计同意扩大为 R04 模型授权。普通启动的最低验收仍是：无环境开关默认关闭 → 独立授权/逐问题 capture/明确预算写后回读 → 完整退出冷启保持 → 关闭或撤权失效。

当前真实 GLM 套餐 `429/code1310` 为外部阻塞；不重试、不换账号或 key、不新增付费。Core CI、最终 pin 与 assessor 装配 ready 均不替代真实语义验收，当前不默认放开生产入口。

## 原 L4 与发布范围

本轮 R04 卡片工程证据不替代五领域、周期工作、教师反馈、系统通知、真实升级或教学内容质量。沿用 `.115/.117` 仍有效的 G3/G5、安装与升级证据；R03 已有精确事项和两份草稿证据仍不能证明发送、绑定或通知点击完成。

冻结 Core 配对的 G1/G2/G3/G4/G5 源检查、周期及反馈检查已补：九组 197 passed、0 failed、0 skipped；合成 2026-11-18/25 两期各两份 507 bytes 产物，route/磁盘/持久 SHA-256 一致，attempt 1，重启保持。三领域真实落盘产物和 synthetic feedback 保留；`synthetic_excluded=3`、`real_teacher_current=0`，未验证的反馈 source 不改绿。详见证据根 `paired-workflows/REPORT.md` 和 `summary.json`。这些是新私有根及一次性 source-candidate V3 测试迁移，`main4Checks=[]`，不覆盖旧 Main4 `create_task` 拒绝。

原 L4-P0-1/P1-4/P1-6 的 Main4 周期装配已接入精确 owner／grant／scope／显式 templateIds、窄模板 owner 通道、首次 owner create，以及 review_task modify、done／progress 和全局停止。顺序加入模板保持同 scope grant ID，旧 selection 与版本须精确匹配，不能自动全选或借 G1 授权。fixture 已更新至 fc89，周／月正式 API 准备及周模板页面流程通过；同签名安装、自然到期、反馈与旧 proposal 生命周期仍分别待验，不能把确定性骨架记为教学质量。

Core 最终精确 CI 与同树合并 pin 已取得，Desktop 源码及连接窄修复的独立复审已有证据；同源 Mac 签名、安装与正式 Release 已按本文首节更新。GUI、updater 与真实教学内容质量仍分别未验收。后续构建显式使用 `platform=macos`，不使用包含 Windows 的全平台矩阵。

## 发布阻塞

精确 head `0803ab9f` 的 CI `44204350138` 中，Linux 源码 job `134466326215` 成功，npm 与 Rust audit 分别失败。`b965999e` 的 CI `44213186503` 在系统依赖安装阶段超时。最终 head `ca54e91` 的 CI `44259389523` 中，Linux source 和 audit 通过，Rust audit 仍因 chrono `RUSTSEC-2026-0543` 失败；最终结果已写入 PR509。旧 run 不替代最终 head 的结果。

`npm run security:audit` 的已记录失败有 15 项计数，其中 11 项 high 来自 picomatch 4.0.7 经 fdir／tinyglobby 到 ESLint 和构建 glob 的依赖链，并非 11 个独立公告。当次官方 `GHSA-fc5q-39xc-vjpf` 查询标注受影响版本 `<=4.0.7`，未列修复版本，registry latest 为 4.0.7；原输出为 `frozen-candidate-audit.log`。Rust audit job `134466326494` 因 chrono 0.4.45 的 `RUSTSEC-2026-0543` unmaintained 警告，在 `cargo audit --deny warnings` 下失败；本轮 Cargo 相对 PR508 仅调整应用版本，没有新增该依赖。

2026-11-18 风险续修取代 npm 未修复状态：正式 registry 仍无 picomatch 修复版，因此移除它的 lint 依赖链。两个固定 TypeScript ESLint consumer 通过明确命名的 `@edupi/lint-project-glob@1.0.0` 窄适配包使用官方 `glob@14.0.6`，实际 parser typed program、resolver、目录展开、忽略路径和有界 repeated extglob 均有回归；不是改写上游版本或屏蔽公告。Next 根目录适配器独立改用同一官方引擎，仍只接受目录查询。并升级官方稳定补丁 Next／eslint-config-next 16.4.6、Hono 4.13.19、`@hono/node-server` 2.1.9、fast-xml-parser 5.12.1，关闭余下低／中危。干净安装后 `npm audit --audit-level=high --json` 的 info／low／moderate／high／critical 均为 0。审计门保持原样，组合 head 的 CI 尚须另取证。

Rust `RUSTSEC-2026-0543` 当前为所有版本的 unmaintained 公告，官方 `patched=[]`，chrono 最新 0.4.45 不能通过换版本解决。直接父级为 notify-rust 的可选 macOS 集成、serde_with 的可选 `chrono_0_4` 集成，以及 Windows `uiautomation` 的必需依赖；已查其官方新版本仍保留 chrono。Mac 生产树 `cargo tree --frozen --target aarch64-apple-darwin -i chrono --edges normal,build` 无启用路径，不能替代完整锁文件审计。用户已明确批准本次仅 macOS Apple Silicon 候选采用书面例外：`cargo audit --deny warnings` 仍会失败，例外不改变审计结果、不放开 Windows、不延伸到其他平台；后续上游迁移仍是正式解除条件。只读调查及缺缓存而未完成的跨目标检查分别记录于 `continuation-audit-20261118/readonly-audit-findings.json`。

签名、安装与正式 Release `.118` 已按上述 macOS-only 例外完成，首轮 harness 失败保留。协调侧唯一执行 metadata 发布，GUI／updater 未验收的边界和公开说明差异见上节；没有使用仍要求全平台资产的 `phase=publish` 入口，没有重建或再次安装，也没有触发 Windows。普通 R04 真实模型 `429/code1310` 是另一独立阻塞；真实模型不重试、不换账号或 key，不把 npm 零漏洞或正式 Release 公开视为完整 R04 放行。

## 清理

上一轮接线验收已结束 Ego TaskSpace12，停止并核对自有 controller／Next／Core／provider 共五个 PID 全部不存在。按 metadata、用户 UID、realpath、Git 跟踪／ignore 和 lsof 逐路径核对后，删除 `.next/`、四组 R04 合成数据根／容器、三组 Native 合成根／独立 stateDir，以及已复制原始证据的两个临时 runtime proof 目录，共 17 个非重叠路径。删除前占用合计 709,472 KiB，操作前后卷可用空间增加 726,663,168 bytes；时点空间变化不单独用作内容完整性证明。

证据为 `final-stop-before-processes.json`、`final-stop-after-processes.json`、`final-cleanup-preflight.json`、`final-cleanup.json`。原始 runtime 失败 metadata、合成 session 和最终 Main4 设置已保存到私有证据子目录 `cleanup-preserved/`；全部源码、依赖、失败 TAP／日志／图片／绑定和回退证据保留。该轮 `.next-desktop/`、`src-tauri/target/` 及生成资源目录未产生，没有删除受跟踪的 resources 元数据；正常 App、真实教师资料、全局模型及认证未进入清理范围。

风险续修轮已结束 Ego TaskSpace13，生产前端检查服务、控制器和构建 PID 全部退出；再次核对 ignore、tracked、realpath、UID 和 lsof 后，删除新的 `.next-desktop/` 与空隔离构建根两处，合计 959,212 KiB，卷可用空间增加 969,543,680 bytes。证据为 `continuation-audit-20261118/cleanup.json`；前端编译、浏览器、审计、类型／lint、全量测试和旧失败日志仍保留，依赖保留供后续组合验证使用。
