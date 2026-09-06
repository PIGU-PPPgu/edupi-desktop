import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Today shows brief freshness and real scheduler state without readiness duplication", async () => {
  const [panel, views, css] = await Promise.all([read("./EduPiEducationPanel.tsx"), read("./EduPiWorkspaceViews.tsx"), read("../app/edupi-workbench.css")]);
  assert.match(panel, /readEduPiKernel/);
  assert.match(panel, /normalizeKernelState/);
  assert.match(panel, /kernelState=\{kernelState\}/);
  assert.match(views, /run\.triggerId === "morning_brief"/);
  assert.match(views, /briefIsFresh/);
  assert.match(views, /今日已生成/);
  assert.match(views, /上次生成/);
  assert.match(views, /生成失败/);
  assert.match(views, /尚无运行记录/);
  assert.doesNotMatch(views, /edupi-dashboard-readiness/);
  assert.match(css, /\.edupi-daily-brief > footer/);
});
