import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, copyFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyPreparationDependencies } from "./preparation-runtime.mjs";

test("preparation dependencies load outside the development node_modules", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
  const destination = await mkdtemp(path.join(os.tmpdir(),"edupi-preparation-runtime-"));
  try {
    await copyPreparationDependencies(root,destination);
    for(const file of ["preparation-materials.mjs","preparation-source-text.mjs","office-archive.mjs"]) await copyFile(path.join(root,"desktop",file),path.join(destination,file));
    const result = spawnSync(process.execPath,["--input-type=module","-e",'await import("./preparation-materials.mjs"); const m=await import("mammoth"); if(typeof m.extractRawText!=="function")process.exit(1); console.log("runtime ready");'],{cwd:destination,encoding:"utf8"});
    assert.equal(result.status,0,result.stderr);
    assert.match(result.stdout,/runtime ready/);
  } finally {await rm(destination,{recursive:true,force:true});}
});
