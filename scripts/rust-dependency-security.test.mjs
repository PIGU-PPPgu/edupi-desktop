import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import semver from "semver";

const lock = await readFile(new URL("../src-tauri/Cargo.lock", import.meta.url), "utf8");
const packages = lock.split("[[package]]").slice(1).map(entry => ({
  name: entry.match(/^name = "([^"]+)"$/mu)?.[1],
  version: entry.match(/^version = "([^"]+)"$/mu)?.[1],
}));

for (const [name, minimum] of [["zip", "9.0.5"], ["glib", "0.22.0"], ["chacha20", "0.10.2"], ["clipboard-win", "5.4.3"]]) {
  test(`every ${name} resolution meets the reviewed security baseline`, () => {
    const found = packages.filter(entry => entry.name === name);
    assert.ok(found.length, `${name} must not be removed to hide an advisory`);
    for (const entry of found) assert.ok(semver.gte(entry.version, minimum), `${name} ${entry.version}`);
  });
}

test("retired GLib macro and split D-Bus type crates are absent", () => {
  for (const name of ["proc-macro-error", "zbus_names", "zvariant", "zvariant_derive"]) {
    assert.equal(packages.some(entry => entry.name === name), false, `${name} restores a retired dependency`);
  }
  const bus = packages.filter(entry => entry.name === "zbus");
  assert.ok(bus.length, "D-Bus support must remain available");
  for (const entry of bus) assert.ok(semver.gte(entry.version, "6.1.0"));
});
