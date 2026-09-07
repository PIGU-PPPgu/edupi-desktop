import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { withEducationModel } = await jiti.import("./edupi-model-context.ts");

test("concurrent educational tool calls retain their own session model", async () => {
  const seen = [];
  const session = id => ({ model: { id }, modelRuntime: { getAuth: async model => { seen.push(model.id); return null; } } });
  await Promise.all(["model-a", "model-b"].map((id, index) => withEducationModel(session(id), async () => {
    await new Promise(resolve => setTimeout(resolve, index ? 1 : 10));
    assert.equal(globalThis.__edupiModelBridge.available(), true);
    await assert.rejects(globalThis.__edupiModelBridge.complete({ messages: [{ role: "user", content: "test" }] }), /凭据/);
  })));
  assert.deepEqual(seen.sort(), ["model-a", "model-b"]);
  assert.equal(globalThis.__edupiModelBridge.available(), false);
});
