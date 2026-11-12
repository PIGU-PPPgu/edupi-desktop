# G4 macOS 0.3.112 发布验收

状态：**发布准备中，未安装、未公开**。授权范围仍为 macOS；Windows/Linux 构建安装暂缓，正式 Latest `.70` 和 `updater-feed` 不切换。实际 App 为退出的 `.108`。

## 当前候选

Core 固定 `98e4f7cd0c31dd30954574d2040bb1b948cdd954`，含隐式课次历史修补与模板测试的有限 snapshot 重试；Runtime component 为 `sha256:46252d3917be4035a8bc9bf4b779b6d6621db0a3caadb71a38bd2da63ffa0bc2`。原 Mac 的完整 Core CI `43162688017` attempt 2 仍在执行，未提前合并。托管 Mac Checkout 长时停滞记录保留，不计产品测试通过。

Desktop 的 scope/恢复/容量边界、512 KiB 最大回执、授权过期历史恢复均已通过各自红绿和独立审查。冻结前版本为 `.112`，原 Rustix `1.1.6` 及其他依赖不变。

## 前轮签名失败与夹具修补

`.111` Draft `442563734` 固定 `1b983400`，`43167121336` 在 macOS Core wiring 的停止/恢复 canary 失败，资产为空，未安装和公开；不 retarget 或复用。完整旧记录见 [`.111` 验收](2026-11-12-g4-macos111-release.md)。

已真实定位：canary 为跨班拒绝场景创建了 foreign `lesson_reflection` active grant，之后未清理；所选 grant 已正确 paused，但生产 preflight 按安全契约拒绝另一个 active grant。单独校验 root、owner、当前 grant 全部通过，拒绝本身没有修改 owner、grants 或 activation。

测试夹具现先证明 foreign active 时恢复 `409 proactivity_grant_denied` 且零修改，再仅对已记录的合成 foreign grant 通过正常 Core CAS 暂停：v1 active→v2 paused，root/owner/id/scope/status 回读及其他授权、activation 不变；之后保留原三域恢复、九份产物、审核、重启和字节断言。生产检查、Root/owner/source/CAS 均未修改。

修补后 legacy 完整 canary 已退出 0，真实模型调用 0。Main4 原发布命令首次因源码未提交而被 clean-source 门拒绝，未绕过或改记通过；需在本版 clean commit 后重跑。日志为共用证据目录的 `desktop-canary-cleanup-{legacy,main4}-20261112.log`。

## 安装保护

`.112` 再次完整备份当前 350 项和 3 个 WebView 来源；`.111` 基线复核仍全字节相同。`.110` 旧基线的两份运行日志追加失败、原始前缀及其余 348 项一致的证据继续保留，不能由新基线追认旧门成功。

私有安装脚本修正了本机 `lsof` exit 1 仍可能有 stdout 的误判：仅干净的空输出可判无匹配；App、暂存 App、整个 profile backup、sessions、WebView 源/备份目录均严格拒绝句柄。仅对真实 `.edupi` 源允许预先固定 PID/UID/PPID/启动与 argv hash 的既有服务，在精确两个日志路径上持有 FD1/FD2 REG/u，并核对设备号/inode；不是忽略整个 PID 或所有日志。原 350 项大小、SHA、备份及安装后检查不放宽，日志真正追加仍失败并保留变化。

上述句柄检查 38 项内存回归、补充的 backup config/WebView sidecar 整合 12 项和独立审查通过；未停止既有飞书服务。签名、公证、三资产验签、原生安装、冷启、资料恢复和公开下载仍待执行。

## 发布门

冻结必须独立成功后再单独触发 macOS-only Draft；版本可用性查询包含私有 Draft。安装/公开前必须 Core463、Desktop489 正常合并，候选提交可达且源码树等于合并树，精确质量门和同轮三资产全部通过。正常合并证明、完整资料保护、失败回退及原生隔离守卫保持。

当前私有证明目录为 `~/edupi-install-checkpoints/v0.3.112/evidence/`，共用命令日志为 `~/edupi-install-checkpoints/g4-release-20261112/evidence/`。自然七天、真实睡眠/系统通知、教学内容质量和跨平台未验，完整 L4 未放行。
