import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const { GET } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./route.ts");

test("workspace bundle fails visibly when the pinned Core is unavailable", async () => {
  const previousCore = process.env.EDUPI_CORE_ROOT;
  const previousData = process.env.EDUPI_DATA_ROOT;
  process.env.EDUPI_CORE_ROOT = "/missing/core";
  process.env.EDUPI_DATA_ROOT = "/missing/data";
  try {
    const response = await GET();
    assert.equal(response.status, 503);
  } finally {
    if (previousCore === undefined) delete process.env.EDUPI_CORE_ROOT; else process.env.EDUPI_CORE_ROOT = previousCore;
    if (previousData === undefined) delete process.env.EDUPI_DATA_ROOT; else process.env.EDUPI_DATA_ROOT = previousData;
  }
});

test("workspace route derives education and onboarding from one Core snapshot", async () => {
  const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
  const server = await readFile(new URL("../../../../lib/edupi-education-server.ts", import.meta.url), "utf8");
  assert.match(source, /readEducationWorkspaceBundle/);
  assert.match(server, /const snapshot = await readEduPiEducationSnapshot/);
  assert.match(server, /projectTeacherContextSnapshot\(snapshot\)/);
  assert.match(server, /projectEducationContract\(snapshot\)/);
  assert.equal((server.match(/export async function readEducationWorkspaceBundle/g) || []).length, 1);
});
