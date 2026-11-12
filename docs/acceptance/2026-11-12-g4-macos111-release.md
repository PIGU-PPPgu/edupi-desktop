# G4 macOS 0.3.111 发布验收

本记录最终状态：**签名 Draft 构建失败，未生成安装包、未安装、未公开**。`43167121336` 固定 `1b983400`、Core `98e4f7cd`，Draft ID `442563734` 资产为空；失败在 `Verify macOS Core host wiring` 的 canary 恢复授权。保留失败结果，不换 SHA 复用，当前入口改为 [`.112` 验收](2026-11-12-g4-macos112-release.md)。

以下保留本阶段事实。本轮仍为用户授权的 macOS 部署与 Release 更新，Windows/Linux 构建安装继续暂缓，正式 Latest `.70` 与 `updater-feed` 不切换。

`.110` 因命令未在冻结预检失败时中断而误触发私有 Draft，已经取消，Draft `442539630` 固定 `eca31346` 且资产为空，保留失败记录，不换 SHA 复用；本版独立使用 `.111`。签名 workflow 必须在全部预检成功后以单独命令调用。

## 源码与实际验证

- 固定 Core 候选 `98e4f7cd0c31dd30954574d2040bb1b948cdd954`：G4 隐式课次历史读取修补、官方 Runtime component `sha256:46252d3917be4035a8bc9bf4b779b6d6621db0a3caadb71a38bd2da63ffa0bc2`；最后一次变更只修模板到期测试的 snapshot 竞态，生产 CAS、schema、manifest 均未改。新 Mac CI `43162699412` 尚待通过与普通合并。
- Desktop PR489 的三项 scope/恢复/容量 P2 已修：组合 225 项、真实 Core 18 项流程、浏览器实际丢回执与删除课表后恢复均通过，模型调用 0；此前完整源码 4155 passed、16 conditional skipped、0 failed，远端 `43160922411` 三个质量 job 全绿。详情与原失败均保留于 [`.110` 阶段记录](2026-11-12-g4-macos110-release.md)。
- 后续审查 `PRRT_kwDOUJaiYs62e4AG` 发现执行授权过期时 initial current-list 失败会阻止历史恢复。已新增实际红灯并修复：只在 v2 pending 时捕获当前列表失败，仍通过匹配的终态回执及 scope-bound 历史核验后清原 pending；unknown 不读历史、不清 pending，非 pending/v1 不放宽。两次当前列表均失败、卸载迟到及 pending 替换等边界经独立复核，客户端/组件 **65 passed、0 skipped**。新精确提交的整合与远端检查仍待执行。
- Desktop package、Cargo manifest/lock 和组件版本清单已同步 `.111`；Rustix 保持已验证的 `1.1.6`，未改其他依赖或审计策略。

随后冻结预检拦下 `PRRT_kwDOUJaiYs62fCHZ`：4000 汉字合法请求为 12,875 bytes，但重复内容使持久回执达到 80,950 bytes，旧 65,536-byte 上限在 Core 提交后阻断回执落盘与恢复。回执读写共同上限现为有限 **512 KiB**，按已校验的内容、metadata 和来源数组预算为 449,376 bytes；实测最坏合法样本 380,473 bytes。格式、unknown、1024 条容量、权限、root/owner、原子性和链接防护不变，超出新上限 1 byte 仍拒绝。

旧上限新增回归 6 项均因容量红，修后 operation/route 合组 **90 passed、0 skipped**，正常、丢回执、terminal persist 失败后冷进程 resolve 与缓存 replay 均只写 Core 一次。独立审查无新增 P0–P2；真实 Core 联合改用第二条 4000 汉字，**19 项流程通过**，含提交、驳回、回执与冷历史，52 次 Core 启动、模型调用 0。证据为 `desktop-large-receipt-{red,green,measurements}.log` 与 `desktop-large-receipt-real-core-joint.log`。所有待审项修复与提交后，须重新冻结 `.111`，不能沿用先前未成功的冻结预检。

私有证据目录沿用 `~/edupi-install-checkpoints/g4-release-20261112/evidence/`，本版安装证明位于 `~/edupi-install-checkpoints/v0.3.111/evidence/`。不得将未运行的签名、安装、原生 UI 或公开下载计为通过。

## 真实资料保护

App 一直为已退出的 `.108`。原 `.110` 保护基线的严格 350 项全字节门实际失败，未改记通过：仅 `.edupi/feishu-bridge.log` 与 `.edupi/output/runtime_events.jsonl` 增加了 32 与 553 bytes，其余 **348 项逐字节未变**。两文件原有前缀逐字节相同；同时确认原 Core 路径的既有 `feishu_bridge.mjs` 服务已运行 6 天、父 PID 为 1，本轮未停止或改动该服务。仅此证据支持运行日志追加，不据此推断所有未来日志变化都安全。

原始快照、完整备份、增量哈希和失败 JSON 均保留，未覆盖并发变化来取得绿灯。`.111` 另以当前实际 350 项完整备份和 3 份 WebView 来源建立受控安装基线，不能替代原 `.110` 失败。后续安装仍严格核验当前基线，若再变化须继续保留和解释，不能放宽保护或回滚真实资料。

## 发布约束

可并行构建不可公开的签名 Draft；安装与公开前必须证明 Core463 和 Desktop489 已正常合并、候选提交均可达且与合并的源码树相等，所有对应质量门和同轮三资产验签通过。安装脚本已有自动检查，缺少 `merged-source-proof.json` 或实时 PR 身份不符会在任何 App rename 前拒绝。

最终仍需验证签名/公证、DMG/updater/安装位身份、隔离原生录入与恢复、冷启动、真实资料及 WebView 恢复，以及公开预发布匿名下载。自然七天、真实 OS 睡眠/通知点击、真实教学内容质量与跨平台均未验，完整 L4 未放行。
