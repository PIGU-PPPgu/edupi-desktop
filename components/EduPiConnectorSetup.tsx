"use client";

import { useState } from "react";
import { openExternal } from "@/lib/desktop-native";

const FEISHU_PERMISSIONS = { scopes: { tenant: ["im:message", "im:message:send_as_bot", "im:chat", "im:resource", "contact:user.base:readonly", "calendar:calendar", "drive:drive", "docx:document"] } };
const FEISHU_EVENTS = ["im.message.receive_v1", "im.chat.member.bot.added_v1"];
const FEISHU_CALLBACKS = ["card.action.trigger"];

const CONNECTOR_GUIDE: Record<string, { title: string; note: string; url?: string }> = {
  dingtalk: { title: "钉钉", note: "创建企业内部应用，取得 Client ID 与 Client Secret。", url: "https://open-dev.dingtalk.com/" },
  email: { title: "邮箱", note: "向邮箱管理员申请 IMAP/SMTP 或 OAuth 应用信息。" },
  sis: { title: "教务系统", note: "向学校教务管理员申请课表、校历和名单接口。" },
  cloud_drive: { title: "云盘", note: "选择学校正在使用的云盘，再授权指定材料目录。" },
};

async function copyText(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}

export function EduPiConnectorSetup({ connectorId, status, onClose, onConfigured }: { connectorId: string; status: string; onClose: () => void; onConfigured: () => void }) {
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (label: string, value: string) => {
    try { await copyText(value); setCopied(label); setMessage(null); }
    catch { setMessage("复制失败，请允许剪贴板访问后重试"); }
  };
  if (connectorId !== "feishu") {
    const guide = CONNECTOR_GUIDE[connectorId] || { title: connectorId, note: "该连接器需要管理员提供接入信息。" };
    return <section className="edupi-connector-setup" aria-label={`${guide.title}连接设置`}>
      <header><div><span>连接设置</span><h2>{guide.title}</h2><small>{status === "configured" ? "已连接" : "未配置"}</small></div><button type="button" onClick={onClose} aria-label="关闭连接设置">×</button></header>
      <p>{guide.note}</p>
      {guide.url ? <button className="edupi-admin-primary" type="button" onClick={() => void openExternal(guide.url!)}>打开开发者平台</button> : null}
    </section>;
  }
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/edupi/connectors/feishu", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appId, appSecret }) });
      const result = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "连接验证失败");
      setAppSecret(""); setMessage("验证通过，飞书已连接"); onConfigured();
    } catch (error) { setMessage(error instanceof Error ? error.message : "连接验证失败"); }
    finally { setBusy(false); }
  };
  return <section className="edupi-connector-setup" aria-label="飞书连接设置">
    <header><div><span>连接设置</span><h2>飞书机器人</h2><small>{status === "configured" ? "已连接，可重新绑定" : "约 5 分钟"}</small></div><button type="button" onClick={onClose} aria-label="关闭连接设置">×</button></header>
    <ol>
      <li><strong>创建企业自建应用并添加机器人</strong><button type="button" onClick={() => void openExternal("https://open.feishu.cn/app")}>打开飞书开放平台 ↗</button></li>
      <li><strong>批量导入最小权限</strong><span>8 项</span><button type="button" onClick={() => void copy("权限 JSON", JSON.stringify(FEISHU_PERMISSIONS, null, 2))}>{copied === "权限 JSON" ? "已复制" : "复制权限 JSON"}</button></li>
      <li><strong>使用长连接接收事件</strong><span>2 个事件 · 1 个回调</span><button type="button" onClick={() => void copy("事件清单", [...FEISHU_EVENTS, ...FEISHU_CALLBACKS].join("\n"))}>{copied === "事件清单" ? "已复制" : "复制事件清单"}</button></li>
      <li><strong>创建版本并发布应用</strong><button type="button" onClick={() => void openExternal("https://moonshot.feishu.cn/wiki/Aa4EwFLCGiwdntklc9vcPZdsn9c")}>查看参考流程 ↗</button></li>
    </ol>
    <form onSubmit={submit}>
      <label>App ID<input value={appId} onChange={(event) => setAppId(event.target.value)} placeholder="cli_..." maxLength={68} autoComplete="off" /></label>
      <label>App Secret<input type="password" value={appSecret} onChange={(event) => setAppSecret(event.target.value)} maxLength={128} autoComplete="off" /></label>
      {message ? <p role="status">{message}</p> : null}
      <button className="edupi-admin-primary" type="submit" disabled={busy || !appId.trim() || appSecret.length < 16}>{busy ? "验证中…" : "验证并保存"}</button>
    </form>
  </section>;
}
