import assert from "node:assert/strict";
import test from "node:test";
import {createJiti} from "jiti";
const {GET}=await createJiti(import.meta.url,{tsconfigPaths:true}).import("./route.ts");
test("student record reads reject untrusted origins and hosts before reaching Core",async()=>{
  const request=(headers)=>new Request("http://localhost/api/edupi/student-events",{headers});
  assert.equal((await GET(request({host:"attacker.invalid",origin:"http://attacker.invalid"}))).status,403);
  assert.equal((await GET(request({host:"localhost",origin:"http://attacker.invalid","sec-fetch-site":"cross-site"}))).status,403);
});
