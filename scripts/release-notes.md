EduPi Desktop 0.3.118，macOS Apple Silicon 正式 Release。

2026-11-18 已完成同源签名、公证、Gatekeeper 校验和精确 DMG 安装。安装验收 run `44318046052` 使用原包两次冷启动，Core／projection ready，SQLite、marker 和模型配置保持，清理通过。首轮 run `44316698278` 的过期 harness Core pin 失败保留；修复仅涉及验收脚本，没有重建或替换安装包。

本版经用户于 2026-11-18 明确批准，以 macOS-only Release metadata 方式正式发布。Rust `RUSTSEC-2026-0543` 维护告警作为本次 macOS 书面例外保留，`cargo audit --deny warnings` 仍失败。Windows 及其他平台不在本次发布范围，没有触发 Windows runner、构建或安装验收。

签名源码为 `7935753ae8296d820010a8e5bb1d7f3d477b72eb`，Core 固定到 `fc89b3bc899a55b0fdad61b8f37e238d950f37c6`，保留主线班级工作与本机账号入口。

增加独立的记忆核验设置与逐问题入口，修复原文、逐项来源、发送恢复和取消撤回的绑定。普通 R04 语义门仍关闭，真实模型验收尚未通过；开启请求不会保存为未来自动生效的状态。

周期材料使用 Core Main4 的独立模板授权。班级与学科须明确选择，创建、定义修改、暂停和恢复交给 Core；确定性内部材料不调用模型。未升级的资料库会先阻止启用，不自动迁移教师数据。

停止先持久关闭本地配置，再关闭运行进程并暂停对应授权。无法确认关闭或撤权时显示待核对，历史内容保留。

升级前端框架、本地 HTTP 服务和 XML 读取的安全依赖，替换受影响的 lint 文件匹配链。干净安装后的 npm 审计全部级别为零；Rust chrono 维护警告按上述例外保留，审计门保持原样。

GUI、正常 Cmd+Q、updater、真实教师流程和模型生成未在本次安装验收执行。正式 GitHub Release 已公开，自动更新 feed 保持原状态，不能据此宣称客户端升级通过；完整 R04、R15 与 L4 不作验收通过。
