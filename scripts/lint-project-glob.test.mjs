import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { globSync, isDynamicPattern } from "../vendor/lint-project-glob/index.mjs";

const require = createRequire(import.meta.url);
const adapterPath = require.resolve("../vendor/lint-project-glob/index.cjs");
const estreeRequire = createRequire(require.resolve("@typescript-eslint/typescript-estree"));
const { resolveProjectList, clearGlobResolutionCache } = estreeRequire("./parseSettings/resolveProjectList.js");
const nextRequire = createRequire(require.resolve("eslint-config-next"));
const resolverPath = nextRequire.resolve("eslint-import-resolver-typescript");
const sorted = values => [...values].sort();

async function tree(t, files) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "edupi-lint-project-glob-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [name, contents] of Object.entries(files)) {
    const filename = path.join(root, name);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, typeof contents === "string" ? contents : JSON.stringify(contents));
  }
  return root;
}

test("the named adapter exposes only its two synchronous APIs through CJS and ESM", async () => {
  const common = require(adapterPath);
  const esm = await import("../vendor/lint-project-glob/index.mjs");
  assert.deepEqual(Object.keys(common).sort(), ["globSync", "isDynamicPattern"]);
  assert.deepEqual(Object.keys(esm).sort(), ["globSync", "isDynamicPattern"]);
  assert.equal(common.globSync, esm.globSync);
  assert.equal(common.isDynamicPattern, esm.isDynamicPattern);
  const manifest = JSON.parse(await readFile(new URL("../vendor/lint-project-glob/package.json", import.meta.url), "utf8"));
  assert.equal(manifest.name, "@edupi/lint-project-glob");
  assert.equal(manifest.version, "1.0.0");
  assert.equal(manifest.license, "MIT");
});

test("default file discovery expands literal and dynamic directories but not static files", async t => {
  const cwd = await tree(t, {
    "src/main.ts": "",
    "src/nested/helper.ts": "",
    "src/.hidden.ts": "",
    "src-not-a-directory": "",
    "notes.txt": "",
  });
  assert.deepEqual(sorted(globSync("src", { cwd })), ["src/main.ts", "src/nested/helper.ts"]);
  assert.deepEqual(sorted(globSync("sr*", { cwd })), ["src-not-a-directory", "src/main.ts", "src/nested/helper.ts"]);
  assert.deepEqual(globSync("src", { cwd, expandDirectories: false }), []);
  assert.deepEqual(globSync("notes.txt", { cwd }), ["notes.txt"]);
  assert.deepEqual(globSync("src-not-a-directory", { cwd }), ["src-not-a-directory"]);
  assert.deepEqual(globSync("missing", { cwd }), []);
  assert.deepEqual(globSync([], { cwd }), []);
  assert.deepEqual(globSync("", { cwd }), []);
});

test("string and array ignores exclude whole subtrees, including directory patterns", async t => {
  const cwd = await tree(t, {
    "src/main.ts": "",
    "src/skip/inner/a.ts": "",
    "src/.skip/inner/a.ts": "",
    "src/node_modules/deep/a.ts": "",
  });
  assert.deepEqual(globSync("src", { cwd, dot: true, ignore: ["src/skip", "src/.skip", "**/node_modules/**"] }), ["src/main.ts"]);
  assert.deepEqual(globSync("src/skip", { cwd, ignore: "src/skip" }), []);
  assert.deepEqual(globSync("src/.skip", { cwd, dot: true, ignore: "src/.*" }), []);
});

test("negative patterns exclude files and subtrees regardless of order without mutating input", async t => {
  const cwd = await tree(t, {
    "src/main.ts": "",
    "src/skip/nested/a.ts": "",
    "src/helper.ts": "",
  });
  const patterns = Object.freeze(["!src/skip", "src", "!**/helper.ts", "src/main.ts"]);
  const options = Object.freeze({ cwd, ignore: Object.freeze([]) });
  assert.deepEqual(globSync(patterns, options), ["src/main.ts"]);
  assert.deepEqual(globSync(["src", "!src/skip", "!**/helper.ts"], { cwd }), ["src/main.ts"]);
  assert.deepEqual(globSync(["!src"], { cwd }), []);
  assert.deepEqual(patterns, ["!src/skip", "src", "!**/helper.ts", "src/main.ts"]);
  assert.deepEqual(options.ignore, []);
});

