# 本地缓存清理验收

日期：2026-10-13。状态：本轮清理验收通过，沿用 R14 本地产物清理记录；不改变应用功能、合并、发布或升级的验收状态。

## 范围

环境为 macOS 26.5.1，主目录分支 `feat/jev-openconnector-integration`、HEAD `9ff46e58e2adf07030d91bdd0e711a42c220cc9c`。开始前保留的改动为 `AGENTS.md`、路线图及未跟踪的 `2026-10-10-local-build-cleanup.md`。本轮继续清理已结束实验的重复依赖、旧安装副本和已合并的闲置本地分支。

删除 42 份 `node_modules/`，清理前占用合计 23.75 GiB。每份均核对 Git 忽略规则、无跟踪文件、锁文件存在，删除前重新检查进程工作目录、打开文件和命令中的路径引用。各目录的 HEAD、Git 状态摘要、相对 HEAD 的修改摘要及锁文件摘要前后相同。

删除 `/Users/iguppp/edupi-install-checkpoints/v0.3.58/rollback/EduPi-public-056.app`，占用 0.78 GiB。删除前核对其 `Info.plist`、主程序及 `CodeResources` 与 `/Applications/EduPi.app` 的摘要完全相同，且无进程使用。安装版仍为 0.3.56，三个文件摘要保持；v0.3.58 至 v0.3.64 的七份 `evidence/` 与 `RESUME.md` 保留。

刷新两个仓库的 `origin` 后，删除 11 个已合入 Core `origin/main`、未被工作树占用的本地分支及其旧跟踪配置。每个分支按预期提交进行引用删除，并在删除后再次证明该提交是主线祖先。研究用分支保留。

## 结果

删除目录清理前的占用合计 24.53 GiB。`df -k` 可用空间由 2.72 GiB 增至 28.67 GiB，回读净增 25.94 GiB。原始可用块数保存在本机审计目录；APFS 记账与其他并发项目也会影响净增，不能把两种口径视为相同。

| 检查 | 预期 | 实际 |
| --- | --- | --- |
| `df -h`、`du -sh`、`du -sk` | 删除前明确空间与目录占用，删除后回读 | 已执行，空间增加 |
| `git check-ignore`、`git ls-files`、`lsof`、`ps` | 只删除忽略、未跟踪且闲置的依赖 | 42 份均符合，删除路径均已不存在 |
| Git 状态、修改及锁文件摘要 | 保留源码、原有修改及锁文件 | 42 个目录前后相同 |
| `git worktree list --porcelain` | 保留工作树 | Desktop 35 条、Core 115 条注册路径前后完全一致 |
| `git merge-base --is-ancestor` | 只删除已合并的闲置分支 | 11 个分支均通过，引用已不存在 |
| `git fsck --connectivity-only --no-dangling` | 两个仓库连通性正常 | 均退出 0，无错误 |
| 持续研究服务 `GET /api/status` | 清理不影响正在运行的服务 | HTTP 200、`researching`、循环启用，第 116 轮 |

完整清单、分支提交、保护目录、前后摘要及原始空间读数保存在 `/Users/iguppp/.codex/logs/edupi-cleanup-20261013/`，汇总为 `summary.json`。本轮仅新增本文并在原路线图记录结果，已有改动保留。

## 保留与未验证

在用及共享依赖、当前研究验证副本、研究证据引用的冻结 oracle 依赖保留。源码、全部工作树、教师数据、模型与认证配置、签名密钥和验收记录保留。旧测试目录重跑时需按保留的锁文件重新安装依赖。

未重新构建、打包、安装或运行应用功能测试；本轮没有修改产品代码。服务状态回读只证明清理后的服务状态，不代表研究或教学质量通过验收。
