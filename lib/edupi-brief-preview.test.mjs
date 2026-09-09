import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { briefPreview } = await createJiti(import.meta.url).import("./edupi-brief-preview.ts");
test("brief preview shows names without Markdown or internal URLs", () => {
  const text = briefPreview("# 早安简报 · 2026-09-09 ## 今日课程 - [数学](?edupi=1&task=abc) ## 准备材料 - [教案](../out/a.md)");
  assert.equal(text, "今日课程 · 数学 · 准备材料 · 教案");
  assert.doesNotMatch(briefPreview("# 早安简报 · 2026-09-09 ## 今日课程 - [数学](?edupi=1&task=truncated"), /edupi|task=|\[/);
});
