import assert from "node:assert/strict";
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
