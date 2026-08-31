# EduPi Desktop fork

This repository is a working fork of the MIT-licensed `abcwyc/pi-agent-desktop` / `agegr/pi-web` desktop shell.

- EduPi source: [PIGU-PPPgu/edupi-desktop](https://github.com/PIGU-PPPgu/edupi-desktop)
- Signed desktop downloads: [PIGU-PPPgu/edupi-releases](https://github.com/PIGU-PPPgu/edupi-releases/releases)

## EduPi integration status

The fork now presents EduPi as the default teacher desktop workspace while preserving the existing Pi Agent runtime, sessions, files, branching, and Tauri shell. The teacher surface reads the real EduPi workspace and exposes:

```text
学生档案数量
课程/周行事历数量
校历节点数量
教师内部任务、证据、产物与审核状态
每个教学任务绑定的独立 Pi Session 与实时运行状态
```

Task review writes still go through EduPi's canonical safe store. Task↔Session bindings live separately in `.edupi/output/task_session_bindings.json`, so they survive restart without contaminating `rhythm_plan.json` or its rollback history.

The built-in `edupi_app_control` Agent tool opens allowlisted EduPi views, tasks, context, settings, and the task inspector. The separate `edupi_computer_use` tool ports NomiFun's native accessibility/screenshot/input/window backend for global desktop work. It is off by default, requires macOS permissions and a visible teacher confirmation for every read or mutation, invalidates its snapshot after one action, writes a redacted local audit trail, and always exposes an emergency stop. Neither tool can approve/reject teaching work, write education facts, or send externally.

## Run

```bash
npm ci
npm run dev
```

Set `EDUPI_PROJECT_ROOT` to the EduPi project directory before starting the server. The desktop dev launcher automatically uses `../edupi` when this fork and the EduPi repository share a parent directory. The status route then reads `.edupi/memory` and `.edupi/output` from that project root.

```bash
EDUPI_PROJECT_ROOT=/absolute/path/to/edupi npm run dev
```

The packaged Tauri server receives the same project-root environment explicitly. If it is missing or invalid, packaged startup fails instead of silently reading a different data directory.

## Scope

```text
teacher_internal
external_send=false
requires_teacher_review=true
```

Global computer control is available only through the opt-in, per-action-approved `edupi_computer_use` path above. It is not an unattended approval or external-sending capability.

## Upstream attribution

- Pi Agent Desktop (read-only desktop upstream): https://github.com/abcwyc/pi-agent-desktop
- Pi Web: https://github.com/agegr/pi-web
- Pi: https://github.com/earendil-works/pi

Scheduled desktop-upstream detection may only update a review PR in the EduPi source repository. The upstream repository is never used as an EduPi download, update, signing, or release destination. See [Desktop upstream synchronization](./docs/desktop-upstream-sync.md).

## License

The upstream MIT license is retained in `LICENSE`. NomiFun-derived components keep Apache-2.0 headers, and their reviewed `LICENSE`, complete `NOTICE`, source revision, and modification record ship under `src-tauri/resources/third-party/nomifun/`.
