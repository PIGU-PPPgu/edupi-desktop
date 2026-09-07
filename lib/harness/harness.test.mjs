import assert from "node:assert/strict";
import test from "node:test";

import { defineHarness } from "./harness.ts";
import { createHarnessRouter } from "./harness-router.ts";
import { createPiHarness } from "./pi-harness.ts";
import { teacherInternalScope } from "./scope.ts";

const profile = {
  id: "pi",
  controlTransport: "in-process",
  toolTransport: "in-process",
  transcriptFormat: "pi-jsonl",
  capabilities: new Set(["abort"]),
};

const startInput = {
  sessionId: "session-1",
  sessionFile: "/tmp/session-1.jsonl",
  cwd: undefined,
  options: {
    toolNames: ["read", "bash"],
    initialModel: { provider: "openai", modelId: "gpt-test" },
    thinkingLevel: "high",
  },
  scope: teacherInternalScope(),
};

test("defineHarness binds the session controller and preserves the authored profile", async () => {
  const implementation = {
    prefix: "bound",
    async start(input) {
      return { session: { marker: `${this.prefix}:${input.scope.id}` }, realSessionId: input.sessionId };
    },
  };

  const harness = defineHarness(profile, implementation);
  const result = await harness.sessions.start(startInput);

  assert.equal(harness.profile, profile);
  assert.equal(result.session.marker, "bound:teacher:local");
  assert.equal(result.realSessionId, "session-1");
  assert.equal(harness.tools.name("read"), "read");
  assert.deepEqual(harness.models, {});
});

test("the transitional scope names only the truthful local teacher boundary", () => {
  assert.deepEqual(teacherInternalScope(), {
    kind: "teacher_internal",
    id: "teacher:local",
  });
  assert.equal(teacherInternalScope(), teacherInternalScope());
});

test("the router selects the sole Pi adapter and passes the teacher scope unchanged", async () => {
  let received;
  const pi = defineHarness(profile, {
    async start(input) {
      received = input;
      return { session: { marker: "pi" }, realSessionId: "real-session" };
    },
  });
  const router = createHarnessRouter(new Map([["pi", pi]]), "pi");

  const result = await router.start(startInput);

  assert.equal(result.realSessionId, "real-session");
  assert.equal(received.scope, startInput.scope);
  assert.equal(received.options, startInput.options);
});

test("the router rejects an unknown internal adapter id", async () => {
  const pi = defineHarness(profile, { async start() { throw new Error("must not run"); } });
  const router = createHarnessRouter(new Map([["pi", pi]]), "pi");

  await assert.rejects(router.start(startInput, "claude"), /harness claude is unavailable/);
});

test("the Pi adapter preserves all start parameters and returns the starter result unchanged", async () => {
  const expected = { session: { marker: "wrapper" }, realSessionId: "real-session" };
  let received;
  const harness = createPiHarness({
    startRpcSession: async (...args) => {
      received = args;
      return expected;
    },
  });

  const actual = await harness.sessions.start(startInput);

  assert.equal(actual, expected);
  assert.deepEqual(received, [
    "session-1",
    "/tmp/session-1.jsonl",
    undefined,
    startInput.options,
  ]);
  assert.equal(harness.profile.id, "pi");
  assert.deepEqual(
    [...harness.profile.capabilities].sort(),
    ["abort", "images", "provider-sessions", "steer", "thinking-level"],
  );
});
