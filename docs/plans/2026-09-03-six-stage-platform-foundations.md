# EduPi six-stage platform checkpoint — 2026-09-03

## Delivered

| Stage | Core checkpoint | Desktop checkpoint | Runtime evidence |
| --- | --- | --- | --- |
| Proactive Work Kernel | [Core PR #18](https://github.com/PIGU-PPPgu/edupi/pull/18) | [Desktop PR #24](https://github.com/PIGU-PPPgu/edupi-desktop-internal/pull/24) | idempotent fire keys, leases, retry ceiling, delivery uncertainty hold, redacted logs, visible runs |
| Scoped Education Memory | [Core PR #19](https://github.com/PIGU-PPPgu/edupi/pull/19) | [Desktop PR #25](https://github.com/PIGU-PPPgu/edupi-desktop-internal/pull/25) | real teacher data: 2 semesters, 8 contexts, 31 bindings; prior term excludes current-term fact |
| Teaching Skill Lifecycle | [Core PR #20](https://github.com/PIGU-PPPgu/edupi/pull/20) | [Desktop PR #26](https://github.com/PIGU-PPPgu/edupi-desktop-internal/pull/26) | draft/trial/validated/published/retired projection; only route-verified published skills are reusable |
| Connectors | [Core PR #21](https://github.com/PIGU-PPPgu/edupi/pull/21) | [Desktop PR #26](https://github.com/PIGU-PPPgu/edupi-desktop-internal/pull/26) | Feishu/DingTalk/email/SIS/cloud-drive capability registry; normalized inbound facts; outbound remains pending review |
| Persistent Agent Computer | [Core PR #22](https://github.com/PIGU-PPPgu/edupi/pull/22) | [Desktop PR #26](https://github.com/PIGU-PPPgu/edupi-desktop-internal/pull/26) | restart-safe document/OCR/PPT/long-task queue, idempotency, lease recovery, bounded retries, artifact index |
| Hosted Core & Multi Harness | [Core PR #23](https://github.com/PIGU-PPPgu/edupi/pull/23) | [Desktop PR #26](https://github.com/PIGU-PPPgu/edupi-desktop-internal/pull/26) | tenant-isolated local/hosted Core modes and workload routing across Pi/custom Harness adapters |

## Pinned runtime

- Core commit: `542d9f5ecff463b40e955778fa8af42a78b4ac8d`
- component manifest: `sha256:ea64a99cfaea87a1b3929c91a8635ace165d5beec854531d87533a9ae0c34fed`
- Desktop merge: `7d4d3aaaf7fb24c297a2b901b37d27ca53e00877`

## Verification

- Core base suite: 73/73 plus storage, bridge, work-case and C1 capability checks.
- Evolution: 7/7 store checks plus engine, router and evaluator integration.
- New stage tests: proactive kernel, memory scopes, teaching skills, five connectors, persistent jobs and tenant/Harness routing all passed.
- Desktop full suite: 865 passed, 16 skipped, 0 failed before the final platform-only admin surface; final focused tests, TypeScript, lint and branding passed.
- Browser: automatic runs, semester memory isolation, teaching skills, five connectors, background jobs and school platform rendered with no console warning/error.
- Packaged app cold start: Core, education projection and Kernel all `ready`; all four platform projections returned.

## Distribution boundary

- Local preview: `EduPi_0.3.1_aarch64-local.dmg` is fully ad-hoc bundle signed for local installation.
- The automatic-updater archive and public release still require `TAURI_SIGNING_PRIVATE_KEY`. A public key alone cannot produce a trustworthy signed update.
- Feishu retains its existing real adapter. DingTalk, email, SIS and cloud-drive are ready for vendor/account adapters but are not connected until administrators provide each account configuration and credentials.
- Hosted Core routing is implemented and locally verified; production hosting, tenant DNS/TLS, backups and school identity-provider integration require the target deployment environment.
