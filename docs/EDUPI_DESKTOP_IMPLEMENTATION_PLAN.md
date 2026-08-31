# EduPi Desktop 分阶段实施计划 v1

> 状态：已获用户同意，进入计划冻结与分工阶段
> 研究依据：`../edupi/docs/EDUPI_EDUCATION_WORKBENCH_RESEARCH.md`
> 产品骨架：`../edupi/docs/EDUPI_EDUCATION_MODULE_SKELETON.md`
> 目标：将 `abcwyc/pi-agent-desktop` 改造成教育原生教师工作平台；Pi 对话保留为 AI 协作层，不再作为产品主骨架。

## 0. 交付原则

### 0.1 真实教育工作优先

每个模块必须回答：

```text
教师今天要做什么？
真实输入是什么？
EduPi 处理哪一步？
教师如何确认/修改？
结果写回哪里？
下一步如何复用？
```

不能以漂亮首页、状态卡、空白聊天或模型自述作为完成标准。

### 0.2 单一事实源

桌面前端不建立第二套学生、班级、课程、校历、任务或 memory 数据库。

```text
EduPi safe store + extensions
             ↑
       Desktop API / UI
             ↑
      教师工作视图
```

所有写操作必须经过受控 runtime/extension，保留权限、审核、审计和 rollback 能力。

### 0.3 教师不承担技术配置

普通教师不接触：

```text
Node / npm / .env / App Secret / Webhook Secret
provider secret / API base URL / terminal / worktree
```

Pi session、模型和 channel 配置属于受控运行时，不属于教育前台导航。

### 0.4 安全默认值

```text
scope=teacher_internal
external_send=false
requires_teacher_review=true
content_status=not_generated（没有教师明确操作时）
delivery_status=not_approved
```

学生个人、家校沟通、心理、安全和对外内容需要更严格的人工审核。

## 1. 冻结的信息架构

### 一级导航

```text
今日工作
教学
班主任
教务与校历
学生与班级
材料与证据
待审核与安全
AI 协作
```

### 全局上下文栏

当前所有模块都可以显示/收起：

```text
教师角色
当前班级
当前课程
当前学生
相关校历节点
关联材料
任务状态
审核状态
```

### 角色切换

首版不做复杂 RBAC 管理后台，先支持一个教师同时拥有多个工作身份：

```text
任课教师
班主任
年级/备课组成员
教务协作角色（如有）
```

角色切换改变今日工作和任务视图，但不改变事实源。

## 2. 任务优先级与垂直闭环

### V0：先冻结契约，不扩页面

输出：

```text
education context schema
education task schema
material/evidence schema
review/receipt schema
route permissions
```

验收：TypeScript 类型/JSON schema 可被 API、UI 和 runtime 共同使用；没有字段只在前端自说自话。

### V1：校历 → 教师内部准备（第一条实现闭环）

原因：EduPi 已有 `calendar_import`、`calendar_view`、`calendar_prepare`、`rhythm_planner.mjs`；输入边界小、容易教师低负担验证；不需要先处理家长外发。

流程：

```text
读取/导入校历
→ 确认事件日期和类型
→ 关联班级/课程（缺失则明确待确认）
→ 生成 teacher_internal task
→ 教师接受/修改/拒绝
→ 写回 safe store / evidence
→ restart 后仍可读
```

必须验证：

```text
日期不确定时 hold
不生成家长稿/学生通知
教师编辑提前量或任务交付物
审核结果可回放
rollback 可用
```

### V2：学生事件 → 跟进（第二条实现闭环）

流程：

```text
教师记录一个真实事件
→ 选择学生/班级
→ 填写事实来源与观察
→ EduPi 生成待跟进候选
→ 教师确认/修改
→ 记录跟进结果
→ 如需家校/专业支持，进入审核队列
```

禁止：

```text
自动心理诊断
自动学生定性
未经审核对外沟通
模型直接覆盖学生事实
```

### V3：真实材料 → 教学调整（第三条实现闭环）

流程：

```text
导入作业/讲义/课堂记录
→ 关联课程/班级
→ EduPi 抽取错因/问题模式
→ 教师核对
→ 生成下一课准备/辅导候选
→ 写入材料与证据关联
```

首版不追求完整教案生成，先证明“真实材料加工后能减少重复劳动”。

### V4：教育平台扩展

在 V1–V3 至少有真实教师反馈后再做：

```text
教学：作业与评价、课堂记录、教研
班主任：班会、家访、活动、考勤/值日、安全
教务：考试、会议、冲突、年级组、材料归档
学生成长：综合素质、德育、体育、艺术、实践
教师成长：研修、听评课、课题、个人证据
```

## 3. EduPi 贯穿机制

### 3.1 统一对象

#### EducationContext

```text
teacher_id
roles[]
school_id（可脱敏）
semester_id
class_ids[]
subject_ids[]
current_class_id?
current_subject_id?
privacy_scope
```

#### EducationTask

```text
task_id
source_type: calendar | student_event | material | manual | teaching
source_id
role: subject_teacher | homeroom_teacher | academic_admin
related_student_ids[]
related_class_ids[]
related_subject_ids[]
trigger_at?
due_at?
input_material_ids[]
recommended_action
status: candidate | pending_review | accepted | modified | rejected | completed | held
reviewer_id?
reviewed_at?
evidence_ids[]
external_send=false
```

#### Material/Evidence

