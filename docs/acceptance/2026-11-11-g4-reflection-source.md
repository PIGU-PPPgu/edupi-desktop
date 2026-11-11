# G4 课后反思来源接线

本轮承接崩溃前的 G4 工作树，完成课堂内容来源登记、教师录入和历史回读的开发验收。状态为**已实现，隔离开发验收通过，待主线集成与安装验收**；不代表完整 L4 放行。

## 版本与环境

- Desktop 起点：`5b3cc20a369149503f179e4841a2be264c08f92b`，分支 `codex/g4-reflection-source-20261110`，包含前轮未提交的 G4 接线；本轮保留并继续完成这些文件。
- 固定 Core：`8f2058696371d9a10ffeb3dae9ce06a0a78b6d03`，受测 checkout tracked clean。该提交包含当时本地 `origin/main` `509082bd937890309013ca84b37a82fade89ed9a`，另有五条 G4 增量提交；尚不能称已合并的 Core 主线。
- 环境：macOS arm64、Node `v22.23.1`。仅隔离合成资料；未使用教师数据或真实模型，未打包、安装或执行 Windows 验收。

## 实现

- 教师点击提交时，先登记与班级、学科、课次、内容类型和原始文本精确绑定的不可变来源，再使用回读得到的新授权版本执行既有 durable prepare、commit 和 readback。
- 来源登记使用现有授权的 CAS，只增加来源，保留权限、作用域、期限及预算；重复登记不增加版本。授权容量达到 128 时拒绝新来源，响应丢失或回读矛盾时不继续写课堂内容。
- 课堂内容表单移除来源 ID 和来源版本的手动输入。收起表单不登记；原文保留首尾空格和换行；迟到响应、日期切换和已有未知操作继续受保护。
- 课堂内容的捕获和恢复拒绝其他课次、其他类型、其他原文及泛用来源。课表移除、停用、重新启用及重启后保留经过验证的完课与课堂内容历史来源。
- 三个带查询参数的读取接口改用项目现有的 `fetch` 加 `desktopApiHeaders` 模式。共享 `fetchDesktopApi` 的纯路径限制保持。

## 验证

以下命令从该 Desktop 工作树执行，Core 根为 `/private/tmp/edupi-core-g4-incremental-20261110`。

```bash
EDUPI_CORE_ROOT=/private/tmp/edupi-core-g4-incremental-20261110 \
node --test --test-concurrency=2 --test-reporter=spec \
  app/api/edupi/proactivity/reflection/route.test.mjs \
  app/api/edupi/proactivity/route.parent-source.test.mjs \
  app/api/edupi/proactivity/route.rollback.test.mjs \
  lib/edupi-reflection-client.test.mjs \
  lib/edupi-reflection-index.test.mjs \
  lib/edupi-reflection-operation.test.mjs \
  lib/edupi-proactivity-control.reflection-source.test.mjs \
  lib/edupi-proactivity-config.test.mjs \
  lib/edupi-proactivity-runtime.test.mjs \
  lib/edupi-bridge-contract.test.mjs \
  components/EduPiLessonReflection.test.mjs \
  components/EduPiReflectionHistory.test.mjs \
  components/EduPiFollowUpReview.test.mjs
```

预期：精确来源、历史、授权与回执保护均成立。实际 **337 passed、0 failed、0 skipped、0 cancelled**。本机日志 `/tmp/edupi-g4-all-affected-20261111.log`。

```bash
EDUPI_CORE_ROOT=/private/tmp/edupi-core-g4-incremental-20261110 \
EDUPI_E2_KEEP=1 node scripts/test-edupi-reflection-source-joint.mjs
```

预期：两课来源隔离、重复登记和捕获幂等、丢回执只读恢复、接受与驳回、课表移除后的历史、停用与重新启用、撤销及旧写拒绝均可完成。实际 `status=passed`，17 项流程检查通过，48 次真实 Core 进程启动，4 次故意丢弃回执得到恢复，模型调用 0，`externalSend=false`。这不是自然跨期、真实教学内容质量或全进程网络监测证据。

最终报告及源码逐文件哈希在 `/tmp/edupi-g4-joint-20261111-final.log`。保留合成根 `/private/tmp/edupi-g4-joint-Tgfqqe` 和 `/private/tmp/edupi-g4-control-cTFK3l` 供复核。

另执行 `node_modules/.bin/tsc --noEmit --incremental false`、七个本轮实现文件的 ESLint 和 `git diff --check`，均通过。独立只读审查发现联合脚本遗漏课堂内容历史来源的 P2，修复后上述真实联合流程通过。

## 页面证据

在隔离页面加载真实 `EduPiLessonReflection`、客户端、CSS 和 Desktop route handlers，连接固定版本的真实 Core。仅原生 token IPC 使用合成适配器，不代表 Tauri 安装版。

实际操作：选择教学反思 → 输入带首尾空格和换行的合成文本 → 提交 → 待审核 → 接受内容 → 刷新 → 从课堂内容历史回读；随后关闭预览和 Core，重新启动并从页面再读同一记录。第二课次输入后收起，确认未产生来源登记或观察记录。

持久化回读确认原文完全相同、仅一条对应 observation 和 accepted fact、取消文本不存在。页面所有业务请求为 200，来源登记仅一次；成功不以 HTTP 状态单独判定。截图保存在本机 `/Users/iguppp/.playwright-mcp/edupi-g4-accepted-history-20261111.png`，请求和事实身份回执在 `/tmp/edupi-g4-browser-20261111/evidence.json`。

本机预览夹具及合成根保留供复核，预览页、服务和 Core 已停止。开始预览前同卷可用约 715 GiB；本轮未做清理或删除旧产物。保留路径仅用于本轮证据复核，后续明确清理范围后再处置。

## 失败与修正

- 起始定向测试实际 93 passed、6 failed、1 条件 skipped：旧夹具仍使用泛用内容来源；现以精确来源及登记流程取代，并保留泛用来源拒绝回归。
- 首次真实联合在第二来源登记回读失败，授权实际已更新，页面应保持未知；原因是 Core 对来源排序而 Desktop 按未排序数组比较。修正规范顺序后继续验证，未放松 CAS 或其他授权字段比较。原日志 `/tmp/edupi-g4-joint-20261111.log`。
- 第二次联合实际在历史刷新时出现 `9 !== 5`。原脚本只计算完课来源，漏掉两条课堂观察和两条新内容；修正为完课与内容历史及课次绑定来源的去重集合，仍精确排除外班来源，且增加各阶段内容历史回读。原日志 `/tmp/edupi-g4-joint-20261111-fixed.log`。
- 页面首次操作在发 HTTP 前失败，报 `Desktop API path is invalid.`；三个读取接口未接上查询参数。修复后新增携带 token、AbortSignal 和 `no-store` 的三接口回归，实际页面录入与冷重启回读通过。

## 未验证

尚未验证完整 AppShell 导航、签名安装版、实际 Tauri token IPC、Windows/Linux、真实教学内容质量、自然七天跨期、真实 OS 睡眠和系统通知点击。G5 原配对与周期内部材料两期证据沿用原记录，不能以本轮 G4 结果替代。完整 L4 仍未验收通过。
