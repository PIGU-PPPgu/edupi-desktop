# 班级与账号主线集成

本记录接续 R24.1–R24.4a。Core PR472 已合入 `a8c740833cd99792a2f2672fb495365794d68f58`，探针验收器 PR473 已合入 `6ca5d8ab134c90d5b43876566a5f0f160ca5c8a2`；Desktop PR508 固定后一个实际 merge commit。开发验收、源码合并、发布和安装分别记录，本证据随 PR508 交付，不代表已发布安装包。

## 版本与隔离

- Desktop 起点 `c19cd15d9516bc6894aee88721025ea5c7d9063a`；分支 `codex/classroom-account-integration-20261117`。功能代码检查点 `991e85516511661e329b0aa1a7f5d928b566dedd`，最终配对和证据以本 PR 的文件与 `source-files.json` 为准。
- Core 从当前 `64930d5d` 主线派生，实际 pin、schema 和双组件身份见 `contracts/edupi-core-compat.json`。最终运行时代码与已验收容量修补 `3bd9ac8c` 逐字节一致，后续仅修改测试 helper 和证据。
- 本机 macOS / arm64、Node `22.23.1`、Asia/Shanghai，两个工作树各自按当前锁文件安装依赖，没有依赖 symlink。
- 浏览器使用同一个 ego-browser TaskSpace；六名“集成验收班”合成学生、独立数据根和独立宿主账号目录。原目录的 20 份本轮源码及原 HEAD 摘要全部保持，见 `preservation.json`。
- 账号后端为本机合成 HTTP fixture。测试 PNG 是单像素占位图，不能用于真实微信扫码；没有短信、邮件或原项目云端请求。

## 实际页面与同对象回读

| 功能 | 实际操作 | 观察到的结果 |
| --- | --- | --- |
| 成绩导入与身份 | CSV → 选数学列 → 同班同名阻断 → 人工选 `integration-4` | 不猜测身份；保存前程序返回未匹配提示 |
| 单考与修订 | `60,80,100,70` → 计算 → v1 → 60 改 65 后 v2 → 改 66 再取消 → 重开 → 恢复 v1 成 v3 | 均分 77.50、样本标准差 17.08；修订均分 78.75；取消保留 65，历史恢复后为 60 |
| 两考对比 | 第二 CSV、同名确认、选择第一考试 → 计算 → 保存 | 四人的分差为 `5,5,-5,5`，页面显示标准分变化与增值残差，保存为独立对象 |
| 排座 | 正式名单与已保存考试 → 生成六座 → v1 → 交换前两人 → 核对 → v2 | 六名学生唯一覆盖，交换后保存；改为一列时出现“座位容量不足以容纳全部学生”，禁止保存，取消后恢复 |
| 分组 | 六人每组三人 → 生成 → 跨组交换 → 核对 → 保存 | 两组各三人，无重复或遗漏 |
| 值日 | 页面实际日期 2026-11-17 起五个日历日、工作日、两岗位三人/日、免除甲、扫地权重2 → 生成 → v1 | 排班为四个工作日、12 个岗次，甲零分配；未将自动填入 11-16 的失败计作通过 |
| 替班与任务 | 将首日扫地 `integration-1` 改为当日空闲的 `integration-4` → 核对 → v2 → 关联任务 | 工作量重算，预留/关联到 v4；任务详情返回同一个方案 ID，无复制排班 |
| 关联后历史 | 返回方案 → 恢复 v1 成 v5 → 恢复替班版本成 v6 | 任务关联保留，首个学生先回到原人、再恢复 `integration-4` |
| 真实开发进程重启 | 停服 → 用新 Core 进程的实际 SDK 工具读取页面写入对象 → 重新启动 → 页面逐一打开 | 五份对象分别为 grades v3/v1、seating v2/groups v1、duty v6，ID、内容及任务相同，见 `ui-sdk-read.json`、`ui-cold-reopened.json` |

截图已实际查看：`grades.png`、`seating.png`、`duty.png`。`ui-summary.json` 保存对象 ID、版本及合成档案摘要。首次冷页等待 20 秒曾超时，后续观察到页面已完成读取；按实际可观察结果重新核对五份对象，没有将该超时记作性能通过。开发时固定版本更新触发完整性拒绝与 HMR 的中间回执不计成功，冻结源码后已复验。

## 账号界面

