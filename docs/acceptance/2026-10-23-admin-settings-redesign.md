# 管理中心与设置重做验收

## 2026-10-24 真实连接续验

本节取代下方首版本机预览的当前状态：用户要求的 JEV 连接修复与一个 OpenConnector 服务的实际授权、调用已在本机安装版通过；R23 通用外部执行、其他服务和跨平台不因此完成。

- 安装源码 `468f82e8c99414ed7ebb6df1773cb71b3d1b6d3e`，固定 Core `03bbb893bb609eb68513a65cf4fd808ab8aa30ed`，版本仍为本地预览 `0.3.77`。完整 `desktop:prepare` 通过；复用未改动的原生壳，替换本轮生成的 server/OpenConnector 资源，6 个原生资源及整 App 重新 Developer ID 签名。Team `BY3XZG2839`、CDHash `45d22da015f6c806028a1c9388c01ac34263cd90`，主程序 SHA-256 `0b532d475cfede13ee601d7022c532e74b97061e02b9ba63abc44ebc8f4d54e1`。唯一安装路径 `/Applications/EduPi.app`；未公证、未公开发布或修改 feed。
- JEV 451 已定位：同一密钥的 Python 默认 macOS 网络请求返回有效模型/选择结果；Node 直连的响应明确为 `Typesafe is not available in your region.`。系统已有本机 HTTP 代理 `127.0.0.1:7897`，Node 原来只读取代理环境变量，没有使用该系统设置。读取既有系统代理并传入 Undici 后，源码真实请求返回 200；已安装 App 的“AI 与模型 → 浏览器决策 → 测试连接”显示 **连接成功 · 1198ms**。未更改系统代理、节点、DNS、密钥或 JEV 配置。
- OpenConnector 已连接本机 GitHub 登录 `PIGU-PPPgu`。应用内先显示账号和读取范围；第一次进入确认页后取消，实际回执数仍为 0。再次确认 `github.get_current_user`、输入 `{}` 后真实调用成功，显示账号 ID `59789742`、公开仓库 `42`，执行 ID `cc322af0-dec0-4452-bb71-b21f4315249e`，并显示“审计已保存并核对”。调用经过固定上游 1.6.5 的连接 API、Action API 和按 executionId 的审计回读。
- 正常退出并通过 Launch Services 真正重启，原生 App PID `84597 → 93715`；同一账号、连接 ID、第一份回执和执行 ID 均在页面重新打开，回执数保持 1，无启动自动重发。重启后再次明确确认读取成功，第二份执行 ID `38c800ce-2b83-4992-bfc6-a499f5e4894e`，总回执数为 2。
- 这是管理页固定只读验证：只允许读取当前 GitHub 账号，其他 Action 和通用代理保持阻断；生产 Agent 的旧执行门未打开。凭据从本机已有 GitHub CLI 登录取回，经 stdin 进入一次性加密 runtime，结束删除临时数据库；长期仅存账号、凭据指纹及脱敏回执。实际状态目录权限 0700、回执 0600。规格见 [R23 管理页验证边界](../architecture/R23-external-action-authority-spec.md#管理页-github-只读验证)。
- 最终源码 TypeScript、完整 lint、diff 检查和 528 项组件/定向测试通过，0 失败、0 跳过；独立只读复核通过。覆盖真实上游 runtime 的隔离认证/Action/审计、写入阻断、加密无明文、请求去重、凭据轮换拒绝、unknown 恢复和代理生命周期。签名包启动/Core、目录/inspect/旧执行阻断通过，原生操作后 strict codesign 再次通过。
- 正常资料的 Core/投影/Kernel 重启后 ready，51 学生、160 任务、24 校历、6 课表保持。317 个保护文件无增删；模型、认证、JEV、GitHub CLI 与 UI 配置逐字节保持。Runtime 元数据随启动更新，原会话追加 1062 字节、4 条 custom，原前缀摘要保持。首次严格文件比较发现提醒文件增加 18 字节，已确认仅是既有到期提醒在正常轮询时补入 `withdrawn:false`；只在内存去除该字段后，整文件 SHA-256 精确匹配本轮基线。没有修改教师业务记录来消除差异。
- 清理本轮 8 个生成目录：Desktop/Core 重装依赖、`.next-desktop`、生成的 server/helper/Core/OpenConnector 资源和上一份 `.77` 临时预览。删除目录占用约 4.51 GiB，观测可用空间增加约 4.60 GiB；保留已安装新版、一份原 `.70` 回退 App、源码、原始备份与验收记录。安装资源无外部依赖符号链接。
- 本次未验：GitHub OAuth、新密钥录入、其他服务和写入 Action、真实凭据轮换/网络中断，以及 Windows/Linux。本地用量授权、系统通知、手机继续沿用原未验状态；JEV 直连仍受上游地区限制，当前成功路径使用用户已有系统代理。

私有证据根沿用 `~/edupi-install-checkpoints/settings-redesign-20261023/evidence/`：`jev-451-diagnosis-live.json`、`jev-451-node-diagnosis.json`、`jev-system-proxy-source-live.json`、`jev-installed-native-success.json`、`github-installed-connected-cancelled.json`、`github-installed-after-execute.json`、`github-installed-after-restart.json`、`github-installed-after-restart-read.json`、`connection-followup-protection-final.json`、`connection-followup-reminder-normalization-proof.json`、`installed-connection-preview.json` 和 `connection-followup-cleanup.json`。原生 AX/截图操作记录在本聊天。

## 2026-10-23 首版预览历史

- 2026-10-23 当前状态：新版已安装并运行于唯一 `/Applications/EduPi.app`，已切回教师正常资料。R14 本次管理/设置页面、R23 的配置保存与只读目录交互已通过本机原生验收；JEV 真服务连接仍为外部阻塞，不能计为连接通过。R14/R23 的其他路线图欠项不因此完成。
- 当轮源码 `f3c09cd653245f26013c59f1cddf6c4e3538c2bb`，分支 `codex/settings-admin-redesign`；初版实现 `b86569fb` 和字段上限修复 `19ac62f8` 保留历史。固定 Core `03bbb893bb609eb68513a65cf4fd808ab8aa30ed`，版本 `0.3.77`。
- 本地 Developer ID 签名预览，Team `BY3XZG2839`，CDHash `4f2bc0e81b5f3f97d601dc842a0e056b7b0c59ea`，主程序 SHA-256 `687d3f5e5af805d17f6b5bfc65977a81005b48674b7d73a58dc9f1e77cc9c5b7`。保留原 updater 公钥；未公证、未合并、未公开发布或更新 feed。
- 私有证据与回退副本在 `~/edupi-install-checkpoints/settings-redesign-20261023/`。隔离验收根 `~/edupi-route1-canary-settings-20261023` 仅复制 JEV 自身配置/凭据；正式资料下没有提交合成教师或学生记录，也没有调用对话模型。

## 本机安装操作

| 操作 | 预期 | 实际结果与证据 |
| --- | --- | --- |
| 本地构建、嵌套资源签名、替换唯一安装路径 | 新 UI 与固定 Core 同包，保留旧 App 和更新公钥 | 完整 Next/13309 文件 Core 打包、两轮包内服务/目录检查、原生 arm64 编译和 strict codesign 均通过。最终签名包实际安装；`evidence/installed-final-preview.json`、`final-app-runtime.log`、`final-app-openconnector.log`。 |
| 原生设置中的明暗、语言、天数、更新、教师资料取消与权限读取 | 可操作、可返回、设置真正持久化 | 深色/5 天保存后真正退出重启，页面回读深色/5；恢复浅色/3 天、中文。更新检查有忙碌/完成态；教师信息“编辑 → 手动填写 → 取消 → 关闭”正常；权限重新读取显示当前应用已授权，未新增权限或开放手机网络。原生截图/AX 操作记录在本聊天。 |
| 原生 AI 与模型中的 JEV 保存与重启回读 | 只更新配置，密钥不显示；保存值跨进程保持 | 超时 3000→4000 保存并在真实重启后回读 4000，再恢复 3000；密钥始终为占位提示，原 auth/JEV 配置摘要不变。`isolated-after-jev-save.json`、`isolated-after-restart.json`、`final-isolated-state.json`。 |
| JEV 真服务测试、超时与重试 | 明确区分配置与连接状态，失败后可以重试 | 上游实际返回 HTTP 451；最终包首次 3000ms 测试超时，随后单次重试显示“JEV 服务返回 HTTP 451，请联系服务提供方”。连接未通过。修复测试期限未读取保存配置和错误原因过泛；真实 loopback 的 451/100ms 超时回归先红后绿，未记录上游正文或密钥。`jev-upstream-status.json`、`jev-route-regression-before.log`、`jev-route-regression-after.log`。 |
| 连接 → OpenConnector → npm → 操作搜索 → 参数 → 返回 | 不弹独立窗口，目录与参数真实可用 | 最终安装包在页内显示 1554 服务；搜索 npm 得 1 服务，读取 8 操作，搜索 get_package、打开 npm.get_package，显示必填 packageName，再返回列表。正常资料下也实际读到同一目录。没有运行账号写入或 Action。 |
| 正常资料升级、受控恢复与重启 | 教师业务与模型配置保留，正常 Core 就绪 | 首次正常启动遇旧目录绑定不符；只读检查确认 APFS 合法、两库旧指纹一致且恢复状态 stale。经应用内“修复 Core Runtime”事务备份并重绑后，Core/投影/Kernel ready；再次真正重启仍 ready，51 学生/160 任务/24 校历/6 课表、17 个模型与默认模型保持。`normal-root-diagnostic.json`、`runtime-table-repair-comparison.json`、`final-normal-restart.json`、`normal-model-status.json`。 |

## 数据保护

- 正常启动前保留完整旧 0.3.70 App、教师 `.edupi`、六份配置和 WebKit 备份。隔离验收后的 310 个保护文件逐项完全一致。
- 正常恢复后业务文件、模型/认证/JEV 文件、原 UI 偏好均保持；Runtime 变化为两库指纹与进程元数据，表级比较仅 `authority`、`runtime_meta`、`admission_meta` 变化，原表行数保持，并新增自动修复备份及 SQLite 工作文件。
- 原会话追加 1062 字节、4 条 `custom` 事件，原字节前缀 SHA 保持；未将整个根宣称为未变化。完整记录为 `evidence/final-data-protection-proof.json`。

## 开发页历史操作

| 操作 | 预期 | 实际结果 |
| --- | --- | --- |
| 从隔离工作区的“打开管理中心”进入，切换概览、工作与资源、AI 与模型、连接、设置、系统 | 同一导航内完成管理与设置；概览含自动运行；各页可返回 | 七个入口同处管理工作区；概览内显示准备状态和自动运行；资源改为分行列表；系统页只呈现运行健康与兼容性。隔离 Core 的 `/api/edupi/workspace` 返回 503，故未把真实运行数据记为通过。 |
| 在 AI 与模型切换“对话模型”与“浏览器决策”，临时改写 JEV URL 再切回 | JEV 与对话模型同页；未保存草稿不丢 | JEV 表单在类别切换后仍保留临时 URL；测试结束已恢复原输入，未提交设置。API Key 仍只通过服务端接口保存。 |
| 打开连接页的 OpenConnector | 直接在本页展示，只读目录且不再自动启动原生弹窗 | 管理导航直接渲染目录组件；非 Tauri 开发浏览器显示“仅桌面应用可查询”的紧凑状态，没有新窗口。桌面目录查询、操作搜索与参数查看需安装版复验。 |
| 查看设置页和 800×900、520×800 窗口 | 更新、偏好与设备设置在同一管理页；无横向裁切 | 设置页显示版本检查、语言、外观、教师信息和前台收起；非桌面环境隐藏空的设备分组。800 与 520 视口的 `body.scrollWidth`、`documentElement.scrollWidth` 均等于视口宽度。520 像素下 AI/JEV 与连接页均可操作，返回按钮保留可访问名称。 |

## 检查与边界

- 最终源码 `tsc --noEmit`、`npm run lint`、`git diff --check` 通过；组件、JEV route/provider/settings 合计 484 项通过、0 失败、0 跳过。两项新增连接错误/超时回归先失败后通过。初版的 460/29 项记录是历史结果，不替代原生操作。
- 最终包的嵌套资源签名、strict codesign、包内 Core/投影 ready、OpenConnector provider/search/inspect 与执行阻断均通过。原生操作后再次 strict codesign 通过。
- 早期开发页的 Core 503 保留为历史失败；固定完整 Core 资源后，包内与真实资料的运行证据以上方记录为准。
- 未验证 JEV 真服务成功响应、OpenConnector 账号/OAuth/Action、系统通知点击、手机第二设备、Windows/Linux 原生界面；本地预览没有 Apple 公证或公开升级发布证明。
- 最后显示动作的锁屏阻塞已解除：用户回复“已解锁”后，CUA 重新绑定唯一安装 App，原生 AX 回读确认设置页为 0.3.77、浅色、中文、3 天及正常资料目录；执行窗口 `Raise` 后截图成功，设置页已显示。此前 `IOConsoleLocked=Yes` / `cgWindowNotFound` 保留为历史限制，不再是当前阻塞；`evidence/final-display-state.json` 记录最终状态。
- 最后原生回读的“本地用量”显示“未收集 / 教师授权尚未就绪”；本次没有将用量授权或采集流程计为通过。

## 生成产物

- 初版开发页的 `.next/`、重复依赖与 `/tmp/edupi-settings-ui.pUeiUj/` 已在上一轮清理，约 2.1 GiB；本轮新的精确清理结果记录于 `evidence/cleanup-products.json`。
- 本轮已删除 `.next-desktop/`、`src-tauri/target/`，资源目录中的 `server/`、`Pi Agent Server.app/`、`edupi-core/`、`open-connector/`，Desktop/Core 两处重复依赖、任务 Cargo 缓存、第一预览 App 与隔离资料/状态。15 个生成目录及一个签名探针已回查不存在；另将两份旧 App 合并为一个回退副本。合计目录占用约 8.21 GiB，实测可用空间增加 7.40 GiB；两个源码工作树保持，原 Core 脏工作树未改动。
- 保留已安装新版、一个旧版回退 App 和本任务私有数据/偏好备份，供本机预览确认后回退使用；不删除其他任务、真实资料、原 Core 脏工作树或废纸篓。
