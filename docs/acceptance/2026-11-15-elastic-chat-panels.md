# 对话侧栏与输入区验收

当前状态：**R18／R20 源码已正常合并，隔离页面交互、生产前端构建和独立审查通过；`.115` 被 Apple 公证服务的协议状态阻塞，尚无签名安装包、安装或公开发布验收。** 本机保持已公开验收的 `.114`，完整 L4 保持未放行。Core 继续固定 `98e4f7cd0c31dd30954574d2040bb1b948cdd954`。

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

独立生产工作树使用冻结合并提交与精确锁文件，Next16.4.3、React19.2.4，`PI_WEB_DESKTOP_BUILD=1 next build --webpack`退出0；输出位于独立`.next-desktop`，没有污染在用开发目录。此检查证明前端生产编译通过，不构成Mac签名、安装或启动通过。

浏览器capture已绑定14个实际生产UI文件。初次完整页面验收后变更的两个文件，另有More及内层工具菜单实测；其余12文件与原受测字节一致，最终14文件逐个匹配冻结合并提交。完整App中另实测任务详情→预览展开→恢复→关闭预览→Task Escape，Tab留在预览、真正关闭回原opener，输入节点与草稿保持；空间不足时任务详情浮层覆盖聊天，返回编辑前先收起预览。

恢复入口：`~/edupi-install-checkpoints/v0.3.115/evidence/continuation.json`。仅在账户协议／服务状态已改变后，对同一冻结run重跑；读取真实attempt、release ID及资产后再独占创建candidate，不预填成功证据。

## 待验收

`.115` 的签名 CI、三资产身份、安装版交互、公开下载与公开安装启动必须另附实际证据。`.114` G4 Mac 已公开为预发布，公开资产复验独立记录；正式 Latest 和 updater-feed 保持原值，Windows/Linux 安装暂缓。生产资料迁移、真实模型与教学内容质量、自然跨期、系统睡眠及通知点击仍不在本次已验收范围内。
