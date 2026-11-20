import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { linuxSourcePackages, normalizeUbuntuArchiveSources, prepareLinuxSourceDependencies } from "./prepare-linux-source-dependencies.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "edupi-ci-apt-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "sources.list.d"));
  const calls = [];
  const options = {
    aptRoot: root,
    platform: "linux",
    uid: 0,
    env: { GITHUB_ACTIONS: "true" },
    run: (...args) => calls.push(args),
  };
  return { root, calls, options };
}

test("legacy and deb822 sources retain suites, keys and security sources", () => {
  const source = [
    "# http://us-east-2.ec2.archive.ubuntu.com/ubuntu is the old archive",
    "deb http://us-east-2.ec2.archive.ubuntu.com/ubuntu resolute main universe",
    "deb https://azure.archive.ubuntu.com/ubuntu/ noble-updates main",
    "Types: deb",
    "URIs: http://us-east-2.ec2.archive.ubuntu.com/ubuntu",
    "Suites: resolute resolute-updates",
    "Components: main universe",
    "Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg",
    "URIs: http://security.ubuntu.com/ubuntu",
    "",
  ].join("\n");
  assert.equal(normalizeUbuntuArchiveSources(source), [
    "# http://us-east-2.ec2.archive.ubuntu.com/ubuntu is the old archive",
    "deb https://archive.ubuntu.com/ubuntu resolute main universe",
    "deb https://archive.ubuntu.com/ubuntu/ noble-updates main",
    "Types: deb",
    "URIs: https://archive.ubuntu.com/ubuntu",
    "Suites: resolute resolute-updates",
    "Components: main universe",
    "Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg",
    "URIs: http://security.ubuntu.com/ubuntu",
    "",
  ].join("\n"));
});

test("mirror files retain CRLF, canonical and unrelated repository URLs", () => {
  const source = [
    "http://azure.archive.ubuntu.com/ubuntu",
    "https://archive.ubuntu.com/ubuntu",
    "https://packages.microsoft.com/repos/code",
    "https://ports.ubuntu.com/ubuntu-ports",
    "https://evil.invalid/?mirror=http://us-east-2.ec2.archive.ubuntu.com/ubuntu",
    "https://azure.archive.ubuntu.com/ubuntu-private",
    "https://user:password@azure.archive.ubuntu.com/ubuntu",
    "https://azure.archive.ubuntu.com:8443/ubuntu",
    "",
  ].join("\r\n");
  assert.equal(normalizeUbuntuArchiveSources(source),
    source.replace("http://azure.archive.ubuntu.com/ubuntu\r\n", "https://archive.ubuntu.com/ubuntu\r\n"));
});

test("preparation backs up real source files and runs bounded update then the original package list", t => {
  const f = fixture(t);
  const source = "URIs: http://us-east-2.ec2.archive.ubuntu.com/ubuntu\nSuites: resolute\n";
  const path = join(f.root, "sources.list.d/ubuntu.sources");
  writeFileSync(path, source);
  writeFileSync(join(f.root, "apt-mirrors.txt"), "http://azure.archive.ubuntu.com/ubuntu\n");
  assert.equal(prepareLinuxSourceDependencies(f.options).rewritten.length, 2);
  assert.equal(readFileSync(`${path}.edupi-ci-backup`, "utf8"), source);
  assert.equal(readFileSync(path, "utf8"), source.replace("http://us-east-2.ec2.archive.ubuntu.com", "https://archive.ubuntu.com"));
  assert.deepEqual(f.calls.map(([command]) => command), ["apt-get", "apt-get"]);
  const [update, install] = f.calls.map(([, args]) => args);
  for (const args of [update, install]) {
    assert.ok(args.includes("Acquire::Retries=2"));
    assert.ok(args.includes("Acquire::http::Timeout=30"));
    assert.ok(args.includes("Acquire::https::Timeout=30"));
    assert.ok(!args.some(arg => /allow-unauthenticated|Check-Valid-Until=false|AllowInsecure/u.test(arg)));
  }
  assert.equal(update.at(-1), "update");
  assert.ok(update.includes("APT::Update::Error-Mode=any"));
  assert.deepEqual(install.slice(install.indexOf("install")), [
    "install", "--no-install-recommends", "-y",
    "libgtk-3-dev", "libwebkit2gtk-4.1-dev", "libayatana-appindicator3-dev",
    "libxdo-dev", "libxtst-dev", "libxcb1-dev", "libclang-dev",
    "libpipewire-0.3-dev", "libgbm-dev", "nasm", "dbus",
  ]);
  assert.equal(f.calls[1][2].env.DEBIAN_FRONTEND, "noninteractive");
  assert.equal(f.calls[1][2].env.NEEDRESTART_MODE, "l");
  assert.equal(linuxSourcePackages.length, 11);
  f.calls.length = 0;
  assert.deepEqual(prepareLinuxSourceDependencies(f.options).rewritten, []);
  assert.equal(readFileSync(`${path}.edupi-ci-backup`, "utf8"), source);
});

test("Linux, root and GitHub Actions guards fail before file or command effects", t => {
  const f = fixture(t);
  const path = join(f.root, "sources.list");
  const source = "deb http://azure.archive.ubuntu.com/ubuntu noble main\n";
  writeFileSync(path, source);
  for (const override of [{ platform: "darwin" }, { uid: 501 }, { env: {} }]) {
    assert.throws(() => prepareLinuxSourceDependencies({ ...f.options, ...override }), /requires/u);
  }
  assert.equal(readFileSync(path, "utf8"), source);
  assert.deepEqual(f.calls, []);
});

test("apt update failure prevents install; install failure is never reported as prepared", t => {
  const f = fixture(t);
  const failure = new Error("controlled apt failure");
  assert.throws(() => prepareLinuxSourceDependencies({
    ...f.options,
    run: (...args) => { f.calls.push(args); throw failure; },
  }), error => error === failure);
  assert.equal(f.calls.length, 1);
  f.calls.length = 0;
  assert.throws(() => prepareLinuxSourceDependencies({
    ...f.options,
    run: (...args) => { f.calls.push(args); if (f.calls.length === 2) throw failure; },
  }), error => error === failure);
  assert.equal(f.calls.length, 2);
});

test("source symlinks cannot rewrite files outside the temporary apt root", t => {
  const f = fixture(t);
  const source = "deb http://azure.archive.ubuntu.com/ubuntu noble main\n";
  const outside = join(f.root, "original.txt");
  writeFileSync(outside, source);
  symlinkSync(outside, join(f.root, "sources.list.d/linked.list"));
  symlinkSync(outside, join(f.root, "sources.list"));
  assert.deepEqual(prepareLinuxSourceDependencies(f.options).rewritten, []);
  assert.equal(readFileSync(outside, "utf8"), source);
});
