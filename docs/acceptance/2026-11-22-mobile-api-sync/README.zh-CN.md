# R24.4c 可选云端同步验收

2026-11-23 当前续验取代下方 22 日的“未接入”状态：候选 `.125`，基线 main `f0cb69e9`，分支 `codex/edupi-cloud-risk-completion-20261123`。源码已实现，当前仍待最终合并、macOS 签名安装/升级/公开 Release 和实体 iPhone，整体不记为完成。Windows 继续暂停；最新逐项状态以本页“未完成验收”表为准。

- 学生 import/update/history/restore：真实 PostgreSQL、角色/RLS、同名异班、50 条版本窗口和 HTTPS 写后回读通过。
- 云端文字对话：专用 lease、nonce/generation、请求幂等、事件游标、本机真实 Pi harness 和合成模型 HTTPS 回读通过；页面完成两轮，final journal 在服务重启后恢复，不重复调用模型。工具关闭；合成模型只用于传输验收，不代表教学内容质量。
- 材料：实际页面登录/选择 workspace、暂存→Storage 字节核验→列表、软删除→回收站恢复→原列表回读通过；另实际断网保存后停止/重启服务，确认原 ID/fingerprint 和文件保留，恢复网络后 outbox=0、upload_verified=true、staging_settled=true。
- 班级：固定 Core `fc89b3bc…` 真实成绩、排座、值日计算，独立 PostgreSQL 增加 Unicode 边界后 15/15 通过；HTTPS 三域 preview→save→客户端重建重放→回读通过，值日真实任务在 dashboard 回读一致。
- iOS：33 条 cloud Swift XCTest、5 条现有 UI 测试通过，最终 sync 合同 hash 与 Desktop/Edge/registry 一致；这些是 Simulator/URLProtocol 证据，实体 iPhone 仍未接入。
- 新增 SQL 已按回滚事务检查后增量部署，并备份服务器 schema、control data、原函数和配置到 `/srv/edupi-supabase/backups/20261123-cloud-risk/`；没有重装数据库或分发 service role。

本机证据：`/tmp/edupi-cloud-risk-http-20261123.log`、`/tmp/edupi-cloud-chat-worker-e2-20261123.log`、`/tmp/edupi-desktop-cloud-client-e2-20261123.log`、`/tmp/edupi-classroom-https-live3-20261123.log`、`/tmp/edupi-cloud-classroom-main-verification2-20261123.log`、`/tmp/edupi-cloud-lease-regression-20261123.log`、`/tmp/edupi-risk-ui-20261123/offline-proof.json`。页面使用隔离账号/根和合成 Tauri IPC 适配，仅证明开发页面；原生 WebView 必须用最终安装包另验。22 日记录作为历史阶段保留。

2026-11-23 风险续修：`6ef4822` 保留 11 个入口的云错误状态，并阻止 cloud 事项进入本地备课、绑定及提醒文件；107/107 定向检查通过。`9291d3b` 修复材料回执丢失后的已有对象恢复，真实 HTTPS 在完整接收写入成功回执后故意丢 ACK，再用新客户端默认 fetch 重放，确认原 envelope/request/receipt、远端字节和唯一材料记录，最后 outbox=0、staging=0；日志为 `/tmp/edupi-material-ack-loss-current-20261123.log`。此前真实 Storage 对已有对象重新签名返回 503 的失败证据保留。

会话新增恢复验证使用 `scripts/test-edupi-cloud-chat-ack-loss.mjs`：只让创建请求在服务端提交前失败一次，然后立即恢复真实网络，API 仍返回 202 和固定 sessionId，首次消息依赖创建完成后才投递；重建客户端后仅一条 request 和一条用户消息。另分别验证真实改名、停止、配置、删除成功后消费完整回执再丢 ACK，接口均返回待同步，新客户端使用原请求重放并重新读取，最终队列 0。日志 `/tmp/edupi-chat-ack-loss-https-20261123.log`，首次“排队请求尚未停止便改配置”的 409 测试顺序错误保留在 `...-attempt1.log`；修正为先停止后配置，不放宽生产校验。新的草稿/发送恢复和侧栏组件检查单独记录，不将其冒充安装版交互。