test("cwd, absolute inputs and outputs, dot files, and file URL cwd retain project paths", async t => {
  const cwd = await tree(t, {
    "packages/alpha/tsconfig.json": "{}",
    "packages/.hidden/tsconfig.json": "{}",
    ".root.json": "{}",
  });
  const pattern = "packages/*/tsconfig.json";
  assert.deepEqual(globSync(pattern, { cwd, expandDirectories: false }), ["packages/alpha/tsconfig.json"]);
  const expected = ["packages/.hidden/tsconfig.json", "packages/alpha/tsconfig.json"];
  assert.deepEqual(sorted(globSync(pattern, { cwd: pathToFileURL(`${cwd}/`), dot: true })), expected);
  assert.deepEqual(sorted(globSync(path.join(cwd, pattern), { cwd, dot: true, absolute: false })), expected);
  assert.deepEqual(sorted(globSync(pattern, { cwd, dot: true, absolute: true })), expected.map(name => path.join(cwd, name)));
  assert.deepEqual(globSync("*.json", { cwd }), []);
  assert.deepEqual(globSync("*.json", { cwd, dot: true }), [".root.json"]);
  assert.deepEqual(globSync(pattern, { cwd, dot: true, ignore: path.join(cwd, "packages/.hidden") }), ["packages/alpha/tsconfig.json"]);
});

test("brace expansion and positive and negative extglobs still select real files", async t => {
  const cwd = await tree(t, {
    "packages/alpha/tsconfig.json": "{}",
    "packages/beta/tsconfig.json": "{}",
    "packages/old/tsconfig.json": "{}",
    "a.ts": "",
    "ab.ts": "",
    "c.ts": "",
  });
  const selected = ["packages/alpha/tsconfig.json", "packages/beta/tsconfig.json"];
  assert.deepEqual(sorted(globSync("packages/{alpha,beta}/tsconfig.json", { cwd })), selected);
  assert.deepEqual(sorted(globSync("packages/@(alpha|beta)/tsconfig.json", { cwd })), selected);
  assert.deepEqual(sorted(globSync("packages/!(old)/tsconfig.json", { cwd })), selected);
  assert.deepEqual(sorted(globSync("+(a|b).ts", { cwd })), ["a.ts", "ab.ts"]);
});

test("dynamic classification preserves brace, negative and case-insensitive project patterns", () => {
  for (const pattern of ["tsconfig.json", "packages/alpha/tsconfig.json", ""]) {
    assert.equal(isDynamicPattern(pattern), false, pattern);
  }
  for (const pattern of ["**/tsconfig.json", "config{1..3}.json", "packages/{a,b}/tsconfig.json",
    "!packages/old/tsconfig.json", "!(old)/tsconfig.json", "packages/+(a|b)/tsconfig.json"]) {
    assert.equal(isDynamicPattern(pattern), true, pattern);
  }
  assert.equal(isDynamicPattern("tsconfig.json", { caseSensitiveMatch: false }), true);
  assert.equal(isDynamicPattern("tsconfig.json", { caseSensitiveMatch: true }), false);
});

test("unsupported options and APIs fail rather than silently broadening the adapter", () => {
  for (const options of [{ onlyFiles: false }, { onlyDirectories: true }, { extglob: false }, { signal: new AbortController().signal },
    { fs: {} }, { patterns: "**/*" }, { caseSensitiveMatch: false }, { arbitrary: true }, { [Symbol("option")]: true }]) {
    assert.throws(() => globSync([], options), TypeError);
  }
  for (const [patterns, options] of [[{}, {}], [[1], {}], [[], null], [[], { dot: "true" }], [[], { cwd: 1 }],
    [[], { absolute: 1 }], [[], { expandDirectories: 1 }], [[], { ignore: [1] }], [[], { cwd: new URL("https://fixture.invalid/") }]]) {
    assert.throws(() => globSync(patterns, options), TypeError);
  }
  assert.throws(() => isDynamicPattern(["*.json"]), TypeError);
  assert.throws(() => isDynamicPattern("*.json", { dot: true }), TypeError);
  assert.throws(() => isDynamicPattern("*.json", { caseSensitiveMatch: 0 }), TypeError);
  assert.equal(require(adapterPath).glob, undefined);
  assert.equal(require(adapterPath).escapePath, undefined);
});

