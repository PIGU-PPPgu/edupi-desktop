# 自动下载安装

## 范围

现有更新检测可用，但 v0.3.5 未内置更新公钥，Rust 未注册 updater 插件。旧用户需覆盖安装一次启用版；后续保留同一个公钥验证更新。

## 发布

- 专用私钥仅存受限本机配置目录和 GitHub Secrets，不提交源码。
- v0.3.6 使用既有 release.yml 生成平台安装包、签名和 latest.json。
- Linux 补 AppImage，Debian 安装包不能替代 Linux updater 产物。
- 各平台质量和构建成功后才能公开 Release。
- 更新包签名不等于 Apple 公证或 Windows Authenticode；不宣传为已获系统认证。

## 验收

- [x] 更新公钥配置、发布工作流定向测试 27 项通过。
- [x] 远端平台包、签名、latest.json 完整。v0.3.6 已公开；Mac/Windows 构建通过，Linux 最终运行 34057453397 的 build/manifest 通过。
- [x] 本地启用 updater 的 0.3.5 测试包检查到 0.3.6。安装版 `/api/updates?refresh=1` 返回 updateAvailable=true。
- [x] macOS 实际下载、签名验证、安装、重启到 0.3.6；教师身份、课程和 27 条记忆可见，工作区 HTTP 200。不是全面数据一致性审计。
- [ ] Windows 安装内升级实机验收；构建通过不代表实机通过。

升级前保留旧应用，更新失败不删除教师数据。签名私钥不得重新生成替换，否则已安装客户端将无法验证后续更新。

## 2026-09-07 实际结果

- 发布地址：https://github.com/PIGU-PPPgu/edupi-desktop/releases/tag/v0.3.6
- PR #60、#61、#62、#63、#65、#66、#67、#68 已合并，分别修复发布配置、质量检查顺序、npm 命令、Linux 构建库、Windows 文件检出、单平台重试、AppImage 处理和错误 libc 可选包。
- 完整发布包含 Mac tar.gz + sig、Windows exe + sig、Linux AppImage + sig、latest.json 与组件版本文件。
- 本机当前是启用 updater 的 0.3.5 验收包，原应用备份 `/tmp/edupi-before-updater.r1k28J/EduPi.app`。未声称已经自动升级至 0.3.6。
- 原生点击验收受阻：Orca 报 `permission_denied`，应用有可见窗口但 AX 无法读取；权限查询显示 granted，restore-window 重试仍失败。需要可访问的桌面会话后继续“检查更新→升级→重启→版本/数据核对”。不绕过系统访问限制。
- 构建临时 Core checkout token 已从 GitHub Secrets 移除；正式 updater 签名密钥保留供后续版本使用。
- 旧的无 updater 版本必须先手动覆盖安装一次 v0.3.6，以后才具备应用内更新能力。

### 解锁后完成原生验收

用户解锁后，通过设置中的“检查更新→更新”实际升级。首次原生清单请求发生网络错误，手动重试后成功进入安装并重启。未绕过签名校验，未用手动拷贝替代此次升级。

应用进程从 44392 变为 12712；Info.plist 显示 0.3.6，界面管理中心显示 v0.3.6；安装版检查接口返回 currentVersion=latestVersion=0.3.6。工作区接口 HTTP 200，教师身份、学科年级、课程及记忆仍可读取。此前窗口访问阻塞已解除；上文 0.3.5 状态为历史记录。Windows 和 Linux 的安装内升级尚未实机验证。
