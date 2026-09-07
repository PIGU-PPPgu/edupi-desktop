import assert from "node:assert/strict";
import test from "node:test";
import { generateValidatedArtifacts } from "../desktop/model-output-repair.mjs";
function session(outputs) {
  return { calls: [], state: { messages: [] }, async prompt(prompt) { this.calls.push(prompt); this.state.messages.push({ role: "assistant", content: [{ type: "text", text: outputs[this.calls.length - 1] }], stopReason: "stop" }); } };
}
const validate = output => { try { JSON.parse(output); } catch { throw Object.assign(new Error("invalid JSON"), { code: "invalid_model_output" }); } };
test("valid output does not incur a repair call", async () => {
  const model = session(['{"artifacts":[]}']);
  await generateValidatedArtifacts(model,"prompt",{deliverables:[]},validate);
  assert.equal(model.calls.length,1);
});
test("malformed output receives one repair and is revalidated", async () => {
  const model = session(['{"content":"他说"你好""}', '{"artifacts":[]}']);
  assert.equal(await generateValidatedArtifacts(model,"prompt",{deliverables:["教案"]},validate),'{"artifacts":[]}');
  assert.equal(model.calls.length,2);
  assert.match(model.calls[1],/教案/);
});
test("repeated invalid output fails without an unbounded model loop", async () => {
  const model = session(["invalid", "still invalid"]);
  await assert.rejects(generateValidatedArtifacts(model,"prompt",{deliverables:[]},validate));
  assert.equal(model.calls.length,2);
});
