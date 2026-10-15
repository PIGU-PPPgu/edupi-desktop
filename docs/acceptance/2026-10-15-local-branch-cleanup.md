# 本地分支清理验收

日期：2026-10-15。状态：本轮本地分支清理验收通过；不改变应用发布或功能验收状态。

## 范围与操作

环境为 macOS 26.5.1，Desktop 仓库从 `main` `531da689e74366c2b0f429418cf37f3b6288b1bc` 开始。原主目录四份未提交清理记录先在原分支提交为 `d9c5a65d`，相同内容由 [PR #352](https://github.com/PIGU-PPPgu/edupi-desktop/pull/352) 合入远端 `main`；主目录再切回 `main` 并快进到该合并提交。为 PR 临时创建的干净工作树已移除。

清理前逐一读取 87 条本地分支、35 个工作树和远端分支；排除 `main`、被工作树占用的分支以及开放 PR 的分支。其余 53 条闲置分支先以精确 SHA 写入 `refs/archive/edupi-branch-cleanup-20261015/`，再删除原 `refs/heads/` 引用。归档清单记录原名、SHA、主线包含关系、远端精确备份和操作结果，位于 `~/.codex/logs/edupi-branch-cleanup-20261015/desktop-branches.json`；同目录 README 给出恢复命令。

## 结果

| 检查 | 预期 | 实际 |
| --- | --- | --- |
| `git for-each-ref refs/heads` | 闲置分支移出常用列表 | 87 → 34 条，53 条已归档 |
| 归档 SHA 与 `git cat-file` 回读 | 原提交仍可恢复 | 53/53 与删除前相同；其中 1 条是主线祖先、3 条有同 SHA 远端分支，其余也保留本地归档引用 |
| `git worktree list --porcelain` | 不改已有工作树 | 本轮额外工作树移除后仍为原有 35 个；带改动或独立提交的既有工作树未动 |
| `git status --porcelain`、`git fsck --connectivity-only --no-dangling` | 主目录干净、仓库连通 | 两项通过，主目录为 `main` 且与 `origin/main` 一致 |
| 磁盘回读 | 不把分支引用删除冒充产物清理 | `.git` 占用 98,045,952 → 98,058,240 字节；可用空间 50,534,506,496 → 50,525,184,000 字节，未测得空间释放 |

本轮仅删除临时文档工作树和闲置分支名称，没有清理任何既有工作树、源码、依赖、教师数据、配置、安装版或 Release 资产。需要恢复时按清单执行 `git branch <原分支名> <archive_ref>`；原分支 `feat/jev-openconnector-integration` 的本地提交也在归档中。

## 未验证

未逐条重新检出 53 个归档分支；已验证每个归档引用仍指向原提交且仓库连通。没有构建、安装或运行应用功能测试；v0.3.68 Draft 构建另行记录。
