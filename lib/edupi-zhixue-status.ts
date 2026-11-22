import type { AgentMessage, ToolResultMessage } from "./types";

const loginPhases = ["not_started", "starting", "awaiting_scan", "authenticated", "needs_login", "expired", "error"] as const;
const syncPhases = ["needs_config", "ready", "busy", "running", "ok", "empty", "failed"] as const;
const zhixueTools = new Set(["zhixue_login", "zhixue_login_status", "zhixue_sync", "zhixue_sync_status"]);

export type ZhixueLoginPhase = typeof loginPhases[number];
export type ZhixueSyncPhase = typeof syncPhases[number];
export type ZhixueReceipt = {
  version: 1;
  flowId: string | null;
  status: ZhixueLoginPhase;
  sync?: ZhixueSyncPhase;
};

export type ZhixueFlowStatus =
  | { status: "starting" | "needs_login" | "expired" | "error" | "not_current" }
  | { status: "awaiting_scan"; qr?: string }
  | { status: "authenticated"; needsSyncConfig: boolean };

export function isZhixueFlowId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value);
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function zhixueToolReceipt(message: ToolResultMessage): ZhixueReceipt | null {
  if (!zhixueTools.has(message.toolName ?? "")) return null;
  const raw = record(record(message.details)?.zhixue);
  if (!raw || raw.version !== 1 || !loginPhases.some(status => status === raw.status)
    || (raw.status === "not_started" ? raw.flowId !== null : !isZhixueFlowId(raw.flowId))) return null;
  const sync = raw.status === "authenticated" ? syncPhases.find(status => status === raw.sync) : undefined;
  return { version: 1, flowId: raw.flowId as string | null, status: raw.status as ZhixueLoginPhase, ...(sync ? { sync } : {}) };
}

export function isLegacyZhixueQr(message: ToolResultMessage): boolean {
  return zhixueTools.has(message.toolName ?? "")
    && !zhixueToolReceipt(message)
    && record(record(message.details)?.visual)?.kind === "qr";
}

export function zhixueTurnStatus(messages: readonly AgentMessage[]): ZhixueReceipt | null {
  return messages.reduce<ZhixueReceipt | null>((latest, message) => {
    if (message.role !== "toolResult") return latest;
    const receipt = zhixueToolReceipt(message);
    if (!receipt) return latest;
    if (receipt.status === "authenticated" && !receipt.sync && latest?.flowId === receipt.flowId && latest.sync) {
      return { ...receipt, sync: latest.sync };
    }
    return receipt;
  }, null);
}

export function parseZhixueFlowStatus(value: unknown): ZhixueFlowStatus | null {
  const raw = record(value);
  switch (raw?.status) {
    case "starting":
    case "needs_login":
    case "expired":
    case "error":
    case "not_current":
      return { status: raw.status };
    case "authenticated":
      return typeof raw.needsSyncConfig === "boolean" ? { status: raw.status, needsSyncConfig: raw.needsSyncConfig } : null;
    case "awaiting_scan":
      return typeof raw.qr === "string" && raw.qr.length <= 349_528 && /^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/u.test(raw.qr)
        ? { status: raw.status, qr: raw.qr }
        : { status: raw.status };
    default:
      return null;
  }
}

export function zhixueStatusText({ status, sync }: { status: ZhixueLoginPhase | "not_current"; sync?: ZhixueSyncPhase }): string {
  switch (status) {
    case "not_started": return "智学网还没登录。";
    case "starting": return "正在打开智学网，请稍等。";
    case "awaiting_scan": return "等待扫码。请用智学网教师端 App 扫码。";
    case "needs_login": return "智学网登录已失效，请重新扫码。";
    case "expired": return "扫码已超时，请重新发起登录。";
    case "error": return "登录未完成，请重新发起扫码。";
    case "not_current": return "这次扫码已结束。";
    case "authenticated":
      switch (sync) {
        case "needs_config": return "已确认登录。同步前请确认班级、学科和学段。";
        case "ready": return "已确认登录，可以开始同步。";
        case "busy": return "智学网窗口正在使用，请稍后再试。";
        case "running": return "已确认登录，正在同步学情。";
        case "ok": return "智学网基础学情同步完成。";
        case "empty": return "所选范围没有可同步的作业。";
        case "failed": return "学情同步失败。请查看处理详情。";
        default: return "已确认登录。";
      }
  }
}
