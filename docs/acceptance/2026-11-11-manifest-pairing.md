# Desktop/Core manifest 配对验收

日期：2026-11-11。归属 R15 发布可追溯性子项，源码已实现并完成本机定向验证；远端 CI 和跨平台验收未运行。L4 状态不变，完整产品验收未完成。

## 独立审查三项修复复验

2026-11-11：三项修复的本机定向验证通过，覆盖下述拒绝路径；不取代跨平台、安装升级或 L4 产品验收。基线、分支和 Core commit/tree 沿用下节，所有改动仍未提交。

- P1：`assertImmutableCoreCheckout` 在读取及导入 Core 模块前，拒绝 `assume-unchanged` / `skip-worktree`，读取指定 commit 的完整 tree，按 Git blob 头与原始文件字节独立计算对象摘要。核对所有 tracked 文件而非信任 index/stat/clean filter；拒绝 tracked symlink、submodule 和 symlink 父目录。Core 模块导入前与实际 bundle 完成后再次核对。原始 checkout 经 filter 或 CRLF 转换后即使 Git 状态干净，只要字节不同仍拒绝，不运行 clean filter 来归一化被导入代码。
- P1 拒绝证据：两个隐藏标志分别作用于 `scripts/edupi_component_manifest.mjs` 和 `contracts/edupi-desktop-component-manifest.json`，共四组污染；每组先验证隐藏的未修改文件也拒绝，再修改内容并确认 `git status --porcelain=v1` 为空，配对仍在导入前拒绝。额外覆盖 clean filter、CRLF 在状态干净时与 tree blob 字节不同的拒绝，以及 tracked symlink / 替换父目录的拒绝。
- P2 换行：`.gitattributes` 为 `contracts/edupi-core-compat.json` 和 `src-tauri/resources/component-versions.json` 明确 `text eol=lf`。实际创建同一 Git fixture 的 `core.autocrlf=false/true/input` 三种 checkout，正向对照文件在 `true` 下确实为 CRLF；两份身份文件仍逐字节一致，完整 Core 配对身份一致，每种 checkout 的发布清单 CLI `--check` 均通过。
- P2 发布：draft 的 `npm run release:manifest` 前执行 `node scripts/write-component-versions.mjs --check`，防止生成步骤修复并掩盖过期已提交清单。publish 重新 checkout、安装锁定依赖后再次执行相同检查，核对完整生成预期，包括 Core 身份和 compat 原始字节摘要，再进入资产处理；保留原 release version 检查。publish 不生成清单。
- P2 拒绝证据：在隔离 fixture 中保持 `appVersion` 和三个组件版本不变，逐个污染 Core 身份全部七个字段，包括格式合法的错误完整 commit 和四个完整 SHA-256 摘要；CLI 每次退出 1、报告 `component-versions.json is stale`，并保留文件字节不变。恢复原文件后退出 0。workflow 哨兵同时确认 draft 生成前、publish 上传前的检查顺序；哨兵不是 Actions 运行证据。

最终实际命令与结果：

```sh
CORE_CHECKOUT=/var/folders/xk/qmn_r8g93ljb7b5vqzq3rd040000gn/T/edupi-core-review-20261111-taclpzsm
node scripts/pair-edupi-core.mjs --core-root "$CORE_CHECKOUT" --core-commit 509082bd937890309013ca84b37a82fade89ed9a --check
node scripts/write-component-versions.mjs --check
EDUPI_CORE_ROOT="$CORE_CHECKOUT" node --test scripts/pair-edupi-core.test.mjs scripts/packaged-core-bundle.test.mjs scripts/release-components.test.mjs scripts/pi-packages.test.mjs scripts/release-workflows.test.mjs lib/edupi-core-root.test.mjs lib/edupi-bridge-contract.test.mjs
node_modules/.bin/tsc --noEmit --incremental false
node_modules/.bin/eslint scripts/pair-edupi-core.mjs scripts/pair-edupi-core.test.mjs scripts/release-components.test.mjs scripts/release-workflows.test.mjs
git diff --check
```

