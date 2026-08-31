import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const locks = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./edupi-material-recognition-lock.ts");

test("allows only one recognition flow per staging id and releases after completion", async () => {
  let releaseFirst;
  const first = locks.withMaterialRecognitionLock("stg_00000000000000000000000000000001", () => new Promise((resolve) => { releaseFirst = resolve; }));
  await assert.rejects(
    locks.withMaterialRecognitionLock("stg_00000000000000000000000000000001", async () => "second"),
    (error) => error?.code === "recognition_busy",
  );
  releaseFirst("first");
  assert.equal(await first, "first");
  assert.equal(await locks.withMaterialRecognitionLock("stg_00000000000000000000000000000001", async () => "third"), "third");
});

test("bounds total concurrent recognition sessions", async () => {
  const releases = [];
  const first = locks.withMaterialRecognitionLock("stg_10000000000000000000000000000001", () => new Promise((resolve) => { releases.push(() => resolve("first")); }));
  const second = locks.withMaterialRecognitionLock("stg_10000000000000000000000000000002", () => new Promise((resolve) => { releases.push(() => resolve("second")); }));
  await assert.rejects(
    locks.withMaterialRecognitionLock("stg_10000000000000000000000000000003", async () => "third"),
    (error) => error?.code === "recognition_capacity",
  );
  releases.forEach((release) => release());
  assert.deepEqual(await Promise.all([first, second]), ["first", "second"]);
});
