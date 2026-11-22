import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// A source sentinel complements the Swift/URLProtocol behavior tests: changing
// the canonical contract must also update the iOS pin, never silently accept it.
test("iOS cloud chat pins the canonical contract identity", async () => {
  const [canonicalText, swift] = await Promise.all([
    readFile(new URL("../contracts/edupi-cloud-sync-v1.json", import.meta.url), "utf8"),
    readFile(new URL("../ios/EduPi/EduPiCloudChat.swift", import.meta.url), "utf8"),
  ]);
  const canonical = JSON.parse(canonicalText);
  for (const [field, property] of [
    ["contract_id", "contractID"],
    ["contract_version", "contractVersion"],
    ["schema_hash", "schemaHash"],
  ]) {
    assert.ok(swift.includes(`${property} == "${canonical[field]}"`), `iOS ${field} must match the canonical contract`);
  }
});
