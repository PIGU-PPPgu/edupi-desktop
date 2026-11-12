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

## 新审计与 Core 质量修复

Desktop `751e9d68` 的远端审计 `43143666777`：应用兼容和 Linux 源码检查成功，Rust 审计唯一失败为新公布的 `RUSTSEC-2026-0486`，`rustix 1.1.4` 的 xattr 初始化问题。定向修复为 `1.1.6`，保留 `0.38.44`，仅更新对应 checksum 和 15 处引用；未调整审计豁免、Cargo.toml 或其他包版本。官方 crate、官方/TUNA 索引、缓存和锁的 SHA256 均为 `e5e76742e5294153d4dde1207dbec5bdd81eef6fabdc0d2118babadabfd858aa`。新增回归旧锁红、修后安全合组 13 项通过，macOS normal/build 闭包与锁定 metadata 通过；本机没有 `cargo-audit`，完整 RustSec 门仍待远端复跑，不能将本机缺工具计为通过。

Core matrix 修复仅两文件，已独立审查并在隔离检出目录提交为 `547880af`，推送到 PR463；协议、type、双闭包只读重算、七个 G4 脚本和研究回归 70 项无跳过均通过。原工作树的完整 `npm test` 首次在 pretest 因依赖符号链接被拒绝，主测试链单独通过不作替代；保留原依赖后改用任务自有真实目录正式重跑，尚未完成。精确 head 的 Mac CI `43146848050` 正在执行；先启动的手动 `43146841846` 被稍后同一分支的自动任务按 concurrency 取消，不是测试失败。Core 尚未合并。

上述阶段已更新：`547880af` 的本机完整 `npm test` 含 pretest、远端 Mac CI `43146848050` 全部通过；Desktop 修复 Rustix 后的 `9a022055` 也在 `43148222744` 的三个审计 job 全部通过。本机按 `547880af` 构建的 13,361 文件 Core 包、标准 45 秒 staging、20 秒无页面请求启动、OCR、DOCX、OpenConnector、日程冲突/occurrence/上传校历/反馈均实际通过。第一次本机构建因任务依赖符号链接跨出 build boundary 被拒绝，已将同一任务依赖实目录移入本工作树，保留原共享依赖；OpenConnector 首次调用遗漏资源路径变量的环境失败也保留，补齐参数后通过。

最终合并审查发现 `PRRT_kwDOTjI4ds62c5vm`：隐式登记持久化的课次 binding 未用于 completion history，按实际课次筛选会漏记录。本轮真实回归在旧代码得到 `null !== history-slot`；生产代码仅删除 fallback 的 `content &&` 限制，保留显式 selector 优先、完整授权/作用域/来源校验及无 binding 的 legacy `slot_id:null` 兼容。三组回归 6 项、独立纯内存边界 22 项通过，官方 matrix/双 manifest 重新生成及只读重算、七个 G4 脚本、协议/type、研究回归 70 项均通过。新提交为 `e5aac37153cca988053efd24713371f18852aac0`，线程已按实际修复 resolved；新 Mac CI 为 `43154016436`，尚待收口。Runtime component 更新为 `sha256:46252d3917be4035a8bc9bf4b779b6d6621db0a3caadb71a38bd2da63ffa0bc2`，Desktop component 和 14 个 schema/hash 文件未变。

Desktop 候选随即对齐新 Core；对应合同和历史来源检查 48 项通过。允许在分支上并行构建不可公开的签名 Draft，但正式安装与公开发布仍须等 Core 和 Desktop 普通合并、精确源版本质量门及同轮资产验签。若 Release 使用被正常合入 main 的候选提交，须另外证明其可达性与 main 的受测源码树一致，不能将候选、合并和安装状态混为一项。

## Desktop 边界收口

`e5c53e03` 的远端源码/安全检查 `43155117706` 三个 job 全过，但最终审查给出三项 P2，原冻结记录保留为 `frozen-source-e5c53e03-before-boundaries.json`；当时尚未触发签名 workflow、创建 `.110` Release 或替换 App。

