# 对话侧栏与输入区验收

当前状态：**R18／R20 源码与页面交互、同源 Mac 签名、私有安装冷启、公开预发布、匿名三资产完整下载和公开重装冷启通过。原生双栏键盘调宽、草稿保留和文件预览通过，原生自动鼠标拖动无结论。** Release 为 `446714564`，本机已为 `.115`，`.114` 回退副本保留；完整 L4 未放行。Core 继续固定 `98e4f7cd0c31dd30954574d2040bb1b948cdd954`。

左右侧栏沿用原宽度偏好，由同一 resize hook 管理合法布局宽度。把手空闲时隐藏，悬停、聚焦和拖动时显示；SVG 根据速度弯曲，越界时产生阻尼反馈，释放后归位。取消拖动恢复起始宽度。教师对话、通用对话与右侧文件预览分别接线，窄屏沿用浮层。

输入区将附件、引用、真实 textarea 和控件放入一个容器。底部保留附件、访问权限、模型、推理级别、发送、排队、插队与停止入口。错误提示直接显示具体原因。参考来源记录在组件注释中，没有引入附件的演示 runtime、字体或新增产品依赖。

## 开发页面证据

受测源码为 `codex/elastic-chat-panels-20261114`，基线 `ff56b453` 加本次改动；环境为本机 arm64、独立 Chrome、Next dev webpack、隔离数据根及独立 Agent 配置。真实模型调用为 0，发送使用 loopback 的确定性 SSE 回执。

- 左右栏实际拖动由 `260/552` 到 `350/380`，宽度写入原偏好并刷新回读；键盘缩放、Escape 取消和减少动态效果下的 `180px` 边界均实际操作。
- 在 `320/640/820/960/1024/1280/1440px` 检查布局。收窄、恢复、导航折叠与右侧展开均保留草稿和原输入节点；宽屏恢复后的稳定输入宽度为 `488px`，未将过渡中的零宽采样计为通过。
- 模型、权限和推理控件实际打开并选择。一次合成 `POST 503` 后草稿保留；真实 SDK 首条发送等待期间继续编辑，新草稿保留，输入节点未重建。
- 插队续聊在隔离 session 持久化，重新进入页面读回第三条回执。停止后 UI 恢复可编辑，持久化 `stopReason=aborted`，停止期间的新草稿仍在。
- Markdown、HTML、图片和 Mermaid 均实际打开；HTML iframe 内容可见，图片解码成功，Mermaid 图与查看器显示“备课→反思”，展开和恢复侧栏后草稿仍在。

开发环境首次会话读取触发既有请求超时，点击重试后恢复同一历史和草稿；一次 Mermaid 等待超过 20 秒，最终 SVG 实际可见尺寸为 `250×70`。这些结果不用于宣称启动或渲染性能通过。

并行修改 hook 时曾出现一次 Fast Refresh hook 顺序错误，原记录保留；源码稳定后的独立页面未再出现 page error。最终浏览器证据位于 `~/edupi-install-checkpoints/ui-elastic-20261114/browser-final-acceptance.json`，初次记录与截图也保留在该目录。

## 审查与回归

定向回归覆盖弹性边界、取消与重复 capture、清理、宽度预算、IME、首条发送并行编辑、控件与导航。独立审查发现右侧预览挤压任务详情后抢焦点，以及预览往返后丢失 return focus；两项均已修复。

详情的视觉停靠与焦点前台状态分别管理。预览前台时暂停详情的模态捕获，且不声明 `aria-modal=true`；一次打开周期保存同一外部 opener，布局变化不覆盖它，真正关闭时才按焦点归属返回。新增 task／file 组合回归实际验证 `dock→preview→expand→restore→close preview→Escape`。

GitHub 自动审查发现窄屏“更多控件”沿旧方向定位，导致前部控件越出屏幕。弹层改为相对整行控件区左对齐，以容器和视口共同限宽并允许换行。320px 的实际 Chrome 中，弹层位于 `x=43…222`，全部4个控件位于 `x=45…220`；提示音切换、收起均实际操作成功。证据为 `more-controls-mobile-acceptance.json`，未将仅有限宽而位置越界的旧实现计为通过。

