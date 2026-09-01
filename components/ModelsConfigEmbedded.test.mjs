import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("models settings can render inline without modal chrome", async () => {
  const source = await read("./ModelsConfig.tsx");

  assert.match(source, /interface ModelsConfigProps[\s\S]+?embedded\?: boolean[\s\S]+?onDirtyChange\?: \(dirty: boolean\) => void[\s\S]+?onSaved\?: \(\) => void/);
  assert.match(source, /export function ModelsConfig\(\{ onClose, embedded = false, onDirtyChange, onSaved \}: ModelsConfigProps\)/);
  assert.match(source, /useModalDismiss<HTMLDivElement>\(requestClose, !embedded\)/);
  assert.match(source, /embedded \? panel : \(/);
  assert.match(source, /role=\{embedded \? undefined : "dialog"\}/);
  assert.match(source, /aria-modal=\{embedded \? undefined : true\}/);
  assert.match(source, /\{!embedded && \(\s*<div className="native-modal-header"/);
  assert.match(source, /\{!embedded && <button className="native-button" onClick=\{requestClose\}>/);
  assert.match(source, /onClick=\{handleSave\}/);
  assert.match(source, /onDirtyChange\?\.\(hasUnsavedChanges\)/);
  assert.match(source, /onDirtyChange\?\.\(false\)/);
  assert.match(source, /savedSnapshotRef\.current = JSON\.stringify\(config\);[\s\S]+?onSaved\?\.\(\)/);
});

test("default models settings keeps its modal backdrop", async () => {
  const source = await read("./ModelsConfig.tsx");

  assert.match(source, /className="native-modal-backdrop"/);
  assert.match(source, /if \(e\.target === e\.currentTarget\) requestClose\(\)/);
  assert.match(source, /native-modal settings-modal models-settings-modal/);
});
