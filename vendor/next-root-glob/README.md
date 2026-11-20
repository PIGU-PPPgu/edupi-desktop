# Next root-directory matching

Temporary dev-only replacement for the single `fast-glob.globSync(string,
{ onlyDirectories: true })` call in `@next/eslint-plugin-next@16.4.6`.
All Next lint rules remain enabled. This is not a general fast-glob replacement.

`braces@3.0.3` has no published fix for
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
The scoped npm override removes its dependency chain instead of ignoring the
advisory. Patched `brace-expansion` preserves numeric/stepped root globs;
Official `glob@14.0.6` matches paths; directory markers select only directories
without implicitly expanding a matched directory. This also removes the
picomatch dependency affected by `GHSA-fc5q-39xc-vjpf`; no advisory is ignored.

References:

- [Next caller](https://github.com/vercel/next.js/blob/v16.4.6/packages/eslint-plugin-next/src/utils/get-root-dirs.ts)
- [glob options](https://github.com/isaacs/node-glob#options)

Remove this package and its override once a stable Next lint plugin no longer
requires vulnerable braces. Recheck by 2026-12-18. Regression coverage lives in
`scripts/dependency-security.test.mjs` and exercises the real Next rule.
