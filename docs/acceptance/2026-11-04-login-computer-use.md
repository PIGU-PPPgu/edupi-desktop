# 智学网登录与电脑操作

## 2026-11-04 源码候选

老师的真实 EduPi `.104` 会话中，近期 14 次 `edupi_computer_use` 全部只传 `action=status`，实际状态回执已显示桌面控制、辅助功能和屏幕录制均开启／授权；没有一次 `observe`，所以 Agent 声称“直接上手”时并未看到桌面。该 App 的工具提示原先要求先查 status，又要求网页交互使用“受管理浏览器工具”，但当前会话没有调用此类工具。Desktop 源码现让明确的电脑操作请求优先 `observe`；status 回执明确说明没有看屏幕，给出下一步工具参数；已打开的浏览器可由现有 NomiFun 操作，仍保留每次原生确认、快照绑定及拒绝外部 URL 的边界。本轮没有拷入另一套 GUI；当前已 vendored 的 NomiFun 来源固定在 `src-tauri/resources/third-party/nomifun/SOURCE.md`，智学网代码使用 Playwright。

同一会话中的 `zhixue_login` 曾返回二维码，日志在 2026-11-04 02:07 北京时间记录服务端登录成功；之后 `zhixue_sync` 多次返回“正在进行”，实际状态文件为 `error`。代码原因是 `syncRunning()` 只看十分钟内的时间戳，把 `error` 也当运行中；登录、检查、同步共用一个 Playwright 持久 Chrome profile，日志出现 `ProcessSingleton` 冲突；旧 `zhixue_check.js` 在 `try` 中直接 `process.exit`，`finally` 的浏览器关闭不会可靠执行。当前本地自定义扩展已改为运行状态加 PID 判定、登录与同步互斥、独立查询扫码／同步状态，登录检查先关闭 context 再退出且不删除过期会话快照。Desktop 同一教师请求的登录和同步各限一次。

四个本机自定义代码文件及原 `session.json` 已在私有 checkpoint `~/edupi-install-checkpoints/zhixue-login-computer-20261104/backup/` 按 SHA-256 备份；只修改 `extensions/zhixue_bridge.ts`、`scripts/zhixue_sync.sh`、`data/zhixue/scripts/zhixue_check.js`，真实会话令牌文件未改。备份、测试与差异未进入 GitHub。模拟 Playwright 的有效／过期两条路径均证明 context 先关闭，过期快照保留；合成同步脚本证明先写 `running` 再写终态；隔离扩展测试证明登录占用时不抢 profile，旧 `error` 不再伪装运行。本机把原令牌快照复制到私有临时 profile，对智学网服务端连续两次校验均为有效，分别约 4.3／2.7 秒，两个 Chrome 进程均正常退出；原会话文件字节不变，临时克隆已删除。以上只验证登录有效性和同步入口，**未拉取真实学生数据，也未用真实模型触发 native observe**。

Desktop 电脑操作／防重复源码 [PR467](https://github.com/PIGU-PPPgu/edupi-desktop/pull/467) 已合 main `6d866f3d33230aa7cceb8f2a02ce2a616413204a`。主要改动 head `5ec3bccc` 的[手动源码 CI41698331354](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/41698331354) 三项成功；后续只补权限未知时仍引导 observe 的 1 行判断与目标测试，最终 PR head `2e6af44c` 的 6 项目标测试、类型和差异检查通过，没有把旧 CI 冒充最终 head 的 CI。主要改动本机目标测试 10/10、完整 `npm test` 3562 通过／48 条件跳过／0 失败、类型、release:verify、lint 0 错误／1 条既有警告通过；最终 `.105` 工作树的 Mac `desktop:prepare` 重新完成并固定 Core `008d3e63` 的 13,337 文件闭包，隔离 staged 冷启动 Core 与投影 ready、`externalSend=false`。当前唯一 `/Applications/EduPi.app` 仍为运行中的 `.104`；`.105` 版本候选尚未自身 CI、签名、安装或公开。Windows/Linux 本轮不构建。后续需 `.105` 精确源码 CI 与 Mac-only 签名，再在隔离安装版验证原生 observe 确实弹确认并返回快照；真实智学网数据刷新须另按最小权限和资料保护执行。
