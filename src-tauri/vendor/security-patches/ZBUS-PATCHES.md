# zbus 6 迁移

这些源码以 crates.io 正式归档为基线，保留原包名、版本、许可证和 VCS 元数据，
在真实调用处迁移到正式 `zbus 6.1.0` 与 `zbus_xml 6.0.0`。
没有用兼容包替换 `zvariant`、修改审计忽略项或删除 Linux 功能。
`Cargo.toml.orig` 保留发布时原文；构建使用修改后的 `Cargo.toml`。

## 来源

下载归档的 SHA-256 与 crates.io sparse index 对照后才展开。
各上游独立 `Cargo.lock`、下载缓存标记和 checksum 文件未加入 vendor 源码。

| 包 | 基线版本 | 官方归档 SHA-256 |
| --- | --- | --- |
| notify-rust | 4.17.0 | `50ff2e74231b72c832d82982193b417f230945be6bdb5575b251d941d31adb00` |
| tauri-plugin-single-instance | 2.4.3 | `b3214becf9ef5783c0ae99a3bb25adf5353a7a16ebf53e74b909e29205735c6c` |
| xcap | 0.9.8 | `da270fd7c8581d43d731cb690bcc791fc0a7b3bc96e131a4b6552d0379640a9e` |
| atspi-common | 0.14.0 | `f8a79bed3f5b408ce3152f36e07327a845e6ed5d7e2821a89264037dbcc11daf` |
| atspi-connection | 0.14.0 | `8fab8e4f574f5a7d3af280b38eff25fb6f47a537dac9ae39ce152f52b19fb10b` |
| atspi-proxies | 0.14.0 | `53403acd3ab2fdb5914f6558da22e540fc07656fce5510f8c02be0e6ef68413e` |
| zbus-lockstep | 0.5.2 | `6998de05217a084b7578728a9443d04ea4cd80f2a0839b8d78770b76ccd45863` |
| zbus-lockstep-macros | 0.5.2 | `10da05367f3a7b7553c8cdf8fa91aee6b64afebe32b51c95177957efc47ca3a0` |

## 修改

- `zvariant` 的类型、派生宏迁到 `zbus` 根路径，编码迁到 `zbus::wire`，名称迁到
  `zbus::names`。`Value` 与 `OwnedValue` 迁到 `Variant` 与 `OwnedVariant`。
  AT-SPI 的 `org.a11y.atspi.Value` 接口名和 `Interface::Value` 保持协议原名。
- 所有相关 builder 在 `build()` 接收转换错误；合并重复的错误转换。
  `Body::deserialize_ignore_signature` 替代已移除的方法名。
- 通知保留同步与异步接口。同步桥接启用 zbus 的进程级共享 Tokio 多线程运行时，
  通过作用域 OS 线程进入该运行时，允许从 Tokio task 调用同步 API。
  作用域线程只移动 D-Bus future 和 owned 响应，用户动作回调仍在原调用线程执行，
  保留非 `Send` 闭包与借用参数；不增加 `'static` 限制或持有生产全局锁。
  通知句柄的连接在方法返回后仍持续驱动；macOS 与 Windows 原生通知实现未改。
- Linux 单实例改用异步连接与 Tauri 的长期 Tokio 运行时。首次实例保留连接状态，
  重复实例转发参数，退出时释放名称。回调接口保留为实际生产接口并用于私有总线测试。
  回调保持 `FnMut`，测试连续两次 RPC 核对闭包内可变计数。
- xcap 的 Wayland 截图、ScreenCast 和 PipeWire 入口保留同步外观，
  内部异步调用交给共享 Tokio 多线程运行时。portal 方法发出前先完成响应订阅。
  响应先判断成功、取消或失败，再解码成功结果；SelectSources 实际等待其响应。
- AT-SPI 的 P2P 连接保留，peer listener 改由长期 Tokio 运行时执行。
  `StateSet` 和 `InterfaceSet` 自己的 Serde 与 `au` / `as` 签名保持，
  内部 enumflags2 表示不改。nomi Linux actor 使用持续运行的 worker，
  在命令通道等待时仍驱动总线和 peer listener。
- lockstep 的 XML 搜索、信号选择、签名提取和生成测试保留真实验证语义；
  XML interface 的成员改用新版迭代器，生成代码引用 `zbus::Type`。

## Cargo 接线

根清单需要这八项本地 patch；nomi-a11y 的 Linux 直接依赖也必须为 zbus 6。
根锁最终不能再包含 `zvariant`、`zvariant_derive` 或 `zbus_names`。

```toml
[patch.crates-io]
notify-rust = { path = "vendor/security-patches/notify-rust" }
tauri-plugin-single-instance = { path = "vendor/security-patches/tauri-plugin-single-instance" }
xcap = { path = "vendor/security-patches/xcap" }
atspi-common = { path = "vendor/security-patches/atspi-common" }
atspi-connection = { path = "vendor/security-patches/atspi-connection" }
atspi-proxies = { path = "vendor/security-patches/atspi-proxies" }
zbus-lockstep = { path = "vendor/security-patches/zbus-lockstep" }
zbus-lockstep-macros = { path = "vendor/security-patches/zbus-lockstep-macros" }
```

