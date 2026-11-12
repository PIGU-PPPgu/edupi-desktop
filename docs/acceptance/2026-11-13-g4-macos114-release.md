# G4 macOS 0.3.114 发布验收

当前状态：**源码正常合并、Mac 签名构建与本机安装校验通过；原生两条内容验收因 Mac 锁屏外部阻塞，Release 保持 Draft，未公开。** 唯一 App 为 `.114`，隔离 App/helpers 已停止。正式 Latest `v0.3.70`、updater-feed `7924328ee893c9527adb54e25b0023e9f2a26ff7` 保持；Windows/Linux 安装包暂缓，完整 R04／R15／L4 均不勾选。

本文日期使用北京时间 2026-11-13；GitHub 构建和证明中的 UTC 时间为 2026-11-12。

Desktop 候选固定 `febea954199f033b7ed0d60baf3928b18ef07879`，Core 继续固定 `98e4f7cd0c31dd30954574d2040bb1b948cdd954`。本机 arm64：交互及 route 109/109、独立组件复跑42/42、typecheck、lint、发布相关60/60和 diff 检查通过；lint保留既有1个警告。原 `.113` 组件在三项新交互用例中实际失败，红色日志保留。

PR491 正常合入 `2feec5e6a85c3bdd74ffc9c4b686c3a5ff7d586b`，实际祖先关系及完整 tree `8002432e0cea27143052f0f74902878ba82ec335` 与候选相等；保留冻结候选作为 `v0.3.114` tag 和签名源。Core PR463 及原完整 Mac CI 沿用同一冻结源码，未增加 Core 修改。两条 clean 原发布 canary 均退出0、`status=passed`、`capabilityModelCalls=0`、`externalSend=false`。

Draft ID443426142 明确 target 为冻结候选，Mac-only run43292901925／attempt1／job131443854463 已全部成功，只运行 `phase=draft/platform=macos`，未调用全平台 publish。新 `.114` 隔离夹具已生成，date 为北京时间 2026-11-13，初始一节未登记课次，seed模型请求0、真实教师资料未写；seed不是原生验收。

`.112` 原生发现空占位行与课堂内容同时显示，资料只有一条；`.113` 的投影修补会让已有内容的组件失去继续添加入口，因此在打包中取消 run43282389572，保留 source232762c7／tag／Draft443365746，没有安装或公开。`.114` 同时保留已保存内容、每个完整课次作用域的单一添加入口，以及原来源登记、CAS、回执和回读。新建时只在克隆目标上清除 content，原记录和 review 目标不变。

尚未完成的原生流程包括首条反思、已有内容后取消第二草稿、第二条课堂反馈提交和接受、两条历史及同根冷启；公开 Mac 手动预发布、匿名三资产下载及公开 DMG 实际安装启动也未执行。源码检查不替代这些步骤。

私有证据入口：`~/edupi-install-checkpoints/v0.3.114/evidence/continuation.json`。较早 `.112` 的签名、安装、回退、资料保持和原生失败证据继续保留，见 [`.112` 验收](2026-11-12-g4-macos112-release.md)。

## 最终签名资产

| 文件 | Asset ID | 字节数 | SHA-256 |
| --- | ---: | ---: | --- |
| `EduPi_0.3.114_aarch64.dmg` | 741074323 | 238799364 | `8aee0fce27839ca0c1a1fd1992537a2cfcfdba48337c2a0f42844a76e8a86eed` |
| `EduPi_aarch64.app.tar.gz` | 741034840 | 240082907 | `3036f598ee235e56d051ab2fd9e9b10d6447b60fa16fdc16d05fde7c4de47245` |
| `EduPi_aarch64.app.tar.gz.sig` | 741035787 | 404 | `f40ed85fc2ecbdf04ff3d1f0bfac72e89adea8b7de2363b412ed6bd8bcef8dd6` |

集合指纹 `sha256:8db1acfada3e9b9a7190d229f83ceb08a1b79461ee683f3bc74307374e8ada0f`。按精确 ID 下载后，三个文件的完整大小／摘要、固定公钥 Minisign及篡改拒绝、App／DMG 公证装订、严格签名与 Gatekeeper、更新包和 DMG 内 App 全文件一致、31份必要冻结源码均通过。版本和签名团队为 `.114`／`BY3XZG2839`，原始证明为 `mac-asset-identity.json`、`mac-asset-verification.json` 和 `local-bundle-identity.json`。

