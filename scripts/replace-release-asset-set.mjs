import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { GitHubReleaseClient, releaseAssetBackupName } from "./replace-release-asset.mjs";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };

async function assertDraft(client, releaseId, tag, target) {
  const [release, releases] = await Promise.all([client.getRelease(releaseId), client.listReleases()]);
  requireValue(release?.id === releaseId && release.tag_name === tag && release.draft === true
    && release.target_commitish === target, "Draft identity changed during asset replacement");
  requireValue(releases.filter(item => item.tag_name === tag).length === 1, "Draft tag is not unique");
}

function expectedNames(tag) {
  requireValue(/^v\d+\.\d+\.\d+$/.test(tag), "Version tag is invalid");
  return [`EduPi_${tag.slice(1)}_aarch64.dmg`, "EduPi_aarch64.app.tar.gz", "EduPi_aarch64.app.tar.gz.sig"];
}

function macAssets(assets, names, releaseId) {
  return assets.filter(asset => names.includes(asset.name)
    || names.some(name => asset.name.startsWith(`${name}.edupi-backup-${releaseId}-`)));
}

async function recoverInterruptedSet(client, releaseId, tag, target, names) {
  await assertDraft(client, releaseId, tag, target);
  const current = macAssets(await client.listAssets(releaseId), names, releaseId);
  const backups = names.map(name => current.filter(asset => asset.name.startsWith(`${name}.edupi-backup-${releaseId}-`)));
  if (backups.every(items => items.length === 0)) return;
  requireValue(backups.every(items => items.length <= 1), "Multiple Mac Draft backups require manual recovery");
  const exact = names.map(name => current.filter(asset => asset.name === name));
  requireValue(exact.every(items => items.length <= 1), "Duplicate Mac Draft assets require manual recovery");
  if (backups.every(items => items.length === 1)) {
    // An interrupted reserve/upload phase still has every original asset.
    for (const items of exact) for (const asset of items) await client.deleteAsset(asset.id);
    for (let index = 0; index < names.length; index++) await client.renameAsset(backups[index][0].id, names[index]);
  } else if (exact.every(items => items.length === 1)
    && backups.every(items => items.length <= 1)) {
    // Backup cleanup began only after all three new assets were read back.
    for (const items of backups) for (const asset of items) await client.deleteAsset(asset.id);
  } else {
    throw new Error("Incomplete Mac Draft asset set requires manual recovery");
  }
  const restored = macAssets(await client.listAssets(releaseId), names, releaseId);
  requireValue(restored.length === names.length && names.every(name => restored.filter(item => item.name === name).length === 1),
    "Interrupted Mac Draft asset set could not be recovered");
}