`7f484fb` 最终源码检查：`/tmp/edupi-0125-final-source-tests-20261123.log` 为 5,303 tests／5,227 passed／0 failed／76 conditional skipped；`...-types-...log` 通过，`...-lint-...log` 为 0 errors、7 warnings，合同 10/10。完整首条消息持久化、丢 ACK、冷重载、同账号重新登录、跨账号草稿与迟到回执等 worker 回归 168/168；侧栏 queued/失败/确认及同步后刷新为实际 React 组件 7/7；原导航与侧栏组合 52/52、发送生命周期及草稿哨兵组合 49/49。首次全套的旧夹具 54 项失败留存在 `...-tests-20261123-attempt1.log`，补新导入与实际 scope/回执字段后完整重跑通过，未删断言。76 条条件跳过不计通过，固定 Core 班级计算与独立数据库的针对性证据另见 15/15 日志。

随后 `21bdedb` 增加读取响应、SSE 重连和首次 thinking level 的 scope 回归，`fd6c736` 增加 fenced journal 恢复回归；最终源码整套更新为 5,321 tests／5,245 passed／0 failed／76 conditional skipped。真实接管脚本在 `/var/folders/xk/qmn_r8g93ljb7b5vqzq3rd040000gn/T/edupi-cloud-worker-evidence-20261123-3NBB2g/remote-worker.log` 通过：旧实例的 final journal 在新实例遇到 `409 runtime_fenced` 后保持原字节，旧请求变为 `uncertain` 且模型调用为 0，新队列请求由本机 Pi harness 完成且模型调用为 1。该证据使用隔离账号、workspace 和 public anon key，临时账号与状态已清理。

真实资料保护回查仍保留严格失败记录：775 个原文件中 773 个保持原字节，`feishu-bridge.log` 与 `runtime_events.jsonl` 由现有飞书桥重连追加 32／553 bytes，旧前缀与备份一致；事件类型仅 `channel_reconnecting/channel_reconnected`。未用备份覆盖这些新日志，正常 `/Applications/EduPi.app` 未运行或替换。私有保护证据为安装 checkpoint 的 `evidence/real-baseline-after-source-recovery.json` 和 `real-automatic-log-delta.json`，后续安装前另取当时状态，不把本次严格比较改记为通过。

日期：2026-11-22，替代本目录旧的开发工作树测试记录；原 R24.4b 本地账号服务与完整 R04/L4 状态不变。

当前状态：**部分实现；本次范围的开发验收与独立审查通过，源码合并状态以本 PR 记录为准；完整 Desktop/iOS 产品同步与安装发布未验收。**

最终受验功能提交 `dde8c9cf08e379651c78fa61db7788a938f3cfbf`，初次功能提交 `c7c021e82c56ba32b8d9e84f0fff25b56841b5a8`，基线 `5c7ae60feedc422f242b1b492b2fc097e75be618`，分支 `codex/edupi-supabase-cloud-sync-20261122`。PR 审查后补上任务/Today 审核拒绝、学生姓名过滤和 cloud 材料本地控件隔离；安全补丁 `5168149eb8d5ef4dc2dfb13297259e5b421cd278` 另更新两项 Rust 依赖，未改变云同步功能源码。整合在独立工作树进行，原桌面端混合修改及原聊天工作树保留。

## 架构与实际范围

