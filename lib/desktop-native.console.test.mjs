import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { showOpenConnectorConsole, confirmMaterialScheduleNative } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./desktop-native.ts");

test("native Console command rejects unbounded ports and is unavailable in a normal browser", async () => {
  for (const port of [0, -1, 65_536, 4.5, Number.NaN]) {
    await assert.rejects(showOpenConnectorConsole(port), /invalid_console_port/u);
  }
  await assert.rejects(showOpenConnectorConsole(32_999), /desktop_only/u);
});

test("material adoption confirmation is bounded, native-only and forwards explicit allow or cancel", async () => {
  for (const count of [0, -1, 201, 2.5, Number.NaN]) await assert.rejects(confirmMaterialScheduleNative(count), /invalid_material_schedule_count/u);
  await assert.rejects(confirmMaterialScheduleNative(2), /desktop_only/u);
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window"), calls = [];
  let answer = "取消";
  Object.defineProperty(globalThis, "window", { configurable: true, value: { __TAURI_INTERNALS__: { invoke: async (command, args) => {
    calls.push({ command, args }); return answer;
  } } } });
  try {
    assert.equal(await confirmMaterialScheduleNative(2), false);
    answer = "确认采用";
    assert.equal(await confirmMaterialScheduleNative(2), true);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].command, "plugin:dialog|message");
    assert.deepEqual(calls[0].args.buttons, { OkCancelCustom: ["确认采用", "取消"] });
    assert.equal(calls[0].args.message, "采用这 2 项安排？");
  } finally { if (previous) Object.defineProperty(globalThis, "window", previous); else delete globalThis.window; }
});
