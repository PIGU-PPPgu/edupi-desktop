import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const { loadOwnerControlToken, loadRuntimeOwnerControlToken, deriveExistingMemorySummaryKey } = await createJiti(import.meta.url).import("./edupi-owner-control-token.ts");

test("summary integrity derives only from an existing private owner key without creating or repairing files", () => {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-summary-key-")));
  const state = path.join(temp, "state"), data = path.join(temp, "data");
  for (const file of [state, data]) fs.mkdirSync(file, { mode: 0o700 });
  try {
    assert.throws(() => deriveExistingMemorySummaryKey(state, data, "session-a"));
    assert.equal(fs.existsSync(path.join(state, "edupi-owner-control")), false, "a read-only derivation must not create the owner directory");
    const token = loadOwnerControlToken(state, data), dir = path.join(state, "edupi-owner-control"), file = path.join(dir, fs.readdirSync(dir)[0]);
    const before = fs.statSync(file, { bigint: true }), key = deriveExistingMemorySummaryKey(state, data, "session-a");
    assert.equal(key.length, 32); assert.notEqual(key.toString("base64url"), token);
    assert.equal(deriveExistingMemorySummaryKey(state, data, "session-a").equals(key), true, "cold reread preserves integrity with the existing key");
    assert.equal(deriveExistingMemorySummaryKey(state, data, "session-b").equals(key), false);
    const after = fs.statSync(file, { bigint: true });
    for (const name of ["ino", "dev", "size", "mtimeNs", "ctimeNs"]) assert.equal(after[name], before[name]);
    const temporary = path.join(dir, `${path.basename(file, ".key")}.${crypto.randomUUID()}.tmp`);
    fs.linkSync(file, temporary);
    assert.throws(() => deriveExistingMemorySummaryKey(state, data, "session-a"));
    assert.equal(fs.existsSync(temporary), true, "unlike the mutating loader, derivation must not unlink a temporary hard link");
    fs.unlinkSync(temporary);
    fs.writeFileSync(file, crypto.randomBytes(32).toString("base64url"), { mode: 0o600 });
    assert.equal(deriveExistingMemorySummaryKey(state, data, "session-a").equals(key), false, "owner key rotation invalidates prior proofs");
    if (process.platform !== "win32") {
      const alias = path.join(temp, "state-alias"); fs.symlinkSync(state, alias);
      assert.throws(() => deriveExistingMemorySummaryKey(alias, data, "session-a"));
      const dataAlias = path.join(temp, "data-alias"); fs.symlinkSync(data, dataAlias);
      assert.throws(() => deriveExistingMemorySummaryKey(state, dataAlias, "session-a"));
      for (const [target, invalidMode, originalMode] of [[file, 0o644, 0o600], [dir, 0o755, 0o700], [data, 0o777, 0o700]]) {
        fs.chmodSync(target, invalidMode);
        assert.throws(() => deriveExistingMemorySummaryKey(state, data, "session-a"));
        fs.chmodSync(target, originalMode);
      }
      const originalRead = fs.readFileSync;
      try {
        fs.readFileSync = function (target, ...options) {
          const value = originalRead.call(this, target, ...options);
          if (typeof target === "number") fs.chmodSync(file, 0o644);
          return value;
        };
        assert.throws(() => deriveExistingMemorySummaryKey(state, data, "session-a"), "a permission change during the descriptor read must fail closed");
      } finally { fs.readFileSync = originalRead; fs.chmodSync(file, 0o600); }
    }
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("owner control key persists per root without exposing the runtime transport token", () => {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-owner-token-")));
  const state = path.join(temp, "desktop-state");
  const firstRoot = path.join(temp, "first-data");
  const secondRoot = path.join(temp, "second-data");
  for (const directory of [state, firstRoot, secondRoot]) fs.mkdirSync(directory, { mode: 0o700 });
  try {
    const first = loadOwnerControlToken(state, firstRoot);
    assert.match(first, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(loadOwnerControlToken(state, firstRoot), first);
    assert.notEqual(loadOwnerControlToken(state, secondRoot), first);
    const privateDir = path.join(state, "edupi-owner-control");
    assert.equal(fs.readdirSync(privateDir).length, 2);
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(privateDir).mode & 0o077, 0);
      assert.equal(fs.statSync(path.join(privateDir, fs.readdirSync(privateDir)[0])).mode & 0o077, 0);
    }
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("lost, corrupt and linked owner keys fail closed without changing owner state", () => {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-owner-token-")));
  const state = path.join(temp, "desktop-state");
  const data = path.join(temp, "data");
  const output = path.join(data, ".edupi", "output");
  fs.mkdirSync(state, { mode: 0o700 });
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  const key = path.join(state, "edupi-owner-control", `${crypto.createHash("sha256").update(data).digest("hex").slice(0, 32)}.key`);
  try {
    assert.throws(() => loadOwnerControlToken(undefined, data), { code: "owner_control_credential_unavailable" });
    const nestedState = path.join(data, "desktop-state");
    fs.mkdirSync(nestedState, { mode: 0o700 });
    assert.throws(() => loadOwnerControlToken(nestedState, data), { code: "owner_control_credential_unavailable" });
    const first = loadOwnerControlToken(state, data);
    fs.writeFileSync(path.join(output, "ambient-authorization-v1.json"), "existing-owner-state", { mode: 0o600 });
    fs.unlinkSync(key);
    assert.throws(() => loadOwnerControlToken(state, data), { code: "owner_control_credential_unavailable" });
    assert.equal(fs.existsSync(key), false);
    assert.equal(fs.readFileSync(path.join(output, "ambient-authorization-v1.json"), "utf8"), "existing-owner-state");
    fs.writeFileSync(key, `${first.slice(1)}x`, { mode: 0o600 });
    assert.throws(() => loadOwnerControlToken(state, data), { code: "owner_control_credential_unavailable" });
    fs.unlinkSync(key);
    if (process.platform !== "win32") {
      fs.symlinkSync(path.join(output, "ambient-authorization-v1.json"), key);
      assert.throws(() => loadOwnerControlToken(state, data), { code: "owner_control_credential_unavailable" });
      fs.unlinkSync(key);
    }
    fs.writeFileSync(key, first, { mode: 0o600 });
    if (process.platform !== "win32") {
      fs.chmodSync(key, 0o644);
      assert.throws(() => loadOwnerControlToken(state, data), { code: "owner_control_credential_unavailable" });
    }
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("recovers only a matching private temporary link after interrupted publication", () => {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-owner-token-")));
  const state = path.join(temp, "desktop-state");
  const data = path.join(temp, "data");
  fs.mkdirSync(state, { mode: 0o700 });
  fs.mkdirSync(data, { mode: 0o700 });
  try {
    const token = loadOwnerControlToken(state, data);
    const directory = path.join(state, "edupi-owner-control");
    const file = path.join(directory, fs.readdirSync(directory)[0]);
    const temporary = path.join(directory, `${path.basename(file, ".key")}.${crypto.randomUUID()}.tmp`);
    fs.linkSync(file, temporary);
    assert.equal(loadOwnerControlToken(state, data), token);
    assert.equal(fs.existsSync(temporary), false);
    const outside = path.join(temp, "outside-link");
    fs.linkSync(file, outside);
    assert.throws(() => loadOwnerControlToken(state, data), { code: "owner_control_credential_unavailable" });
    assert.equal(fs.readFileSync(outside, "ascii"), token);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("legacy owner state degrades normal runtime but still blocks ambient startup", () => {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "edupi-owner-token-")));
  const state = path.join(temp, "desktop-state");
  const data = path.join(temp, "data");
  const output = path.join(data, ".edupi", "output");
  fs.mkdirSync(state, { mode: 0o700 });
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  const ownerState = path.join(output, "ambient-authorization-v1.json");
  fs.writeFileSync(ownerState, '{"legacy":true}\n', { mode: 0o600 });
  try {
    assert.equal(loadRuntimeOwnerControlToken(state, data, { required: false }), null);
    assert.equal(fs.readFileSync(ownerState, "utf8"), '{"legacy":true}\n');
    assert.equal(fs.existsSync(path.join(state, "edupi-owner-control")), true);
    assert.equal(fs.readdirSync(path.join(state, "edupi-owner-control")).length, 0);
    assert.throws(
      () => loadRuntimeOwnerControlToken(state, data, { required: true }),
      { code: "owner_control_credential_unavailable" },
    );
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
