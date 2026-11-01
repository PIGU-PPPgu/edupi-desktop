import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { workflowChildPromptAllowed, matchingCapturedUserEntry } = await createJiti(import.meta.url).import("./edupi-workflow-admission.ts");

test("Core-first permits only an internal child of the active captured parent", () => {
  assert.equal(workflowChildPromptAllowed("allowed", false, false), true);
  assert.equal(workflowChildPromptAllowed("core_first_required", false, true), false);
  assert.equal(workflowChildPromptAllowed("core_first_required", true, false), false);
  assert.equal(workflowChildPromptAllowed("core_first_required", true, true), true);
  assert.equal(workflowChildPromptAllowed("unavailable", false, false), false);
  assert.equal(workflowChildPromptAllowed("unavailable", true, true), true);
});

test("parent capture is bound to the latest user entry of the active turn", () => {
  const branch = [
    { type: "message", id: "older", message: { role: "user" } },
    { type: "message", id: "assistant", message: { role: "assistant" } },
    { type: "message", id: "current", message: { role: "user" } },
  ];
  assert.equal(matchingCapturedUserEntry(true, true, "current", branch), true);
  assert.equal(matchingCapturedUserEntry(true, true, "older", branch), false);
  assert.equal(matchingCapturedUserEntry(false, true, "current", branch), false);
  assert.equal(matchingCapturedUserEntry(true, false, "current", branch), false);
});
