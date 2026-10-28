import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { SETTINGS_GROUPS, SETTINGS_SEARCH_ITEMS, searchSettings, isPreferenceSection } = await createJiti(import.meta.url).import("./edupi-settings-navigation.ts");

test("settings separates personal preferences, capabilities, and this device without a second settings page", () => {
  assert.deepEqual(SETTINGS_GROUPS.map(group => group.label), ["个人", "AI 与服务", "本机"]);
  const sections = SETTINGS_GROUPS.flatMap(group => group.sections);
  assert.equal(new Set(sections.map(section => section.id)).size, sections.length);
  assert.equal(sections.filter(section => isPreferenceSection(section.id)).length, 6);
  assert.ok(!sections.some(section => ["settings", "workspace", "openconnector"].includes(section.id)));
  assert.ok(sections.some(section => section.id === "readiness" && section.label === "自动运行"));
});

test("settings search routes JEV to its actual AI pane and service brands to the unified directory", () => {
  assert.deepEqual(searchSettings("ＪＥＶ").map(item => [item.id, item.section, item.modelPane]), [["browser-decision", "models", "browser"]]);
  for (const query of ["飞书", "OpenConnector", "GitHub", "OAuth"]) {
    assert.deepEqual(searchSettings(query).map(item => item.section), ["connections"]);
  }
  assert.equal(searchSettings("API Key")[0].id, "chat-models");
  assert.equal(searchSettings("代理")[0].id, "update-proxy");
  assert.equal(searchSettings("辅助功能")[0].section, "devices");
});

test("search requires all tokens, prefers setting names, and exposes stable targets for every result", () => {
  assert.equal(searchSettings("通知")[0].label, "任务完成通知");
  assert.equal(searchSettings("系统 通知")[0].section, "notifications");
  assert.deepEqual(searchSettings(" "), []);
  assert.deepEqual(searchSettings("cannot-find-a-setting"), []);
  assert.equal(new Set(SETTINGS_SEARCH_ITEMS.map(item => item.id)).size, SETTINGS_SEARCH_ITEMS.length);
  assert.ok(SETTINGS_SEARCH_ITEMS.every(item => item.path && item.label && /^[a-z-]+$/.test(item.id)));
});