- 默认 local；本机 Core、教师数据、模型配置和 Pi session 保留。Supabase Auth 由独立 `/api/edupi/cloud` 管理。
- 登录后明确选择成员工作区。登录、刷新、退出、过期、网络错误、待同步与冲突状态从设置页可见；云端控制接口强制 Desktop token。
- dashboard 1.0 identity、历史 migration 字节和本地 Core pin 保留。当前云 writer 与本地 Core 版本不同，由独立云端任务合同适配。
- 普通任务创建/阶段移动、事实生命周期、材料元数据编辑/历史恢复使用持久 outbox、固定请求身份和写后重读。任务意图可先离线排队，再在连接恢复后持久化首次 envelope。
- 队列、回执与 snapshot 游标绑定地址/账号/workspace；旧响应及过期页面写入不能进入新 scope。冲突不自动覆盖，独立记录可继续同步。
- 事实回收站读取同一云工作区；事实冲突关系缺失时禁用接受。云端不支持冲突替换，数据库准入同样拒绝该操作。
- 未接入的本地写入在 cloud 模式下拒绝；云材料路径不映射成本地可打开文件。

配置及后续完整接口同步规则见 [架构文档](../../architecture/edupi-mobile-api-sync.md)。新增配置名称为 `EDUPI_DATA_MODE`、`SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_URL`、`SUPABASE_ANON_KEY`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`EDUPI_WORKSPACE_ID`；沿用 `PI_DESKTOP_STATE_DIR` 和 `PI_DESKTOP_API_TOKEN`。iOS 使用私有 build setting `SUPABASE_PUBLISHABLE_KEY`，真实 key 不进入 Git。

## 针对性证据

环境：本机 macOS、当前 Node/npm/Deno 与 Xcode 27.2；远程既有 Supabase `https://edupi.intelliclass.online`，数据库容器 `supabase_db_edupi-desktop`。所有写入均使用临时账号/workspace 或回滚事务。

`scripts/test-edupi-desktop-cloud-sync.mjs` 从本机运行实际 Desktop 同步客户端，经公网 HTTPS 验证：

1. 默认 local，未登录、不初始化云凭据目录。
2. Supabase 登录、明确选择有权限工作区、读取 dashboard 四组集合。
3. Desktop client 创建任务、移动阶段，按完整回执和 snapshot 重读核对。
4. 独立登录、独立私有目录的第二客户端，从 mobile-dashboard 读到同一任务。
5. 事实 capture、modify、delete、restore，每次写后重读；第二客户端读到修订值。
6. 通过既有 broker 预置隔离材料，Desktop client 修改元数据、读取历史、恢复；第二客户端核对相同材料。
7. 仅中断该客户端的网络传输，任务进入 outbox；重新创建客户端模拟进程恢复，保留 workspace/游标，重放并确认无重复。
8. 刷新登录、退出回到 local；最后删除临时账号、workspace 和本机私有状态目录。

上述流程通过。安全迁移部署后又以 `EDUPI_TEST_STORAGE_SECURITY=1` 验证真实 Storage：active 成员可读，撤销后读/新增/覆盖/删除均被拒绝；上传签名入口拒绝路径穿越。第二客户端是独立 API 客户端，**不代表实体 iPhone App 已完成任务/事实/材料写入或双向编辑验收**。材料预置也不代表 Desktop staging→Storage 二进制上传已接入。

本地行为回归覆盖：local 不联网、不写配置；拒绝 service role；显式工作区选择；未知合同拒绝；队列账号/工作区隔离；退出/刷新竞态；迟到请求拒绝；重复请求内容冲突；队列容量；HTTP 200 但重读不符仍保留；65 条后首条请求身份仍可重试；对象被其他入口更新后保留冲突且不阻塞独立项；云回收站路由不调用本地 Core；202 待同步状态；设置关闭后继续同步、慢请求不重叠及隐藏暂停。

界面使用实际 React 组件、隔离合成服务在 Ego TaskSpace 43 验证。它证明组件交互，不替代原生 Tauri WebView/安装版验收。

