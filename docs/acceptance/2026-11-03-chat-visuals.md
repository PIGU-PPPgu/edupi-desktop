# AI 对话视觉输出与扫码

## 2026-11-03 解锁后补验与 `.104` 候选

- 用户解锁后，唯一安装 `.103` 重新以隔离根 `~/edupi-route1-canary-chat-103-20261103` 启动；App/Core 双进程根守卫通过。原生 WebView 的 `about:srcdoc` 已显示普通 HTML 文字，聊天里二维码及图片卡片可见；右侧 HTML/SVG 只显示裁切的文字，没有预期的 300×160 浅蓝矩形，故 `.103` 安装版视觉验收**失败**，Draft 未公开。
- 根因由同一 SVG 在 Safari 与原生 WebView 的实际显示、DOMPurify 清洗前后属性核对定位：自定义 `ALLOWED_URI_REGEXP` 同时过滤了 SVG 的 `width`、`height`、`x`、`y` 与 `font-size`。`.104` 源码候选改为仅对 `src`、`href`、`xlink:href` 施加资源地址门；脚本、外链图片属性仍移除，iframe 仍无权限并带禁止网络与脚本的 CSP。隔离 Safari 实际挂载 `HtmlPreviewBlock` 后看到浅蓝矩形和文字；该组件产生的 `srcDoc` 保留上述 SVG 数值属性，外网图片 `src` 为 null、`script` 为 0、父窗口标记为 false。此为源码与 WebKit 浏览器证据，**不是 `.104` 安装版证据**。
- `.103` 隔离进程正常退出且双进程停止后，原 3 个 WebView origin 偏好从私有备份恢复并回读一致；以解锁后安装前新固定的 349 项当前真实资料与配置为基线，退出和回退后均逐字节一致。唯一 `/Applications/EduPi.app` 已从已验 `.99` 回退包恢复，`codesign --deep --strict`、公证装订、Gatekeeper 与原二进制/签名文件摘要通过；失败的 `.103` bundle 保留在私有 checkpoint。未用旧备份覆盖真实教师资料。证据在 `~/edupi-install-checkpoints/v0.3.103/evidence/` 的 `protected-data-after-resume-native-svg-failed-guarded.json`、`webview-prefs-restore-resume.json`、`rollback-after-svg-failed.json` 与 `protected-data-after-resume-post-svg-rollback-guarded.json`。
- `.104` 源码候选的目标测试、类型、目标 lint、`release:verify` 和本机生产 Web 构建通过；构建保留一条既有的 session export 动态依赖警告。临时 Safari 组件页已从源码移除。`.104` 尚未 PR/CI、签名、安装或公开；`.103` 的签名资产不能代替新修复验收。Windows/Linux 未构建，正式 feed/Latest 仍 `.70`。

## 问题证据

- 2026-11-03 只读检查本机 EduPi 会话 `01a157f2…` 的同一条“扫码”请求：连续出现 13 次 `zhixue_login` 调用、13 次文本回执、0 个图片块。旧扩展仅报告 Chrome 进程已启动，无法据此证明窗口已出现二维码；原会话和教师资料未修改。
- Desktop 的 `ToolCallBlock` 此前只提取工具结果中的文字，图片块被忽略。当前默认 Pi 模型为文本模型，本机未配置可用图片生成模型；真照片／绘画不能用前端渲染冒充。

## 本轮源码候选

