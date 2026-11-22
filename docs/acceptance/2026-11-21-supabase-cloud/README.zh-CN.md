# EduPi Supabase 云端验收

日期：2026-11-21

## 结果

WorkClaw `43.134.4.108` 已启动 EduPi 的精简 self-hosted Supabase 测试栈。远程目录为 `/srv/edupi-supabase`，服务由 `edupi-supabase.service` 管理，已启用开机恢复。

本轮云端 canonical writer 已实际验证事实、事实脊柱、任务、材料、班级对象、学生事件和 Core Runtime。测试账号、workspace、Storage 对象和测试数据在每轮结束时清理。

## 远程组件

- API、REST、Auth、Storage、Realtime 和 Edge Runtime 通过 Kong 使用 `55321`。
- PostgreSQL 使用 `55322`，只作为服务器内部和运维入口。
- Studio、Analytics、Mailpit、Vector、Postgres Meta、Pooler 和 imgproxy 按节点资源限制保持关闭。
- Supabase 迁移历史包含 `20261120142514`、`20261120163218`、`20261120183948`、`20261121120000` 和 `20261122041012` 五份迁移。
- 运行时密钥保存在服务器 `/srv/edupi-supabase/.supabase.env`，权限为 `600`，没有写入仓库、测试脚本或浏览器代码。

## 实际验收

执行命令为 `./scripts/test-edupi-supabase-remote.sh`，退出码为 `0`。

- Auth 注册、账号工作区创建和同 `request_id` 重放。
- Snapshot 生成、任务创建、任务重放和旧 snapshot 拒绝。
- 事实首次 capture、capture 重放、审核接受、删除、恢复、回读。
- 事实脊柱回读、替换和同 `request_id` 重放。
- 材料 intake、元数据更新、更新重放、历史回读、私有 Storage signed upload。
- 班级方案 preview、save、read。
- 学生事件列表和主题别名写入。
- Core Runtime register、lease acquire、renew、event、release、实例替换和旧 fencing generation 拒绝。
- 手机版 `mobile-dashboard` 返回版本化 contract identity，并实际回读学生、任务、校历和课表。
- Auth 用户直接向 `edupi.tasks` 写入返回 `403`，证明 canonical 表不能绕过 writer。
- 非法 `fact_kind` 返回 `400 invalid_fact_request`，私有材料匿名读取被拒绝。

## 本轮修复

- 移除了四个函数对 `jsr.io` 类型声明的运行时导入，解决远程 Edge Runtime 因 JSR `403` 导致的 `BOOT_ERROR`。
- workspace 创建的幂等重放返回 `200`，首次创建仍返回 `201`。
- canonical 读取改用带 workspace RLS 的 `authenticated` 客户端，service role 只用于 writer RPC 和私有 Storage。
- 为事实脊柱替换增加唯一 request receipt 和并发安全的幂等回执。
- 为事实 capture 增加本地允许的 `fact_kind` 边界校验和明确错误映射。

## 公网验收

- DNSPod 已新增 `edupi.intelliclass.online A 43.134.4.108`，没有修改 `intelliclass.online` 主站记录。
- WorkClaw 防火墙已开放 TCP `80,443`，SSH `22` 等既有规则保持。
- `edupi-supabase-caddy.service` 已启用并运行，Caddy 已成功申请并加载 TLS 证书，HTTP 自动跳转 HTTPS。
- 公网 Auth 登录返回 `200`，`pigou` 账号 workspace 列表返回 `200`，带 workspace header 的 snapshot 返回 `200` 且 `external_send=false`。
- 公网 `mobile-dashboard` 返回 `200`，契约为 `edupi-mobile-dashboard-v1@1.0`，学生 `52` 条、任务 `7` 条、校历 `28` 条、课表 `6` 条。
- CORS 预检返回 `204`，生产 Origin 为 `https://edupi.intelliclass.online`，上游 Kong 的通配符 CORS 头已由 Caddy 清理。

## 未覆盖边界

- 固定 Core commit `3ce22b1e08804aa36dccf59d76a8e61b15f2c462` 的 standalone 云端运行目录尚未放入服务器，因此本轮证明的是 Supabase canonical writer 和 Runtime 控制面，不把 EduPi Next/Web/Core 整体上线写成完成。
- 前端 TestFlight 已有版本仍需重新构建，才能使用新的 HTTPS 默认地址。源码默认地址已更新为 `https://edupi.intelliclass.online`。
