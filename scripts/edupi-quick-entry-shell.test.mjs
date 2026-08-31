import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const rust = readFileSync(new URL("src-tauri/src/lib.rs", root), "utf8");
const native = readFileSync(new URL("lib/desktop-native.ts", root), "utf8");
const appShell = readFileSync(new URL("components/AppShell.tsx", root), "utf8");

test("tray quick entry shows EduPi and emits one fixed frontend event", () => {
  assert.match(rust, /MenuItem::with_id\(app, "quick_entry", "Quick Entry"/);
  assert.match(rust, /"quick_entry" => \{\s*show_main_window\(app\);\s*let _ = app\.emit\("edupi:\/\/quick-entry", \(\)\);/s);
  assert.match(rust, /\.tooltip\("EduPi"\)/);
  assert.doesNotMatch(rust, /Show Pi Agent|Quit Pi Agent/);
  assert.match(native, /listenQuickEntryNative/);
  assert.match(native, /listen\("edupi:\/\/quick-entry"/);
  assert.match(appShell, /listenQuickEntryNative\(openQuickEntry\)/);
});
