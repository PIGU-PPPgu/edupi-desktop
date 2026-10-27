# 管理中心与设置重做验收

2026-10-27 当前安装为本地预览 `cb6aa7be`，Core03 保持。原生已验证新布局、完整 Tab 往返、恢复确认取消与保存、暂缓、双击仅一次写入及两种表单取消清错；名单 28 人及历史在正常 Quit 后冷启保留。完整子功能验收仍为**部分完成**。实机新发现的恢复确认／表单焦点丢失已补源码，33 项针对检查通过，待下一本机包验收。当前仍在隔离资料，结束前恢复原教师目录。

当前范围更正：用户于2026-10-27明确“逐页”包括每页全部子页与子功能。下方上轮记录只证明主要页面和列出的代表性分支，不能作为完整子功能验收。R18本轮恢复为**部分完成，完整子功能逐项验收中**。正在沿同一任务盘点入口、准备隔离测试资料并在唯一安装版操作；新增结果按实际动作记录，不用源码清单或旧测试总数代替。私有动作清单与证据根为`$CHECKPOINT/subfeature-audit-20261027/`，原教师数据目录在验收结束前必须通过应用切回并回读。

上轮 **2026-10-26 逐页面组件与交互优化** 已于10月27日凌晨完成本机UI子项验收，唯一App为`4e75ad52`。名单、非空日期草稿、任务单击与Enter、分类往返、日程视图、表格横滚、空态均已实际操作；末尾周文字排布和窄窗抽屉滚动修正也已复验。正常Quit至进程0后冷启动PID65907→93586，默认模型、偏好和投影51/160/24/6保持，日程已置前台。工具曾能读窗口但输入无响应，已由代理通过访达正常打开恢复，无需用户接手。源码、数据保护和清理以下方最新记录为准。

上一轮 **2026-10-26 主导航与全应用折叠重做** 已完成本机安装与交互验收，当时UI为`cafce3a4`。二级栏收起不留细线，主导航和共享折叠样式已更新，自适应居中保持。下方历轮版本是历史证据，用户观感仍由用户判断。既有Runtime/用量记录校验异常单列，不称应用全功能健康。

## 2026-10-27 全部子页与子功能验收

沿用 R18，状态为**部分完成**。本轮按用户纠正扩大到每个可达子页、菜单、表单、历史、恢复和条件分支；此前主页面及代表性分支的通过记录不覆盖本轮欠项。安装版仍为 UI `4e75ad52`、Core `03bbb893`，未新构建或发布。

私有证据目录：`$CHECKPOINT/subfeature-audit-20261027/`。`settings-inventory.json`、`workflow-inventory.json`、`data-chat-inventory.json` 是源码入口清单，默认未操作；重复入口及数据实例不能充作独立通过项。`native-action-results.json` 只记录实际原生动作及其剩余条件，合成资料准备不计作界面验收。

| 子功能 | 实际结果与证据 | 仍待验收 |
| --- | --- | --- |
| 数据目录选择器取消 | 原生打开和取消；`ui-prefs` 与本轮备份逐字节相同。`S-data-picker-open/cancel` | 目录选项其他动作 |
| 切换隔离数据目录 | 原生 Go To Folder、Open 后应用重启；`isolated-health-start.json` 证实 Core/投影就绪且四类业务计数为 0 | 本轮结束前恢复原教师目录，原生重启与回读 |
| 教师资料五字段取消 | 称呼、身份、学科、年级、班级均填入测试值后取消，当前资料仍空。`CTX-manual-five-fields-cancel-before`、`CTX-manual-cancel-after` | 修改与起草两类表单的取消 |
| 教师资料手动保存 | 原生终态“已保存”，独立 GET 再读到相同值。`CTX-manual-save-terminal`、`CTX-manual-save-api-reread.json` | 字段/操作历史、各值恢复、候选审核、离开重进与冷启回读 |
| 其余子功能 | 清单已展开，未完成原生操作 | 逐项执行；不以上轮总测试数替代 |

真实教师数据使用本轮新基线保护：`protected-before.json` 共 314 个文件；`teacher-business-backup.json` 记录 156 个业务文件备份与逐项摘要核对。测试仅进入隔离 `UI-Test-Data`，不向真实学生档案写入虚构记录。全局模型、授权及 GitHub 原测试 issue 不随此轮扩展测试改动。

窗口访问曾受 `cgWindowNotFound` 阻塞，随后在恢复原目录并启动时恢复，原生点击已继续；用户也已回复保持解锁。期间只准备资料，不计作界面通过。两次隔离实例为准备资料而终止，均不计正常 Quit。

- 原教师 Runtime 的旧根身份与当前目录身份不一致。调用与安装版 `4e75ad52` 字节一致的正式 `repairEduPiRuntimeState` 前，核对停机、无 writer/句柄、两库 schema 与 6 条完成事件；函数生成两份 600 SQLite 备份后事务恢复根绑定。修复后 6 条事件全行摘要保持、intent 清空，正常 App 冷启的 Core/投影均 ready，原投影仍 51 学生、6 课表、24 校历、160 任务；原生数据页已重新读取。用量随后显示“教师授权尚未就绪”，与此前“记录校验失败”分开，不称用量全流程通过。未手写 SQL 或绕过桌面 token。见 `original-root-readonly-diagnosis.json`、`original-runtime-repair.json`、`original-after-repair-status.json`、`S-data-original-after-formal-repair`。
- 教师五字段的原值与改后值共 10 次恢复均实际操作，独立读取 11 个版本；当前值恢复一致。手动空值校验、Esc 取消、快捷键保存后重进、起草空值校验和取消、外层关闭/Esc/背景关闭均操作。快捷键保存曾出现整个弹层缺席，原因无结论，另列待复测；不靠推测改代码。
- 实机发现历史长列表把主动作推到底部、恢复值像输入框；源码调整为正常留白的版本分隔行，把动作和表单置于历史之前。pending/held 恢复会替换待确认更新，已加特定原生确认，普通 accepted 直接恢复；三个 Cancel 清掉残留校验错误。独立复核发现历史移到末尾后 Tab 被旧焦点规则提前回环，两处 summary 已显式 `tabIndex=0` 修复。22 项定向测试通过，最终类型与定向 lint 通过；完整 lint 已通过，之后仅增加两处 tabIndex 和状态列分支并定向复核。已生效资料改为两列，拒绝提案标为“已拒绝更新”。安装后的原生确认/取消、Tab/Shift+Tab仍待验。
- 名单导入实际走过 XLSX 三工作表、1/4/6 行表头、四字段映射、姓名必选/重复列错误及 27 条三页预览；两个取消入口均验证无写入。XLSX 导入后共 28 名合成学生，CSV 同名单重导后仍 28，ID 及 profile revision 保持；跨班同名各有不同 ID。两页名单与三个班级筛选均操作。见 `STU-*` 和 `native-action-results.json`；详情 CRUD、导出、重启回读等子功能尚未完成。

原目录偏好曾以单键原子回退恢复并核对其他键保持；继续原生验收时又通过应用选择器切回 `UI-Test-Data`，当前仍在隔离目录。`active-state.json` 记录恢复义务，结束前须切回原教师目录。两个运行库备份为本次正式修复回退保留，完整验收稳定后再评估清理；测试资料和动作账本保留用于续验。

### cb6aa7be 安装后的原生子功能证据

- `context-installed.json`：本地 0.3.77、二进制 `0ca23f46...`、CDHash `78efd9e4...`、Team `BY3XZG2839`，7 个 server 原生资源重签；33,709 个非 server 文件摘要、GitHub 宿主和原更新公钥保持。`desktop:prepare`、类型、完整 lint 及 22 项初批针对检查通过；未公证、公开发布、合并或改 feed。
- 原生菜单 Quit 后原 PID 94448/94460/94473 全部退出，再安装冷启；`context-installed-cold-status.json` 的 Core/投影 ready，28 学生、0 课表、4 校历、8 任务。所选学生已恢复的档案历史 2 条保留，模型／认证／JEV／gh 五文件摘要保持。
- `CTX-new-native-tab-trace.json`：从标题依次 Tab 到手动填写、接受、修改、暂缓、拒绝、字段历史、操作历史、关闭；Shift+Tab 回操作历史，Enter 实际展开。
- `CTX-new-native-confirm-dialog`、`CTX-new-confirm-cancel-proof.json`：真实 Tauri 确认取消后候选仍 pending，字段版本／复核历史均 12，业务字段保持。取消后焦点落 HTML 的问题另记，未称焦点验收通过。
- `CTX-new-hold-proof.json`、`CTX-new-confirm-apply-proof.json`：实际暂缓后 held，复核历史 13；在 held 状态确认恢复班级后 accepted，字段版本 13、复核历史 14，其他生效字段保持。已生效面板实际仅两列，历史采用分隔列表与可恢复值。
- `CTX-native-double-click-action.json`、`CTX-native-double-click-proof.json`：原生 `clickCount=2` 请求恢复班级，字段版本从 13 到 14，唯一版本 14，复核历史 15，班级回 `UI验收A班`，普通 accepted 路径没有确认窗。
- `CTX-new-manual-*`、`CTX-new-draft-*`：逐字段核对空值后触发校验，再取消；错误消失、弹层和原资料保持。键盘打开起草表单时焦点落 HTML，已保存真实证据并纳入下一补丁；修改表单及有效草稿转入隔离会话仍待操作。
- `STU-profile-focus-failure.json`：自动化未正确聚焦多行输入，误把测试备注写到合成学生的班级，三字段编辑不计通过。通过原生档案历史“恢复修改前”后，`STU-focus-failure-restored-proof.json` 证明原班级／特征／备注一致、另一班同名未变、总数 28、档案历史 2。失败记录保留，后续改为各字段回读后再保存。

