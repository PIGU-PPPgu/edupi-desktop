# G4 macOS 0.3.112 发布验收

状态：**源码正常合并，签名 attempt 2 成功，macOS `.112` 已安装；原生流程发现课次列表重复行，未放行公开，转入 `.113` 修补**。授权范围仍为 macOS；Windows/Linux 构建安装暂缓，正式 Latest `.70` 和 `updater-feed` 不切换。本版验收结束时 App 为已退出的 `.112`，`.108` 整包回退保留；后续 `.114` 的安装和锁屏阻塞见 [`.114`验收](2026-11-13-g4-macos114-release.md)。本文中的 11 月 12 日构建记录与 11 月 13 日北京时间交付验收分别记述。

## 当前候选

Core 固定 `98e4f7cd0c31dd30954574d2040bb1b948cdd954`，含隐式课次历史修补与模板测试的有限 snapshot 重试；Runtime component 为 `sha256:46252d3917be4035a8bc9bf4b779b6d6621db0a3caadb71a38bd2da63ffa0bc2`。原 Mac 的完整 Core CI `43162688017` attempt 2 成功，#463 正常合入 `263802b549e047fa50c315cd8090c7976709bdeb`。托管 Mac Checkout 长时停滞记录保留，不计产品测试通过。

Desktop 精确候选 `82288419f2ce6dc5a5f7b8c5542241dd04da3662` 的 CI `43172341169` 中 `audit`、`rust-audit`、`linux-source` 全部成功，#489 正常合入 `187e403a60383ea24090bcee2b80a86fba2a9eb6`。两库均执行 `git merge-base --is-ancestor` 并比较候选与合并提交的完整 tree，相等后保留原冻结 SHA。scope/恢复/容量边界、512 KiB 最大回执、授权过期历史恢复均已通过各自红绿和独立审查；原 Rustix `1.1.6` 及其他依赖不变。

## 前轮签名失败与夹具修补

`.111` Draft `442563734` 固定 `1b983400`，`43167121336` 在 macOS Core wiring 的停止/恢复 canary 失败，资产为空，未安装和公开；不 retarget 或复用。完整旧记录见 [`.111` 验收](2026-11-12-g4-macos111-release.md)。

已真实定位：canary 为跨班拒绝场景创建了 foreign `lesson_reflection` active grant，之后未清理；所选 grant 已正确 paused，但生产 preflight 按安全契约拒绝另一个 active grant。单独校验 root、owner、当前 grant 全部通过，拒绝本身没有修改 owner、grants 或 activation。

测试夹具现先证明 foreign active 时恢复 `409 proactivity_grant_denied` 且零修改，再仅对已记录的合成 foreign grant 通过正常 Core CAS 暂停：v1 active→v2 paused，root/owner/id/scope/status 回读及其他授权、activation 不变；之后保留原三域恢复、九份产物、审核、重启和字节断言。生产检查、Root/owner/source/CAS 均未修改。

Main4 原发布命令首次因源码未提交而被 clean-source 门拒绝，未绕过或改记通过；clean `.112` 提交后，以精确 Core 根执行 `node scripts/test-edupi-capability-canary-e2.mjs --require-recipient-confirmation` 及加 `--main4` 的原发布命令，均退出 0、`status=passed`、`externalSend=false`。日志为共用证据目录的 `desktop-112-canary-{legacy,main4}.log`；较早夹具修补日志与首次失败保留。

## 安装保护

`.112` 再次完整备份当前 350 项和 3 个 WebView 来源；`.111` 基线复核仍全字节相同。`.110` 旧基线的两份运行日志追加失败、原始前缀及其余 348 项一致的证据继续保留，不能由新基线追认旧门成功。

