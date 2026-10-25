import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { createJiti } from "jiti";

const source = fs.readFileSync(new URL("./EduPiConnectorSetup.tsx", import.meta.url), "utf8");
const { connectorRequirement, EduPiConnectorSetup } = await createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } }).import("./EduPiConnectorSetup.tsx");
test("Feishu maximum scopes and DingTalk QR onboarding remain actionable and secret-safe", () => {
  for (const label of ["机器人应用", "创建并授权", "复制权限清单", "199 项应用权限", "打开开放平台", "App ID", "App Secret", "验证并保存", "由钉钉管理员扫码授权", "扫码创建并授权", "复制运行时命令", "Client ID", "Client Secret"]) assert.match(source, new RegExp(label));
  assert.match(source, /\/api\/edupi\/connectors\/feishu/);
  assert.match(source, /\/api\/edupi\/connectors\/dingtalk\/register/);
  assert.match(source, /credentials_verified/);
  assert.match(source, /0\.8\.25/);
  assert.match(source, /type="password"/);
  assert.match(source, /setAppSecret\(""\)/);
  assert.doesNotMatch(source, /localStorage/);
});

test("configured and connected remain distinct connector states", () => {
  assert.match(source, /status === "connected" \|\| status === "conversation_verified" \? "已连接" : status === "configured" \? "已配置"/);
  assert.match(source, /飞书应用配置已保存/);
  assert.doesNotMatch(source, /status === "configured" \|\| status === "connected" \? "已连接"/);
});

test("every projected connector has one reachable setup or requirement surface", () => {
  assert.match(source, /CONNECTOR_SETUP_IDS = \["feishu", "dingtalk", \.\.\.Object\.keys\(GUIDES\)\]/);
  for (const id of ["email", "sis", "cloud_drive"]) assert.match(source, new RegExp(`${id}: \\{ title:`));
  for (const text of ["需要管理员接入", "IMAP/SMTP", "课表、校历和名单接口", "授权指定材料目录"]) assert.match(source, new RegExp(text));
  assert.match(source, /edupi-connector-setup__requirement/);
  assert.deepEqual(connectorRequirement("not_configured", "申请接口"), { title: "需要管理员接入", detail: "申请接口", ready: false });
  assert.deepEqual(connectorRequirement("credentials_verified", "申请接口"), { title: "凭据已验证", detail: "运行连接仍由管理员维护。", ready: false });
  assert.deepEqual(connectorRequirement("configured", "申请接口"), { title: "已完成接入", detail: "当前连接已由管理员配置。", ready: true });
  assert.deepEqual(connectorRequirement("connected", "申请接口"), { title: "已完成接入", detail: "当前连接已由管理员配置。", ready: true });
  const configured = renderToStaticMarkup(React.createElement(EduPiConnectorSetup, { connectorId: "email", status: "configured", onClose() {}, onConfigured() {} }));
  assert.match(configured, /已完成接入/);
  assert.doesNotMatch(configured, /需要管理员接入/);
});


test("embedded setup keeps native handlers inline and tucks instructions behind disclosure", () => {
  for (const connectorId of ["feishu", "dingtalk"]) {
    const html = renderToStaticMarkup(React.createElement(EduPiConnectorSetup, { embedded: true, connectorId, status: "not_configured", onClose() {}, onConfigured() {} }));
    assert.doesNotMatch(html, /aria-label="关闭连接设置"|role="dialog"/);
    assert.match(html, /<summary>接入说明<\/summary>/);
    assert.match(html, /type="password"/);
  }
});
