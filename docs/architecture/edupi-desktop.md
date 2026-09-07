# EduPi Desktop 架构

[返回产品说明](../../README.zh-CN.md) · [交互图](./edupi-desktop.html) · [SVG](./edupi-desktop.svg) · [JSON 图源](./edupi-desktop.archify.json)

图展示桌面应用的主要运行关系，依据 Desktop 提交 `8740ddc471b4667f890d045850b36e7740fdfe60`。它不表示所有 API、后台任务或工具调用，也不表示运行时性能与可用性已经经过测试。

![EduPi Desktop 架构](./edupi-desktop.svg)

## 源码依据

| 图中节点 | 实现与职责 |
| --- | --- |
| Tauri 桌面壳 | [`src-tauri/src/lib.rs`](../../src-tauri/src/lib.rs) 创建窗口、启动打包服务、解析 Core 和数据目录；[`lib/desktop-native.ts`](../../lib/desktop-native.ts) 封装前端原生调用。 |
| 教师工作台 | [`components/EduPiWorkspace.tsx`](../../components/EduPiWorkspace.tsx) 与 [`EduPiWorkspaceViews.tsx`](../../components/EduPiWorkspaceViews.tsx) 组织教师视图、材料、任务与审核入口。 |
| 本地 API | [`app/api/edupi/status/route.ts`](../../app/api/edupi/status/route.ts) 提供教学状态；[`lib/edupi-core-snapshot.ts`](../../lib/edupi-core-snapshot.ts) 解析运行根目录并读取 Core 快照。Agent API 是同一 Next.js 服务内的另一组路由。 |
| EduPi Core | [`lib/edupi-core-process-client.ts`](../../lib/edupi-core-process-client.ts) 通过 `spawn(process.execPath, [runtime.entrypoint])` 启动独立进程，用标准输入输出传输 JSON。该节点表示桥接进程；Core 代码本身来自配套仓库。 |
| 教学数据 | [`lib/edupi-core-root.ts`](../../lib/edupi-core-root.ts) 校验独立数据根目录和 `.edupi/memory`、`.edupi/output`、`.edupi/locks`；[`lib/edupi-task-review.ts`](../../lib/edupi-task-review.ts) 通过 Core 命令审核任务并检查回执。 |
| Pi AgentSession | [`lib/rpc-manager.ts`](../../lib/rpc-manager.ts) 在 Next.js 进程内创建 SDK services 和 AgentSession，管理提示、工具和会话生命周期。 |
| 模型服务 | [`lib/rpc-manager.ts`](../../lib/rpc-manager.ts) 使用配置的 provider/model；SDK 执行推理调用。图中“外部”表示 Agent 外的模型服务，具体是否经过远程网络取决于 provider 配置。 |
| Pi 数据 | [`lib/session-reader.ts`](../../lib/session-reader.ts) 读取历史会话，AgentSession 使用 SDK 持久化会话；模型与认证设置由 Pi 的数据目录管理。 |

箭头表示主要调用或持久化方向。`HTTP / SSE` 合并表示前端请求与服务端事件返回，未分别绘制每条响应线。浏览历史会话还存在 API 到会话存储的只读路径，不需要创建 AgentSession。

## 需要保留的边界

- **Core 代码与数据分开**：固定 Core 身份在 [`contracts/edupi-core-compat.json`](../../contracts/edupi-core-compat.json) 中。安装包默认读取内置 Core，教师数据使用托管或已选目录。
- **扩展也在 Agent 中运行**：[`lib/edupi-runtime.ts`](../../lib/edupi-runtime.ts) 准备教育资源，`rpc-manager.ts` 加载 Core 扩展与技能。独立桥接进程并不表示全部教育逻辑都只在该进程运行。
- **教师审核是独立操作**：教学命令检查能力清单、快照与回执。任务和会话的绑定由 [`lib/edupi-task-sessions.ts`](../../lib/edupi-task-sessions.ts) 管理，写入单独的绑定文件。
- **原生能力有专门入口**：文件对话框、保存、通知和窗口操作通过 Tauri 能力配置。`edupi_computer_use` 的审批与原生执行见 [`lib/edupi-computer-tool.ts`](../../lib/edupi-computer-tool.ts) 和 [`src-tauri/src/lib.rs`](../../src-tauri/src/lib.rs)，不等同于普通 Web API。

## 重新生成

使用 [Archify](https://github.com/tt-a1i/archify) `2.17.0-dev.1`，本次工具源码固定在 [`c6519401f7b91b9d43011657880893b0a8955548`](https://github.com/tt-a1i/archify/tree/c6519401f7b91b9d43011657880893b0a8955548)。生成工具不属于应用依赖；无需为了运行 EduPi 安装 Archify。

准备该版本的 Archify 源码，在 Desktop 仓库根目录执行。将 `ARCHIFY_ROOT` 替换为源码内的 `archify` 子目录：

```bash
export ARCHIFY_ROOT=/absolute/path/to/archify/archify
export ARCHIFY_UPDATE_CHECK_DISABLED=1

node "$ARCHIFY_ROOT/bin/archify.mjs" validate architecture \
  docs/architecture/edupi-desktop.archify.json \
  --repo-root . --quality showcase --json

node "$ARCHIFY_ROOT/bin/archify.mjs" deliver architecture \
  docs/architecture/edupi-desktop.archify.json \
  docs/architecture/edupi-desktop.html \
  --repo-root . --quality showcase --json

node "$ARCHIFY_ROOT/bin/archify.mjs" visual-check \
  docs/architecture/edupi-desktop.html --json
```

图源中的 `meta.repository.revision` 固定了源码版本。更新架构时先核对实现，再更新 revision 和节点的 `sources`。校验成功后打开生成的 HTML，通过“导出”选择 SVG，保存为 `edupi-desktop.svg`。不要直接修改生成的 HTML 或 SVG。

GitHub README 使用 SVG；交互 HTML 需下载后在浏览器打开。HTML 自带查看器，SVG 支持浅深主题。生成的查看器代码保留 [Archify MIT 许可](./Archify.LICENSE.txt)。

## 本次验证

完整文件摘要和测量结果记录在 [`edupi-desktop.receipt.json`](./edupi-desktop.receipt.json)。

- `validate` 与 `deliver` 成功，showcase 检查 **9/9**，0 错误、0 警告，8 个源码引用已核验。
- `visual-check` 成功，1440×900、1600×1000、1920×1080、2048×1320 无溢出。
- 已检查 1440×900 浅色与 2048×1320 深色截图，节点、标签、连线没有遮挡或裁切。
- SVG 经查看器导出，回执为 `canonical=true`，无导出错误。

这些结果验证图的生成与展示，不替代 EduPi 应用的端到端测试。