```text
material_id
source_type
source_path/hash
teacher_visible_title
related_context
processing_status
provenance
redaction_status
review_status
```

字段最终以现有 safe store 和 runtime 代码为准，以上是产品契约草案，不得直接当作已经实现。

### 3.2 统一 loop

```text
observe → prepare → review/hold → record → replay
```

- observe：只读真实事实和教师提供的材料；
- prepare：抽取、归类、提示缺口；
- review：教师确认、修改、拒绝或要求澄清；
- hold：低置信、日期冲突、敏感风险停住；
- record：通过 safe store/runtime receipt 写回；
- replay：重启和下一轮任务能证明是否加载、是否复用。

### 3.3 统一 AI 路由

AI 协作请求必须携带：

```text
当前教育模块
当前任务
教育上下文
关联材料/学生/班级
scope
review policy
```

通用 Pi Chat 不能绕过模块权限和教师审核门。

## 4. 工作分解与子 agent 分工

### Stream A：产品与真实工作流

负责：

```text
把研究结论转成角色×场景×产出矩阵
冻结 V1–V3 任务
定义真实教师试用脚本
```

产出：

```text
docs/EDUPI_EDUCATION_WORKFLOW_MATRIX.md
```

验收：每个场景有真实输入、教师动作、EduPi 产出和人工判断点。

### Stream B：EduPi runtime 契约

负责：

```text
审计 extensions/safe_store/memory/rhythm planner
统一读取与写入接口
补 task/material/evidence/review 最小契约
```

产出：

```text
edupi/contracts/
edupi/docs/EDUPI_RUNTIME_CONTRACT.md
```

验收：不创建第二事实源；现有 student/calendar/timetable 工具回归通过；写入有审计/权限/回滚路径。

### Stream C：桌面教育前台

负责：

```text
把 AppShell + SessionSidebar 变为教育一级导航
实现 V1 校历准备工作区
让 AI 对话作为当前任务的协作侧栏/入口
```

产出：

```text
edupi-desktop/components/education/
edupi-desktop/app/api/edupi/
```

验收：聊天区不被卡片挤压；教育模块可以独立完成 V1；窗口刷新/重启后上下文一致。

### Stream D：验证与证据

负责：

```text
fixture 只用于隔离测试
真实本地 EduPi 数据读取验证
API/UI smoke test
restart/reload/rollback evidence
hydration/console 检查
```

验收报告必须分层：

```text
代码存在
隔离测试通过
真实 EduPi 数据闭环
真实教师 E5
```

## 5. 阶段路线图

### Phase 0：研究与契约冻结

交付：

```text
需求研究
模块骨架
工作流矩阵
runtime/context/task/material/evidence 契约
```

通过条件：用户确认一级导航和 V1 闭环；不存在仅凭 UI 直觉扩大范围。

### Phase 1：EduPi runtime 可复用层

交付：

```text
教育上下文读取
任务读写/状态推进
材料 provenance
审核与 receipt
safe store 回归
```

不做：完整前端。

### Phase 2：V1 校历准备工作区

交付：

```text
校历导入/查看
节点确认
任务生成
任务收件箱
接受/修改/拒绝/hold
证据回放
```

### Phase 3：V2 学生事件跟进

交付：

```text
学生事件
事实来源
跟进任务
教师观察审核
家校/专业支持审核入口
```

### Phase 4：V3 材料驱动教学调整

交付：

```text
材料导入
材料关联
错因/问题模式候选
教师核对
下一课调整
```

### Phase 5：多角色平台化

交付：

```text
教学完整工作流
班主任工作流
教务协同
成长/德育/实践
教师教研与成长
```

### Phase 6：真实教师 E5

至少：

```text
3 位真实教师或一个真实教研小组
预先冻结 held-out 任务
记录接受/修改/拒绝/追问
独立评估
重启/reload
失败样例与 rollback
```

没有 E5 证据，不称“教师真正需要”或“平台完成”。

## 6. 质量门与停止条件

每一阶段都必须通过：

```text
npm run lint
npx tsc --noEmit
npm run test:release-tools（如适用）
git diff --check
API HTTP smoke
页面 console 检查
```

EduPi 本体还需：

```text
npm test
npm run lint
```

停止条件：

- 发现第二套事实源；
- 外发绕过教师审核；
- 高风险学生内容自动定性；
- 只有 fixture 没有真实数据验证；
- UI 完成但任务无法写回；
- hydration/console 错误未定位；
- 复杂度开始增加教师录入负担。

## 7. 当前立刻执行顺序

1. 汇总子 agent 对产品、runtime、desktop 的审计；
2. 由主 agent 核对文件与建议，不直接采信自报结果；
3. 写入工作流矩阵和 runtime 契约；
4. 选择 V1 校历准备闭环作为第一条实现；
5. 先补 runtime/API 读写契约，再做页面；
6. 用真实当前 EduPi workspace 验证读取和写回；
7. 做 reload/restart/rollback；
8. 再邀请真实教师试用，不把隔离测试当 E5。

## 8. 当前明确不承诺

```text
不是已完成完整教育平台
不是已完成真实教师验证
不是已完成 Tauri 原生桌面交付
不是已完成飞书/钉钉/企微同步
不是已完成心理/安全自动判断
```

本计划的目标是确保后续实现围绕真实教育工作，而不是继续把 Pi Agent 外面装饰成教育产品。
