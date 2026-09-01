# 2026-09-02 Living Flow checkpoint

## Core Flow Contract v1

- Core PR #14 projects calendar-triggered tasks as stable `work_case` objects.
- Core PR #15 closes the real teacher-review rollback → `planned` transition found in production data.
- Flow state is derived from existing task, execution, artifact and teacher-review truth; no second flow store was added.
- Transition history is bounded to 50 visible rows while `transition_revision` and sequence continue monotonically.
- A source-semantic mismatch cannot promote an old execution or artifact as current; stale history remains inspectable.

Pinned Core:

```text
commit: 5d546d04744055de3fcd2bf00e140899915781ef
schema: sha256:8eeda480da6c78a37e60f0445f55cfdd4c1f676c8d8149da55c30b73edb5c220
fixture manifest: sha256:61f56ea759600b4c48ed2b3439e85787f736840d69b8ccb04698a7acc0fd2a3f
component manifest: sha256:d61f8180fdd28312f5581446b075963497a4ba8269a8dabe09b155b4bd60128f
```

## Desktop Living Flow v1

- Desktop strictly validates and normalizes `work_cases`; ghosts, duplicate task identities and broken transition order fail the whole optional projection closed.
- Today has a compact state-driven flow strip when Core has queued/running/draft-ready/failed work.
- Workspace cards use Core work case state while preserving Core task-board overrides.
- Board, calendar and Today open the existing shared task drawer; the drawer shows the same Core transition timeline.
- Only queued/running states animate. No timer or random client state creates flow, and reduced-motion disables animation.

## Evidence

```text
Core npm test / typecheck / bridge port / contracts        passed
Core production-data snapshot after rollback fix           ok:true, 32 work cases
Desktop npm test                                            821 passed, 13 skipped, 0 failed
Desktop typecheck / lint / diff check                       passed
paired living-flow E2                                       stable replay + source change + external_send=false
C2 and C3 paired E2                                         GREEN
live /api/edupi/workspace                                   200, 32 work cases
browser                                                     board state visible; shared drawer shows EduPi 流
```

## Next

Continue with PR C / Teaching Before-Class v1 using 吴老师’s six weekly 703 mathematics periods as the real timetable benchmark.
