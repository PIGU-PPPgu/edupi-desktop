# G4 macOS 0.3.114 发布验收

当前状态：**Mac-only 公开预发布、匿名三资产完整校验、公开 DMG 实际重装与原生冷启动验收通过。** 本记录更新于北京时间 2026-11-15，取代 2026-11-13 的锁屏阻塞状态。唯一已安装 App 为退出的 `.114`；正式 Latest `v0.3.70`、updater-feed `7924328ee893c9527adb54e25b0023e9f2a26ff7` 保持。Windows/Linux 安装暂缓，完整 R04／R15／L4 均保持未勾选。

## 冻结身份

Desktop `febea954199f033b7ed0d60baf3928b18ef07879`，Core `98e4f7cd0c31dd30954574d2040bb1b948cdd954`。PR491 正常合入 `2feec5e6a85c3bdd74ffc9c4b686c3a5ff7d586b`，候选和 merge tree 同为 `8002432e0cea27143052f0f74902878ba82ec335`；tag `v0.3.114` 始终指向冻结候选。source CI43290926327 三项通过，Core PR463 和完整 Mac CI 沿用同一冻结源码。

Mac-only run43292901925／attempt1／job131443854463 全部成功，仅调用 `phase=draft/platform=macos`。本机定向交互与 route 109/109、独立组件42/42、typecheck、lint和发布回归通过；lint保留既有1项 warning。clean legacy/Main4 原发布 canary 均通过，capabilityModelCalls为0、externalSend=false。

`.112` 原生发现空占位与已有内容同时显示；`.113` 隐藏占位后又丢失继续录入入口，因此取消其签名 run43282389572，保留 source232762c7、tag和Draft443365746，未安装或公开。`.114` 同时保留已有内容和每课次单一录入入口，新建只清除克隆目标的 content，原来源、CAS、回执与审核目标继续生效。旧失败证据均保留。

## 原生流程

隔离根 `~/edupi-route1-canary-g4-114-20261113` 的原始 seed 保持字节不变。seed 建立时课程尚未结束，lessonId为null；解锁后从真实原生“登记课次”的持久化回执解析唯一课次，绑定 class/subject/date/slot/term 和非空 lessonId，未从待验 fact 回填。

安装版实际操作：登记 → 输入并收起草稿，observation/fact保持0/0 → 首条教学反思提交、接受、历史回读，1/1 → 第二草稿收起，仍1/1且首条字节不变 → 第二条课堂反馈提交、接受，2/2 → 两条历史 → 原生菜单 Quit、App/helpers为0 → 同根真实冷启再读两条和历史 → About确认安装`.114`、最新正式`.70` → 原生Quit。原文的两个首尾空格和换行均逐字保留，每条只有一次accept历史，观察／来源／fact独立。

页面与冷启均实际看到2条有内容记录、0条空占位、1个新增入口。七份数据 phase、UI、fixture resolution、独立启动／退出及时间顺序互相绑定；私有 protected-cold 和公开 public-cold 均另做真实启动和读取。对应文件包括 `native-g4-ui-acceptance.json`、`native-g4-data-*.json`、`native-g4-protected-cold-*.json` 和 `native-g4-public-ui-acceptance.json`。

## 签名与公开资产

Release443426142 已通过完整 tuple PATCH 设为 `draft=false/prerelease=true/make_latest=false`；未调用全平台 publish。

| 文件 | Asset ID | 字节数 | SHA-256 |
| --- | ---: | ---: | --- |
| `EduPi_0.3.114_aarch64.dmg` | 741074323 | 238799364 | `8aee0fce27839ca0c1a1fd1992537a2cfcfdba48337c2a0f42844a76e8a86eed` |
| `EduPi_aarch64.app.tar.gz` | 741034840 | 240082907 | `3036f598ee235e56d051ab2fd9e9b10d6447b60fa16fdc16d05fde7c4de47245` |
| `EduPi_aarch64.app.tar.gz.sig` | 741035787 | 404 | `f40ed85fc2ecbdf04ff3d1f0bfac72e89adea8b7de2363b412ed6bd8bcef8dd6` |


