import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import {
  NEW_LINUX, OLD_LINUX, assertLinuxRelaunch, assertLinuxSnapshot, copyXvfbAuthority, linuxCohort,
  linuxEnvironment, linuxFetchWithSignal, linuxInputs, linuxMain, linuxReleaseAsset, linuxStorageReadback,
  markLinuxPassed, ownedLinuxProcesses, parseLinuxListeners, requireLinuxRunner,
} from "./test-linux-upgrade-acceptance.mjs";
import { STORAGE_PROGRAM } from "./test-macos-installed-acceptance.mjs";

const cohort = `https://raw.githubusercontent.com/PIGU-PPPgu/edupi-desktop/${"a".repeat(40)}/docs/acceptance/update-cohorts/linux-116-117.json`;
test("Linux preflight cannot select a feed and upgrade requires an immutable first-party cohort", () => {
  assert.deepEqual(linuxInputs({}), { mode: "preflight", cohort: null });
  assert.deepEqual(linuxInputs({ LINUX_UPGRADE_MODE: "upgrade", LINUX_UPGRADE_COHORT_URL: cohort }),
    { mode: "upgrade", cohort });
  assert.throws(() => linuxInputs({ LINUX_UPGRADE_COHORT_URL: cohort }), /preflight_cannot_select_update_feed/u);
  for (const value of [cohort.replace("/" + "a".repeat(40) + "/", "/main/"), cohort + "?token=secret",
    cohort.replace("https:", "http:"), cohort.replace("PIGU-PPPgu", "attacker"), "", "file:///tmp/feed.json"])
    assert.throws(() => linuxInputs({ LINUX_UPGRADE_MODE: "upgrade", LINUX_UPGRADE_COHORT_URL: value }),
      /immutable_first_party_cohort_required/u);
});

