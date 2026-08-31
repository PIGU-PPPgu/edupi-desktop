# EduPi Teacher Agent Master Execution Plan

> **For Codex:** REQUIRED SUB-SKILL: use `executing-plans` task-by-task. Actual implementation uses Sol Advisor New: one Luna / Max implementation lane, then a fresh Sol / Max read-only review before each checkpoint stands.

**Goal:** Turn EduPi Desktop into the persistent, visible body of the EduPi teacher agent: Chat remains the natural-language entrance, Core remains the single education truth, and every useful observation, preparation, schedule item, teaching output, memory, and desktop action becomes visible, reviewable, resumable, and evidenced.

**Architecture:** EduPi Core owns teacher events, evidence, candidates, facts, memories, work decisions, receipts, feedback, and action policy. EduPi Desktop projects that state, hosts Chat and native tools, issues only pinned typed commands, and stores only UI/session/staging state outside Core truth. Each vertical slice follows `teacher input -> Core candidate -> Desktop review -> typed command -> Core receipt -> refreshed projection -> restart/replay evidence`.

**Tech Stack:** TypeScript, React 19, Next.js 16, Pi AgentSession, Node.js one-shot Core bridge, Tauri 2/Rust, Core safe-store JSON, Node test runner, deterministic E2 harnesses, Sol Advisor New review lanes.

---

## 0. Authority, current checkpoint, and resume rule

This plan is the current execution companion. It does not replace:

1. Core `docs/plans/2026-08-24-edupi-dual-spiral-roadmap.md` — product and ownership authority.
2. Desktop `docs/plans/2026-08-24-edupi-desktop-optimization.md` — detailed consumer contracts and exact later-task definitions.
3. Core `docs/loop/DUAL_SPIRAL_CHECKPOINTS.md` — the only shared append-only pass/fail ledger.

Current verified baseline (C2 paired checkpoint, 2026-08-28):

- Core runtime/implementation pin: `88e3865f88fde16b1770195388ebb94ac71ceb5f`; C2 commits `83adb9d` (context store) and `88e3865` (capability/fixture publication).
- Desktop C2 implementation head: `ec19c53`; C2 commits `8232c23` (consumer/pin), `be4ccec` (property sheet/persistent Chat host), `0ea68b5` (wrapped receipt/stale fix), and `ec19c53` (paired E2).
- Component manifest: `sha256:fdc64663b0767e9309073b303b9dfc0fc760c8d8e01ab75699d4026f182cbe2b`.
- Fixture manifest: `sha256:47551e7a5955b1730754464086ef495c0e1e710330209de14402fe04fbfff0c9`.
- Contract: v1.1; schema hash `sha256:ae478e2025b41372b0b3ccd44663b3ebd451b50b1a8c7bca4f306e07c3e1da3a`.
- Supported commands are exactly `review_observation`, `review_memory_candidate`, `review_teacher_context`; projection is `education_workspace`; `external_send=false`.
- C2 state: one five-field teacher-context target (`name`, `role`, `subject`, `grade`, `class_name`) and one separate C1 `preferences` candidate in Core `teacher_review_state`; Desktop has no canonical context/preferences writer or fallback.
- Paired C2 E2: accept, hold, reject, modify; 4 context receipts/history entries; idempotent replay; restart/reload; stale snapshot and stale revision no-write; genuine fixed-child stale-revision receipt; one canonical state file; no legacy/auth/model writes.
- Teacher decision: accepted visible C2 interface via `界面认可。继续后面`; evidence is deterministic synthetic data and does not claim E4/E5, provider-backed real Chat, real teacher-context mutation, or general usefulness.
- Live projection: 5 students, 28 calendar items, 30 tasks; production data remains unchanged.
- Status: `passed` at the deterministic C2 E2 gate. The historical C3.1 provider image attempt remains `evidence_pending` and is not promoted by this checkpoint.

Resume after any context loss:

1. Read this file, the last Core ledger entry, and the current checkpoint file.
2. Run `git status --short` and confirm both PR heads and the pinned Core identity.
3. Continue only from the first unchecked task below.
4. Never infer completion from chat history; require the named verifier and commit.

## 1. Product invariants for every task

