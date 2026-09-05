import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });

test("native clipboard fallback keeps the upstream RGBA to PNG adapter and capability", async () => {
  const source = await readFile(new URL("./desktop-native.ts", import.meta.url), "utf8");
  const capability = await readFile(new URL("../src-tauri/capabilities/desktop-dialog.json", import.meta.url), "utf8");

  assert.match(source, /plugin-clipboard-manager/);
  assert.match(source, /await readImage\(\)/);
  assert.match(source, /await img\.rgba\(\)/);
  assert.match(source, /new ImageData\(new Uint8ClampedArray\(rgba\), width, height\)/);
  assert.match(source, /canvas\.toBlob\(resolve, "image\/png"\)/);
  assert.match(source, /if \(!width \|\| !height \|\| rgba\.byteLength < width \* height \* 4\) return null/);
  assert.match(capability, /clipboard-manager:allow-read-image/);
  assert.match(capability, /core:image:allow-rgba/);
  assert.match(capability, /core:image:allow-size/);
});

test("native clipboard image adapter returns null outside the Tauri shell", async () => {
  const { readClipboardImageFileNative } = await jiti.import("./desktop-native.ts");
  assert.equal(await readClipboardImageFileNative(), null);
});
