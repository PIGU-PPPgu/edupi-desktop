# G4 macOS 0.3.110 发布验收

状态：**发布准备中，尚未签名、安装或公开**。用户已授权本轮部署和 Release 更新；范围为 macOS，Windows/Linux 安装构建继续暂缓。沿用 Mac-only 公开预发布策略，正式 Latest `v0.3.70` 和 `updater-feed` 不在本轮切换范围。

## 候选

- Desktop 来源：G4 PR489，原 head `41afac14`，包含与 Core G4 的源码、隔离联合和页面验收。待消除发布门问题并固定最终配对 SHA 后构建。
- Core 来源：PR463，原 head `8f205869`。既有 Core Quality `43003195939` 的完整测试失败，原因是 writer matrix 的精确规则和生成结果遗漏最近改动；本轮正在修复并复验，不将旧失败改记为通过。
- 新版本 `0.3.110`：已有失败 Draft `v0.3.109` 固定旧 Desktop `d9e1baba` 且仅含 Windows 资产，不能换提交复用。新版本的 Desktop package、Cargo manifest/lock 和组件版本清单已同步。
- 当前唯一安装版为已退出的 `0.3.108`，尚未替换。

## 已完成的发布门

环境为 macOS arm64、Node `v22.23.1`。本机私有证据目录为 `~/edupi-install-checkpoints/g4-release-20261112/evidence/`，安装保护证据目录为 `~/edupi-install-checkpoints/v0.3.110/evidence/`。

- 首次完整 Desktop 源码检查实际 4101 passed、2 failed、16 conditional skipped。一个失败来自验收文档包含本机路径，已去除；另一个来自旧共享依赖的 `@hono/node-server` 低于锁文件的安全版本，未改他人依赖，使用独立 `npm ci` 目录复验。
- 独立依赖下完整检查实际 **4103 passed、0 failed、16 conditional skipped**；源码公开性与依赖安全定向 **29 passed、0 skipped**。16 条跳过包含依赖额外合成数据或 staged SDK 的实际 Core/宿主用例，不记为通过，后续由配对及打包门补充。
- 完整 lint 通过；新依赖下类型检查通过。`npm run security:audit` 达到 high 门槛，保留 1 条 low 级 `fast-xml-parser` 公告，未进行无关依赖升级。
- 版本测试 **5 passed**；`node scripts/verify-release-components.mjs` 确认 Desktop `.110`、固定 Pi `1.0.2`、pi-web `0.8.7` 一致。
- 旧 `.109` 的 staged server 检查在 Core manifest 字段为 `undefined` 时提前失败。恢复前轮独立工作树的 readiness helper，只在 HTTP 成功且 Core/projection 均 ready 时返回；标准 20/45 秒边界、身份与 manifest 严格断言保持。新增 6 项测试通过，独立只读审查未发现弱化门；**实际标准 staging 尚未执行，不能据此宣称构建失败已解除**。
- 普通 App 退出守卫通过。安装前真实资料、会话与配置 **350 个文件**已记录指纹并完整备份，**3 份 WebView 来源**已备份；备份后未改变真实资料或隔离 UI 状态。

对应日志：`desktop-full-source.log`、`desktop-full-source-fixed.log`、`desktop-source-gates-fixed.log`、`desktop-security-audit.log`、`desktop-full-lint.log`、`desktop-typecheck.log`、`desktop-release-version-tests.log`、`desktop-release-component-verify.log`。原失败保留，不以新的通过覆盖。

## 待验收

Core 修复后的完整质量门、普通合并及 Desktop 精确配对；真实标准 staging；同一冻结提交的 Mac-only 签名、公证与三资产验签；唯一安装位升级、隔离原生 G4 流程、冷启动及真实资料/偏好恢复；公开预发布与匿名下载回读均未完成。

自然七天跨期、真实 OS 睡眠/通知点击、真实教学内容质量和跨平台验收仍不在本轮已通过证据内，完整 L4 未放行。
