import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { backgroundJobStatusText } = await createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } }).import("./EduPiBackgroundJobs.tsx");
test("only a failed job shows the current error", () => {
  assert.equal(backgroundJobStatusText({status:"completed",error:"lease_expired"}),"已完成");
  assert.equal(backgroundJobStatusText({status:"running",error:"lease_expired"}),"处理中");
  assert.equal(backgroundJobStatusText({status:"failed",error:"lease_expired"}),"失败 · lease_expired");
});
