// Adapted from QM scope helpers at b384c6548eb07d6531a26295367fdf9e8be4636a.
// This first slice represents only the truthful local teacher boundary.
export type HarnessScopeKind = "teacher_internal";

export interface HarnessScope {
  kind: HarnessScopeKind;
  id: "teacher:local";
}

const LOCAL_TEACHER_SCOPE: HarnessScope = Object.freeze({
  kind: "teacher_internal",
  id: "teacher:local",
});

export function teacherInternalScope(): HarnessScope {
  return LOCAL_TEACHER_SCOPE;
}
