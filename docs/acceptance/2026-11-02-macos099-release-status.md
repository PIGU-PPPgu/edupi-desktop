# macOS 0.3.99 安装与 Core-first 验收

2026-11-02：EduPi Desktop [PR #455](https://github.com/PIGU-PPPgu/edupi-desktop/pull/455) 合并为 `bf207ee5c8fc5ca0cdb7ae95ebb7199636c7fca4`，tree `76b18c84857040a24e26ae1474019ddd1d30af77` 与受测 head `9bfb74771ae4241b532e8117979752761e14852f` 相同；Core 固定 `dfcdfaef6e0710e4064a3343453e82da571990a9`。PR [CI 41376568729](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/41376568729) 的 audit、rust-audit、linux-source 全部成功；Core [main CI 41364275615](https://github.com/PIGU-PPPgu/edupi/actions/runs/41364275615) 成功。`.98` 的取消确认误报使其安装版验收失败，原 Draft 不公开；`.99` 只修未启动工作流的状态投影并独立升版。

## 签名资产

唯一 [Mac-only 签名 run 41377353258](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/41377353258) attempt 1 成功；`notary-preflight`、`release`、`build (aarch64-apple-darwin)` 成功，Mac-only 条件下 `draft-proof`、`manifest`、`notify` 跳过。Release `431008048` 的 tag `v0.3.99` 目标精确为上述 Desktop main：

| 资产 | ID | 字节 | SHA-256 |
| --- | ---: | ---: | --- |
| `EduPi_0.3.99_aarch64.dmg` | `700394309` | `238387977` | `3d6201d1e80695b82714773dcfe7762eb10e07574b16ea376d1de44b48657cde` |
| `EduPi_aarch64.app.tar.gz` | `700363765` | `239688267` | `d94380f96afd316d614fa69454bb580cadfbbf635a7ada0c207591419180d476` |
| `EduPi_aarch64.app.tar.gz.sig` | `700364099` | `404` | `cd01ba5421a3d8d88062f00bb98a0f37bfd4007a5d236368f97857f4e080ac4d` |

Mac 集合指纹 `sha256:499931aec061690ded066b4638f778132138ed07afdd8d8d286f2283dbb3af90`。App 公证 Accepted `4b2ed8e3-7498-4ee9-88fb-9e9c788cecc0`，DMG 公证 Accepted `1a21c596-c140-49ff-a851-f7d4c795f22a`。CI 与本机对最终 App/DMG 的装订、strict codesign、Gatekeeper、更新包 Minisign 和篡改拒绝、App/DMG/tar 同身份通过。首次本地分段下载有一片 CDN 90 秒超时，原样保留 59 个完整片段，改该下载脚本单片上限为 180 秒后仅补缺片；三资产完整大小和摘要最终与同轮 Draft 一致。本机挂载与更新包展开后，17 项固定 Desktop/Core 文件与签名包字节一致。原始回执在私有 `~/edupi-install-checkpoints/v0.3.99/evidence/` 的 `signed-*`、`mac-job.log`、`segmented-download-verification.json`、`mac-asset-verification.json` 和 `local-bundle-identity.json`。

## 唯一安装与原生操作

安装前 `/Applications/EduPi.app` 为已签名公证的 `.97`，App/helper 均退出；当前真实资料新基线 347 项、资料回退副本和 3 个 WebView origin 偏好备份经字节核对。新 `.99` 与 `.97` 的 bundle ID、Team ID 及 macOS designated requirement 相同。仅把唯一 `/Applications/EduPi.app` 更新至已验 `.99`，旧 `.97` 保留于 `v0.3.99/rollback/EduPi-before-099.saved-bundle`；文件安装后 347 项基线逐字节不变。

两轮使用明确隔离根 `~/edupi-route1-canary-099-20261102` 与本机回环模型，没有复制真实模型凭据；每次 CUA 前均验证唯一 App/Core helper 的隔离环境。原生确认取消后，工具回执和最终回复均为“工作流未启动”，顶部不再显示假“已完成”图；另一个会话经可见确认运行两阶段流程，先并行读取、再汇总，图显示 3/3。三个私有子会话均实际调用 `read` 并读到合成标题，journal 为 `done` 且权限 `0600`；折叠状态跨页面、冷启回读，取消会话冷启后仍无图。随后只在此合成根种课表／材料和短期本机授权，安装版普通输入走 Core 捕获：持久 outbox 为 `captured=true`、`pi_accepted`，再经原生确认完成同样 3/3；冷启后 outbox/图仍在、子会话总数仍为 6，未重跑。合成主动授权已在安装版设置中停止。设备权限重新检测显示辅助功能和屏幕录制均已授权；关于页显示 `.99`，最新正式版 `.70`。隔离 App 以正常退出快捷键退出，未立即用 CUA 读已退出窗口。对应证据为私有 `native-technical-acceptance.json`、`corefirst-seed.json`、`corefirst-native-099.json`、`corefirst-cold-readback.json` 与本轮 CUA 原生 AX 操作记录。

文件安装、两轮隔离原生操作及最终 WebView 恢复后，347 项受保护资料与本轮安装前基线**全部逐字节一致**；原 3 个 WebView origin 偏好全部恢复。随后为技术核对而在正常资料根启动 `.99`：唯一 App/Core helper 确实使用原配置根、未带隔离标记，未发送真实提示；检查后退出。正常启动会写入运行态，故严格的**全程**字节保持门为失败：提醒环形日志保留原 1986 条活动字节，新增 7 条 `notification_claimed` 和 7 条 `notification_deferred`，最旧 14 条轮出，7 项重试时间更新；一份既有 Pi 会话原 `11,375,642` 字节前缀不变，只追加 `531` 字节的两条 runtime 自定义记录，没有新增 user/assistant 消息；另有 3 个 SQLite 运行文件变化。其他 342 项基线文件不变，无额外受保护文件。现有变化与安装前备份都已封存并原位保留，未以旧备份覆盖。此运行态差异的细项在私有 `normal-startup-data-diff.json`、`normal-startup-generated/`、`protected-data-after-normal-startup-guarded.json`；不能把正常启动的全文件门改写为通过。

## 公开与清理

已将该 Release 发布为 [macOS Apple Silicon 预发布](https://github.com/PIGU-PPPgu/edupi-desktop/releases/tag/v0.3.99)，`prerelease=true`、`draft=false`、`make_latest=false`；匿名 Release 元数据可读，公开 DMG 的前 `65536` 字节范围下载与本机已验资产一致。最新正式 Release 仍 `v0.3.70`（ID `413407109`），`updater-feed` 仍为 `7924328ee893c9527adb54e25b0023e9f2a26ff7`，没有生成 Windows/Linux 包，也没有让旧客户端检测到 `.99`。私有回执为 `publication-receipt.json`、`public-release.json`、`stable-after-publication.json`。

本机清理前逐项核对远端 `.98` Draft 和 `.99` 预发布的资产身份、磁盘空间、目标 Git 跟踪/忽略、DMG 卸载状态与打开句柄。只删除十个精确可重建目标：`.98/.99` 的本地资产下载与分段片、两份更新包解包副本、`.98` 失败测试 App 副本、本任务 `.next/`、`src-tauri/target/` 和独立 `/tmp/edupi-cargo-home-20261102.pKcWDK`。目标分配 `6,828,452 KiB`，同卷可用字节增加 `6,897,954,816`；删除后 Git 状态不变，唯一正式 `.99` 和 `.97` 回退 App 均在。真实资料、两次资料备份、验收日志以及隔离原始回执未清。依据为私有 `cleanup-before.json`、`cleanup-after.json`；隔离合成根及原始子会话暂保留，待不再需要复查 Core-first 证据后按精确路径处理。

另删除本轮自建的三份 `/tmp` PR 正文／脚本临时文件，共 `5628` 字节；只读核实其为普通文件后按精确路径移除，见私有 `cleanup-supplement.json`。

## 保留的技术边界

- 正式更新 feed 因 Windows/Linux 延期仍为 `.70`，旧客户端原位下载/验签升级到 `.99` 未进行；本轮只公开 Mac 预发布。
- 正常资料根启动会产生上述运行态差异，严格全文件字节门失败；已分类、封存和保留当前变化，未证明它们代表业务资料损坏，也不把它们归为“零改动”。
- GitHub 仍有 `minimatch` 中危 [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)。仓库 `npm audit --audit-level=high` 退出 0，已核对 Pi 调用走默认 `optimizationLevel=1`，公告中的放大路径要求 `>=2`；依赖仍未升级，告警未清零。
- Core owner-only 联合来源证明维持只读，`answer_verified=false`、`question_case_verified=false`，产品复合回答继续 held。真实跨到期睡眠按先前安排另约；Windows/Linux 未做安装或 UI 验收。