test("the real typescript-estree project list preserves pattern order, braces and node_modules ignores", async t => {
  const cwd = await tree(t, {
    "tsconfig.base.json": "{}",
    "packages/alpha/tsconfig.json": "{}",
    "packages/beta/tsconfig.json": "{}",
    "packages/node_modules/ignored/tsconfig.json": "{}",
    "packages/.hidden/tsconfig.json": "{}",
  });
  clearGlobResolutionCache();
  t.after(clearGlobResolutionCache);
  const options = { tsconfigRootDir: cwd, singleRun: true };
  const projects = resolveProjectList({ ...options, project: ["tsconfig.base.json", "packages/b*/tsconfig.json",
    "packages/a*/tsconfig.json", "packages/**/tsconfig.json"] });
  assert.deepEqual([...projects.values()], ["tsconfig.base.json", "packages/beta/tsconfig.json", "packages/alpha/tsconfig.json"].map(name => path.join(cwd, name)));
  const braced = resolveProjectList({ ...options, project: ["packages/{alpha,beta}/tsconfig.json"] });
  assert.deepEqual(sorted(braced.values()), ["packages/alpha/tsconfig.json", "packages/beta/tsconfig.json"].map(name => path.join(cwd, name)));
  const ignored = resolveProjectList({ ...options, project: ["packages/**/tsconfig.json"], projectFolderIgnoreList: ["**/node_modules/**", "packages/beta/**"] });
  assert.deepEqual([...ignored.values()], [path.join(cwd, "packages/alpha/tsconfig.json")]);
});

test("the installed ESLint parser builds a real typed program from a braced project pattern", async t => {
  const source = "export const count: number = 1;";
  const cwd = await tree(t, {
    "packages/alpha/tsconfig.json": { compilerOptions: { strict: true }, include: ["src"] },
    "packages/alpha/src/main.ts": source,
    "packages/beta/tsconfig.json": { compilerOptions: { strict: true }, include: ["src"] },
    "packages/beta/src/main.ts": source,
  });
  const parser = require("@typescript-eslint/parser");
  parser.clearCaches();
  t.after(() => parser.clearCaches());
  const filePath = path.join(cwd, "packages/alpha/src/main.ts");
  const result = parser.parseForESLint(source, { filePath, project: ["packages/{alpha,beta}/tsconfig.json"],
    tsconfigRootDir: cwd, ecmaVersion: 2022, sourceType: "module" });
  assert.equal(result.ast.type, "Program");
  assert.ok(result.services.program);
  assert.equal(result.services.program.getSourceFile(filePath)?.text, source);
});

