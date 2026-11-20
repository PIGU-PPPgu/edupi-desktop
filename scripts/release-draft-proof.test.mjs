import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { draftAssetFingerprint, verifyDraftReleaseProof } from "./release-draft-proof.mjs";
import { requiredReleaseAssetNames } from "./updater-manifest.mjs";

const version = "0.3.47";
const releaseId = 100;
const targetSha = "a".repeat(40);
const draftRunId = 200;
const createdAt = "2026-09-27T10:01:00Z";
const run = {
  id: draftRunId, head_sha: targetSha, path: ".github/workflows/release.yml",
  event: "workflow_dispatch", status: "completed", conclusion: "success",
  created_at: "2026-09-27T10:00:00Z", run_attempt: 1,
  run_started_at: "2026-09-27T10:00:00Z", updated_at: "2026-09-27T10:05:00Z",
};
const jobs = ["release", "build (aarch64-apple-darwin)", "build (x86_64-unknown-linux-gnu)",
  "build (x86_64-pc-windows-msvc)", "draft-proof"].map((name) => ({ name, status: "completed", conclusion: "success" }));
const assets = requiredReleaseAssetNames(version).map((name, index) => ({
  name, id: index + 1, size: 100 + index, digest: `sha256:${String(index).padStart(64, "0")}`,
  created_at: createdAt, updated_at: createdAt,
}));
const acceptedFingerprint = draftAssetFingerprint({ version, releaseId, assets, runStartedAt: run.run_started_at });
const input = { version, releaseId, targetSha, draftRunId, acceptedFingerprint, run, jobs, assets };

test("a successful three-platform draft accepts only the installed asset identity", () => {
  assert.equal(verifyDraftReleaseProof(input), acceptedFingerprint);
});

test("a successful macOS-only draft accepts only its signed assets", () => {
  const macAssets = requiredReleaseAssetNames(version, "macos").map((name, index) => ({
    name, id: index + 1, size: 100 + index, digest: `sha256:${String(index).padStart(64, "0")}`,
    created_at: createdAt, updated_at: createdAt,
  }));
  const macJobs = ["release", "build (aarch64-apple-darwin)"].map((name) => ({
    name, status: "completed", conclusion: "success",
  }));
  const macFingerprint = draftAssetFingerprint({
    version, releaseId, assets: macAssets, runStartedAt: run.run_started_at, platform: "macos",
  });
  assert.equal(verifyDraftReleaseProof({
    ...input, assets: macAssets, jobs: macJobs, acceptedFingerprint: macFingerprint, platform: "macos",
  }), macFingerprint);
  assert.throws(() => verifyDraftReleaseProof({
    ...input, assets: macAssets, jobs: [{ name: "release", status: "completed", conclusion: "success" }],
    acceptedFingerprint: macFingerprint, platform: "macos",
  }), /Required draft builders/);
});

test("fingerprint CLI records an active selective rerun without requiring its own job to finish", (t) => {
  const root = mkdtempSync(join(tmpdir(), "release-draft-proof-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const active = { ...run, status: "in_progress", conclusion: null, run_attempt: 2,
    run_started_at: "2026-09-27T10:04:00Z" };
  const runFile = join(root, "run.json"), assetFile = join(root, "assets.json");
  writeFileSync(runFile, JSON.stringify(active));
  writeFileSync(assetFile, JSON.stringify(assets));
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./release-draft-proof.mjs", import.meta.url)),
    "fingerprint", "--version", version, "--release-id", String(releaseId),
    "--run-json", runFile, "--assets-json", assetFile], { encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), acceptedFingerprint);
  assert.deepEqual(JSON.parse(readFileSync(runFile, "utf8")), active);
  assert.throws(() => verifyDraftReleaseProof({ ...input, run: active }), /Successful commit-bound/);
});

