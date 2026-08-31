# EduPi Desktop 一天上线检查

## 发布目标

让第一次打开 EduPi 的教师在三分钟内完成关键配置，并能找到模型、教师与学生、校历课表、上传内容、任务产物和系统状态。Desktop 继续只做 Core 的投影与控制器，不新增教育事实存储。

## 本轮 P0

- 底部单一「管理中心」入口，不再把教育设置、应用设置和模型设置拆散。
- 管理中心展示 Core、默认模型、教师身份、校历、课表、名单和首份材料的真实就绪度。
- 直接复用现有 ModelsConfig 管理厂商、Base URL、凭证、模型发现与连接测试。
- 学生档案按真实能力标注为查看、检索和「让 EduPi 更新」，不伪装直接 CRUD。
- 校历课表、材料、工作区和应用设置进入现有 typed flow。
- 待接入材料支持授权、限长、精确 ID 的 `teacher_cleanup` 移除；已接入材料仍不可删除。
- 首页持续显示教育资料就绪度和准确下一步。
- Core 读取失败时同时提供重试和管理中心入口。

## Go / No-Go

发布前必须全部为绿：

1. `/api/edupi/status` 返回 Core 与 education_workspace 均 ready。
2. 管理中心显示默认模型，并在「管理模型服务」内完成一次真实连接测试。
3. 用真实图片或 PDF 完成一次：上传 → 识别 → 日历/课表或材料回执出现。
4. 学生档案、日历月视图、工作区任务卡、任务详情抽屉均可打开。
5. Cmd/Ctrl+K、托盘 Quick Entry、EduPi 已完成收件箱可用。
6. `npm test`、typecheck、lint、audit、Rust tests 全绿，浏览器控制台无新错误。

任一条件失败则不做全量推广；先维持小范围演示。

## 推广顺序

1. 内部教师账号 2–5 人，使用真实校历和一份非敏感材料。
2. 观察至少一个自动任务进入 `draft_ready`，确认通知、收件箱与产物打开正常。
3. 扩至一个教研组；当天保留人工支持群和问题登记。
4. 错误率、Core 503、模型失败或数据不一致没有新增后再全量开放。

## 观察信号

- 健康：`GET /api/edupi/status`。
- 模型：ModelsConfig 连接测试结果；`model_unavailable` / `prompt_failed` 次数。
- 教育投影：`GET /api/edupi/education` 的 503 与读取耗时。
- 摄入：待接入材料数量、识别失败、receipt 是否生成、成功后 staging 是否清空。
- 自动工作：`draft_ready`、`generation_failed`、过期/stale 任务数量。
- 客户端：浏览器控制台新错误、页面永久 loading、不可点击入口。

## 回滚

- 本轮没有数据库或 bridge schema 迁移；教育事实仍归 Core。
- 若管理中心或材料清理出现问题，回滚 Desktop 到 `1148a1ab1bed566943c2d545e5618ca75c64501f`。
- 若 C9 自动执行异常，Desktop 仍固定 Core `5538021f171a647d87562d91e5ab953f794e2331`；停止推广并回滚对应 Core PR，不手工编辑 `.edupi` JSON。
- 暂存清理只删除尚未接入的 Desktop staging 副本；原始教师文件不受影响。

## 已知边界

- 当前主机的真实材料识别曾返回 `prompt_failed`；必须在推广前用目标模型重新跑连接与真实材料识别，不能用 fixture 代替。
- 学生档案删除、已接入材料删除、任务删除和校历删除尚无 typed Core command。
- 通知点击直达产物、系统级键盘快捷键和 execution revision 仍是后续切片。
