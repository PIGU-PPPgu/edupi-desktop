# 本地构建产物清理

- 日期：2026-10-10，Asia/Shanghai。
- 状态：验收通过；清理规则和现有产物清理均完成，无合并、发布或升级操作。
- 主目录版本：`9ff46e58e2adf07030d91bdd0e711a42c220cc9c`，分支 `feat/jev-openconnector-integration`。
- 环境：macOS 26.5.1、arm64、Python 3.13.9。

## 继续清理

用户追加要求检查旧安装包和临时构建文件，继续清理并保留源码与数据。本次删除 40 个路径，目录与文件占用合计约 3.28 GiB；磁盘可用空间回读为 64.41 → 67.76 GiB，前后净增 3.35 GiB。目录占用和磁盘回读分别记录。

| 删除项 | 数量 | 占用 |
| --- | ---: | ---: |
| v0.3.45 升级临时应用备份 | 1 | 816.22 MiB |
| 已结束的临时测试副本内重复安装的 `node_modules/` | 9 | 约 2.47 GiB |
| 旧 `tsconfig.tsbuildinfo` 编译缓存 | 30 | 18.69 MiB |

旧应用备份位于 `/private/var/folders/xk/qmn_r8g93ljb7b5vqzq3rd040000gn/T/tauri_current_appzDAjas/current_app`；其 Info.plist 确认为 `com.abcwyc.pi-agent`、v0.3.45，仅含应用 `Contents/`，未发现教师数据或配置标记。当前 `/Applications/EduPi.app` 是 v0.3.56，临时备份无进程使用，整个升级临时目录已删除；安装目录保留。

9 份重复依赖来自 3 个 `edupi-core-version-rollback-*` 测试副本的 `old-core/`、`/private/tmp/edupi-sol-pi-dependency-deploy-20261009/` 下 4 个安装实验、`/private/tmp/edupi-sol-pi-desktop-compat-20261009/` 和 `/private/tmp/edupi-visible-validation-TyBncK/`。只删除各自的 `node_modules/`，保留源码、package.json、锁文件、配置、数据与测试证据；没有删除项目工作树内的依赖。目录时间均为 10 月 7—9 日，删除前再次核对真实路径及无进程使用。

| 检查 | 预期结果 | 实际结果 |
| --- | --- | --- |
| 本地目录内 `rg --files` 搜索安装包与压缩包，另查 23 个应用支持/缓存目录和临时应用目录 | 识别安装包，保留源码及教师材料 | 本地扫描 743 个压缩包/安装包路径，只匹配两份 EduPi 报名材料 ZIP，均保留；应用支持/缓存目录无安装包；确认 1 个旧升级应用备份 |
| 补查 105 个 Core Git 工作树，核对忽略规则及跟踪状态 | 找出可重建的遗留构建目录 | 无额外遗留生成目录；首轮删除的 51 个路径也未重新出现 |
| 9 个临时源码目录的非依赖文件、符号链接摘要前后比较 | 删除依赖不改变源码、配置和记录 | 3,925 个文件与链接的目录摘要保持 |
| 安装版 Info.plist 与主程序摘要前后比较 | 保留已安装应用 | 两项摘要保持，版本仍为 v0.3.56 |
| 30 个工作树 `git status --porcelain=v1 --untracked-files=normal` 前后比较 | 删除增量缓存不改变源码状态 | 完全一致；当天生成的 `route1-core-a8fe471/tsconfig.tsbuildinfo` 保留 |
| `lsof -nP -Fpn`、删除后逐项回读 | 所选目录未被使用，删除结果可核对 | 40/40 已不存在 |
| `git diff --check`、文档差异审查 | 只更新清理规则和记录 | 通过 |

本次 `df -k` 原始可用块数为 67,535,840 → 71,050,424，块大小 1024 字节。删除清单、保护目录摘要和前后状态保存在本机 `/tmp/edupi-extra-cleanup-20261010-manifest.json`。

首次全用户目录搜索停在无关 iCloud 笔记目录，已停止该只读扫描；随后对 `.codex/`、`.openclaw/`、Downloads、Desktop、Documents、`.cache/`、`.local/share/`、`Library/Caches/` 和两处系统临时目录完成定向搜索，无访问错误。补查 `.tar.gz`、`.tar.xz`、`.pkg`、`.exe` 等类型只匹配临时字体环境中 6 个 pip 启动器，不是 EduPi 安装包，均保留。未继续读取 iCloud 笔记，也未清理 WebKit 缓存、应用数据或教师材料。临时依赖清理的首次日期预检因要求超过 24 小时而拒绝昨天的副本，未执行删除；改为按用户时区确认 10 月 7—9 日的旧副本后，其他保护检查保持，清理完成。

