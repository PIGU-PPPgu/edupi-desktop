# EduPi Desktop implementation plans

This directory is the durable execution index for the EduPi Desktop half of the dual-spiral roadmap. Desktop is the visible, controllable body: it presents Core-owned state, explains evidence and review, and issues typed commands. Core remains the brain and single canonical truth store.

The shared append-only checkpoint ledger is the Core file docs/loop/DUAL_SPIRAL_CHECKPOINTS.md. It is the only shared record allowed to mark a Core/Desktop checkpoint passed.

## Authority and precedence

Read the documents in this order:

1. The Core repository's docs/plans/2026-08-24-edupi-dual-spiral-roadmap.md is the cross-repository source of truth for the product thesis, interaction contract, ownership contract, bridge contract, evidence ladder, vertical checkpoints, safety boundaries, metrics, and stop/rethink conditions.
2. 2026-08-24-edupi-desktop-optimization.md is the Desktop implementation plan. It owns Desktop file paths, projection/command decomposition, UI checkpoints, browser/runtime checks, and consumer rollback.
3. The Core repository's 2026-08-24-edupi-core-optimization.md owns Core producer behavior. A Desktop task depending on a bridge change is not complete without the paired Core producer PR, fixtures, and pinned manifest.
4. Existing Desktop docs are historical/product/visual research inputs. They do not override the canonical roadmap or a later checkpoint ledger entry.

The clean Desktop baseline for this planning lane is ac57d533311968f406a8d53fa3f41c2168530e03. The original running Desktop workspace is inspection-only for this lane; preserve its state and do not treat uncommitted work there as the clean baseline. Unrelated untracked `tmp/` WIP was transiently observed during planning and disappeared through an external/concurrent process without this lane touching it; the original Desktop workspace is currently clean at verification time. Never clean, reset, stage, or delete future unrelated work; record and preserve actual status rather than forcing it to zero.

## Checkpoint status fields

Every active or completed checkpoint records the same fields in the Desktop PR and shared ledger:

~~~yaml
checkpoint_id: C1.1
status: planned | in_progress | blocked | evidence_pending | passed | stopped | superseded
repos: [edupi-core, edupi-desktop]
prs: []
commits: []
goal: "one sentence"
input_evidence_ids: []
contract_version: "1.0"
tests: []
evidence_level: E0 | E1 | E2 | E3 | E4 | E5
teacher_decision: not_run | accepted | modified | rejected | held
external_send: false
external_delivery: omitted in v1; separately versioned only after paired review
supported_projections: [] in v1; separately versioned projections only after paired review
rollback: "named reversible operation"
residual_risk: "explicit or none"
next_entry_point: "task/checkpoint"
~~~

status: passed means only that the named evidence gate passed. A fixture is E1, not E4/E5. A Desktop screenshot proves presentation at most; it cannot prove teacher usefulness or a real channel receipt. Desktop foundation Tasks 1A–4, including Task 2A, Task 4E, and Tasks 3A–3H for every reachable write/status path, are C1 implementation substeps and remain in_progress or evidence_pending until the complete seven-step C1 loop passes. v1 external_send is the JSON boolean false; a future E4 lifecycle belongs in a separately versioned external_delivery object after paired review.

## Resuming after context loss

An executor or reviewer with no prior conversation should:

1. Read this README, docs/loop/DUAL_SPIRAL_CHECKPOINTS.md, then the canonical Core roadmap and the Desktop task named by next_entry_point.
2. Confirm git rev-parse HEAD, git status --short, the pinned Core commit, contract_version, schema hash, and fixture manifest hash.
3. Inspect the last shared ledger entry and paired PRs. Treat old chat summaries, model self-report, fixture-only results, and gateway status as untrusted evidence.
4. Run the task's failing test before editing. If a prerequisite Core PR or manifest is missing, mark the task blocked rather than fabricating compatibility.
5. Preserve the existing Pi session, Tauri, request-security, and file-access boundaries. Do not run next build during development; it pollutes .next and breaks npm run dev.
6. Unknown contract versions or schema hashes must fail closed: no projection, no local write, no external send, and a visible refresh/update path.
7. Continue only from next_entry_point and append a new plan/change note if sequencing changes.

