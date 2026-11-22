# EduPi 桌面端与手机版接口同步

## 当前结论

手机版当前已经和云端 `mobile-dashboard` 读接口对齐。它能通过 Supabase Auth 登录，读取 workspace，调用 `edupi-core-broker` 的 `mobile-dashboard`，得到学生、任务、校历和课表。

桌面端默认仍是 local。可选 cloud 模式提供独立的 Supabase 登录、明确选择工作区、版本化 dashboard 读取、普通任务创建/阶段移动、事实生命周期与材料元数据编辑/恢复。任务、事实和材料元数据先写入私有 outbox，再向已有 broker 发送；任务意图可在尚未读取云端快照时离线保存。常驻同步组件在联网恢复、页面重新可见及每 15 秒重试，设置面板关闭后仍运行。

2026-11-23 候选 `.125` 增加学生名单/档案版本、通用软删除恢复、材料二进制耐久队列、班级真实计算和云端文字对话。聊天由本机 Pi harness 执行，模型认证留在本机，云端保存请求、消息和可续读事件。专用 `cloud-chat` 租约、instance nonce 和 fencing generation 共同约束回调；结果不确定的请求保留，不自动再次调用模型。任务审核、周期主动工作流和完整教育记忆仍未全部云端化。

桌面端云模式配置：

- `EDUPI_DATA_MODE=local` 是默认值；也可在设置页切换到 cloud。
- `SUPABASE_URL` 或 `NEXT_PUBLIC_SUPABASE_URL` 指向 Supabase；默认地址是 `https://edupi.intelliclass.online`。
- `SUPABASE_ANON_KEY` 或 `NEXT_PUBLIC_SUPABASE_ANON_KEY` 只允许使用 Supabase public anon key；service role key 只留在 Edge Function 服务器。
- `EDUPI_WORKSPACE_ID` 可预选工作区，但仍须验证当前账号的成员资格；未配置时登录后明确选择，不自动选第一项。
- `PI_DESKTOP_STATE_DIR` 沿用 Desktop 的状态目录。session、当前 workspace、模式、快照游标、outbox 与已核验回执保存在私有 `cloud/cloud-private.json`，不会写入 localStorage、Git 或日志。
- `GET/POST /api/edupi/cloud` 使用既有每进程 `PI_DESKTOP_API_TOKEN`，仅正常 Desktop WebView 能访问；普通网页不能用伪造 Host 接管保存的云端登录。
- iOS public key 通过 Xcode build setting `SUPABASE_PUBLISHABLE_KEY` 注入，仓库不保存真实 key。

local 模式继续使用 `EDUPI_CORE_ROOT`、`EDUPI_DATA_ROOT` 和本地 Pi session。设置中的“本地模式”不依赖网络；退出云端也会回到 local。cloud 模式不会全量覆盖或搬迁这些本地资料。

队列按 Supabase 地址、账号及工作区绑定，登录、工作区或模式改变后丢弃迟到响应，保留原归属的待同步记录。每个请求保留首次 envelope；已核验回执不按条数淘汰，存储达到 4 MiB 或待同步达到 256 条时拒绝新增并保留旧记录。冲突保留原内容，不自动覆盖云端；单一对象冲突不会挡住后面的独立记录。

cloud 提醒、本地备课执行、周期主动工作流及事项与本地 Pi session 绑定尚未支持；对应入口明确拒绝，不将云端 ID 交给本地 Core，也不把 `cloud:workspace` 当作文件夹。工作区在等待期间改变时，旧的准备或重试停止。云端登录失效、无权限和工作区冲突保留各自的 HTTP 401、403、409，不能统一伪装成网络错误。

会话改名、删除、配置与停止进入队列后返回 202 和 `pendingSync`，界面保留原记录并显示待同步；写后核对及成功同步后才刷新显示。会话行自带生成时的 `cloudScope`，旧页面不能继承另一个账号或模式的写入身份。离线创建保留固定会话 ID，并依次保存创建和完整首条消息。

会话创建尚未确认时，依赖它的消息只入队，不提前发送；连接短暂恢复不会把首条消息变成永久 404。创建发生冲突时保留对应消息，其他独立会话仍可同步。浏览器草稿和待确认消息按 issuer/account/workspace 隔离，不带 generation，保留同账号重新登录后的恢复能力；其中不保存认证令牌。待确认消息保存完整首发请求体和 `clientRequestId`，重试先从云端 requests 核对，缺失时仅重放原字节，不进入本地 Core 的消息收集路径。

`snapshot_id/state_hash` 是当前 broker 支持的等价同步游标，重启后保留；broker 仍返回完整投影，没有新增 delta API，也不声称已实现增量分页下载。只有回执和对象重读均核对后才清除待同步项。材料上传 envelope 会剥离本地 staging path，并把 Storage object key 绑定到材料对象；云端材料不会伪装成本地可打开路径。

材料写入回执丢失时，客户端先核验已上传对象的字节，再重放原始 command；不要求为已存在对象重新申请上传地址。真实 Storage 已验证该恢复路径，避免旧服务对已有对象签名返回 503 后永久卡住队列。

## 已建立的同步边界

`contracts/edupi-mobile-dashboard-v1.json` 是手机版首页读模型的字段源文件，当前版本为 `1.0`，hash 为 `sha256:454a9b7b092faffd480b5e4c8380553279fe5d7102e9ca4b44cf9d599cd282d8`。