function release(expected, draft = true) {
  return { id: expected.release, target_commitish: expected.source, tag_name: `v${expected.version}`, draft,
    assets: [{ id: expected.asset, name: `EduPi_${expected.version}_amd64.AppImage`, state: "uploaded",
      size: expected.bytes, digest: expected.digest,
      url: `https://api.github.com/repos/PIGU-PPPgu/edupi-desktop/releases/assets/${expected.asset}`,
      browser_download_url: "https://github.com/PIGU-PPPgu/edupi-desktop/releases/download/untagged-00000000000000000000/ignored" }] };
}
test("old private API asset and public target require the exact frozen source, size, digest and ID", () => {
  assert.equal(linuxReleaseAsset(release(OLD_LINUX), OLD_LINUX).id, OLD_LINUX.asset);
  assert.equal(linuxReleaseAsset(release(NEW_LINUX, false), NEW_LINUX, true).id, NEW_LINUX.asset);
  assert.throws(() => linuxReleaseAsset(release(NEW_LINUX), NEW_LINUX, true), /public_target_required/u);
  for (const change of [{ id: 12 }, { target_commitish: "main" }, { tag_name: "v0.3.999" }])
    assert.throws(() => linuxReleaseAsset({ ...release(OLD_LINUX), ...change }, OLD_LINUX), /identity_mismatch/u);
  for (const change of [{ id: 12 }, { size: 1 }, { digest: NEW_LINUX.digest }, { state: "new" },
    { url: "https://attacker.invalid/asset" }]) {
    const value = release(OLD_LINUX);
    Object.assign(value.assets[0], change);
    assert.throws(() => linuxReleaseAsset(value, OLD_LINUX), /linux_asset_/u);
  }
});
test("both Linux cohort keys bind the actual public API asset and exact signature", () => {
  const entry = { url: `https://api.github.com/repos/PIGU-PPPgu/edupi-desktop/releases/assets/${NEW_LINUX.asset}`,
    signature: "synthetic-signature" };
  const manifest = { version: NEW_LINUX.version,
    platforms: { "linux-x86_64": { ...entry }, "linux-x86_64-appimage": { ...entry } } };
  linuxCohort(manifest, "synthetic-signature\n");
  for (const change of ["signature", "url"]) {
    const changed = structuredClone(manifest);
    changed.platforms["linux-x86_64-appimage"][change] = "different";
    assert.throws(() => linuxCohort(changed, "synthetic-signature"), /cohort_linux_asset_or_signature_mismatch/u);
  }
  assert.throws(() => linuxCohort({ ...manifest, version: OLD_LINUX.version }, "synthetic-signature"),
    /cohort_target_version_mismatch/u);
});
test("native launch environment excludes inherited credentials, external roots and default profile", () => {
  const p = { root: "/tmp/edupi-linux-upgrade-1-1", mode: "upgrade", cohort };
  const env = linuxEnvironment(p, { DISPLAY: ":99", DBUS_SESSION_BUS_ADDRESS: "unix:path=/private-test",
    GH_TOKEN: "do-not-inherit", EDUPI_CORE_ROOT: "/external", HOME: "/real-user", LD_PRELOAD: "/inject" });
  assert.equal(env.HOME, `${p.root}/home`);
  assert.equal(env.EDUPI_DATA_ROOT, `${p.root}/home/edupi-route1-canary-acceptance`);
  assert.equal(env.EDUPI_ISOLATED_UPDATE_FEED, cohort);
  assert.equal(env.TAURI_WEBVIEW_AUTOMATION, "true");
  assert.equal(env.APPIMAGE_EXTRACT_AND_RUN, "1");
  assert.equal(env.XAUTHORITY, `${p.root}/xdg-runtime/Xauthority`);
  for (const key of ["GH_TOKEN", "EDUPI_CORE_ROOT", "LD_PRELOAD", "GITHUB_TOKEN"]) assert.equal(env[key], undefined);
  assert.equal(linuxEnvironment({ ...p, mode: "preflight" }, {}).EDUPI_ISOLATED_UPDATE_FEED, undefined);
});
test("process cleanup follows owned descendants and private executable paths, while rejecting PID reuse", () => {
  const root = "/tmp/edupi-linux-upgrade-1-1";
  const driver = { pid: 100, ppid: 1, birth: "1", executable: "/usr/bin/WebKitWebDriver" };
  const app = { pid: 101, ppid: 100, birth: "2", executable: `${root}/tmp/AppDir/usr/bin/pi-agent-desktop` };
  const http = { pid: 102, ppid: 101, birth: "3", executable: `${root}/tmp/AppDir/resources/node/node` };
  const unrelated = { pid: 103, ppid: 1, birth: "4", executable: "/usr/bin/unrelated" };
  const olderOrphan = { pid: 104, ppid: 100, birth: "0", executable: "/usr/bin/unrelated-orphan" };
  const owned = ownedLinuxProcesses(new Map(), [driver, app, http, unrelated, olderOrphan], root, driver);
  assert.deepEqual([...owned.keys()], [100, 101, 102]);
  const reused = { ...driver, birth: "999", executable: "/usr/bin/unrelated" };
  const orphan = { ...http, ppid: 1 };
  assert.deepEqual([...ownedLinuxProcesses(owned, [reused, orphan, unrelated], root, driver).keys()], [102]);
});
test("Xvfb's private authority cookie is copied to the synthetic profile without leaking its contents", t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "linux-xauth-test-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "xvfb-run.synthetic/Xauthority"), destination = path.join(root, "private/Xauthority");
  for (const directory of [path.dirname(source), path.dirname(destination)]) fs.mkdirSync(directory, { mode: 0o700 });
  fs.writeFileSync(source, "synthetic cookie", { mode: 0o600 });
  copyXvfbAuthority(source, destination);
  assert.deepEqual(fs.readFileSync(destination), fs.readFileSync(source));
  assert.equal(fs.statSync(destination).mode & 0o777, 0o600);
  const link = path.join(path.dirname(source), "alias");
  fs.symlinkSync(source, link);
  assert.throws(() => copyXvfbAuthority(link, destination + "-unsafe"), /canonical_xvfb_authority_required/u);
  fs.chmodSync(source, 0o644);
  assert.throws(() => copyXvfbAuthority(source, destination + "-public"), /private_xvfb_authority_required/u);
});
test("native listener parsing accepts only loopback LISTEN sockets for the actual port", () => {
  const header = "sl local_address rem_address st tx_queue tr retrnsmt uid timeout inode";
  const row = (address, state = "0A") => `0: ${address}:115D 00000000:0000 ${state} 0:0 00:0 0 1000 0 123456`;
  assert.deepEqual(parseLinuxListeners(header + "\n" + row("0100007F"), 4445), ["123456"]);
  assert.deepEqual(parseLinuxListeners(header + "\n" + row("0100007F"), 4446), []);
  assert.deepEqual(parseLinuxListeners(header + "\n" + row("0100007F", "01"), 4445), []);
  assert.throws(() => parseLinuxListeners(header + "\n" + row("00000000"), 4445), /not_loopback/u);
});
test("upgrade evidence binds a new bundle, its actual HTTP socket owner and its bundled Core process", () => {
  const root = "/tmp/edupi-linux-upgrade-1-1", resources = `${root}/tmp/new/usr/lib/EduPi/resources`;
  const previous = { pid: 100, birth: "1", executable: `${root}/tmp/old/usr/bin/pi-agent-desktop` };
  const app = { pid: 200, ppid: 1, birth: "10", executable: `${root}/tmp/new/usr/bin/pi-agent-desktop` };
  const httpOwner = { pid: 201, ppid: 200, birth: "11", executable: `${resources}/node/node` };
  const core = { pid: 202, ppid: 201, birth: "12", executable: `${resources}/node/node` };
  const input = { previous, app, rows: [app, httpOwner, core], listenerPids: [201], resources, root,
    commands: { 202: [core.executable, `${resources}/server/core-runtime-host.mjs`] },
    status: { core: { status: "ready", validationMode: "bundled" }, projection: { status: "ready" },
      compatibility: { actual: { coreCommit: "98e4f7cd0c31dd30954574d2040bb1b948cdd954" } }, externalSend: false },
    manifest: { appVersion: NEW_LINUX.version, components: [{ id: "pi-agent-desktop", version: NEW_LINUX.version }] } };
  assert.deepEqual(assertLinuxRelaunch(input), { httpOwner: { pid: 201, birth: "11" }, coreHost: { pid: 202, birth: "12" } });
  for (const change of [
    value => { value.app.executable = previous.executable; },
    value => { value.rows[1].ppid = 999; },
    value => { value.listenerPids = [999]; },
    value => { value.status.core.validationMode = "external"; },
    value => { value.rows[2].ppid = 1; },
    value => { value.commands[202][1] = `${root}/tmp/old/server/core-runtime-host.mjs`; },
    value => { value.manifest.appVersion = OLD_LINUX.version; },
    value => { value.rows[1].birth = "9"; },
    value => { value.rows[0].birth = "99"; },
  ]) {
    const changed = structuredClone(input); change(changed);
    assert.throws(() => assertLinuxRelaunch(changed));
  }
});
test("cancellation aborts an actual pending HTTP request and cannot turn preflight or upgrade green", async t => {
  const server = http.createServer(() => {});
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const controller = new AbortController(), reader = linuxFetchWithSignal(controller.signal);
  const requestObserved = new Promise(resolve => server.once("request", resolve));
  const pending = reader(`http://127.0.0.1:${server.address().port}/pending`);
  await requestObserved;
  controller.abort();
  await assert.rejects(pending);
  assert.throws(() => reader("http://127.0.0.1/"), /acceptance_interrupted/u);
  for (const upgraded of [false, true]) {
    const proof = { status: "failed", actualUpgradePassed: false };
    assert.throws(() => markLinuxPassed(proof, controller.signal, upgraded), /acceptance_interrupted/u);
    assert.equal(proof.status, "failed"); assert.equal(proof.actualUpgradePassed, false);
  }
  assert.throws(() => markLinuxPassed({ interrupted: true }, new AbortController().signal), /acceptance_interrupted/u);
});
test("old native identity requires Linux 116, canonical selected root and bundled Core98", () => {
  const root = "/synthetic/home/edupi-route1-canary-test";
  const value = { host: { platform: "linux", appVersion: OLD_LINUX.version, processId: 123 },
    roots: { dataRoot: root, dataSource: "environment", coreSource: "bundled" },
    status: { core: { status: "ready", validationMode: "bundled" }, projection: { status: "ready" },
      compatibility: { actual: { coreCommit: "98e4f7cd0c31dd30954574d2040bb1b948cdd954" } }, externalSend: false } };
  assertLinuxSnapshot(value, root);
  for (const change of [{ ...value, host: { ...value.host, appVersion: NEW_LINUX.version } },
    { ...value, roots: { ...value.roots, dataRoot: "/real-user" } },
    { ...value, status: { ...value.status, externalSend: true } }])
    assert.throws(() => assertLinuxSnapshot(change, root));
});
test("upgrade compares actual read-only SQLite records and rejects same-inode content loss", t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "linux-upgrade-sql-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const db = path.join(root, "synthetic.sqlite");
  const python = process.platform === "darwin" ? "/usr/bin/python3" : "python3";
  const sql = text => execFileSync(python, ["-c", `import sqlite3,sys\nwith sqlite3.connect(sys.argv[1]) as c:\n c.executescript(sys.argv[2])`, db, text]);
  sql("CREATE TABLE synthetic(id TEXT PRIMARY KEY, content TEXT); INSERT INTO synthetic VALUES('fixture', 'content');");
  const read = () => JSON.parse(execFileSync(python, ["-I", "-c", STORAGE_PROGRAM, db], { encoding: "utf8" }));
  const before = read();
  linuxStorageReadback(before, read());
  sql("INSERT INTO synthetic VALUES('additional', 'new');");
  linuxStorageReadback(before, read());
  sql("UPDATE synthetic SET content='lost' WHERE id='fixture';");
  assert.throws(() => linuxStorageReadback(before, read()), /upgraded_sqlite_record_changed/u);
  sql("DELETE FROM synthetic WHERE id='fixture';");
  assert.throws(() => linuxStorageReadback(before, read()), /upgraded_sqlite_record_changed/u);
});
test("local invocations are rejected before downloading or starting an App", async () => {
  assert.throws(() => requireLinuxRunner({}, "linux"), /fresh_hosted_linux_required/u);
  assert.throws(() => requireLinuxRunner({ GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "self-hosted",
    RUNNER_OS: "Linux" }, "linux"), /fresh_hosted_linux_required/u);
  assert.equal(await linuxMain("prepare", {}), 1);
  assert.equal(await linuxMain("run", {}), 1);
  assert.equal(await linuxMain("cleanup", {}), 1);
});
