# @edupi/lint-project-glob

Private, MIT-licensed adapter, version **1.0.0**. This is a dev-only project
discovery dependency for two pinned ESLint consumers:

- `@typescript-eslint/typescript-estree@8.57.1`,
  `dist/parseSettings/resolveProjectList.js`.
- `eslint-import-resolver-typescript@3.10.1`, `lib/index.cjs` and its ESM
  equivalent.

The repository installs this package under the `tinyglobby` dependency name
through a root override. The package's actual name and version remain
`@edupi/lint-project-glob@1.0.0`; it does not claim to be an upstream tinyglobby
or picomatch release. It is not a general tinyglobby replacement.

## API boundary

Both CommonJS and ESM export exactly `globSync` and `isDynamicPattern`.

`globSync(patterns, options?)` accepts a string or an array of strings and only
these options:

| Option | Supported meaning |
| --- | --- |
| `cwd` | Working directory path or `file:` URL; defaults to `process.cwd()`. |
| `absolute` | Boolean, default `false`; otherwise results are relative to `cwd`, including for absolute input patterns. |
| `dot` | Boolean, default `false`; the resolver supplies `true`. |
| `expandDirectories` | Boolean, default `true`; matching directories include descendant files. With `false`, directories produce no results. |
| `ignore` | String or array of exclusion patterns; matching entries and their subtrees are omitted. |

Results contain files, never directories. Matching is case-sensitive, matching
the consumers' existing tinyglobby default. Empty pattern arrays return `[]`.
Input arrays and options are not modified. Results are deduplicated by glob;
traversal order is not an API guarantee.

A leading `!` in a pattern excludes that pattern and its subtree independently
of array order. `!(...)` remains a negative extglob, not an array exclusion.
Exclusions do not re-include previous matches; `ignore` has no reinclusion
language. Directory expansion adds `/**` to positive patterns. Subtree
exclusion adds `/**` to ignore and negative patterns. Brace expansion, extglobs,
globstars, dot handling, filesystem traversal and matching all run through
official `glob@14.0.6`; extglobs are enabled.

`isDynamicPattern(pattern, options?)` accepts one string and only the optional
boolean `caseSensitiveMatch`. It uses `glob.hasMagic` with
`magicalBraces: true` and `nocase` when requested. Leading negative patterns
are dynamic. Literal/unfinished parentheses and unfinished brace syntax follow
glob's classification, not tinyglobby's broader heuristic.

Unknown options, invalid argument types and the old options-only overload
throw `TypeError`. There is no asynchronous `glob`, iterator, stream,
`convertPathToPattern`, `escapePath`, custom filesystem, cancellation option,
directory-only mode or configurable matcher syntax. Adding a consumer or
upgrading either pinned consumer requires reviewing its calls and extending
the behavior tests before changing this boundary.

## Upstream sources and retirement

The matcher is an ordinary dependency on the published package
[`glob@14.0.6`](https://www.npmjs.com/package/glob/v/14.0.6), from
[`isaacs/node-glob`](https://github.com/isaacs/node-glob). Its installed README
documents `globSync`, `hasMagic`, `magicalBraces`, `nodir`, `follow`, `ignore`
and extglob support. Glob retains its own upstream license; this repository's
adapter is independently MIT licensed. No tinyglobby or picomatch source is
vendored here.

The two consumer sources are
[`typescript-estree`](https://github.com/typescript-eslint/typescript-eslint/tree/v8.57.1/packages/typescript-estree/src/parseSettings)
and
[`eslint-import-resolver-typescript`](https://github.com/import-js/eslint-import-resolver-typescript/tree/v3.10.1).
The tests execute their installed implementations against temporary projects,
including parser project ordering and resolver include/exclude paths.

Remove the root override, this package and its dedicated tests once upstream
consumers use an audited dependency chain without the vulnerable picomatch
path, and the same real-consumer tests pass with that replacement. Do not
silently grow this adapter to accommodate unrelated tinyglobby users.

Run from the repository root:

```sh
node --test scripts/lint-project-glob.test.mjs
```
