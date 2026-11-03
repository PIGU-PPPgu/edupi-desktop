# Core #436 与 Desktop 配对

2026-11-03 源码候选：Core main `008d3e63cc1ab4fa2adfba4817241720408dc6fb`，相对先前固定的 `dfcdfaef` 前进 8 个提交；Core 的 main [Quality run 41569399616](https://github.com/PIGU-PPPgu/edupi/actions/runs/41569399616) 中 core-quality 成功。Desktop 的 Bridge v1.1、12 条产品命令、occurrence v1.2 和 Desktop 组件清单摘要未变；Runtime schema 变为 `sha256:093dc2e1348cb55f747777316a342580af4acb1be9d0a81e71aee3ba51621b41`，Runtime 组件清单变为 `sha256:f7521f45834605dd8bff5a7af344973216fa1134508419a8b83caf11226bac51`，清单文件 SHA-256 为 `fdfa162e0ab01c4e692dbee967e449ed91aa22c0a80ca95588d5b47eae529c44`。

Core 新增 `owner_recall_case_sources_read`，只在 owner control 下从当前已登记的查询消息自选来源，回执仍为只读且 `question_case_verified=false`、`answer_verified=false`、`model_execute=false`、`external_send=false`。Desktop 的普通召回接线仍只请求原单来源只读证明，没有把新操作暴露为产品回答许可；复合回答保持 held。Core 本机 `npm run test:recall-facet-obligations` 通过，报告 `model_calls=0`、`product_answer_release=false`、`external_send=false`。

在全新、无教师资料的固定 Core worktree `~/edupi-install-checkpoints/core-main-008d-20261103` 安装锁定依赖；原真实 Core 根的未提交改动保持原样。Core 本机 Runtime schema 与组件清单检查通过；Desktop `EDUPI_CORE_ROOT=... node scripts/packaged-core-bundle.mjs` 核对并复制 13,337 个列入清单的文件，负向篡改和无 Git bundle 测试 3/3、Bridge 契约镜像 12/12。独立合成数据根的 Core 实进程健康与 12 条 Bridge 命令通过；Mac `desktop:prepare` 完成 Web、Node、Core 及 OpenConnector staging，隔离 headless staged server 冷启返回 Core ready／投影 ready／`externalSend=false`。`release:verify`、`tsc --noEmit` 通过；Desktop 完整 `npm test` 为 3561 通过／48 条件跳过／0 失败，`npm run lint` 为 0 错误／1 条既有警告（未改的 `scripts/test-edupi-core-history-e2.mjs`）。以上仍是源码及 staged 运行证据，不等于 `.104` 签名安装版；Windows/Linux 未构建。

`.104` 源码配对完成后，还需本分支提交、相应验证与合并，再从精确合并源码触发唯一 Mac-only Draft；必须重新验签、唯一 App 隔离安装、HTML/SVG 原生显示与资料保持。正式 feed／Latest 仍 `.70`，现唯一安装 `.99` 且已退出。