- Chat remains the first and easiest entrance; workspaces inspect and control what Chat/Core prepared.
- Core is the only canonical education store. Desktop has no fallback writer for Core JSON.
- Teacher-visible text is concise, Chinese-first, Notion-like, and free of internal engineering vocabulary.
- No button ships without an implemented click path, busy state, failure state, result, and restart behavior.
- Files and images create candidates first. Unknown dates, conflicts, and inference remain visibly pending.
- `external_send=false` until a separately versioned delivery checkpoint passes.
- A screenshot proves presentation only. A product checkpoint also needs receipt and restart/replay evidence.
- Every task ends in tests, fresh review, an atomic commit, PR update, and a ledger next entry.

## 2. Ordered checkpoint map

| Order | Checkpoint | Teacher outcome | Exit evidence |
| --- | --- | --- | --- |
| 1 | C1-V visible acceptance | Teacher can visibly accept/modify/reject/hold observations and memory candidates | Eight-action target matrix, receipts, refresh, restart record |
| 2 | C1-C Chat capture | A normal Chat message appears in `待我确认` without manual refresh | Real source entry ID, candidate projection, visible queue update |
| 3 | C2 context | Teacher identity, classes, subject, preferences are Chat-guided and reviewable | Context receipt, restart, no preferences JSON write from Desktop |
| 4 | C3 Today | EduPi prepares the teacher's day and learns suppression/feedback | Work-candidate receipt, no repeated closed reminder |
| 5 | C6 intake priority | Image/PDF/Word notices become pending calendar/material items | Source hash, extracted dates, teacher confirmation, day/week/month refresh |
| 6 | C4 teaching | Materials become evidence-backed teaching adjustments and outputs | Material evidence -> adjustment -> artifact receipt |
| 7 | C5 class/family | Student/class/family follow-up is reviewable and privacy-bounded | Follow-up receipt, suppression, no opaque diagnosis |
| 8 | C7/C8 growth | Insights and growth candidates show how feedback changed the next cycle | Insight/growth receipts and before/after evidence |
| 9 | C9 desktop action | EduPi can preview and perform approved local actions with a stop path | Preview/authorization/result receipts and native attestation |
| 10 | Release | Reviewed Core and Desktop ship as one signed recoverable application | Bundled runtime, signatures, rollback, platform installers |

The explicit user priority moves C6 intake immediately after C3 instead of waiting behind C4/C5. Before C6 implementation, append this sequencing change to the shared ledger; do not silently rewrite the canonical roadmap.

## Task 1: Build the isolated visible C1 acceptance workspace

**Files:**

- Create: `scripts/run-edupi-c1-visible-checkpoint.mjs`
- Create: `scripts/run-edupi-c1-visible-checkpoint.test.mjs`
- Modify: `package.json`
- Update after evidence: `docs/plans/2026-08-27-edupi-c1-review-checkpoint.md`
- Append after evidence: Core `docs/loop/DUAL_SPIRAL_CHECKPOINTS.md`

**Step 1: Write the failing harness test**

Assert that the harness:

- requires an absolute pinned `EDUPI_CORE_ROOT`;
- creates one `mkdtemp` data root with memory/output/locks;
- seeds separate observation and memory-candidate targets for accept, modify, reject, and hold through Core adapters, never by writing canonical JSON;
- starts a second local Desktop server on a configurable non-production port;
- prints the URL, target labels, cleanup command, and no teacher/student content;
- never resolves the real EduPi data root.

**Step 2: Run the test to verify RED**

Run:

```bash
node --test scripts/run-edupi-c1-visible-checkpoint.test.mjs
```

Expected: FAIL because the harness does not exist.

**Step 3: Implement the minimal harness**

Use `git worktree add --detach` to create a temporary Desktop checkout at the current committed HEAD, link only the existing `node_modules`, and run Next dev from that checkout so it owns a separate `.next`. Use `spawn(process.execPath, ...)`/Next dev without a shell command string. Keep the temporary data root, temporary Desktop worktree, and child PID explicit. On exit, stop the child, remove the exact registered temporary worktree, and remove only the created parent root. Never share the running 30141 checkout's `.next`.

**Step 4: Run automated verification**

```bash
node --test scripts/run-edupi-c1-visible-checkpoint.test.mjs
EDUPI_CORE_ROOT=<pinned-runtime> npm run test:edupi-c1-e2
node_modules/.bin/tsc --noEmit
git diff --check
```