/** Replace all three Mac Draft assets as one recoverable set. */
export async function replaceMacDraftAssetSet({ client, releaseId, tag, target, files, log = console.log }) {
  const names = expectedNames(tag);
  requireValue(Number.isSafeInteger(releaseId) && releaseId > 0 && /^[a-f0-9]{40}$/.test(target), "Draft target is invalid");
  requireValue(Array.isArray(files) && files.length === names.length, "Three Mac assets are required");
  const inputs = names.map(name => {
    const item = files.find(file => file.name === name);
    requireValue(item && Buffer.isBuffer(item.bytes) && item.bytes.length > 0, `Missing ${name}`);
    return { name, bytes: item.bytes, digest: `sha256:${sha256(item.bytes)}` };
  });
  requireValue(new Set(files.map(file => file.name)).size === names.length, "Duplicate Mac asset input");
  await assertDraft(client, releaseId, tag, target);
  await recoverInterruptedSet(client, releaseId, tag, target, names);
  const initial = macAssets(await client.listAssets(releaseId), names, releaseId);
  requireValue(initial.length === names.length && names.every(name => initial.filter(item => item.name === name).length === 1),
    "Draft must contain exactly the three original Mac assets");
  const original = new Map(names.map(name => [name, initial.find(item => item.name === name)]));
  let commitStarted = false;
  try {
    for (const item of inputs) {
      await assertDraft(client, releaseId, tag, target);
      const old = original.get(item.name);
      const backupName = releaseAssetBackupName(item.name, releaseId, old.id);
      const renamed = await client.renameAsset(old.id, backupName);
      requireValue(renamed?.id === old.id && renamed.name === backupName, `Could not reserve ${item.name}`);
    }
    const uploaded = new Map();
    for (const item of inputs) {
      await assertDraft(client, releaseId, tag, target);
      const remote = await client.uploadAsset(releaseId, item.name, item.bytes);
      requireValue(Number.isSafeInteger(remote?.id) && remote.id > 0 && remote.name === item.name
        && remote.size === item.bytes.length && (!remote.digest || remote.digest === item.digest),
      `Uploaded ${item.name} identity is invalid`);
      const readback = await client.downloadAsset(remote.id);
      requireValue(readback.length === item.bytes.length && `sha256:${sha256(readback)}` === item.digest,
        `Uploaded ${item.name} bytes do not match`);
      uploaded.set(item.name, remote.id);
    }
    const staged = macAssets(await client.listAssets(releaseId), names, releaseId);
    requireValue(staged.length === 2 * names.length && inputs.every(item =>
      staged.some(asset => asset.name === item.name && asset.id === uploaded.get(item.name))
      && staged.some(asset => asset.name === releaseAssetBackupName(item.name, releaseId, original.get(item.name).id)
        && asset.id === original.get(item.name).id)), "Complete replacement set was not staged");
    await assertDraft(client, releaseId, tag, target);
    commitStarted = true;
    for (const item of inputs) await client.deleteAsset(original.get(item.name).id);
    const final = macAssets(await client.listAssets(releaseId), names, releaseId);
    requireValue(final.length === names.length && inputs.every(item =>
      final.some(asset => asset.name === item.name && asset.id === uploaded.get(item.name)
        && asset.size === item.bytes.length && (!asset.digest || asset.digest === item.digest))),
    "Final Mac Draft asset set is not exact");
    await assertDraft(client, releaseId, tag, target);
    log(`Replaced and verified the three Mac Draft assets for ${tag}`);
    return inputs.map(item => ({ name: item.name, id: uploaded.get(item.name), size: item.bytes.length, digest: item.digest }));
  } catch (error) {
    if (commitStarted) throw new Error("Verified Mac assets exist, but backup cleanup is incomplete; keep the release Draft", { cause: error });
    try {
      await assertDraft(client, releaseId, tag, target);
      const current = macAssets(await client.listAssets(releaseId), names, releaseId);
      for (const name of names) {
        for (const asset of current.filter(item => item.name === name && item.id !== original.get(name).id)) {
          await client.deleteAsset(asset.id);
        }
      }
      for (const name of names) {
        const old = original.get(name);
        const still = (await client.listAssets(releaseId)).find(item => item.id === old.id);
        requireValue(still, `Original ${name} disappeared`);
        if (still.name !== name) await client.renameAsset(old.id, name);
      }
      const restored = macAssets(await client.listAssets(releaseId), names, releaseId);
      requireValue(restored.length === names.length && names.every(name =>
        restored.some(item => item.name === name && item.id === original.get(name).id)), "Original Mac asset set was not restored");
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "Mac asset replacement and rollback failed; keep the release Draft");
    }
    throw new Error("Mac asset replacement failed; the original Draft set was restored", { cause: error });
  }
}

function parseArgs(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    requireValue(args[index]?.startsWith("--") && args[index + 1], "Invalid Mac asset replacement argument");
    values[args[index].slice(2)] = args[index + 1];
  }
  return values;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const releaseId = Number(args["release-id"]);
  const names = expectedNames(args.tag);
  const paths = [args.dmg, args.updater, args.signature];
  const files = await Promise.all(paths.map(async (file, index) => {
    requireValue(typeof file === "string", `Missing ${names[index]} path`);
    const metadata = await stat(file);
    requireValue(metadata.isFile() && metadata.size > 0, `Invalid ${names[index]} file`);
    return { name: names[index], bytes: await readFile(file) };
  }));
  const client = new GitHubReleaseClient({ repository: args.repository, token: process.env.GH_TOKEN });
  await replaceMacDraftAssetSet({ client, releaseId, tag: args.tag, target: args.target, files });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`::error::${error.message}`); process.exitCode = 1; });
}