私有安装脚本修正了本机 `lsof` exit 1 仍可能有 stdout 的误判：仅干净的空输出可判无匹配；App、暂存 App、整个 profile backup、sessions、WebView 源/备份目录均严格拒绝句柄。仅对真实 `.edupi` 源允许预先固定 PID/UID/PPID/启动与 argv hash 的既有服务，在精确两个日志路径上持有 FD1/FD2 REG/u，并核对设备号/inode；不是忽略整个 PID 或所有日志。原 350 项大小、SHA、备份及安装后检查不放宽，日志真正追加仍失败并保留变化。

上述句柄检查 38 项内存回归、补充的 backup config/WebView sidecar 整合 12 项和独立审查通过。新审查发现并修正了私有守卫对权威应用版本来源的误判、未固定本次双 SHA，以及仅相信合并证明布尔值的问题；现明确固定候选 SHA，在安装器中实际验证祖先关系与整树。17 项冻结／合并回归通过。进一步复审发现 `lsof -t` 会关闭 warning，现显式追加 `+w`；本机 UID 501 的不可读取合成子目录真实复现了空 PID、诊断被抑制的情况，并证明实际安装器会拒绝保留诊断的结果，1 项真实扫描回归通过。各项 P2 均经独立复审关闭。

恢复时发现正常 `.108` App 自 15:00 CST 运行，真实根存在新写入；按显式 App 路径正常 Quit 后，旧 `.112` 严格基线检查失败，证据 `protected-data-after-normal-app-reopen-guarded.json` 保留。另在 `evidence/preinstall-current/` 保存停机完整 350 项和 3 个 WebView 来源，原资料不回写，原备份不覆盖。后续现场预检仍拒绝了外部更新的 `models.json`，只读 JSON 差异限定在 Magpie 模型的费用和 token 限制字段，不输出配置内容。

17:55 CST 再于独立 `evidence/preinstall-final/` 捕获完整 350 项和 3 个 WebView 来源，保留期间外部更新的模型目录、智学网同步日志和状态，旧记录继续保留。实际严格预检随后拒绝了一个 1,973,512 bytes 的 WebView WAL。经独立只读审查，先以 `0600` 封存三个原 DB/WAL/SHM 并核对副本、源 SHA；全部源含 WAL 的逻辑行均与备份相等后，才对唯一非空 WAL 正常执行 `PRAGMA wal_checkpoint(TRUNCATE)`，返回 `0|0|0`；immutable 与普通读取均确认全部偏好逻辑内容保持。没有删除 WAL 数据或用旧备份覆盖来源。

18:07 CST 实际 `check-current-protection-112.mjs` **通过**：正常 App/helpers 停止、两仓库真实祖先／整树证明、350 项严格大小／SHA 与完整备份、配置、WebView 来源及句柄均通过；日志 `preinstall-final-protection-check-2.log`。这是安装前保护门，签名产物与安装后验收仍需另行通过。既有飞书服务保持运行，旧基线失败不追认通过。

## 发布门

包含私有 Draft 的版本查询、tag 不存在、候选和质量门、正常合并同树、Latest/feed 保持等独立冻结检查成功后，单独触发 macOS-only Draft run `43189419976` attempt 1、Release `442713191`。同轮三资产全部通过后才可安装；完整资料保护、失败回退及原生隔离守卫保持。

Attempt 1 的应用质量、配对 Core、host 接线、staging、原生编译与签名、App/DMG 公证和最终 triad 一致性均成功，但最终 `Replace verified macOS draft assets` 因 Draft 标签变成 `untagged-372d6f6f7a81c64c530c` 而失败。该替换步骤在修改资产之前退出，不能把远端 DMG 记为最终装订版；整个 run 状态为 failure，不能安装或公开。原三资产 ID `739008995` / `739009500` / `739009977`、摘要、完整日志和失败快照均保留。

18:36 CST 确认原 `.112` Git ref 尚不存在后，创建 `refs/tags/v0.3.112` 精确指向冻结 `82288419…`，随后对同一 Draft 显式设置 tag、target、draft、prerelease 并回读；没有重定向既有标签，三资产未变，Latest/feed 未变。标签改变的具体请求仍未知；一次较早的 name/body 更新未携带 tag，但缺少紧邻响应快照，不能据此断定因果。固定 tauri-action 在提供 `releaseId` 时不会用 `tagName` 修复 Release 元数据。