数据库安全回归已在远程事务中执行：非成员/已撤销成员拒绝、四条 Storage 策略全部五个判断条件、有效期和实例绑定的 Runtime 租约；事实冲突、同实体同谓词并发顺序、原始 payload/actor 的幂等身份及内部旧函数权限均通过，测试和临时 schema 修改均回滚。随后两条新迁移已在既有服务应用，历史迁移字节不变；已部署字节与本分支核对一致，既有 broker 远程 E2 再次通过。两条 PostgreSQL 连接在首条租约尚未提交时并发申请同名租约，竞争者被拒绝，原持有者保留。

命令与原始日志：

- `node_modules/.bin/tsc --noEmit --incremental false`：通过。
- `npm run lint`：0 errors，保留既有 `scripts/test-edupi-core-history-e2.mjs` 的 1 条 unused-vars warning。
- `npm run test:supabase-contract`：10 passed、0 failed。
- `npm test`：5,113 tests、5,056 passed、0 failed、57 conditional skipped；跳过不计通过。各轮失败均保留原始日志。
- 6 个函数分别 `deno check --config <function>/deno.json <function>/index.ts`。
- Deno HTTP/材料路径/学生过滤行为测试：6 passed、45 steps、0 failed。
- `supabase/security-regression.sql` 与 `supabase/fact-conflict-regression.sql` 的远程回滚事务。
- `xcodebuild -project ios/EduPi.xcodeproj -scheme EduPi -sdk iphonesimulator -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/edupi-cloud-ios-20261122 CODE_SIGNING_ALLOWED=NO build`：`BUILD SUCCEEDED`。
- 本机日志 `/tmp/edupi-cloud-sync-*.log`、`/tmp/edupi-cloud-ios-20261122.log`；临时编译目录在验收后清理。

最终整套日志为 `/tmp/edupi-cloud-sync-fully-frozen-npm-20261122.log`；页面 scope/旧回调/离线任务创建组合为 173 passed，独立复审另实跑 queued create 的 8 项行为测试，审查范围内无未关闭 P1/P2。浏览器重新构建当前源码验证登录后需选择工作区、关闭设置后继续同步（overlap=0）及隔离断网后可切回 local；TaskSpace 46 又实际打开 cloud 材料抽屉，metadata 编辑入口存在，schedule/excerpt/上传入口均为零，本地 API 请求为零。

GitHub 审查补丁另有 Node 行为测试证明 cloud 任务/Today 审核在本地 writer 之前返回 409；学生姓名先在同一工作区解析为唯一 ID，未知、同名或控制字符输入不会扩大为全班查询。部署后的扩展 broker E2 已实际验证精确姓名只返回本人事件、未知与同名返回空列表，日志为 `/tmp/edupi-cloud-sync-followup-broker-20261122.log`。student 函数的部署 SHA-256 为 `f4225a2bc20ed9b7758b62c17677e562d2dfa1818ee2e5721aae90ac05b52dfb`，与源码完全一致。

初次真实 Desktop 同步客户端 HTTPS 流程通过的证据仍保留；后续两次扩展客户端重跑在登录/工作区初始化阶段遇到 `ECONNRESET`、TLS 连接中断，记录为**无结论**，不计通过。两次均执行测试账号/工作区/本机状态清理；没有用服务器 broker 回归替代这次客户端重跑。

安全 CI `45012858152` 在提交 `3d3e461f84aee5c25c6283fa110e4254b4d004d7` 上的 `audit`、`linux-source` 通过，`rust-audit` 因新发布的 `RUSTSEC-2026-0592` 失败：`url 2.5.8` 处理嵌套 `blob:` URL 可能造成栈溢出。安全补丁通过官方 Cargo registry 将 `url` 更新为 `2.5.9`，并按其依赖约束将 `form_urlencoded` 更新为 `1.2.3`；其他解析版本、审计策略和工作流均保持。失败日志为 `/tmp/edupi-cloud-rust-job-clean-20261122.log`，更新日志为 `/tmp/edupi-cargo-url-update-20261122.log`。修复后的 `cargo audit --file src-tauri/Cargo.lock --deny warnings`、Linux `cargo check --locked` 及应用兼容性结果以 PR #518 的最新 CI 为准，源码合并状态单独读取该 PR，不能沿用修复前结果。

