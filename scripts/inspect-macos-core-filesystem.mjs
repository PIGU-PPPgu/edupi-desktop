import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

assert.equal(process.platform, "darwin");
const nativeProbe = path.resolve(process.argv[2] || "");
assert.ok(fs.statSync(nativeProbe).isFile());
const roots = { home: os.homedir(), temp: os.tmpdir(), workspace: process.cwd() };
const records = [];
function inspect(label, configured) {
  const directory = fs.realpathSync(configured), volume = fs.statfsSync(directory), entry = fs.statSync(directory, { bigint: true });
  const [type, name, device, inode] = execFileSync(nativeProbe, [directory], { encoding: "utf8" }).trim().split("\t");
  assert.match(name, /^[A-Za-z0-9_]+$/);
  assert.equal(BigInt(device), entry.dev); assert.equal(BigInt(inode), entry.ino);
  let dfEvidence;
  try {
    const output = JSON.parse(execFileSync("/bin/df", ["--libxo", "json", "-Y", "--", directory], { encoding: "utf8", timeout: 3000, maxBuffer: 65536 }));
    const rows = output?.["storage-system-information"]?.filesystem;
    assert.equal(rows?.length, 1);
    const mount = fs.statSync(rows[0]["mounted-on"], { bigint: true });
    assert.equal(mount.dev, entry.dev);
    dfEvidence = { type: rows[0].type, mountDeviceMatches: true };
  } catch (error) { dfEvidence = { available: false, code: error.code || error.status || "invalid_evidence" }; }
  return { label, nodeType: volume.type, nativeType: Number(type), nativeFilesystem: name, device, inode, dfEvidence,
    numericIdentitySafe: Number.isSafeInteger(Number(device)) && Number.isSafeInteger(Number(inode)) };
}
for (const [label, configured] of Object.entries(roots)) records.push(inspect(label, configured));
let coreRootResult;
if (process.argv[3]) {
  const coreRoot = fs.realpathSync(process.argv[3]);
  const { prepareCoreRuntimeRoot } = await import(pathToFileURL(path.join(coreRoot, "scripts/core_runtime_root.mjs")).href);
  const fixture = fs.mkdtempSync(path.join(process.cwd(), ".edupi-native-root-probe-")), dataRoot = path.join(fixture, "data");
  try {
    fs.mkdirSync(path.join(dataRoot, ".edupi/memory"), { recursive: true });
    const prepared = prepareCoreRuntimeRoot(dataRoot);
    coreRootResult = { ok: prepared.ok, code: prepared.code ?? null };
    for (const [label, target] of [["synthetic-root", dataRoot], ["synthetic-edupi", path.join(dataRoot, ".edupi")], ["synthetic-runtime", path.join(dataRoot, ".edupi/runtime")]]) {
      records.push(fs.existsSync(target) ? inspect(label, target) : { label, exists: false });
    }
  } finally { fs.rmSync(fixture, { recursive: true }); }
}
console.log(JSON.stringify({ platform: process.platform, node: process.version, release: os.release(), records, coreRootResult }, null, 2));
