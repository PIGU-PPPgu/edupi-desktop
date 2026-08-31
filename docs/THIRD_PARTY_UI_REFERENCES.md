# Third-party UI references

## ThreeUI WarpFieldBackground

The first-launch welcome background uses ThreeUI's authored `WarpFieldBackground` **Letter Storm** variant from the complete registered source bundle at https://threeui.com/source-code/warp-field.json.

- Registered source revision: `SHA-256 bd7c486164d8`
- Verification package: `@designcodeio/threeui@1.1.0`
- Runtime used by the component: `three128` (`three@0.128.0`)
- License: MIT
- Copyright: 2026 Meng To

The three registered files are vendored byte-for-byte at `src/shaders/`; their hashes and the verification package integrity are preserved in `src-tauri/resources/third-party/threeui/SOURCE.md`, and the exact MIT license ships beside it. EduPi does not recreate or modify the renderer and uses the registered `letters` props directly.

## NomiFun ContentSider

`components/EduPiContentSider.tsx` and `hooks/useEduPiContentSiderCollapse.ts` are adapted from NomiFun's `ContentSider` and collapse-state hook.

- Source: https://github.com/nomifun/nomifun-desktop
- Reviewed revision: `2d31bcb7dcbde1da50259cab90fe4efac11faa56`
- Copyright: 2025-2026 NomiFun (nomifun.com)
- License: Apache License 2.0
- Changes: converted the Arco/Tailwind presentation into EduPi CSS classes, reduced the API to the header/body/footer regions used by the teacher workbench, and routed the collapse preference through EduPi's centralized app-pref registry.

This is a presentational component adaptation, not a NomiFun platform port. `ContentSider` has no backend API contract. EduPi data, sessions, files, Agent execution, and review writes continue to use the existing EduPi / Pi runtime endpoints in this repository.

The source file keeps the upstream copyright and SPDX identifier. NomiFun's repository `NOTICE` identifies the project as:

> NomiFun
> Copyright 2025-2026 NomiFun (nomifun.com)

The Tauri bundle includes the reviewed upstream `LICENSE`, complete `NOTICE`, and `SOURCE.md` under `src-tauri/resources/third-party/nomifun/`; attribution therefore ships with packaged builds instead of living only in developer documentation.

### NomiFun Computer Use boundary

The Computer Use and accessibility engines were reviewed and copied separately from NomiFun revision `0824f455af046a9d03fb4bf768f8918a01fef665`. That revision contains the Apache-2.0 backend in `crates/agent/nomi-computer/` and `crates/agent/nomi-a11y/`, plus discrete MCP commands under `crates/backend/nomifun-app/src/commands/computer_stdio.rs`. EduPi vendors the two core crates under `src-tauri/vendor/nomifun/` and exposes the same action surface through `edupi_computer_use`. The EduPi host adds an opt-in switch, macOS permission status and prompts, a serialization lock, per-call teacher approval, an emergency stop, one-action snapshot invalidation, strict native argument validation, and a redacted local JSONL audit log. `edupi_app_control` remains the separate, lower-risk tool for EduPi's own semantic React/Tauri surfaces.

## TabTin

TabTin was reviewed for task-state, workbench-resource, Agent-status, and approval interaction patterns.

- Source: https://github.com/tabtin-ai/TabTin
- Reviewed revision: `e454163e80b602e6a056aab691fd6056fcd7bb6f`
- License: AGPL-3.0-only

No TabTin source code was copied into EduPi. The EduPi implementation uses independently authored React and CSS against EduPi's existing data contracts and safe-store API. Attribution alone would not satisfy AGPL-3.0-only: a future direct port must either comply with the corresponding-source/network-interaction obligations for the combined work or use a separate commercial license from the TabTin maintainers.

## Harnss

Harnss was reviewed for its persistent workspace composition: a project/session browser, a central work surface, optional task/agent panels, mounted tool panes, and explicit permission state.

- Source: https://github.com/OpenSource03/harnss
- License: MIT

No Harnss source code or ACP runtime was copied into EduPi. The daily command surface, optional object browser, task inspector, and Agent drawer in EduPi are independently authored against the existing Pi AgentSession and EduPi safe-store APIs. Harnss is also documented by its maintainers as early-stage and pending a rewrite, so it is a layout and interaction reference rather than a platform dependency.

None of these reference applications is represented as fully migrated. A future full-platform migration would require its server APIs, data model, authentication, persistence, and runtime lifecycle to be moved and verified together.
