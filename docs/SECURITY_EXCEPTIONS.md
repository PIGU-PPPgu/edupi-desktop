# 安全例外

## RUSTSEC-2024-0429 / GHSA-wrw7-89jp-8q8g

- 依赖：`glib 0.18.5`
- 状态：受影响代码不可达
- 复审日期：2026-11-30，或 Tauri / Wry 的 Linux GTK 栈升级时，以较早者为准

该依赖只存在于 Tauri 的 Linux GTK3 图形栈。macOS 与 Windows 目标不编译 `glib`。官方公告列出的受影响函数只有 `glib::VariantStrIter::{next, next_back, nth, nth_back, last}`，入口为 `Variant::array_iter_str`。EduPi 自有 Rust、移植的 NomiFun Computer Use，以及当前 Tauri / Wry / GTK 依赖源码均未调用 `VariantStrIter` 或 `array_iter_str`。

官方修复从 `glib 0.20.0` 开始，但当前 GTK3 bindings 约束 `glib ^0.18`，无法单独升级。Dependabot 在默认分支尝试解析该告警后没有生成兼容修复 PR。强行替换为 0.20 会破坏 Tauri 的 Linux 依赖契约，风险高于这个不可达的 informational soundness advisory。

处置：GitHub Dependabot 告警以 `not_used` 关闭；不在 RustSec 配置中静默忽略，日常 RustSec 与 Dependabot 检查继续保留。升级 Tauri / Wry / GTK 后必须删除本例外，并确认锁文件不再包含受影响版本。

## Tauri 上游维护警告

- 状态：信息性维护债务，无已知漏洞
- 复审日期：2026-11-30，或 Tauri / Wry 依赖升级时，以较早者为准

RustSec 还会列出 16 个 `unmaintained` 警告。它们分为两条完全由 Tauri 引入的链：Linux GTK3 的 `atk` / `gdk` / `gtk` 及其 `-sys`、macros 和 `proc-macro-error`；以及 `tauri-utils → urlpattern` 使用的 `unic-*` 辅助库。EduPi 和 NomiFun 没有直接声明这些包。

这些项目是维护状态提醒，不是漏洞公告，没有可用的同契约替换版本。Linux GTK3 组会随 Tauri / Wry 迁移 GTK4 消失；Unicode 组需要 Tauri 更新 `urlpattern`。CI 不隐藏这些警告，`cargo audit` 的原始输出继续可见，并在发现实际 vulnerability 时失败。
