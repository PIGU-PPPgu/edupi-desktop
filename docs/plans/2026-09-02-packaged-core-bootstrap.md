# 2026-09-02 Packaged Core Bootstrap

## Goal

Make EduPi Desktop launch from Finder/Start Menu without `EDUPI_*` environment variables. The packaged server receives a managed or persisted canonical data root and a copied, exact Core runtime closure.

## Observed failure and evidence

- The previous `0.3.0` packaged startup could abort with `SIGABRT` before the user selected a workspace because Rust required `EDUPI_PROJECT_ROOT` and the server had no bundled Core.
- The installed `0.3.0` Desktop pinned Core `5538021f171a647d87562d91e5ab953f794e2331`; the immediately preceding Desktop source pinned `6e806f4e0af4232d95aa7353ed7a46cea4c7032a` before the paired Core PR #17.
- The paired Core runtime is now `673db19d8fc2a1e34b858e2c3d17f7935862b07c` with component manifest `sha256:d9500f266ed92052798ffc072648d635c3dfb5b673cf2affe35e13506914eed0`; its closure contains Proactive Work Kernel, Scoped Education Memory, and Typebox `1.3.8`.

## Root and bundle contract

- Core: `EDUPI_CORE_ROOT` is an explicit developer override and validates as `external`; otherwise `resources/edupi-core` is used and validates as `bundled`. The resolver never infers the mode from a path.
- Data: `EDUPI_DATA_ROOT`, then legacy `EDUPI_PROJECT_ROOT` / `EDUPI_WORKSPACE`, then persisted `edupiDataRoot`, then `app_data_dir()/edupi-data`. Managed roots create `.edupi/memory`, `.edupi/output`, and `.edupi/locks`.
- Settings can select one existing, canonical, non-root, non-symlink directory. Only `edupiDataRoot` is changed; the app relaunches before the new root becomes canonical for the running server. Reset removes only that key.
- `resources/edupi-core` is generated from the pinned Core checkout. Only manifest-listed modules, assets, runtime dependency files, and the fixture manifest are copied; the destination is revalidated without Git.

## Rollback

1. Revert the Desktop pin and bundle-preparation change as one paired change.
2. For a user-selected data root, use “使用默认目录” / “Use default directory”; this removes only `edupiDataRoot` and relaunches into the managed root.
3. Do not delete a user's selected data directory; it remains the canonical dataset and can be selected again.

## Verification record

- `EDUPI_CORE_ROOT=<core-checkout> node --test lib/edupi-core-root.test.mjs lib/edupi-core-snapshot.test.mjs scripts/packaged-core-bundle.test.mjs scripts/edupi-launch-roots.test.mjs scripts/desktop-platform.test.mjs scripts/release-workflows.test.mjs` — passed (51 passed, 1 skipped).
- `EDUPI_CORE_ROOT=<core-checkout> npm run desktop:prepare` — passed; generated Core bundle contains 1,386 files.
- Bundled Core health and temporary-data snapshot — passed without `.git` and without Desktop `node_modules` resolution.
- `node_modules/.bin/tsc --noEmit`, `npm run lint`, and `git diff --check` — passed.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib` — passed (18 tests, including persisted-root fallback and startup preference-preservation regressions); a clean checkout must run `desktop:prepare` before Tauri resource validation because the generated Core directory is ignored.
- Local Apple Silicon DMG `0.3.1` built successfully and was installed with a recoverable `/Applications/EduPi 0.3.0 Backup.app` copy.
- Finder/LaunchServices cold start with every `EDUPI_*` launch variable unset produced no new crash report. The bundled server returned Core/projection `ready` with the then-current packaged component manifest; each later Core checkpoint must repeat this packaged launch verification.
- Managed-root first launch opened on `~/Library/Application Support/com.abcwyc.pi-agent/edupi-data` with an empty valid projection. Persisted-root cold restart against `<teacher-data-root>` then projected 吴老师 / 数学 / 七年级, 5 students, 6 timetable periods, 29 calendar nodes, 183 tasks, and 126 `teaching_before_class` tasks.

## Remaining evidence

Signed release artifacts, Windows clean-machine installation/first launch, native-dialog selection automation, signed update continuity, and uninstall remain release acceptance evidence. The existing release and Windows-debug workflows now fetch the exact Core commit and pass its absolute root to every `desktop:prepare`.
