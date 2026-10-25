# GTK 依赖补丁

这些源码副本保留原包名、版本、许可证和 `.cargo_vcs_info.json`，由根 Cargo manifest 的 `[patch.crates-io]` 接入。修补范围是 GTK 0.19 / GLib 0.22 兼容迁移，供根依赖图移除旧 GLib 和 proc-macro-error；没有删减 Linux、GTK、WebKit、D-Bus portal、X11 或 Wayland 功能。

## 来源

每个归档均来自 crates.io 官方静态下载地址，SHA-256 与对应官方稀疏索引记录核对。归档内的独立 Cargo.lock、缓存标记未导入；其余上游文件保留。下表的 commit 仅转录上游 VCS 元数据，Tao 和 Wry 原归档的 VCS 元数据含 `dirty: true`，因此以归档 SHA-256 为源码来源标识。

| 包 | 版本 | 许可证 | 原归档 SHA-256 | 上游 VCS commit |
| --- | --- | --- | --- | --- |
| [tauri](https://static.crates.io/crates/tauri/tauri-2.12.5.crate) | 2.12.5 | Apache-2.0 OR MIT | `5fb0244332cfb9cee7e2a568bf5da29a36ed8fdbd717f6f47a66b6b7b358c072` | `993038c49185307dfc895ab7657d77ca0d5ed7c7` |
| [tauri-runtime](https://static.crates.io/crates/tauri-runtime/tauri-runtime-2.12.2.crate) | 2.12.2 | Apache-2.0 OR MIT | `7c55766d99cea69055904d1735b93c2049302b2e09effd462120deb5581d78e9` | `59b63ab500da9859f12d8888c3298bc29bba0b92` |
| [tauri-runtime-wry](https://static.crates.io/crates/tauri-runtime-wry/tauri-runtime-wry-2.12.3.crate) | 2.12.3 | Apache-2.0 OR MIT | `e1aa9d8b7a120f879f44fdc1053f7b7dbf416bf0bbc6a72b714dec46b782b52f` | `993038c49185307dfc895ab7657d77ca0d5ed7c7` |
| [tao](https://static.crates.io/crates/tao/tao-0.37.2.crate) | 0.37.2 | Apache-2.0 | `d5777b06fe6435126ae8d816eba269e050e1e10d302cf5461e9c49eccabc3548` | `2d9b2ba15247879787878ae565e350bcc1b9f622` |
| [wry](https://static.crates.io/crates/wry/wry-0.57.1.crate) | 0.57.1 | Apache-2.0 OR MIT | `759c50ddad0ef9913bb5496cb9d509a50433a3b78cb0238d61105526589cf0e9` | `2446feadae623d6f2ac8d2136e3ccef3d7197e0e` |
| [muda](https://static.crates.io/crates/muda/muda-0.20.0.crate) | 0.20.0 | Apache-2.0 OR MIT | `cca139e57da4383727f189e43e66e84fa372347027fc996f9f1a007ec0a37996` | `87a3560b386243b50812cf0fa2836f3d07062a57` |
| [webkit2gtk](https://static.crates.io/crates/webkit2gtk/webkit2gtk-2.0.2.crate) | 2.0.2 | MIT | `a1027150013530fb2eaf806408df88461ae4815a45c541c8975e61d6f2fc4793` | `8de4e245df5c08562a28348e77bcf51cb01e67ea` |
| [webkit2gtk-sys](https://static.crates.io/crates/webkit2gtk-sys/webkit2gtk-sys-2.0.2.crate) | 2.0.2 | MIT | `916a5f65c2ef0dfe12fff695960a2ec3d4565359fdbb2e9943c974e06c734ea5` | `8de4e245df5c08562a28348e77bcf51cb01e67ea` |
| [libappindicator](https://static.crates.io/crates/libappindicator/libappindicator-0.9.0.crate) | 0.9.0 | Apache-2.0 OR MIT | `03589b9607c868cc7ae54c0b2a22c8dc03dd41692d48f2d7df73615c6a95dc0a` | `eafd1e3682a1247f595410266091e9684021cb6f` |
| [libappindicator-sys](https://static.crates.io/crates/libappindicator-sys/libappindicator-sys-0.9.0.crate) | 0.9.0 | Apache-2.0 OR MIT | `6e9ec52138abedcc58dc17a7c6c0c00a2bdb4f3427c7f63fa97fd0d859155caf` | `eafd1e3682a1247f595410266091e9684021cb6f` |
| [rfd](https://static.crates.io/crates/rfd/rfd-0.16.0.crate) | 0.16.0 | MIT | `a15ad77d9e70a92437d8f74c35d99b4e4691128df018833e99f90bcd36152672` | `5d32eec3a7930eb43b7e864eb773831bbd3d91b4` |

## 本地改动

- 这 11 个包的 Cargo.toml 与 Cargo.toml.orig 同步迁移：GTK/GDK 及其 sys 绑定 0.18 → 0.19，GLib/Gio/Cairo 及其 sys 绑定 0.18 → 0.22，JavaScriptCore 1.1 → 2.0.0，Soup 0.5 → 0.9；其他依赖版本与所有 features、optional 和 target 条件保留。
- Tauri、Tauri Runtime、Tauri Runtime Wry、Tao、Wry 与 WebKit 手写代码更新已移至 `glib::object` 和 `glib::types` 的 trait 路径；Wry 的 `clone!` 更新为弱引用属性语法，保留引用升级失败时的返回行为。
- rfd 0.16.0 的 Linux/BSD GTK3 可选分支将 gtk-sys 迁移至 0.19、glib-sys 与 gobject-sys 迁移至 0.22，保留 gtk3、xdg-portal、Wayland 等 features 与其他平台实现；原生 FFI 调用源码保留；其调用的 57 个 GTK/GLib/GObject 类型、常量和函数声明与新版官方绑定逐项相同，仍待实际 Linux 编译验证。
- Tao 仅在原 Linux/BSD GTK 目标边界内新增 `async-channel = "2.5"`。`src/platform_impl/linux/main_context_channel.rs` 是私有兼容层，维持无界同步发送、FIFO、主上下文线程分发和原优先级；回调返回 Break 或全部 sender 关闭后接收任务结束。窗口请求、X11 设备事件和 portal 主题变化改用此通道。
- Tao 通道的 5 项无 UI 测试覆盖跨线程发送与 FIFO、回调线程、Break 后停止与失败值返回、接收端关闭、发送端全部关闭后的回调释放以及优先级。

## 官方迁移依据

- [GLib 通道移除与异步通道替代](https://gtk-rs.org/blog/2024/06/01/new-release.html#removal-of-glib-channels)。
- [GLib 0.22 MainContext::spawn_local_with_priority](https://docs.rs/glib/0.22.0/glib/struct.MainContext.html#method.spawn_local_with_priority)：保留指定优先级，在上下文拥有线程上运行本地 future。
- [GLib 0.22 JoinHandle](https://docs.rs/glib/0.22.0/glib/struct.JoinHandle.html)：丢弃 handle 仅分离任务，不取消已附加的接收任务。
- [GLib clone! 弱引用和 rename_to](https://docs.rs/glib/0.22.0/glib/macro.clone.html)。
- [GTK 0.19 manifest](https://docs.rs/crate/gtk/0.19.0/source/Cargo.toml)：该上游发布与 GLib 0.22 对齐，Linux 依赖组要求 Rust 1.92。

## 验证入口

根测试 workspace 的 Tao 图标示例只用 PNG 和 ICO，开发用 image 明确启用这两种格式，不带入未使用 AVIF 编码链；应用运行时的图像功能不变。

已在原归档上逐项核对 22 份 manifest；只有迁移依赖版本与 Tao 的新增 async-channel 项不同。新通道模块完成 rustfmt 解析。该项完整编译、运行和安全验收以项目原任务账本与实际 CI 证据为准；本记录不把提供测试源码视作测试通过。

Ubuntu 安装原项目所需 GTK/WebKit 开发库后可运行：

```sh
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml -p tao --lib main_context_channel::tests
```

本补丁未执行 Windows 构建、打包、客户端安装或文件清理。
