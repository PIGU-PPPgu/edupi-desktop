import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { cloudChatData, cloudChatAgentState } = await createJiti(import.meta.url).import("./edupi-cloud-chat-projection.ts");
const scope = { issuer: "https://synthetic.invalid", accountId: "teacher", workspaceId: "workspace", generation: 2 };
const response = () => ({
  workspace_id: "workspace",
  session: { workspace_id: "workspace", session_id: "cloud-session", title: "测试对话",
    created_at: "2026-11-23T00:00:00Z", updated_at: "2026-11-23T00:00:01Z", thinking_level: "off" },
  messages: [{ message_id: "request:user", role: "user", message: { role: "user", content: "你好" } },
    { message_id: "request:assistant", role: "assistant", message: { role: "assistant", content: [{ type: "text", text: "收到" }] } }],
  requests: [{ request_id: "request", status: "queued" }],
});
test("cloud history round-trips the same user and assistant entries without local paths", () => {
  const data = cloudChatData(response(), scope);
  assert.deepEqual(data.context.entryIds, ["request:user", "request:assistant"]);
  assert.equal(data.context.messages[1].content[0].text, "收到");
  assert.equal(data.info.projectRoot, "cloud:workspace");
  assert.equal(data.cloudScope, JSON.stringify(["cloud", scope.issuer, scope.accountId, scope.workspaceId, scope.generation]));
});
test("cloud history rejects another workspace and malformed assistant content", () => {
  assert.throws(() => cloudChatData({ ...response(), workspace_id: "other" }, scope), /无效/);
  const data = response();
  data.messages[1].message.content = [{ type: "toolResult", text: "private" }];
  assert.throws(() => cloudChatData(data, scope), /无效/);
});
test("queued and finished requests reconcile streaming state after reconnect", () => {
  assert.equal(cloudChatAgentState(response()).state.cloudStatus, "queued");
  const done = response();
  done.requests[0].status = "completed";
  assert.equal(cloudChatAgentState(done).state.isStreaming, false);
});