后续若重跑上述临时实验，需按保留的锁文件重新安装依赖。本次没有重跑临时测试、构建或打包，也未启动或升级已安装应用。

## 首轮范围

通过 `git worktree list --porcelain` 核对 35 个 Desktop 工作树，7 个工作目录存在本轮清理的生成产物，共 51 个路径。每个路径删除前均通过 Git 未跟踪、忽略规则、真实目录及无打开文件检查；按核对后的绝对路径使用 Python `shutil.rmtree` 删除，没有通配符删除工作树或临时目录。

| 工作目录 | HEAD | 清理前目录占用 |
| --- | --- | ---: |
| `/Users/iguppp/.openclaw/workspace/edupi-desktop` | `9ff46e58e2ad` | 5.44 GiB |
| `/Users/iguppp/.codex/worktrees/desktop-l4-exact-grants-20261008/edupi-desktop` | `a2cac63530e7` | 9.76 GiB |
| `/Users/iguppp/.codex/worktrees/edupi-l4-worker-closure-preview` | `01e86c119724` | 6.18 GiB |
| `/Users/iguppp/.openclaw/workspace/edupi-desktop-worktrees/desktop-l4-combo-20261008` | `0512454a93e2` | 5.32 GiB |
| `/Users/iguppp/.openclaw/workspace/edupi-desktop-worktrees/desktop-l4-integrated-pin-20261009` | `5e5cafd9fe40` | 5.36 GiB |
| `/Users/iguppp/.openclaw/workspace/edupi-desktop-worktrees/desktop-six-domain-routing-20261008` | `a8bc819f1cab` | 9.17 GiB |
| `/Users/iguppp/.openclaw/workspace/edupi-desktop-worktrees/route1-core-a8fe471` | `ada91666cbb5` | 13.40 GiB |

删除目录包括 7 份 `.next-desktop/`、7 份 `src-tauri/target/`、7 份 `src-tauri/gen/`，以及这 7 个目录中生成的 `src-tauri/resources/Pi Agent Server.app/`、`server/`、`edupi-core/`、`open-connector/`；主目录与 `route1-core-a8fe471` 的 `.next/` 也已删除。运行进程未占用这些路径。

按目录汇总，Rust 编译缓存与安装包占 41.78 GiB，Next 构建占 7.00 GiB，打包资源与 schema 占 5.84 GiB，合计 54.62 GiB。目录占用与磁盘可用空间变化分别记录，不把目录大小当作实际释放量。

源码、Git 工作树、原有未提交修改、项目依赖、教师数据、模型与认证配置、签名材料、已安装 `/Applications/EduPi.app` 和既有验收记录保留。临时目录内的研究源码、测试状态、日志，以及 Downloads 内的教师材料没有纳入删除范围。

## 首轮检查

| 操作或命令 | 预期结果 | 实际结果 |
| --- | --- | --- |
| `git ls-files -- <产物路径>`、`git check-ignore -q <产物路径>` | 无跟踪文件，命中忽略规则 | 51 个路径全部符合 |
| Python 路径检查及 `lsof -nP -Fpn` | 路径在登记工作树内、目录本身不是符号链接、无打开文件 | 51 个路径全部符合，删除前再次核对 |
| 按已核对路径执行 `shutil.rmtree` 后逐项回读 | 所选目录不存在 | 51/51 不存在 |
| `git status --porcelain=v1 --untracked-files=normal` 前后比较 | 无源码或原有修改丢失 | 6 个其他工作树状态完全一致；主目录新增清理说明和记录，其他状态保持；`route1-core-a8fe471` 的 3 项原有修改保持 |
| `git diff --check`、最终差异审查 | 文档无空白错误，无无关变更 | 通过，本轮仅改 `AGENTS.md`、任务账本并新增本文 |
| `df -k .`、Python `shutil.disk_usage` | 磁盘可用空间增加 | 19.24 GiB → 66.00 GiB，回读净增 46.76 GiB |

`df -k` 原始可用块数为 20,171,540 → 69,206,052，块大小 1024 字节。具体删除清单与前后状态保存在本机 `/tmp/edupi-build-cleanup-20261010-manifest.json`，长期结论以本文和任务账本为准。

## 未验证条件

没有重新构建、打包或运行功能测试，本轮没有修改应用代码；重新生成产物会再次占用磁盘。后续开发会重新生成 `.next/`，打包前需按正常流程准备资源并重新编译。没有启动或升级已安装应用，也没有清理其他项目或系统缓存。
