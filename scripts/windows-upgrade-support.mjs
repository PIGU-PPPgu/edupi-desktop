import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

// Frozen 116 is an input, never rebuilt or replaced by this acceptance job.
export const OLD = Object.freeze({
  repository: "PIGU-PPPgu/edupi-desktop",
  version: "0.3.116",
  releaseId: "447334004",
  assetId: "756302414",
  sourceSha: "13de2b53d08d487a6abceb91ec1e37bd919af690",
  sha256: "73f83b411b0d461fe5bb6c632a57d02799a4efc0f930104a6b1e8ef3b6dbaa06",
  name: "EduPi_0.3.116_x64-setup.exe",
  coreSha: "98e4f7cd0c31dd30954574d2040bb1b948cdd954",
});
// Primary source: tauri-apps/tauri, tag tauri-driver-v2.0.4,
// crates/tauri-driver/{Cargo.toml,src/{cli,server,webdriver}.rs}.
// crates.io/api/v1/crates/tauri-driver/2.0.4 confirms this immutable checksum.
export const TAURI_DRIVER = Object.freeze({
  version: "2.0.4",
  crateSha256: "bd0026bedc494cb741aad08e3aa248f2ce5a812b7b35bb9904f22e817ea58a5f",
});
export function requireValue(condition, code) {
  if (!condition) throw new Error(code);
}

export function validateId(value) {
  requireValue(typeof value === "string" && /^[1-9][0-9]{0,18}$/u.test(value), "invalid_numeric_id");
  requireValue(BigInt(value) <= 9_223_372_036_854_775_807n, "invalid_numeric_id");
  return value;
}

export function validateHash(value, length = 64) {
  requireValue(typeof value === "string" && new RegExp(`^[a-f0-9]{${length}}$`, "u").test(value), "invalid_hash");
  return value;
}

export function validateCohortUrl(value) {
  requireValue(typeof value === "string"
    && /^https:\/\/raw\.githubusercontent\.com\/PIGU-PPPgu\/edupi-desktop\/[a-f0-9]{40}\/docs\/acceptance\/update-cohorts\/[a-z0-9][a-z0-9-]{0,63}\.json$/u.test(value),
  "invalid_immutable_first_party_cohort");
  requireValue(new URL(value).href === value, "invalid_immutable_first_party_cohort");
  return value;
}

export function readInputs(env) {
  const mode = env.WINDOWS_UPGRADE_MODE || "preflight";
  requireValue(["preflight", "upgrade"].includes(mode), "invalid_mode");
  const names = ["TARGET_RELEASE_ID", "TARGET_ASSET_ID", "TARGET_SOURCE_SHA", "TARGET_ASSET_SHA256", "COHORT_URL"];
  const supplied = names.some(name => Boolean(env[`WINDOWS_UPGRADE_${name}`]));
  if (mode === "preflight") {
    requireValue(!supplied, "preflight_does_not_accept_target_inputs");
    return { mode, target: null };
  }
  const target = {
    releaseId: validateId(env.WINDOWS_UPGRADE_TARGET_RELEASE_ID),
    assetId: validateId(env.WINDOWS_UPGRADE_TARGET_ASSET_ID),
    sourceSha: validateHash(env.WINDOWS_UPGRADE_TARGET_SOURCE_SHA, 40),
    sha256: validateHash(env.WINDOWS_UPGRADE_TARGET_ASSET_SHA256),
    cohortUrl: validateCohortUrl(env.WINDOWS_UPGRADE_COHORT_URL),
    version: "0.3.117",
  };
  // Validation is not publication, public asset verification, or execution.
  return { mode, target };
}

export function versionBuild(value) {
  requireValue(typeof value === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(value),
    "invalid_runtime_version");
  return value.split(".").slice(0, 3).join(".");
}

export function assertDriverVersion(runtime, driver) {
  requireValue(versionBuild(runtime) === versionBuild(driver), "webview2_driver_build_mismatch");
}

export function assertOldAsset(release) {
  requireValue(release && String(release.id) === OLD.releaseId
    && release.tag_name === `v${OLD.version}` && release.target_commitish === OLD.sourceSha,
  "frozen_release_identity_mismatch");
  requireValue(typeof release.draft === "boolean", "invalid_release_visibility");
  const assets = (release.assets || []).filter(asset => String(asset.id) === OLD.assetId);
  requireValue(assets.length === 1, "frozen_asset_not_unique");
  const asset = assets[0];
  const normalDownload = `https://github.com/${OLD.repository}/releases/download/v${OLD.version}/${OLD.name}`;
  // GitHub may retain the original untagged asset URL after a Draft tag_name
  // metadata repair. This exception is Draft-only and never a download input.
  const repairedDraftDownload = release.draft && new RegExp(
    `^https://github\\.com/PIGU-PPPgu/edupi-desktop/releases/download/untagged-[a-f0-9]{20}/EduPi_0\\.3\\.116_x64-setup\\.exe$`, "u",
  ).test(asset.browser_download_url);
  requireValue(asset.name === OLD.name && asset.state === "uploaded"
    && asset.digest === `sha256:${OLD.sha256}` && Number.isSafeInteger(asset.size)
    && asset.size > 0 && asset.size <= 2_147_483_648
    && asset.url === `https://api.github.com/repos/${OLD.repository}/releases/assets/${OLD.assetId}`
    && (asset.browser_download_url === normalDownload || repairedDraftDownload),
  "frozen_asset_metadata_mismatch");
  return { id: OLD.assetId, size: asset.size, sha256: OLD.sha256, draft: release.draft };
}