Expected: PASS; the existing real data counts and hashes remain unchanged.

**Step 5: Run the visible teacher matrix**

In the isolated workspace, visibly execute:

- observation: accept, modify, reject, hold;
- memory candidate: accept, modify, reject, hold.

For each action record target ID, receipt ID, before/after snapshot, visible status, and restart result. Do not mark C1 passed without the teacher's explicit acceptance of this run.

**Step 6: Checkpoint**

Suggested commits:

```text
test(desktop): add isolated C1 visible acceptance harness
docs(c1): record visible teacher decision matrix
```

Rollback: stop the secondary server and remove only its printed temporary root. Production data is untouched.

## Task 2: Connect Chat messages to C1 capture and live queue refresh

**Files:**

- Core modify: `extensions/perception_l4.ts`
- Core test: `scripts/test_teacher_observation.mjs`
- Desktop modify: `components/AppShell.tsx`
- Desktop modify: `components/EduPiEducationPanel.tsx`
- Desktop modify if event ownership belongs there: `hooks/useAgentSession.ts`
- Desktop test: `components/EduPiEducationPanel.test.mjs`
- Desktop create: `lib/edupi-education-refresh.test.mjs`

**Step 1: Write RED tests**

Prove a real Pi source entry ID creates one observation/candidate, an unrelated message creates none, repeated context/turn-end creates no duplicate, and `agent_settled` refreshes education once without remounting Chat.

**Step 2: Verify RED**

```bash
node --import tsx <core>/scripts/test_teacher_observation.mjs
node --test components/EduPiEducationPanel.test.mjs lib/edupi-education-refresh.test.mjs
```

**Step 3: Implement the smallest runtime connection**

- Run the C1 capture extension from the reviewed Core source used by the active teacher session.
- Reuse the existing education `refreshKey`/Agent terminal event instead of creating a second event bus.
- Refresh after `agent_settled` and relevant Core receipt/tool completion; dedupe by run/receipt ID.
- Preserve Chat content, draft, scroll, and session identity.

**Step 4: Verify and checkpoint**

Run Core capture tests, Desktop panel tests, full Desktop tests, typecheck, and a real message E2. Suggested commit: `feat(c1): surface Chat observations without manual refresh`.

Acceptance: a teacher types one normal observation in Chat and sees it in `待我确认` without reload; source/provenance matches the real session entry.

## Task 3: Complete C2 teacher context through Chat and receipts

**Files:** Follow Core Task 9E2 and Desktop Tasks 6C2/6E2/6 in the canonical plans.

- Core producer: teacher-context candidate, projection, command handler, receipt/history fixture.
- Desktop consumer: `lib/edupi-education-contract.ts`, onboarding route, `components/EduPiContextEditor.tsx`, capability pin/tests.

**Steps:**

1. Write paired Core/Desktop failing fixtures for `review_teacher_context`.
2. Prove Core-only atomic persistence and unknown-field rejection.
3. Pin exactly the additional command after fresh producer review.
4. Replace the current read-only context handoff with receipt-backed accept/modify/reject/hold.
5. Run restart/replay and append C2 ledger evidence.

Acceptance: Chat can establish teacher identity/classes/preferences, Desktop can edit the candidate, and no Desktop route writes preferences or teacher context JSON directly.

## Task 4: Make Today the proactive teacher work surface (C3)

**Files:** Follow Core Task 10E3 and Desktop Tasks 7C3/7E3/7.

- Core: work candidate, suppression, snooze, close, recurrence, receipt.
- Desktop: `components/EduPiWorkspaceViews.tsx`, `components/EduPiObjectSider.tsx`, Today projection and review actions.

**Steps:**

1. Add a failing real reminder-closure case.
2. Implement Core work-candidate commands and no-repeat inheritance.
3. Pin the command only after receipt fixtures pass.
4. Render `现在 / 稍后 / 已完成` with minimal copy.
5. Verify teacher feedback changes the next generated Today plan.

Acceptance: closed or rejected work does not reappear under a new label; every task explains source and next action.

## Task 5: Build safe file/image staging before any import command

**Files:**