两项 CLI、tsc、ESLint、diff 检查退出 0；最终套件 **98 通过、0 失败、0 跳过**，耗时 37,525 ms。首轮 filter 夹具未刷新 index 的 stat 信息，未稳定得到干净状态，曾有失败；修正为经 clean filter `git add` 刷新后再验证，最终全套重跑通过。没有削弱拒绝断言。

指定 Core 仍只读：验证前后 HEAD `509082bd937890309013ca84b37a82fade89ed9a`、tree `771ca4c51cea2cb33ed90a8d7cd38a7334221e38`，Git 状态为空。测试使用本轮临时同 commit clone，执行 `npm ci --ignore-scripts --no-audit --no-fund`；未写业务数据库，Core bundle health 使用隔离临时运行库并随测试删除。无学校字段或真实数据需要确认。

协作与 CI：开始时 15 个未提交路径完整保留；本轮未负责的七个既有文件经前后 SHA-256 核对逐字节不变。`.github/workflows/core-pairing-checks.yml` 是主 Agent 单独新增，本修复未修改；按主 Agent 补充，actionlint 已通过、现有 Core 只读 secrets 存在，这两项不是本修复执行者独立验收。主 Agent 后续用一个 PR 推送并观测定向 CI，**远端 CI 仍待运行**；本执行者未提交、推送、打包、发布或递归委派。

清理：本轮临时 Core clone `/private/var/folders/xk/qmn_r8g93ljb7b5vqzq3rd040000gn/T/edupi-core-review-20261111-taclpzsm` 已删除，删除前 448,020 KiB；同卷可用空间由 767,287,947,264 增至 767,755,689,984 bytes，实际变化 +467,742,720 bytes。测试 fixture 自动清理，Desktop `.manifest-pairing-*` 与 `src-tauri/resources/edupi-core-test-*` 均为零；未创建 Next/Tauri 构建目录或生成 server/Core/node/open-connector 资源，保留在用 Desktop 依赖。上述临时 `CORE_CHECKOUT` 路径现已不存在，复跑需要重新创建同 commit 临时副本。

## 版本与边界

- Desktop 基线 `381060055769430cab8ef89f64a4d2c6f272564c`，分支 `codex/manifest-pairing-20261111`，本轮修改未提交。
- Core 固定 `509082bd937890309013ca84b37a82fade89ed9a`，tree `771ca4c51cea2cb33ed90a8d7cd38a7334221e38`。
- 指定 Core checkout 只读且保持干净。因该目录没有依赖，在本轮临时同 commit 克隆安装 `npm ci --ignore-scripts --no-audit --no-fund`；验证前后核对原目录和副本的 HEAD、tree 与 Git 状态。
- macOS，本机 Node `v22.23.1`；Desktop 依赖由锁文件安装，未改变 package 或 lockfile。
- 未修改 Intellibrain、Core 产品代码或已安装应用，未构建安装包、未发布、未推送、未合并、未递归委派。
- 打包回归实际启动无 Git 的 Core 并检查 health，使用隔离临时数据根；临时运行库随测试删除，未写用户业务资料或真实数据，不涉及学校字段确认。

## 行为

入口：

```sh
node scripts/pair-edupi-core.mjs --core-root "$CORE_CHECKOUT" --core-commit 509082bd937890309013ca84b37a82fade89ed9a
node scripts/pair-edupi-core.mjs --core-root "$CORE_CHECKOUT" --core-commit 509082bd937890309013ca84b37a82fade89ed9a --check
node scripts/write-component-versions.mjs
node scripts/write-component-versions.mjs --check
```

`CORE_CHECKOUT` 必须是安装过锁定依赖的、绝对路径的干净同 commit checkout。允许浅克隆；不把 `main`、`HEAD`、tag 或缩写 SHA 当成不可变 revision。