test("a successful selective rerun accepts retained builders but rejects assets from before the dispatch", () => {
  const rerun = { ...run, run_attempt: 2, run_started_at: "2026-09-27T10:04:00Z" };
  const retained = assets.map((asset) => /\.exe(?:\.sig)?$/u.test(asset.name)
    ? { ...asset, created_at: "2026-09-27T10:04:15Z", updated_at: "2026-09-27T10:04:20Z" } : asset);
  assert.equal(verifyDraftReleaseProof({ ...input, run: rerun, assets: retained }), acceptedFingerprint);
  const stale = retained.map((asset, index) => index === 0
    ? { ...asset, created_at: "2026-09-27T09:59:59Z" } : asset);
  assert.throws(() => verifyDraftReleaseProof({ ...input, run: rerun, assets: stale }), /identity is invalid/);
});

test("draft proof rejects an attempt that starts after the completed run was updated", () => {
  assert.throws(() => verifyDraftReleaseProof({ ...input,
    run: { ...run, run_attempt: 2, run_started_at: "2026-09-27T10:05:01Z" } }),
  /Successful commit-bound draft run is required/);
});

test("draft proof requires an original dispatch time no later than the current attempt", () => {
  for (const created_at of [undefined, null, "invalid", "2026-09-27T10:04:01Z"]) {
    assert.throws(() => verifyDraftReleaseProof({ ...input,
      run: { ...run, run_attempt: 2, run_started_at: "2026-09-27T10:04:00Z", created_at } }),
    /Draft run creation\/start identity is invalid/);
  }
});

test("a notarization or other platform failure cannot be published", () => {
  for (const name of ["build (aarch64-apple-darwin)", "build (x86_64-pc-windows-msvc)", "draft-proof"]) {
    const failed = jobs.map((job) => job.name === name ? { ...job, conclusion: "failure" } : job);
    assert.throws(() => verifyDraftReleaseProof({ ...input, jobs: failed }), /did not succeed/);
  }
  for (const conclusion of ["failure", "cancelled", "timed_out"]) {
    assert.throws(() => verifyDraftReleaseProof({ ...input, run: { ...run, run_attempt: 2, conclusion } }), /Successful commit-bound/);
  }
});

test("another release, commit or later replacement cannot inherit draft acceptance", () => {
  assert.throws(() => verifyDraftReleaseProof({ ...input, releaseId: releaseId + 1 }), /changed after installation/);
  assert.throws(() => verifyDraftReleaseProof({ ...input, targetSha: "b".repeat(40) }), /Successful commit-bound/);
  const replaced = assets.map((asset, index) => index === 0 ? { ...asset, id: 99 } : asset);
  assert.throws(() => verifyDraftReleaseProof({ ...input, assets: replaced }), /changed after installation/);
  const later = assets.map((asset, index) => index === 0 ? { ...asset, updated_at: "2026-09-27T10:06:00Z" } : asset);
  assert.throws(() => verifyDraftReleaseProof({ ...input, assets: later }), /changed after the successful build/);
});

test("draft proof rejects incomplete, duplicated and undigested assets", () => {
  assert.throws(() => draftAssetFingerprint({ version, releaseId, runStartedAt: run.run_started_at,
    assets: assets.slice(1) }), /incomplete/);
  assert.throws(() => draftAssetFingerprint({ version, releaseId, runStartedAt: run.run_started_at,
    assets: assets.map((asset, index) => index === 1 ? { ...asset, id: 1 } : asset) }), /identity is invalid/);
  assert.throws(() => draftAssetFingerprint({ version, releaseId, runStartedAt: run.run_started_at,
    assets: assets.map((asset, index) => index === 1 ? { ...asset, digest: null } : asset) }), /identity is invalid/);
  assert.throws(() => draftAssetFingerprint({ version, releaseId, runStartedAt: run.run_started_at,
    assets: assets.map((asset, index) => index === 1 ? { ...asset, created_at: "2026-09-27T09:59:59Z" } : asset) }), /identity is invalid/);
});