- Create: `lib/edupi-material-staging.ts`
- Create: `lib/edupi-material-staging.test.mjs`
- Create/modify: `app/api/edupi/materials/stage/route.ts`
- Modify: `components/AppShell.tsx`, `components/EduPiWorkspaceViews.tsx`, Chat attachment handoff
- Modify: `desktop/server-launcher.cjs`, `src-tauri/src/lib.rs` only if the app-config staging root is not already forwarded

**Steps:**

1. Write failing tests for root containment, symlinks, count, size, filename, 0600 mode, hash, restart cleanup, and real Core path rejection.
2. Create staging only under `PI_DESKTOP_STATE_DIR/material-staging`.
3. Route every education upload path to staging or Chat; no route may write Core inbox/memory/output.
4. Return only `staging_id`, validated path, size, SHA-256, kind, and source scope.
5. Run security, desktop-token, Tauri, and regression tests.

Suggested commit: `feat(desktop): stage teacher materials outside Core truth`.

## Task 6: Deliver image/PDF/Word to pending day/week/month calendar (C6 priority)

**Files:** Follow paired Core intake Task 13 and Desktop Tasks 10C6/10E6/10.

- Core: `import_calendar`, `import_timetable`, `intake_material` handlers, fixtures, source/hash/date-state projection.
- Desktop: `components/EduPiCalendarWorkspace.tsx`, `components/EduPiCalendarModule.tsx`, material staging route, command client, pending review surface.

**Steps:**

1. Freeze sample inputs: school-calendar image, meeting notice PDF, Word teaching notice, ambiguous date, conflicting date.
2. Write Core RED fixtures proving explicit/inferred/held dates and source hashes.
3. Implement atomic intake and idempotent upsert; no date guessing when evidence is missing.
4. Pin exactly the three intake commands after paired review.
5. Render pending items in day/week/month views with source, confidence, and conflict state.
6. Confirm through the teacher review surface; refresh after receipt and verify restart.

Acceptance: sending a file/image through Chat produces a pending calendar candidate, and confirmation places it correctly in all three views without duplicate events.

## Task 7: Teaching adjustment and artifact flow (C4)

**Files:** Follow Core Task 11E4 and Desktop Tasks 8C4/8E4/8.

Implement `material evidence -> teaching adjustment candidate -> Agent work -> artifact -> teacher review`. Reuse the existing task workspace and file preview. Never present a diagnosis as a fact; show source material and uncertainty.

Acceptance: one real worksheet/error sample produces a traceable adjustment and editable teacher artifact with a receipt.

## Task 8: Class, student, and family follow-up (C5)

**Files:** Follow Core Task 12E5 and Desktop Tasks 9C5/9E5/9.

Implement privacy-bounded follow-up candidates, suppression, completion, and parent-contact context. Avoid scores/rankings and do not auto-send messages.

Acceptance: one student event can be held, modified, closed, or suppressed; closing it prevents repeat reminders after restart.

## Task 9: Insights and professional growth (C7/C8)

**Files:** Follow Desktop Tasks 11C7/11E7/11 and 11C8/11E8.

Convert current insight/growth displays into reviewable candidates with source evidence, feedback, next-cycle change, independent evaluation, and rollback. Keep internal names such as consciousness layers out of teacher-facing UI.

Acceptance: the teacher can see what EduPi inferred, accept/reject it, and verify what changed next time.

## Task 10: Typed Desktop action loop using the existing NomiFun backend (C9)

**Files:**

- Existing vendor boundary: `src-tauri/vendor/nomifun/`
- Existing Tauri command: `edupi_computer_use`
- Desktop native boundary: `lib/desktop-native.ts`, Tauri capabilities/permissions
- Core/Desktop contract tasks: Core Task 16 and Desktop Tasks 12C9/12E9/12

**Steps:**

1. Audit the already-vendored NomiFun Computer Use action/API parity and record missing actions.
2. Add Core preview, approve, stop, claim, and final result fixtures.
3. Pin action commands only after native invocation and stop-race tests pass.
4. Show a concise preview and result; do not expose raw tokens or chain of thought.
5. Prove emergency stop, crash/lost-result recovery, and restart.

Acceptance: EduPi can perform one approved local action, show exactly what happened, and stop safely; arbitrary action execution remains impossible.

## Task 11: Open-source platform adoption and attribution closure

**Files:**

- `docs/THIRD_PARTY_UI_REFERENCES.md`
- `docs/EDUPI_WORKSPACE_PRESENTATION_DECISION.md`
- `src-tauri/resources/third-party/`
- relevant vendor manifests and source headers

