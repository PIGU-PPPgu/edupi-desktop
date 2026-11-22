# EduPi 现有 Supabase 部署

Desktop 默认继续运行本机 Core。可选 cloud 模式复用当前 Supabase、Auth、broker 与数据库，连接配置见 [Desktop/iOS 同步规则](../../docs/architecture/edupi-mobile-api-sync.md)。

公网入口为 `https://edupi.intelliclass.online`，服务器为 `43.134.4.108`，项目目录为 `/srv/edupi-supabase`。`edupi-supabase.service` 管理精简 Supabase 栈；`edupi-supabase-caddy.service` 管理 HTTPS/CORS，API 仅在服务器本机 `55321` 监听。

这里的两个 systemd 文件和 `Caddyfile.edupi-supabase` 保存该部署的可审阅模板。实际私有环境文件只在服务器，沿用现有配置；service role 不进入 Desktop、iOS、示例、日志或 Git。

本轮部署流程：

1. 核对已有 migration history 和历史文件 hash，确认目标数据库。
2. 在私有备份目录保留现有 `edupi`/Storage schema 和 Edge Function 代码。
3. 复制两条新安全 migration 与材料函数/helper，运行当前 Supabase CLI 的 `migration up --local`；不 reset 数据库。
4. 重启 Edge Runtime 容器使函数更新生效。
5. 在临时 workspace 执行 broker、Desktop client、Storage 权限与双连接租约回归；最终清理测试账号、工作区和对象。
6. 核对部署代码字节与分支一致，并记录备份位置和清理条件。

2026-11-22 已按此流程部署 `20261122071008` 和 `20261122081223`，真实回归通过。回退备份在 `/srv/edupi-supabase/backups/cloud-sync-20261122/`，权限 0700；后续稳定部署替代并确认无需回退后再清理。详情见 [R24.4c 验收](../../docs/acceptance/2026-11-22-mobile-api-sync/README.zh-CN.md)。

`scripts/test-edupi-supabase-remote.sh` 从现有服务器读取私有配置，使用隔离数据检验 broker。`scripts/test-edupi-desktop-cloud-sync.mjs` 在本机用安全注入的 public key 检验实际 Desktop 同步客户端。两者不能替代签名安装或实体手机 App 验收。
