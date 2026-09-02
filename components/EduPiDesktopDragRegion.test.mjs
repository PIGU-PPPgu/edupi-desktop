import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("EduPi desktop mode owns a dedicated top drag row without covering controls", async () => {
  const [panel, css, capability] = await Promise.all([
    read("./EduPiEducationPanel.tsx"),
    read("../app/edupi-workbench.css"),
    read("../src-tauri/capabilities/window-controls.json"),
  ]);

  assert.match(panel, /useDesktopChrome\(\)/);
  assert.match(panel, /has-desktop-drag-region/);
  assert.match(panel, /className="edupi-window-drag-region"/);
  assert.match(panel, /\{\.\.\.desktopChrome\.dragRegionProps\}/);
  assert.match(panel, /<WindowControls \/>/);
  assert.match(capability, /core:window:allow-start-dragging/);

  assert.match(css, /\.edupi-teacher-shell\.has-desktop-drag-region\s*\{[^}]*grid-template-rows:\s*28px minmax\(0, 1fr\)/s);
  assert.match(css, /\.edupi-window-drag-region\s*\{[^}]*grid-column:\s*1\s*\/\s*-1[^}]*grid-row:\s*1/s);
  assert.match(css, /\.edupi-teacher-shell\.has-desktop-drag-region \.edupi-teacher-rail\s*\{[^}]*grid-row:\s*2/s);
  assert.match(css, /\.edupi-teacher-shell\.has-desktop-drag-region \.edupi-teacher-app\s*\{[^}]*grid-row:\s*2/s);
  assert.doesNotMatch(css, /\.edupi-window-drag-region[^}]*position:\s*(?:fixed|absolute)/s);
});