- 停用 A 后切到 B、再回 A：预检分别验证旧授权已暂停与新 scope 的独立授权；恢复 A 时保留其历史来源。新旧授权在提交前后严格核对 root/owner、source、版本和范围，不将 A grant 改写成 B。独立审查补出的 `owner.root_ref` 缺失校验已在两个预检边界补齐，缺失、错误及提交前变化均拒绝且零授权写入。
- 丢回执且课表已移除：PATCH 与有界历史 GET 可显式选择同 root/owner 下已存在的历史 scope grant，不能创建或激活授权；客户端先匹配终态回执，再在当前列表缺行时验证历史 scope、snapshot/cursor、fact、课次、版本、原文和来源，不重复 POST。未知或不完整证据保持未确认；界面继续展示当前 GET 的数据，不把历史数据冒充当前课表。
- 20 条课堂内容上限：新的第 21 条在 dispatch 前拒绝为终态未提交；已有精确 capture 的幂等重放仍可用，已有 20 条的列表保持可读，不在写入后才把整日读坏。

修后五组组合检查 **225 passed、0 failed、0 skipped**，客户端/组件 **63 passed**；三个 handler 边界、22 项 Core 隐式绑定内存检查及上述 owner Root 四个拒绝场景经独立复核。新增真实 Core 联合 **18 项流程检查通过**，包含 A→停止→B 活动时读取 A 历史与终态回执→停止 B→恢复 A，模型调用 0；第 21 条零 dispatch 与 20 条可读也由另一个真实 Core 夹具验证。原红灯、夹具缺失 owner Root 的修正及首轮跨课计数断言失败均保留，不改安全断言。

对应日志为 `desktop-historical-recovery-red.log`、`desktop-historical-recovery-full.log`、`desktop-owner-root-red.log`、`desktop-boundaries-combined.log`、`desktop-boundaries-joint.log` 与 `desktop-reflection-api-boundaries-real-core-v2.log`。Core 新一轮 `43154016436` 尚未放行：模板到期用例期望修改成功，实际收到 `stale_snapshot`，失败日志保留，正在限定范围定位；未降低 CAS 或跳过用例。

此后 Desktop `1a34f342` 的 `43160922411` 三个远端质量 job 全部成功，本机完整源码为 **4155 passed、16 conditional skipped、0 failed**。真实浏览器另外完成“capture 已提交但响应正文截断 → 移除隔离课表 → 刷新 → 按原 scope 历史核对 → 清除 pending”流程，提交 POST 仅一次、恢复后没有重新提交，历史记录仍可见；唯一 console 网络错误为主动截断，未计为普通页面零错误。截图为本机 Playwright 目录内 `edupi-g4-history-recovery-20261112.png`，请求和事务证据为本机 `edupi-g4-browser-boundaries-20261112/recovery-evidence.json`。这是开发浏览器证据，不代替 Tauri 安装版。

Core CI 失败的限定诊断已确定：真实 G1 tick 仅更新 `rhythm_plan.generated_at`，即可令 snapshot→command 边界上的全局快照过期；CAS 拒绝符合安全契约。`98e4f7cd0c31dd30954574d2040bb1b948cdd954` 仅修改测试夹具，让 `moveTemplate` 最多尝试 3 次且只对 `stale_snapshot` 重读快照；revision、目标、来源及 idempotency key 固定，最终仍必须 `modified`，持续 stale 或其他失败仍报错。完整脚本含 offline 子进程两次通过，确定性真实 tick 对照 `stale → stale → modified`、后续 draft 恢复、writer-c3/type 和独立审查通过。production、CAS、matrix、两份 manifest、schema 及依赖均未改变；新精确 SHA 的 Mac CI 仍待通过。

## 待验收

Core 修复后的完整质量门、普通合并及 Desktop 精确配对；真实标准 staging；同一冻结提交的 Mac-only 签名、公证与三资产验签；唯一安装位升级、隔离原生 G4 流程、冷启动及真实资料/偏好恢复；公开预发布与匿名下载回读均未完成。

自然七天跨期、真实 OS 睡眠/通知点击、真实教学内容质量和跨平台验收仍不在本轮已通过证据内，完整 L4 未放行。