最终界面截图：[隔离合成设置页](./cloud-settings-synthetic.png)。它只包含合成账号和工作区。

## 部署与回退

已应用 `20261122071008_edupi_security_boundaries.sql`、`20261122081223_edupi_fact_conflict_admission.sql`，并更新材料上传函数、路径校验 helper 及学生事件过滤函数。只有 Edge Runtime 容器重启，现有服务与私有配置沿用。服务器备份在 `/srv/edupi-supabase/backups/cloud-sync-20261122/`，目录权限 0700；保留原 schema 与函数归档用于本次发布回退，后续稳定部署替代并确认无需回退后再清理。未向 Desktop 或 iOS 分发 service role。

## 未完成验收

| 用户流程 | 状态与原因 |
| --- | --- |
| 原生 Desktop 不登录的完整教师工作流 | 默认与 local 回归通过；本轮未重新安装 App 操作 |
| 原生 WebView 登录、切换、离线恢复和冷重启 | 实际客户端 HTTPS、组件交互通过；组合安装版未验 |
| Desktop 新事实的可见录入入口 | broker/client capture 通过；Pi chat capture 到云端尚未接入 |
| Desktop 材料 staging→Storage→重读 | 开发页面及真实 Storage、断网重启和丢 ACK 精确重放通过；原生安装版未验 |
| iPhone 读取桌面新任务 | mobile-dashboard 独立客户端通过；实体 iPhone 未验 |
| iPhone 修改后 Desktop 读取 | iOS 任务/学生事件写入 API 已编译；实体 iPhone 与跨客户端写入未验 |
| 全量事实脊柱编辑、学生/班级/校历/课表写入 | 学生及版本、班级三域、校历/课表 HTTPS 和真实 Core 通过；完整事实脊柱及安装版 UI 未验 |
| 周期任务、课前准备、任务审核、提醒与本地会话绑定 | 保持本地功能；cloud 未支持入口拒绝，不写入本地对象或相对文件夹 |
| 对象删除/恢复 | 通用软删除及材料开发页面跨入口回读通过；安装版 UI 未验 |
| Session/SSE/Pi prompt、Runtime 云 register/lease/event | 已接入；HTTPS、本机真实 Pi harness、开发页面两轮及重启恢复通过；新增发送恢复未验安装版 |
| 原生后台真实断网与恢复 | 隔离传输断网和浏览器可见性模拟已验，系统真实断网未验 |
| macOS 新安装包、签名、公证、升级和 Release | 当前分支没有对应安装包；另一聊天的 `.123` 资产不能证明本轮代码 |
| Windows runner/构建/打包/安装/升级 | 用户明确暂停，未启动 |

## 追加闭包验证

本轮追加的 `codex/edupi-cloud-closure-20261122` 验证如下：

- `scripts/test-edupi-desktop-cloud-sync.mjs` 的真实公网 E2 已通过任务、事实、校历、课表、材料元数据、二进制材料上传、Storage 下载回读、离线 outbox 恢复和清理。
- `npm test`：5,115 tests、5,058 passed、0 failed、57 conditional skipped；typecheck、修改文件 lint 通过。
- iOS 任务创建/移动、学生事件修改/删除 API 已加入；无签名 iOS Simulator build 为 `BUILD SUCCEEDED`。
- Desktop classroom cloud route 已加入已有 `edupi-classroom` writer 并对保存/恢复回读；真实安装版 UI 尚未操作。

上段为 22 日追加的阶段证据；Pi chat/session/SSE/prompt、学生名单/档案 cloud writer、对象删除恢复和 Runtime 联动的 23 日实现与开发验收已记在页首。实体 iPhone、macOS 当前分支签名安装/升级/Release 仍单独待验；Windows 按用户要求暂停。