同一复验还展开内层工具预设菜单，compact 模式同样左对齐并限宽；320px 时菜单位于 `x=46.37…226.63`，三个选项全部可见，实际选择“关闭”后菜单收起。证据为 `more-controls-nested-mobile-acceptance.json`。

## 冻结与外部阻塞

PR494正常合入 `6d14dbba928db133b87aa10d947214b5ba062089`，第二父提交为受测UI `2b193957a59c892ac767a76c10f8f509249afa0c`，完整tree同为 `39759b15f9e25ee93efb1e16f47403108efd907a`。源码CI43627036466的audit、rust-audit、linux-source均通过。早期4504的旧结构断言失败日志保留，修复后完整CI通过。签名专用分支 `codex/elastic-chat-115-signed-20261115` 固定合并提交，不随Main后续文档更新移动。

Mac-only `phase=draft/platform=macos` run43629706865 attempt1，于北京时间2026-11-15 03:00:56在 `Check Apple notary status route before packaging` 失败。Apple实际返回HTTP403：`A required agreement is missing or has expired`。日志不足以确定是哪份协议或会员状态，需由Apple Developer账户持有人检查账户与团队状态。release及build均未执行，本轮未创建115tag、Draft或签名资产；未改凭证、切换账户、绕过公证或盲目重试。原始日志为 `~/edupi-install-checkpoints/v0.3.115/evidence/signed-attempt1-failure.log`。

2026-11-16 用户表示账户状态应已恢复后，执行 `gh run rerun 43629706865 --repo PIGU-PPPgu/edupi-desktop`。同一冻结源码的真实 attempt 2、job132922502376 于北京时间03:04:20再次在 `xcrun notarytool history` 返回相同 HTTP403，run 与 exact attempt 均最终 failure，release/build仍为skipped。已认证 API 复核115 Release及tag均404；签名分支仍为`6d14dbba`，正式Latest仍为`v0.3.70`，updater-feed仍为`7924328ee893c9527adb54e25b0023e9f2a26ff7`。当前阻塞状态以本次结果为准，首轮日志保留；证据为 `~/edupi-install-checkpoints/v0.3.115/evidence/notary-preflight-attempt2-blocked-20261116.json`、同目录`signing-attempt2-final-20261116.json`及`signed-attempt2-failure-20261116.log`。本轮未下载、安装或启动候选，未创建candidate或成功proof；日志仍不足以指出具体待处理的协议。

用户明确已接受协议后，attempt 3 于北京时间15:09:50仍返回相同403，原日志保留。随后实际刷新已登录的 Apple 账户页并在 Xcode 读取现有团队，观察到团队与签名匹配、会员有效、两份开发者协议有接受记录；未改账户、密钥、证书或代签条款。attempt 4 的预检于15:18:35成功，15:18:45完成 Draft 创建，Mac builder已进入配对运行时与平台校验。不能由先后关系认定 Xcode 查询是恢复原因。当前状态以attempt 4为准，证据为`signing-attempt4-start-20261116.json`与不含私人联系方式的`apple-account-observation-20261116.json`。标签已精确固定`6d14dbba`，未覆盖旧标签；未触发全平台publish，也未公开Draft。

独立生产工作树使用冻结合并提交与精确锁文件，Next16.4.3、React19.2.4，`PI_WEB_DESKTOP_BUILD=1 next build --webpack`退出0；输出位于独立`.next-desktop`，没有污染在用开发目录。此检查证明前端生产编译通过，不构成Mac签名、安装或启动通过。

浏览器capture已绑定14个实际生产UI文件。初次完整页面验收后变更的两个文件，另有More及内层工具菜单实测；其余12文件与原受测字节一致，最终14文件逐个匹配冻结合并提交。完整App中另实测任务详情→预览展开→恢复→关闭预览→Task Escape，Tab留在预览、真正关闭回原opener，输入节点与草稿保持；空间不足时任务详情浮层覆盖聊天，返回编辑前先收起预览。

