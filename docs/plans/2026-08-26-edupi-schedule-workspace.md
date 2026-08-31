# EduPi schedule workspace checkpoint — 2026-08-26

This slice keeps Core as the only education truth store. Core v1.1 exposes the validated `education_workspace` projection through the fixed local bridge; Desktop presents the schedule in Chat-first day/week/month views and routes uploads into Chat. The bridge capability is read-only for this slice: `supported_commands=[]`, `supported_projections=[education_workspace]`, and `external_send=false`.

## Pinned implementation

- Core PR #2: `195a3a8`, `3851d18` (education workspace and reviewable schedule candidate upsert).
- Core functional runtime checkpoint: `00e606d38b476c6ff328a585841a5e8feab7b664` (with test inputs `200`, `201`, and `500`, top-level compatibility `tasks` are each truncated/held at `200`, while `education_workspace.tasks` retain the complete `200`, `201`, and `500` inputs respectively, with an upper bound of `500`). This is a functional runtime checkpoint, not the final docs-only Core commit pin. The final strict Core commit pin is `7bafc91c7d5440d27e89c0639f3221af805b36ea`.
- Desktop PR #11: `6b13d01`, `1a0f72b`, `a6f4d2c`, `dc30d05`, `e27ca09`, `bf05ff7`, `68bee39`.
- Desktop risk checkpoint: `ee2a392` fixes `.edupi`, `memory`, and `output` symlink escapes; Core missing/invalid `date_status` is handled safely, with held invalid dates excluded from the calendar grid.
- v1.1 schema hash: `sha256:ae478e2025b41372b0b3ccd44663b3ebd451b50b1a8c7bca4f306e07c3e1da3a`; component manifest hash: `sha256:4e323e429bee7dac663e78b06c54757f2cef7fa42dee95737c188730d7981e94`; fixture manifest hash: `sha256:0df51003ef10035e92024c549273c67850e869abb563673301de72d06dd54b1a`.

## Behavior and risk boundary

- Core fixed port/data-root evidence contains 5 students, 28 calendar entries, 30 tasks, 34 memories, and 34 insights; Desktop APIs project the same data.
- Schedule UI supports real day/week/month clicks and 第0/1周 anchors; Chat remains the natural-language entrance, and the upload button routes to a Chat prompt.
- Chat image/file facts reach the Agent; Core `calendar_import` defaults them to inferred/pending, assigns deterministic IDs, and performs idempotent upsert/confirmation without downgrade. Desktop refreshes after `calendar_import` or `timetable_import` tool completion.
- Education/onboarding reads use only the validated Core snapshot. Their writes return 503. Generic file and native-save paths cannot write managed `.edupi` data.

## Evidence status

Core `npm test` -> 63/63; storage, rhythm, calendar-candidate, and typecheck checks pass; Rust checks -> 8/8 and `fmt` pass. Desktop `npm test` -> 516 tests / 503 pass / 13 skipped / 0 fail; `tsc`, lint, and diff checks pass. Browser verification found no error or warning and preserved day/week/month clicks, 第0/1周 anchors, Chat-first navigation, and upload-to-Chat routing. A real image E2 was attempted through `/api/agent/new`: session `01a03a9b-8156-7b9d-a28d-6f45ba3ff0e7` received the teaching-calendar JPEG, but `edupi-test/gpt-5.6-terra` returned four pre-tool 503 Service temporarily unavailable errors; the calendar remained at 28 entries. Provider-backed E2 is `failed/unavailable`, with no pending appearance or restart proof. This is `evidence_pending`, not a passed product checkpoint; direct calendar-side teacher confirmation UI, timetable image candidates, and the onboarding/context write command remain unproven. `teacher_decision=not_run`; `external_send=false`.

Next entry: retry real image E2 when the provider is healthy, then verify tool completion refresh/pending/restart. The shared ledger entry is `C3.1` in Core `docs/loop/DUAL_SPIRAL_CHECKPOINTS.md`.

## C3.1 follow-up — fix-first closure (2026-08-26)

Fresh Sol v2 returned fix-first for launch roots, task bindings in Core output, and the missing-source import default. Core fix: `bc3b16eeadb0e11816e8dc2f8360a3972490ed42`; Desktop fixes: `c08fd2b` task bindings, `423dcdb` root propagation, `1e7870d` final pin.

Closure evidence: task bindings now use `getAgentDir`/`edupi-desktop` per data-root hash; dev/server/Rust launchers propagate `CORE`/`DATA` and allowed roots; `calendar_import` missing source defaults to inferred; focused, Desktop, and Rust tests pass. Core remains externally configured and is not bundled, so packaged launch visibly fails if absent. Provider image E2 still failed with 503 before any tool call. Status remains `evidence_pending`; `teacher_decision=not_run`; `external_send=false`.

Next entry: retry provider image E2 when healthy, then verify tool-completion refresh, pending appearance, and restart continuity.