- 同一教师请求的第二次及后续 `zhixue_login` 在 Desktop 宿主工具调用门被拒绝；下一条明确请求可再试。获授权修补的旧登录扩展会切换到扫码登录，等待二维码真正出现后把临时截图路径交给对话。
- `edupi_show_qr` 使用现成 `qrcode` 包生成 PNG；`edupi_show_image` 只展示当前工作区输出目录内不超过 10 MB 的栅格图，不将文件字节放入模型上下文。路径经真实路径与工作区边界检查，符号链接越界被拒绝。本轮自写的 Canvas 示意图工具在源码候选阶段撤回；简单图形由 Mermaid 或自包含 HTML/SVG 渲染。
- 工具返回图片在折叠的处理详情之外持续可见；二维码可弹窗，当前运行中的二维码结果可自动弹窗。关闭后焦点回到卡片。已完成的 Mermaid 导图默认预览，原源码入口保留。对话中的 HTML 与 Mermaid 可打开现有右侧预览栏，图片沿用原文件栏。
- 用户明确选择自包含 HTML／Mermaid 与简单图形渲染，本轮未调用或接入云端图片 API。assistant 的 `html` 代码块可切换源码／预览和放大；先用 DOMPurify 清理元刷新、脚本和外链属性，再以无权限 iframe 与禁止脚本、联网图片、连接、子框架和表单的 CSP 展示，不把模型生成的 HTML 直接插入主页面。
- 重开会话时不把工具图片的 base64 塞进完整历史响应，而保留指向精确 session entry 与 blockIndex 的本机图片引用；新只读路由按需取原 PNG／JPEG／WebP／GIF，限制 10 MB、校验图片文件头并禁缓存。原先因 `deferMedia=1` 重开后丢图的风险由此修补。
- 审查发现的第二个问题是最终文字回复会把工具调用折进“处理详情”，连带卸载扫码弹窗。现在每个教师请求的视觉结果作为稳定键的独立卡片渲染；处理详情里仅保留工具记录，图片不重复。当前运行和已完成状态均用同一卡片，不因详情折叠而销毁弹窗。
- 最新审查发现工具图片路径曾按 Markdown URL 解析，含 `#` 或类似 `%23` 的真实文件名会被截断或解码，导致图片静默消失。现将工具元数据中的绝对路径按字面保留，继续检查工作区边界，再仅在生成文件 API URL 时编码；两个文件名分别有渲染回归。

## 验证与界限

