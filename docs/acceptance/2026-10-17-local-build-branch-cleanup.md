# 本地构建产物与分支清理验收

日期：2026-10-17。状态：本轮本地清理验收通过；不改变应用功能或发布验收状态。

## 范围与操作

环境：macOS 26.5.1，Desktop `main` `d4d58f531d83f851176819b957d6f424e90f173e`。先用 `df -h`、`du -sh`、`git worktree list --porcelain`、`git status --porcelain`、`git check-ignore`、`git ls-files` 和 `lsof +D` 核对空间、Git 跟踪与进程占用。清理前有 34 条本地分支、35 个工作树；磁盘可用 13,241,472 KiB。

20 个闲置手工工作树均无已跟踪或未跟踪改动、无开放 PR；忽略项仅为可重建的 `next-env.d.ts` 或 `vendor/next-root-glob/node_modules/`。每个分支先把精确提交写入 `refs/archive/edupi-worktree-cleanup-20261017/<原分支名>` 并回读 SHA，再用 `git worktree remove` 移除工作树，最后按原 SHA 删除本地分支引用。逐项清单、原路径、提交 SHA 和操作状态保存在 `~/.codex/logs/edupi-worktree-cleanup-20261017/desktop-worktrees.json`；同目录 README 记录恢复命令。

另按精确路径删除已停止开发服务的主目录 `.next/` 540,284 KiB，以及已暂停发布工作树 `route1-core-a8fe471/node_modules/` 1,615,572 KiB。二者均被 `.gitignore` 忽略、没有跟踪文件，`lsof +D` 未发现占用；该发布工作树的源码、`package-lock.json`、浏览器验收记录与分支保留。20 个工作树清理前合计 333,336 KiB。

## 结果

| 检查 | 预期 | 实际 |
| --- | --- | --- |
| `git for-each-ref refs/heads`、`git worktree list --porcelain` | 闲置工作树和分支退出常用列表 | 分支 34 → 14，工作树 35 → 15；20 个原路径均不存在 |
| 归档 SHA 回读 | 提交可恢复 | 20/20 归档引用与删除前 SHA 一致；`git fsck --connectivity-only --no-dangling` 通过 |
| 生成目录与安装版 | 只删除可重建产物 | 两处目录均不存在；`/Applications/EduPi.app` 保留，未改远端 Release、tag 或 feed |
| `df -k` 回读 | 实测可用空间增加 | 13,241,472 → 15,804,084 KiB，增加 2,562,612 KiB，约 2.44 GiB；被删除路径清理前合计 2,489,192 KiB |
| `git status --short --branch` | 原有用户内容不受影响 | 主目录仍为 `main`，原有未跟踪 `mv/` 保留；发布工作树无代码改动 |

仍保留带未提交内容的工作树、六个开放 Draft PR 的工作树、已暂停发布工作树，以及 Codex 管理的工作树。旧本地安装包未发现，`/Applications` 只有一份 EduPi 应用；`~/edupi-install-checkpoints` 仅约 1.3 MiB 验签材料，继续保留。

## 追加提交与清理

用户允许提交后，将三个旧手工工作树的原有源码与验收材料分别提交为 `e7c3a6e7`（首次引导）、`391dc221`（C10 任务状态）和 `5e5e224c`（R18–R21 桌面检查点）。C10 原有四条断言仍按旧状态文案判断，已按该分支共享状态规则对齐并复测。另在 Codex 管理的 L4 工作树提交一张合成数据截图为 `8915c74e`；该工作树及本地提交保留，未推送或合入主线。

首次引导定向测试 3/3、C10 定向测试 38/38、桌面结构测试 23/23 通过；三个手工工作树提交后重新确认无未跟踪改动，精确提交写入同一 `refs/archive/edupi-worktree-cleanup-20261017/` 命名空间并回读，再移除工作树和原本地分支。逐项提交、原路径、SHA 与状态在 `~/.codex/logs/edupi-worktree-cleanup-20261017/dirty-checkpoints.json`。首次引导工作树的 `.codegraph/` 仅含本机索引数据库及声明不可提交的 `.gitignore`，确认未跟踪、无人占用后删除 14,720 KiB。完成本轮临时文档工作树清理后，本地分支为 11 条、工作树为 12 个；初始 34 条、35 个中共有 23 个工作树和分支完成可恢复清理。

`mv/` 已明确排除。误合入其源码的 [PR #361](https://github.com/PIGU-PPPgu/edupi-desktop/pull/361) 已由 [PR #362](https://github.com/PIGU-PPPgu/edupi-desktop/pull/362) 完整回退；最终主线文件树与 #361 前的 `ab42d012` 一致。本地 `mv/` 仍为原有 718 个文件、425,500,842 字节，抽查两份脚本及两份视频的 SHA-256 未变，本轮不提交或清理其中内容。

## 未验证

没有逐一重新检出 23 个归档分支；已逐一核对归档提交和仓库连通性。旧检查点未做安装版、浏览器或完整产品流程验收，不把本地提交写为主线交付。没有重新安装依赖、构建或运行应用功能测试，本轮只改变本地工作树和生成产物。
