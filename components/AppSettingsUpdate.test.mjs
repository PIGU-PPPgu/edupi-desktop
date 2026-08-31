import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppSettings.tsx", import.meta.url), "utf8");

test("settings exposes manual update checks and the signed installer action", () => {
  assert.match(source, /appSettings\.checkUpdates/);
  assert.match(source, /fetch\("\/api\/updates\?refresh=1"/);
  assert.match(source, /hasAppUpdateCheckError\(data, "edupi-desktop"\)/);
  assert.match(source, /installLatestDesktopRelease/);
  assert.match(source, /appSettings\.update/);
});
