EduPi Desktop 0.3.71 macOS Apple Silicon 技术试用候选，Release 保持 Draft。

此候选固定待合并的 Core [#286](https://github.com/PIGU-PPPgu/edupi/pull/286) 提交 `d510792d8eb52a321825afc3808ba2006d3f67cd`。Core 修复旧校历来源删除后备课任务及提醒复活、长课表槽位误关联，以及材料撤销后反馈目标仍可用的问题。Desktop 增加六类删除与恢复的合成端到端回归，并按 Core Runtime schema、Bridge 与双组件清单固定身份。

本轮只构建 macOS Apple Silicon。Windows 构建和原生检查按用户指令暂缓，Linux 亦不纳入本次候选；因此没有三平台同轮资产证明，不公开 Release、不更新七平台 updater feed。当前公开安装版仍为 v0.3.70。只有这份候选实际完成 Mac 签名、公证、包内 Core 身份和隔离根安装验收，才能记录对应的 macOS 技术结果；它不替代 Core #286 的最终合并 pin 或后续三平台发布门。

教师资料、模型配置和默认安全门不因候选改变。G1/G2/G3/G4 Live 默认关闭，外部发送不自动开启；未核实材料和 DOCX 建议继续待教师审核。
