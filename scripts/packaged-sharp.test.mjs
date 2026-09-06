import assert from "node:assert/strict";
import { mkdtemp, mkdir, access, rm } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import { removeUnusedMuslSharp } from "./packaged-sharp.mjs";

test("glibc packaging removes only the unused musl Sharp variants", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "edupi-sharp-"));
  const names = ["sharp-linuxmusl-x64", "sharp-libvips-linuxmusl-x64", "sharp-linux-x64", "sharp-libvips-linux-x64"];
  try {
    for (const name of names) await mkdir(join(root, "node_modules", "@img", name), { recursive: true });
    await removeUnusedMuslSharp(root, { platform: "linux", arch: "x64", glibc: false });
    for (const name of names) await access(join(root, "node_modules", "@img", name));
    await removeUnusedMuslSharp(root, { platform: "linux", arch: "x64", glibc: true });
    for (const name of names.slice(0, 2)) await assert.rejects(access(join(root, "node_modules", "@img", name)));
    for (const name of names.slice(2)) await access(join(root, "node_modules", "@img", name));
  } finally { await rm(root, { recursive: true, force: true }); }
});