所有 zbus 依赖关闭 default features：notify-rust 选 `proxy`，`async` / `tokio`
功能映射到 `tokio-multithread`；single-instance 选 `proxy, service, tokio`；
xcap 选 `proxy, tokio-multithread`；AT-SPI 连接选 `proxy, service, tokio`，
代理选 `proxy, tokio`。atspi-common 始终依赖 wire 类型，原 `zbus` 功能只激活通信。
lockstep 的 host 依赖只使用 wire 类型，不开启运行时。
这些补丁的 Rust 最低版本为 1.89，根项目仍采用自己的更高最低版本。

## 验证入口

以下是已加入源码的测试入口，运行结果必须另外记录，源码存在不代表通过。
运行依赖包的单元测试时，应使用包含这些本地 patch 的测试工作空间，
以免单独运行 vendor 清单时重新解析到上游旧依赖。

| 包 | 过滤器 | 核对内容 |
| --- | --- | --- |
| atspi-common | `zbus6_wire_tests` | `au` / `as` 签名、跨字边界的 state flags、接口集合与 owned variant 编码回读 |
| atspi-common | 全部 lib 测试 | 现有 XML lockstep、ObjectRef、借用/owned 事件体与 Qt 事件回读 |
| notify-rust | `zbus6_notification_update_action_and_close` | 假通知服务收到 Notify、保留连接更新、动作信号、关闭 |
| notify-rust | `zbus6_notification_sync_api_inside_tokio_task` | 在 current-thread 和 multi-thread Tokio task 内调用真实同步 show/update/close，假服务核对六次 RPC |
| tauri-plugin-single-instance | `zbus6_single_instance_callback_and_name_release` | 抢名、第二连接回调、返回后的服务驱动、释放后重新抢名 |
| xcap | `zbus6_portal_success_cancel_and_failure` | 先订阅、私有总线响应、成功内容、空结果取消与失败码 |

三组 D-Bus 测试必须在新建私有会话中运行，CI 应给命令设置外层超时：

```sh
dbus-run-session -- env EDUPI_TEST_DBUS_ISOLATED=1 cargo test -p notify-rust --lib zbus6_
dbus-run-session -- env EDUPI_TEST_DBUS_ISOLATED=1 cargo test -p tauri-plugin-single-instance --lib zbus6_
dbus-run-session -- env EDUPI_TEST_DBUS_ISOLATED=1 cargo test -p xcap --lib zbus6_
```

假服务只发送测试请求，不打开截图对话框或访问教师数据。
生产根清单另需 Linux `cargo check --locked`，并重新运行完整锁的 Rust 安全审计。
真实桌面的通知点击、Wayland 授权界面、视频帧与 AT-SPI 外部应用交互仍需实机验收，
不能由假服务测试替代。

## 当前证据

2026-10-25：八个上游归档均已通过官方索引 SHA-256 校验，原有文件无额外缺失；
九份修改后 TOML 解析通过。39 个修改过的 vendor Rust 文件及 nomi 两个 Linux
源码已用本机现有 stable rustfmt 的 stdout 模式完成语法解析，失败 0；
项目 1.90 工具链未安装 rustfmt component，未因此安装工具链或组件。
本步骤未执行 Cargo 编译、D-Bus 测试或真实桌面验收。

独立审阅发现 Wayland 视频录制的 PipeWire `pod::Value` 被误改；已恢复
`pod::Value::Object`，同时恢复 Role 文档中的 `crate::Interface::Value` 链接。
随后对照八个官方归档逐项复核包含旧 `Value` / `OwnedValue` 的十二个修改文件，
非 zbus 限定引用的六项计数均与上游一致：PipeWire `pod::Value`、
三处 Serde `Self::Value`、两处 AT-SPI `Interface::Value`。
未发现 `pod::Variant`、`serde_json::Variant` 或 `TypeInfo::Variant` 残留；
两个修复文件的语法解析通过。该复核仍不替代 Linux 编译。

后续独立审阅指出 `FnMut` 契约与 Tokio task 中同步通知入口未覆盖；
已恢复可变回调，加入连续回调测试，并为通知同步入口加入作用域线程桥接及双运行时
私有总线测试。相关源码和 TOML 语法解析通过，新增测试尚待 Linux 编译与执行。

## 官方依据

- [zbus 6 迁移说明](https://z-galaxy.github.io/zbus/upgrading-to-6.html)
- [zbus 6.1.0 正式包](https://crates.io/crates/zbus/6.1.0)
- [zbus_xml 6.0.0 正式包](https://crates.io/crates/zbus_xml/6.0.0)

运行时生命周期与 SignalStream API 另已核对 zbus 6.1.0 官方归档源码，
XML 迭代器已核对 zbus_xml 6.0.0 官方归档源码。
