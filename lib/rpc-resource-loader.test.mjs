import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { rpcResourceOptions } = await createJiti(import.meta.url).import("./rpc-resource-loader.ts");

test("strict child sessions restore their exact tool set after extension startup and before each prompt", () => {
  const mode = { disabled: false, exactToolNames: ["read", "find", "grep", "ls"] };
  const options = rpcResourceOptions({}, mode);
  const handlers = new Map();
  const selected = [];
  options.extensionFactories.at(-1)({
    on(event, handler) { handlers.set(event, handler); },
    setActiveTools(names) { selected.push([...names]); },
  });
  handlers.get("session_start")();
  handlers.get("before_agent_start")();
  assert.deepEqual(selected, [mode.exactToolNames, mode.exactToolNames]);
});
