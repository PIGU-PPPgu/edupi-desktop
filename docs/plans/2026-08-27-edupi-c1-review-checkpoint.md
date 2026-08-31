# EduPi Desktop C1 review checkpoint — 2026-08-27

This note records the paired C1 review slice. It is evidence-pending, not a passed product checkpoint.

- checkpoint_id: C1
- status: evidence_pending
- repos / PRs / commits: Core PR [#2](https://github.com/PIGU-PPPgu/edupi/pull/2), head `3d155ad3d226fbacc4ac70d2909e3e8c55f41ee3`; Desktop internal archive PR [#11](https://github.com/PIGU-PPPgu/edupi-desktop-internal/pull/11), head `f74b55540c270aac148f2e31d1e8272a2961016b`
- Desktop commits: `8229245` command plane, `2eea8b3` review UI, `f74b555` shared E2
- pinned Core producer: `0188c50d7b411f7987e059287a4795ff3becc8c0`
- component manifest hash: `sha256:496b9098cbd6363c8cea7126fcde2c4d9d3b6b07a8678f58e63bf50f7609c4d2`
- contract: v1.1; supported commands are exactly `review_observation` and `review_memory_candidate`
- goal: let a teacher inspect evidence, choose one of four decisions, receive an auditable Core receipt, and see the refreshed snapshot without a Desktop-side education store

## Delivered

- Content-first `观察与记忆 / 待我确认` queue with source/evidence/uncertainty context.
- Accept, modify, reject, and hold controls with busy/error states and receipt-before-refresh.
- Original task review remains available; Chat remains the primary natural-language entrance.
- `external_send=false`; no legacy dual-write; one Core `teacher_review_state` is authoritative.

## Evidence

- `npm test`: 530 passed / 13 skipped / 0 failed (543).
- Real-runtime targeted checks: 32/32; typecheck and `git diff --check`: passed.
- Shared E2: 1 observation, 1 candidate, 1 active memory, 2 receipts, 2 history entries; idempotency replay, stale no-write, fresh child reload, single safe-store, and no legacy dual-write are green.
- Live Core: ready; 5 students, 28 calendar entries, 30 tasks; real user data still has 0 C1 candidates because E2 uses `mkdtemp`.
- Fresh Sol Core v3 and Desktop v3: `SHIP`, no finding.

## Gate still open

- Browser host URL policy blocked automated reload/visible writeback.
- No visible UI run has clicked all four decisions; E2 actually exercised observation accept and candidate modify. Reject/hold are covered by Core/UI/contract tests, not a complete visible E2.
- `teacher_decision=not_run`; no restart screenshot/record exists, so C1 remains `evidence_pending`.

## Isolated visible matrix — automated evidence

- Master execution pointer: `056ddff`; isolated harness: `533f7c2`.
- Final harness regression: 15/15; full Desktop after the harness: 545 passed / 13 skipped / 0 failed.
- Production workspace `30141` remained Core-ready with 5 students, 28 calendar items, 30 tasks, 0 C1 candidates, and 0 C1 receipts.
- Isolated workspace `30142` started from a detached temporary Desktop worktree and temporary Core data root with 8 observations, 8 candidates, and 0 memories.
- The real review API executed observation and memory-candidate `accept`, `modify`, `reject`, and `hold`: 8 successful receipts, 8 history entries, 2 active formal memories, and `external_send=false` throughout.
- Observation rejection visibly propagated its dependent candidate to `held`; modified observation/candidate content survived the fresh projection read.
- Fresh Sol reviewed three cleanup iterations; the final verdict was `ship` with no finding. Child exit, readiness failure, signal failure, Git cleanup retry, setup rollback, and exact-parent preservation have deterministic coverage.
- This is automated process evidence, not a teacher decision. The isolated page remains available for visual review; C1 stays `evidence_pending` until the teacher explicitly accepts or modifies the visible result.

## Rollback and next entry

- Roll back by reverting Desktop PR #11 or disabling the two C1 controls and restoring Core pin `7bafc91c7d5440d27e89c0639f3221af805b36ea` / manifest `sha256:4e323e429bee7dac663e78b06c54757f2cef7fa42dee95737c188730d7981e94`; preserve Core receipts/state.
- Next: use a real or explicitly authorized temporary observation to run visible accept/modify/reject/hold, verify receipt refresh plus restart/replay, then append the paired C1 decision entry in the Core ledger.

## Final C1-V decision — 2026-08-28

This appended decision supersedes the earlier `evidence_pending` status without rewriting or deleting that evidence history.

- checkpoint_id: C1-V (C1 product checkpoint)
- status: passed at the E2 gate
- evidence_level: E2 deterministic paired evidence plus accepted visible interaction; synthetic isolated data only, not E4/E5 or a general usefulness claim
- teacher_decision: accepted — the user explicitly said `界面认可`
- isolated run: port `30142`; 8 observations, 8 candidates, 0 memories at start; 17 receipts/history entries (accept 11, modify 2, reject 2, hold 2); 6 active memories
- state outcome: observations accepted 6 / modified 1 / rejected 1; candidates accepted 5 / modified 1 / rejected 1 / held 1; fresh projections survived each command
- shared evidence: C1 E2 replay, stale no-write, restart/reload, and idempotency were green; final harness 15/15; Desktop `npm test` 545 passed / 13 skipped / 0 failed; Fresh Sol v3 `SHIP`
- cleanup: `30142` stopped and its exact temporary worktree/data parent was removed with no residue; production `30141` remained ready with 5 students, 28 calendar entries, 30 tasks, and 0 C1 candidates
- contract: v1.1 with exactly `review_observation` and `review_memory_candidate`; one Core `teacher_review_state`; `external_send=false`
- residual risk: the accepted decision validates the visible review interface, not real teacher-content usefulness or external delivery; production data was not mutated
- next_entry_point: Task 2 — Chat source-bound capture and no-refresh queue update

## Task 2 final checkpoint — 2026-08-28

This appended entry records the completed Chat capture/no-remount checkpoint without rewriting the earlier C1 evidence-pending or passed history.

- checkpoint_id: C1-C / Task 2
- status: passed at the deterministic E2 gate
- evidence_level: E2 deterministic isolated evidence; no provider-backed live Chat message
- Desktop implementation commit: `8bc3c448516d5523c16773e9b8c0973a89645098`, pushed to internal archive PR [#11](https://github.com/PIGU-PPPgu/edupi-desktop-internal/pull/11) branch `codex/c1-visible-loop`
- pinned Core producer: `0188c50d7b411f7987e059287a4795ff3becc8c0`
- component manifest hash: `sha256:496b9098cbd6363c8cea7126fcde2c4d9d3b6b07a8678f58e63bf50f7609c4d2`

### Behavior and corrected E2

- A normal Chat completion increments the existing education refresh key. An established Chat/workspace stays mounted during background loading and error states, and retry remains visible. The implementation adds no event bus, remount, auto-send, or Desktop education writer.
- Corrected E2: a real Pi `UserMessage` has no ID; the ID exists only on the outer session entry, `chat-entry-c1-e2`. Fresh perception registration replays against the same isolated store and produces exactly 1 observation, 1 candidate, and 0 memories, with pending review, matching provenance, `external_send=false`, and no legacy write.
- This was deterministic isolated E2 evidence. No provider-backed live Chat message was run.

### Evidence and residual risk

- Targeted checks: 15/15.
- Full Desktop: 547 passed / 13 skipped / 0 failed.
- Typecheck, targeted lint, Node check, and `git diff --check`: passed.
- Final fresh Sol/Max verdict: `ship` after one fix-first cycle.
- Live production `30141` remained Core/projection ready and unchanged at 5 students, 28 calendar entries, and 30 tasks.
- Residual risk: Chat lifecycle preservation is protected mainly by structural/state tests, not a real browser mount-counter E2; final review judged this risk low.

- next_entry_point: Task 3 — C2 teacher context through Chat and receipts

## C2 paired checkpoint — 2026-08-28

This appended entry records the completed C2 paired checkpoint without rewriting the earlier C1 evidence-pending or C1-V history.

- checkpoint_id: C2
- status: passed at the deterministic E2 gate
- repos / PRs / commits: Core PR [#2](https://github.com/PIGU-PPPgu/edupi/pull/2), runtime/implementation pin `88e3865f88fde16b1770195388ebb94ac71ceb5f` with C2 commits `83adb9d` and `88e3865`; Desktop internal archive PR [#11](https://github.com/PIGU-PPPgu/edupi-desktop-internal/pull/11), C2 implementation head `ec19c53` with C2 commits `8232c23`, `be4ccec`, `0ea68b5`, and `ec19c53`
- goal: create one source-bound, reviewable five-field teacher-context proposal from Chat, keep preferences as an independent C1 candidate, and apply accept/modify/reject/hold only through Core receipts
- input/evidence IDs: real outer branch source IDs `c2-source-1` through `c2-source-4`; one isolated preferences candidate; four context receipts/history entries; deterministic paired C2 E2; explicit teacher decision `界面认可。继续后面`
- contract version / schema hash: v1.1 / `sha256:ae478e2025b41372b0b3ccd44663b3ebd451b50b1a8c7bca4f306e07c3e1da3a`
- component manifest / fixture manifest: `sha256:fdc64663b0767e9309073b303b9dfc0fc760c8d8e01ab75699d4026f182cbe2b` / `sha256:47551e7a5955b1730754464086ef495c0e1e710330209de14402fe04fbfff0c9`
- supported commands / projection: exactly `review_observation`, `review_memory_candidate`, `review_teacher_context` / `education_workspace`
- state outcome: one teacher-context target; one separate C1 `preferences` candidate; final canonical context `赵老师 / 班主任 / 数学 / 七年级 / 七年级二班`; `external_send=false`; one Core `teacher_review_state`; no Desktop canonical context/preferences writer or fallback
- tests and commands: focused teacher-context client 6/6; paired C2 E2 GREEN with accept/hold/reject/modify, replay, restart/reload, stale snapshot/revision no-write, genuine fixed-child stale-revision receipt; C1 E2 GREEN; Chat capture E2 GREEN; Desktop `npm test` 570 passed / 13 skipped / 0 failed; typecheck, lint, and `git diff --check` passed
- review: final Fresh Sol/Max verdict was `ship` after one fix-first wrapper-bypass finding was closed
- E-level: E2 deterministic paired synthetic evidence plus accepted visible C2 interface; not E4/E5, not provider-backed real Chat, not real user-context mutation or general usefulness evidence
- teacher decision: accepted — the user explicitly said `界面认可。继续后面`
- external_send: false
- rollback: revert the paired C2 commits or restore the preceding C1 pins recorded above; preserve Core receipts/state and do not add a Desktop fallback store
- residual risk: no provider-backed real Chat or production teacher-context mutation/usefulness is claimed; the historical C3.1 provider image attempt remains `evidence_pending`, and external delivery remains unimplemented
- next_entry_point: Task 4 — Make Today the proactive teacher work surface (C3); then the already prioritized C6 file/image intake

## Current resume pointer — 2026-08-28 C2 complete

Resume from Task 4 / C3 Today with Core runtime/implementation pin `88e3865f88fde16b1770195388ebb94ac71ceb5f`, Desktop C2 implementation head `ec19c53`, and the exact v1.1 hashes recorded in the C2 checkpoint above. The prior C1 sections remain historical evidence.

## C3.2 — Proactive Today paired checkpoint (2026-08-28)

This appended entry records the completed C3 Today checkpoint without rewriting the historical C1/C2 or C3.1 evidence.

- checkpoint_id: C3.2
- status: passed at the deterministic paired E2 gate
- repos / commits: Core runtime/implementation pin `52a8badf7ff72dde54fc1b75360e003aef734b2e` (`519adc4`, `513b109`, `52a8bad`); Desktop C3 implementation head `6b215b0` (`85520e2`, `c45dfc4`, `645a747`, `6b215b0`)
- contract status/version: v1.1; schema hash `sha256:ae478e2025b41372b0b3ccd44663b3ebd451b50b1a8c7bca4f306e07c3e1da3a`; component manifest `sha256:ec09ecea1d680ebe1080dfd5361a451e81a18e916e98e69e6398ae1a1e11f7b0`; fixture manifest `sha256:67fd627f9de27e3fce454a9b5177f3759057e56a7e5ae5a161d451f5c08fb6a8`
- supported commands / projection: exactly `review_observation`, `review_memory_candidate`, `review_teacher_context`, `review_work_candidate` / `education_workspace`; `external_send=false`
- goal: make Core-projected Today work candidates visible, independently reviewable, lifecycle-aware, and safe to resume through Desktop without a second canonical store
- input/evidence IDs: 8 isolated calendar events; 9 deterministic work candidates; 7 work receipts/history entries; matching-reason peer, snooze-expiry, next-cycle release, exact-envelope replay, fixed-child restart, stale no-write, and filesystem allowlist evidence; live browser projection/editor smoke at 390/768/1440
- state ownership: Core owns work candidates, suppression policies, decisions, lifecycle, receipts/history, and `teacher_review_state`; Desktop owns validated projection, request initiation, and UI-local editor/lock state only
- tests and commands: Desktop `npm test` -> 593 passed / 13 skipped / 0 failed; C1/C2/Chat/C3 exact-Core E2 -> green; typecheck, lint, and `git diff --check` -> passed
- browser/data note: live `30141` displayed 2 pending candidates after an explicit 30-day preview heartbeat; six actions and editors rendered with no console error/warn or horizontal overflow; the preview heartbeat wrote the derived rhythm plan with 5 tasks and canonical work-candidate state with 2 pending candidates. No live review decision or receipt, proactive send, or external action occurred; `proactive_entries=[]`.
- E-level: E2 deterministic paired evidence plus live projection/editor smoke; not E4/E5, not provider-backed intake, not external delivery, and not general usefulness evidence
- teacher decision: not_run for final C3 candidate/review usefulness; the user's `界面认可。继续后面` records continuation approval only
- rollback: revert the paired C3 implementation commits/pin and hide Today candidate controls; preserve canonical data/receipts and the 28-item source calendar; the 5-task rhythm plan is derived/reproducible. After the two explicit preview runs, current `rhythm_plan.json.bak` also contains the post-C3 5-task plan and is not a pre-C3 30-task rollback point; never add a Desktop fallback
- residual risk: live browser did not execute all six mutations; ongoing heartbeat/scheduler invocation and safe file/image ingestion are not yet a Desktop closed loop; historical provider image attempt remains `evidence_pending`
- next_entry_point: Desktop Task 5 safe file/image staging, immediately followed by prioritized Task 6/C6 image/PDF/Word -> pending day/week/month calendar intake

## Current resume pointer — 2026-08-28 C3.2 complete

Resume at **Task 5 — Build safe file/image staging before any import command**, immediately followed by prioritized **Task 6/C6 — Deliver image/PDF/Word to pending day/week/month calendar**. Preserve the exact C3 pins and `external_send=false`; do not repeat C3 or infer live six-decision execution, provider-backed image intake, external delivery, E4/E5, or general usefulness from this checkpoint.
