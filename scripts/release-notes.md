EduPi Desktop 0.3.95，macOS Apple Silicon 技术候选。

配对的 Core 新增受本机 owner 控制的单来源只读证明。教师在对话中检索一份记忆时，Desktop 读取当前来源与 Goal 绑定状态；证明不会变成教学答案判定、复合来源放行或外发许可。来源证明失败保留待核验状态，不进入模型提示。Core 同时更新了重定向与查询字符串依赖的安全版本。

Bridge v1.1 现有 12 条命令继续可用；另 8 条旧命令及 `external_delivery`、`teacher_outcome_evidence` 仍未开放。新合同不改变教师确认与默认不外发规则。

本轮只构建 macOS。Release 保持 Draft，不更新公开 feed，不构建 Windows/Linux。
