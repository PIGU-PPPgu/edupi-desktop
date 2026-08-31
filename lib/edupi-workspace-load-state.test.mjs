import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { shouldShowBlockingEducationLoad } = await jiti.import("./edupi-workspace-load-state.ts");

const loadState = (education, { loading = false, loadError = null } = {}) => ({
  education,
  loading,
  loadError,
});
const isBlocking = (state) => shouldShowBlockingEducationLoad(state.education);

test("blocks only when education data has never been established", () => {
  assert.equal(isBlocking(loadState(null, { loading: true })), true);
  assert.equal(isBlocking(loadState(null, { loadError: "教育数据读取失败" })), true);
  assert.equal(isBlocking(loadState({}, { loading: true })), false);
  assert.equal(isBlocking(loadState({}, { loadError: "教育数据读取失败" })), false);
});
