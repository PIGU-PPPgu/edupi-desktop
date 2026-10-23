import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import semver from "semver";

const cargoLock = await readFile(new URL("../src-tauri/Cargo.lock", import.meta.url), "utf8");
const cargoManifest = await readFile(new URL("../src-tauri/Cargo.toml", import.meta.url), "utf8");
const packages = cargoLock.split("[[package]]").slice(1).map(entry => ({
  name: entry.match(/^name = "([^"]+)"$/mu)?.[1],
  version: entry.match(/^version = "([^"]+)"$/mu)?.[1],
}));

test("the native URL-scope dependency no longer retains the unmaintained UNIC chain", () => {
  // tauri-utils 2.10 migrates URLPattern to the maintained ICU implementation.
  const utils = packages.filter(entry => entry.name === "tauri-utils");
  const patterns = packages.filter(entry => entry.name === "urlpattern");
  assert.ok(utils.length && patterns.length, "native URL-scope dependencies must remain present");
  for (const entry of utils) assert.ok(semver.satisfies(entry.version, ">=2.10.0 <3"), `tauri-utils ${entry.version}`);
  for (const entry of patterns) assert.ok(semver.satisfies(entry.version, ">=0.6.0 <1"), `urlpattern ${entry.version}`);
  for (const name of ["unic-char-property", "unic-char-range", "unic-common", "unic-ucd-ident", "unic-ucd-version"]) {
    assert.equal(packages.some(entry => entry.name === name), false, `${name} restores the retired URL-scope chain`);
  }
});

test("the native manifest declares the compiler floor required by maintained Tauri utilities", () => {
  const requiredRust = cargoManifest.match(/^rust-version = "([^"]+)"$/mu)?.[1];
  assert.ok(requiredRust && semver.gte(semver.coerce(requiredRust), "1.90.0"), "tauri-utils 2.10 requires Rust 1.90");
});
