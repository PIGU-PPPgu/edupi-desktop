import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const shortcuts = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./useKeyboardShortcuts.ts");

const event = (overrides = {}) => ({ key: "k", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, isComposing: false, ...overrides });

test("quick entry accepts Cmd+K and Ctrl+K only", () => {
  assert.equal(shortcuts.isQuickEntryShortcut(event()), true);
  assert.equal(shortcuts.isQuickEntryShortcut(event({ metaKey: false, ctrlKey: true, key: "K" })), true);
  for (const value of [
    event({ metaKey: false }),
    event({ altKey: true }),
    event({ shiftKey: true }),
    event({ isComposing: true }),
    event({ key: "n" }),
  ]) assert.equal(shortcuts.isQuickEntryShortcut(value), false);
});
