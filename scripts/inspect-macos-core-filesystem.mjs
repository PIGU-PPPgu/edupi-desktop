import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

assert.equal(process.platform, "darwin");
const nativeProbe = path.resolve(process.argv[2] || "");
assert.ok(fs.statSync(nativeProbe).isFile());
const roots = { home: os.homedir(), temp: os.tmpdir(), workspace: process.cwd() };
const records = [];
for (const [label, configured] of Object.entries(roots)) {
  const directory = fs.realpathSync(configured), volume = fs.statfsSync(directory), entry = fs.statSync(directory, { bigint: true });
  const [type, name, device, inode] = execFileSync(nativeProbe, [directory], { encoding: "utf8" }).trim().split("\t");
  assert.match(name, /^[A-Za-z0-9_]+$/);
  assert.equal(BigInt(device), entry.dev); assert.equal(BigInt(inode), entry.ino);
  records.push({ label, nodeType: volume.type, nativeType: Number(type), nativeFilesystem: name, device, inode });
}
console.log(JSON.stringify({ platform: process.platform, node: process.version, release: os.release(), records }, null, 2));