function validateDownloadRedirect(value) {
  const url = new URL(value);
  requireValue(url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash
    && ["release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(url.hostname),
  "untrusted_asset_redirect");
  return url.href;
}

// A bearer token is used only at api.github.com. It is never forwarded to a
// signed CDN URL, written to evidence, or included in an App environment.
export async function downloadOldInstaller({ token, directory, fetcher = fetch }) {
  requireValue(typeof token === "string" && token.length > 0 && !/[\r\n]/u.test(token), "download_token_required");
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28" };
  const response = await fetcher(`https://api.github.com/repos/${OLD.repository}/releases/${OLD.releaseId}`, {
    headers, redirect: "error", signal: AbortSignal.timeout(30_000),
  });
  requireValue(response.ok, "frozen_release_lookup_failed");
  const metadata = assertOldAsset(await response.json());
  let bytes = await fetcher(`https://api.github.com/repos/${OLD.repository}/releases/assets/${OLD.assetId}`, {
    headers: { ...headers, Accept: "application/octet-stream" }, redirect: "manual",
    signal: AbortSignal.timeout(1_200_000),
  });
  if ([301, 302, 303, 307, 308].includes(bytes.status)) {
    const location = validateDownloadRedirect(bytes.headers.get("location"));
    await bytes.body?.cancel();
    bytes = await fetcher(location, {
      headers: { Accept: "application/octet-stream" }, redirect: "error", signal: AbortSignal.timeout(1_200_000),
    });
  }
  requireValue(bytes.ok && bytes.body, "frozen_installer_download_failed");
  const destination = path.join(directory, OLD.name);
  await saveVerifiedDownload(bytes, destination, metadata);
  return { ...metadata, name: OLD.name, sourceSha: OLD.sourceSha, version: OLD.version };
}

export async function saveVerifiedDownload(response, destination, expected) {
  validateHash(expected.sha256);
  requireValue(Number.isSafeInteger(expected.size) && expected.size > 0 && expected.size <= 2_147_483_648,
    "invalid_expected_asset_size");
  requireValue(!fs.existsSync(destination), "exclusive_asset_destination_required");
  const temporary = `${destination}.partial`;
  const fd = fs.openSync(temporary, "wx", 0o600);
  let size = 0;
  const hash = crypto.createHash("sha256");
  const measure = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length;
      if (size > expected.size) return callback(new Error("frozen_asset_size_exceeded"));
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(response.body), measure, fs.createWriteStream(temporary, { fd, autoClose: true }));
    requireValue(size === expected.size && hash.digest("hex") === expected.sha256, "frozen_asset_bytes_mismatch");
    fs.renameSync(temporary, destination);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

export function safeCode(error, fallback = "unexpected_failure") {
  const text = error instanceof Error ? error.message : "";
  return /^[a-z][a-z0-9_]{0,99}$/u.test(text) ? text : fallback;
}

export function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

async function main() {
  let proof = { status: "blocked", code: "download_not_started", old: OLD, driverRequirement: TAURI_DRIVER,
    actualUpgradePassed: false };
  const evidenceDir = process.env.WINDOWS_UPGRADE_EVIDENCE_DIR;
  const downloadDir = process.env.WINDOWS_UPGRADE_DOWNLOAD_DIR;
  requireValue(evidenceDir && downloadDir && path.isAbsolute(evidenceDir) && path.isAbsolute(downloadDir)
    && path.dirname(evidenceDir) === path.dirname(downloadDir) && evidenceDir !== downloadDir,
  "exclusive_sibling_evidence_and_download_directories_required");
  // Both directories are newly allocated; never overwrite another run.
  if (fs.existsSync(evidenceDir)) {
    const bootstrap = JSON.parse(fs.readFileSync(path.join(evidenceDir, "windows-upgrade-job.json"), "utf8"));
    requireValue(bootstrap.runId === validateId(process.env.GITHUB_RUN_ID)
      && bootstrap.attempt === validateId(process.env.GITHUB_RUN_ATTEMPT)
      && bootstrap.verifier === validateHash(process.env.GITHUB_SHA, 40)
      && !fs.existsSync(path.join(evidenceDir, "windows-upgrade-download.json")), "exclusive_run_evidence_required");
  } else fs.mkdirSync(evidenceDir, { mode: 0o700 });
  const evidence = path.join(evidenceDir, "windows-upgrade-download.json");
  try {
    const inputs = readInputs(process.env);
    proof.mode = inputs.mode;
    fs.mkdirSync(downloadDir, { mode: 0o700 });
    fs.writeFileSync(path.join(downloadDir, ".windows-upgrade-owned"), OLD.sha256, { flag: "wx", mode: 0o600 });
    proof = { ...proof, status: "downloaded_and_verified", code: null,
      asset: await downloadOldInstaller({ token: process.env.GH_TOKEN, directory: downloadDir }) };
  } catch (error) {
    proof = { ...proof, status: "blocked", code: safeCode(error) };
    process.exitCode = 1;
  } finally {
    writeJson(evidence, proof);
    console.log(JSON.stringify({ status: proof.status, code: proof.code }));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== "download" || process.argv.length !== 3) {
    console.error("usage: node scripts/windows-upgrade-support.mjs download");
    process.exitCode = 1;
  } else await main().catch(error => {
    console.error(JSON.stringify({ status: "blocked", code: safeCode(error) }));
    process.exitCode = 1;
  });
}
