# 2026-09-02 QM / upstream Desktop comparison

## Sources inspected

- [yc-software/qm](https://github.com/yc-software/qm) main branch and its Pi harness, harness router, admin plugin, web UI plugin, deployment guide, and package manifest.
- [abcwyc/pi-agent-desktop v0.4.2](https://github.com/abcwyc/pi-agent-desktop/releases/tag/v0.4.2) and tag `b3dd920ea9fc20a369b968de975c9dc32f56267e`.
- EduPi Desktop current branch plus its fork-ownership sentinels and packaged Core contract.

## Product boundary

QM and EduPi Desktop solve different layers.

- QM is an organization-level, cloud-deployed multi-user agent core. It uses Postgres, per-scope sandboxes, identity/policy/audit, Slack and web plugins, and a harness router for Pi, Codex, Claude Code and OpenCode. Its Pi integration is a server-side adapter over a security-patched Pi 0.82 package.
- EduPi Desktop is a local-first teacher application. Tauri packages the UI and reviewed Core bridge; the canonical dataset stays on the teacher's computer. Its first-class objects are lessons, calendar nodes, teacher tasks, students, materials, educational memory, observations and teacher review.

QM is therefore not a drop-in replacement for the Desktop. Replacing the current app with QM would also introduce Postgres, cloud identity, deployment infrastructure and remote sandboxes, while deleting the local-first teacher workflow that differentiates EduPi.

## What to reuse from QM

Use QM as the reference for a future school/organization collaboration layer:

1. Harness interface and approved runtime router: keep Pi/Codex/Claude/OpenCode behind one bounded interface.
2. Scope-owned memory, files, credentials, permissions and crons: map scopes to teacher, class, grade group and school.
3. Core-authorized admin surface: keep governance and audit in the Core rather than trusting browser state.
4. Plugin surfaces: Desktop, web, school admin and future Feishu/Slack-style collaboration should be optional clients over one Core contract.
5. Background work, webhooks and connectors: adopt after the current local teaching loop is stable.

Do not copy QM's generic web UI or organization deployment stack into the teacher Desktop. If code is reused, preserve its MIT attribution and isolate it behind an EduPi-owned interface.

## What to sync from pi-agent-desktop v0.4.2

The upstream tag is not an ancestor of the current EduPi branch; 15 upstream commits exist after the shared merge base. A wholesale merge is unsafe because EduPi intentionally rewrote high-risk `AppShell`, `SessionSidebar`, task and education surfaces.

Adopt in a reviewed upstream catch-up PR:

- WebView cache cleanup after upgrades, preventing stale hashed assets and post-update 404 pages.
- Actionable EACCES/EPERM/macOS TCC directory errors at selection time.
- Scroll containment for large model/thinking/tool menus.
- Linux image-paste clipboard fallback.
- Pi 0.84.4 evaluation against the current 0.84.1 pin.

Evaluate separately, not in the launch repair:

- BrowserPanel, DiffPanel, ContextUsageRing and SessionStatsPanel.
- Custom CSS and new worktree/session-reference surfaces.

The existing EduPi onboarding, navigation, admin center and education modules remain fork-owned and must not be replaced by the upstream generic coding UI.

## Recommended sequence

1. Finish and merge Packaged Core Bootstrap 0.3.1.
2. Open a narrow upstream v0.4.2 catch-up PR for cache cleanup, permission errors, menu overflow and Linux clipboard.
3. Build a small QM architecture spike: `EduPi Core <-> HarnessAdapter <-> Pi/Codex`, plus scope mapping for teacher/class/school. No production migration yet.
4. Only after the local teacher loop has real usage evidence, decide whether QM becomes the hosted school collaboration substrate.