GitHub 未执行的 notify 为 `started_at=21:02:53Z`、`completed_at=21:02:52Z`，首次身份门拒绝，日志保留。修复仅允许三个固定 skipped job 在 steps为空且 saved/live四个runner字段全null时不要求队列时间的先后顺序；每个时间仍受 run/attempt窗口约束，所有 success job仍须单调。137项回归、独立22项模拟和实际实时校验通过，Mac builder与资产时间窗未放宽。

## 安装与资料保护

首次 `.114` 完整备份被严格 FD 门拒绝：14个 mdworker 正在读取复制的 `output/.DS_Store`。原备份和诊断保留，新完整备份改置本轮专用 `rollback.noindex/`，没有停止索引服务或放宽句柄／字节检查；350项重新捕获、完整复制、3个 WebView来源备份及严格预检于 UTC20:04:26 通过，路径重绑定经独立复审。

唯一 App 已从 `.112` 安装为 `.114`，安装前后350项资料／配置与完整备份逐字节一致。`.112` 回退位于 `~/edupi-install-checkpoints/v0.3.114/rollback.noindex/EduPi-before-114.saved-bundle`，`.108` 稳定回退仍在 `.112` checkpoint；既有飞书服务未停止。

安装版以明确隔离根、`PI_OFFLINE=1` 和隔离标志启动；before-cua守卫实际确认 App70402／Core host71143及正确root。原生 CUA 随后明确返回 Mac已锁屏、无法自动解锁，**未操作任何界面**。因此登记、取消、两条录入／接受、历史与冷启均未验收。再次通过隔离守卫后只停止本轮隔离进程，stopped确认App/helpers为0，不能将其记为原生Quit验收。

全局prefs字节没有变化，未回写配置；3个原WebView来源恢复并复核。UTC21:15:05 的完整资料门再次通过，350项仍字节不变。已安装 App 的签名、ticket、Gatekeeper和完整tree复验通过，合成根 observation/fact 均为0。证明为 `global-ui-prefs-after-locked.json`、`full-protection-after-locked.log` 和 `installed-after-locked-start.json`。

## 发布与未验证项

Draft说明按完整 tag/target/draft/prerelease 元组更新为待解锁状态，并回读确认三个资产 ID／摘要、正式 Latest/feed未变。**没有公开 Release**，匿名公开三资产下载及公开 DMG 安装启动未执行。

两条内容 producer/consumer守卫564项纯内存回归及独立复核通过，公共安装恢复、匿名证明和public-cold哈希链也已独立审查；它们是验收工具，不是实际原生或公开安装证据。

待人工解锁后继续原生流程。生产资料迁移、自然七天、真实OS睡眠／系统通知点击、真实provider和教学质量、Windows/Linux仍未验证，完整L4不放行。

## 本地清理与续验保留

逐一核对本轮生成路径、无句柄并正常卸载对应 DMG 后，删除 `.112` 的下载副本、更新包解压、已证明与候选同树的失败安装副本及空挂载点；删除分配量 `2,432,136 KiB`，同卷可用空间实际增加 `2,625,948 KiB`。随后卸载 `.114` DMG，删除重复解压 App 和空挂载点；删除分配量 `975,760 KiB`，同卷实际增加 `1,001,676 KiB`。证据为 `generated112-cleanup-before114.json`、`generated114-cleanup-locked.json`，数据备份和已安装 App 未删。

`.114/macos-assets/` 三个完整文件保留用于解锁后续验及公开路径核对；私有挂载点已卸载，公开安装前按已验摘要重新挂载 DMG。`.112` 回退保留到 `.114` 原生／公开安装验收通过，`.108` 稳定回退及真实资料备份继续保留。三个合成根和各自隔离状态保留到对应验收结束，原始失败与锁屏证据不清除。

锁屏首次 launch 及三份 isolate/restore/check结果移入 `evidence/locked-attempt1/`，由 `locked-attempt1-archive.json` 记录原路径、目标路径及原始SHA；未覆盖证明。原始 UI备份与manifest保留，解锁后可重新执行 first启动及isolate，不与第一次的独占输出文件冲突。