集合指纹 `sha256:8db1acfada3e9b9a7190d229f83ceb08a1b79461ee683f3bc74307374e8ada0f`。三文件完整大小／摘要、固定公钥 Minisign与篡改拒绝、App／DMG公证装订、严格签名、Gatekeeper、DMG与updater App全树及31份冻结源码均通过，团队`BY3XZG2839`。

匿名下载对API和三个公开URL全程不使用凭证，逐字节校验同一资产集合。初始慢传输保留 partial；一次range短读被门禁拒绝，补齐缺段后对完整文件重新散列，未把partial计为完成。安装前再核对公开DMG的实际挂载源、完整摘要及App全树，实际替换`/Applications/EduPi.app`，随后重新验签、公证ticket、Gatekeeper和完整树。

公开安装后原生重启，选择原日期，实际看到同一两条内容与历史；完整facts文件、observation/fact/review均与已接受的私有cold相同。About再次显示`.114`与正式`.70`，原生Quit后App/helpers为0。`public-install-startup-verification.json` 已记录 `publicManualInstallStartupVerified=true`。

## 资料保护与恢复

最初备份曾被14个mdworker读取复制的`.DS_Store`所阻，改用本轮`rollback.noindex`完整备份后严格通过，未停止索引服务或放宽句柄、字节检查。锁屏启动被真实CUA拒绝后，仅停止已两次核对的本轮隔离进程，原始锁屏证据和恢复结果保留。

跨日暂停期间两次旧保护区间检出日志、智学定时产物及模型配置5项变化，两次失败均保留，未覆盖或回写。其余345项与前基线相同，3个追加日志的完整前缀一致，两项可变文件的前后完整副本分别留存；写入来源未由字节或FD身份推断。新的完整350项快照和备份建立后，真实protected-cold及公开重装／public-cold后的严格检查均为350项一致、changedFiles为空。

WebView备份读操作产生的空WAL／SHM曾让证据集合门失败，原v1 binding保留；v2绑定50项稳定文件，核对原主DB及manifest，拒绝非空WAL，使用只读immutable查询。3个原WebView来源在私有及公开验收后均实际恢复、复核；global UI prefs全字节相同，未回写配置。Feishu PID74722持续运行。

临时Core工作树后来缺失Git元数据和部分源码；登记的HEAD仍为冻结98，792份存留tracked文件均匹配，1592份缺失。仅用官方worktree repair恢复Git对象读取，未改写残存源码；该部分目录不再用于执行。签名App始终使用自身完整Core，后续源码预览使用从同commit建立的完整工作树。恢复诊断已保留。

## 清理与保留

2026-11-15公开验收后的实际清理：两个DMG已卸载，完整下载副本、已用range parts及已停止的预览`.next`已删除，路径报告分配量2,030,477,312字节，磁盘可用空间实增2,034,380,800字节，见`generated114-cleanup-after-public.json`。两份初始慢传输partial及一份短读分段作为失败证据保留，清理条件为115公开安装验收通过。

早期已清理`.112`的下载、解压及已证明同树的失败安装副本，分配量2,432,136KiB；清理`.114`重复解压和空挂载点975,760KiB。原记录为 `generated112-cleanup-before114.json`、`generated114-cleanup-locked.json`。本次公开路径的下载、range parts和两个挂载副本在完成验收后清理并另记实际路径及释放量。

`.108`稳定回退、完整真实资料快照和原失败日志继续保留。`.112`回退暂作为本轮`.115`交付前的额外恢复点，清理条件为`.115`公开安装验收通过；已安装App不属于缓存。两个版本的合成数据与证明保留用于同对象回读，不清除原seed或原生日志。

## 未验证

生产资料迁移、自然七天跨期、真实OS睡眠与系统通知点击、真实provider及教学内容质量、Windows/Linux均未验收。Mac手动预发布的完成不放行完整L4或自动更新通道。

私有恢复入口为 `~/edupi-install-checkpoints/v0.3.114/evidence/continuation.json`。所有发布、匿名下载、原生UI及保护证明均位于同一evidence目录；`.112/.113`旧tag与Draft保持原身份。
