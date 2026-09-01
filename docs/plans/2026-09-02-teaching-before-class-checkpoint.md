# 2026-09-02 Teaching Before-Class checkpoint

## Core Teaching Before-Class v1

- Core PR [#16](https://github.com/PIGU-PPPgu/edupi/pull/16) derives one stable `teaching_before_class` task for every real timetable occurrence across the academic calendar.
- 吴老师的 703 数学课表 produces six weekly lesson occurrences. Every occurrence carries its real class date, a one-day-ahead preparation deadline, teaching priorities, class evidence, material candidates and four required preparation outputs.
- The four outputs are `本节教学重点核对`, `班级学情与易错点`, `材料准备清单`, and `课堂策略草稿`.
- Model-unavailable execution remains visible and retryable. Replays keep the same task, work-case and artifact identities; `external_send=false`.

Pinned Core:

```text
commit: 6e806f4e0af4232d95aa7353ed7a46cea4c7032a
schema: sha256:30d10113b6c7e7b2d3ad4eb54e34d47e8d03e848e9fbbabd1c81cf5db36727df
fixture manifest: sha256:2143fe0c4ab271d251134f137304c9dbef0a1b33517d8e8159c8adfb6dcb43c4
component manifest: sha256:03b5944d14312508141b6cbb3868828c95601f88c6f9ff2d6066e16d14bc5130
```

## Desktop Teaching Before-Class v1

- 教学首页 now projects the current week's six real lessons as compact preparation rows instead of creating a timetable-only demo.
- The next-lesson action opens the existing Core task and shared five-stage workflow. Teaching priorities and class evidence are compressed for scanning; the full evidence remains in the evidence stage.
- Teaching tasks and task details use the same Core `work_case` state. A lesson page distinguishes `上课` from the earlier `截止` date, so an ungenerated task cannot appear as ready for teacher review.
- The task list, timetable, preparation row and shared task workflow all resolve the same stable Core task identity. Desktop adds no preparation store and never fabricates completion or motion.
- An empty artifact stage is visibly waiting and cannot enter teacher review until a real artifact exists.

## Production-data result

```text
rhythm plan tasks before / after             30 / 161
teaching_before_class tasks                  126 (21 weeks × 6 periods)
current-week lesson preparations             6
current Core work candidates                 7
workspace API                                200; 126 teaching tasks and 126 teaching work cases
```

The production rhythm sync created automatic `.bak` files for `rhythm_plan.json` and `teacher_review_state.json`. It did not call a model or send externally. Actual provider-backed teaching artifacts therefore remain ungenerated until the normal preparation heartbeat runs with a configured model.

## Evidence

```text
Core npm test / typecheck / contracts / bridge             passed
Desktop npm test                                             837 passed, 13 skipped, 0 failed
Desktop typecheck / lint / diff check                        passed
paired teaching-before-class E2                              6 periods; 6 work cases; 4 ready cases
paired teaching artifacts                                   4 per ready case; replay stable
paired living-flow, C2 and C3 E2                             passed
browser teaching home                                       six dated rows with priorities and class evidence
browser task flow                                            same task; class/deadline; five stages; Core state
external_send                                                false
```

Evidence level is deterministic paired E2 plus production projection and browser interaction. It does not claim a real provider artifact, teacher acceptance, external delivery, E4 or E5.

## Rollback

- Revert the paired Core/Desktop PRs and restore the two production `.bak` files if the expanded rhythm plan must be rolled back.
- Because Desktop is projection-only, reverting the Desktop PR removes the view without migrating or deleting Core truth.

## Next

Continue with **E4 — 课后口述到教学记忆**: one short teacher voice/text reflection must attach to the just-finished lesson, update bounded teaching memory and inform the next preparation cycle without automatic external send.
