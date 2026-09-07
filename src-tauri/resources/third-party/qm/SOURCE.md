# QM source attribution

- Project: `yc-software/qm`
- Source: https://github.com/yc-software/qm
- Revision: `b384c6548eb07d6531a26295367fdf9e8be4636a`
- License: MIT (`LICENSE` in this directory)

EduPi Desktop adapted the structural ideas in these QM files:

- `src/harness/harness.ts`: adapter profile, bound implementation, and separated adapter surfaces.
- `src/harness/harness-router.ts`: registered adapter lookup, default selection, and unavailable-adapter rejection.
- `src/harness/pi-harness.ts`: Pi profile and transparent delegation to the existing Pi runtime.
- `src/types.ts`: explicit scope value helpers.

The adapted EduPi files are `lib/harness/harness.ts`, `lib/harness/harness-router.ts`,
`lib/harness/pi-harness.ts`, and `lib/harness/scope.ts`. EduPi did not copy QM's
Postgres/session store, cloud `runTurn`, tool/security closure, or multi-harness runtime.
