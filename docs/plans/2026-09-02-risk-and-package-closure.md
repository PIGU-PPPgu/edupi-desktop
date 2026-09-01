# 2026-09-02 风险与安装包闭环

## 删除风险

- Core PR #12：稳定 ID 软删除与已接入材料删除。
- Core PR #13：修复材料删除后快照身份仍包含已删除 target 的问题。
- Desktop PR #16：材料详情接入统一删除动作，固定 Core `dae43405f5057e3b7032def28267d258c9066a8e` 和 component manifest `sha256:c0f93e01afa86e1d4968ddf7dc531d629db1f15f819d50a9db2f490a42051dc7`。
- 配对 E2 删除 calendar、timetable、memory、student、task、material 六类对象；丢失响应重试成功；六份来源文件字节保持不变。

关键证据：

```text
Core npm test                                      passed (71 base checks + store/bridge checks)
Core npm run typecheck                             passed
Core node scripts/test_desktop_bridge_port.mjs     passed, including delete material → next snapshot
Desktop test-edupi-entity-delete-e2.mjs            passed: deleted=6, retry_reconciled=true
Desktop focused tests                              9 passed, 4 intentionally skipped
Desktop npm test                                  816 passed, 13 skipped, 0 failed
Desktop tsc --noEmit                               passed
Desktop lint                                      passed
Desktop npm audit --audit-level=high               passed; 2 moderate advisories remain
```

## macOS 预览包

从 Desktop merge `713eadd97cc72dd2bcc6031830bc439836345098` 的隔离工作树执行与 GitHub preview workflow 相同的准备和打包命令。

```text
npm ci                                              passed (2 existing moderate npm advisories)
npm run desktop:prepare                             passed; 37 redundant nested packages removed
tauri build --target aarch64-apple-darwin --bundles dmg
                                                    passed
codesign --verify --deep --strict                   passed
```

产物：`EduPi_0.3.0_aarch64.dmg`  
大小：67 MB  
SHA-256：`da7f7850bf56d8573c53f243d99e7c967efccd6f5534c5702c79653092613c86`

DMG 经只读挂载后使用 LaunchServices 启动：

```text
本地服务就绪                         2.041 s
GET /                                200 / 0.008877 s
GET /api/edupi/workspace             200 / 0.165455 s
退出 EduPi 后 bundled Next server    已同步退出
```

这是 ad-hoc 签名的内部预览包；未 notarize，不是正式 updater 基线。

## Windows 与发布链路

macOS 不能生成或启动可信的 Windows NSIS 结果，因此不声称 Windows 二进制已实机验证。当前已完成：

- `x86_64-pc-windows-msvc` / NSIS matrix、内置 Windows Node、artifact 路径验证；
- Windows 260 字符路径约束在真实 server staging 上通过；
- preview/release/updater destination 与平台脚本 24 项测试通过；
- Rust 桌面单测 8/8；
- release component pins 验证通过。

正式发布前仍必须由 `windows-latest` 生成 EXE，并在干净 Windows 用户环境完成安装、首启、更新提示和卸载验证。

## 下一入口

进入 [Living Teacher Agent 总计划](./2026-09-02-edupi-living-teacher-agent-master-plan.md) 的 E1：Core Flow Contract v1。