同一个 contract identity 同时出现在以下位置：

- Supabase migration `20261122041012_edupi_mobile_contract_registry.sql`
- `supabase/functions/edupi-core-broker/index.ts`
- `ios/EduPi/EduPiRemoteAPI.swift`
- `supabase/contract-alignment.test.mjs`

iOS 收到新的 `contract_id`、`contract_version` 或 `schema_hash` 时会拒绝解析结果并显示服务响应无效，避免桌面端或云端字段变化后静默显示错误内容。

## 桌面接口与手机版状态

| 能力 | 桌面端 | 云端函数 | 手机版 |
| --- | --- | --- | --- |
| Supabase Auth 与 workspace | `/api/edupi/cloud` | `edupi-account`、Supabase Auth | 已接入；本地账号服务独立 |
| 首页 snapshot | Core `education_workspace` | `mobile-dashboard` | 已接入 |
| 学生只读名单 | Core students | `edupi-classroom` roster | 首页回退已接入 |
| 任务读取 | Core education projection | `mobile-dashboard` | 已接入 |
| 校历与课表读取 | Core calendar sources | `mobile-dashboard` | 已接入 |
| 任务创建与移动 | Core command | `edupi-core-broker` command | 已接入持久队列及回读 |
| 事实 capture/审核/删除/恢复 | Core education facts | `edupi-core-broker` education-facts | 未接入 |
| 事实脊柱 | Core fact spine | `edupi-core-broker` education-facts | 未接入 |
| 材料元信息与上传 | Core material APIs | `edupi-core-broker`、`edupi-materials` | Desktop cloud 已接入；手机版未接入 |
| 学生档案与版本 | `/api/edupi/students/*` | `edupi-students` | 同一 ID/版本合同；实体设备待验 |
| 对象软删除、恢复 | `/api/edupi/entities/*` | `edupi-entities` | Desktop cloud 已接入；手机版暂无回收站 UI |
| 班级方案写入 | `/api/edupi/classroom`，固定 Core 纯引擎 | `edupi-classroom` 独立核验与准入 | Desktop 已接入；手机版只读名单 |
| 学生事件修改 | `/api/edupi/student-events` | `edupi-student-events` | Desktop 已接持久 outbox；手机版未接入 |
| Pi session、聊天、SSE | `/api/agent/*`、`/api/sessions/*` cloud adapter | `edupi-sessions`，cursor 续读 | iOS 已接同一文字会话及事件合同 |
| Core Runtime lease | Desktop cloud chat worker | `edupi-core-runtime` | iOS 显示执行状态，不自行领取租约 |

桌面 cloud 模式通过 `/api/edupi/cloud` 管理登录、刷新、退出、workspace 和状态；`GET /api/edupi/workspace`、`GET /api/edupi/education` 在 cloud 模式下读取同一 broker dashboard，local 模式仍走本地 Core。

上表的 `/api/edupi/account` 是本地宿主账号服务，与 Supabase Auth 概念分离。云端普通任务通过独立 `edupi-cloud-writer-v1` 适配器发送：已部署 cloud writer 固定 Core `3ce22b1e…`、bridge schema `2749b120…`；本地 Core 仍固定 `fc89b3bc…`、schema `4d406ea0…`。不修改历史 migration 或本地 pin 来掩盖两者差异。

cloud 中未接入的本地写入会被拒绝，不能把云端对象 ID 交给本地 writer。班级计算仅调用固定 Core 纯引擎，并在隔离子进程中限制文件权限；云端再以同一引擎核对结果、当前学生 revision 和方案 revision 后原子保存，值日发布会真实创建关联任务。

新 `contracts/edupi-cloud-sync-v1.json` 独立于既有 dashboard/writer 合同；identity 同时固定在 Edge helper、SQL registry、Desktop 和 iOS，未知版本或 hash 明确拒绝。macOS 打包仅注入 public URL/anon key 到生成的 `edupi-cloud-public.json`；GitHub Actions 使用 `EDUPI_SUPABASE_ANON_KEY`，service role 始终留在服务器。默认 local 不因打包云配置改变。

## 以后桌面端更新接口的流程

1. 先修改本地 Core 或 producer contract。
2. 更新 `contracts/` 下对应合同的 version、schema hash；不改变已发布字段的语义。
3. 新增 Supabase migration 或 registry；不重写已部署 migration。
4. 更新 `edupi-core-broker` 的请求与响应。
5. 更新 Desktop 请求/响应类型、错误处理、scope、outbox 与重读验证。
6. 更新 `ios/EduPi/EduPiRemoteAPI.swift` 和对应 Codable decoder；保留未知 identity 拒绝解析。
7. 更新合同与行为回归测试。
8. 运行 `npm run test:supabase-contract`。
9. 对受影响 Edge Function 运行 `deno check`。
10. 运行 Desktop typecheck 和 lint。
11. 在隔离 workspace 运行 `scripts/test-edupi-supabase-remote.sh` 和 `scripts/test-edupi-desktop-cloud-sync.mjs`。
12. iOS 合同或配置受影响时运行现有 `xcodebuild`。
13. 只有真实远程写入、写后重读和目标客户端读取均通过，才能声称相应接口同步完成；安装、升级、发布单独验收。

桌面端新增接口不会自动出现在手机版。它必须经过上述 contract、Edge Function、iOS decoder 和远程验收链路，才能进入手机版。
