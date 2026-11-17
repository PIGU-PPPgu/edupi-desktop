# 班级与账号主线集成

本记录接续本轮 R24.1–R24.4a，覆盖将旧工作树中的已实现功能迁入当前 Core 与 Desktop 主线。产品继续使用 EduPi。原目录、已有未提交修改和现有安装版均保留；本轮不打包或发布。

## 版本与环境

- Desktop 起点：`c19cd15d9516bc6894aee88721025ea5c7d9063a`；分支 `codex/classroom-account-integration-20261117`。
- Core 起点：`64930d5da09667478f340a17a57805fe1ad5b910`；配套集成分支 `codex/core-classroom-integration-20261117`。正式固定身份以本提交的 `contracts/edupi-core-compat.json` 为准。
- 本机 macOS / arm64，Node `22.23.1`，时区 Asia/Shanghai；两个新工作树分别使用自身锁文件安装依赖。
- 页面使用独立临时数据根、六名明确标记的合成学生和独立账号凭据目录。账号服务为本机合成 HTTP fixture，其二维码为单像素测试占位图，不能用于真实微信登录。

## 已执行检查

| 检查 | 结果与证据 |
| --- | --- |
| 初始账号服务、账号 API、班级 API、AI 工具 | 21 pass / 0 fail / 0 skip；`targeted-initial.log` |
| 独立审查发现后的定向回归 | 最终 26 pass / 0 fail / 0 skip；包含迟到 401、自然过期重登、乱序方案读取、已关联方案恢复，见 `targeted-final.log` |
| Desktop 全仓 | 同步当前 Bridge schema 与 fixture 后 4351 pass / 0 fail / 51 条件 skip；`desktop-full.log` |
| 真实 Core 服务 E2 | 六组流程全部通过，见 `classroom-service-e2.json`；对应预修补候选 `976c6e64`，后续 Core 安全修订后再次复验 |
| 路由类型与 TypeScript | typegen 通过；`tsc --noEmit --incremental false` 通过，见 `typegen.log`、`typecheck.log` |
| lint | 0 error / 1 既有 warning；branding 2 pass，见 `lint.log` |
| 依赖审计 | high 阈值通过，仍有 1 low、3 moderate；未改变依赖，见 `dependency-audit.log` |

初次全仓有四处失败：新增样式放在共享 disclosure 样式之后；班级入口拆分不符合原源码哨兵；增加工具后注册数量断言未更新；主线既有验收文档包含本机个人路径。已分别调整样式次序、保留窄化后的 `props.view`、明确增加两种根下的 classroom 工具断言、脱敏文档路径；未删除保护断言。

## 实际界面

采用 ego-browser，在同一 TaskSpace 和同一页面完成。先运行未配置模式，再在同一隔离数据根启用本机合成服务。

| 操作 | 已观察结果 |
| --- | --- |
| 设置 → 教师信息 → 账号，未配置服务 | 显示未配置且不生成二维码 |
| 设置搜索“扫码 登录” | 唯一结果“账号”，点击进入对应卡片 |
| 创建扫码 → 等待 → 已扫码 → 合成手机确认 | 页面显示同一合成账号 `synthetic-teacher-1` |
| 绑定手机号和邮箱 | 页面显示三种已验证身份，账号 ID 保持；不代表真实归属验证 |
| 二维码过期 → 刷新 | 旧图隐藏，显式刷新创建新请求并完成上述登录 |
| CSV → 同名阻断 → 人工匹配 → 程序计算 → 保存 | `60,80,100,70` 显示均分 77.50、样本标准差 17.08，保存 v1；没有猜测同名学生 |

Core 严格 pin 尚未更新的中间阶段，教育工作区返回 503，账号客户端仍可独立验收；这段观察不计作班级流程通过。正式配对后的首次成绩保存通过；并行修改 Core 源码触发 `Component size mismatch`，输入仍保留，隔离服务已停止。待修复版本冻结后重启，继续调整、重开和任务联动。

实际服务 E2 首次暴露新写者拒绝旧 one-shot 后续写入，已改为先连接常驻 runtime；随后快照严格身份拒绝 Desktop 原固定的 Bridge hash，已同步当前 Core 官方 schema、五份 fixture 和校验常量。Core mirror 测试还发现两个冻结的清单原始字节摘要未更新，已按实际产物更新，保留对组件 payload 与原始文件的双重校验。

## 独立审查

只读审查复现了三个 P2：绑定取消使迟到 401 失效处理被屏蔽、慢 URL 读取覆盖后来编辑、任务关联后历史恢复入口被禁用。对应修复按凭据身份失效、共享请求序号和 Core 恢复校验实施，并增加实际 React 与 HTTP 回归。

复审发现自然过期后已创建的新登录 flow 会被旧刷新 401 清除；修复保留独立登录的 pending 和 generation，仍使旧凭据及其绑定 flow 失效。最终窄复审通过，账号 16/16 回归通过，无剩余发现。

Core 独立只读审查另发现发布前当前名单未重验、关联后原 create_task 无法幂等重放、文件 lstat 与重开之间有替换窗口；三项正由 Core 修补，尚未合并。PR472 的首轮 Mac CI 在 checkout 阶段因自托管 runner 连接 GitHub 超时失败，没有运行代码检查；Windows job 为 skipped。

## 未验证与范围

未部署真实账号后台、小程序确认端、短信或邮箱服务；未执行真实微信扫码或生产身份归属验证。未验证安装版、原生 WebView 交互、Windows/Linux 页面与真实模型自然语言选工具。Windows runner、构建、安装和升级作业按用户要求保持暂停；源码 PR 与 merge 不触发这些作业，也不触发 Release。

成长报告、行为评价、风险 SOP 和班主任行动地图仍未实现，接入位置见 `docs/architecture/classroom-integration.md`。
