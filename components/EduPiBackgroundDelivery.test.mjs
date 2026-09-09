import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("background delivery excludes unavailable artifacts before completing a job", async () => {
  const source = await readFile(new URL("../lib/edupi-background-jobs.ts", import.meta.url), "utf8");
  assert.match(source, /if \(file\.available === false\) continue;/);
  assert.ok(source.indexOf("file.available === false") < source.indexOf("files.push(file)"));
  assert.match(source, /if \(files\.length\).*backgroundJobRequest\("complete"/);
});