**Rules and steps:**

1. NomiFun is Apache-2.0. Its ContentSider adaptation and Computer Use crates already exist; complete API parity tests, NOTICE/SOURCE packaging, and update tracking before claiming a port.
2. Harnss is MIT. Run a bounded ACP/runtime proof for any backend lifecycle we intend to adopt; port server APIs, persistence, and lifecycle together or keep it a reference.
3. TabTin is AGPL-3.0-only. Attribution alone is not sufficient for direct code copying. Continue independently authored interaction patterns unless the combined distribution complies with AGPL or a separate commercial license is obtained.
4. Maintain a feature/API parity table: upstream feature, EduPi mapping, backend endpoint, persistence owner, tests, attribution, and status.

Acceptance: no document claims a full migration unless its backend, persistence, runtime lifecycle, tests, and shipped attribution are all present.

## Task 12: Eliminate dead interactions and explanatory UI as a continuous gate

**Files:** every touched vertical-slice component plus:

- `components/EduPiStaticInteractions.test.mjs`
- `components/EduPiEducationPanel.test.mjs`
- `app/globals.css`

For every slice:

1. Enumerate buttons/rows/tabs/disclosures in the changed view.
2. Add a failing interaction test for every new control.
3. Remove duplicate headings, internal codes, and paragraphs that do not help the teacher decide or act.
4. Verify keyboard, narrow viewport, loading, failure, empty, and restart states.
5. Preserve Chat-first navigation and Notion-like content density.

Acceptance: no visible control is inert; every empty state states the next useful action in one short sentence or less.

## Task 13: Bundle, sign, and release the reviewed Core/Desktop pair

**Files:** Follow Desktop Tasks 16A–16C and existing release workflows.

1. Bundle only the reviewed Core runtime closure and exact component manifest.
2. Pass Core/data/Desktop-state roots through the packaged launcher.
3. Verify signed wrapper, bundle hash, source commit, rollback component, and no private data in resources.
4. Run macOS, Linux, and Windows package gates without using `next build` during dev.
5. Publish only after all platform artifacts and rollback evidence exist.

Acceptance: a fresh install opens Chat and teacher workspaces, reads the same Core data, survives restart, and can roll back to the prior signed component.

## 3. Verification commands used at every checkpoint

Desktop minimum:

```bash
npm test
node_modules/.bin/tsc --noEmit
npm run lint
git diff --check
```

Paired C1/C2+ minimum:

```bash
EDUPI_CORE_ROOT=<pinned-runtime> npm run test:edupi-c1-e2
curl -fsS http://127.0.0.1:30141/api/edupi/status
```

Core minimum:

```bash
npm test
npm run typecheck
npm run test:storage-contract
npm run audit:contracts
git diff --check
```

Do not run suites concurrently when they inspect real-home immutability. Do not run `next build` during development.

## 4. Commit and PR discipline

Each task uses this sequence:

1. RED test commit only when it is useful durable evidence.
2. Minimal implementation commit.
3. Fresh Sol review and correction commit if needed.
4. Evidence/document commit.
5. Push paired branches and update both PR bodies.
6. Append the shared ledger; set one exact `next_entry_point`.

Never mix multiple capability enablements in one manifest commit. Rollback is the prior pin plus disabled controls, never a Desktop fallback store.

## 5. Immediate execution pointer

Resume with **Task 4: Make Today the proactive teacher work surface (C3)**. C2 is complete at its deterministic E2 gate; do not infer provider-backed or real-user evidence from this checkpoint. After C3, honor the already recorded priority for C6 file/image intake.

The earlier Task 1 pointer and its starting gate are closed by the C1-V entry below; preserve them as historical evidence, not as the current resume pointer. Before C3, re-read the current pinned pair and the shared ledger.

## 6. Execution update — C1-V passed (2026-08-28)

Task 1, the isolated visible C1 acceptance workspace, is complete and passed the C1 E2 gate. The user's explicit `界面认可` is recorded as `teacher_decision=accepted`; this accepts the visible interface loop only and does not claim E4/E5 or broad teacher-content usefulness.

