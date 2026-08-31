# Pi Agent

[English](./README.md) | **简体中文**

`pi-agent-desktop` 是一个面向 macOS 和 Windows 的本地 AI Agent 桌面应用。它将 [pi](https://github.com/earendil-works/pi) 的 Agent 能力封装成一个可独立安装的 App。

## 主要功能

- 按项目浏览和继续历史 Pi 会话，无需查找终端历史或 `.jsonl` 文件。
- 在桌面窗口中与 Agent 实时对话，查看思考、工具调用、上下文用量、成本和压缩状态。
- 从历史消息继续分支，或将会话 Fork 为独立会话。
- 管理模型、OAuth/API Key、自定义模型配置、Skills 和 Plugins。
- 在侧边栏切换 Git worktree，并浏览项目文件。
- 预览源码、Diff、Markdown、图片、音频、PDF 和 DOCX 等文件。
- 支持深色模式、会话自动命名、完成提示音和运行状态恢复。
- 每周检查最新的 EduPi Desktop 稳定 Release，并在本地版本落后时提醒用户。
- 通过一个升级按钮安装完整、签名的 Pi Agent 新版本并自动重启。

![Pi Agent 浅色模式界面](./docs/screenshots/pi-agent-light@2x.png)

![Pi Agent 深色模式界面](./docs/screenshots/pi-agent-dark@2x.png)

**[⬇️ 下载 EduPi Desktop（macOS / Windows / Linux）](https://github.com/PIGU-PPPgu/edupi-releases/releases)**

源码仓库：[PIGU-PPPgu/edupi-desktop](https://github.com/PIGU-PPPgu/edupi-desktop)

## 安装与使用

### 安装桌面 App

发布版本可从 [EduPi Desktop Releases](https://github.com/PIGU-PPPgu/edupi-releases/releases) 下载：

- Apple Silicon Mac：下载 `aarch64.dmg`，打开后将 App 拖入 `Applications`。正式 Release 不构建 Intel Mac 版本。
- Windows x64：下载名称以 `x64-setup.exe` 结尾的安装程序并运行。安装器会在需要时安装 Microsoft WebView2。

正式 Release 支持运行 macOS 11 或更高版本的 Apple Silicon Mac，以及 Windows 10/11 x64。桌面包内包含运行 Pi Agent 所需的 Next.js 服务、Node.js runtime 和当前版本的 Pi SDK，打开 App 时会自动启动本地服务，不需要用户另开终端、安装 Node.js 或单独启动 Web Server。

> 安装 Pi Agent 后，可以直接使用 App 中的 Pi Agent 功能；但它不会在系统全局安装 `pi` 命令。如果还需要在终端中使用 Pi CLI，请按照 [pi 项目](https://github.com/earendil-works/pi) 的说明单独安装。

首次启用签名自动升级前，旧的无 updater 版本需要手动安装一次新的签名 App。此后即可在设置中完成升级。

### 使用现有 Pi 数据

Pi Agent 默认读取 Pi 的本地数据目录：

```text
~/.pi/agent/
```

其中会话通常保存在：

```text
~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl
```

如果电脑上已经使用过 Pi，安装 App 后可以继续浏览原有会话、模型和认证配置。可以通过 `PI_CODING_AGENT_DIR` 指向其他 Pi Agent 数据目录。

模型密钥和会话数据保留在用户电脑上；文件浏览 API 仅允许访问当前会话、所选项目和显式授权的工作目录。

## 版本检查与升级

EduPi 最多每七天检查一次 `PIGU-PPPgu/edupi-releases` 中的最新稳定桌面版。打包组件清单同时记录已审核的：

- `earendil-works/pi`
- `agegr/pi-web`

版本与升级规则如下：

1. `PIGU-PPPgu/edupi-releases` 中的最新稳定 Release 是桌面升级提醒和下载的唯一来源。
2. 三个组件中任意一个版本落后，设置中的统一升级按钮都会启用。
3. 如果多个组件需要更新，发布自动化按 `pi → pi-web → pi-agent-desktop` 的顺序同步和验证。
4. 用户侧不会修改已安装 App 内的单个 JavaScript 包，而是下载一个同时包含三个最新版组件的完整签名 App。
5. 安装完成后 App 自动重启，使三个组件一次性进入同一个经过验证的发布状态。

这种方式可以保持桌面安装包的组件一致性，也能避免独立替换 `pi` 或 `pi-web` 导致运行时不兼容。

如果上游新版已经被检测到，但包含该版本的签名 EduPi Desktop Release 尚未发布，设置页会提示暂时没有可安装的签名整包；App 不会退回到下载未签名文件或局部覆盖依赖。

更完整的同步、签名和 Release 配置见 [桌面升级与发布说明](./docs/desktop-updates.md)。

## HTTP 代理

Pi Agent 的服务端模型和 API 请求支持标准的 `HTTP_PROXY`、`HTTPS_PROXY` 和 `NO_PROXY` 环境变量。例如从终端启动开发服务时：

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 \
npm run dev
```

## 本地开发

### 环境要求

- macOS 11+（Apple Silicon）或 Windows 10/11 x64
- Node.js 22（推荐）
- npm
- Rust 1.85+
- macOS：Xcode Command Line Tools
- Windows：Microsoft C++ Build Tools 与 WebView2

### 启动 Web 开发服务器

```bash
npm install
npm run dev
```

开发服务器运行在 [http://localhost:30141](http://localhost:30141)。

日常开发期间不要运行 `next build` 或 `npm run build`。这些命令会写入 `.next/`，可能干扰正在运行的开发服务器；正式构建由桌面准备脚本或 CI 完成。

### 启动桌面开发模式

```bash
npm run desktop:dev
```

该命令会启动现有 Next.js 开发服务器，并使用 Tauri 原生窗口打开页面，不生成安装包。

### 常用检查

```bash
# Node 测试（与 CI 同步门禁完全一致，含 components/ 测试）
npm test

# TypeScript
node_modules/.bin/tsc --noEmit

# ESLint 与品牌保护测试
npm run lint

# 与 pi-web 上游的偏离度：区分「样式类」与「结构类」改动
npm run drift

# Rust/Tauri
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings

# 检查打包组件是否与最新稳定 Release 一致
npm run release:verify
```

`release:verify` 会访问 GitHub，并要求内置的 `pi`、`pi-web` 精确匹配各自最新稳定 Release，同时检查组件清单是否与实际依赖一致。

## 桌面打包

```bash
npm run desktop:build
```

桌面构建流程会：

1. 在隔离目录中生成 Next.js standalone 服务。
2. 打包当前架构的 Node.js runtime。
3. 将服务和运行时作为 Tauri Resources 放入 App。
4. 在 Apple Silicon Mac 上生成 `.app`、`.dmg` 和 updater 产物；在 Windows x64 上生成 NSIS `-setup.exe` 和 updater 产物。

本地构建默认不注册生产 updater，不能接受正式更新。正式 Release 必须通过 GitHub Actions 注入 updater 公钥，并使用对应私钥签名。

## 上游同步与 Release

仓库将桌面上游审核、组件维护和正式发布分开处理：

- [`desktop-upstream-sync.yml`](./.github/workflows/desktop-upstream-sync.yml)：每天以只读权限检测 `abcwyc/pi-agent-desktop` 变化。发现变化后只更新受管的 `sync/upstream-desktop` 分支，排除公共上游的 workflow 定义；完整测试、类型检查、lint 和 EduPi 发布目的地哨兵全部通过后，才创建或更新以 `main` 为目标的审核 PR。它永远不直接推送 `main`，也不签名、发版或调度发布工作流。
- [`component-updates.yml`](./.github/workflows/component-updates.yml)：手动检查已发布的 `pi` 和 `pi-web` 组件，使用 [`scripts/fork-ownership.json`](./scripts/fork-ownership.json) 分类改动，并执行现有的组件边界策略。
- [`release.yml`](./.github/workflows/release.yml)：独立的纯手动工作流，串行构建 Apple Silicon (`aarch64`) DMG、Linux x64 `.deb` 和 Windows x64 NSIS `-setup.exe`。只有所有平台和组件清单都成功时，草稿 Release 才会发布。

`abcwyc/pi-agent-desktop` 只作为已署名的桌面上游，不是 EduPi 源码或发布目的地。合并冲突会在推送分支之前停止；无冲突合并仍需人工检查 EduPi 品牌、教师工作流、updater 目的地和 fork 自有行为。完整约束见 [桌面上游同步](./docs/desktop-upstream-sync.md)；`pi-web` 边界规则仍见 [维护边界说明](./docs/ownership-boundaries.md)。

桌面同步失败会保留失败的工作流记录，并保持 `main` 不变。该工作流无法访问签名或发布凭据。

正式发布前需要配置：

- Tauri updater 公私钥；
- 面向外部用户分发时所需的 Apple Developer ID 签名和公证；
- 面向 Windows 外部用户分发时建议配置 Authenticode 代码签名证书；未签名的 `.exe` 可能触发 SmartScreen 提示。

## 项目结构

```text
app/
  api/                  Next.js API：Agent、会话、模型、文件和更新检查
components/             页面、聊天、侧边栏、设置和版本提醒
hooks/                  会话流、音频、拖放、主题等客户端状态
lib/                    AgentSession、HTTP 代理、会话读取、文件安全和升级逻辑
scripts/                桌面打包、组件版本同步和 Release 校验脚本
src-tauri/
  capabilities/         Tauri 权限配置
  resources/            桌面资源与组件版本清单
  src/                   桌面窗口、本地服务和 updater 注册
.github/workflows/      上游审核、组件维护与桌面 Release 自动化
instrumentation.ts     Next.js 服务端 HTTP 代理初始化
```

## 相关文档

- [维护边界说明](./docs/ownership-boundaries.md) — 与 `pi-web` 上游的分工、改共享文件的规则、自动同步的判定逻辑
- [桌面上游同步](./docs/desktop-upstream-sync.md) — 只读检测、审核分支门禁、幂等更新与发布隔离
- [桌面升级与发布说明](./docs/desktop-updates.md)
- [Git Worktree 使用说明](./docs/worktrees.zh-CN.md)
- [Pi Session 与项目架构说明](./AGENTS.md)

## 署名与许可证

EduPi Desktop 基于 MIT 许可的 [abcwyc/pi-agent-desktop](https://github.com/abcwyc/pi-agent-desktop) 桌面上游，核心能力和 Web 界面分别来自 [earendil-works/pi](https://github.com/earendil-works/pi) 与 [agegr/pi-web](https://github.com/agegr/pi-web)。感谢这些项目及其贡献者。

本仓库根目录代码遵循 [`LICENSE`](./LICENSE) 中的 MIT License。三个组成项目的代码和依赖同时受各自仓库许可证约束；复制、修改或重新分发时请保留相应版权与许可声明。