test("the real TypeScript import resolver discovers projects and expands include directories and default include", async t => {
  const config = (alias, extra) => ({ compilerOptions: { baseUrl: ".", paths: { [`@${alias}/*`]: ["src/*"] } }, ...extra });
  const cwd = await tree(t, {
    "packages/alpha/tsconfig.json": config("alpha", { include: ["src"], exclude: ["src/excluded"] }),
    "packages/alpha/src/main.ts": "",
    "packages/alpha/src/value.ts": "export const value = 1;",
    "packages/alpha/src/.dot.ts": "",
    "packages/alpha/src/excluded/deep/ignored.ts": "",
    "packages/alpha/src/node_modules/ignored.ts": "",
    "packages/beta/tsconfig.json": config("beta", { exclude: ["excluded"] }),
    "packages/beta/src/value.ts": "",
    "packages/beta/.dot.ts": "",
    "packages/beta/excluded/deep/ignored.ts": "",
    "packages/beta/node_modules/ignored.ts": "",
    "packages/.hidden/tsconfig.json": config("hidden", { include: ["src"] }),
    "packages/.hidden/src/value.ts": "",
    "packages/node_modules/tsconfig.json": config("ignored", {}),
  });
  // A child confines the resolver's cwd and module caches. The spy delegates
  // every call to the real adapter; all resolver/config/native code stays real.
  const output = execFileSync(process.execPath, ["-e", String.raw`
    const path = require("node:path");
    const { createRequire } = require("node:module");
    const resolverPath = process.argv[1];
    const local = createRequire(resolverPath);
    const tinyPath = local.resolve("tinyglobby");
    const adapter = local("tinyglobby");
    const calls = [];
    require.cache[tinyPath].exports = { ...adapter, globSync(patterns, options) {
      const files = adapter.globSync(patterns, options);
      calls.push({ patterns, options, files });
      return files;
    } };
    const result = require(resolverPath).resolve("@alpha/value", path.join(process.cwd(), "packages/alpha/src/main.ts"),
      { project: ["packages/*/tsconfig.json"] });
    console.log(JSON.stringify({ result, calls }));
  `, resolverPath], { cwd, timeout: 8_000, killSignal: "SIGKILL", encoding: "utf8", maxBuffer: 128 * 1024 });
  const { result, calls } = JSON.parse(output);
  assert.deepEqual(result, { found: true, path: path.join(cwd, "packages/alpha/src/value.ts") });
  const discovery = calls.find(call => call.options.expandDirectories === false);
  assert.ok(discovery);
  assert.deepEqual(sorted(discovery.files), ["packages/.hidden/tsconfig.json", "packages/alpha/tsconfig.json", "packages/beta/tsconfig.json"].map(name => path.join(cwd, name)));
  const include = calls.find(call => call.options.cwd === path.join(cwd, "packages/alpha"));
  assert.deepEqual(include.patterns, ["src"]);
  assert.deepEqual(sorted(include.files), ["src/.dot.ts", "src/main.ts", "src/value.ts"].map(name => path.join(cwd, "packages/alpha", name)));
  const defaultInclude = calls.find(call => call.options.cwd === path.join(cwd, "packages/beta"));
  assert.deepEqual(defaultInclude.patterns, ["**/*"]);
  assert.ok(defaultInclude.files.includes(path.join(cwd, "packages/beta/.dot.ts")));
  assert.ok(defaultInclude.files.includes(path.join(cwd, "packages/beta/src/value.ts")));
  assert.ok(defaultInclude.files.every(name => !name.includes("/excluded/") && !name.includes("/node_modules/")));
});

for (const segment of ["+(*)", "+(*a)"]) {
  test(`repeated ${segment} extglobs finish in a bounded child and leave matching enabled`, async t => {
    const cwd = await tree(t, { [`${"a".repeat(180)}c`]: "", "aaaaac": "", "healthy.json": "{}" });
    const output = execFileSync(process.execPath, ["--max-old-space-size=128", "-e", String.raw`
      const assert = require("node:assert/strict");
      const { globSync, isDynamicPattern } = require(process.argv[1]);
      const segment = process.argv[2];
      for (const repetitions of [12, 24, 48]) {
        const pattern = segment.repeat(repetitions) + "b";
        assert.equal(isDynamicPattern(pattern), true);
        for (const expandDirectories of [false, true]) {
          assert.deepEqual(globSync(pattern, { expandDirectories }), []);
        }
      }
      assert.ok(globSync("+(*a)c", { expandDirectories: false }).includes("aaaaac"));
      assert.deepEqual(globSync("healthy.json"), ["healthy.json"]);
      console.log(segment + ": 12/24/48 repeated extglobs and the next match completed");
    `, adapterPath, segment], { cwd, timeout: 5_000, killSignal: "SIGKILL", encoding: "utf8", maxBuffer: 128 * 1024,
      env: { PATH: process.env.PATH } });
    t.diagnostic(output.trim());
    assert.ok(output.includes("12/24/48 repeated extglobs and the next match completed"));
  });
}
