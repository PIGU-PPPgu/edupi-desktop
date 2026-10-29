import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { replaceMacDraftAssetSet } from "./replace-release-asset-set.mjs";

const tag = "v0.3.88";
const target = "a".repeat(40);
const releaseId = 42;
const names = ["EduPi_0.3.88_aarch64.dmg", "EduPi_aarch64.app.tar.gz", "EduPi_aarch64.app.tar.gz.sig"];
const digest = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const input = names.map(name => ({ name, bytes: Buffer.from(`new-${name}`) }));

function fakeClient({ failUpload, corruptDownload, failCleanup, concurrentOtherUpload = false } = {}) {
  const state = new Map(names.map((name, index) => [index + 1, { id: index + 1, name, bytes: Buffer.from(`old-${name}`) }]));
  state.set(4, { id: 4, name: "EduPi_0.3.88_x64-setup.exe", bytes: Buffer.from("unrelated-windows-asset") });
  let nextId = 10;
  const result = item => ({ id: item.id, name: item.name, size: item.bytes.length, digest: digest(item.bytes) });
  return {
    state,
    async getRelease() { return { id: releaseId, tag_name: tag, draft: true, target_commitish: target }; },
    async listReleases() { return [await this.getRelease()]; },
    async listAssets() { return [...state.values()].map(result); },
    async renameAsset(id, name) { const item = state.get(id); assert.ok(item); item.name = name; return result(item); },
    async deleteAsset(id) { if (failCleanup && id === 2) throw new Error("synthetic cleanup outage"); state.delete(id); },
    async uploadAsset(_releaseId, name, bytes) {
      if (name === failUpload) throw new Error("synthetic upload outage");
      if (concurrentOtherUpload && !state.has(99)) state.set(99, { id: 99, name: "EduPi_0.3.88_amd64.deb", bytes: Buffer.from("concurrent-linux-asset") });
      const item = { id: nextId++, name, bytes: Buffer.from(bytes) }; state.set(item.id, item); return result(item);
    },
    async downloadAsset(id) { const item = state.get(id); assert.ok(item); return corruptDownload === item.name ? Buffer.from("corrupt") : Buffer.from(item.bytes); },
  };
}

test("the three verified Mac assets commit together while other platforms upload independently", async () => {
  const client = fakeClient({ concurrentOtherUpload: true });
  const accepted = await replaceMacDraftAssetSet({ client, releaseId, tag, target, files: input, log() {} });
  assert.deepEqual(accepted.map(item => item.name), names);
  assert.equal(client.state.size, 5);
  assert.equal(client.state.get(4).name, "EduPi_0.3.88_x64-setup.exe");
  assert.equal(client.state.get(99).name, "EduPi_0.3.88_amd64.deb");
  for (const name of names) {
    const remote = [...client.state.values()].find(item => item.name === name);
    assert.ok(remote.id >= 10);
    assert.deepEqual(remote.bytes, input.find(item => item.name === name).bytes);
  }
});

for (const failure of [
  { failUpload: names[1] },
  { corruptDownload: names[2] },
]) {
  test("a partial asset replacement restores the exact old set", async () => {
    const client = fakeClient(failure);
    await assert.rejects(replaceMacDraftAssetSet({ client, releaseId, tag, target, files: input, log() {} }), /original Draft set was restored/);
    assert.equal(client.state.size, 4);
    names.forEach((name, index) => {
      const old = client.state.get(index + 1);
      assert.equal(old.name, name);
      assert.deepEqual(old.bytes, Buffer.from(`old-${name}`));
    });
  });
}

test("backup cleanup failure keeps the run red with all three new exact-name assets", async () => {
  const client = fakeClient({ failCleanup: true });
  await assert.rejects(replaceMacDraftAssetSet({ client, releaseId, tag, target, files: input, log() {} }), /backup cleanup is incomplete/);
  for (const name of names) assert.equal([...client.state.values()].filter(item => item.name === name && item.id >= 10).length, 1);
});

test("an interrupted full reserve is restored before a new exact set is uploaded", async () => {
  const client = fakeClient();
  for (let index = 0; index < names.length; index++) {
    await client.renameAsset(index + 1, `${names[index]}.edupi-backup-${releaseId}-${index + 1}`);
  }
  await client.uploadAsset(releaseId, names[0], Buffer.from("interrupted-new-dmg"));
  await replaceMacDraftAssetSet({ client, releaseId, tag, target, files: input, log() {} });
  assert.equal(client.state.size, 4);
  for (const name of names) assert.deepEqual([...client.state.values()].find(item => item.name === name).bytes, input.find(item => item.name === name).bytes);
});

test("leftover backups after partial commit cleanup are removed before replacing the exact set", async () => {
  const client = fakeClient();
  for (let index = 1; index < names.length; index++) await client.renameAsset(index + 1, `${names[index]}.edupi-backup-${releaseId}-${index + 1}`);
  await client.deleteAsset(1);
  for (const name of names) await client.uploadAsset(releaseId, name, Buffer.from(`previous-new-${name}`));
  await replaceMacDraftAssetSet({ client, releaseId, tag, target, files: input, log() {} });
  assert.equal(client.state.size, 4);
  for (const name of names) assert.deepEqual([...client.state.values()].find(item => item.name === name).bytes, input.find(item => item.name === name).bytes);
});

test("an incomplete backup reservation fails before mutating the Draft", async () => {
  const client = fakeClient();
  await client.renameAsset(1, `${names[0]}.edupi-backup-${releaseId}-1`);
  const before = await client.listAssets();
  await assert.rejects(replaceMacDraftAssetSet({ client, releaseId, tag, target, files: input, log() {} }), /manual recovery/);
  assert.deepEqual(await client.listAssets(), before);
});