- 本机合成数据：二维码工具返回 PNG 文件头且不在文字回执重复编码内容；Pi 1 假模型真实执行二维码工具后，重新打开会话仍读到同一 PNG 图片块和 `visual.kind=qr`；另一条真实 Pi 1 假模型链在同一教师请求连续两次发出 `zhixue_login`，实际只执行 1 次、第二条为错误回执。输出图片及越界符号链接正反例、工具图片与本机图片在折叠状态可见。此前 Canvas 示意图测试属于已撤回候选，不再计为本轮交付证据。
- 隔离 Next.js 开发页：1024×768 和 320×568 实际点击、自动弹窗、Esc 关闭与焦点返回均通过；320 宽无横向溢出；Mermaid `mindmap` 在浏览器生成 SVG；合成图片经 `/api/files` 读取为 HTTP 200、`image/png`。测试页和公开测试图片已从源码树移除。
- 同一隔离会话在先前源码候选的 Next.js 路由重新读取：`GET /api/sessions/<id>?deferMedia=1` 为 200，历史响应不含 PNG base64，但包含精确图片 URL；按需 GET 返回 200、`image/png` 和 PNG 文件头。首次开发编译曾因现已撤回的原生 Canvas 工具而 500；该工具及专门的 Next 外部化配置已撤回。最新源码的本机 `npm run build` 已通过，产物包含精确图片读取路由。构建第一次失败于已删除隔离测试页留下的 `.next/dev/types` 文件；仅把该生成类型文件改名保留在忽略目录后，第二次构建通过。
- 另用隔离会话直接挂载真实 `ChatWindow`：在已有最终文字回复、处理详情 `aria-expanded=false` 时，独立二维码卡片仍为 1 项，点击后弹窗打开并从延迟图片路由加载 240px PNG；不是只在单独组件里看到图片。实际运行中弹窗跨模型最终回复的瞬间尚未用真实模型操作，稳定键与宿主切换的源码/测试证据如上。
- 隔离浏览器的合成 HTML 画出三角形；浏览器实际 `srcDoc` 保留内联 SVG 与 data PNG，去掉恶意元刷新、脚本和外网图片 URL，父页面状态未改变。1024px 和 320px 放大窗都可打开，Esc 关闭后焦点返回“放大”，320px 无横向溢出。此项只证明自包含静态 HTML 安全渲染，不代表任意外部网页或脚本可运行。
- 审查补出的长内容问题已修：放大窗中的无脚本 iframe 允许滚动与键盘聚焦。隔离浏览器对 1600px 高的合成 HTML 实际点击预览后以 PageDown 看到“底部”；净化仍去掉脚本／元刷新／外网 URL，主窗口不变。iframe 获焦时直接 Esc 不会跨沙盒关闭外层弹窗；Shift+Tab 到可见关闭按钮后按 Esc 能关闭，焦点返回“放大”。
- 路径修复前源码的 `node_modules/.bin/tsc --noEmit`、23 项相关测试、`npm run release:verify`、本机生产 Web 构建通过；`npm test` 完整本机回归为 3560 通过／48 条件跳过／0 失败。其后路径修复的 MessageView 15 项定向测试、类型检查和目标 lint 通过；最终 head 的全量源码 CI 三项成功。`npm run lint` 为 0 错误／1 条已有警告，警告在未改动的 `scripts/test-edupi-core-history-e2.mjs`。更早同一 PR 候选的 `npm audit --omit=dev --audit-level=moderate` 为 0、发布工具测试 287 通过／7 条条件跳过；本轮无依赖变更，未重复执行。最终源码 [CI 41566334619](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/41566334619) 三项通过。
- 隔离本机 Web 页面实际操作了两次“在侧栏打开”：Mermaid 右栏生成含“备课→上课”的 SVG，HTML 右栏显示内联 SVG；HTML 中合成脚本被净化，父窗口标记仍为 false。临时页面已从源码树移除。这条证据证明同一聊天渲染器及右栏内容组件能互动；完整 `AppShell` 在空合成 Core 根下工作区 API 返回 503，因而当前不能把隔离页面结果写成安装版整页验收。开发页曾出现一条已有的 React `background`／`backgroundColor` 样式提示，未观察到对应功能失败。
- 用户仅授权修复真实 EduPi 目录中的两个未跟踪代码文件后，先以 SHA-256 备份到 `~/edupi-install-checkpoints/2026-11-03-zhixue-qr-code-backup/`，再修改 `extensions/zhixue_bridge.ts` 和 `data/zhixue/scripts/zhixue_login_headful.js`。旧页面默认账号登录；新脚本切到“扫码登录”并确认 `#qrCode img` 真正可见后才截取二维码。桥接工具用本机互斥锁防止重复启动，只在 `details.visual.path` 返回短时截图路径，不把扫码令牌放进模型文字；截图文件权限 0600，登录结束或进程终止后移除。未改教师资料、模型凭据、现有会话或其他旧代码。
- 两个代码文件的隔离联动实测：复制脚本到全新临时根，用空 Chrome profile 和无账号状态访问登录页；首次调用返回图片路径和 PNG 文件头，串行第二次返回同一路径、同一进程 PID，并行两次也只启动一个进程；终止后锁和二维码图均消失。原文件的前后副本与差异补丁保存在同一私有备份目录。没有在真实账号上扫码、写登录状态或验证完整同步，因此**真实智学网登录回传仍未验收**。macOS `.102` 仍需单独签名构建与安装验证；Windows 未构建。
- 本机生产 Web 构建后的忽略目录 `.next` 约 1.6 GB，磁盘可用约 810 GiB。精确缓存清理命令被自动审批审查以“`rm -f` 类命令不允许，改用更安全方式”拒绝；本轮未绕过，也未改其他目录。

## 开源实现核查

