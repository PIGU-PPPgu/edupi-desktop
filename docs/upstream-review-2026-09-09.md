# Desktop upstream conflict resolution

Reviewed upstream: `abcwyc/pi-agent-desktop@378db4dc27e4d345c12a74c78f4340bbbc47ce24`.

The scheduled review failed while merging this commit into EduPi main. This candidate resolves the conflicting changes while retaining EduPi's product and release boundaries.

## Integrated

- Model discovery pagination and proxy-compatible endpoint handling, retaining EduPi request checks.
- Model scope warnings that distinguish missing authentication from an unmatched pattern.
- CJK autolink handling, session-reference resolution, and split/unified edit diff settings.
- Cross-project session selection keeps the clicked conversation selected.
- HTML file preview behavior retains source-root checks and CSP.

## Retained or deferred

- Keep EduPi sidebar/file-panel layout, native theme, dictation, native attachment selection and extension status. Do not adopt upstream's project-tree/right-panel redesign, unused panels, or its screenshot artifact.
- Keep EduPi desktop version `0.3.6`, Pi SDK `0.84.1`, release destinations, permissions and hardened cache cleanup. Upstream equivalent clipboard/permission fixes were already adapted. Remove duplicate usage-description keys introduced by the automatic plist merge.
- Keep `.github/workflows` byte-identical to trusted main. No upstream release or push workflow is imported.
- Defer the upstream model-config key-redaction patch: without coordinated credential identity changes it breaks model discovery/testing and loses literal keys on provider rename. Existing protected configuration editing is retained; this candidate does not claim that legitimate configuration clients can no longer read stored literal keys.
- Fix the upstream-review test's assumption that reviewedCommit is always null. Both the initial null state and valid pinned SHA remain tested; repository/branch validation remains enforced.

## Dependency audit

Next and eslint-config-next are aligned at `16.3.4`. Only affected dependency chains were refreshed, including sharp, js-yaml, humanfs, colord, query-string/decode-uri-component and xmldom. Pi SDK remains pinned. `npm audit --audit-level=high` reports no vulnerabilities locally.

PR #72 receives its separate dependency-only fix; this merge candidate is based on main and does not include that PR's unfinished teaching work.

## Verification

Final local gate: `npm test` passed 949 tests with 18 existing environment-dependent skips; TypeScript, lint/branding, release-destination checks and dependency audit passed. Session-reference sends additionally have single-flight, cancellation, draft/session identity checks and a 15-second deadline, with deferred-request callback regressions.

Rust unit tests passed 20/20 with packaging resources disabled for the clean development worktree, plus 5/5 without default features; this is not an installer build. Formatting checks expose pre-existing formatting in unchanged Rust/vendor files; no unrelated formatting rewrite was made. Remote CI results are recorded in the review PR.

No signing, release dispatch, upstream repository push, or change to the running application was performed. The candidate remains a review branch until reviewed and merged through the repository's normal process.
