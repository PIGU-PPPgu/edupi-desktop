import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createJiti } from "jiti";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
const { EduPiRuntimeFlow } = await createJiti(import.meta.url, { jsx: true }).import("./EduPiRuntimeFlow.tsx");
test("runtime flow is absent when idle and reflects actual flags", () => {
  const render = props => renderToStaticMarkup(createElement(EduPiRuntimeFlow, props));
  assert.equal(render({ running: false, toolRunning: false, compacting: false }), "");
  assert.match(render({ running: true, toolRunning: false, compacting: false }), /处理中/);
  assert.match(render({ running: true, toolRunning: true, compacting: false }), /执行命令/);
  assert.match(render({ running: true, toolRunning: false, compacting: false, activeTools: ["read", "write"] }), /执行工具：read、write/);
  assert.equal(render({ running: false, toolRunning: false, compacting: false, activeTools: ["read"] }), "");
  assert.match(render({ running: true, toolRunning: false, compacting: true }), /整理上下文/);
});
test("graph motion is finite and reduced-motion is respected", async () => {
  const css = await readFile(new URL("../app/edupi-motion.css", import.meta.url), "utf8");
  assert.match(css, /ease-out 1/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});