- 生成入口核对完整 commit、checkout 根、tracked/staged/untracked 变更、两份组件清单算法及自摘要、schema 的 canonical hash、fixture 原始文件摘要与大小、Desktop 镜像、Pi/Durable SDK 对齐、Core 模块和资产闭包、依赖文件闭包以及实际 Git-free bundle 校验。生成后再次核对 Core 状态。
- 配对元信息 `paired_prs`、能力原因和 change note 保留；不自动替换 Desktop schema 或 fixture。本次生成结果与原 `contracts/edupi-core-compat.json` 逐字节一致，因此该文件没有差异。
- TS 从 JSON 和本地 schema/fixture 读取身份，删除重复 commit/hash 字面量；完整 commit/hash 格式、固定路径、契约版本、命令、projection、依赖和原因集合仍严格校验。实际 Core 内容继续由原 root / bundle 校验器核验。
- 发布 `component-versions.json` 新增 `core`，包含 commit、双组件摘要、runtime schema 摘要、compat JSON 原始字节摘要；原三组件和版本例外保留，`release-component-pins.json` 无改动。
- signed release 在 Core 安装依赖后、打包前对同一个 `steps.core.outputs.commit` 执行 `--check`，覆盖所有平台。`release:verify` 同步检查发布清单中的 Core 身份。

## 本机证据

1. 指定同 commit Core 副本执行入口 `--check` 通过；生成模式通过且保持原 compat JSON 逐字节不变。
2. `EDUPI_CORE_ROOT="$CORE_CHECKOUT" node --test scripts/pair-edupi-core.test.mjs scripts/packaged-core-bundle.test.mjs scripts/release-components.test.mjs scripts/pi-packages.test.mjs scripts/release-workflows.test.mjs lib/edupi-core-root.test.mjs lib/edupi-bridge-contract.test.mjs`：91 通过，0 失败，0 跳过。
3. 后续新增清单自摘要测试及 checkout 根、schema version 校验后，`EDUPI_CORE_ROOT="$CORE_CHECKOUT" node --test scripts/pair-edupi-core.test.mjs scripts/release-components.test.mjs`：11 通过，0 失败，0 跳过；与上项存在重叠，不相加为完整套件数。
4. 拒绝路径覆盖浮动/缩写 ref、CLI 错误、HEAD 不符、tracked/staged/untracked 脏 Core、错误版本/算法/入口/自摘要、被删模块和资产、过期 compat、错误 Desktop schema、命令/契约/原因不完整、发布身份缺失，以及实际 bundle 依赖被篡改或缺失。
5. `node_modules/.bin/tsc --noEmit --incremental false`：通过。
6. 改动的 TS/MJS 定向 ESLint：最终 0 error、0 warning。最初因移除 hash 常量断言留下的 unused import 已删除。
7. `node scripts/write-component-versions.mjs` 与 `--check`：通过；`git diff --check`：通过。
8. 最初接入时暴露 Desktop 无独立 Bridge hash 镜像、macOS `/var` 与 `/private/var` 规范路径差异，均已修复，并由实际固定 Core 配对回归覆盖。

## 清理

本轮未运行 Next/Tauri 构建。测试结束后 `.manifest-pairing-*`、`src-tauri/resources/edupi-core-test-*` 均为零；`.next/`、`.next-desktop/`、`src-tauri/target/` 和生成 server/Core 资源均不存在。已删除本轮临时 Core 副本 `/private/var/folders/xk/qmn_r8g93ljb7b5vqzq3rd040000gn/T/edupi-core-manifest-20261111-taa0dc79`，删除前 `du -sk` 为 448,020 KiB；删除前后同卷可用空间变化 +467,488,768 bytes。原始 Core 只读目录保留且 Git 干净；测试生成 bundle 目录为零。Desktop 项目依赖保留。

## 未验证与接手

- 未运行 GitHub Actions、Windows/Linux 实机或安装包发布，不把 YAML 结构断言当跨平台运行证据。
- 未运行依赖远端最新 Release 的 `npm run release:verify`；本轮使用本地发布身份生成/检查和既有版本 pin 定向测试，不查询或变更外部 Release。
- 未运行全量应用测试、Next/Tauri 构建、安装升级或 L4 模型/课堂产品验收，范围内的 manifest 与实际 bundle 验证不替代这些项目。
- 主 Agent 负责整合本分支和后续 CI；R15 公开安装升级与 L4 继续沿原账本条件验收。

回退可还原本轮所属文件，不涉及 schema migration 或业务数据回滚；不得覆盖其他工作者后续改动。
