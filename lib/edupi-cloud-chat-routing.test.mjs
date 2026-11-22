import assert from "node:assert/strict";
import test from "node:test";
import { cloudChatRoutePath, localChatWriteScopeMatches } from "./edupi-cloud-chat-routing.ts";

test("cloud routing covers session context, prompt, SSE and running endpoints", () => {
  for (const path of ["/api/sessions", "/api/sessions/cloud-one/context", "/api/agent/new",
    "/api/agent/cloud-one/events", "/api/agent/running", "/api/agent/running/events"]) {
    assert.equal(cloudChatRoutePath(path), path.replace("/api/", "/api/edupi/cloud/chat/"));
  }
});
test("local session routes refuse old cloud and old local snapshot writes after a mode switch", () => {
  assert.equal(localChatWriteScopeMatches(JSON.stringify(["cloud", "issuer", "teacher", "workspace", 2]), 3), false);
  assert.equal(localChatWriteScopeMatches(JSON.stringify(["local", 2]), 3), false);
  assert.equal(localChatWriteScopeMatches(JSON.stringify(["local", 3]), 3), true);
  assert.equal(localChatWriteScopeMatches("local", 3), true);
  assert.equal(localChatWriteScopeMatches(null, 3), true);
});
test("cloud chat routing does not redirect Core, Auth or similar API names", () => {
  for (const path of ["/api/edupi/cloud", "/api/edupi/workspace", "/api/auth/login",
    "/api/sessions-extra", "/api/agent-token", "/api/mobile/sessions"]) {
    assert.equal(cloudChatRoutePath(path), null);
  }
});