恢复入口：`~/edupi-install-checkpoints/v0.3.115/evidence/continuation.json`。候选、签名资产、私有与公开安装证明均已实际冻结，禁止重跑会改写资产的签名流程或在公开后重放 Draft-only 入口。原生鼠标自动化结果不能用于宣称鼠标拖拽通过；继续该项时应保留现有失败／无结论证据。

编译检查完成后，已删除独立生产工作树的`.next-desktop`与重复`node_modules`，以及已停止开发预览的`.next`；路径报告分配量3,201,728,512字节，实际可用空间增加3,259,437,056字节，见`generated115-cleanup-blocked.json`。临时唤醒断言已结束，源码、锁文件、截图、实际日志与资料回退继续保留。

## 待验收

2026-11-16 同源 run `43629706865` attempt `4` 完整成功，三资产 ID 为 `754092596`、`754051900`、`754052236`。真实六字段候选已独占冻结，签名、篡改拒绝、公证、Gatekeeper、DMG／updater 完整 App 树及31份冻结源码匹配；原页面验收14份 UI 源码和实际 captures 已绑定。下载慢速部分保留后改用受审的8路分段传输，最终仍由原入口重新核对完整 SHA 和 metadata，再生成正式资产证明。

安装前A区间因一次无结论的FD检查停止，B／C区间因飞书桥及运行事件日志自然追加而拒绝；均未移动 App，未回写源文件或将失败记录改绿。为捕获“配对写入”增加的额外时机等待在D超时，已从安装入口撤除。E区间在独立包检查完成后新建完整备份，全部原保护条件保留。`.115` 实际安装后，在原G4隔离根读取两条内容、日期2026-11-13、两个有内容的课次行、零空白重复行与一个录入入口；分别打开两条历史详情，关于页显示安装`.115`／正式`.70`。真实Cmd+Q及独立进程检查通过，三个LocalStorage完整备份恢复，350项资料和配置原字节保持。原AX观察摘要包含实际观察时间与后续落盘时间，未伪称截图文件。

私有证明为 `~/edupi-install-checkpoints/v0.3.115/evidence/private-startup-verification-115.json`。直接精确PATCH公开Mac预发布通过，正式Latest和feed仍保持旧值；`public-prerelease-proof-115.json` 的两个公开下载／启动字段继续为false。后续匿名三资产均完整下载并核对原metadata与SHA，见`anonymous-download-verification-115.json`。

公开DMG实际原位重装后，新的隔离进程和运行中回读通过；实际再选11月13日并打开两条原历史，关于页仍为115／正式70。真实Cmd+Q后恢复三个原LocalStorage目录，完整文件与行摘要、350项资料和配置均严格保持，App／helpers为零。独立最终证明为`public-install-startup-verification-115.json`，公开安装阶段未改写原发布回执。

同一公开安装版还实际操作了左栏260→284、右栏318→342的键盘调宽，输入草稿保持；原生文件选择器导入明确隔离的Markdown材料，右栏显示其实际内容，展开后恢复预览仍保留草稿。未发送消息或调用真实模型。多次原生自动鼠标drag未观察到宽度变化，截图坐标校准成功后仍未定位原因；不能计为原生鼠标通过，也不据此断言人工鼠标必定失效。页面上的实际鼠标拖拽证据继续有效，原生鼠标保留人工／后续诊断项。具体记录见`native-public-elastic-composer-115.json`。

公开复验完成后已卸载本轮DMG挂载，删除私有与公开下载副本、分段和慢速部分文件、updater解包、重复115回退副本、两轮UI测试保留副本及明确的测试材料；原生AX、日志、JSON、传输回执和资料备份保留。本文件系统删除分配量3,696,857,088字节，磁盘可用空间实测增加3,729,317,888字节；只读挂载中的虚拟App大小未计为物理释放。已安装115、114回退、G4原两份数据文件及原工作区保留，任务临时唤醒进程结束，未改持久设置。清理清单与实测为`generated115-cleanup-final-20261116.json`。

Windows/Linux 安装暂缓。真实教师资料迁移、真实模型与教学内容质量、自然跨期、系统睡眠及通知点击仍不在本次已验收范围内；完整R04／R15／L4不勾选。