Actual execution uses Sol Advisor New with Luna / Max implementation and fresh Sol / Max review. No task authorizes a different role, model, or reasoning level.

The Desktop plan currently contains 52 explicit executable `## Task` sections, including Task 2A for legacy status projection closure. Counts of `Files`, `Steps`, `Acceptance`, `Rollback`, `Suggested commit`, and `Depends on` sections must remain equal to that task count after every plan update.

## Updating plans without rewriting history

Plans are append-oriented. Never rewrite a passed checkpoint's evidence, delete a failed browser/runtime check, or edit history to hide a contract mismatch. Append a dated change note or ledger entry with the affected checkpoint, old/new contract version and schema hash, paired PR links, exact commands, rollback, and next entry point.

When the bridge changes, update Core producer and Desktop consumer in paired PRs. Pin the Core commit/schema hash in contracts/edupi-core-compat.json, include a version/change note, update producer/consumer fixtures, and obtain fresh Sol / Max review. Do not make readEducationContract or buildEducationContract guess unknown fields.

## Scope and safety reminders

- Core owns canonical teacher events, evidence, facts, memory, profiles, policies, work candidates, decisions, action plans, receipts, feedback, and learning candidates.
- Desktop may project and inspect those objects and issue typed commands. It must not synthesize education decisions, directly mutate Core JSON, or establish a second canonical store.
- The initial supported_commands manifest is empty; after paired Core Tasks 5–7 handler/fixture proof and Desktop consumer proof, it may enable only review_observation and review_memory_candidate. Task 2A closes the legacy status projection before Phase 1 may exit.
- C1 cannot pass without the shared verifier: EDUPI_CORE_ROOT=<paired-worktree> npm run test:edupi-c1-e2. If unavailable or failed, C1 remains evidence_pending.
- Chat remains the primary natural-language entrance; navigation is a control/inspection surface answering what needs me, what EduPi prepared, why, what needs confirmation, what it remembered, and how feedback changed the next cycle.
- Preserve the Notion-like content-first, project/task/workspace direction, but carry visual improvement with each vertical slice rather than making polish its own early horizontal phase.
- No automatic external send, automatic skill promotion, credentials/secret mutation, opaque student scoring, raw chain-of-thought exposure, biological consciousness claims, or arbitrary action execution.

## Shared checkpoint ledger template

~~~markdown
### Cx.y — <short name>

- checkpoint ID: Cx.y
- repos / PRs / commits: Core <link>; Desktop <link>; commits <sha>
- goal: <one sentence>
- input/evidence IDs: <teacher input, observation, material, fixture, session, channel IDs>
- contract version / schema hash: <value>
- tests and commands: <exact commands and result>
- E-level: E0/E1/E2/E3/E4/E5, with why
- teacher decision: not_run/accepted/modified/rejected/held
- external_send: false (v1); external_delivery: omitted in v1 or separately versioned after paired review
- rollback: <cache clear, receipt rollback, feature flag, or revert PR>
- residual risk: <explicit risk>
- next entry point: <task/checkpoint>
~~~

Optional cadence is guidance only: a small consumer slice may take hours to a few working days; a real teacher evidence cycle may take weeks. These are ranges, not commitments.

## Current resume pointer — 2026-08-26

Resume from [2026-08-26-edupi-schedule-workspace.md](./2026-08-26-edupi-schedule-workspace.md) and the Core ledger entry `C3.1`. The real image E2 was attempted through `/api/agent/new` but is `failed/unavailable` after four provider 503s before any tool call; no pending appearance or restart proof exists. The paired schedule/risk foundation remains `evidence_pending` with `external_send=false` and `teacher_decision=not_run`; retry real image E2 when the provider is healthy, then verify tool completion refresh/pending/restart.

