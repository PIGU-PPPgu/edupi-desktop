# R24.4c 可选云端同步验收

日期：2026-11-22，替代本目录旧的开发工作树测试记录；原 R24.4b 本地账号服务与完整 R04/L4 状态不变。

当前状态：**部分实现；本次范围的开发验收与独立审查通过，源码合并状态以本 PR 记录为准；完整 Desktop/iOS 产品同步与安装发布未验收。**

受验功能提交 `c7c021e82c56ba32b8d9e84f0fff25b56841b5a8`，基线 `5c7ae60feedc422f242b1b492b2fc097e75be618`，分支 `codex/edupi-supabase-cloud-sync-20261122`；后续提交仅补充交付记录。整合在独立工作树进行，原桌面端混合修改及原聊天工作树保留。

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
- `npm test`：5,103 tests、5,046 passed、0 failed、57 conditional skipped；跳过不计通过。前两轮失败均保留原始日志。
- 6 个函数分别 `deno check --config <function>/deno.json <function>/index.ts`。
- Deno HTTP/材料路径行为测试：5 passed、28 steps、0 failed。
- `supabase/security-regression.sql` 与 `supabase/fact-conflict-regression.sql` 的远程回滚事务。
- `xcodebuild -project ios/EduPi.xcodeproj -scheme EduPi -sdk iphonesimulator -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/edupi-cloud-ios-20261122 CODE_SIGNING_ALLOWED=NO build`：`BUILD SUCCEEDED`。
- 本机日志 `/tmp/edupi-cloud-sync-*.log`、`/tmp/edupi-cloud-ios-20261122.log`；临时编译目录在验收后清理。

最终整套日志为 `/tmp/edupi-cloud-sync-npm-verified-20261122.log`；页面 scope/旧回调/离线任务创建组合为 173 passed，独立复审另实跑 queued create 的 8 项行为测试，审查范围内无未关闭 P1/P2。最终浏览器重新构建当前源码验证登录后需选择工作区、关闭设置后继续同步（overlap=0）及隔离断网后可切回 local。

最终界面截图：[隔离合成设置页](./cloud-settings-synthetic.png)。它只包含合成账号和工作区。

## 部署与回退

已应用 `20261122071008_edupi_security_boundaries.sql`、`20261122081223_edupi_fact_conflict_admission.sql`，并更新材料上传函数及其路径校验 helper。只有 Edge Runtime 容器重启，现有服务与私有配置沿用。服务器备份在 `/srv/edupi-supabase/backups/cloud-sync-20261122/`，目录权限 0700；保留原 schema 与函数归档用于本次发布回退，后续稳定部署替代并确认无需回退后再清理。未向 Desktop 或 iOS 分发 service role。

## 未完成验收

| 用户流程 | 状态与原因 |
| --- | --- |
| 原生 Desktop 不登录的完整教师工作流 | 默认与 local 回归通过；本轮未重新安装 App 操作 |
| 原生 WebView 登录、切换、离线恢复和冷重启 | 实际客户端 HTTPS、组件交互通过；组合安装版未验 |
| Desktop 新事实的可见录入入口 | broker/client capture 通过；Pi chat capture 到云端尚未接入 |
| Desktop 材料 staging→Storage→重读 | 元数据编辑/恢复通过；二进制上传未接入 |
| iPhone 读取桌面新任务 | mobile-dashboard 独立客户端通过；实体 iPhone 未验 |
| iPhone 修改后 Desktop 读取 | 手机版写入入口尚未实现；未以模拟通过代替 |
| 全量事实脊柱编辑、学生/班级/校历/课表写入 | 部分只读/服务端已有；Desktop 写入未全部接入 |
| 周期任务、课前准备、任务审核、对象删除/恢复 | 保持本地功能；cloud 未支持项明确拒绝 |
| Session/SSE/Pi prompt、Runtime 云 register/lease/event | 保持本机 Core；尚未接入 Desktop 云控制 |
| 原生后台真实断网与恢复 | 隔离传输断网和浏览器可见性模拟已验，系统真实断网未验 |
| macOS 新安装包、签名、公证、升级和 Release | 本轮源码工作待后续安装验收；没有沿用旧包证明新代码 |
| Windows runner/构建/打包/安装/升级 | 用户明确暂停，未启动 |

不能据此宣称“全量云端同步完成”。
