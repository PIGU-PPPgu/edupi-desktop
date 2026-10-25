import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { buildConnectionDirectory, findConnectionApps, managedConnectionState } = await createJiti(import.meta.url).import("./edupi-connection-directory.ts");
const provider = (service, displayName, scenario = "communication") => ({ service, displayName, scenario, categories: [], authTypes: ["oauth2"] });

test("known app variants share one entry while preserving every catalog service identity", () => {
  const providers = [provider("feishu", "Feishu"), provider("feishu_app_bot", "Feishu App Bot"), provider("feishu_custom_bot", "Feishu Custom Bot"),
    provider("dingtalk_bot", "DingTalk Bot"), provider("dingtalk_mcp", "DingTalk MCP"), provider("wecom_bot", "WeCom Bot"), provider("wecom_mcp", "WeCom MCP"),
    provider("googledrive", "Google Drive", "docs"), provider("googledocs", "Google Docs", "docs"), provider("unknown_bot", "Unknown Bot")];
  const before = structuredClone(providers);
  const directory = buildConnectionDirectory(providers);
  assert.deepEqual(directory.find((app) => app.id === "feishu").services.map((item) => item.service).sort(), ["feishu", "feishu_app_bot", "feishu_custom_bot"]);
  for (const [name, ids] of [["钉钉", ["dingtalk_bot", "dingtalk_mcp"]], ["企业微信", ["wecom_bot", "wecom_mcp"]]]) {
    const group = directory.filter((app) => app.displayName === name);
    assert.equal(group.length, 1);
    assert.deepEqual(group[0].services.map((item) => item.service).sort(), ids);
  }
  assert.equal(directory.filter((app) => app.id.startsWith("google")).length, 2);
  assert.equal(directory.find((app) => app.id === "unknown_bot").services[0], providers.at(-1));
  assert.deepEqual(providers, before);
});

test("native setup joins its own brand and never fabricates executable providers", () => {
  const directory = buildConnectionDirectory([], [{ connector_id: "feishu", status: "configured" }, { connector_id: "unrecognized", status: "connected" }]);
  const feishu = directory.find((app) => app.id === "feishu");
  assert.equal(feishu.managedId, "feishu"); assert.equal(feishu.managedStatus, "configured");
  assert.deepEqual(feishu.services, []);
  assert.equal(directory.some((app) => app.id === "unrecognized"), false);
  for (const id of ["email", "sis", "cloud_drive"]) {
    const app = directory.find((item) => item.managedId === id);
    assert.ok(app); assert.equal(app.iconService, null); assert.deepEqual(app.services, []);
  }
});

test("Chinese and provider-specific vocabulary find one complete app group", () => {
  const directory = buildConnectionDirectory([provider("feishu", "Feishu"), provider("feishu_app_bot", "Feishu App Bot"), provider("feishu_custom_bot", "Feishu Custom Bot"),
    provider("dingtalk_bot", "DingTalk Bot"), provider("dingtalk_mcp", "DingTalk MCP"), provider("googledrive", "Google Drive", "docs")]);
  for (const [query, id] of [["飞书", "feishu"], ["Feishu Custom Bot", "feishu"], ["钉钉", "dingtalk"], ["谷歌云盘", "googledrive"], ["学校邮箱", "school/email"]]) {
    assert.deepEqual(findConnectionApps(directory, query).map((app) => app.id), [id], query);
  }
  assert.equal(findConnectionApps(directory, "Feishu Custom Bot")[0].services.length, 3);
  assert.deepEqual(findConnectionApps(directory, "飞书", "docs"), []);
  assert.deepEqual(findConnectionApps(directory, "unknown-future"), []);
});

test("saved configuration and verified credentials do not become connected status", () => {
  assert.deepEqual(managedConnectionState("configured"), { label: "已配置", saved: true, connected: false });
  assert.deepEqual(managedConnectionState("credentials_verified"), { label: "凭据已验证", saved: true, connected: false });
  for (const status of ["connected", "conversation_verified"]) assert.equal(managedConnectionState(status).connected, true);
  for (const status of [undefined, "not_configured", "failed", "future_state"]) assert.equal(managedConnectionState(status).saved, false);
});

test("saved GitHub authorization remains visible if the catalog cannot load", () => {
  const directory = buildConnectionDirectory([], [], true);
  assert.equal(directory[0].id, "github");
  assert.deepEqual(directory[0].services, []);
  assert.equal(buildConnectionDirectory([], [], false).some((app) => app.id === "github"), false);
});


test("native entries cannot overwrite a catalog service with a similar name", () => {
  const original = provider("school-email", "School Email Vendor");
  const directory = buildConnectionDirectory([original]);
  assert.equal(directory.find((app) => app.id === "school-email").services[0], original);
  assert.deepEqual(directory.find((app) => app.id === "school/email").services, []);
});