本批后续源码仅调整教师上下文的焦点和反馈：取消／失败返回原恢复按钮，失败保留已加载历史；成功或收起历史时回标题并滚入视口；三种表单打开进入首个输入、取消／Esc／成功关闭回有效入口；默认反馈移除原始回执 ID，可信验证与回调保留。33 项针对性检查、类型与定向 lint 通过，独立只读复核未发现阻挡；这些不代替下一签名安装版的原生焦点与失败恢复验收。

## 2026-10-24 官方目录与连接恢复验收通过

本节取代下方正常 OAuth 与中途锁屏快照的当前状态。**本次 macOS 目录、真实手动续期、受控到期后的真实 SDK 自动续期、GitHub 路径离线/冷启动/恢复、同 ID 重新授权和原请求去重均验收通过。** 最终正常版 `fd007801` 已安装到唯一 `/Applications/EduPi.app`，验收专用环境键已移除，中继已停止；应用停在新版服务目录。未新增第二个测试 Issue。

### 目录与用途

- GitHub 是上一轮指定的授权/写入验收样例。日常目录现在先展示服务品牌与连接入口，测试 Issue、执行 ID 和续期操作收进“连接诊断”。
- 核对 [OpenConnector 原版图标插件](https://github.com/oomol-lab/open-connector/blob/c6f55b58f98bae95c14d0848eb612dfa09b80291/web/provider-icons-plugin.ts) 和官方目录后，补入固定 Logo/别名映射，仅合并本地已有的 1554 个能力。1549 个 Logo 符合官方 CDN 固定路径，88 个本地服务有官方别名，5 项字母兜底；这是元数据覆盖数，不是逐一加载全部图片。来源、过滤与商标边界见 [说明](../../lib/openconnector-provider-metadata.md)。
- 原生截图看到 GitHub、飞书、钉钉、企业微信、腾讯文档、WPS、Gmail、Google Drive/Docs/Sheets/Slides/Calendar、Outlook 等 Logo。中文搜索“飞书”3项、“钉钉”2项、“谷歌云盘”1项，沟通分类与搜索可叠加。打开 Feishu 同页详情后返回，搜索/分类/原按钮焦点保持；Enter打开、Shift+Tab到返回、Enter返回均实际通过。
- Workday的`WO`兜底可见；实机发现的单结果空灰格以 `auto-fill → auto-fit` 修复。最终正常版再次搜索 Workday，单项已自然铺满，没有余下灰格；最终目录默认不展开测试细节。

### 真实恢复流程

| 操作 | 预期 | 实际结果 |
| --- | --- | --- |
| 原生检查连接 → 刷新授权 | 真正使用已有 refresh token 向 GitHub 交换并验证账号 | 初始真实 expiry `2026-10-24T19:24:37.839Z`；手动刷新后 expiry `2026-10-24T23:15:00.964Z`、refreshedAt `15:15:00.964Z`，连接 ready。原账号 `59789742`、连接 `6ad11879-eac9-4678-8a81-c20f65f9c05d` 与业务 scope `public_repo` 保持；未输出令牌。 |
| 原生触发本地到期 → 切断 GitHub 路径 → 检查/读 Issue | SDK进入自动续期分支，真实网络失败保留事实 | 验收开关将本地 expiry提前至 `15:15:58.924Z`；专用CONNECT中继拒绝并关闭既有tunnel，检查与读回失败，页面显示“连接中断/重试连接”，原成功回执/issue/审计不降级。refreshedAt仍为手动那次，未冒称失败时续期成功。 |
| 离线点击验证去重 | 重放同一draftId，不再写入 | 返回相同receipt与写入ID；中继拒绝计数和已建立tunnel计数均不增加，成功create_issue审计仍1，dispatch仍1。 |
| 保持离线 → 正常Quit → 真正冷启动 → 打开目录和回执 | 离线也能读取已保存状态 | Quit后App/helper为0，主PID `97578 → 45149`；目录1554可读，同一授权、#379与成功回执可见。GET投影没有启动GitHub host，也没有新增网络尝试。 |
| 恢复中继 → 原生重试连接 | 原SDK根据本地到期时间真正自动刷新 | 新refreshedAt `2026-10-24T15:27:37.278Z`，expiry `23:27:37.278Z`，health恢复ready。使用真实GitHub刷新交换，不是模拟端点；这是受控本地到期，不是自然等待8小时。 |
| 已有回执时重新授权 → 回读 → 验证去重 | 同连接恢复，原写入事实不变 | 真实新OAuth request连接成功，连接ID/账号仍相同，scope仍public_repo；原receipt/draft保留。回读ID变为 `559c655a-e3ce-4517-ba24-bd4ba1594337`，写入ID仍 `f69373e7-d729-48d5-997d-9c34365824e1`，线上重放未增加写审计。 |
| 安装正常版 → 移除验收配置 → 停中继 → 再检查/回读/重放 | 成品不依赖测试代理或到期入口 | Info中两个验收环境键均无，原生“触发本地到期”按钮消失，中继PID43540和51327监听停止。停掉后实际检查ready，再读ID `5dbcad4f-68e3-42be-98d3-4be3e5cbe15b`；同回执/写入ID保留。独立远端核对、写审计和dispatch始终各1，只有原 [TEST #379](https://github.com/PIGU-PPPgu/edupi-desktop/issues/379)。 |

### 实现与检查

- GET只读本地持久状态，不用网络可用性决定能否展示历史回执。续期采用固定SDK `1.6.5` 官方内部service/store和CAS；新授权在SDK保存前核对固定账号及可信数字ID。没有恢复旧刷新令牌快照。
- 独立复核发现并修复了恢复GET无截止、429/503误判为凭据失效、错误账号先覆盖旧凭据。源代码批次 `887b68a0` 全套 **2526通过、40环境跳过、0失败**；类型、完整lint、差异检查通过。`fd007801`仅追加一行CSS修正，13项目录定向与最终原生布局复验通过，未据此冒称重跑一遍全套。
- 初始依赖审计2high/7moderate/6low失败保留；仅补既有Undici `8.12.2`、Nodemailer `10.1.4`、Zod锁版本 `4.6.7`，SDK保持1.6.5。补丁后high门通过，剩6项既有数学链低危。
- 断网仅作用于GitHub host，TLS透传，不记录请求头/正文；系统代理和其他应用网络未改。SDK错误账号/刷新响应异常等隔离回归不当作真人实服证据。
- 中途Mac锁屏导致桌面工具拒绝操作，之后实际AX访问恢复，再继续完成以上流程。`locked-resume-state.json`等false/待验快照保留为历史，最终结论以 `recovery-native-final-proof.json` 为准。

### 最终安装、保护和清理

- 唯一安装为本地0.3.77签名预览，源码 `fd007801038acfbe264f019ef16d1fd29df7044d`，Core `03bbb893bb609eb68513a65cf4fd808ab8aa30ed`。Team `BY3XZG2839`、CDHash `ee251e2a50819bd5ad313532e664efa0bffc35d8`，主程序SHA256 `345f533347c53fbbb375f3226518b5a61970c05144f00a77805fa8345599c08b`，host SHA256 `00bed1f04691b975d9fbc80740a95e3e8e19c433db7091c3905b39d47fcd47ef`。7个原生资源和整App重签，13326个Core/壳其余文件及原updater公钥保持；最终操作和清理后strict签名通过。未公证、合并或公开发布。
- Core/投影/Kernel ready，51学生/160任务/24校历/6课表，external_send=false。317保护文件无增删，教师记录、模型/认证/JEV/GitHub/UI配置保持。Runtime/提醒运行态单列；桥接日志追加1551字节、运行日志追加1106字节、原会话追加1593字节/6custom，原前缀均保持，没有回写用户文件消除差异。
- 删除本轮6个生成缓存/资源/依赖目录和2份临时旧App，合计目录占用约 **5.13GiB**，系统可用空间观测增约 **5.25GiB**；任务临时App副本为0，中继已退出。只保留已安装正常预览、原`.70`回退、源码、真实凭据/数据和证据；既有Core工作树/依赖未删除。
- 未验边界：自然等待完整8小时过期、首次POST已被接受但响应丢失的真实未知写恢复、真实错误账号/本地身份metadata损坏和其他平台。成功回执重放不等于首次未知写恢复；5个服务的字母兜底及未逐一加载全部1549张图片不伪报为全图标通过。R23通用Core grant/Receipt与受管浏览器欠项继续保留。

证据根 `~/edupi-install-checkpoints/settings-redesign-20261023/oauth-recovery-catalog-20261024/evidence/`：`recovery-native-final-proof.json`汇总断言；各阶段为`native-initial-check`、`native-manual-refresh`、`native-locally-expired`、`native-offline-before/after-replay`、`native-offline-cold-start`、`native-offline-ui-restored`、`native-online-auto-refresh`、`native-reauthorization-observed`、`native-online-after-replay`、`normal-after-relay-stop`、`normal-final-before/after-replay`的JSON；`normal-native-gates.json`、`relay-stopped.json`、`remote-normal-final.json`、`normal-installed-preview.json`、`recovery-final-data-protection.json`、`build-cleanup.json`、`validation-app-cleanup.json`。实机图片为`final-catalog-native.png`、`normal-workday-fit.png`、`native-offline-replay.png`与`native-offline-cold-receipt.png`。

## 2026-10-24 GitHub OAuth 写入与重启验收通过

本节取代下方首次安装的外部阻塞状态。用户已在 GitHub 注册 OAuth 客户端、生成并在真实应用保存凭据、完成授权；本机应用随后完成 **OAuth → 明确标记的测试 issue → 独立回读 → 真退出重启 → 同一回执保留 → 再次回读且无重复创建**。此管理页固定测试子项验收通过，R23 通用 Core grant/Receipt 和其他服务不因此完成。

### 真实故障与修复

- 浏览器实际返回的 loopback 回调包含 `code`、`state`、`iss=https://github.com/login/oauth`，旧宿主因未知 `iss` 参数显示“授权状态无效”。没有把授权码、state、Client Secret 或 token 写入证据。源码 `45abdc9ef920ea5a94fd321c4113f42a93310e25` 仅补上单一、精确匹配的 GitHub 发行方校验；错误/空/重复 issuer、未知参数、伪造 state 和重放继续在 token 交换前拒绝。`iss` 的校验依据 [RFC 9207](https://www.rfc-editor.org/rfc/rfc9207.html#section-2.4)，本次 GitHub 具体取值来自真实回调；无 issuer 的兼容路径仍受固定 GitHub endpoint、state 与 PKCE 保护。
- 新回归先以 `400 !== 303` 复现，再 7/7 通过、0 跳过；独立只读复核重跑同组 7/7 通过，源码和测试副本摘要一致，语法检查及 diff 检查通过。测试使用已安装 OpenConnector `1.6.5` 依赖闭包的隔离副本，没有安装重复依赖。未为这两份 `.mjs` 修改重跑全套/typecheck/lint；下方 2492/40 和 531 项结果属于 `ac693c14` 基线，不能当成本补丁全套结果。

### 本机实际操作

| 操作 | 预期 | 实际结果 |
| --- | --- | --- |
| 修复后从应用点击授权 GitHub | 真实 OAuth 连接，正确账号与 scope | 页面显示 `PIGU-PPPgu · OAuth 已授权`，账号 ID `59789742`，连接 `6ad11879-eac9-4678-8a81-c20f65f9c05d`，`authType:oauth2`，仅 `public_repo`。未使用已有 gh token 代替应用 OAuth。 |
| 应用创建预览 → 确认创建一次 | 固定仓库、明确 TEST 和唯一标记，实际写入后回读 | 创建 [测试 issue #379](https://github.com/PIGU-PPPgu/edupi-desktop/issues/379)，标题 `[EduPi OAuth TEST] 5c4c664a-b81d-41cc-830a-57c8809b689c`，正文仅为测试说明与 `edupi-openconnector-test:5c4c664a-b81d-41cc-830a-57c8809b689c`。应用显示“已创建并回读”，状态打开、创建者 `PIGU-PPPgu`，正文逐项核对。 |
| 读取写入与回读执行记录 | 两次独立 Action 与审计 | 写入 `f69373e7-d729-48d5-997d-9c34365824e1`，首次回读 `9c74b4ea-188a-4e0d-8c1a-e342b7b4d457`；`auditPersisted:true`、`readbackVerified:true`，原生界面显示“已保存并核对”。 |
| 正常退出并重新启动 App | 冷进程恢复同一 OAuth、issue 和回执，无启动重发 | 退出前无运行中的 Agent；正常 Quit 后 App 与 helper 进程为 0，通过原生应用入口重新启动，主进程 PID `13429 → 23413`。冷启动快照和重开的 GitHub 页面保留同一连接、回执、#379、写入 ID 与首次回读 ID，持久 dispatch 仍为 1。 |
| 重启后点击重新读取结果 | 实际 GET 回读，不能再 POST | 回读 ID 更新为 `d69e2c83-7b4e-4550-81a0-e6793911d67c`，写入 ID、issue、回执 ID 和正文保持，审计再次核对。独立只读 GitHub 列表在重启前后均仅有一个本次标记/TEST issue #379；没有重复创建。独立 gh 检查只用于远端核对，不代替应用调用。 |

### 安装、资料与清理

- 唯一 `/Applications/EduPi.app` 仍为本地 `0.3.77` Developer ID 预览。只替换 `open-connector/github-host.mjs` 并重签，server 基线 `ac693c14`、Core03 和其余 **53,588 个文件**内容摘要一致；没有重复构建 Next 或 Rust。Team `BY3XZG2839`，CDHash `579b10bfb551b2b5590bf696ad4f4b1262de31d6`，主程序 SHA-256 `e90925c4cac191eb2d76fe6f3d3adb59061670ffa2894745ef61d11140db73ed`，宿主 SHA-256 `68f245c67faa7cf6efa3b91fda8120f6d618157a64ca253badeba75cd6574425`。安装与原生操作后 strict codesign 通过，原更新公钥保持；未公证、合并或公开发布。
- 重启后实际回读 Core/投影/Kernel ready，正常资料 51 学生、160 任务、24 校历、6 课表，Core `03bbb893bb609eb68513a65cf4fd808ab8aa30ed`，`externalSend:false`。317 个保护文件无增删，教师记录和模型/认证/JEV/GitHub/UI 配置逐字节保持；Runtime 元数据及提醒运行状态文件的变化单列，没有把整棵资料目录记为不变。原会话仅追加 1062 字节、4 条 custom，原前缀摘要保持。新 OAuth 状态在原独立私有目录，Keychain、加密凭据和回执保留。
- 实服验收通过后已删除 `EduPi-before-oauth.app`、`EduPi-before-issuer-fix.app` 和 `issuer-fix-test/` 三个任务生成目录；删除前核对精确路径、两份旧主程序摘要、无进程使用及测试依赖链接目标。删除占用约 **1.81 GiB**，观测可用空间增加约 **1.85 GiB**；本轮临时 App 副本为 0。保留已安装新版、原 `.70` 回退、源码、原数据备份、Keychain、真实 OAuth 回执及证据。
- 本次所要求的 macOS OAuth/写入/回读/真重启/无重复流程已验证。长期 token 到期续期、真实凭据轮换、断网/响应丢失的实服恢复和其他平台未验；隔离测试覆盖不能替代这些实服条件。测试 issue 按用户要求保持公开、打开、明确标记，没有附加关闭或删除操作。

证据沿用本轮私有 `oauth-issue-20261024/evidence/`：`issuer-failure-diagnosis.json`、`issuer-regression-before.log`、`issuer-regression-after.log`、`issuer-installed-preview.json`、`oauth-live-connected.json`、`test-issue-preview.json`、`issue-write-receipt.json`、`receipt-before-restart.json`、`receipt-native-quit.json`、`receipt-cold-start.json`、`receipt-after-restart-read.json`、`remote-before-restart.json`、`remote-after-restart.json`、`oauth-issue-native-acceptance.json`、`issue-after-restart-native.png`、`issuer-data-protection.json` 和 `issuer-cleanup.json`。此前无客户端、无效 issuer 和其他失败记录保留，不计为通过。

## 2026-10-24 OAuth 与测试 Issue 初次安装历史

本节为 `ac693c14` 初装时的历史快照，当前验收以上方 `45abdc9e` 实服结果为准。当时 GitHub OAuth → 明确标记的测试 issue → 应用内结果回读已实现并安装，但客户端和授权缺失，真实流程外部阻塞，尚无连接、草稿、回执或 issue。前轮通过已有 GitHub CLI 登录读取账号的证据不算 OAuth 验收；后续没有据此补称实服通过。

### 已安装代码与边界

- 安装源码 `ac693c14bb80969a0c7d02e63b106ee693a32e9a`，含安全补丁 `ef1a4e3a`；固定 Core `03bbb893bb609eb68513a65cf4fd808ab8aa30ed`。唯一 `/Applications/EduPi.app` 为本机 `0.3.77` Developer ID 预览，复用未变原生壳并替换 server/OpenConnector 资源，6 个原生资源与整 App 重签。Team `BY3XZG2839`，CDHash `8fadb3c3fa8243ac7d0d2914325ba8457bbdf1a4`，主程序 SHA-256 `7247ff850cd8c27e28ecfa02ea4f084d4d804a83d09363648641d3f5f7639a16`。未公证、合并、公开发布或修改 feed。
- GitHub 使用官方 OpenConnector `1.6.5` 的授权码流程，包含 S256 PKCE、state 和仅 loopback 的回调。只请求 `public_repo`；该 scope 是 GitHub 公开仓库读写权限，不能描述为仅 issue 权限。宿主将实际操作进一步固定为公开仓库 `PIGU-PPPgu/edupi-desktop` 的唯一测试 issue，标题为 `[EduPi OAuth TEST] <requestId>`，正文包含 `edupi-openconnector-test:<requestId>`；预览后的确认只提交 draftId，不能替换仓库或内容。
- Client Secret 和 OAuth token 经官方 runtime 的 AES-GCM 密文字段存储；加密钥匙保存在 macOS Keychain，经私有 stdin 进入宿主，不返回 WebView、日志或模型。未将整个 SQLite 文件称为加密数据库。长期状态仅保存公开账号、授权状态和脱敏回执，目录 0700、状态文件 0600。
- 写入前保存 pending 回执并持久化独占 dispatch 标记；未知结果只按标记查询恢复，不重发 POST。创建后独立调用 `github.get_issue`，核对仓库、编号、标题、正文、作者、标记和两次执行的审计。此处是管理页手动测试边界；生产 Agent 的旧执行入口和 Core `external_send:false` 保持，R23 通用 Core grant/Receipt 尚未完成。

### 本轮实际检查

| 操作 | 预期 | 实际结果 |
| --- | --- | --- |
| 真实安装 App 打开连接 → OpenConnector → GitHub | 展示 OAuth 客户端配置，初始化真实 Keychain 与宿主 | 原生页面实际显示 Client ID、保密 Client Secret 字段和 loopback 回调；Keychain 初始化成功。只诊断固定条目元数据，未读取或输出钥匙值。当前 `clientConfigured:false`、OAuth 未授权。 |
| 已安装宿主的 HTTP 边界 | 伪造 OAuth 回调与直接 HTTP Action 被拒绝 | 伪造 state/code 返回 400，Action 路径返回 404；无 query 的静态完成页为 200，属于预期落地页，不是授权成功证据。 |
| 真实 OAuth、测试 issue 创建与回读 | 原生授权后确认一次，产生真实 issue 与可重新读取回执 | **外部阻塞**：GitHub 个人 OAuth Apps 页面未有可用客户端，应用未配置 Client ID/Secret；已交接用户生成/填写新凭据并确认 `public_repo`。没有借用旧 gh token 冒充 OAuth，没有实际 issue URL/编号或写入执行 ID。 |
| 源码与依赖检查 | 受影响行为与安全补丁通过检查 | `npm test` 为 2492 通过、40 环境跳过、0 失败；本功能及组件定向 531 通过、0 跳过、0 失败；`tsc --noEmit`、完整 lint、diff 检查通过。独立复核 23/23，manager 7/7；另验取消 token 交换不存连接、48 小时重启同请求仅一次 POST。这些使用隔离数据，不代替真实 GitHub 验收。 |
| 准备资源、签名与清理后启动 | 已安装 App 自包含，正常资料可继续使用 | 完整 `desktop:prepare`、包内启动/Core、目录/inspect/旧执行阻断通过；安装与清理后 `codesign --verify --deep --strict --verbose=2 /Applications/EduPi.app` 均通过。清理后实际 API 回读 Core/投影/Kernel ready，51 学生、160 任务、24 校历、6 课表。 |

### 安全、数据和清理

- Next `16.4.3`、DOMPurify `3.4.17`、Hono `4.13.13`、ip-address `10.7.4` 消除本轮发现的严重/中危依赖公告；最终 `npm audit --audit-level=high` 通过，仍有 6 条既有数学渲染链低危公告。eslint-config-next 保留原 `16.3.8`，其 react-hooks 精确固定原 `7.0.1`；尝试升级导致的 18 条既有模块 lint 失败保留日志，没有关闭规则。
- 317 个保护文件无增删，模型、认证、JEV、GitHub CLI 和 UI 配置逐字节保持，教师记录文件保持。Runtime 元数据随启动更新；一个原会话追加 531 字节、2 条 custom，原前缀摘要保持。提醒运行状态文件从 430776 变为 430674 字节；记录到旧 App 在安装前的正常 notification_claimed/deferred 活动，已单列变化，不把整棵 `.edupi` 记为字节未变，也未回写真实提醒来消除差异。
- 已精确删除 7 个可重建目录：Desktop/Core 两处本轮依赖、`.next-desktop`、生成的 server、Pi Agent Server、Core 和 OpenConnector 资源。删除目录占用约 3.60 GiB，观测可用空间增加约 3.70 GiB；安装资源无外部依赖符号链接，已安装 App、源码、Keychain 与 OAuth 状态保留。
- 当时保留临时回退 `~/edupi-install-checkpoints/settings-redesign-20261023/oauth-issue-20261024/EduPi-before-oauth.app` 等待真实 OAuth/写入验收；该条件已由上方实服结果满足，副本现已删除。原 `.70` 回退 App 与原私有数据备份继续保留。
- 前轮 JEV 原生连接成功证据仍有效。本轮依赖升级后已安装后端真实测试返回 200、`jev-1.14.0`、535ms；这是后端回归，没有再计一次原生 JEV 按钮验收。

初装时 Client Secret 保存、GitHub OAuth、issue 创建与回读、真重启回读均未验；后续已由用户按浏览器 credential hand-off 规则完成新凭据填写，并在上方真实应用流程逐项通过。真实 OAuth 凭据轮换/网络中断及 Windows/Linux 仍未验，不能把当前 macOS 结果扩展到这些条件。

私有证据根：`~/edupi-install-checkpoints/settings-redesign-20261023/oauth-issue-20261024/evidence/`。主要文件：`installed-preview.json`、`installed-client-setup.json`、`oauth-setup.png`、`after-cleanup.json`、`after-cleanup-oauth-state.json`、`after-cleanup-signature.json`、`packaged-oauth-host.json`、`final-tests.log`、`all-tests-after-deps.log`、`types-final.log`、`lint-final.log`、`audit-final.log`、`data-protection-final.json`、`reminder-operational-summary.json`、`cleanup.json`。其中首次过宽的数据摘要比较及静态完成页负测的原始失败保留，后续记录已明确修正判断。

## 2026-10-24 JEV 与 GitHub 只读续验历史

本节记录前轮 JEV 连接修复和通过本机已有 GitHub CLI 登录执行固定只读调用的结果；当前安装和新增 OAuth/写入状态以上方记录为准。R23 通用外部执行、其他服务和跨平台不因此完成。

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

## 2026-10-25 设置结构重排

当前状态：macOS 本机验收通过。此状态取代本轮初始的“已实现待安装验收”；此前 OAuth、续期和断网证据仍有效，不以连接功能验证代替设置易用性。实现基线为 `a7bed53c`，最终源码 `f7224b98d6f9eb67f14da8d8869a48e944ddd14f`，唯一安装 App 仍为 `/Applications/EduPi.app` 0.3.77 本地预览，Core `03bbb893`。本轮未合并、公开发布、公证或修改 feed/tag；用户观感不计为自动通过。

### 参考依据

仅采用官方资料，将产品事实与 EduPi 的设计决定分开记录。

| 官方参考 | 已核对事实 | EduPi 设计决定 |
| --- | --- | --- |
| [Linear Workspaces](https://linear.app/docs/workspaces)、[Preferences](https://linear.app/docs/account-preferences) | 个人偏好、团队设置与 Administration 分区；默认视图、主题和桌面行为属于个人偏好 | 统一设置入口，以个人、AI 与服务、本机分组；不为本地单教师应用虚构成员、计费或组织管理 |
| [Notion Workspace settings](https://www.notion.com/help/workspace-settings) | 设置搜索进入对应页面、标明路径并突出具体项目 | 搜索语言、通知、JEV、辅助功能、更新代理等关键词，进入并聚焦真实控件 |
| [Notion Connections](https://www.notion.com/help/add-and-manage-connections-with-the-api) | 连接按应用归组，同一应用的多种能力共用一个目录入口 | 飞书、钉钉、企业微信各一个品牌入口，详情选择用途；移除服务连接/OpenConnector 来源 tabs |
| [Slack Notifications](https://slack.com/help/articles/201355156-Configure-your-Slack-notifications) | 通知在 Preferences 的 Notifications 中集中配置 | 通知独立成页，系统权限与任务完成提醒放在一起 |
| [Microsoft App settings](https://learn.microsoft.com/en-us/windows/apps/design/app-settings/guidelines-for-app-settings) | 内容限宽、相关项目分组，标签和动作有一致位置；高级内容按需展开 | 常用页采用单列设置行；普通偏好即时生效；版本/更新归关于页，合同和组件清单归诊断 |

Linear 官方图片及浏览器参考页在本轮工具中超时或不可读，不声称操作过 Linear、Notion 登录后的客户端。以上为官方文档事实；EduPi 改版前设置页已经在真实安装 App 中打开并截图。

### 信息结构

改版前可复现：工作台“设置/管理中心”进入同一壳；壳内又有“设置/系统”；设置长页混合教师资料、外观、用量、数据目录、设备权限和更新。AI 页嵌套旧侧栏编辑器，连接按技术来源分成两套目录。

- 个人：常规、教师信息、通知。
- AI 与服务：AI 与模型、应用连接、自动运行。
- 本机：设备与权限、数据与隐私、关于与更新。
- 低频入口：回收站、诊断。

JEV 继续归 AI 与模型，概览和自主运行继续同页。工作与资源中转页退出日常导航，教学能力/学校空间信息保留在诊断的教育数据折叠中。模型页展示真实默认模型与服务列表，添加和详情在页内往返。应用连接先显示真实已有连接，添加时进入统一品牌目录；已配置、凭据已验证与已连接不混称。

本轮不发起新的服务授权，不创建新的 GitHub issue，不扩展 R23 通用执行权限；原固定 GitHub TEST #379 回执应保留。

### 证据入口

本轮私有证据目录：`$CHECKPOINT/settings-architecture-20261025/evidence/`。

- `settings-before-native.jpg`：真实 0.3.77 设置长页。
- `native-before-health.json`：Core/投影/Kernel ready，51 学生、160 任务、24 校历、6 课表，externalSend=false。
- `settings-protected-before.json`：317 个教学、配置、认证和会话文件的摘要，无原内容。
- `settings-targeted.log` 与 `checks.json`：阶段检查及最终检查的分开记录。截图原始字节为 JPEG，已按实际格式改扩展名，没有改动像素；`image-format-names.json` 保留映射。

### 本机实际操作

| 流程 | 实际结果 | 证据 |
| --- | --- | --- |
| 工作台进入设置 | 只有一个设置入口；个人、AI 与服务、本机三组及回收站/诊断可直接进入 | `delivery-settings-ready.jpg`、`delivery-workbench.txt` |
| 搜索 JEV | 仅一个结果，Enter 进入 AI 与模型的浏览器决策并聚焦；原密钥仅显示已保存占位 | `delivery-jev-target.txt/.jpg` |
| 搜索更新代理 | 直接进入关于与更新，展开代理控件并聚焦 | `native-proxy-search-target.txt/.jpg` |
| 模型服务 | 真实默认 `DeepSeek / deepseek-v4-flash`，17 个可用模型；OAuth/API Key/自定义服务状态分开；添加服务在页内打开，返回恢复按钮焦点 | `delivery-models.txt/.jpg`、`final-model-provider-picker.txt/.jpg`、`final-model-picker-return.txt` |
| 应用目录 | 1553 个应用；飞书/钉钉/企业微信按品牌各一个入口；当前可见的常用应用官方 Logo 加载后已实际目视检查 | `delivery-directory-loaded.jpg`；初次加载图片尚未完成的截图保留，不作为图标已显示证据 |
| 飞书用途与返回 | 中文查询仅一项；机器人接入与只读目录按用途选择；没有弹窗或自动授权；Shift+Tab/Enter 返回原用途，再返回目录保留查询与焦点 | `native-directory-feishu.txt`、`native-feishu-purposes.txt/.jpg`、`native-feishu-keyboard-back.txt`、`native-feishu-catalog-return.txt` |
| 代理草稿 | 输入未保存的本机测试地址，切常规再回关于，草稿仍在；最后还原已保存值，保存按钮禁用，未写入代理配置 | `native-proxy-unsaved.txt`、`native-proxy-draft-retained.txt/.jpg`、`native-proxy-draft-restored.txt` |
| 数据目录取消 | 实际打开原生目录选择器并取消；目录、进程及教师资料不变 | `native-data-picker-cancelled.txt`、`data-protection.json` |
| 资料、通知、设备、运行、诊断、回收站 | 分别打开并回读最终数据；原教师资料可进入真实上下文流程后关闭；未触发恢复、试用、通知或新授权 | `native-teacher-profile-loaded.txt`、`native-notifications.txt/.jpg`、`native-devices-permissions.txt/.jpg`、`final-automation.txt/.jpg`、`final-diagnostics.txt/.jpg`、`final-recycle-loaded.txt` |
| 外观与窗口 | 浅色→深色→浅色即时生效；1440 级窗口与较窄窗口均实际观察，较窄截图为 1610×1610 像素，设置行与模型列表无重叠 | `final-dark-theme.jpg`、`final-light-theme-restored.jpg`、`native-narrow-general.jpg`、`native-narrow-models.jpg` |
| 冷启动及账号往返 | 正常退出后同一路径启动，最终 PID `64955`；原 GitHub 账号和健康显示在详情往返后不再丢失；旧 #379 回执保留，未创建新 Issue | `delivery-native-health.json`、`delivery-connections-before.txt`、`delivery-connections-after.txt/.jpg`、`final-existing-receipt-preserved.txt` |

### 实机发现与修复

- 新鲜复核发现的三个问题均已修复：访问过的设置页保留挂载以保存草稿；搜索等待动态页面目标出现并清理观察器；升级期间所有受控跳转与外部设置入口都受 busy 保护。实际 handler/lifecycle 测试和本机代理草稿往返通过。
- 首次安装版默认模型摘要返回 403：新增请求缺少 cwd，服务器安装目录被现有规则拒绝。修复传入教育工作区，而没有放宽 allow-list 或项目信任；真实同端点带 cwd 回读 200、17 个模型，随后安装版显示真实默认模型。失败与修复证据保留在 `native-model-summary-root-cause.json`、`native-cwd-fix-tests.log`。
- 查看已有 GitHub 详情后，未加载的空状态会清空父列表账号。修复只在实际状态取得后通知，并回传已经校验的安全状态；无新探测、续期或写入。`delivery-connections-before/after` 证明同一账号及状态保留。

### 校验与数据保护

- 最终 `npm test`：2601 总数、2561 通过、40 环境跳过、0 失败；最终类型检查、ESLint 和 diff 检查通过。早期旧布局断言及文档路径断言失败保留，不计通过；修正后最终全套结果见 `tests-delivery.log`。这些检查不替代上表原生操作。
- 原生签名 strict/deep 通过，Team `BY3XZG2839`，CDHash `ecf91a3cc5cc1160800dfc522058176cbd65107b`；主程序 SHA256 `047de5319d4bceefa6d496e0ff08f03a828236898e3c9994692fed42eebf4242`。只替换 Desktop server，33,709 个 Core/壳/OpenConnector 文件摘要保持，原 updater 公钥保持；无验收环境键、无中继。详见 `settings-delivery-installed.json`。
- Core、投影、Kernel 均 ready，原数据根保持，51 学生、160 任务、24 校历、6 课表，externalSend=false。
- 317 个受保护文件前后均在，无增删；教学、模型、认证及偏好内容摘要保持。7 个运行状态变化单列，其中 1 个日志仅追加且原前缀摘要保持；未修改或恢复用户文件来隐藏差异。见 `data-protection.json`。
- 本轮 6 个生成目录和 3 个临时 App 副本均已删除，目录占用合计约 6.04 GiB；有完整前后计量的两批清理使可用空间增加约 5.25 GiB，早先单独删除的一份 App 只计目录占用。安装 App 不依赖已删除路径，临时 App 副本为 0；原 `.70` 回退、数据、认证、证据、源码及原 Core 依赖保留。

### 尚未验证

Windows/Linux 原生界面、40 项环境跳过、新的公开升级安装链路均不计通过。本轮没有新的公开更新包，也没有扩展其他服务的授权或执行能力；R23 通用受管浏览器与 Core grant/Receipt 继续部分实现。本地用量仍显示原有未收集状态，没有替教师作出采集同意。

交付末次前置窗口时，CUA 回读显示 Mac 已锁定，不能继续 GUI 操作。所有上表操作和最终常规页截图均在锁定前完成；此限制不替代或撤销已有实机证据，也不宣称末次前置成功。最后成功页面见 `delivery-settings-ready.jpg`，未绕过锁屏继续操作。

## 2026-10-26 设置间距收敛

当前状态：本机安装与布局检查完成，末次前置因系统锁屏待恢复。此节取代上轮的当前界面状态；不将用户的观感计为自动通过。延续 R18，修改范围只有 4 份 CSS，分组、表单处理、认证与服务执行逻辑没有改动。

| 调整 | 结果 |
| --- | --- |
| 常规与通知 | 表单限宽 640px；196px 标签列加 20px 间距，控件同列起始；开关说明独占下一行 |
| 正文与标题 | 靠近侧栏左对齐，桌面内边距由 40px 起调整为 28px；标题 22px，正文仍为原 13px |
| 侧栏 | 226px 收至 208px，缩短页头和分组间距，当前项加 2px 内侧标记 |
| 列表 | 模型行最小 60px，连接目录卡片最小 64px；模型内容限宽 720px |
| 外层边界 | 偏好页外层 704px、模型页外层 784px，使内部表单和分隔线右边界一致 |

源码先于 `9328ad1c` 完成主体，再于 `25f799bdd8606037172446e04efd174ee50c88c2` 对齐两处外层宽度。最终仍为唯一 `/Applications/EduPi.app` 的 `.77` 本地预览，Core03 未变；未公开发布、合并、公证或改 feed/tag。

证据根为 `$CHECKPOINT/settings-density-20261025/evidence/`，目录名沿用中断前的起始日期。恢复时另取 `settings-protected-resume-before.json`，保留旧快照，避免把用户在中断期间的合法更改算作本轮改动。

- `css-parse.log`：4 份 CSS 解析通过；`targeted-tests.log`：23 项通过、0 失败、0 跳过；恢复后的 `types-resume.log` 对应类型检查退出 0；diff 检查通过。未为纯样式重复跑全套测试，不引用旧全量数量冒充本轮验证。
- 原生实际操作：Tab 从设置搜索跨侧栏进入语言控件，再到关闭开关；Shift+Tab 与 Enter 激活深色，随后恢复浅色。AX 保留开关完整名称和状态。见 `keyboard-first-control.txt`、`keyboard-switch.txt`、`after-dark.jpg`、`after-notifications-dark.jpg`、`after-light-restored.jpg`。
- 实际目视核对了常规、通知、模型、JEV、连接目录、自动运行、资料、设备和数据页；宽窗截图 2880×1800，较窄截图 1610×1610，无本轮造成的控件遮挡。窄窗与深浅色在 `9328ad1c` 检查，两处 max-width 微调没有改变该窄窗的实际受限宽度；最终 `25f799bd` 冷启动后再次核对宽窗常规、数据和模型的边界。代表证据：`final-general.jpg`、`final-data.jpg`、`final-models-loaded.jpg`、`after-general-narrow.jpg`、`after-models-narrow-loaded.jpg`、`after-jev-narrow.jpg`。
- 最终原生 PID `28800`，Core/投影/Kernel ready，51 学生、160 任务、24 校历、6 课表，数据根和默认模型保持，externalSend=false。317 个受保护文件无增删，业务记录和配置保持；7 个运行变化分列，其中会话仅追加 4 条 custom 记录、1062 字节，原前缀摘要保持。见 `final-health.json`、`data-protection.json`。
- 签名 strict/deep 通过，Team `BY3XZG2839`，CDHash `d0049cb76a6999a4a6bbb17f4c5594cd834f40ca`，主程序 SHA256 `53a31836ad92b6d639c871bd2f3e864d5863a26a6766b4e74dc5866696b7cfcd`。33,709 个 Core/壳/连接运行时文件和 updater 公钥保持。见 `density-final-installed.json`。
- 清理 6 个生成目录和 2 个本轮临时 App，目录占用约 5.12 GiB，两批清理观测可用空间增加约 5.21 GiB；临时 App 副本 0，安装 App 自包含，无已删除路径依赖。保留原 `.70` 回退、用户数据、认证、证据、源码和原 Core 依赖。见 `build-cleanup.json`、`cleanup-apps.json`。
- 末次准备回常规并前置时，CUA 显示 Mac 锁屏，后续 GUI 动作未执行，已请求用户解锁。最后成功界面为最终模型页；`final-general.jpg` 是此前最终包已实际显示的常规页，不宣称它在锁屏后被再次前置。无需重做构建、安装、OAuth 或 GitHub 写入。

Windows/Linux 实机、本轮未运行的全套检查，以及末次前置显示均不计为本轮通过。没有进行新的服务授权、调用或外部写入，R23 整体仍部分实现。

## 2026-10-26 自适应居中与页内布局复核

延续 R18。用户明确要求自适应居中，认可原分区的参考对象，要求进一步核查主入口、分区和每页布局。本节取代上节的紧凑方向；分区仍为个人、AI 与服务、本机，不增加组织管理或计费等虚构功能。

### 官方参考与设计决定

重新读取 [Linear Preferences](https://linear.app/docs/account-preferences)、[Notion 设置](https://www.notion.com/help/workspace-settings)与[连接](https://www.notion.com/help/add-and-manage-connections-with-the-api)、[Slack 通知](https://slack.com/help/articles/201355156-Configure-your-Slack-notifications)、[Microsoft 设置指南](https://learn.microsoft.com/en-us/windows/apps/design/app-settings/guidelines-for-app-settings)。已实际目视检查 Linear 官方偏好截图与微软 WinUI Gallery 设置示例图；私有证据为 `reference-linear.png`、`reference-microsoft.png` 与 `reference-sources.json`。内嵌参考浏览器超时，改为直接读取官方静态素材用于审查；未操作第三方登录后的客户端。

| 页面与结构 | 本轮决定 |
| --- | --- |
| 主入口与分区 | 保留单设置入口、三组导航及搜索；恢复侧栏正常间距 |
| 共享正文 | 外层统一最大896px，在右侧工作区居中；内边距48px，正文800px；容器随工作区缩窄自适应，所有页标题与内容共用轴线 |
| 常规、通知 | 恢复64px起的设置行，标签与说明在左、控件在右，保留即时生效 |
| 教师信息 | 维持资料与编辑入口，正常行距；不新增账户或组织层级 |
| AI 与模型 | 对话与浏览器决策共用页宽；模型列表72px行，移除内层720/640px重复限宽 |
| 模型服务详情 | 实机复核发现旧详情仍展开工程字段且缺少服务名；补服务标题、已配置密钥按需展开、高级模型参数折叠，Kimi使用同包官方Mono适应浅色；原配置和保存处理保持 |
| 应用连接 | 已有连接、添加目录和页内详情共享宽度；72px已有连接行、80px目录项，修正添加按钮下沉 |
| 自动运行 | 3项执行计数保持一级；3项配置状态改为普通状态行；准备检查随后折叠，运行范围和历史同页 |
| 设备与权限 | 桌面控制在前，手机继续对话在后；权限和网络限制仍保留 |
| 数据与隐私 | 用量维护计数移入已有本地记录折叠；同意/撤销/擦除边界不变；未读取时显示读取中，不能称未收集 |
| 关于、回收站、诊断 | 共用居中正文；继续保留更新、恢复、技术诊断的原边界 |

### 本机验收结果

布局子项本机验收通过。首个居中预览为 `53aa89ad`；实机继续发现模型详情直接暴露工程字段及分段按钮的全局样式覆盖，分别由 `2520d0e1`、`cd14396d8685c8d0841664ee4b1a506846b9197b` 修正，最终均已安装。证据根 `$CHECKPOINT/settings-responsive-20261026/evidence/`，旧紧凑版与加载中的截图不计最终通过；首预览中未受后两次修改影响的资料、通知、设备、自动运行等页结果保留有效。

| 操作与预期 | 实际结果与证据 |
| --- | --- |
| 工作台进入设置，分区和正文位置稳定 | 单设置入口及三组导航保持；宽窗2880×1800、窄窗1612×1612实际观察。`after-workbench.txt`、`final-general-narrow.jpg`、`final-general.jpg` |
| 常规、通知及资料恢复正常行距与对齐 | 中文/浅色/3天/关闭退出关保持；资料读取完成后与通知页同轴。`after-profile-loaded.jpg`、`after-notifications.jpg` |
| 键盘到达控件，浅深色选中状态可辨 | 搜索后12次Tab到语言，6次Tab到关闭开关；Shift+Tab/Enter切深色，再恢复浅色；最终选中背景和文字对比已修正。`keyboard-first-control.jpg`、`keyboard-switch.jpg`、`final-dark.jpg` |
| 模型详情先呈现服务与常用操作，高级项可展开 | DeepSeek标题、Kimi Mono图标、更新密钥披露和高级参数均在真实最终App核对；宽窄窗表单及下部价格字段可读。`final-models-loaded.jpg`、`final-model-detail.jpg`、`final-model-detail-narrow.jpg`、`final-model-advanced-narrow.jpg`、`final-credential-closed-narrow.txt` |
| 折叠与切页不丢草稿，放弃后保留原配置 | 仅在未保存的模型显示名称追加布局检查字样，收起高级项、切教师页再返回仍保留；放弃更改后重进模型恢复原值，models/auth文件摘要保持。`final-model-draft-retained.txt`、`final-model-draft-discarded.txt`、`data-protection.json` |
| 连接目录随窗口分栏，中文可直接查找 | 最终窄窗两列、飞书搜索1个品牌入口；已有GitHub账号仍可见，首预览详情已核对用途列表。`final-directory-narrow.jpg`、`final-directory-search-narrow.jpg`、`after-connection-detail.jpg` |
| JEV仍在AI页且可由设置搜索到达 | 搜索JEV实际进入浏览器决策，已配置状态与输入、按钮在窄窗可见。`final-jev-search-narrow.jpg`；未点击保存、测试或移除 |
| 自动运行、设备、数据按内容分级 | 执行计数与配置状态分开；桌面权限在手机前；数据页加载/错误状态可辨。`after-automation.jpg`、`after-devices.jpg`、`after-data-settled.jpg` |
| 关于、回收站和诊断读取后布局可用 | 最终关于读取到当前.77/公开.70；回收站显示既有10项及分页；诊断显示既有校验错误。`final-about-settled.jpg`、`final-recycle-settled.jpg`、`after-diagnostics.jpg`；未升级、恢复或修复真实资料 |

- 静态：38项针对性通过、0失败/跳过；模型详情另跑14项通过，二者存在重叠，不相加冒称独立总数。类型、受影响组件lint、4份CSS解析和diff通过；日志见 `targeted-tests-final.log`、`models-detail-tests-final.log`、`types-final.log`、`types-details.log`、`lint-final.log`、`lint-details.log`、`css-final.json`。初次设备顺序旧断言失败保留，按本轮排序更新后通过。独立只读复核的第二节间距和长服务名换行两项均已修正。未重跑全套。
- 构建：最终字体站点直连超时，精确停止本轮构建进程后，仅为构建使用已有127.0.0.1:7897系统代理；最终 `prepare-proxy.log` 成功，原失败保留。系统网络设置未改，安装包未加入代理环境或验收到期入口。
- 安装：仍为本地0.3.77预览，Core03固定，7个server原生资源和整App重签，Team `BY3XZG2839`、CDHash `b77ff728017dfaa54d557d2fadc6cc3ce0d0123d`，主程序SHA256 `774c9668e76aa103eb5fd9ff46d4dc4cdbe4387cd5aef33a966349e1598cf43b`。33,709个非server文件、GitHub宿主和原更新公钥保持；安装及清理后strict/deep通过。见 `responsive-final-installed.json`、`post-cleanup.json`。未合并、公开发布、公证或改feed/tag。
- 数据：314个保护文件无增删，教师业务记录与模型/认证/JEV/UI配置保持；3份桥接/Runtime日志追加、桥接运行状态和会话追加单列，其中会话仅4条custom/1062字节，原前缀保持。初次分类漏掉桥接错误日志与状态文件，依据既有写入源补正为运行态，未回写用户数据消除差异。见 `data-protection.json`。
- 清理：6个确认忽略且可重建目录和2个本轮旧App已删除，目录占用约5.13GiB、观测空闲增加约5.09GiB；临时App副本0，安装App无外部符号链接依赖。保留源码、原.70回退、认证/资料/证据和原Core依赖。清理后首页/模型API为200、默认模型保持DeepSeek，见 `build-cleanup.json`、`cleanup-apps.json`、`post-cleanup.json`。

### 既有异常与未验边界

改版前 `before-status.json` 已报 `runtime_root_invalid`，投影仍ready且51学生/160任务/24校历/6课表可读；最终保持该异常，用量页实际显示“本地记录校验失败，收集已停止”。没有擅自擦除或修复运行库。最终一次并发冷读workspace为503，随后独立温读为200并核对同样计数，原503保留于 `final-workspace.json`，后者为 `final-workspace-warm.json`；不能用投影可读宣称Core Runtime正常。

Windows/Linux实机、全套回归、用量正常分支的本机披露与新的公开升级链路未验；用量局部处理回归通过不替代该实机条件。本轮没有新增授权、JEV调用或GitHub写入，R23整体继续部分实现，用户观感不自动勾选通过。

## 2026-10-26 主导航与全应用折叠重做

延续R18，本轮源码、安装与macOS交互验收完成。用户附图指出主导航不美观、二级导航折叠成细线、此前原生折叠控件都需要改。采用本机真实界面与源码盘点，覆盖设置及工作台，保留上一轮自适应居中。

- 基线：`87155a05`，安装UI为`cd14396d`。原生details有97个源码站点/44个组件；另有聊天过程、长文本、思考/工具内容和会话分组按钮。二级栏细线由18px列、窄条DOM和右边框组成，旧测试将它误作契约；主网格264px与内容栏244px也不一致。
- 设计：主导航采用克制的品牌尺寸、正常字重和中性选中态；二级栏完全隐藏并从模块标题栏恢复，保留查询、选中、滚动和焦点。共享折叠标题、尾部细线指示、悬浮/焦点/展开态；数据表行保留grid，纯图标诊断保留原尺寸；原details、onToggle、受控open与内容DOM继续承担懒加载/取消/草稿契约。
- 参考：[Linear侧栏官方示例](https://linear.app/changelog/2024-12-18-personalized-sidebar)图片已实际读取；[Notion侧栏](https://www.notion.com/help/navigate-with-the-sidebar)文档核对显式恢复入口。没有操作第三方登录客户端。官方图片、用户两张图和改版前原生展开/收起在私有`$CHECKPOINT/navigation-disclosure-20261026/evidence/`。
- 覆盖：97个原生details站点共享新样式，另统一聊天过程、长文本、思考/工具、会话分组等按钮。保留原生语义及内容DOM；纯图标后台诊断弹层保持28px，记忆/知识库的表格行继续使用grid。实际操作覆盖下表代表性分支，未声称逐个填充并点击全部97个数据分支。

源码复核补正：独立审查复现窄窗日程列表遮住详情、学生详情的模态焦点阻止已恢复列表操作。选择日程现在先收起列表；显式恢复的列表按当前模块取得前景焦点，主内容暂不可交互，Escape只收起列表。模块切换退出此前景状态，学生选择和草稿保留；窄窗详情链接先显示详情，不自动覆盖列表。实际modal hook、实际Calendar/selectView回调及布局状态回归已加入。

### 本机安装与交互证据

源码先由`77a6493c`完成共享样式与导航，再由`cafce3a4e3e2015570b60d9c98a5c24ac267ec14`修正窄窗焦点和详情覆盖；最终仅安装后者。私有证据根为`$CHECKPOINT/navigation-disclosure-20261026/evidence/`，汇总在`native-acceptance.json`。

| 实际操作 | 结果与证据 |
| --- | --- |
| 宽窗主导航、图标模式、恢复文字 | 2880×1800截图；中性选中态、正常字重，旧蓝色粗条移除。`delivery-expanded.jpg`、`primary-navigation-icons.jpg` |
| 收起二级栏，再按Enter恢复 | 隐藏整个列表和网格列，标题旁恢复入口可达；不留18px线条，恢复后焦点返回收起按钮。`new-secondary-collapsed.txt`、`delivery-collapsed.jpg`、`sider-scroll-restored.txt` |
| 列表滚动、收起/恢复；搜索陈、收起/恢复 | 已目视对照同一李怡淼起始位置；查询仍为陈且3个结果。`sider-scroll-before.jpg`、`sider-scroll-restored.jpg`、`sider-query-restored.txt` |
| 窄窗1612×1612选学生、恢复列表、Tab、Escape | 详情先可见；恢复列表后Tab进入搜索，Escape仅关闭列表，同一学生ID保留。`narrow-student-detail.jpg`、`narrow-student-list-tab.txt`、`narrow-student-list-escape.txt` |
| 窄窗日程列表选课程，再恢复/关闭列表 | 选中即让出详情；标题恢复入口和Escape可用，原课程ID保持。`narrow-calendar-detail.jpg`、`narrow-calendar-list-recovered.txt`、`narrow-calendar-escape.txt` |
| 展开日程列表后切班级、恢复宽窗 | 新模块可交互，不残留此前景状态或空列。`narrow-module-switch.txt`、`wide-navigation-restored.jpg` |
| 学生档案历史、成长记录 | 整行展开，历史读取结束为真实空状态，Enter收起；成长记录内容可读。`student-history-loaded.txt`、`student-growth-disclosure.jpg` |
| 常规规则、深浅色 | 同一整行与细箭头在两种外观可辨；最终恢复中文/浅色/3天/关闭退出关。`settings-disclosure-dark.jpg`、`cold-settings-preferences.txt` |
| 模型高级参数、草稿收起/切页/放弃 | 未保存名称在收起和切页后保留；放弃后重进恢复原值。没有保存模型或密钥。`model-advanced-expanded.jpg`、`model-draft-retained.txt`、`model-draft-discarded.txt` |
| JEV用途/高级、连接操作目录、自动运行准备状态 | 均实际展开，输入和状态行完整；未发起JEV测试、OAuth或外部写入。`jev-disclosures-expanded.jpg`、`connector-operations-expanded.jpg`、`automation-readiness-expanded.jpg` |
| 教育记忆表格行 | 展开后各列与表头仍对齐，历史入口和操作可达；未修改/删除教师记忆。`memory-grid-expanded.jpg` |
| 现有聊天的过程、思考、工具和会话时间分组 | 实际展开回读已有内容，无新提示词、工具执行或模型调用。`chat-process-expanded.jpg`、`chat-thinking-expanded.jpg`、`chat-tool-expanded.jpg`、`chat-session-group-expanded.txt` |
| 正常Quit至App进程0，再冷启动 | 新PID77713，班级51人、默认DeepSeek及模型服务状态、原设置偏好保持；首页/status/workspace均200。`cold-quit-processes.json`、`cold-restart-health.json`、`cold-class-restored.txt`、`cold-models-restored.txt` |

### 检查、保护与清理

- 最终`npm test`为2615总数、2575通过、40环境跳过、0失败；`node_modules/.bin/tsc --noEmit`、`npm run lint`、CSS解析和diff通过。54项披露、35项导航与26项叠层检查有重叠，不相加。见`full-tests-verified.log`、`types-verified.log`、`lint-verified.log`、`overlay-related-fixed.log`与`checks.json`。中间旧属性顺序/可空数据正则、隔离harness依赖和图标mock失败均保留，更新后通过，没有删除行为断言。
- 最终`desktop:prepare`通过。字体站点构建仅使用已有127.0.0.1:7897代理环境；系统网络未改，成品无代理或验收专用环境键。Team `BY3XZG2839`、CDHash `13e25553d191b3cd56cdd4a990b362099849fff6`，主程序SHA256 `9e1e213b58c9a813ffbe4d1d020c8cdb93d3d905f7a594bb441ff61015627f24`。Core03、33,709个非server文件、GitHub宿主及原更新公钥保持，清理后strict/deep再次通过。见`navigation-installed.json`、`post-cleanup.json`；未合并、发布、公证或改feed/tag。
- 全程与安装前后两组快照均314文件，无增删，教师业务与模型/认证/JEV/UI配置摘要保持。6个变化是提醒状态、桥接状态、3份追加日志和现有会话custom追加；从本轮开始为6条/1593字节，从安装前为4条/1062字节，原前缀保持。Mac重启前的初始快照未被安装快照覆盖，未回写用户文件掩盖差异。见`data-protection.json`、`install-data-protection.json`。
- 删除6个确认忽略且可重建目录和2个本轮临时App，目录占用合计约5.12GiB，分批观测可用空间增加约5.15GiB；临时App副本0，安装App无外部符号链接依赖。保留源码、原.70回退、教师资料、认证、证据和原Core依赖。见`unused-candidate-cleanup.json`、`build-cleanup.json`、`cleanup-apps.json`、`post-cleanup.json`。

### 未验与既有异常

原有`runtime_root_invalid`和学生学习图的Core admission拒绝仍在；投影ready，51学生/160任务/24校历/6课表保持，externalSend=false。用量页仍实际显示“本地记录校验失败，收集已停止”，因此其正常数据披露分支未作本机通过。直接无Desktop凭据读取models得到403，原响应不计通过，默认模型改由真实App冷启动界面核对。未擦除或修复Runtime库。

Windows/Linux原生、40项环境跳过、全部97个披露的数据分支、自然到期/新OAuth/离线/新写入和公开升级链路未在本轮复验；此前连接恢复证据保持历史有效，不作为本轮新增结果。R23整体仍部分实现，用户视觉认可不自动勾选。

## 2026-10-26 逐页面组件与交互优化

延续R18，基线源码`f7e9db6a`、本机UI`cafce3a4`，Core03保持。当前源码与唯一安装App为`4e75ad52637bfe2247bf679647e6ce1b44920a13`，本地0.3.77预览；在macOS26.6（25G72）arm64完成**本轮UI子项验收**，执行跨越10月26日至27日。用户视觉认可、合并与公开发布单列，R23整体仍部分实现。证据根`$CHECKPOINT/page-components-20261026/evidence/`；未新增OAuth、JEV测试、模型提示词或GitHub写入。

参考[Linear显示选项](https://linear.app/docs/display-options)、[看板](https://linear.app/docs/board-layout)与[Apple工具栏](https://developer.apple.com/design/human-interface-guidelines/toolbars)，对照实际页面调整标题、动作、筛选与布局边界。首次两个URL不可读取，改读官方搜索结果；见`reference-sources.json`。保持中性色、正常留白、自适应居中，不恢复紧凑方向。

| 页面 | 已实现与实际操作 | 当前状态及证据 |
| --- | --- | --- |
| 今天 | 统一标题，删除空简报重复段落；只有一组时占满可用宽度，查看更多横排；决定按钮按内容宽度排列 | 54d9与4e首屏实际可见，`final-first-window`、`flow-start-visible` |
| 工作区 | 鼠标真实单击和Tab后Enter打开同一课前任务；分类进入历史147项，返回仍为教学准备；普通任务表单输入明确UI草稿后取消，没有创建 | 原生通过，`final-board-mouse-single-click`、`final-board-keyboard-enter`、`final-workspace-history`、`final-workspace-category-return`、`after-task-unsaved-form`与`after-task-create-cancelled` |
| 教学 | 统一标题轴线/主次动作；下一节准备打开对应任务目标；教学重点入口能往返 | 原生只读通过，`after-teaching-main`、`after-teaching-preparation`、`after-teaching-focus-empty`；未点生成或立即检查 |
| 班级 | 普通名单行、真实摘要、范围明确的导出；选中学生翻页不被拉回，关闭后页码保持，陈字搜索与无结果可恢复 | 原生通过，`after-student-next-selected`、`after-student-page-preserved`、`after-student-search`、`after-student-search-empty`；未导入或改学生资料 |
| 学生记录 | 只有自定日期显示输入；实填2026/10/1至10/26，切全部时间再返回值不丢；家校/列表/网络图分支，窄窗Tab/Escape保留同一学生ID；错误中文化 | 日期/筛选/焦点通过，`after-custom-dates-filled`、`after-custom-dates-restored`、`after-student-family`、`after-student-narrow-list-tab`与`after-student-narrow-list-escape`。正常学习记录受既有Core拒绝；4e展开成长记录后实际滚动且标题保持可达，`flow-student-real-body-scroll` |
| 日程 | 五项工具列，月单日任务摘要；日/周/月/列表与来源切换；Cmd+1不误切，3键正常；课程详情与列表往返；抽屉已避开窗口栏 | 日/月/列表/快捷键与54d9宽窄抽屉通过，`after-calendar-*`、`final-calendar-drawer-wide`、`final-calendar-narrow-list-hidden`；4e有侧栏和窄窗的标题、来源、状态分行可读，`flow-active-week-with-list`、`flow-active-week-narrow` |
| 记忆与洞察 | 中等窗宽表头与行同宽，拖动横向滚动条看累计/更新日期；空搜索与无数据/错误分开，无空表头或无效分页 | 记忆实测通过，`after-memory-scrollbar-dragged`、`after-memory-search-empty`；洞察读取错误实际展示，`after-insights-loaded`，正常记录分支未作本机通过 |
| 成长与材料 | 标题与主动作一致，空结果不同于不可用；材料横向滚动看日期/状态，详情可关闭；成长教师/能力入口可切换 | 主要分支通过，`after-growth-*`、`after-materials-medium-right`、`after-materials-search-empty`、`final-material-drawer-wide`；4e窄窗首条状态可读，列表Tab/Escape回同一材料，`flow-active-material-narrow`、`flow-material-list-tab`与`flow-material-list-escape` |
| 待我确认 | 只显示有内容分组，空页一个状态；事实独立列表无0项1/1分页；侧栏只保留可用入口，不重复空组 | 原生通过，`final-review-no-empty-groups`、`final-review-no-dead-pager`与`after-review-facts-back`；非空组由真实SSR覆盖 |
| 设置与连接 | 常规偏好、默认DeepSeek及5个配置服务、JEV高级项；1553服务品牌目录搜飞书，同页详情后返回保留搜索 | 本轮只读通过，`resume-settings-visible-check`、`after-settings-models`、`after-settings-jev`、`after-connector-directory`、`after-connector-search-restored`；没有保存密钥、重新授权或写入 |

### 原生发现与修正版本

1. `2a10b3fc`首装后CUA报cgWindowNotFound；用户显示窗口后解除。初次工作区HTTP503点击重试恢复，但今天/班级正文仍为空，AX已有数据，设置可见。激活和改窗宽不解决；`9bfed2ae`移除工作页透明/transform首帧动画，真实截图恢复显示：`resume-workspace-retry`、`resume-class-blank-check`、`after-today-paint-fixed`、`after-class-list`。
2. `54d9be47`补历史计数/返回分类、共享分页和审核侧栏；周标题换行，学生头部动作不换行。去掉旧动画后fixed课程/材料抽屉会进入窗口栏，因此改为正文定位祖先内的absolute；宽窗顶部已复验。`fe00260e`继续修周条目的高度；宽窗改善，但侧栏/窄窗仍见状态行越界，未记为通过。
3. `b78240f2`去掉周条目的WebKit截行并显式普通按钮排版，完整文本流决定高度。`4e75ad52`给学生/材料grid抽屉`overflow:hidden`，正文仍独立`min-height:0; overflow-y:auto`；使sticky标题不跟随外层模块padding下移24px而遮住首条记录。`material-narrow-fresh-drawer`、`material-narrow-at-top`保留修前失败。b782单独构建但未装，4e合并两项后重签安装；真实窄窗首条状态、学生长内容滚动和恢复列表Tab/Escape均已通过。

### 检查与安装

- 逻辑最终版本54d9全套`npm test`为2642总数、2602通过、40环境跳过、0失败；46项针对性、typecheck、完整lint/branding与CSS解析通过。此前2a10新增24项，54d9再新增3项，实际SSR/状态/请求/回调覆盖；定向组相互重叠，不相加。初次4项旧展示断言和一次合成fixture缺studentIds失败原日志保留，修订后通过，审核产物门/历史简报正文约束仍在。
- 54d9之后仅CSS变化，沿用同一JavaScript全套结果；19项页面/交互针对性与CSS解析通过，最终4e的`desktop:prepare`含TypeScript检查通过。构建已有session export动态依赖warning保留。`final-full-tests.log`、`final-polish-verified.log`、`final-types.log`、`final-lint.log`、`week-layout-targeted.log`、`prepare-drawer-flow.log`。早期两次额外review容量失败不计通过；后两次只读源码复核未发现必修项，未冒称其运行了测试。
- `pages-flow-installed.json`确认唯一`/Applications/EduPi.app`为4e75，主程序SHA256`169e01b6f80437ea1a23590c17d74ed5924094ee5f5149b53b1214e0a7ba665a`，Team`BY3XZG2839`、CDHash`61b3d3f42a1f33e8ae86991f58068b6ef526b1c2`。7个server原生资源签名，Core03、33,709个非server文件、GitHub宿主和原公钥保持。正常Quit至App进程0后替换；4e启动PID65907，另一次正常Quit至0后同版本冷启PID93586，首页/班级/日程实际可交互，默认DeepSeek与5个服务、中文/浅色/3天/关闭退出关保持。未公证、合并、发布或改feed/tag。
- `installed-flow-health.json`记录清理后strict/deep通过，二进制摘要匹配，首页/status/workspace200，投影ready且51学生/160任务/24校历/6课表，externalSend=false。此前输入无响应记录保留，最新冷启与UI以`cold-flow-health.json`、`cold-flow-settings-restored`、`cold-flow-models-restored`、`cold-flow-class-restored`、`cold-flow-calendar-restored`为准；`delivery-post-cleanup.json`再次确认清理后签名和摘要保持。

### 数据与清理

- 初装全程及安装两组保护记录均314文件，无增删；教师业务与模型/认证/JEV/UI配置摘要保持，5个运行变化单列。窗口恢复后另存`protected-resume-before.json`，未覆盖原快照。最终`resume-data-protection.json`仍314文件，无增删；6项变化为提醒/桥接状态、3份日志和现有会话10条custom追加2655字节，原前缀保持，没有新用户/模型消息；未回写文件掩盖差异。
- 初装后已清理6个生成目录约3.29GiB，观测空闲增3.36GiB；复验重建后再次删除`.next-desktop`、任务node_modules、server、Pi Agent Server.app、edupi-core、open-connector六目录，另删2a10/9bf/54三份已淘汰临时App，新增清理占用6.04GiB、观测空闲增6.18GiB。安装App无外部symlink依赖，清理后健康读取继续通过。`build-cleanup.json`、`final-build-cleanup.json`、`superseded-app-cleanup.json`。
- 末项通过后精确删除caf/fe两份临时回退约1.83GiB，分批观测空闲增1.87GiB；本轮临时App副本0。加初批及重建清理，累计移除可重建占用11.16GiB，各批观测空闲增量之和11.42GiB；有其他磁盘活动，这不是整段时间的净空闲增量。`accepted-app-cleanup.json`、`delivery-post-cleanup.json`。保留原.70、源码、已安装App、证据、教师数据、密钥和原Core依赖，原工作区`mv/`保持。

### 输入恢复与当前未验

4e首页可见后，AX/坐标点击、标题栏激活与Tab一度不改变页面；重绑/重置无效，不能据此判断锁屏。系统菜单可以响应，代理在独立访达窗口选中唯一安装App执行“打开”后恢复页面输入；原访达窗口未动，新窗口用完已关闭。用户随后回复让代理自行打开，实际恢复已由代理完成，没有交给用户代验。之后完成4e有侧栏/窄窗周日程、材料首条状态、学生长内容滚动、列表Tab/Escape及真正冷启动；最终截图`delivery-week-foreground`确认日程在前台。历史输入阻塞已解除。

既有`runtime_root_invalid`、学生记录Core admission拒绝、本地用量校验失败与对话文件索引不可用仍在；这些正常数据分支未计通过。Windows/Linux、40项环境跳过、公开升级链路及本轮新增写入均未复验；拖拽未移动真实教师任务，阈值/误点击抑制由真实回调测试覆盖。用户视觉认可仍待用户判断。
