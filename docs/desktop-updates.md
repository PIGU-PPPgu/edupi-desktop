# EduPi Desktop 更新与发布

EduPi Desktop 使用 Tauri 的完整包更新。教师安装一次正式签名版本后，后续版本会走同一条闭环：

1. EduPi 启动后检查最新稳定 Release；
2. 有新版时在工作台右下角提示，并在“应用与桌面设置”显示版本与“更新”按钮；
3. 教师也可以随时点击“检查更新”；
4. EduPi 下载经过 updater 私钥签名的完整安装包，验证后安装并重启；
5. 关闭提醒只延后当前版本一周，更高版本会重新出现。

普通 Git commit 不会直接更新教师电脑。只有完整质量门通过并发布为 GitHub Release 的版本才会被客户端识别。

## 仓库边界

- 公开源码：`PIGU-PPPgu/edupi-desktop`
- 公开二进制发布：`PIGU-PPPgu/edupi-releases`
- 客户端清单：`https://github.com/PIGU-PPPgu/edupi-releases/releases/latest/download/latest.json`

源码仓库公开代码与审阅记录；独立发布仓库只保存 DMG、Windows 安装程序、Linux 包、updater 压缩包/签名、`latest.json` 与组件版本清单。客户端必须能够匿名读取发布仓库，否则普通教师无法检查或下载更新。

## 一次性外部配置

### 1. 创建公开二进制仓库

创建公开仓库 `PIGU-PPPgu/edupi-releases`，保留 `main` 默认分支。正式工作流会跨仓库创建草稿 Release，只有 macOS、Windows、Linux 和组件清单全部上传成功后才发布为 latest。

### 2. 创建永久 updater 密钥

在可信机器上只生成一次：

```bash
npm exec tauri signer generate -- -w ~/.tauri/edupi-desktop.key
```

将以下值写入源码仓库的 GitHub Actions Secrets：

- `TAURI_SIGNING_PRIVATE_KEY`：私钥文件内容；
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：生成私钥时使用的密码；
- `TAURI_UPDATER_PUBLIC_KEY`：对应 `.pub` 文件的完整 Base64 内容；
- `EDUPI_RELEASE_TOKEN`：只授予 `PIGU-PPPgu/edupi-releases` Contents 读写权限的细粒度令牌。

不要轮换 updater 密钥，除非先实现密钥迁移。已安装客户端只信任构建时嵌入的公钥；丢失私钥会让这些客户端无法自动升级到新密钥版本。

### 3. 操作系统签名

Tauri updater 签名负责应用内更新完整性，但不会消除系统安装警告。面向校外公开推广前仍需配置：

- Apple Developer ID 与 notarization；
- Windows Authenticode 代码签名证书。

## 发布一个正式版本

1. 在源码仓库完成 PR、合并和版本号更新；
2. 确认以下命令全绿：

   ```bash
   npm test
   node_modules/.bin/tsc --noEmit
   npm run lint
   npm run release:manifest
   npm run release:verify
   ```

3. 手动运行 GitHub Actions 的 **Publish signed desktop release**；
4. 等待三平台构建与上传完成；不要手工发布缺平台的草稿；
5. 验证公开 Release 包含 `latest.json`、`.sig`、macOS、Windows、Linux 和 `component-versions.json`；
6. 用上一正式版客户端点击“检查更新”，完成一次下载、安装、重启与版本确认。

当前 `pi 0.84.1` 与 `pi-web 0.8.7` 是显式锁定的发布组件。升级它们必须单独合并、验证并更新 `scripts/release-component-pins.json`，不能在桌面发布当天顺手漂移。

## 预览版与回滚

`.github/workflows/preview-installers.yml` 生成的 DMG/EXE 是内部预览包：没有正式 updater 公钥，不参与自动更新，也不能作为正式更新基线。首个正式签名包需要由教师手动安装一次。

如果新版出现问题：

1. 不发布仍在 draft 的 Release；
2. 已发布后立即将上一已知稳定版本重新发布为更高补丁版本；
3. 客户端仍通过同一 `latest.json`、同一永久公钥完成向前回滚；
4. 不删除或覆写已被客户端读取的签名资产。
