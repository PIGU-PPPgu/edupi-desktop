import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");

function fakeSession() {
  return {
    sessionId: "session-test",
    sessionFile: undefined,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    autoCompactionEnabled: false,
    autoRetryEnabled: false,
    sessionManager: { getCwd: () => "/tmp/edupi" },
    settingsManager: {},
    agent: { state: {} },
    extensionRunner: {},
    modelRuntime: {},
    promptTemplates: [],
    resourceLoader: {},
    dispose() {},
    abortBash() {},
  };
}

test("app-control tool request uses the replayable extension UI channel and waits for ACK", async () => {
  const wrapper = new AgentSessionWrapper(fakeSession());
  let request;
  wrapper.onEvent((event) => { request = event; });
  const resultPromise = wrapper.requestEduPiAppAction({ action: "navigate", view: "calendar" });

  assert.equal(request.type, "extension_ui_request");
  assert.equal(request.method, "edupi_action");
  assert.deepEqual(request.action, { action: "navigate", view: "calendar" });
  await wrapper.send({ type: "extension_ui_response", id: request.id, confirmed: true });
  assert.equal(await resultPromise, true);
  wrapper.destroy();
});

test("app-control request fails closed when its session is aborted", async () => {
  const wrapper = new AgentSessionWrapper(fakeSession());
  const controller = new AbortController();
  controller.abort();
  assert.equal(await wrapper.requestEduPiAppAction({ action: "open_context" }, controller.signal), false);
  wrapper.destroy();
});

test("computer-use request returns a bounded structured result over the same replayable channel", async () => {
  const wrapper = new AgentSessionWrapper(fakeSession());
  let request;
  wrapper.onEvent((event) => { request = event; });
  const resultPromise = wrapper.requestEduPiComputerAction({ action: "status" });
  assert.equal(request.method, "edupi_computer_action");
  await wrapper.send({
    type: "extension_ui_response",
    id: request.id,
    value: JSON.stringify({ ok: true, result: { content: "off", isError: false, images: [], snapshotId: null, operationId: "computer-status" } }),
  });
  assert.deepEqual(await resultPromise, { ok: true, result: { content: "off", isError: false, images: [], snapshotId: null, operationId: "computer-status" } });
  wrapper.destroy();
});