| 操作 | 实际结果 |
| --- | --- |
| 未配置服务、设置搜索“扫码 登录” | 无假二维码；唯一搜索结果定位“教师信息 → 账号” |
| 合成扫码、手机确认、手机号和邮箱绑定 | 同一 `synthetic-teacher-1` 显示三种已验证身份；二维码过期后显式刷新可继续 |
| 开发服务重启、账号过期、刷新 | 私有文件恢复同一账号与三种身份，真实客户端 HTTP 刷新后恢复登录，见 `account.png` |
| 创建微信绑定 → 关闭设置6.5秒 → 重开 → 取消 | 轮询计数 `15→15`，同一 flow 恢复后可取消 |
| 远端 revoke 注入503 → 退出 | 本地 session/pending 均清空，显示撤销尚未确认；教师合成名单和五份方案文件 SHA-256 均不变 |

账号冷启、关闭与退出见 `account-cold-close.json` 和 `account-data-preservation.json`。凭据文件实测0600，未进入 WebView；退出只影响账号连接，不改 Core owner 或业务数据。

## 程序验证与独立审查

| 检查 | 实际结果 |
| --- | --- |
| Core 班级算法、存储、身份、安全、发布与容量 | 114 pass / 0 fail / 0 skip；Core 同一集成证据保留原92项及新增回归 |
| Main4 classroom | 真实迁移根覆盖 owner control、CAS、幂等、关联、恢复、重启和旧 writer 拒绝；探针修补后独立运行两次各1/1通过 |
| Desktop 全仓 | 4351 pass / 0 fail / 51 条件 skip，见 `desktop-full.log`；跳过不计通过 |
| 本轮 HTTP、账号竞态与实际 React 行为 | 26 pass / 0 fail / 0 skip，见 `targeted-final.log` |
| 最终严格 pin 与六组 bridge 配套 | 45 pass / 0 fail / 1 条件 skip，见 `pairing.log`；既有综合快照用例未配置包含名单、日历和任务的独立种子根，未计通过，本轮业务另有真实 E2 和页面证据 |
| 最终 Core 服务 E2 | 六组通过；真实工具读回、成绩/编排/CAS/历史、值日/单任务/中断恢复，见 `classroom-service-e2.json` |
| 路由 typegen、TypeScript、lint | typegen 和 `tsc --noEmit --incremental false` 通过；lint 0 error、1 既有 warning，branding 2 pass |
| 依赖审计 | high 阈值通过，仍有1 low、3 moderate，未改变依赖 |

Desktop 独立审查修复并关闭了取消绑定后的迟到401、过期重登的新二维码被旧401清除、慢方案读取覆盖后来编辑、关联后恢复入口禁用。Core 独立审查关闭了当前名单发布校验、原命令重放、读取替换窗口、32 MiB 读写容量不一致。没有通过删除断言、放宽生产准入或跳过新增用例收口。

## CI 的失败边界

`ci-results.json` 区分实际结果：Desktop Ubuntu `audit` 与 `linux-source` 成功；`rust-audit` 因原有 chrono 0.4.45 的 unmaintained 警告失败。Cargo.lock 与原 main 逐字节相同，未忽略警告或变更Rust依赖。

Core 首轮自托管 CI 在 checkout 连接 GitHub 超时。后续 hosted Mac 全套为374/378通过、4失败：三项 teacher-template/反思读取失败已在未改动的649基线同锁复现；新增 legacy admission 探针则是真实新测试计时问题，已用独立 PR473 修复，并保留真实CLI退出和拒写断言。6秒冷启动延迟能使旧 helper 复现超时，新 helper 约11.505秒收到拒绝并通过；退出滞留仍在约5秒失败。没有把四项都称为基线失败，也未将修补后的定向通过写成长全套通过。

## 清理与未验证

ego-browser TaskSpace 已正常结束；Next、合成账号服务和隔离 Core host 均已停止。核对 Git 跟踪/忽略和打开文件后，删除本轮 `.next`、`.next-desktop` 及合成数据根共541,990,912字节目录占用，文件系统可用空间净增541,814,784字节，见 `cleanup.json`。Core 两次独立基线/探针副本的重复依赖也已清理，源码与证据保留。未创建 Tauri 构建或安装包。

未部署真实账号后台、小程序确认端、短信或邮箱验证；未执行真实微信扫码或身份归属验证。未验安装版、原生 WebView、Windows/Linux 页面、真实模型自然语言选工具及教师生产数据迁移。Windows作业按用户要求保持暂停；本轮没有打包、公开发布或替换安装版。成长报告、行为评价、风险 SOP、班主任行动地图仍未实现，仅记录后续接入位置。
