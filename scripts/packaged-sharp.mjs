import { rm } from "node:fs/promises";
import { join } from "node:path";

// Next traces both libc variants; linuxdeploy tries to link even unused ELF files.
export async function removeUnusedMuslSharp(serverRoot, {
  platform = process.platform,
  arch = process.arch,
  glibc = Boolean(process.report?.getReport().header.glibcVersionRuntime),
} = {}) {
  if (platform !== "linux" || !glibc || !["x64", "arm64"].includes(arch)) return;
  for (const name of [`sharp-linuxmusl-${arch}`, `sharp-libvips-linuxmusl-${arch}`]) {
    await rm(join(serverRoot, "node_modules", "@img", name), { recursive: true, force: true });
  }
}