- Evidence: isolated `30142` ran 8 observations and 8 candidates through 17 receipt/history outcomes (accept 11, modify 2, reject 2, hold 2), with 6 active memories; final harness 15/15; Desktop 545 passed / 13 skipped / 0 failed; cleanup left production `30141` ready and unchanged.
- Contract: v1.1, exactly `review_observation` and `review_memory_candidate`, Core `teacher_review_state` only, `external_send=false`.
- Next entry: **Task 2 — Connect Chat messages to C1 capture and live queue refresh**. The next slice must bind a real Chat message to the source/provenance record and update `待我确认` without a manual refresh, then record its own evidence checkpoint.

## 7. Execution update — Task 2 complete; Task 3 C2 in progress (2026-08-28)

Task 2, Chat source-bound capture and no-refresh queue refresh, is complete. The Desktop implementation is commit `8bc3c448516d5523c16773e9b8c0973a89645098`, pushed to internal archive PR [#11](https://github.com/PIGU-PPPgu/edupi-desktop-internal/pull/11) branch `codex/c1-visible-loop`.

- Normal Chat completion increments the existing education refresh key. Established Chat/workspace remains mounted during background loading and errors, retry remains visible, and no second event bus, remount, auto-send, or Desktop education writer was added.
- Corrected isolated E2 uses outer session entry ID `chat-entry-c1-e2`; a real Pi `UserMessage` has no ID. Fresh perception registration replays against the same isolated store and yields exactly 1 observation, 1 candidate, 0 memories, pending review, matching provenance, `external_send=false`, and no legacy write. No provider-backed live Chat message was run.
- Evidence: targeted 15/15; full Desktop 547 passed / 13 skipped / 0 failed; typecheck, targeted lint, Node check, and `git diff --check` passed. Final fresh Sol/Max verdict was `ship` after one fix-first cycle.
- Production `30141` remained Core/projection ready and unchanged at 5 students, 28 calendar entries, and 30 tasks. Residual Chat lifecycle risk is low per final review, but coverage is mainly structural/state tests rather than a real browser mount-counter E2.

The C2 commitment review is `proceed` with this frozen v1.1 boundary:

- Context owns only `name|role|subject|grade|class_name`.
- Preferences from the same Chat source become separately reviewable C1 `preferences` candidates.
- Context and preferences have independent decisions, receipts, idempotency, and restart/replay evidence.
- Do not introduce v1.2 or a Desktop JSON fallback; richer fields are deferred.

The immediate execution pointer is now **Task 3 — Complete C2 teacher context through Chat and receipts**.

## 8. Execution update — C2 paired checkpoint complete (2026-08-28)

Task 3, the Chat-guided teacher-context proposal and receipt-backed review loop, is complete at the deterministic paired E2 gate.

- Core runtime/implementation pin: `88e3865f88fde16b1770195388ebb94ac71ceb5f`; C2 commits `83adb9d` (Core context store) and `88e3865` (capability/fixture publication).
- Desktop C2 implementation head: `ec19c53`; C2 commits `8232c23` (consumer/pin), `be4ccec` (property sheet/persistent Chat host), `0ea68b5` (wrapped receipt/stale fix), and `ec19c53` (paired E2).
- Contract: v1.1; schema hash `sha256:ae478e2025b41372b0b3ccd44663b3ebd451b50b1a8c7bca4f306e07c3e1da3a`; component manifest `sha256:fdc64663b0767e9309073b303b9dfc0fc760c8d8e01ab75699d4026f182cbe2b`; fixture manifest `sha256:47551e7a5955b1730754464086ef495c0e1e710330209de14402fe04fbfff0c9`.
- Capability: exactly `review_observation`, `review_memory_candidate`, `review_teacher_context`; projection `education_workspace`; `external_send=false`.
- E2 result: one stable five-field teacher-context target, one separate C1 `preferences` candidate, four context receipts/history entries for accept/hold/reject/modify, idempotent replay, restart/reload, stale snapshot/revision no-write, genuine fixed-child stale-revision receipt, one canonical `teacher_review_state`, and no legacy/auth/model writes.
- Teacher decision: accepted visible C2 interface via `界面认可。继续后面`. This is deterministic synthetic evidence plus visible interface acceptance; it does not claim E4/E5, provider-backed real Chat, real user-context mutation, or general teacher-content usefulness.
- Live production `30141` remained ready with 5 students, 28 calendar items, and 30 tasks; no production data was mutated. The historical C3.1 provider image attempt remains `evidence_pending`.
- Verification: focused teacher-context client 6/6; C2/C1/Chat E2 green; Desktop `npm test` 570 passed / 13 skipped / 0 failed; typecheck, lint, and `git diff --check` passed.
- Review: final Fresh Sol/Max verdict was `ship` after one fix-first wrapper-bypass finding was closed.

The current resume pointer is **Task 4 — Make Today the proactive teacher work surface (C3)**. After C3, continue with the already prioritized C6 file/image intake. Keep the exact C2 pins above and do not infer provider-backed or real-user evidence from this checkpoint.

## 9. Execution update — C3 Today paired checkpoint complete (2026-08-28)

Task 4, the Core-owned Today work-candidate policy/store, pinned Desktop projection/API, and visible Today review surface, is complete at the deterministic paired E2 gate.

- Core runtime/implementation pin: `52a8badf7ff72dde54fc1b75360e003aef734b2e`; C3 commits `519adc4`, `513b109`, and `52a8bad`.
- Desktop C3 implementation head: `6b215b0`; C3 commits `85520e2` (projection pin), `c45dfc4` (receipt API), `645a747` (Today product surface), and `6b215b0` (paired E2).
- Contract: v1.1; schema hash `sha256:ae478e2025b41372b0b3ccd44663b3ebd451b50b1a8c7bca4f306e07c3e1da3a`; component manifest `sha256:ec09ecea1d680ebe1080dfd5361a451e81a18e916e98e69e6398ae1a1e11f7b0`; fixture manifest `sha256:67fd627f9de27e3fce454a9b5177f3759057e56a7e5ae5a161d451f5c08fb6a8`.
- Capability: exactly `review_observation`, `review_memory_candidate`, `review_teacher_context`, and `review_work_candidate`; projection `education_workspace`; `external_send=false`.
- Core owns work candidates, suppression policies, decisions, lifecycle, receipts/history, and the canonical `teacher_review_state`. Desktop owns only validated projection, request initiation, and UI-local editor/lock state; no Desktop canonical writer or fallback exists.
- Today behavior: `现在 / 稍后 / 已完成`; accept, modify, reject, hold, snooze, and suppress; source/reason/evidence/next-cycle context; missing-date system-held candidates remain held without inference; receipts are accepted before refreshed projection; the remount-safe module lock and Chat subtree remain unchanged.
- Deterministic C3 E2: 8 calendar inputs produced 9 work candidates; 7 review receipts/history entries covered six decision kinds and two suppression scopes; matching-reason peer suppression, snooze expiry, next-cycle release, exact-envelope replay, fixed-child restart reads, stale snapshot/revision no-write, output allowlist, `proactive_entries=[]`, and `external_send=false` all passed.
- Final Desktop verification: `npm test` 593 passed / 13 skipped / 0 failed (606 total, 6 suites); C1/C2/Chat/C3 exact-Core E2 checks, typecheck, lint, and `git diff --check` passed. Final Fresh Sol/Max verdict: `ship` after one UI fix-first cycle.
- Live browser evidence: local `30141` rendered 2 pending candidates from the user's existing calendar after an explicit 30-day preview heartbeat; six actions and modify/snooze/suppress editors were visible and keyboard-labelled at 390/768/1440, with no console error/warn or horizontal overflow. No live teacher decision or receipt was applied; `proactive_entries=[]`. This is live projection/editor smoke plus deterministic E2, not E4/E5 or a general usefulness claim.
- Live state was changed by the explicit preview heartbeat only: it wrote the derived rhythm plan with 5 tasks and canonical work-candidate state with 2 pending candidates. No live review decision or receipt, proactive send, or external action occurred; `teacher_decision=not_run` for final C3 candidate/review usefulness. The user's approval was to continue work, not to accept a live C3 decision.
- Historical C3.1 schedule/provider image evidence remains `evidence_pending` and is not rewritten or promoted here.

The new exact resume pointer is **Task 5 — Build safe file/image staging before any import command**, immediately followed by prioritized **Task 6 — Deliver image/PDF/Word to pending day/week/month calendar (C6)**. Preserve the C3 pins above, do not repeat C3, and do not infer live six-decision execution, provider-backed image intake, external delivery, E4/E5, or general usefulness.