## Current resume pointer — 2026-08-26 fix-first closure

Fresh Sol v2 returned fix-first for launch roots, task bindings in Core output, and the missing-source import default. Core `bc3b16eeadb0e11816e8dc2f8360a3972490ed42` and Desktop `c08fd2b`, `423dcdb`, `1e7870d` address those findings; focused, Desktop, and Rust tests pass. Core remains externally configured/not bundled, packaged launch visibly fails if absent, and provider image E2 still failed with 503. Resume by retrying provider E2 when healthy, then verify tool-completion refresh, pending appearance, and restart continuity; status remains `evidence_pending`, `teacher_decision=not_run`.

## Current resume pointer — 2026-08-27 teacher-agent master execution

The current entry point is [2026-08-27-edupi-teacher-agent-master-execution.md](./2026-08-27-edupi-teacher-agent-master-execution.md), Task 1. Core PR #2 and Desktop PR #11 have a paired C1 command plane, visible review queue, strict pin, and green shared E2, but C1 remains `evidence_pending` until the isolated visible accept/modify/reject/hold matrix receives a teacher decision and restart record. After C1-V, continue in this order: Chat capture/refresh, C2 context, C3 Today, prioritized C6 file/image intake, C4 teaching, C5 follow-up, C7/C8 growth, C9 native action, release.

## Current resume pointer — 2026-08-28 C1-V passed

C1-V is now `passed` at the deterministic E2 gate with `teacher_decision=accepted` from the user's explicit `界面认可`; the evidence is synthetic isolated data and does not claim E4/E5 or general teacher-content usefulness. Resume from [2026-08-27-edupi-teacher-agent-master-execution.md](./2026-08-27-edupi-teacher-agent-master-execution.md), **Task 2 — Connect Chat messages to C1 capture and live queue refresh**. Keep the Core v1.1 pin, exactly two review commands, Core-only `teacher_review_state`, and `external_send=false`; the paired ledger entry is in the Core repository's `docs/loop/DUAL_SPIRAL_CHECKPOINTS.md`.

## Current resume pointer — 2026-08-28 C2 paired checkpoint

C2 is now `passed` at the deterministic paired E2 gate. Core runtime/implementation pin is `88e3865f88fde16b1770195388ebb94ac71ceb5f`; Desktop C2 implementation head is `ec19c53`. The v1.1 schema hash is `sha256:ae478e2025b41372b0b3ccd44663b3ebd451b50b1a8c7bca4f306e07c3e1da3a`, component manifest hash is `sha256:fdc64663b0767e9309073b303b9dfc0fc760c8d8e01ab75699d4026f182cbe2b`, and fixture manifest hash is `sha256:47551e7a5955b1730754464086ef495c0e1e710330209de14402fe04fbfff0c9`.

The exact supported commands are `review_observation`, `review_memory_candidate`, and `review_teacher_context`; the only projection is `education_workspace`; `external_send=false`. C2 E2 proved one five-field teacher-context target, one separate C1 `preferences` candidate, four decision receipts/history entries, replay/restart, stale no-write, and no legacy/auth/model writes. The user's `界面认可。继续后面` accepts the visible C2 interface only; synthetic E2 evidence does not claim E4/E5, provider-backed real Chat, real user-context mutation, or general usefulness. Live `30141` remains ready with 5 students, 28 calendar items, and 30 tasks.

Resume at [2026-08-27-edupi-teacher-agent-master-execution.md](./2026-08-27-edupi-teacher-agent-master-execution.md), **Task 4 — Make Today the proactive teacher work surface (C3)**, then the already prioritized C6 file/image intake. The historical C3.1 provider image attempt remains `evidence_pending`.

## Current resume pointer — 2026-08-28 C3 Today paired checkpoint

C3.2 is now `passed at the deterministic paired E2 gate`. Core runtime/implementation pin is `52a8badf7ff72dde54fc1b75360e003aef734b2e` with C3 commits `519adc4`, `513b109`, and `52a8bad`; Desktop C3 implementation head is `6b215b0` with commits `85520e2`, `c45dfc4`, `645a747`, and `6b215b0`.

