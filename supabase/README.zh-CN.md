# EduPi Supabase 云端 Writer

这个目录对应 EduPi 的独立 Supabase 项目。手机和浏览器通过 Edge Function 写入云端 canonical store，本地 Desktop 继续可以使用固定 Core 和本机数据根。

## 当前内容

- `migrations/20261120142514_edupi_contract_foundation.sql` 对齐 workspace、学生事件、班级对象、任务会话绑定、契约版本和审核回执。
- `migrations/20261120163218_edupi_cloud_canonical_writer.sql` 增加任务、材料、事实、事实脊柱、artifact、work case、snapshot、command receipt 和 Core Runtime lease。
- `migrations/20261120183948_edupi_fact_spine_idempotency.sql` 为事实脊柱替换增加唯一 request receipt，确保重放和并发请求返回同一回执。
- `migrations/20261121120000_edupi_mobile_snapshot.sql` 增加手机版首页读取投影，包含学生、任务、校历和课表。
- `migrations/20261122041012_edupi_mobile_contract_registry.sql` 登记手机版 contract identity，避免桌面端字段变化后手机静默错读。
- `functions/edupi-student-events` 对齐本地学生事件查询、编辑、删除和主题别名接口，直接表写权限已收回。
- `functions/edupi-classroom` 对齐班级名单、方案列表、读取、预览、保存、恢复和发布。
- `functions/edupi-core-broker` 接受 bridge command、`education-facts`（含首次 capture、审核、删除、恢复和事实脊柱）、`material-metadata`、`workspace-resources`、`classroom` 和 snapshot 请求。
- `functions/edupi-core-runtime` 处理 Runtime register、heartbeat、lease 和 event。
- `functions/edupi-account` 提供 workspace 创建和成员撤销入口。
- `functions/edupi-materials` 提供私有 Storage signed upload URL。
- `functions/edupi-core-broker` 的 `mobile-dashboard` 提供手机版首页读取投影，contract identity 见 `contracts/edupi-mobile-dashboard-v1.json`。
- `functions/_shared/http.ts` 统一处理 Supabase Auth、workspace membership、请求大小和错误响应。

## 本地验证

完整 Supabase 栈需要额外下载官方镜像。项目端口已配置为 `55321` 起，避免混用其他项目。

```bash
supabase start
supabase db reset
supabase functions serve --no-verify-jwt
```

本机 Supabase Edge Runtime 1.70 与当前 CLI 生成的本地 JWT verify hook 存在 ES256 兼容问题，所以本地服务使用 `--no-verify-jwt`。每个函数仍在代码里执行 Supabase Auth Bearer 校验，部署到托管环境时保留 `verify_jwt = true`。

本机当前使用 `supabase start --exclude imgproxy`，主数据库、Auth、Storage API、PostgREST、Realtime、Edge Runtime、Studio 和 Analytics 均已启动。`imgproxy` 只影响图片转换，不影响 EduPi 材料上传和 canonical writer。

Edge Function 静态检查：

```bash
deno check --config supabase/functions/edupi-core-broker/deno.json \
  supabase/functions/edupi-core-broker/index.ts
deno check --config supabase/functions/edupi-core-runtime/deno.json \
  supabase/functions/edupi-core-runtime/index.ts
deno check --config supabase/functions/edupi-account/deno.json \
  supabase/functions/edupi-account/index.ts
deno check --config supabase/functions/edupi-materials/deno.json \
  supabase/functions/edupi-materials/index.ts
deno check --config supabase/functions/edupi-student-events/deno.json \
  supabase/functions/edupi-student-events/index.ts
deno check --config supabase/functions/edupi-classroom/deno.json \
  supabase/functions/edupi-classroom/index.ts
```

本轮已经使用独立的 PostgreSQL 17 临时容器执行两份迁移，并验证任务创建与 replay、stale snapshot、事实接受/删除/恢复、材料版本 replay、Runtime lease/fencing、workspace RLS 和认证用户直接写表被拒绝。

2026-11-21 已在 WorkClaw `43.134.4.108` 的精简 self-hosted Supabase 栈执行三份迁移并完成远程 E2。服务由 `edupi-supabase.service` 管理，运行环境文件为服务器私有的 `/srv/edupi-supabase/.supabase.env`。远程验收脚本和边界说明见 `scripts/test-edupi-supabase-remote.sh` 与 `docs/acceptance/2026-11-21-supabase-cloud/README.zh-CN.md`。

正式调用需要：

- `Authorization: Bearer <Supabase Auth access token>`
- `x-edupi-workspace-id: <workspace UUID>`
- `edupi-core-broker` 使用服务端 `SUPABASE_SERVICE_ROLE_KEY` 调用 writer RPC。这个 key 只存在 Edge Function 服务端。

`edupi-materials` 是私有 Storage bucket。对象 key 的第一段必须是 workspace UUID，数据库只保存 bucket、object key、字节大小和哈希，不保存本地绝对路径。

## 仍需单独接入

完整 `EducationContract` 组合投影、Pi session、移动端云设备会话和账号扫码绑定仍需单独接入。云端 canonical writer 和本地 Core 可以并行存在，前端接入移动端时优先调用 Edge Function，不直接访问 service role 或 canonical 表。
