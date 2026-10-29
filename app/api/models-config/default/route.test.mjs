import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

test("a saved custom model can become the default on a fresh profile", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edupi-default-test-"));
  const previous = { agent:process.env.PI_CODING_AGENT_DIR, data:process.env.EDUPI_DATA_ROOT, local:process.env.PI_WEB_PRIVATE_MODEL_LOCAL };
  process.env.PI_CODING_AGENT_DIR = root;
  process.env.EDUPI_DATA_ROOT = root;
  process.env.PI_WEB_PRIVATE_MODEL_LOCAL = "1";
  try {
    fs.writeFileSync(path.join(root,"models.json"),JSON.stringify({providers:{fixture:{baseUrl:"https://example.invalid/v1",api:"openai-completions",models:[{id:"fixture-model",name:"Fixture",input:["text"],contextWindow:4096,maxTokens:256,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}}}));
    const { GET, POST } = await createJiti(import.meta.url,{tsconfigPaths:true}).import("./route.ts");
    const request = (modelId) => new Request("http://localhost/api/models-config/default",{method:"POST",headers:{host:"localhost",origin:"http://localhost","Content-Type":"application/json"},body:JSON.stringify({provider:"fixture",modelId})});
    assert.equal((await POST(request("missing"))).status,400);
    const response = await POST(request("fixture-model"));
    assert.equal(response.status,200,JSON.stringify(await response.json()));
    const settings=JSON.parse(fs.readFileSync(path.join(root,"settings.json"),"utf8"));
    assert.equal(settings.defaultProvider,"fixture");
    assert.equal(settings.defaultModel,"fixture-model");
    fs.writeFileSync(path.join(root,"auth.json"),JSON.stringify({fixture:{type:"api_key",key:"synthetic-test-key"}}));
    const statusRequest = () => new Request("http://localhost/api/models-config/default",{headers:{host:"localhost",origin:"http://localhost"}});
    const general = await GET(statusRequest());
    assert.equal(general.status,200);
    assert.deepEqual(await general.json(),{configured:true,eligible:true});
    const codingConfig=JSON.parse(fs.readFileSync(path.join(root,"models.json"),"utf8"));
    codingConfig.providers.fixture.baseUrl="https://coding.dashscope.aliyuncs.com/v1";
    fs.writeFileSync(path.join(root,"models.json"),JSON.stringify(codingConfig));
    const coding = await GET(statusRequest());
    assert.deepEqual(await coding.json(),{configured:true,eligible:false,reason:"coding_plan"});
  } finally {
    if (previous.agent === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous.agent;
    if (previous.data === undefined) delete process.env.EDUPI_DATA_ROOT; else process.env.EDUPI_DATA_ROOT = previous.data;
    if (previous.local === undefined) delete process.env.PI_WEB_PRIVATE_MODEL_LOCAL; else process.env.PI_WEB_PRIVATE_MODEL_LOCAL = previous.local;
    fs.rmSync(root,{recursive:true,force:true});
  }
});
