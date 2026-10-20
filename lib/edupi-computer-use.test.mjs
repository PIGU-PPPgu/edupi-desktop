import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { describeComputerAction, parseComputerUseBridgeResult, validateComputerUseInput } = await jiti.import("./edupi-computer-use.ts");

test("computer-use validation rejects scripts, stale-action shapes, and unsafe key syntax", () => {
  assert.throws(() => validateComputerUseInput({ action: "observe", script: "location.reload()" }), /不支持/);
  assert.throws(() => validateComputerUseInput({ action: "left_click", x: 1, y: 2 }), /snapshot_id/);
  assert.throws(() => validateComputerUseInput({ action: "key", key: "cmd;rm", snapshot_id: "snapshot-a" }), /key/);
  assert.deepEqual(
    validateComputerUseInput({ action: "click_element", ref: 4, snapshot_id: "snapshot-a" }),
    { action: "click_element", ref: 4, snapshot_id: "snapshot-a" },
  );
});

test("approval descriptions expose the concrete action without verbose instructions", () => {
  assert.equal(describeComputerAction({ action: "click_element", ref: 4, snapshot_id: "snapshot-a" }), "click_element 元素 [4]");
  assert.match(describeComputerAction({ action: "type", text: "课堂观察", snapshot_id: "snapshot-a" }), /课堂观察/);
});

test("computer-use bridge accepts only bounded PNG and text results", () => {
  assert.equal(parseComputerUseBridgeResult("not-json").ok, false);
  assert.equal(parseComputerUseBridgeResult({ ok: true, result: { content: "ok", isError: false, operationId: "op", snapshotId: null, images: [] } }).ok, true);
  assert.equal(parseComputerUseBridgeResult({ ok: true, result: { content: "ok", isError: false, operationId: "op", snapshotId: null, images: [{ mediaType: "text/html", data: "bad" }] } }).ok, false);
});

test("native approval requires the main window as its explicit parent", async () => {
  const source = await readFile(new URL("../src-tauri/src/computer_use.rs", import.meta.url), "utf8");
  const confirmation = source.slice(source.indexOf("async fn confirm_native_action"), source.indexOf("fn append_audit"));
  assert.match(confirmation, /get_webview_window\(crate::WINDOW_LABEL\)/);
  assert.match(confirmation, /get_webview_window\(crate::WINDOW_LABEL\)[\s\S]*?\.ok_or_else\([\s\S]*?\?;/);
  assert.match(confirmation, /\.parent\(&parent\)/);
  assert.ok(confirmation.indexOf("get_webview_window") < confirmation.indexOf("spawn_blocking"));
  assert.match(confirmation, /spawn_blocking\(move \|\|[\s\S]*?OkCancelCustom\([\s\S]*?\.blocking_show\(\)/);
});

test("native actions reject an expired lock waiter before showing confirmation", async () => {
  const source = await readFile(new URL("../src-tauri/src/computer_use.rs", import.meta.url), "utf8");
  const execution = source.slice(source.indexOf("pub async fn computer_use_execute"), source.indexOf("#[cfg(test)]"));
  const afterLock = execution.slice(execution.indexOf("state.execution_lock.lock().await;"));
  const beforeConfirmation = afterLock.slice(0, afterLock.indexOf("confirm_native_action"));
  assert.match(beforeConfirmation, /if request_expired\(expires_at_ms\)\s*\{\s*return Err\(/);
  assert.match(execution, /confirm_native_action[\s\S]*?if request_expired\(expires_at_ms\)/);
});
