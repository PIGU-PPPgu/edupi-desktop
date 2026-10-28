import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const { connectorIconUrl, connectorInitials, connectorScenario, discoverConnectorProviders, isOfficialConnectorIcon } = await createJiti(import.meta.url).import("./openconnector-discovery.ts");
const provider = (service, displayName, scenario = "docs") => ({ service, displayName, scenario, categories: ["Productivity"], authTypes: ["oauth2"] });
const providers = [provider("github", "GitHub", "developer"), provider("feishu", "Feishu", "communication"),
  provider("dingtalk_bot", "DingTalk Bot", "communication"), provider("googledrive", "Google Drive"),
  provider("googlesheets", "Google Sheets", "productivity"), provider("qq_mail", "QQ Mail", "communication")];

test("official and teacher vocabulary find real local providers without adding cloud-only services", () => {
  for (const [query, service] of [["飞书", "feishu"], ["钉钉", "dingtalk_bot"], ["谷歌云盘", "googledrive"],
    ["谷歌云端硬盘", "googledrive"], ["google drive", "googledrive"], ["Google-Drive", "googledrive"],
    ["电子表格", "googlesheets"], ["QQ邮箱", "qq_mail"], ["代码仓库", "github"]]) {
    assert.ok(discoverConnectorProviders(providers, { query }).some((item) => item.service === service), query);
  }
  assert.deepEqual(discoverConnectorProviders(providers, { query: "1688" }), []);
  assert.deepEqual(discoverConnectorProviders([], { query: "飞书" }), []);
  assert.equal(discoverConnectorProviders(providers, { query: "谷歌 云盘" })[0].service, "googledrive");
});

test("scenario filtering, saved connections and common service ranking work together without mutation", () => {
  const before = [...providers];
  const found = discoverConnectorProviders(providers, { connectedServices: new Set(["github"]) });
  assert.equal(found[0].service, "github");
  assert.equal(found[1].service, "feishu");
  assert.deepEqual(discoverConnectorProviders(providers, { scenario: "docs" }).map((item) => item.service), ["googledrive"]);
  assert.deepEqual(discoverConnectorProviders(providers, { scenario: "docs", query: "钉钉" }), []);
  assert.deepEqual(providers, before);
  assert.equal(connectorScenario(provider("future", "Future", "new-scenario")), "other");
});

test("icons accept only the explicit official HTTPS brand asset boundary", () => {
  assert.equal(connectorIconUrl("github"), "https://static.oomol.com/logo/third-party/github.png");
  for (const service of ["workday", "fusion-api", "../../github", "https://evil.example/logo.png"]) assert.equal(connectorIconUrl(service), null);
  for (const url of ["http://static.oomol.com/logo/third-party/github.png", "https://static.oomol.com.evil.example/logo/third-party/x.svg",
    "https://user:pass@static.oomol.com/logo/third-party/x.png", "https://static.oomol.com:444/logo/third-party/x.png",
    "https://static.oomol.com/logo/logo.png", "https://static.oomol.com/logo/third-party/x.svg?track=1",
    "https://static.oomol.com/logo/third-party/x.png#test", "javascript:alert(1)", "data:image/svg+xml,bad"]) {
    assert.equal(isOfficialConnectorIcon(url), false, url);
  }
});

test("fixed snapshot is bounded to bundled identities and contains no executable or credential data", async () => {
  const snapshot = JSON.parse(await readFile(new URL("./openconnector-provider-metadata.json", import.meta.url), "utf8"));
  assert.equal(snapshot.source, "https://connector.oomol.com/public/v1/apps");
  assert.equal(snapshot.runtimeCatalogVersion, "1.6.5");
  assert.equal(Object.keys(snapshot.providers).length, 1550);
  assert.equal(Object.values(snapshot.providers).filter((item) => item.iconUrl).length, 1549);
  for (const [service, item] of Object.entries(snapshot.providers)) {
    assert.match(service, /^[a-z0-9][a-z0-9_-]{0,119}$/u);
    assert.ok(Object.keys(item).every((key) => ["iconUrl", "searchAliases"].includes(key)));
    if (item.iconUrl) assert.ok(isOfficialConnectorIcon(item.iconUrl), service);
    assert.ok(item.searchAliases.every((alias) => typeof alias === "string" && alias.length <= 120));
  }
});

test("initials remain readable for missing assets and non-Latin service names", () => {
  assert.equal(connectorInitials("Google Drive"), "GD");
  assert.equal(connectorInitials("GitHub"), "GI");
  assert.equal(connectorInitials("飞书"), "飞书");
  assert.equal(connectorInitials(""), "?");
});
