# Desktop upstream synchronization

EduPi Desktop keeps three repository roles separate:

| Role | Repository | Allowed use |
| --- | --- | --- |
| EduPi source | `PIGU-PPPgu/edupi-desktop` | Checkout base, review PRs, and reviewed source history |
| Public releases | `PIGU-PPPgu/edupi-releases` | Signed installers, updater metadata, and component manifests |
| Desktop upstream | `abcwyc/pi-agent-desktop` | Read-only change detection, merge input, license, and attribution |

`abcwyc/pi-agent-desktop` is not an EduPi source, download, updater, signing, or release destination.

## Automated path

[`desktop-upstream-sync.yml`](../.github/workflows/desktop-upstream-sync.yml) runs daily and can also be started manually.

1. `detect` checks out protected EduPi `main` with persisted credentials disabled. With `contents: read`, it adds `abcwyc/pi-agent-desktop` as `upstream-desktop`, fetches upstream `main`, and compares both ancestry and the reviewed commit in `scripts/desktop-upstream-state.json`. If that commit was already reviewed—even through a squash or rebase merge—the workflow records "no changes" and stops without a branch or PR write. A rewritten upstream history fails closed.
2. `prepare` has read-only source and PR permissions and does not persist the checkout credential. A token-scoped Git command reads only a `main`-targeted managed PR branch before upstream code is present, then the workflow starts from that open `sync/upstream-desktop` branch when one exists, otherwise from protected `main`. Later merge and test steps receive no repository token.
3. After the merge, `.github/workflows` is restored exactly from protected `main` and the reviewed upstream SHA is recorded. Public-upstream workflow changes are never put on the pushed ref: otherwise an upstream `on: push` workflow could run with repository secrets before review. Relevant CI changes must be ported separately from a trusted branch.
4. The candidate must pass `npm test`, `tsc --noEmit`, `npm run lint`, and `node scripts/verify-release-destinations.mjs`. A conflict, workflow-tree difference, dirty tree, or failed gate stops before any push.
5. The tested commit is transferred as a short-lived Git bundle. Only `publish-review` receives source/PR write permission; that job re-verifies the candidate SHA, ancestry, and exact protected-main workflow tree, pushes only `sync/upstream-desktop` with an exact `--force-with-lease`, and creates or edits a PR whose base is `main`.

The fixed branch, base-qualified PR lookup, and reviewed-SHA marker make repeated runs idempotent. When reviewers add non-workflow commits to an open managed branch, the next run starts from that branch instead of discarding their work. The force-with-lease rejects a concurrent branch change rather than overwriting it.

## Hard exclusions

The workflow does not have release or signing secrets and must never:

- push directly to `main`;
- push to `abcwyc/pi-agent-desktop`;
- sign or build a release artifact;
- create, edit, upload, or publish a GitHub Release;
- dispatch `release.yml` or any other release workflow;
- reference `EDUPI_RELEASE_TOKEN`, Tauri signing keys, or updater signing keys.

Release-destination sentinels guard the signed-release workflow, Tauri updater endpoint, component manifest, version resolution, update checks, and application repository link. If an upstream merge restores `abcwyc/pi-agent-desktop` as an active update or release target, the candidate fails before it can be pushed.

## Human review

Passing automation proves only that the candidate is build-time consistent with the current test and destination contracts. Before merging the PR, reviewers still check:

- EduPi teacher workflows and safety boundaries;
- branding, repository links, and update UI;
- Tauri capabilities and desktop permissions;
- source and public-release separation;
- upstream license and attribution changes;
- any useful upstream CI change, ported separately without copying an unreviewed workflow onto the sync branch;
- every conflict resolution and any unexpected file deletion.

Merge conflicts deliberately fail closed. Resolve them on the managed review branch, rerun the complete gate, and keep the result in the same PR. Merging the PR still does not publish an installer; signed release remains a separate, manual workflow described in [Desktop updates and releases](./desktop-updates.md).

## Rollback

Before merge, close the PR and delete `sync/upstream-desktop`; protected `main` and public releases are unchanged. After merge, revert the reviewed merge through a new PR. Never repair a bad sync by force-pushing `main` or by publishing an unsigned replacement.