- [ZCode](https://github.com/zai-org/ZCode/blob/main/docs/chat/mermaid-rendering.md) 把聊天和右侧查看器的 Mermaid 交给同一渲染入口，流式阶段显示源码，完成后渲染，并用队列串行化 Mermaid 的全局主题状态；[右侧 Preview Pane](https://github.com/zai-org/ZCode/blob/main/docs/ui/preview-pane.md) 按来源类型展示文件、文本和图片。EduPi 沿用已有 Mermaid 组件，并采纳串行渲染边界，避免多个导图同时初始化时互相改主题。
- [AionUi Preview](https://github.com/iOfficeAI/AionUi/blob/main/packages/desktop/src/renderer/pages/conversation/Preview/README.cn.md) 的聊天块可通过 `openPreview` 在右侧展示；[Eigent PreviewPanel](https://github.com/eigent-ai/eigent/blob/main/src/components/Session/PreviewPanel/index.tsx) 也是统一右栏。两者依赖各自 Electron IPC／状态树，不能直接挂进 EduPi 的 Tauri/Pi 会话；本轮把同一“聊天内容交给现有右栏”的交互接到 EduPi 原 `AppShell` 文件栏，没有引入另一套面板。
- 三仓库 LICENSE 均为 Apache-2.0；本轮没有拷入它们的组件源码。实际渲染依赖复用项目现有 Mermaid、DOMPurify 与 `qrcode`，不接入云图片服务。

## `.102` macOS 安装版结果

- Desktop [PR459](https://github.com/PIGU-PPPgu/edupi-desktop/pull/459) 普通合入 main `162da2bb6eb31dca6bb146223f7ba4f827356a68`，与受测 head 同 tree；[源码 CI 41566334619](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/41566334619) 三项成功。唯一 [Mac-only Draft run 41567212906](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/41567212906) attempt1 成功，Release `432216266` 保持 Draft。最终 DMG、更新包和签名资产 ID 分别为 `704156471`、`704117946`、`704118230`；本机完整下载的大小与 SHA-256 均匹配 GitHub 资产，Mac-only 集合指纹 `sha256:a252f92be1302962513f2dcf97d63136ced6d20963335e8f66c7829aa1e244db`。App 公证 Accepted `2c42d8ca-401e-4b3b-9eac-1717f6f5883e`，DMG Accepted `bb86c5bb-6f96-461f-b7a6-1532e10b4172`；CI 和本机装订、strict codesign、Gatekeeper、更新包 Minisign／篡改拒绝、DMG／更新包 App 同身份与 17 个固定源码文件通过。私有证据在 `~/edupi-install-checkpoints/v0.3.102/evidence/`。
- 安装前 `.99` 正常退出后，实际保护根的 346 项文件和模型配置只读指纹及私有回退副本固定；3 个 WebView origin 偏好也备份。唯一 `/Applications/EduPi.app` 从已验 DMG 原位安装 `.102`，文件安装后 346 项原有字节与偏好一致。隔离根 `~/edupi-route1-canary-chat-102-20261103` 中，原生 App／Core helper 双进程身份通过守卫；实际会话里 Mermaid 及右栏 SVG、扫码弹窗与焦点返回、文件名含 `#` 的图片右栏都可见。
- **安装版失败**：同一隔离会话的 HTML/SVG 在聊天内和右栏的 `iframe srcDoc` 均为空白。Safari 对相同沙盒与 CSP 的 `about:srcdoc` 显示文本和 SVG；本地 Wry 0.55.1 对每个 WebKit 导航动作调用回调，EduPi 原 `on_navigation` 只允许本机同源 HTTP，故内部 `about:srcdoc` 被拒绝。这是由源码和原生行为支持的根因推断；`.103` 源码候选仅在主窗口增加精确 `about:blank/srcdoc` 白名单，独立 OpenConnector 窗口维持原同源策略，仍拒绝外部、`data:` 与带参数的 `about:` 导航。本机完整 `desktop:prepare` 固定 Core `dfcdfaef` 并通过，Mac Rust 定向测试 1 通过／58 过滤，版本核对通过；新安装版仍待验证。`.102` 不发布、不更新 feed。
- 隔离验收退出后，我误在已退出的 App 绑定上再调用 CUA 读窗口，工具自动重启了正常资料根的 `.102`。发现进程身份不符后立即停止。严格全文件字节门因此**失败**：与安装前 346 项相比，原有文件、Pi 会话和模型配置没有修改，真实 `.edupi` 新增 3 个运行文件（SQLite WAL、SHM 与另一运行文件）；它们及原备份均原位保留，未删除或覆盖。唯一安装 App 已按签名和原二进制指纹回退 `.99`，原 3 个 WebView origin 偏好恢复且回读一致；回退后仍只多同一 3 项运行文件。`.102` 失败 App 保存于私有 checkpoint，当前正常 App 停止，正式 feed／Latest 仍 `.70`。此差异不能记为数据保持通过。

## `.103` Mac-only Draft 与原生待验

- 修复源码 [PR460](https://github.com/PIGU-PPPgu/edupi-desktop/pull/460) 普通合入 main `d700a128f8cf80ef95cbda578c753401a78c3109`，与本机受测源码同 tree；[源码 CI41579743413](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/41579743413) audit、rust-audit、linux-source 均成功。唯一 [Mac-only Draft run41580432507](https://github.com/PIGU-PPPgu/edupi-desktop/actions/runs/41580432507) attempt1 成功，Release `432290171` 仍为 Draft；最终 DMG／更新包／签名资产 ID 为 `704485550`／`704458636`／`704458967`，本机完整字节分别匹配 SHA-256 `9627d7cf…ce8ebb9`／`f302f490…14d848b`／`1e116725…321dff`，集合指纹 `sha256:6c6cad225e1599ac2e92fca52430356c4eb1c66be83d10d1fe47ca011a42cba3`。App／DMG 公证分别 Accepted `a801ebf2-5d11-48d4-b440-b0120c6550d6`／`5a9788e1-a1e7-4bae-9f34-8d930379ff43`；CI 与本机的装订、strict codesign、Gatekeeper、Minisign／篡改拒绝、三封装同身份和 17 项包内固定源码通过。私有记录在 `~/edupi-install-checkpoints/v0.3.103/evidence/`。
- 安装前以包含 `.102` 意外新增运行文件的**当前**真实根为新基线，349 项受保护文件及配置只读指纹、回退副本和 3 个 WebView origin 偏好备份完成。唯一 `/Applications/EduPi.app` 已从已验 DMG 安装 `.103`，`.99` 签名回退包保留；文件安装后 349 项基线字节与 3 个 origin 均未变。WebView 偏好已按备份隔离用于测试；`.103` App 与 Core helper 仅在 `~/edupi-route1-canary-chat-103-20261103` 合成根启动，双进程隔离守卫通过。隔离进程运行时只读复核真实基线仍 349/349、无新文件。
- 原生 CUA 首次及稍后重新绑定时 macOS 均锁屏，工具明确拒绝读取；尚未操作 `.103` 聊天、HTML/SVG、二维码和冷启动。已请求用户亲自解锁，未绕过锁屏或用旧 `.102` 的浏览器结果冒充 `.103` 安装版通过。为免让未验候选长期占用唯一 App，已停止隔离 App／Core helper，恢复原 3 个 WebView origin 偏好并回读一致；离开隔离进程后与回退 `.99` 后，当前 349 项基线逐字节仍一致。唯一 `/Applications/EduPi.app` 已按原签名和二进制指纹回退 `.99`，`.103` App 测试副本、三资产及私有回退资料备份保留以待解锁后继续。退出测试 App 后不得再调用 CUA 观察已退出的绑定，以免工具自动启动正常资料根；先用进程守卫确认停机。Release 继续保持 Draft，正式 feed／Latest `.70` 不变，Windows/Linux 不构建。
- 清理待验：本机可用空间约 789 GiB；当前工作树的生成目录 `.next` 约 2.0 GiB、`.next-desktop` 约 903 MiB、`src-tauri/target` 约 4.6 GiB，私有 `.102`／`.103` checkpoint 分别约 2.9／3.0 GiB。后两者含签名资产、失败候选、资料回退和验收证据，须保留到 `.103` 原生验收及回退决定完成；之后只核对精确生成目录、忽略状态和占用，再清理可重建缓存与冗余下载，保留证据和必要回退。此前删除 `.next` 的直接命令被自动审批审查以“`rm -f` 类命令不允许，改用更安全方式”拒绝，本轮未绕过或清空其他内容。