The v1.1 schema hash is `sha256:ae478e2025b41372b0b3ccd44663b3ebd451b50b1a8c7bca4f306e07c3e1da3a`, component manifest hash is `sha256:ec09ecea1d680ebe1080dfd5361a451e81a18e916e98e69e6398ae1a1e11f7b0`, and fixture manifest hash is `sha256:67fd627f9de27e3fce454a9b5177f3759057e56a7e5ae5a161d451f5c08fb6a8`.

Supported commands are exactly `review_observation`, `review_memory_candidate`, `review_teacher_context`, and `review_work_candidate`; the only projection is `education_workspace`; `external_send=false`. Core owns Today work candidates, suppression policies, decisions, lifecycle, receipts/history, and canonical `teacher_review_state`. Desktop only projects and initiates receipt-bound review with UI-local editor/lock state; it has no canonical writer or fallback.

C3 E2 proved 8 calendar inputs → 9 work candidates, 7 receipts/history entries for accept/modify/reject/hold/snooze/suppress (two suppression scopes), matching-reason peer suppression, snooze expiry, next-cycle release, exact-envelope replay, child restart reads, stale snapshot/revision no-write, filesystem allowlist, `proactive_entries=[]`, and external-send safety. Desktop `npm test` finished 593 passed / 13 skipped / 0 failed; typecheck/lint/diff checks and C1/C2/Chat/C3 E2 were green. Live browser smoke showed 2 pending candidates and all six controls/editors at 390/768/1440 without console errors or overflow, but no live teacher decision or receipt was applied. This is E2 plus projection/editor smoke, not E4/E5 or general usefulness; `teacher_decision=not_run` for final C3 candidate/review usefulness.

The next entry point is **Task 5 — Build safe file/image staging before any import command**, immediately followed by prioritized **Task 6 — Deliver image/PDF/Word to pending day/week/month calendar (C6)**. Historical C3.1 provider image evidence remains `evidence_pending`; do not infer live six-decision execution, provider-backed image intake, external delivery, E4/E5, or general usefulness.

## Current resume pointer — 2026-08-28 C6 staged intake

Task 5 staging and the C6 intake/recognition slice are complete. Resume from [2026-08-28-edupi-c6-intake-checkpoint.md](./2026-08-28-edupi-c6-intake-checkpoint.md): Core pin `2f289557f05bc2526343c6c587b1de05ffcb6602`, component manifest `sha256:1d52f92e1f7762470667213a2d3d2dac24b7a02faded8d004f4c611c750bc6b6`, and seven cumulative commands. The paired E2 proves calendar/timetable/material mutation, receipt binding, staging cleanup, restart-safe projection, tamper rejection, visible held dates, and original filename projection.

The hardened recognition layer passed its isolated real-model E2 on 2026-08-29: three DOCX events and one weekly slot were extracted; all inferred facts remain pending, the ambiguous date stays visibly held without guessing, the original filename survives settlement, and staging clears only after all receipts complete. Byte-swap/symlink, child-process archive containment, bounded concurrency, live-lock protection, semantic replay conflict, interrupted finalization, duplicate ambiguous-name retention, and partial-command retry cases have deterministic coverage. Resume only after live browser verification and the final fresh-context no-findings review; provider/tool unavailability retains staging for retry and is not a Core write.

## Current resume pointer — 2026-08-30 workspace board

The first workspace-board slice is implemented in [2026-08-30-edupi-workspace-board.md](./2026-08-30-edupi-workspace-board.md). It adds a first-level full-width board backed only by Core tasks, work-candidate lifecycle, and bound Agent sessions; current live lanes are 30 todo / 0 active / 2 review / 0 done. Search, responsive horizontal scrolling, and card-to-task-detail navigation passed browser checks without console errors. The next slice is a Core receipt-bound `create_task` and `move_task_stage` contract; do not add UI-only drag state.