随后使用 `gh run rerun 43189419976` 完整重跑所有 job，回读为同一 run、attempt 2、同一 Desktop/Core 冻结 SHA、macOS-only。第一次候选选择完整保留为 `candidate-source-attempt1-failed.json`；当前 `candidate-source.json` 只将 attempt 切为 2，没有换源码或复用为其他提交。Attempt 2 的前置与 release job 已成功；后续三资产必须全部属于新 job 时间窗、资产 ID 不得沿用 attempt 1，最终替换及整个 workflow 均成功才可验签安装。构建结束前不再并发修改该 Draft。

原生 `.112` 新合成夹具已生成，初始一节未登记数学课；执行源码与冻结 Git blob 一致，seed 模型请求和父进程拒绝的外部 fetch 均为 0，真实教师资料未写。seed 不是原生界面验收。

本轮源工作树中的 `.next-desktop/`、生成的 server、Pi Agent Server、Core、OpenConnector，以及本轮创建的 Desktop/Core 实体依赖共 7 个目录已逐一核对未跟踪、ignored、无句柄和进程引用后清理。原两条依赖 symlink 恢复，原共享依赖与三个相关工作树的源码状态未变。按 `du` 计删除 3.69 GiB，同卷可用空间实际增加约 3.8 GiB；详情为私有 `source-artifact-cleanup.json`。

当前私有证明目录为 `~/edupi-install-checkpoints/v0.3.112/evidence/`，共用命令日志为 `~/edupi-install-checkpoints/g4-release-20261112/evidence/`。自然七天、真实睡眠/系统通知、教学内容质量和跨平台未验，完整 L4 未放行。

## 11 月 13 日安装验收发现

签名 attempt 2 最终成功，三资产 ID `739293121`／`739251240`／`739251760` 全部替换为同轮新资产。完整下载和 SHA、Minisign 与篡改拒绝、App／DMG 公证装订、Gatekeeper、更新包与 DMG 的完整 App 同树和 31 份冻结源码核对通过。安装首轮在复制后因旧 App 回退目录的瞬时句柄被严格门拒绝，自动恢复 `.108`；失败日志和匹配候选的复制品身份保留。后续完整扫描为空，原占用者未知。第二次按原门成功安装唯一 `.112`，`.108` 整包回退保留。

旧保护门现场拒绝后，重新完整捕获 `preinstall-delivery-20261113`，保留旧证据。旧新基线间三项外部变化为飞书日志追加 4,087 bytes、runtime events 追加 553 bytes，以及模型费用三个数值；两份日志旧内容均为新内容完整前缀。新备份纳入全部当前内容。安装后和原生同根冷启退出后，350 项资料／配置均全字节保持，3 个原 WebView 来源恢复并复核；全局 prefs 没有字段变化。既有飞书服务未停止。

原生实际完成 11 月 12 日课次登记、取消录入、逐字反思提交、接受、已确认历史、Quit 后同根冷启回读和 About `.112`／正式 `.70`。取消零写，正式记录只有一个 observation、一个 accepted `lesson.review` 和一次 accept review，原文首尾空白和换行保持。私有 data proof 首次误将契约规定的 `sha256:` 摘要与裸 hex 比较而失败，证据保留；依据冻结 Core Hash 契约修正私有断言，14 项正反例通过，随后实际 accepted/cold 重读通过，没有改产品或回写数据。

原生提交后普通课次列表出现两行相同 slot。独立复算确认合成课次 ID 与 occurrence external_id 均规范；冻结 GET 在无完课记录时先输出空占位行，再追加内容行，只有 content-only 查询删除占位行。反思与来源没有重复写入。本版为安装流程部分验收，不公开；保留冻结 tag、Draft 和失败证据，以单独 `.113` 修正普通查询的占位行后继续签名、安装和原生验收。
